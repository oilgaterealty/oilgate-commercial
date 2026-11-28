-- Lender "Your terms" polish, Private lender protections, 6-bullet seller alignment, and tab-specific invite lens.
-- Additive and idempotent. Scoped strictly to public.commercial_* and commercial_access_private.*.
begin;

-- 1. Ensure stored Charlotte seller protections omit the removed repair-money bullet.
update public.commercial_deals
set seller_content = jsonb_set(
  seller_content,
  '{protections}',
  coalesce(
    (
      select jsonb_agg(elem order by ord)
      from jsonb_array_elements_text(seller_content -> 'protections') with ordinality as t(elem, ord)
      where elem <> 'You control the repair money. It''s released only as work is finished.'
    ),
    '[]'::jsonb
  ),
  true
)
where slug = 'charlotte'
  and jsonb_typeof(seller_content -> 'protections') = 'array'
  and seller_content -> 'protections' @> jsonb_build_array('You control the repair money. It''s released only as work is finished.');

-- 2. Private lender protections in commercial_settings (lender + owner only; never readable by seller/realtor/reviewer/viewer).
revoke all on public.commercial_settings from public, anon;
grant select, insert, update on public.commercial_settings to authenticated;

drop policy if exists settings_lender_protections on public.commercial_settings;
create policy settings_lender_protections on public.commercial_settings
  for select to authenticated
  using (
    key like 'lender_protections:%'
    and exists (
      select 1 from public.commercial_deals d
      where 'lender_protections:' || d.slug = commercial_settings.key
        and public.commercial_member_role(d.id) = 'lender'
    )
  );

drop policy if exists settings_owner_lender_protections_insert on public.commercial_settings;
create policy settings_owner_lender_protections_insert on public.commercial_settings
  for insert to authenticated
  with check (
    public.commercial_is_owner()
    and key like 'lender_protections:%'
  );

drop policy if exists settings_owner_lender_protections_update on public.commercial_settings;
create policy settings_owner_lender_protections_update on public.commercial_settings
  for update to authenticated
  using (
    public.commercial_is_owner()
    and key like 'lender_protections:%'
  )
  with check (
    public.commercial_is_owner()
    and key like 'lender_protections:%'
  );

insert into public.commercial_settings (key, value)
values (
  'lender_protections:charlotte',
  jsonb_build_array(
    'Your money is secured by a recorded first-lien mortgage on 23 & 27 Charlotte.',
    'A neutral payment company pays you every month, and you see every payment.',
    'You''re named on the insurance.',
    '15-day grace, then default.',
    'Monthly updates here: rents, leases and repair photos.',
    'Extra collateral: one of my other rentals backs this loan too.'
  )::text
)
on conflict (key) do nothing;

-- 3. Member company + default_lens, and access-request requested_lens.
alter table public.commercial_members
  add column if not exists company text not null default '' check (char_length(company) <= 120),
  add column if not exists default_lens text check (default_lens is null or default_lens in ('bridge', 'private', 'dscr'));

update public.commercial_members m
set company = left(btrim(a.requester_company), 120)
from public.commercial_access_requests a
where a.deal_id = m.deal_id
  and a.email = m.email
  and btrim(coalesce(m.company, '')) = ''
  and btrim(coalesce(a.requester_company, '')) <> '';

alter table public.commercial_access_requests
  add column if not exists requested_lens text check (requested_lens is null or requested_lens in ('bridge', 'private', 'dscr'));

-- 4. Carry requested_lens (and optional requester_name) through Charlotte access requests and owner approval.
drop function if exists public.commercial_request_charlotte_access(boolean, text);
drop function if exists commercial_access_private.request_charlotte(boolean, text);

