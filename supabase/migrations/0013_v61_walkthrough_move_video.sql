-- v6.1 walkthrough: two more building spaces (17 Laundry room, 18 Utility room), moving photos and videos
-- between units and rooms, and per-video sharing with the seller or lender.
begin;

-- 1. Spaces 1-18 (17 and 18 are building areas and use the room key 'general').
do $$
declare t text;
begin
  foreach t in array array['commercial_walkthrough_photos','commercial_walkthrough_notes','commercial_walkthrough_videos'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_unit_number_check');
    execute format('alter table public.%I add constraint %I check (unit_number between 1 and 18)', t, t || '_unit_number_check');
  end loop;
end $$;

-- 2. Videos get the same share switches as photos.
alter table public.commercial_walkthrough_videos
  add column if not exists share_seller boolean not null default false,
  add column if not exists share_lender boolean not null default false;
grant update on public.commercial_walkthrough_videos to authenticated;

-- 3. One guard for photos and videos: only the owner flips share switches; a move changes only the unit and room,
--    the owner may move anything, the realtor only what she took; the room must fit the space.
create or replace function public.commercial_walk_share_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.commercial_member_role(new.deal_id);
begin
  if (new.share_seller is distinct from old.share_seller or new.share_lender is distinct from old.share_lender)
     and r <> 'owner' then
    raise exception 'Only the owner can share walkthrough photos and videos';
  end if;
  if (new.storage_path, new.author_uid, new.author_role, new.deal_id)
     is distinct from (old.storage_path, old.author_uid, old.author_role, old.deal_id) then
    raise exception 'Walkthrough media cannot be re-attributed';
  end if;
  if (new.unit_number, new.room) is distinct from (old.unit_number, old.room) then
    if not (r = 'owner' or (r = 'realtor' and old.author_uid = auth.uid())) then
      raise exception 'Only the owner, or the realtor for her own media, can move walkthrough media';
    end if;
    if (new.unit_number <= 10 and new.room = 'general') or (new.unit_number > 10 and new.room <> 'general') then
      raise exception 'That room does not belong to that space';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.commercial_walk_share_guard() from public, anon, authenticated;
drop trigger if exists commercial_walk_share_guard on public.commercial_walkthrough_videos;
create trigger commercial_walk_share_guard before update on public.commercial_walkthrough_videos
  for each row execute function public.commercial_walk_share_guard();

-- 4. Who may update rows (the guard above limits what changes).
drop policy if exists commercial_walkthrough_videos_owner_update on public.commercial_walkthrough_videos;
create policy commercial_walkthrough_videos_owner_update on public.commercial_walkthrough_videos
  for update to authenticated
  using (public.commercial_member_role(deal_id) = 'owner')
  with check (public.commercial_member_role(deal_id) = 'owner');

drop policy if exists commercial_walkthrough_videos_realtor_move on public.commercial_walkthrough_videos;
create policy commercial_walkthrough_videos_realtor_move on public.commercial_walkthrough_videos
  for update to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor' and author_uid = auth.uid())
  with check (public.commercial_member_role(deal_id) = 'realtor' and author_uid = auth.uid());

drop policy if exists commercial_walkthrough_photos_realtor_move on public.commercial_walkthrough_photos;
create policy commercial_walkthrough_photos_realtor_move on public.commercial_walkthrough_photos
  for update to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor' and author_uid = auth.uid())
  with check (public.commercial_member_role(deal_id) = 'realtor' and author_uid = auth.uid());

drop policy if exists commercial_walkthrough_videos_seller_shared on public.commercial_walkthrough_videos;
create policy commercial_walkthrough_videos_seller_shared on public.commercial_walkthrough_videos
  for select to authenticated
  using (share_seller and public.commercial_member_role(deal_id) = 'seller');

drop policy if exists commercial_walkthrough_videos_lender_shared on public.commercial_walkthrough_videos;
create policy commercial_walkthrough_videos_lender_shared on public.commercial_walkthrough_videos
  for select to authenticated
  using (share_lender and public.commercial_member_role(deal_id) = 'lender');

-- 5. Storage follows the rows: the seller and lender read only photos and videos shared with them.
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
      or exists (select 1 from public.commercial_walkthrough_videos where deal_id = d and storage_path = p_name)
      or exists (select 1 from public.commercial_walkthrough_notes where deal_id = d and storage_path = p_name and author_role = 'realtor');
  end if;
  if r = 'seller' and p_mode = 'read' then
    return exists (select 1 from public.commercial_walkthrough_photos where deal_id = d and storage_path = p_name and share_seller)
      or exists (select 1 from public.commercial_walkthrough_videos where deal_id = d and storage_path = p_name and share_seller);
  end if;
  if r = 'lender' and p_mode = 'read' then
    return exists (select 1 from public.commercial_walkthrough_photos where deal_id = d and storage_path = p_name and share_lender)
      or exists (select 1 from public.commercial_walkthrough_videos where deal_id = d and storage_path = p_name and share_lender);
  end if;
  return false;
end $$;
revoke all on function public.commercial_v5_storage_access(text, text) from public, anon;
grant execute on function public.commercial_v5_storage_access(text, text) to authenticated;

commit;
