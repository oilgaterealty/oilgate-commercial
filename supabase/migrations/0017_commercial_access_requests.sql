-- Charlotte access requests are separate from existing invitations and role links.
begin;

create table public.commercial_access_requests (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  requester_id uuid not null,
  email text not null check (email <> '' and email = lower(email)),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'superseded')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  approved_role text check (approved_role in ('realtor', 'seller', 'reviewer', 'lender', 'viewer')),
  unique (deal_id, email),
  check ((status = 'pending') = (decided_at is null and decided_by is null)),
  check ((status = 'approved') = (approved_role is not null))
);
create index commercial_access_requests_pending on public.commercial_access_requests (deal_id, created_at)
  where status = 'pending';
alter table public.commercial_access_requests enable row level security;
revoke all on public.commercial_access_requests from public, anon, authenticated;
grant select on public.commercial_access_requests to authenticated;
create policy commercial_access_requests_owner_read on public.commercial_access_requests
  for select to authenticated using ((select public.commercial_is_owner()));

-- The Data API exposes only security-invoker wrappers. Keep privileged code out of public.
create schema commercial_access_private;
revoke all on schema commercial_access_private from public, anon, authenticated;
grant usage on schema commercial_access_private to authenticated;

create function commercial_access_private.verified_email()
returns text language sql stable security definer set search_path = ''
as $$
  select lower(u.email) from auth.users as u
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null
    and u.email is not null and u.email <> ''
    and lower(u.email) = public.commercial_jwt_email()
$$;

create function commercial_access_private.request_charlotte(p_submit boolean)
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
    return 'blocked'; -- Do not bypass removals or existing invitations.
  end if;

  if p_submit is true then
    insert into public.commercial_access_requests (deal_id, requester_id, email)
    values (target, me, my_email) on conflict (deal_id, email) do nothing;
  end if;

  select * into req from public.commercial_access_requests a where a.deal_id = target and a.email = my_email;
  if not found then return 'ready'; end if;
  if req.requester_id <> me then return 'blocked'; end if;
  if req.status in ('pending', 'denied') then return req.status; end if;
  -- Approved access is reported only while the membership is actually active.
  if public.commercial_member_role(target) is not null then return 'existing'; end if;
  return 'blocked';
end
$$;

create function commercial_access_private.decide_request(p_request uuid, p_approve boolean, p_role text)
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
  if p_approve is null or (p_approve and (p_role is null or p_role not in ('realtor', 'seller', 'reviewer', 'lender', 'viewer')))
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
    -- Lock the verified identity through approval; stale/inactive identities grant nothing.
    perform 1 from auth.users u where u.id = req.requester_id and u.email_confirmed_at is not null
      and lower(u.email) = req.email for share;
    if not found or exists (select 1 from public.commercial_owners o where o.email = req.email)
        or not exists (select 1 from public.commercial_deals d where d.id = req.deal_id and d.status = 'active') then
      outcome := 'superseded';
    else
      -- The existing uniqueness constraint serializes competing invites and link redemptions.
      -- A conflict, including a revoked membership, is never overwritten or reactivated.
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

revoke all on function commercial_access_private.verified_email() from public, anon, authenticated;
revoke all on function commercial_access_private.request_charlotte(boolean) from public, anon, authenticated;
revoke all on function commercial_access_private.decide_request(uuid, boolean, text) from public, anon, authenticated;
grant execute on function commercial_access_private.request_charlotte(boolean) to authenticated;
grant execute on function commercial_access_private.decide_request(uuid, boolean, text) to authenticated;

create function public.commercial_request_charlotte_access(p_submit boolean)
returns text language sql security invoker set search_path = ''
as $$ select commercial_access_private.request_charlotte(p_submit) $$;

create function public.commercial_decide_access_request(p_request uuid, p_approve boolean, p_role text)
returns text language sql security invoker set search_path = ''
as $$ select commercial_access_private.decide_request(p_request, p_approve, p_role) $$;

revoke all on function public.commercial_request_charlotte_access(boolean) from public, anon, authenticated;
revoke all on function public.commercial_decide_access_request(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.commercial_request_charlotte_access(boolean) to authenticated;
grant execute on function public.commercial_decide_access_request(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
commit;
