-- Signed-in viewer role upgrade requests (lender / reviewer) landing in commercial_access_requests.
-- Additive and idempotent. Scoped strictly to public.commercial_* and commercial_access_private.*.
begin;

create or replace function commercial_access_private.request_viewer_access(
  p_deal uuid,
  p_requested_role text,
  p_company text default '',
  p_note text default ''
)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  my_email text := commercial_access_private.verified_email();
  target uuid;
  v_role text;
  v_req_role text := lower(btrim(coalesce(p_requested_role, '')));
  v_company text := nullif(left(btrim(coalesce(p_company, '')), 120), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_name text;
  req public.commercial_access_requests;
begin
  if me is null or my_email is null then
    raise exception 'verified sign-in required' using errcode = '42501';
  end if;

  select d.id into target
    from public.commercial_deals d
    where d.id = p_deal and d.slug = 'charlotte' and d.status = 'active';
  if target is null then
    return 'blocked';
  end if;

  v_role := public.commercial_member_role(target);
  if v_role is null or v_role = 'owner' then
    return 'blocked';
  end if;
  if v_role not in ('viewer', 'guest') then
    return 'existing';
  end if;

  if v_req_role not in ('lender', 'reviewer') then
    raise exception 'invalid requested role' using errcode = '22023';
  end if;

  select nullif(left(btrim(coalesce(m.display_name, '')), 120), '') into v_name
    from public.commercial_members m
    where m.deal_id = target and m.email = my_email and m.status = 'active';

  select * into req
    from public.commercial_access_requests a
    where a.deal_id = target and a.email = my_email
    for update;

  if not found then
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
      target,
      me,
      my_email,
      v_req_role,
      v_name,
      v_company,
      v_note,
      'signed_in'
    );
    return 'pending';
  end if;

  if req.requester_id is not null and req.requester_id <> me then
    return 'blocked';
  end if;
  if req.status in ('pending', 'denied') then
    return req.status;
  end if;

  update public.commercial_access_requests
    set requester_id = me,
        status = 'pending',
        requested_role = v_req_role,
        requester_name = coalesce(v_name, requester_name),
        requester_company = v_company,
        requester_note = v_note,
        source = 'signed_in',
        created_at = now(),
        decided_at = null,
        decided_by = null,
        approved_role = null
    where id = req.id;

  return 'pending';
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
        if found then
          outcome := 'approved';
        elsif req.requester_id is not null and req.source = 'signed_in' then
          update public.commercial_members
            set role = p_role,
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

create or replace function public.commercial_request_viewer_access(
  p_deal uuid,
  p_requested_role text,
  p_company text default '',
  p_note text default ''
)
returns text language sql security invoker set search_path = ''
as $$ select commercial_access_private.request_viewer_access(p_deal, p_requested_role, p_company, p_note) $$;

revoke all on function commercial_access_private.request_viewer_access(uuid, text, text, text) from public, anon, authenticated;
revoke all on function commercial_access_private.decide_request(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.commercial_request_viewer_access(uuid, text, text, text) from public, anon, authenticated;
grant execute on function commercial_access_private.request_viewer_access(uuid, text, text, text) to authenticated;
grant execute on function commercial_access_private.decide_request(uuid, boolean, text) to authenticated;
grant execute on function public.commercial_request_viewer_access(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
