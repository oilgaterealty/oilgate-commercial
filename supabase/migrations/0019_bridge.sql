-- Phase 1: owner snapshot only. No business-data write RPC.
begin;
create table public.commercial_bridge_tokens (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id),
  label text not null check (length(label) between 1 and 80),
  scope text not null check (scope = 'superlab_owner'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  calls bigint not null default 0,
  window_started_at timestamptz not null default now(),
  window_calls integer not null default 0
);
alter table public.commercial_bridge_tokens enable row level security;
revoke all on public.commercial_bridge_tokens from public, anon, authenticated;

create table public.commercial_erwin_facts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id),
  key text not null check (length(key) between 1 and 100),
  value jsonb not null,
  source text not null,
  as_of date not null,
  version integer not null check (version > 0),
  author text not null,
  created_at timestamptz not null default now(),
  unique(deal_id, key, version)
);
alter table public.commercial_erwin_facts enable row level security;
revoke all on public.commercial_erwin_facts from public, anon, authenticated;
grant select on public.commercial_erwin_facts to authenticated;
create policy commercial_erwin_facts_owner_read on public.commercial_erwin_facts
  for select to authenticated using (public.commercial_is_owner());

create function public.commercial_bridge_snapshot(p_token text, p_slug text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  bridge public.commercial_bridge_tokens;
  did uuid;
begin
  if p_token is null or length(p_token) <> 64 or p_token !~ '^[a-f0-9]{64}$'
     or p_slug is distinct from 'charlotte' then return null; end if;
  select t.* into bridge from public.commercial_bridge_tokens t
    join public.commercial_deals d on d.id = t.deal_id
    where t.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
      and t.active and t.scope = 'superlab_owner' and d.slug = p_slug
    for update of t;
  if not found then return null; end if;
  -- Serialize revocation and cap accepted requests without rejecting normal reloads/tabs.
  if bridge.window_started_at > clock_timestamp() - interval '1 minute' and bridge.window_calls >= 60 then return null; end if;
  did := bridge.deal_id;
  update public.commercial_bridge_tokens set last_used_at = clock_timestamp(), calls = calls + 1,
    window_calls = case when window_started_at <= clock_timestamp() - interval '1 minute' then 1 else window_calls + 1 end,
    window_started_at = case when window_started_at <= clock_timestamp() - interval '1 minute' then clock_timestamp() else window_started_at end
    where id = bridge.id;
  return jsonb_build_object(
    'deal', (select to_jsonb(d) from public.commercial_deals d where d.id = did),
    'models', (select jsonb_build_object('base', m.base, 'updated_at', m.updated_at) from public.commercial_models m where m.deal_id = did),
    'offers', coalesce((select jsonb_agg(to_jsonb(o) order by o.sort, o.id) from public.commercial_offers o where o.deal_id = did), '[]'::jsonb),
    'seller_loans', (select to_jsonb(l) from public.commercial_seller_loans l where l.deal_id = did),
    'work_items', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at desc) from public.commercial_work_items w where w.deal_id = did), '[]'::jsonb),
    'owner_notes', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc) from public.commercial_owner_notes n where n.deal_id = did), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from
      (select distinct on (m.conversation_id, m.channel) m.* from public.commercial_messages m
       where m.deal_id = did order by m.conversation_id, m.channel, m.created_at desc, m.id) q), '[]'::jsonb),
    'conversations', coalesce((select jsonb_agg(to_jsonb(c)) from public.commercial_conversations c where c.deal_id = did), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from
      (select * from public.commercial_activity where deal_id = did order by created_at desc, id limit 50) a), '[]'::jsonb),
    'uploads', coalesce((select jsonb_agg(to_jsonb(u) order by u.created_at desc) from
      (select id, file_name, mime, size_bytes, kind, note, created_at from public.commercial_uploads
       where deal_id = did order by created_at desc, id limit 100) u), '[]'::jsonb),
    'interest', coalesce((select jsonb_agg(to_jsonb(i)) from public.commercial_interest i where i.deal_id = did), '[]'::jsonb),
    'erwin_facts', coalesce((select jsonb_agg(to_jsonb(f)) from
      (select distinct on (key) * from public.commercial_erwin_facts where deal_id = did order by key, version desc) f), '[]'::jsonb),
    'synced_at', clock_timestamp()
  );
end $$;
revoke all on function public.commercial_bridge_snapshot(text, text) from public, anon, authenticated;
grant execute on function public.commercial_bridge_snapshot(text, text) to anon;
notify pgrst, 'reload schema';
commit;
