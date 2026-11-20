-- Oilgate Commercial: per-property deal pages for owner, realtor, seller (lenders later).
-- Every rule lives in row-level security. The browser only ever holds the public anon key.

create extension if not exists pg_net with schema extensions;

-- People who see everything on every deal. Filled by hand in the SQL editor, never from the app.
create table public.commercial_owners (
  email text primary key check (email = lower(email))
);

create table public.commercial_deals (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  title text not null,
  address text not null,
  -- Seller-facing copy only. Never put prices, offers or underwriting here: sellers can read this column.
  seller_content jsonb not null default jsonb_build_object(
    'headline', 'A simpler way to own this building',
    'intro', 'We put this page together so you can see, side by side, what owning the building looks like today and what a partnership with us is built to change. Nothing here is an offer. Every number gets agreed together.',
    'carry_now', jsonb_build_array(
      jsonb_build_object('label', 'Empty units', 'value', 'To confirm with you'),
      jsonb_build_object('label', 'Time on the market', 'value', 'To confirm with you'),
      jsonb_build_object('label', 'Repairs and turnovers', 'value', 'Handled and paid by you'),
      jsonb_build_object('label', 'Tenant calls', 'value', 'Come to you')
    ),
    'with_us', jsonb_build_array(
      jsonb_build_object('label', 'A steady monthly check', 'value', 'Amount to be agreed'),
      jsonb_build_object('label', 'Tenant calls', 'value', 'Handled by our team'),
      jsonb_build_object('label', 'Repairs', 'value', 'Handled by our team'),
      jsonb_build_object('label', 'A set payoff date', 'value', 'Date to be agreed')
    )
  ),
  status text not null default 'active' check (status in ('active','closed','archived')),
  created_at timestamptz not null default now()
);

create table public.commercial_members (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('realtor','seller','guest','lender')),
  display_name text not null default '',
  status text not null default 'active' check (status in ('active','revoked')),
  ntfy_topic text,
  created_at timestamptz not null default now(),
  unique (deal_id, email)
);

-- Owner-only per-deal settings (Drive folder where commercial_uploads get filed, etc.).
create table public.commercial_deal_private (
  deal_id uuid primary key references public.commercial_deals(id) on delete cascade,
  drive_folder_id text check (drive_folder_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  updated_at timestamptz not null default now()
);

-- Owner-only notes and numbers. Nobody else can read this table.
create table public.commercial_owner_notes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  body text not null check (length(body) <= 8000),
  created_at timestamptz not null default now()
);

-- team = owner + realtor (+ guests read-only). seller = owner + realtor + seller.
create table public.commercial_messages (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  channel text not null check (channel in ('team','seller')),
  author_email text not null,
  author_role text not null,
  author_name text not null default '',
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table public.commercial_uploads (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  storage_path text unique not null,
  file_name text not null,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  kind text not null check (kind in ('photo','document')),
  visibility text not null default 'team' check (visibility in ('team','seller')),
  note text not null default '' check (length(note) <= 500),
  uploaded_by_email text not null,
  uploaded_by_role text not null,
  drive_file_id text,
  created_at timestamptz not null default now()
);

create table public.commercial_interest (
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  email text not null,
  level text not null check (level in ('interested','questions','not_now')),
  updated_at timestamptz not null default now(),
  primary key (deal_id, email)
);

-- owner = owner only; team = owner + realtor; all = everyone on the deal.
create table public.commercial_activity (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  actor_email text not null,
  actor_role text not null,
  kind text not null,
  summary text not null,
  visibility text not null default 'team' check (visibility in ('owner','team','all')),
  created_at timestamptz not null default now()
);
create index on public.commercial_activity (deal_id, created_at desc);
create index on public.commercial_messages (deal_id, channel, created_at);

create table public.commercial_settings (
  key text primary key,
  value text not null
);
insert into public.commercial_settings (key, value)
values ('owner_ntfy_topic', 'ogdeal-' || replace(gen_random_uuid()::text, '-', ''));

-- ---------- helpers ----------
create or replace function public.commercial_jwt_email() returns text
language sql stable set search_path = '' as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.commercial_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from commercial_owners where email = public.commercial_jwt_email() and public.commercial_jwt_email() <> '')
$$;

