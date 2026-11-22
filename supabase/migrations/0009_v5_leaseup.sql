-- v5: lease-up CRM (walkthrough inventory, tenant pipeline, owner-only strategy ideas, comps/ARV).
-- Additive and strictly namespaced to commercial_* tables, functions, triggers and policies.
-- No strategy card content or deal data is seeded in this public migration.
begin;

create or replace function public.commercial_v5_valid_unit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.unit_number = 10 and not exists (
    select 1 from public.commercial_models m
    where m.deal_id = new.deal_id and m.base->>'units' = '10'
  ) then
    raise exception 'Unit 10 is not enabled by the owner' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.commercial_v5_valid_unit() from public, anon;

-- 1. Walkthrough room photos (owner + realtor only)
create table public.commercial_walkthrough_photos (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  unit_number smallint not null check (unit_number between 1 and 10),
  room text not null check (room in ('kitchen','bath','bedroom_1','bedroom_2','living')),
  storage_path text not null unique,
  author_uid uuid not null default auth.uid(),
  author_role text not null check (author_role in ('owner','realtor')),
  author_name text not null default '' check (char_length(author_name) <= 120),
  created_at timestamptz not null default now(),
  check (
    split_part(storage_path, '/', 1) = 'commercial-v5'
    and split_part(storage_path, '/', 2) = deal_id::text
    and split_part(storage_path, '/', 3) = 'walkthrough'
    and split_part(storage_path, '/', 4) = author_uid::text
    and split_part(storage_path, '/', 5) ~ '^[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic)$'
  )
);
create index commercial_walkthrough_photos_idx on public.commercial_walkthrough_photos(deal_id, unit_number, room, created_at);

create trigger commercial_walkthrough_photos_unit_check
  before insert or update of unit_number, deal_id on public.commercial_walkthrough_photos
  for each row execute function public.commercial_v5_valid_unit();

-- 2. Walkthrough room voice notes (owner + realtor only; raw transcript + nullable polished column for later AI)
create table public.commercial_walkthrough_notes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  unit_number smallint not null check (unit_number between 1 and 10),
  room text not null check (room in ('kitchen','bath','bedroom_1','bedroom_2','living')),
  raw_transcript text not null check (char_length(btrim(raw_transcript)) between 1 and 12000),
  polished text,
  storage_path text unique,
  author_uid uuid not null default auth.uid(),
  author_role text not null check (author_role in ('owner','realtor')),
  author_name text not null default '' check (char_length(author_name) <= 120),
  created_at timestamptz not null default now(),
  check (
    storage_path is null or (
      split_part(storage_path, '/', 1) = 'commercial-v5'
      and split_part(storage_path, '/', 2) = deal_id::text
      and split_part(storage_path, '/', 3) = 'walkthrough'
      and split_part(storage_path, '/', 4) = author_uid::text
      and split_part(storage_path, '/', 5) ~ '^[0-9a-f-]{36}\.(webm|ogg|m4a|mp4|wav)$'
    )
  )
);
create index commercial_walkthrough_notes_idx on public.commercial_walkthrough_notes(deal_id, unit_number, room, created_at);

create trigger commercial_walkthrough_notes_unit_check
  before insert or update of unit_number, deal_id on public.commercial_walkthrough_notes
  for each row execute function public.commercial_v5_valid_unit();

