-- v8 consolidated: owner-only offers + single lead offer RPC, lead_guest role,
-- recipient-bound expiring/revocable role links, requested_role on access requests,
-- lender City Records + city-records storage read + bridge/DSCR/both terms,
-- and private realtor/reviewer strategy ideas isolation.
-- Additive and idempotent. Scoped strictly to commercial_* objects, commercial_access_private, and commercial-files.
begin;

-- 1. Expand role checks to include lead_guest.
alter table public.commercial_members drop constraint if exists commercial_members_role_check;
alter table public.commercial_members add constraint commercial_members_role_check
  check (role in ('realtor','seller','guest','lender','reviewer','viewer','lead_guest'));

alter table public.commercial_role_links drop constraint if exists commercial_role_links_role_check;
alter table public.commercial_role_links add constraint commercial_role_links_role_check
  check (role in ('realtor','seller','lender','reviewer','viewer','lead_guest'));

alter table public.commercial_access_requests
  add column if not exists requested_role text
    check (requested_role is null or requested_role in ('realtor','seller','reviewer','lender','viewer','lead_guest'));
alter table public.commercial_access_requests drop constraint if exists commercial_access_requests_approved_role_check;
alter table public.commercial_access_requests add constraint commercial_access_requests_approved_role_check
  check (approved_role is null or approved_role in ('realtor','seller','reviewer','lender','viewer','lead_guest'));

-- 2. Recipient-bound, expiring, revocable individual links.
alter table public.commercial_role_links
  add column if not exists recipient_email text
    check (recipient_email is null or (recipient_email <> '' and recipient_email = lower(recipient_email))),
  add column if not exists max_uses integer not null default 1 check (max_uses >= 1);

create or replace function public.commercial_member_role(p_deal uuid)
 returns text language sql stable security definer set search_path to 'public'
as $$
  select case when public.commercial_is_owner() then 'owner'
    else (select m.role from commercial_members m
          where m.deal_id = p_deal and m.email = public.commercial_jwt_email() and m.status = 'active'
            and (m.link_id is null or exists (
              select 1 from commercial_role_links l
              where l.id = m.link_id
                and l.revoked_at is null
                and l.expires_at > now()
                and (l.recipient_email is null or l.recipient_email = m.email)
            )))
  end
$$;

drop function if exists public.commercial_create_role_link(uuid, text, text);
create or replace function public.commercial_create_role_link(
  p_deal uuid,
  p_role text,
  p_label text default '',
  p_recipient_email text default null,
  p_expires_days integer default 14
) returns text language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  tok text;
  v_email text := nullif(lower(btrim(coalesce(p_recipient_email, ''))), '');
begin
  if not public.commercial_is_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_role not in ('realtor','seller','lender','reviewer','viewer','lead_guest') then raise exception 'bad role' using errcode = '22023'; end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'recipient email required' using errcode = '22023'; end if;
  if p_expires_days is null or p_expires_days < 1 or p_expires_days > 90 then raise exception 'bad expiration' using errcode = '22023'; end if;
  if not exists (select 1 from commercial_deals where id = p_deal) then raise exception 'no deal'; end if;
  tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into commercial_role_links (deal_id, role, label, recipient_email, token_hash, expires_at, max_uses)
    values (
      p_deal,
      p_role,
      left(coalesce(p_label, ''), 80),
      v_email,
      encode(sha256(convert_to(tok, 'UTF8')), 'hex'),
      now() + make_interval(days => p_expires_days),
      1
    );
  return tok;
end $$;

create or replace function public.commercial_redeem_role_link(p_token text)
 returns text language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  l commercial_role_links;
  me text := commercial_access_private.verified_email();
  m commercial_members;
  s text;
