-- Realtor-only seller activity RPC (seller sign-ins, page opens, messages to realtor) and seller-invite check.
-- Additive and idempotent. Scoped strictly to public.commercial_* objects.
begin;

create or replace function public.commercial_realtor_seller_activity(p_deal uuid, p_limit int default 100)
returns table (kind text, display_name text, summary text, at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 1000));
  v_me text := public.commercial_jwt_email();
begin
  if p_deal is null or public.commercial_member_role(p_deal) is distinct from 'realtor' then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
    with sellers as (
      select
        m.email,
        coalesce(nullif(btrim(m.display_name), ''), nullif(btrim(d.seller_name), ''), 'Seller') as seller_name
      from public.commercial_members m
      join public.commercial_deals d on d.id = m.deal_id
      where m.deal_id = p_deal
        and m.role = 'seller'
        and not exists (
          select 1
          from public.commercial_owners o
          where o.email = m.email
        )
    ),
    raw_signins as (
      select
        e.id,
        lower(btrim(coalesce(e.payload ->> 'actor_username', ''))) as ev_email,
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
    matched_signins as (
      select
        rs.id,
        rs.ev_email,
        s.seller_name,
        rs.ev_action,
        rs.ev_at,
        lag(rs.ev_at) over (
          partition by rs.ev_email, rs.ev_action
          order by rs.ev_at desc, rs.id desc
        ) as newer_at
      from raw_signins rs
      join sellers s on s.email = rs.ev_email
    ),
    signins as (
      select
        case when ms.ev_action = 'user_signedup' then 'signup' else 'signin' end as kind,
        ms.seller_name as display_name,
        case when ms.ev_action = 'user_signedup' then 'Signed up' else 'Signed in' end as summary,
        ms.ev_at as at
      from matched_signins ms
      where ms.newer_at is null
         or (ms.newer_at - ms.ev_at) > interval '5 seconds'
    ),
    views as (
      select
        'view'::text as kind,
        coalesce(nullif(btrim(a.actor_name), ''), s.seller_name) as display_name,
        'Opened the seller page'::text as summary,
        a.created_at as at
      from public.commercial_activity a
      join sellers s on s.email = lower(btrim(a.actor_email))
      where a.deal_id = p_deal
        and a.actor_role = 'seller'
        and a.kind = 'view'
    ),
    messages as (
      select
        'message'::text as kind,
        coalesce(nullif(btrim(msg.author_name), ''), s.seller_name) as display_name,
        'Wrote' || coalesce(' (' || nullif(btrim(msg.topic), '') || ')', '') || ': ' || left(msg.body, 140) as summary,
        msg.created_at as at
      from public.commercial_messages msg
      join sellers s on s.email = lower(btrim(msg.author_email))
      left join public.commercial_conversations c
        on c.id = msg.conversation_id
       and c.deal_id = p_deal
      where msg.deal_id = p_deal
        and msg.author_role = 'seller'
        and (
          (msg.conversation_id is not null and c.id is not null and v_me = any (c.participants))
          or (msg.conversation_id is null and msg.channel = 'seller')
        )
    )
    select combined.kind, combined.display_name, combined.summary, combined.at
    from (
      select * from signins
      union all
      select * from views
      union all
      select * from messages
    ) combined
    order by combined.at desc
    limit v_limit;
end
$$;

revoke all on function public.commercial_realtor_seller_activity(uuid, int) from public, anon, authenticated;
grant execute on function public.commercial_realtor_seller_activity(uuid, int) to authenticated;

create or replace function public.commercial_realtor_has_seller(p_deal uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_deal is null or public.commercial_member_role(p_deal) is distinct from 'realtor' then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return exists (
    select 1
    from public.commercial_members m
    where m.deal_id = p_deal
      and m.role = 'seller'
      and m.status = 'active'
  );
end
$$;

revoke all on function public.commercial_realtor_has_seller(uuid) from public, anon, authenticated;
grant execute on function public.commercial_realtor_has_seller(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