-- 3. Tenant pipeline leads (owner + realtor only; private contact details)
create table public.commercial_tenant_leads (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 140),
  phone text not null default '' check (char_length(phone) <= 60),
  email text not null default '' check (char_length(email) <= 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  stage text not null default 'new_lead' check (stage in ('new_lead','contacted','showing','applied','approved','moved_in')),
  unit_number smallint check (unit_number between 1 and 10),
  author_uid uuid not null default auth.uid(),
  author_role text not null default 'owner' check (author_role in ('owner','realtor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((stage = 'moved_in') = (unit_number is not null))
);
create index commercial_tenant_leads_stage_idx on public.commercial_tenant_leads(deal_id, stage);
create unique index commercial_tenant_occupied_unit_idx on public.commercial_tenant_leads(deal_id, unit_number) where stage = 'moved_in';

create trigger commercial_tenant_leads_unit_check
  before insert or update of unit_number, deal_id on public.commercial_tenant_leads
  for each row execute function public.commercial_v5_valid_unit();

-- 4. Owner-only Strategy ideas (never visible to any other role or preview)
create table public.commercial_strategy_ideas (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 6000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index commercial_strategy_ideas_deal_idx on public.commercial_strategy_ideas(deal_id, created_at);

-- 5. Comps & owner cap-rate setting (owner writes; owner, realtor and reviewer read)
create table public.commercial_comps (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  address text not null check (char_length(btrim(address)) between 1 and 240),
  units integer not null check (units between 1 and 10000),
  sale_price numeric(14,2) not null check (sale_price > 0 and sale_price < 1000000000000),
  created_at timestamptz not null default now()
);
create index commercial_comps_deal_idx on public.commercial_comps(deal_id, created_at);

create table public.commercial_comp_settings (
  deal_id uuid primary key references public.commercial_deals(id) on delete cascade,
  cap_rate numeric(4,2) not null default 9.00 check (cap_rate >= 8.00 and cap_rate <= 10.00),
  updated_at timestamptz not null default now()
);

-- Enable RLS and lock down grants on all v5 tables
alter table public.commercial_walkthrough_photos enable row level security;
alter table public.commercial_walkthrough_notes enable row level security;
alter table public.commercial_tenant_leads enable row level security;
alter table public.commercial_strategy_ideas enable row level security;
alter table public.commercial_comps enable row level security;
alter table public.commercial_comp_settings enable row level security;

revoke all on
  public.commercial_walkthrough_photos,
  public.commercial_walkthrough_notes,
  public.commercial_tenant_leads,
  public.commercial_strategy_ideas,
  public.commercial_comps,
  public.commercial_comp_settings
from anon, authenticated;

grant select, insert, update, delete on
  public.commercial_walkthrough_photos,
  public.commercial_walkthrough_notes,
  public.commercial_tenant_leads,
  public.commercial_strategy_ideas,
  public.commercial_comps,
  public.commercial_comp_settings
to authenticated;

-- Walkthrough photos policies: owner + realtor ONLY
create policy commercial_walkthrough_photos_owner_all on public.commercial_walkthrough_photos
  for all to authenticated
  using (public.commercial_member_role(deal_id) = 'owner')
  with check (public.commercial_member_role(deal_id) = 'owner' and author_role = 'owner' and author_uid = auth.uid());

create policy commercial_walkthrough_photos_realtor_read on public.commercial_walkthrough_photos
  for select to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor');

create policy commercial_walkthrough_photos_realtor_insert on public.commercial_walkthrough_photos
  for insert to authenticated
  with check (public.commercial_member_role(deal_id) = 'realtor' and author_role = 'realtor' and author_uid = auth.uid());

create policy commercial_walkthrough_photos_realtor_delete on public.commercial_walkthrough_photos
  for delete to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor' and author_uid = auth.uid());

-- Walkthrough voice notes policies: owner + realtor ONLY
create policy commercial_walkthrough_notes_owner_all on public.commercial_walkthrough_notes
  for all to authenticated
  using (public.commercial_member_role(deal_id) = 'owner')
  with check (public.commercial_member_role(deal_id) = 'owner' and author_role = 'owner' and author_uid = auth.uid());

create policy commercial_walkthrough_notes_realtor_read on public.commercial_walkthrough_notes
  for select to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor');

create policy commercial_walkthrough_notes_realtor_insert on public.commercial_walkthrough_notes
  for insert to authenticated
  with check (public.commercial_member_role(deal_id) = 'realtor' and author_role = 'realtor' and author_uid = auth.uid());

create policy commercial_walkthrough_notes_realtor_own_update on public.commercial_walkthrough_notes
  for update to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor' and author_uid = auth.uid())
  with check (public.commercial_member_role(deal_id) = 'realtor' and author_role = 'realtor' and author_uid = auth.uid());

create policy commercial_walkthrough_notes_realtor_own_delete on public.commercial_walkthrough_notes
  for delete to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor' and author_uid = auth.uid());

-- Tenant leads policies: owner + realtor ONLY (seller, reviewer, lender, viewer get zero rows)
create policy commercial_tenant_leads_owner_all on public.commercial_tenant_leads
  for all to authenticated
  using (public.commercial_member_role(deal_id) = 'owner')
  with check (public.commercial_member_role(deal_id) = 'owner');

create policy commercial_tenant_leads_realtor_all on public.commercial_tenant_leads
  for all to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor')
  with check (public.commercial_member_role(deal_id) = 'realtor');

-- Strategy ideas policies: owner ONLY
create policy commercial_strategy_ideas_owner_only on public.commercial_strategy_ideas
  for all to authenticated
  using (public.commercial_member_role(deal_id) = 'owner')
  with check (public.commercial_member_role(deal_id) = 'owner');

-- Comps & cap-rate policies: owner writes; owner, realtor, reviewer read (lender, seller, viewer get zero rows)
create policy commercial_comps_owner_all on public.commercial_comps
  for all to authenticated
  using (public.commercial_member_role(deal_id) = 'owner')
  with check (public.commercial_member_role(deal_id) = 'owner');

create policy commercial_comps_team_read on public.commercial_comps
  for select to authenticated
  using (public.commercial_member_role(deal_id) in ('realtor','reviewer'));

create policy commercial_comp_settings_owner_all on public.commercial_comp_settings
  for all to authenticated
  using (public.commercial_member_role(deal_id) = 'owner')
  with check (public.commercial_member_role(deal_id) = 'owner');

create policy commercial_comp_settings_team_read on public.commercial_comp_settings
  for select to authenticated
  using (public.commercial_member_role(deal_id) in ('realtor','reviewer'));

-- Dedicated storage namespace in commercial-files: commercial-v5/<deal_id>/walkthrough/<author_uid>/<uuid>.<ext>
-- Owner and realtor read all walkthrough media for the deal; realtor writes/deletes only under her own uid folder.
create or replace function public.commercial_v5_storage_access(p_name text, p_mode text) returns boolean
language sql stable set search_path = '' as $$
  select case
    when p_name ~ '^commercial-v5/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/walkthrough/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|webm|ogg|m4a|mp4|wav)$'
    then case public.commercial_member_role(split_part(p_name, '/', 2)::uuid)
      when 'owner' then
        case p_mode
          when 'insert' then split_part(p_name, '/', 4) = auth.uid()::text
          else true
        end
      when 'realtor' then
        case p_mode
          when 'read' then true
          else split_part(p_name, '/', 4) = auth.uid()::text
        end
      else false
    end
    else false
  end
$$;
revoke all on function public.commercial_v5_storage_access(text, text) from public, anon;
grant execute on function public.commercial_v5_storage_access(text, text) to authenticated;

create policy commercial_v5_files_select on storage.objects for select to authenticated using (
  bucket_id = 'commercial-files' and public.commercial_v5_storage_access(name, 'read')
);
create policy commercial_v5_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'commercial-files' and public.commercial_v5_storage_access(name, 'insert')
);
create policy commercial_v5_files_update on storage.objects for update to authenticated
  using (bucket_id = 'commercial-files' and public.commercial_v5_storage_access(name, 'write'))
  with check (bucket_id = 'commercial-files' and public.commercial_v5_storage_access(name, 'write'));
create policy commercial_v5_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'commercial-files' and public.commercial_v5_storage_access(name, 'write')
);

commit;