begin
  if me is null or me = '' then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'link not valid'; end if;
  select * into l from commercial_role_links
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    for update;
  if not found then raise exception 'link not valid'; end if;
  if l.revoked_at is not null then raise exception 'link revoked'; end if;
  if l.expires_at <= now() then raise exception 'link expired'; end if;
  if l.recipient_email is not null and l.recipient_email <> me then
    raise exception 'wrong recipient' using errcode = '42501';
  end if;
  select slug into s from commercial_deals where id = l.deal_id;
  if public.commercial_is_owner() then return s; end if;
  select * into m from commercial_members where deal_id = l.deal_id and email = me;
  if found then
    if m.status <> 'active' then raise exception 'access removed'; end if;
    if m.link_id is not null and m.link_id <> l.id and m.role = l.role
       and exists (select 1 from commercial_role_links prev where prev.id = m.link_id and (prev.revoked_at is not null or prev.expires_at <= now())) then
      if l.uses >= l.max_uses then raise exception 'link already used'; end if;
      update commercial_members set link_id = l.id where id = m.id;
      update commercial_role_links set uses = uses + 1 where id = l.id;
    end if;
    return s;
  end if;
  if l.uses >= l.max_uses then raise exception 'link already used'; end if;
  insert into commercial_members (deal_id, email, role, display_name, ntfy_topic, status, link_id)
    values (
      l.deal_id,
      me,
      l.role,
      '',
      case when l.role in ('realtor', 'reviewer', 'lender') then 'ogdeal-' || replace(gen_random_uuid()::text, '-', '') end,
      'active',
      l.id
    );
  update commercial_role_links set uses = uses + 1 where id = l.id;
  return s;
end $$;

revoke all on function public.commercial_create_role_link(uuid, text, text, text, integer) from public, anon;
revoke all on function public.commercial_redeem_role_link(text) from public, anon;
grant execute on function public.commercial_create_role_link(uuid, text, text, text, integer) to authenticated;
grant execute on function public.commercial_redeem_role_link(text) to authenticated;

-- 3. Access requests record requested_role; owner chooses actual approved_role.
drop function if exists public.commercial_request_charlotte_access(boolean);
drop function if exists commercial_access_private.request_charlotte(boolean);

