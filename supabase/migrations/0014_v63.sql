-- v6.3: per-unit photos for every role except the seller, video transcript + frames, comps detail and picks,
-- strategy ideas for the realtor, unit notes, a shared lender terms board, realtor tenant leads.
-- Additive and idempotent. Scoped to commercial_* objects and the commercial-files bucket. No data is changed or deleted.
begin;

-- 1. Walkthrough photos and videos: lender, reviewer and viewer read all of their deal's walkthrough (read only).
--    The seller keeps reading only rows shared with the seller (existing *_seller_shared policies are unchanged).
drop policy if exists commercial_walkthrough_photos_team_read on public.commercial_walkthrough_photos;
create policy commercial_walkthrough_photos_team_read on public.commercial_walkthrough_photos
  for select to authenticated
  using (public.commercial_member_role(deal_id) in ('lender','reviewer','viewer','guest'));

drop policy if exists commercial_walkthrough_videos_team_read on public.commercial_walkthrough_videos;
create policy commercial_walkthrough_videos_team_read on public.commercial_walkthrough_videos
  for select to authenticated
  using (public.commercial_member_role(deal_id) in ('lender','reviewer','viewer','guest'));

-- 2. Videos keep a transcript and three still frames (paths of small JPEGs in the author's walkthrough folder).
alter table public.commercial_walkthrough_videos
  add column if not exists transcript text check (transcript is null or char_length(transcript) <= 12000),
  add column if not exists transcript_status text check (transcript_status is null or transcript_status in ('pending','ready','failed','none')),
  add column if not exists frame_paths jsonb not null default '[]'::jsonb check (jsonb_typeof(frame_paths) = 'array' and jsonb_array_length(frame_paths) <= 3);

-- The owner already updates any video (commercial_walkthrough_videos_owner_update) and the realtor her own
-- (commercial_walkthrough_videos_realtor_move). The v6.1 guard stays: it still blocks re-attribution,
-- non-owner share changes and bad moves; transcript and frame columns are free for those two updaters.
-- Frames must live in the same author's walkthrough folder as the video.
create or replace function public.commercial_walk_frames_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p text;
begin
  for p in select jsonb_array_elements_text(new.frame_paths) loop
    if split_part(p, '/', 1) <> 'commercial-v5' or split_part(p, '/', 2) <> new.deal_id::text
       or split_part(p, '/', 3) <> 'walkthrough' or split_part(p, '/', 4) <> new.author_uid::text
       or split_part(p, '/', 5) !~ '^[0-9a-f-]{36}\.jpg$' then
      raise exception 'Video frames must be JPEGs in the author''s walkthrough folder';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.commercial_walk_frames_guard() from public, anon, authenticated;
drop trigger if exists commercial_walk_frames_guard on public.commercial_walkthrough_videos;
create trigger commercial_walk_frames_guard before insert or update of frame_paths on public.commercial_walkthrough_videos
  for each row execute function public.commercial_walk_frames_guard();

-- 3. Storage follows the rows: lender, reviewer and viewer read walkthrough photos, videos and video frames;
--    the seller reads only what is shared with the seller (and frames of shared videos). Nobody new may write.
create or replace function public.commercial_v5_storage_access(p_name text, p_mode text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare d uuid; r text;
begin
  if p_name !~ '^commercial-v5/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/walkthrough/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|webm|ogg|m4a|mp4|wav|mov|m4v)$' then
    return false;
  end if;
  d := split_part(p_name, '/', 2)::uuid;
  r := public.commercial_member_role(d);
  if r = 'owner' then
    return p_mode <> 'insert' or split_part(p_name, '/', 4) = auth.uid()::text;
  end if;
  if r = 'realtor' then
    if split_part(p_name, '/', 4) = auth.uid()::text then return true; end if;
    if p_mode <> 'read' then return false; end if;
    return exists (select 1 from public.commercial_walkthrough_photos where deal_id = d and storage_path = p_name)
      or exists (select 1 from public.commercial_walkthrough_videos where deal_id = d and (storage_path = p_name or frame_paths ? p_name))
      or exists (select 1 from public.commercial_walkthrough_notes where deal_id = d and storage_path = p_name and author_role = 'realtor');
  end if;
  if r in ('lender','reviewer','viewer','guest') and p_mode = 'read' then
    return exists (select 1 from public.commercial_walkthrough_photos where deal_id = d and storage_path = p_name)
      or exists (select 1 from public.commercial_walkthrough_videos where deal_id = d and (storage_path = p_name or frame_paths ? p_name));
  end if;
  if r = 'seller' and p_mode = 'read' then
    return exists (select 1 from public.commercial_walkthrough_photos where deal_id = d and storage_path = p_name and share_seller)
      or exists (select 1 from public.commercial_walkthrough_videos where deal_id = d and (storage_path = p_name or frame_paths ? p_name) and share_seller);
  end if;
  return false;
end $$;
revoke all on function public.commercial_v5_storage_access(text, text) from public, anon;
grant execute on function public.commercial_v5_storage_access(text, text) to authenticated;

-- 4. Tenant leads: the realtor adds her own leads (re-stated so this file alone is enough); edits/deletes only her own.
drop policy if exists commercial_tenant_leads_realtor_insert on public.commercial_tenant_leads;
create policy commercial_tenant_leads_realtor_insert on public.commercial_tenant_leads
  for insert to authenticated
  with check (public.commercial_member_role(deal_id) = 'realtor' and author_role = 'realtor' and author_uid = auth.uid());

-- 5. Comps: more detail, where each one came from, and per-person picks.
alter table public.commercial_comps
  add column if not exists city text check (city is null or char_length(city) <= 120),
  add column if not exists submarket text check (submarket is null or char_length(submarket) <= 120),
  add column if not exists bldg_sf integer check (bldg_sf is null or bldg_sf between 1 and 100000000),
  add column if not exists asking numeric check (asking is null or (asking > 0 and asking < 1000000000000)),
  add column if not exists acres numeric check (acres is null or (acres > 0 and acres < 1000000)),
  add column if not exists pct_leased numeric check (pct_leased is null or (pct_leased >= 0 and pct_leased <= 100)),
  add column if not exists distance_mi numeric check (distance_mi is null or (distance_mi >= 0 and distance_mi < 20000)),
  add column if not exists source_kind text check (source_kind is null or source_kind in ('ai','broker','user')),
  add column if not exists added_by_role text check (added_by_role is null or added_by_role in ('owner','realtor','reviewer'));

create table if not exists public.commercial_comp_picks (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  comp_id uuid not null references public.commercial_comps(id) on delete cascade,
  picker_uid uuid not null default auth.uid(),
  picker_role text not null check (picker_role in ('owner','realtor','reviewer')),
  picker_name text not null default '' check (char_length(picker_name) <= 120),
  created_at timestamptz not null default now(),
  unique (comp_id, picker_uid)
);
create index if not exists commercial_comp_picks_deal_idx on public.commercial_comp_picks(deal_id, comp_id);
alter table public.commercial_comp_picks enable row level security;
revoke all on public.commercial_comp_picks from anon, authenticated;
grant select, insert, delete on public.commercial_comp_picks to authenticated;

-- Each member picks for themselves; the owner sees everyone's picks; nobody else sees anyone else's.
drop policy if exists commercial_comp_picks_own_select on public.commercial_comp_picks;
create policy commercial_comp_picks_own_select on public.commercial_comp_picks
  for select to authenticated
  using (picker_uid = auth.uid() or public.commercial_member_role(deal_id) = 'owner');
drop policy if exists commercial_comp_picks_own_insert on public.commercial_comp_picks;
create policy commercial_comp_picks_own_insert on public.commercial_comp_picks
  for insert to authenticated
  with check (
    picker_uid = auth.uid()
    and picker_role = public.commercial_member_role(deal_id)
    and public.commercial_member_role(deal_id) in ('owner','realtor','reviewer')
    and exists (select 1 from public.commercial_comps c where c.id = comp_id and c.deal_id = commercial_comp_picks.deal_id)
  );
drop policy if exists commercial_comp_picks_own_delete on public.commercial_comp_picks;
create policy commercial_comp_picks_own_delete on public.commercial_comp_picks
  for delete to authenticated
  using (picker_uid = auth.uid());

-- 6. Strategy ideas: the owner keeps full control (commercial_strategy_ideas_owner_only, unchanged);
--    the realtor reads all, adds her own and deletes only her own. No other role.
alter table public.commercial_strategy_ideas
  add column if not exists author_uid uuid default auth.uid(),
  add column if not exists author_role text check (author_role is null or author_role in ('owner','realtor')),
  add column if not exists author_name text check (author_name is null or char_length(author_name) <= 120);

drop policy if exists commercial_strategy_ideas_realtor_read on public.commercial_strategy_ideas;
create policy commercial_strategy_ideas_realtor_read on public.commercial_strategy_ideas
  for select to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor');
drop policy if exists commercial_strategy_ideas_realtor_insert on public.commercial_strategy_ideas;
create policy commercial_strategy_ideas_realtor_insert on public.commercial_strategy_ideas
  for insert to authenticated
  with check (public.commercial_member_role(deal_id) = 'realtor' and author_role = 'realtor' and author_uid = auth.uid());
drop policy if exists commercial_strategy_ideas_realtor_delete on public.commercial_strategy_ideas;
create policy commercial_strategy_ideas_realtor_delete on public.commercial_strategy_ideas
  for delete to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor' and author_uid = auth.uid());

-- 7. Unit notes. Each author sees their own; the owner sees all; realtor and reviewer notes reach only the owner.
--    Lenders read only the owner's one-line "lender overview" per unit.
create table if not exists public.commercial_unit_notes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  unit_number smallint not null check (unit_number between 1 and 18),
  kind text not null default 'note' check (kind in ('note','lender_overview')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  author_uid uuid not null default auth.uid(),
  author_role text not null check (author_role in ('owner','realtor','reviewer')),
  author_name text not null default '' check (char_length(author_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists commercial_unit_notes_idx on public.commercial_unit_notes(deal_id, unit_number, created_at);
alter table public.commercial_unit_notes enable row level security;
revoke all on public.commercial_unit_notes from anon, authenticated;
grant select, insert, update, delete on public.commercial_unit_notes to authenticated;

drop policy if exists commercial_unit_notes_owner_all on public.commercial_unit_notes;
create policy commercial_unit_notes_owner_all on public.commercial_unit_notes
  for all to authenticated
  using (public.commercial_member_role(deal_id) = 'owner')
  with check (public.commercial_member_role(deal_id) = 'owner' and author_role = 'owner' and author_uid = auth.uid());
drop policy if exists commercial_unit_notes_author_select on public.commercial_unit_notes;
create policy commercial_unit_notes_author_select on public.commercial_unit_notes
  for select to authenticated
  using (public.commercial_member_role(deal_id) in ('realtor','reviewer') and author_uid = auth.uid() and kind = 'note');
drop policy if exists commercial_unit_notes_author_insert on public.commercial_unit_notes;
create policy commercial_unit_notes_author_insert on public.commercial_unit_notes
  for insert to authenticated
  with check (public.commercial_member_role(deal_id) in ('realtor','reviewer') and author_role = public.commercial_member_role(deal_id)
    and author_uid = auth.uid() and kind = 'note');
drop policy if exists commercial_unit_notes_author_update on public.commercial_unit_notes;
create policy commercial_unit_notes_author_update on public.commercial_unit_notes
  for update to authenticated
  using (public.commercial_member_role(deal_id) in ('realtor','reviewer') and author_uid = auth.uid() and kind = 'note')
  with check (public.commercial_member_role(deal_id) in ('realtor','reviewer') and author_role = public.commercial_member_role(deal_id)
    and author_uid = auth.uid() and kind = 'note');
drop policy if exists commercial_unit_notes_author_delete on public.commercial_unit_notes;
create policy commercial_unit_notes_author_delete on public.commercial_unit_notes
  for delete to authenticated
  using (public.commercial_member_role(deal_id) in ('realtor','reviewer') and author_uid = auth.uid() and kind = 'note');
drop policy if exists commercial_unit_notes_lender_overview on public.commercial_unit_notes;
create policy commercial_unit_notes_lender_overview on public.commercial_unit_notes
  for select to authenticated
  using (public.commercial_member_role(deal_id) = 'lender' and kind = 'lender_overview' and author_role = 'owner');

-- 8. Lender terms board: every lender (and the owner) reads every lender's terms, labeled by company.
--    A lender writes only her own row. The private message to the buyer keeps going too.
create table if not exists public.commercial_lender_terms (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  lender_uid uuid not null default auth.uid(),
  company_name text not null check (char_length(btrim(company_name)) between 1 and 160),
  lender_type text check (lender_type is null or lender_type in ('private','hard','traditional')),
  terms jsonb not null default '{}'::jsonb check (jsonb_typeof(terms) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, lender_uid)
);
alter table public.commercial_lender_terms enable row level security;
revoke all on public.commercial_lender_terms from anon, authenticated;
grant select, insert, update on public.commercial_lender_terms to authenticated;

drop policy if exists commercial_lender_terms_read on public.commercial_lender_terms;
create policy commercial_lender_terms_read on public.commercial_lender_terms
  for select to authenticated
  using (public.commercial_member_role(deal_id) in ('owner','lender'));
drop policy if exists commercial_lender_terms_own_insert on public.commercial_lender_terms;
create policy commercial_lender_terms_own_insert on public.commercial_lender_terms
  for insert to authenticated
  with check (public.commercial_member_role(deal_id) = 'lender' and lender_uid = auth.uid());
drop policy if exists commercial_lender_terms_own_update on public.commercial_lender_terms;
create policy commercial_lender_terms_own_update on public.commercial_lender_terms
  for update to authenticated
  using (public.commercial_member_role(deal_id) = 'lender' and lender_uid = auth.uid())
  with check (public.commercial_member_role(deal_id) = 'lender' and lender_uid = auth.uid());

-- Owner can delete a Files upload's stored object (Files deletes storage first, then the row).
drop policy if exists commercial_v63_upload_files_owner_delete on storage.objects;
create policy commercial_v63_upload_files_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'commercial-files'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.commercial_member_role(((storage.foldername(name))[1])::uuid) = 'owner'
  );

commit;
