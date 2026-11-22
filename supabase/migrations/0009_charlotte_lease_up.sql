-- Charlotte v5: additive, scoped CRM and private media. No example or strategy content.
begin;

create function public.commercial_charlotte_lease_role(p_deal uuid) returns text
language sql stable set search_path = '' as $$
  select public.commercial_member_role(d.id)
  from public.commercial_deals d where d.id = p_deal and d.slug = 'charlotte'
$$;
revoke all on function public.commercial_charlotte_lease_role(uuid) from public, anon;
grant execute on function public.commercial_charlotte_lease_role(uuid) to authenticated;

create table public.commercial_tenant_leads (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 140),
  contact text not null default '' check (char_length(contact) <= 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  stage text not null default 'new_lead' check (stage in ('new_lead','contacted','showing','applied','approved','moved_in')),
  unit_number smallint check (unit_number between 1 and 10),
  created_at timestamptz not null default now(),
  check ((stage = 'moved_in') = (unit_number is not null))
);
create index commercial_tenant_lead_deal_stage on public.commercial_tenant_leads(deal_id, stage);
create unique index commercial_tenant_occupied_unit on public.commercial_tenant_leads(deal_id, unit_number) where stage = 'moved_in';

create table public.commercial_walkthrough_voice (
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  unit_number smallint not null check (unit_number between 1 and 10),
  room text not null check (room in ('kitchen','bath','bedroom_1','bedroom_2','living')),
  storage_path text not null unique,
  raw_transcript text not null check (char_length(btrim(raw_transcript)) between 1 and 12000),
  primary key (deal_id, unit_number, room),
  check (split_part(storage_path, '/', 1) = 'commercial-lease-up'
    and split_part(storage_path, '/', 2) = deal_id::text
    and split_part(storage_path, '/', 3) = 'walkthrough'
    and split_part(storage_path, '/', 5) ~ '^[0-9a-f-]{36}\.(webm|ogg|m4a|wav)$')
);

