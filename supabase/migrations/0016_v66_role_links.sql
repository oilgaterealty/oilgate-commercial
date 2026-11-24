-- v6.6: private role links the owner can turn off at any time.
-- Only a SHA-256 of each link token is stored. Redeeming needs a signed-in email.
begin;

create table if not exists public.commercial_role_links (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  role text not null check (role in ('realtor', 'seller', 'lender', 'reviewer', 'viewer')),
  label text not null default '' check (char_length(label) <= 80),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  revoked_at timestamptz,
  uses integer not null default 0
);
create index if not exists commercial_role_links_deal_id_idx on public.commercial_role_links (deal_id);

alter table public.commercial_role_links enable row level security;
revoke all on public.commercial_role_links from anon, authenticated;
grant select on public.commercial_role_links to authenticated;
drop policy if exists commercial_role_links_owner_read on public.commercial_role_links;
create policy commercial_role_links_owner_read on public.commercial_role_links
  for select to authenticated using (public.commercial_is_owner());

alter table public.commercial_members
  add column if not exists link_id uuid references public.commercial_role_links(id) on delete cascade;
create index if not exists commercial_members_link_id_idx on public.commercial_members (link_id);

-- A member who joined with a link keeps access only while that link is on.
create or replace function public.commercial_member_role(p_deal uuid)
 returns text language sql stable security definer set search_path to 'public'
as $$
  select case when public.commercial_is_owner() then 'owner'
    else (select m.role from commercial_members m
          where m.deal_id = p_deal and m.email = public.commercial_jwt_email() and m.status = 'active'
            and (m.link_id is null or exists (select 1 from commercial_role_links l where l.id = m.link_id and l.revoked_at is null)))
  end
$$;

create or replace function public.commercial_create_role_link(p_deal uuid, p_role text, p_label text default '')
 returns text language plpgsql volatile security definer set search_path to 'public'
as $$
declare tok text;
begin
  if not public.commercial_is_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_role not in ('realtor', 'seller', 'lender', 'reviewer', 'viewer') then raise exception 'bad role'; end if;
  if not exists (select 1 from commercial_deals where id = p_deal) then raise exception 'no deal'; end if;
  tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into commercial_role_links (deal_id, role, label, token_hash)
    values (p_deal, p_role, left(coalesce(p_label, ''), 80), encode(sha256(convert_to(tok, 'UTF8')), 'hex'));
  return tok;
end $$;

create or replace function public.commercial_revoke_role_link(p_link uuid)
 returns void language plpgsql volatile security definer set search_path to 'public'
as $$
begin
  if not public.commercial_is_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  update commercial_role_links set revoked_at = now() where id = p_link and revoked_at is null;
end $$;

create or replace function public.commercial_redeem_role_link(p_token text)
 returns text language plpgsql volatile security definer set search_path to 'public'
as $$
declare l commercial_role_links; me text := public.commercial_jwt_email(); m commercial_members; s text;
begin
  if me = '' then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'link not valid'; end if;
  select * into l from commercial_role_links
    where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and revoked_at is null and expires_at > now();
  if not found then raise exception 'link not valid'; end if;
  select slug into s from commercial_deals where id = l.deal_id;
  if public.commercial_is_owner() then return s; end if;
  select * into m from commercial_members where deal_id = l.deal_id and email = me;
  if found then
    if m.status <> 'active' then raise exception 'access removed'; end if;
    return s; -- already has a role here; a link never changes it
  end if;
  insert into commercial_members (deal_id, email, role, display_name, ntfy_topic, status, link_id)
    values (l.deal_id, me, l.role, '',
            case when l.role in ('realtor', 'reviewer', 'lender') then 'ogdeal-' || replace(gen_random_uuid()::text, '-', '') end,
            'active', l.id);
  update commercial_role_links set uses = uses + 1 where id = l.id;
  return s;
end $$;

revoke all on function public.commercial_create_role_link(uuid, text, text) from public, anon;
revoke all on function public.commercial_revoke_role_link(uuid) from public, anon;
revoke all on function public.commercial_redeem_role_link(text) from public, anon;
grant execute on function public.commercial_create_role_link(uuid, text, text) to authenticated;
grant execute on function public.commercial_revoke_role_link(uuid) to authenticated;
grant execute on function public.commercial_redeem_role_link(text) to authenticated;

commit;