create or replace function commercial_access_private.request_charlotte(p_submit boolean, p_requested_role text default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  my_email text := commercial_access_private.verified_email();
  target uuid;
  req public.commercial_access_requests;
begin
  if me is null or my_email is null then
    raise exception 'verified sign-in required' using errcode = '42501';
  end if;

  select d.id into target from public.commercial_deals d where d.slug = 'charlotte' and d.status = 'active';
  if target is null then return 'blocked'; end if;
  if public.commercial_member_role(target) is not null then return 'existing'; end if;
  if exists (select 1 from public.commercial_members m where m.deal_id = target and m.email = my_email) then
    return 'blocked';
  end if;

  if p_submit is true then
    if p_requested_role is null or p_requested_role not in ('realtor','seller','reviewer','lender','viewer','lead_guest') then
      raise exception 'requested role required' using errcode = '22023';
    end if;
    insert into public.commercial_access_requests (deal_id, requester_id, email, requested_role)
    values (target, me, my_email, p_requested_role) on conflict (deal_id, email) do nothing;
  end if;

  select * into req from public.commercial_access_requests a where a.deal_id = target and a.email = my_email;
  if not found then return 'ready'; end if;
  if req.requester_id <> me then return 'blocked'; end if;
  if req.status in ('pending', 'denied') then return req.status; end if;
  if public.commercial_member_role(target) is not null then return 'existing'; end if;
  return 'blocked';
end
$$;

create or replace function commercial_access_private.decide_request(p_request uuid, p_approve boolean, p_role text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  req public.commercial_access_requests;
  outcome text;
begin
  if me is null or commercial_access_private.verified_email() is null
      or not public.commercial_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_approve is null or (p_approve and (p_role is null or p_role not in ('realtor', 'seller', 'reviewer', 'lender', 'viewer', 'lead_guest')))
      or (not p_approve and p_role is not null) then
    raise exception 'invalid decision or role' using errcode = '22023';
  end if;

  select a.* into req from public.commercial_access_requests a
    join public.commercial_deals d on d.id = a.deal_id
    where a.id = p_request and a.status = 'pending' and d.slug = 'charlotte'
    for update of a;
  if not found then return 'resolved'; end if;

  if not p_approve then
    outcome := 'denied';
  else
    perform 1 from auth.users u where u.id = req.requester_id and u.email_confirmed_at is not null
      and lower(u.email) = req.email for share;
    if not found or exists (select 1 from public.commercial_owners o where o.email = req.email)
        or not exists (select 1 from public.commercial_deals d where d.id = req.deal_id and d.status = 'active') then
      outcome := 'superseded';
    else
      insert into public.commercial_members (deal_id, email, role, ntfy_topic)
        values (req.deal_id, req.email, p_role,
          case when p_role in ('realtor', 'reviewer', 'lender') then 'ogdeal-' || replace(gen_random_uuid()::text, '-', '') end)
        on conflict (deal_id, email) do nothing;
      outcome := case when found then 'approved' else 'superseded' end;
    end if;
  end if;
  update public.commercial_access_requests set status = outcome, decided_at = now(), decided_by = me,
    approved_role = case when outcome = 'approved' then p_role end where id = req.id;
  return outcome;
end
$$;

create or replace function public.commercial_request_charlotte_access(p_submit boolean, p_requested_role text default null)
returns text language sql security invoker set search_path = ''
as $$ select commercial_access_private.request_charlotte(p_submit, p_requested_role) $$;

revoke all on function commercial_access_private.request_charlotte(boolean, text) from public, anon, authenticated;
grant execute on function commercial_access_private.request_charlotte(boolean, text) to authenticated;
revoke all on function public.commercial_request_charlotte_access(boolean, text) from public, anon, authenticated;
grant execute on function public.commercial_request_charlotte_access(boolean, text) to authenticated;

-- 4. Owner-only offers + single lead offer RPC (non-owners see at most 1 lead offer, never notes or backups).
alter table public.commercial_offers
  add column if not exists is_lead boolean not null default false,
  add column if not exists share_lead_guest boolean not null default false;

create unique index if not exists commercial_offers_one_lead_idx
  on public.commercial_offers (deal_id) where is_lead;

drop policy if exists offers_shared on public.commercial_offers;

create or replace function commercial_access_private.set_lead_offer(p_deal uuid, p_offer uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.commercial_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_offer is not null and not exists (select 1 from public.commercial_offers where id = p_offer and deal_id = p_deal) then
    raise exception 'offer not found' using errcode = '22023';
  end if;
  update public.commercial_offers set is_lead = false, updated_at = now()
    where deal_id = p_deal and is_lead = true and (p_offer is null or id <> p_offer);
  if p_offer is not null then
    update public.commercial_offers set is_lead = true, updated_at = now()
      where id = p_offer and deal_id = p_deal;
  end if;
end
$$;

create or replace function commercial_access_private.get_lead_offer(p_deal uuid)
returns table (id uuid, deal_id uuid, name text, structure text, inputs jsonb, updated_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  r text := public.commercial_member_role(p_deal);
begin
  if r is null or r in ('seller', 'viewer', 'guest') then
    return;
  end if;
  return query
    select o.id, o.deal_id, o.name, o.structure, o.inputs, o.updated_at
    from public.commercial_offers o
    where o.deal_id = p_deal
      and o.is_lead = true
      and (
        r = 'owner'
        or (r = 'realtor' and o.share_realtor)
        or (r = 'reviewer' and o.share_reviewer)
        or (r = 'lender' and o.share_lender)
        or (r = 'lead_guest' and o.share_lead_guest)
      )
    order by o.sort, o.updated_at desc
    limit 1;
end
$$;

create or replace function public.commercial_set_lead_offer(p_deal uuid, p_offer uuid)
returns void language sql security invoker set search_path = ''
as $$ select commercial_access_private.set_lead_offer(p_deal, p_offer) $$;

create or replace function public.commercial_get_lead_offer(p_deal uuid)
returns table (id uuid, deal_id uuid, name text, structure text, inputs jsonb, updated_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from commercial_access_private.get_lead_offer(p_deal) $$;

revoke all on function commercial_access_private.set_lead_offer(uuid, uuid) from public, anon, authenticated;
revoke all on function commercial_access_private.get_lead_offer(uuid) from public, anon, authenticated;
grant execute on function commercial_access_private.set_lead_offer(uuid, uuid) to authenticated;
grant execute on function commercial_access_private.get_lead_offer(uuid) to authenticated;
revoke all on function public.commercial_set_lead_offer(uuid, uuid) from public, anon, authenticated;
revoke all on function public.commercial_get_lead_offer(uuid) from public, anon, authenticated;
grant execute on function public.commercial_set_lead_offer(uuid, uuid) to authenticated;
grant execute on function public.commercial_get_lead_offer(uuid) to authenticated;

-- lead_guest sees only the featured cover photo from uploads and cannot open conversations.
drop policy if exists uploads_read on public.commercial_uploads;
create policy uploads_read on public.commercial_uploads for select using (
  public.commercial_member_role(deal_id) in ('owner','realtor','guest')
  or uploaded_by_email = public.commercial_jwt_email()
  or (public.commercial_member_role(deal_id) = 'seller' and visibility = 'seller')
  or (public.commercial_member_role(deal_id) = 'lead_guest' and kind = 'photo' and featured = true and (visibility = 'seller' or 'viewer' = any (audience)))
  or (public.commercial_member_role(deal_id) in ('reviewer','lender','viewer') and public.commercial_member_role(deal_id) = any (audience))
);

create or replace function public.commercial_can_open(p_deal uuid, p_participants text[]) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text := public.commercial_member_role(p_deal); me text := public.commercial_jwt_email(); p text; pr text;
begin
  if r is null or r in ('guest','viewer','lead_guest') or cardinality(p_participants) not between 1 and 20 then return false; end if;
  foreach p in array p_participants loop
    select role into pr from commercial_members where deal_id = p_deal and email = p and status = 'active';
    if pr is null then return false; end if;
    if r = 'owner' then continue; end if;
    if pr <> r and p <> me then return false; end if;
  end loop;
  if not public.commercial_lender_route_ok(p_deal, p_participants) then return false; end if;
  return true;
end $$;

-- 5. Lender City Records (read-only settings + storage PDFs) and Lender Terms (bridge / dscr / both, own-row RLS).
drop policy if exists settings_lender_city_records on public.commercial_settings;
create policy settings_lender_city_records on public.commercial_settings
  for select to authenticated
  using (
    key like 'city_records:%'
    and exists (
      select 1 from public.commercial_deals d
      where 'city_records:' || d.slug = commercial_settings.key
        and public.commercial_member_role(d.id) = 'lender'
    )
  );

drop policy if exists commercial_v8_city_records_lender_read on storage.objects;
create policy commercial_v8_city_records_lender_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'commercial-files'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (storage.foldername(name))[2] = 'city-records'
    and public.commercial_member_role(((storage.foldername(name))[1])::uuid) = 'lender'
  );

alter table public.commercial_lender_terms drop constraint if exists commercial_lender_terms_lender_type_check;
alter table public.commercial_lender_terms add constraint commercial_lender_terms_lender_type_check
  check (lender_type is null or lender_type in ('private','hard','traditional','bridge','dscr','both'));

drop policy if exists commercial_lender_terms_read on public.commercial_lender_terms;
create policy commercial_lender_terms_read on public.commercial_lender_terms
  for select to authenticated
  using (
    public.commercial_member_role(deal_id) = 'owner'
    or (public.commercial_member_role(deal_id) = 'lender' and lender_uid = auth.uid())
  );

-- 6. Private Realtor and Reviewer ideas (each sees only their own; owner sees all).
alter table public.commercial_strategy_ideas drop constraint if exists commercial_strategy_ideas_author_role_check;
alter table public.commercial_strategy_ideas add constraint commercial_strategy_ideas_author_role_check
  check (author_role is null or author_role in ('owner','realtor','reviewer'));

drop policy if exists commercial_strategy_ideas_realtor_read on public.commercial_strategy_ideas;
drop policy if exists commercial_strategy_ideas_realtor_insert on public.commercial_strategy_ideas;
drop policy if exists commercial_strategy_ideas_realtor_delete on public.commercial_strategy_ideas;
drop policy if exists commercial_strategy_ideas_member_own_read on public.commercial_strategy_ideas;
drop policy if exists commercial_strategy_ideas_member_own_insert on public.commercial_strategy_ideas;
drop policy if exists commercial_strategy_ideas_member_own_delete on public.commercial_strategy_ideas;

create policy commercial_strategy_ideas_member_own_read on public.commercial_strategy_ideas
  for select to authenticated
  using (public.commercial_member_role(deal_id) in ('realtor','reviewer') and author_uid = auth.uid());

create policy commercial_strategy_ideas_member_own_insert on public.commercial_strategy_ideas
  for insert to authenticated
  with check (
    public.commercial_member_role(deal_id) in ('realtor','reviewer')
    and author_role = public.commercial_member_role(deal_id)
    and author_uid = auth.uid()
  );

create policy commercial_strategy_ideas_member_own_delete on public.commercial_strategy_ideas
  for delete to authenticated
  using (public.commercial_member_role(deal_id) in ('realtor','reviewer') and author_uid = auth.uid());

notify pgrst, 'reload schema';
commit;