create table public.commercial_lease_photos (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  kind text not null check (kind in ('walkthrough','realtor')),
  author_uid uuid not null default auth.uid(),
  unit_number smallint check (unit_number between 1 and 10),
  room text check (room in ('kitchen','bath','bedroom_1','bedroom_2','living')),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  check ((kind = 'walkthrough' and unit_number is not null and room is not null)
    or (kind = 'realtor' and unit_number is null and room is null)),
  check (split_part(storage_path, '/', 2) = deal_id::text
    and split_part(storage_path, '/', 1) = 'commercial-lease-up'
    and split_part(storage_path, '/', 3) = kind
    and split_part(storage_path, '/', 4) = author_uid::text
    and split_part(storage_path, '/', 5) ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$')
);
create index commercial_lease_photo_room_index on public.commercial_lease_photos(deal_id, kind, unit_number, room);

create table public.commercial_realtor_notes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  author_uid uuid not null default auth.uid(),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table public.commercial_strategy_ideas (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table public.commercial_comps (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  address text not null check (char_length(btrim(address)) between 1 and 240),
  units integer not null check (units between 1 and 10000),
  sale_price numeric(14,2) not null check (sale_price > 0 and sale_price < 1000000000000),
  created_at timestamptz not null default now()
);

-- Use the actual owner's model switch, never a reviewer/realtor local what-if.
-- When the switch is lowered, keep historical unit-10 records; block new changes to that unit.
create function public.commercial_lease_valid_unit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.unit_number = 10 and not exists (
    select 1 from public.commercial_models m where m.deal_id = new.deal_id and m.base->>'units' = '10'
  ) then
    raise exception 'Unit 10 is not enabled by the owner' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.commercial_lease_valid_unit() from public, anon;

create trigger commercial_tenant_valid_unit before insert or update of unit_number, deal_id
on public.commercial_tenant_leads for each row execute function public.commercial_lease_valid_unit();
create trigger commercial_walkthrough_valid_unit before insert or update of unit_number, deal_id
on public.commercial_walkthrough_voice for each row execute function public.commercial_lease_valid_unit();
create trigger commercial_photo_valid_unit before insert or update of unit_number, deal_id
on public.commercial_lease_photos for each row execute function public.commercial_lease_valid_unit();

alter table public.commercial_tenant_leads enable row level security;
alter table public.commercial_walkthrough_voice enable row level security;
alter table public.commercial_lease_photos enable row level security;
alter table public.commercial_realtor_notes enable row level security;
alter table public.commercial_strategy_ideas enable row level security;
alter table public.commercial_comps enable row level security;

revoke all on public.commercial_tenant_leads, public.commercial_walkthrough_voice, public.commercial_lease_photos,
  public.commercial_realtor_notes, public.commercial_strategy_ideas, public.commercial_comps from anon, authenticated;
grant select, insert, update, delete on public.commercial_tenant_leads, public.commercial_walkthrough_voice,
  public.commercial_lease_photos, public.commercial_realtor_notes, public.commercial_strategy_ideas, public.commercial_comps to authenticated;

create policy commercial_tenant_owner_all on public.commercial_tenant_leads for all to authenticated
using (public.commercial_charlotte_lease_role(deal_id) = 'owner') with check (public.commercial_charlotte_lease_role(deal_id) = 'owner');
create policy commercial_tenant_realtor_read on public.commercial_tenant_leads for select to authenticated
using (public.commercial_charlotte_lease_role(deal_id) in ('realtor','reviewer'));
create policy commercial_tenant_realtor_insert on public.commercial_tenant_leads for insert to authenticated
with check (public.commercial_charlotte_lease_role(deal_id) = 'realtor');
create policy commercial_tenant_realtor_update on public.commercial_tenant_leads for update to authenticated
using (public.commercial_charlotte_lease_role(deal_id) = 'realtor') with check (public.commercial_charlotte_lease_role(deal_id) = 'realtor');

create policy commercial_walkthrough_owner_all on public.commercial_walkthrough_voice for all to authenticated
using (public.commercial_charlotte_lease_role(deal_id) = 'owner') with check (public.commercial_charlotte_lease_role(deal_id) = 'owner');
create policy commercial_walkthrough_team_read on public.commercial_walkthrough_voice for select to authenticated
using (public.commercial_charlotte_lease_role(deal_id) in ('realtor','reviewer'));
create policy commercial_walkthrough_realtor_insert on public.commercial_walkthrough_voice for insert to authenticated
with check (public.commercial_charlotte_lease_role(deal_id) = 'realtor' and split_part(storage_path, '/', 4) = auth.uid()::text);
create policy commercial_walkthrough_realtor_update on public.commercial_walkthrough_voice for update to authenticated
using (public.commercial_charlotte_lease_role(deal_id) = 'realtor')
with check (public.commercial_charlotte_lease_role(deal_id) = 'realtor' and split_part(storage_path, '/', 4) = auth.uid()::text);

create policy commercial_lease_photos_owner_all on public.commercial_lease_photos for all to authenticated
using (public.commercial_charlotte_lease_role(deal_id) = 'owner') with check (public.commercial_charlotte_lease_role(deal_id) = 'owner');
create policy commercial_lease_photos_team_read on public.commercial_lease_photos for select to authenticated
using ((kind = 'walkthrough' and public.commercial_charlotte_lease_role(deal_id) in ('realtor','reviewer'))
  or (kind = 'realtor' and public.commercial_charlotte_lease_role(deal_id) = 'realtor' and author_uid = auth.uid()));
create policy commercial_lease_photos_realtor_own on public.commercial_lease_photos for all to authenticated
using (public.commercial_charlotte_lease_role(deal_id) = 'realtor' and author_uid = auth.uid())
with check (public.commercial_charlotte_lease_role(deal_id) = 'realtor' and author_uid = auth.uid());

create policy commercial_realtor_notes_owner_all on public.commercial_realtor_notes for all to authenticated
using (public.commercial_charlotte_lease_role(deal_id) = 'owner') with check (public.commercial_charlotte_lease_role(deal_id) = 'owner');
create policy commercial_realtor_notes_own on public.commercial_realtor_notes for all to authenticated
using (public.commercial_charlotte_lease_role(deal_id) = 'realtor' and author_uid = auth.uid())
with check (public.commercial_charlotte_lease_role(deal_id) = 'realtor' and author_uid = auth.uid());

create policy commercial_strategy_ideas_owner_only on public.commercial_strategy_ideas for all to authenticated
using (public.commercial_charlotte_lease_role(deal_id) = 'owner') with check (public.commercial_charlotte_lease_role(deal_id) = 'owner');
create policy commercial_comps_owner_all on public.commercial_comps for all to authenticated
using (public.commercial_charlotte_lease_role(deal_id) = 'owner') with check (public.commercial_charlotte_lease_role(deal_id) = 'owner');
create policy commercial_comps_read_team on public.commercial_comps for select to authenticated
using (public.commercial_charlotte_lease_role(deal_id) in ('realtor','reviewer'));

-- Use a dedicated root, not the pre-v5 <deal-uuid>/ upload root. A legacy
-- uploader cannot mint storage objects or upload metadata for this namespace.
create function public.commercial_lease_storage_writer(p_name text, p_owns_path boolean) returns boolean
language sql stable set search_path = '' as $$
  select case when p_name ~ '^commercial-lease-up/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(walkthrough|realtor)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(jpg|png|webp|webm|ogg|m4a|wav)$'
    then case public.commercial_charlotte_lease_role(split_part(p_name, '/', 2)::uuid)
      when 'owner' then not p_owns_path or split_part(p_name, '/', 4) = auth.uid()::text
      when 'realtor' then split_part(p_name, '/', 4) = auth.uid()::text
      else false end
    else false end
$$;
revoke all on function public.commercial_lease_storage_writer(text,boolean) from public, anon;
grant execute on function public.commercial_lease_storage_writer(text,boolean) to authenticated;

create policy commercial_lease_files_select on storage.objects for select to authenticated using (
  bucket_id = 'commercial-files' and (
    public.commercial_lease_storage_writer(name, false)
    or exists (select 1 from public.commercial_lease_photos p where p.storage_path = storage.objects.name)
    or exists (select 1 from public.commercial_walkthrough_voice v where v.storage_path = storage.objects.name)
  )
);
create policy commercial_lease_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'commercial-files' and public.commercial_lease_storage_writer(name, true)
);
create policy commercial_lease_files_update on storage.objects for update to authenticated
using (bucket_id = 'commercial-files' and public.commercial_lease_storage_writer(name, false))
with check (bucket_id = 'commercial-files' and public.commercial_lease_storage_writer(name, false));
create policy commercial_lease_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'commercial-files' and public.commercial_lease_storage_writer(name, false)
);

commit;
