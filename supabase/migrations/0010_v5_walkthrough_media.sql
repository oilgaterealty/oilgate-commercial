-- v5 mobile walkthrough media: walkthrough videos, resilient audio-note metadata, 50 MB private storage limit.
-- Additive and strictly scoped to commercial_* objects and the commercial-files bucket.
begin;

-- 1. Raise private commercial-files bucket limit to 50 MB (keeping public = false).
update storage.buckets
set file_size_limit = 52428800
where id = 'commercial-files';

-- 2. Walkthrough room videos (owner + realtor ONLY).
create table if not exists public.commercial_walkthrough_videos (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  unit_number smallint not null check (unit_number between 1 and 10),
  room text not null check (room in ('kitchen','bath','bedroom_1','bedroom_2','living')),
  storage_path text not null unique,
  mime text not null default 'video/mp4' check (char_length(mime) <= 120),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  duration_sec integer check (duration_sec is null or (duration_sec >= 0 and duration_sec <= 7200)),
  author_uid uuid not null default auth.uid(),
  author_role text not null check (author_role in ('owner','realtor')),
  author_name text not null default '' check (char_length(author_name) <= 120),
  created_at timestamptz not null default now(),
  check (
    split_part(storage_path, '/', 1) = 'commercial-v5'
    and split_part(storage_path, '/', 2) = deal_id::text
    and split_part(storage_path, '/', 3) = 'walkthrough'
    and split_part(storage_path, '/', 4) = author_uid::text
    and split_part(storage_path, '/', 5) ~ '^[0-9a-f-]{36}\.(mp4|webm|mov|m4v)$'
  )
);

create index if not exists commercial_walkthrough_videos_idx
  on public.commercial_walkthrough_videos(deal_id, unit_number, room, created_at);

drop trigger if exists commercial_walkthrough_videos_unit_check on public.commercial_walkthrough_videos;
create trigger commercial_walkthrough_videos_unit_check
  before insert or update of unit_number, deal_id on public.commercial_walkthrough_videos
  for each row execute function public.commercial_v5_valid_unit();

alter table public.commercial_walkthrough_videos enable row level security;

revoke all on public.commercial_walkthrough_videos from anon, authenticated;
grant select, insert, delete on public.commercial_walkthrough_videos to authenticated;

create policy commercial_walkthrough_videos_owner_all on public.commercial_walkthrough_videos
  for all to authenticated
  using (public.commercial_member_role(deal_id) = 'owner')
  with check (public.commercial_member_role(deal_id) = 'owner' and author_role = 'owner' and author_uid = auth.uid());

create policy commercial_walkthrough_videos_realtor_read on public.commercial_walkthrough_videos
  for select to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor');

create policy commercial_walkthrough_videos_realtor_insert on public.commercial_walkthrough_videos
  for insert to authenticated
  with check (public.commercial_member_role(deal_id) = 'realtor' and author_role = 'realtor' and author_uid = auth.uid());

create policy commercial_walkthrough_videos_realtor_delete on public.commercial_walkthrough_videos
  for delete to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor' and author_uid = auth.uid());

-- 3. Enhance walkthrough notes to allow audio-backed notes pending/failed local Whisper and idempotent retries.
alter table public.commercial_walkthrough_notes
  add column if not exists transcript_status text not null default 'ready' check (transcript_status in ('pending','ready','failed')),
  add column if not exists audio_mime text check (audio_mime is null or char_length(audio_mime) <= 120),
  add column if not exists audio_size_bytes bigint check (audio_size_bytes is null or (audio_size_bytes > 0 and audio_size_bytes <= 52428800)),
  add column if not exists duration_sec integer check (duration_sec is null or (duration_sec >= 0 and duration_sec <= 7200)),
  add column if not exists client_id uuid;

alter table public.commercial_walkthrough_notes
  alter column raw_transcript set default '';

create unique index if not exists commercial_walkthrough_notes_client_idx
  on public.commercial_walkthrough_notes(deal_id, client_id)
  where client_id is not null;

alter table public.commercial_walkthrough_notes
  drop constraint if exists commercial_walkthrough_notes_raw_transcript_check;

alter table public.commercial_walkthrough_notes
  drop constraint if exists commercial_walkthrough_notes_transcript_or_audio_check;

alter table public.commercial_walkthrough_notes
  add constraint commercial_walkthrough_notes_transcript_or_audio_check
  check (char_length(raw_transcript) <= 12000 and (char_length(btrim(raw_transcript)) >= 1 or storage_path is not null));

-- 4. Allow video extensions (.mov, .m4v, .mp4, .webm) in commercial-v5 private walkthrough storage namespace.
create or replace function public.commercial_v5_storage_access(p_name text, p_mode text) returns boolean
language sql stable set search_path = '' as $$
  select case
    when p_name ~ '^commercial-v5/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/walkthrough/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|webm|ogg|m4a|mp4|wav|mov|m4v)$'
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

commit;
