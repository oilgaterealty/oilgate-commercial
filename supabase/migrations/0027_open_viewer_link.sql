-- Open viewer link (no sign-in), view counter, and lender/reviewer access requests.
-- Additive and idempotent. Scoped strictly to public.commercial_* and commercial_access_private.*.
-- No anon table policies: anon receives EXECUTE only on the three open RPCs.
begin;

-- 1. Open viewer links (owner-only manage; token is 32+ random URL-safe chars made server-side).
create table if not exists public.commercial_open_links (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{32,128}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists commercial_open_links_deal_idx
  on public.commercial_open_links (deal_id, created_at desc);

alter table public.commercial_open_links enable row level security;
revoke all on public.commercial_open_links from public, anon, authenticated;
grant select, insert, update, delete on public.commercial_open_links to authenticated;

drop policy if exists commercial_open_links_owner_all on public.commercial_open_links;
create policy commercial_open_links_owner_all on public.commercial_open_links
  for all to authenticated
  using (public.commercial_is_owner())
  with check (public.commercial_is_owner());

-- 2. Open viewer view log (owner-only select; no direct anon insert).
create table if not exists public.commercial_open_views (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.commercial_open_links(id) on delete cascade,
  visitor text not null check (char_length(visitor) between 1 and 64),
  viewed_at timestamptz not null default now()
);
create index if not exists commercial_open_views_link_visitor_idx
  on public.commercial_open_views (link_id, visitor, viewed_at desc);

alter table public.commercial_open_views enable row level security;
revoke all on public.commercial_open_views from public, anon, authenticated;
grant select on public.commercial_open_views to authenticated;

drop policy if exists commercial_open_views_owner_read on public.commercial_open_views;
create policy commercial_open_views_owner_read on public.commercial_open_views
  for select to authenticated
  using (public.commercial_is_owner());

-- 3. Rate-limit ledger for open-link access requests (max 3 per email per day; owner-only select).
create table if not exists public.commercial_open_request_attempts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  email text not null check (email <> '' and email = lower(email)),
  created_at timestamptz not null default now()
);
create index if not exists commercial_open_request_attempts_email_idx
  on public.commercial_open_request_attempts (email, created_at desc);

alter table public.commercial_open_request_attempts enable row level security;
revoke all on public.commercial_open_request_attempts from public, anon, authenticated;
grant select on public.commercial_open_request_attempts to authenticated;

drop policy if exists commercial_open_request_attempts_owner_read on public.commercial_open_request_attempts;
create policy commercial_open_request_attempts_owner_read on public.commercial_open_request_attempts
  for select to authenticated
  using (public.commercial_is_owner());

-- 4. Extend commercial_access_requests so open-link requests land in the existing owner requests list.
alter table public.commercial_access_requests
  alter column requester_id drop not null;

alter table public.commercial_access_requests
  add column if not exists requester_name text check (requester_name is null or char_length(requester_name) <= 120),
  add column if not exists requester_company text check (requester_company is null or char_length(requester_company) <= 120),
  add column if not exists requester_note text check (requester_note is null or char_length(requester_note) <= 1000),
  add column if not exists source text not null default 'signed_in' check (source in ('signed_in', 'open_link'));

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
        insert into public.commercial_members (deal_id, email, role, display_name, ntfy_topic)
          values (
            req.deal_id,
            req.email,
            p_role,
            coalesce(req.requester_name, ''),
            case when p_role in ('realtor', 'reviewer', 'lender') then 'ogdeal-' || replace(gen_random_uuid()::text, '-', '') end
          )
          on conflict (deal_id, email) do nothing;
        outcome := case when found then 'approved' else 'superseded' end;
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

revoke all on function commercial_access_private.decide_request(uuid, boolean, text) from public, anon, authenticated;
grant execute on function commercial_access_private.decide_request(uuid, boolean, text) to authenticated;

-- 5. Owner-only open-link management RPCs.
create or replace function public.commercial_open_link_create(p_deal uuid)
returns text language plpgsql volatile security definer set search_path = public
as $$
declare
  tok text;
begin
  if not public.commercial_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.commercial_deals where id = p_deal and status = 'active') then
    raise exception 'no deal' using errcode = '22023';
  end if;

  update public.commercial_open_links
    set revoked_at = now()
    where deal_id = p_deal and revoked_at is null;

  tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.commercial_open_links (deal_id, token)
    values (p_deal, tok);
  return tok;
end
$$;

