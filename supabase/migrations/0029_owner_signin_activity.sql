-- Owner sign-in activity RPC (from auth.audit_log_entries) and hardened commercial_log_view RPC.
-- Additive and idempotent. Scoped strictly to public.commercial_* objects.
begin;

create or replace function public.commercial_signin_activity(p_deal uuid, p_limit int default 200)
returns table (email text, display_name text, role text, action text, at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 200), 1000));
begin
  if not public.commercial_is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_deal is null then
    return;
  end if;

  return query
    with events as (
      select
        e.id,
        lower(btrim(coalesce(e.payload ->> 'actor_username', ''))) as ev_email,
        lower(btrim(coalesce(e.payload ->> 'actor_name', ''))) as ev_actor_name,
        e.payload ->> 'action' as ev_action,
        e.created_at as ev_at
      from auth.audit_log_entries e
      where e.payload ->> 'action' in ('login', 'user_signedup')
        and lower(btrim(coalesce(e.payload ->> 'actor_username', ''))) <> ''
        and lower(btrim(coalesce(e.payload ->> 'actor_username', ''))) <> 'service_role'
        and lower(btrim(coalesce(e.payload ->> 'actor_name', ''))) <> 'service_role'
        and position('@' in lower(btrim(coalesce(e.payload ->> 'actor_username', '')))) > 0
        and lower(btrim(coalesce(e.payload ->> 'actor_username', ''))) not like '%@test.invalid'
    ),
    matched as (
      select
        ev.id,
        ev.ev_email,
        coalesce(nullif(btrim(m.display_name), ''), nullif(btrim(r.requester_name), ''), '') as ev_display_name,
        case
          when m.id is not null then m.role
          else 'requested ' || coalesce(nullif(btrim(r.requested_role), ''), 'access')
        end as ev_role,
        ev.ev_action,
        ev.ev_at
      from events ev
      left join public.commercial_members m
        on m.deal_id = p_deal
       and m.email = ev.ev_email
      left join public.commercial_access_requests r
        on r.deal_id = p_deal
       and r.email = ev.ev_email
      where (m.id is not null or r.id is not null)
        and not exists (
          select 1
          from public.commercial_owners o
          where o.email = ev.ev_email
        )
    ),
    deduped as (
      select
        mt.ev_email,
        mt.ev_display_name,
        mt.ev_role,
        mt.ev_action,
        mt.ev_at,
        lag(mt.ev_at) over (
          partition by mt.ev_email, mt.ev_action
          order by mt.ev_at desc, mt.id desc
        ) as newer_at
      from matched mt
    )
    select
      d.ev_email as email,
      d.ev_display_name as display_name,
      d.ev_role as role,
      d.ev_action as action,
      d.ev_at as at
    from deduped d
    where d.newer_at is null
       or (d.newer_at - d.ev_at) > interval '5 seconds'
    order by d.ev_at desc
    limit v_limit;
end
$$;

revoke all on function public.commercial_signin_activity(uuid, int) from public, anon, authenticated;
grant execute on function public.commercial_signin_activity(uuid, int) to authenticated;

create or replace function public.commercial_log_view(p_slug text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_deal_id uuid;
  v_role text;
  v_email text := public.commercial_jwt_email();
begin
  if v_slug = '' or v_email = '' then
    return;
  end if;

  select d.id into v_deal_id
    from public.commercial_deals d
    where d.slug = v_slug;

  if v_deal_id is null then
    return;
  end if;

  v_role := public.commercial_member_role(v_deal_id);
  if v_role is null or v_role = 'owner' then
    return;
  end if;

  if exists (
    select 1
    from public.commercial_activity a
    where a.deal_id = v_deal_id
      and a.actor_email = v_email
      and a.kind = 'view'
      and a.created_at > now() - interval '1 hour'
  ) then
    return;
  end if;

  perform public.commercial_record(v_deal_id, 'view', 'opened the deal page', 'team');
end
$$;

revoke all on function public.commercial_log_view(text) from public, anon, authenticated;
grant execute on function public.commercial_log_view(text) to authenticated;

notify pgrst, 'reload schema';
commit;