create or replace function commercial_access_private.request_charlotte(
  p_submit boolean,
  p_requested_role text default null,
  p_requested_lens text default null,
  p_requester_name text default null
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  my_email text := commercial_access_private.verified_email();
  target uuid;
  req public.commercial_access_requests;
  v_lens text := case
    when p_requested_role = 'lender' and lower(btrim(coalesce(p_requested_lens, ''))) in ('bridge', 'private', 'dscr')
      then lower(btrim(p_requested_lens))
    else null
  end;
  v_name text := nullif(left(btrim(coalesce(p_requester_name, '')), 120), '');
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
    insert into public.commercial_access_requests (deal_id, requester_id, email, requested_role, requested_lens, requester_name)
    values (target, me, my_email, p_requested_role, v_lens, v_name) on conflict (deal_id, email) do nothing;
  end if;

  select * into req from public.commercial_access_requests a where a.deal_id = target and a.email = my_email;
  if not found then return 'ready'; end if;
  if req.requester_id <> me then return 'blocked'; end if;
  if req.status in ('pending', 'denied') then return req.status; end if;
  if public.commercial_member_role(target) is not null then return 'existing'; end if;
  return 'blocked';
end
$$;

drop function if exists public.commercial_decide_access_request(uuid, boolean, text);
drop function if exists commercial_access_private.decide_request(uuid, boolean, text);

create or replace function commercial_access_private.decide_request(
  p_request uuid,
  p_approve boolean,
  p_role text,
  p_lens text default null
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  req public.commercial_access_requests;
  outcome text;
  v_raw_lens text := nullif(lower(btrim(coalesce(p_lens, ''))), '');
  v_lens text;
begin
  if me is null or commercial_access_private.verified_email() is null
      or not public.commercial_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_approve is null or (p_approve and (p_role is null or p_role not in ('realtor', 'seller', 'reviewer', 'lender', 'viewer', 'lead_guest')))
      or (not p_approve and p_role is not null) then
    raise exception 'invalid decision or role' using errcode = '22023';
  end if;
  if v_raw_lens is not null and v_raw_lens not in ('bridge', 'private', 'dscr') then
    raise exception 'invalid lens' using errcode = '22023';
  end if;

  select a.* into req from public.commercial_access_requests a
    join public.commercial_deals d on d.id = a.deal_id
    where a.id = p_request and a.status = 'pending' and d.slug = 'charlotte'
    for update of a;
  if not found then return 'resolved'; end if;

  v_lens := case
    when p_role = 'lender' then coalesce(v_raw_lens, req.requested_lens)
    else null
  end;

  if not p_approve then
    outcome := 'denied';
  else
    if req.requester_id is not null then
      perform 1 from auth.users u where u.id = req.requester_id and u.email_confirmed_at is not null
        and lower(u.email) = req.email for share;
      if not found then
        outcome := 'superseded';
      end if;
    elsif req.source <> 'open_link' then
      outcome := 'superseded';
    end if;

    if outcome is null then
      if exists (select 1 from public.commercial_owners o where o.email = req.email)
          or not exists (select 1 from public.commercial_deals d where d.id = req.deal_id and d.status = 'active') then
        outcome := 'superseded';
      else
        insert into public.commercial_members (deal_id, email, role, display_name, company, default_lens, ntfy_topic)
          values (
            req.deal_id,
            req.email,
            p_role,
            coalesce(req.requester_name, ''),
            coalesce(req.requester_company, ''),
            v_lens,
            case when p_role in ('realtor', 'reviewer', 'lender') then 'ogdeal-' || replace(gen_random_uuid()::text, '-', '') end
          )
          on conflict (deal_id, email) do nothing;
        if found then
          outcome := 'approved';
        elsif req.requester_id is not null and req.source = 'signed_in' then
          update public.commercial_members
            set role = p_role,
                display_name = case when btrim(display_name) = '' then coalesce(req.requester_name, '') else display_name end,
                company = case when btrim(company) = '' then coalesce(req.requester_company, '') else company end,
                default_lens = coalesce(v_lens, default_lens),
                ntfy_topic = coalesce(
                  ntfy_topic,
                  case when p_role in ('realtor', 'reviewer', 'lender') then 'ogdeal-' || replace(gen_random_uuid()::text, '-', '') end
                )
            where deal_id = req.deal_id
              and email = req.email
              and status = 'active'
              and role in ('viewer', 'guest');
          outcome := case when found then 'approved' else 'superseded' end;
        else
          outcome := 'superseded';
        end if;
      end if;
    end if;
  end if;

  update public.commercial_access_requests
    set status = outcome,
        decided_at = now(),
        decided_by = me,
        approved_role = case when outcome = 'approved' then p_role end
    where id = req.id;
  return outcome;
end
$$;

create or replace function public.commercial_request_charlotte_access(
  p_submit boolean,
  p_requested_role text default null,
  p_requested_lens text default null,
  p_requester_name text default null
)
returns text language sql security invoker set search_path = ''
as $$ select commercial_access_private.request_charlotte(p_submit, p_requested_role, p_requested_lens, p_requester_name) $$;

create or replace function public.commercial_decide_access_request(
  p_request uuid,
  p_approve boolean,
  p_role text,
  p_lens text default null
)
returns text language sql security invoker set search_path = ''
as $$ select commercial_access_private.decide_request(p_request, p_approve, p_role, p_lens) $$;

revoke all on function commercial_access_private.request_charlotte(boolean, text, text, text) from public, anon, authenticated;
revoke all on function commercial_access_private.decide_request(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.commercial_request_charlotte_access(boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.commercial_decide_access_request(uuid, boolean, text, text) from public, anon, authenticated;

grant execute on function commercial_access_private.request_charlotte(boolean, text, text, text) to authenticated;
grant execute on function commercial_access_private.decide_request(uuid, boolean, text, text) to authenticated;
grant execute on function public.commercial_request_charlotte_access(boolean, text, text, text) to authenticated;
grant execute on function public.commercial_decide_access_request(uuid, boolean, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