create or replace function public.commercial_open_link_revoke(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public
as $$
begin
  if not public.commercial_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.commercial_open_links
    set revoked_at = now()
    where id = p_id and revoked_at is null;
end
$$;

revoke all on function public.commercial_open_link_create(uuid) from public, anon, authenticated;
revoke all on function public.commercial_open_link_revoke(uuid) from public, anon, authenticated;
grant execute on function public.commercial_open_link_create(uuid) to authenticated;
grant execute on function public.commercial_open_link_revoke(uuid) to authenticated;

-- 6. Three open RPCs granted to anon and authenticated (snapshot only; never contacts, emails, messages, offers, notes, or non-viewer files).
create or replace function public.commercial_open_viewer(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_deal public.commercial_deals;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    return null;
  end if;

  select d.* into v_deal
    from public.commercial_open_links l
    join public.commercial_deals d on d.id = l.deal_id
    where l.token = p_token
      and l.revoked_at is null
      and d.status = 'active'
    limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'deal', jsonb_build_object(
      'id', v_deal.id,
      'slug', v_deal.slug,
      'title', v_deal.title,
      'address', v_deal.address,
      'units', 10,
      'summary', coalesce(nullif(btrim(v_deal.seller_content ->> 'summary'), ''), '10-unit residential property.')
    ),
    'photos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', u.id,
          'storage_path', u.storage_path,
          'note', u.note,
          'featured', u.featured,
          'created_at', u.created_at
        )
        order by u.featured desc, u.created_at desc
      )
      from public.commercial_uploads u
      where u.deal_id = v_deal.id
        and u.kind = 'photo'
        and 'viewer' = any(u.audience)
    ), '[]'::jsonb),
    'walkthrough_photos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'unit_number', p.unit_number,
          'room', p.room,
          'storage_path', p.storage_path,
          'created_at', p.created_at
        )
        order by p.created_at
      )
      from public.commercial_walkthrough_photos p
      where p.deal_id = v_deal.id
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.commercial_open_log_view(p_token text, p_visitor text)
returns void language plpgsql volatile security definer set search_path = public
as $$
declare
  v_link_id uuid;
  v_visitor text := left(btrim(coalesce(p_visitor, '')), 64);
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' or v_visitor = '' then
    return;
  end if;

  select l.id into v_link_id
    from public.commercial_open_links l
    join public.commercial_deals d on d.id = l.deal_id
    where l.token = p_token
      and l.revoked_at is null
      and d.status = 'active'
    limit 1;

  if v_link_id is null then
    return;
  end if;

  if exists (
    select 1 from public.commercial_open_views v
    where v.link_id = v_link_id
      and v.visitor = v_visitor
      and v.viewed_at > now() - interval '1 hour'
  ) then
    return;
  end if;

  insert into public.commercial_open_views (link_id, visitor)
    values (v_link_id, v_visitor);
end
$$;

create or replace function public.commercial_open_request_access(
  p_token text,
  p_name text,
  p_company text,
  p_email text,
  p_role text,
  p_note text default ''
)
returns text language plpgsql volatile security definer set search_path = public
as $$
declare
  v_deal_id uuid;
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := left(btrim(coalesce(p_name, '')), 120);
  v_company text := nullif(left(btrim(coalesce(p_company, '')), 120), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_attempts integer;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    return 'invalid';
  end if;

  select l.deal_id into v_deal_id
    from public.commercial_open_links l
    join public.commercial_deals d on d.id = l.deal_id
    where l.token = p_token
      and l.revoked_at is null
      and d.status = 'active'
    limit 1;

  if v_deal_id is null then
    return 'invalid';
  end if;

  if v_role not in ('lender', 'reviewer') then
    return 'invalid_role';
  end if;

  if char_length(v_email) < 3 or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return 'invalid_email';
  end if;

  if v_name = '' then
    return 'invalid_name';
  end if;

  select count(*)::int into v_attempts
    from public.commercial_open_request_attempts a
    where a.email = v_email
      and a.created_at > now() - interval '24 hours';

  if v_attempts >= 3 then
    return 'rate_limited';
  end if;

  insert into public.commercial_open_request_attempts (deal_id, email)
    values (v_deal_id, v_email);

  if not exists (select 1 from public.commercial_owners o where o.email = v_email)
     and not exists (select 1 from public.commercial_members m where m.deal_id = v_deal_id and m.email = v_email) then
    insert into public.commercial_access_requests (
      deal_id,
      requester_id,
      email,
      requested_role,
      requester_name,
      requester_company,
      requester_note,
      source
    )
    values (
      v_deal_id,
      null,
      v_email,
      v_role,
      v_name,
      v_company,
      v_note,
      'open_link'
    )
    on conflict (deal_id, email) do nothing;
  end if;

  return 'received';
end
$$;

revoke all on function public.commercial_open_viewer(text) from public;
revoke all on function public.commercial_open_log_view(text, text) from public;
revoke all on function public.commercial_open_request_access(text, text, text, text, text, text) from public;
grant execute on function public.commercial_open_viewer(text) to anon, authenticated;
grant execute on function public.commercial_open_log_view(text, text) to anon, authenticated;
grant execute on function public.commercial_open_request_access(text, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