create or replace function public.commercial_member_role(p_deal uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when public.commercial_is_owner() then 'owner'
    else (select role from commercial_members where deal_id = p_deal and email = public.commercial_jwt_email() and status = 'active') end
$$;

create or replace function public.commercial_my_role(p_slug text) returns text
language sql stable security definer set search_path = public as $$
  select public.commercial_member_role(id) from commercial_deals where slug = p_slug
$$;

-- ---------- row-level security ----------
alter table public.commercial_owners enable row level security;
alter table public.commercial_deals enable row level security;
alter table public.commercial_members enable row level security;
alter table public.commercial_owner_notes enable row level security;
alter table public.commercial_deal_private enable row level security;
alter table public.commercial_messages enable row level security;
alter table public.commercial_uploads enable row level security;
alter table public.commercial_interest enable row level security;
alter table public.commercial_activity enable row level security;
alter table public.commercial_settings enable row level security;

create policy owners_self on public.commercial_owners for select using (email = public.commercial_jwt_email());
create policy settings_owner on public.commercial_settings for select using (public.commercial_is_owner());

create policy deals_read on public.commercial_deals for select using (public.commercial_member_role(id) is not null);
create policy deals_owner_write on public.commercial_deals for all using (public.commercial_is_owner()) with check (public.commercial_is_owner());

create policy members_read on public.commercial_members for select
  using (public.commercial_is_owner() or email = public.commercial_jwt_email());
create policy members_owner_write on public.commercial_members for all
  using (public.commercial_is_owner()) with check (public.commercial_is_owner());

create policy private_owner on public.commercial_deal_private for all using (public.commercial_is_owner()) with check (public.commercial_is_owner());
create policy notes_owner on public.commercial_owner_notes for all using (public.commercial_is_owner()) with check (public.commercial_is_owner());

create policy messages_read on public.commercial_messages for select using (
  public.commercial_member_role(deal_id) = 'owner'
  or (channel = 'team' and public.commercial_member_role(deal_id) in ('realtor','guest'))
  or (channel = 'seller' and public.commercial_member_role(deal_id) in ('realtor','seller'))
);
create policy messages_write on public.commercial_messages for insert with check (
  author_email = public.commercial_jwt_email()
  and author_role = public.commercial_member_role(deal_id)
  and (
    public.commercial_member_role(deal_id) = 'owner'
    or (public.commercial_member_role(deal_id) = 'realtor' and channel in ('team','seller'))
    or (public.commercial_member_role(deal_id) = 'seller' and channel = 'seller')
  )
);

create policy uploads_read on public.commercial_uploads for select using (
  public.commercial_member_role(deal_id) in ('owner','realtor','guest')
  or (public.commercial_member_role(deal_id) = 'seller' and (visibility = 'seller' or uploaded_by_email = public.commercial_jwt_email()))
);
create policy uploads_write on public.commercial_uploads for insert with check (
  uploaded_by_email = public.commercial_jwt_email()
  and uploaded_by_role = public.commercial_member_role(deal_id)
  and public.commercial_member_role(deal_id) in ('owner','realtor','seller')
  and storage_path like deal_id::text || '/%'
  and (visibility = 'team' or public.commercial_member_role(deal_id) in ('owner','realtor'))
);
create policy uploads_share on public.commercial_uploads for update
  using (public.commercial_member_role(deal_id) in ('owner','realtor'))
  with check (public.commercial_member_role(deal_id) in ('owner','realtor'));

create policy interest_seller on public.commercial_interest for all
  using (email = public.commercial_jwt_email() and public.commercial_member_role(deal_id) = 'seller')
  with check (email = public.commercial_jwt_email() and public.commercial_member_role(deal_id) = 'seller');
create policy interest_team on public.commercial_interest for select
  using (public.commercial_member_role(deal_id) in ('owner','realtor'));

create policy activity_read on public.commercial_activity for select using (
  public.commercial_member_role(deal_id) = 'owner'
  or (visibility in ('team','all') and public.commercial_member_role(deal_id) in ('realtor','guest'))
  or (visibility = 'all' and public.commercial_member_role(deal_id) = 'seller')
);
-- No direct inserts: commercial_activity is written only by triggers and log_event().

-- ---------- commercial_activity + alerts ----------
create or replace function public.commercial_push_alert(p_deal uuid, p_title text, p_message text, p_visibility text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  select value into t from commercial_settings where key = 'owner_ntfy_topic';
  if t is not null then
    perform net.http_post(url := 'https://ntfy.sh', body := jsonb_build_object('topic', t, 'title', p_title, 'message', p_message));
  end if;
  if p_visibility in ('team','all') then
    for t in select ntfy_topic from commercial_members
      where deal_id = p_deal and role = 'realtor' and status = 'active' and ntfy_topic is not null and email <> public.commercial_jwt_email()
    loop
      perform net.http_post(url := 'https://ntfy.sh', body := jsonb_build_object('topic', t, 'title', p_title, 'message', p_message));
    end loop;
  end if;
end $$;

create or replace function public.commercial_record(p_deal uuid, p_kind text, p_summary text, p_visibility text)
returns void language plpgsql security definer set search_path = public as $$
declare r text := coalesce(public.commercial_member_role(p_deal), 'system'); t text;
begin
  insert into commercial_activity (deal_id, actor_email, actor_role, kind, summary, visibility)
  values (p_deal, public.commercial_jwt_email(), r, p_kind, p_summary, p_visibility);
  select title into t from commercial_deals where id = p_deal;
  if r <> 'owner' then
    perform public.commercial_push_alert(p_deal, coalesce(t, 'Oilgate Commercial'), p_summary, p_visibility);
  end if;
end $$;

create or replace function public.commercial_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.commercial_record(new.deal_id, 'message',
    initcap(new.author_role) || case when new.channel = 'seller' then ' wrote in the seller thread: ' else ' wrote to the team: ' end || left(new.body, 140),
    'team');
  return new;
end $$;
create trigger commercial_messages_activity after insert on public.commercial_messages for each row execute function public.commercial_on_message();

create or replace function public.commercial_on_upload() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.commercial_record(new.deal_id, 'upload',
    initcap(new.uploaded_by_role) || ' uploaded ' || case when new.kind = 'photo' then 'a photo: ' else 'a document: ' end || new.file_name,
    'team');
  return new;
end $$;
create trigger commercial_uploads_activity after insert on public.commercial_uploads for each row execute function public.commercial_on_upload();

create or replace function public.commercial_on_interest() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.commercial_record(new.deal_id, 'interest',
    'Seller marked: ' || case new.level when 'interested' then 'interested in talking' when 'questions' then 'has questions first' else 'not right now' end,
    'team');
  return new;
end $$;
create trigger commercial_interest_activity after insert or update on public.commercial_interest for each row execute function public.commercial_on_interest();

-- Page views, at most one per person per deal per hour, so alerts stay quiet.
create or replace function public.commercial_log_view(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare d uuid; r text;
begin
  select id into d from commercial_deals where slug = p_slug;
  r := public.commercial_member_role(d);
  if d is null or r is null or r = 'owner' then return; end if;
  if exists (select 1 from commercial_activity where deal_id = d and actor_email = public.commercial_jwt_email() and kind = 'view' and created_at > now() - interval '1 hour') then return; end if;
  perform public.commercial_record(d, 'view', initcap(r) || ' opened the deal page', 'team');
end $$;

revoke execute on function public.commercial_push_alert(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.commercial_record(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.commercial_my_role(text), public.commercial_log_view(text) to authenticated;

-- ---------- file storage (private) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('commercial-files', 'commercial-files', false, 20971520) on conflict (id) do nothing;

create policy commercial_files_read on storage.objects for select to authenticated using (
  case when bucket_id = 'commercial-files' then exists (select 1 from public.commercial_uploads u where u.storage_path = storage.objects.name) else false end
);
-- CASE keeps this from ever evaluating (or failing) on other apps' buckets in a shared project.
create policy commercial_files_write on storage.objects for insert to authenticated with check (
  case when bucket_id = 'commercial-files' and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.commercial_member_role(((storage.foldername(name))[1])::uuid) in ('owner','realtor','seller')
    else false end
);

-- ---------- first deal (more are added from the owner page) ----------
insert into public.commercial_deals (slug, title, address) values
  ('charlotte', '23-27 Charlotte St', '23-27 Charlotte St, Akron, OH 44303');

-- Live updates on the pages (still filtered by row-level security).
alter publication supabase_realtime add table public.commercial_messages, public.commercial_activity, public.commercial_uploads;

-- Signed-out visitors can't call any of these.
revoke execute on function public.commercial_is_owner(), public.commercial_member_role(uuid),
  public.commercial_my_role(text), public.commercial_log_view(text) from public, anon;
grant execute on function public.commercial_is_owner(), public.commercial_member_role(uuid),
  public.commercial_my_role(text), public.commercial_log_view(text) to authenticated;
