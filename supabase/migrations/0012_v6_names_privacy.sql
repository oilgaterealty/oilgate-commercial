-- v6: buyer/seller names, who did each thing, realtor threads with seller and lender,
-- walkthrough media privacy with per-photo sharing, realtor tenant suggestions, sourced comps.
-- Additive and strictly scoped to commercial_* objects and the commercial-files bucket.
begin;

-- 1. Buyer and seller names on the deal (owner edits; everyone on the deal reads the deal row).
alter table public.commercial_deals
  add column if not exists buyer_name text not null default 'LaVante''' check (char_length(buyer_name) <= 120),
  add column if not exists seller_name text not null default '' check (char_length(seller_name) <= 120);

-- 2. Activity remembers who did it (name + role).
alter table public.commercial_activity
  add column if not exists actor_name text not null default '' check (char_length(actor_name) <= 120);

create or replace function public.commercial_actor_name(p_deal uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(case
    when public.commercial_member_role(p_deal) = 'owner' then (select nullif(btrim(buyer_name), '') from commercial_deals where id = p_deal)
    else (select nullif(btrim(display_name), '') from commercial_members where deal_id = p_deal and email = public.commercial_jwt_email() and status = 'active')
  end, '')
$$;
revoke all on function public.commercial_actor_name(uuid) from public, anon, authenticated;

create or replace function public.commercial_record(p_deal uuid, p_kind text, p_summary text, p_visibility text)
returns void language plpgsql security definer set search_path = public as $$
declare r text := coalesce(public.commercial_member_role(p_deal), 'system'); t text;
begin
  insert into commercial_activity (deal_id, actor_email, actor_role, actor_name, kind, summary, visibility)
  values (p_deal, public.commercial_jwt_email(), r, public.commercial_actor_name(p_deal), p_kind, p_summary, p_visibility);
  select title into t from commercial_deals where id = p_deal;
  if r <> 'owner' then
    perform public.commercial_push_alert(p_deal, coalesce(t, 'Oilgate Commercial'), p_summary, p_visibility);
  end if;
end $$;
revoke execute on function public.commercial_record(uuid, text, text, text) from public, anon, authenticated;

-- Summaries no longer start with a role word; the page shows the name and role next to each line.
create or replace function public.commercial_on_upload() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.commercial_record(new.deal_id, 'upload',
    'uploaded ' || case when new.kind = 'photo' then 'a photo: ' else 'a document: ' end || new.file_name, 'team');
  return new;
end $$;

create or replace function public.commercial_on_interest() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.commercial_record(new.deal_id, 'interest',
    'marked: ' || case new.level when 'interested' then 'interested in talking' when 'questions' then 'has questions first' else 'not right now' end,
    'team');
  return new;
end $$;

create or replace function public.commercial_log_view(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare d uuid; r text;
begin
  select id into d from commercial_deals where slug = p_slug;
  r := public.commercial_member_role(d);
  if d is null or r is null or r = 'owner' then return; end if;
  if exists (select 1 from commercial_activity where deal_id = d and actor_email = public.commercial_jwt_email() and kind = 'view' and created_at > now() - interval '1 hour') then return; end if;
  perform public.commercial_record(d, 'view', 'opened the deal page', 'team');
end $$;

create or replace function public.commercial_on_message() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare t text; d text; who text;
begin
  if new.conversation_id is null then
    perform public.commercial_record(new.deal_id, 'message', 'wrote: ' || left(new.body, 140), 'team');
    return new;
  end if;
  update commercial_conversations set last_message_at = now() where id = new.conversation_id;
  who := coalesce(nullif(new.author_name, ''), nullif(public.commercial_actor_name(new.deal_id), ''), initcap(new.author_role));
  insert into commercial_activity (deal_id, actor_email, actor_role, actor_name, kind, summary, visibility)
  values (new.deal_id, new.author_email, new.author_role, coalesce(nullif(new.author_name, ''), public.commercial_actor_name(new.deal_id)), 'message',
    'wrote' || coalesce(' (' || new.topic || ')', '') || ': ' || left(new.body, 140), 'owner');
  select title into d from commercial_deals where id = new.deal_id;
  if new.author_role <> 'owner' then
    select value into t from commercial_settings where key = 'owner_ntfy_topic';
    if t is not null then
      perform net.http_post(url := 'https://ntfy.sh', body := jsonb_build_object('topic', t, 'title', coalesce(d, 'Deal'), 'message', who || ': ' || left(new.body, 140)));
    end if;
  end if;
  for t in select m.ntfy_topic from commercial_members m join commercial_conversations c on c.id = new.conversation_id
    where m.deal_id = new.deal_id and m.status = 'active' and m.ntfy_topic is not null
      and m.email = any (c.participants) and m.email <> new.author_email
  loop
    perform net.http_post(url := 'https://ntfy.sh', body := jsonb_build_object('topic', t, 'title', coalesce(d, 'Deal'), 'message', 'New message from ' || who));
  end loop;
  return new;
end $$;

-- 3. Realtor threads with the buyer (owner), the seller and the lender.
-- A lender may share a thread only with realtors (the owner is in every thread). Sellers keep their own rule.
create or replace function public.commercial_lender_route_ok(p_deal uuid, p_people text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from commercial_members where deal_id = p_deal and status = 'active' and role = 'lender' and email = any(p_people))
    or not exists (
      select 1 from unnest(p_people) e
      where not exists (select 1 from commercial_members m where m.deal_id = p_deal and m.status = 'active' and m.email = e and m.role in ('lender','realtor'))
    )
$$;
revoke all on function public.commercial_lender_route_ok(uuid, text[]) from public, anon, authenticated;

create or replace function public.commercial_check_conversation_route() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.participants is distinct from old.participants or new.deal_id is distinct from old.deal_id) then
    raise exception 'Conversation history is private. Create a new thread for a different audience';
  end if;
  if not public.commercial_lender_route_ok(new.deal_id, new.participants) then
    raise exception 'Lender conversations include only the owner and realtors';
  end if;
  return new;
end $$;
revoke all on function public.commercial_check_conversation_route() from public, anon, authenticated;

create or replace function public.commercial_can_open(p_deal uuid, p_participants text[]) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text := public.commercial_member_role(p_deal); me text := public.commercial_jwt_email(); p text; pr text;
begin
  if r is null or r in ('guest','viewer') or cardinality(p_participants) not between 1 and 20 then return false; end if;
  foreach p in array p_participants loop
    select role into pr from commercial_members where deal_id = p_deal and email = p and status = 'active';
    if pr is null then return false; end if;
    if r = 'owner' or p = me then continue; end if;
    if r = 'realtor' and pr in ('seller','lender','realtor') then continue; end if;
    return false;
  end loop;
  if not public.commercial_lender_route_ok(p_deal, p_participants) then return false; end if;
  return r = 'owner' or me = any(p_participants);
end $$;

create or replace function public.commercial_check_message_route() returns trigger
language plpgsql security definer set search_path = public as $$
declare people text[];
begin
  select participants into people from commercial_conversations where id = new.conversation_id and deal_id = new.deal_id;
  if not public.commercial_lender_route_ok(new.deal_id, people) then
    raise exception 'Lender conversations include only the owner and realtors';
  end if;
  if new.author_role = 'seller' and exists(select 1 from commercial_members where deal_id = new.deal_id and status = 'active' and role = 'realtor' and not(email = any(people))) then
    raise exception 'Use the seller question thread shared with owner and realtor';
  end if;
  return new;
end $$;
revoke all on function public.commercial_check_message_route() from public, anon, authenticated;

-- Realtor opens (or finds) her thread with the seller or the lender. The owner is always in it.
create or replace function public.commercial_open_realtor_thread(p_deal uuid, p_with text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me text := public.commercial_jwt_email(); people text[]; cid uuid;
begin
  if public.commercial_member_role(p_deal) <> 'realtor' then raise exception 'Only the realtor can open this thread'; end if;
  if p_with not in ('seller','lender') then raise exception 'Unknown thread'; end if;
  if not exists (select 1 from commercial_members where deal_id = p_deal and status = 'active' and role = p_with) then
    raise exception 'No % has been invited yet', p_with;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_deal::text || p_with, 0));
  select array_agg(email order by email) into people from (
    select email from commercial_members where deal_id = p_deal and status = 'active' and role in ('realtor', p_with)
  ) x;
  select id into cid from commercial_conversations where deal_id = p_deal and participants @> people and participants <@ people order by created_at limit 1;
  if cid is null then
    insert into commercial_conversations(deal_id, participants, created_by, title)
    values (p_deal, people, me, case when p_with = 'seller' then 'Seller questions · owner and realtor' else 'Lender · owner and realtor' end)
    returning id into cid;
  end if;
  return cid;
end $$;
revoke all on function public.commercial_open_realtor_thread(uuid, text) from public, anon;
grant execute on function public.commercial_open_realtor_thread(uuid, text) to authenticated;

-- 4. Walkthrough privacy.
-- Owner voice notes are owner-only. The realtor reads only realtor notes.
drop policy if exists commercial_walkthrough_notes_realtor_read on public.commercial_walkthrough_notes;
create policy commercial_walkthrough_notes_realtor_read on public.commercial_walkthrough_notes
  for select to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor' and author_role = 'realtor');

-- Per-photo sharing: the seller and the lender see only photos the owner turns on for them.
alter table public.commercial_walkthrough_photos
  add column if not exists share_seller boolean not null default false,
  add column if not exists share_lender boolean not null default false;

-- Only the owner may change the share switches (also on a realtor's photo).
create or replace function public.commercial_walk_share_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.share_seller is distinct from old.share_seller or new.share_lender is distinct from old.share_lender)
     and public.commercial_member_role(new.deal_id) <> 'owner' then
    raise exception 'Only the owner can share walkthrough photos';
  end if;
  if (new.storage_path, new.author_uid, new.author_role, new.deal_id, new.unit_number, new.room)
     is distinct from (old.storage_path, old.author_uid, old.author_role, old.deal_id, old.unit_number, old.room) then
    raise exception 'Walkthrough photos cannot be moved or re-attributed';
  end if;
  return new;
end $$;
revoke all on function public.commercial_walk_share_guard() from public, anon, authenticated;
drop trigger if exists commercial_walk_share_guard on public.commercial_walkthrough_photos;
create trigger commercial_walk_share_guard before update on public.commercial_walkthrough_photos
  for each row execute function public.commercial_walk_share_guard();

drop policy if exists commercial_walkthrough_photos_owner_share on public.commercial_walkthrough_photos;
create policy commercial_walkthrough_photos_owner_share on public.commercial_walkthrough_photos
  for update to authenticated
  using (public.commercial_member_role(deal_id) = 'owner')
  with check (public.commercial_member_role(deal_id) = 'owner');

drop policy if exists commercial_walkthrough_photos_seller_shared on public.commercial_walkthrough_photos;
create policy commercial_walkthrough_photos_seller_shared on public.commercial_walkthrough_photos
  for select to authenticated
  using (share_seller and public.commercial_member_role(deal_id) = 'seller');

drop policy if exists commercial_walkthrough_photos_lender_shared on public.commercial_walkthrough_photos;
create policy commercial_walkthrough_photos_lender_shared on public.commercial_walkthrough_photos
  for select to authenticated
  using (share_lender and public.commercial_member_role(deal_id) = 'lender');

-- Storage follows the same rules as the rows.
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
    return exists (select 1 from public.commercial_walkthrough_photos where deal_id = d and storage_path = p_name and share_seller);
  end if;
  if r = 'lender' and p_mode = 'read' then
    return exists (select 1 from public.commercial_walkthrough_photos where deal_id = d and storage_path = p_name and share_lender);
  end if;
  return false;
end $$;
revoke all on function public.commercial_v5_storage_access(text, text) from public, anon;
grant execute on function public.commercial_v5_storage_access(text, text) to authenticated;

-- 5. Tenants: the realtor sees the owner's list, adds her own, edits only her own, and suggests changes to his.
drop policy if exists commercial_tenant_leads_realtor_all on public.commercial_tenant_leads;
drop policy if exists commercial_tenant_leads_realtor_read on public.commercial_tenant_leads;
drop policy if exists commercial_tenant_leads_realtor_insert on public.commercial_tenant_leads;
drop policy if exists commercial_tenant_leads_realtor_update_own on public.commercial_tenant_leads;
drop policy if exists commercial_tenant_leads_realtor_delete_own on public.commercial_tenant_leads;
create policy commercial_tenant_leads_realtor_read on public.commercial_tenant_leads
  for select to authenticated using (public.commercial_member_role(deal_id) = 'realtor');
create policy commercial_tenant_leads_realtor_insert on public.commercial_tenant_leads
  for insert to authenticated
  with check (public.commercial_member_role(deal_id) = 'realtor' and author_role = 'realtor' and author_uid = auth.uid());
create policy commercial_tenant_leads_realtor_update_own on public.commercial_tenant_leads
  for update to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor' and author_uid = auth.uid())
  with check (public.commercial_member_role(deal_id) = 'realtor' and author_role = 'realtor' and author_uid = auth.uid());
create policy commercial_tenant_leads_realtor_delete_own on public.commercial_tenant_leads
  for delete to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor' and author_uid = auth.uid());

create table if not exists public.commercial_tenant_suggestions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  lead_id uuid not null references public.commercial_tenant_leads(id) on delete cascade,
  changes jsonb not null check (jsonb_typeof(changes) = 'object' and (changes - array['name','phone','email','notes','stage']) = '{}'::jsonb and changes <> '{}'::jsonb),
  note text not null default '' check (char_length(note) <= 2000),
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  author_uid uuid not null default auth.uid(),
  author_role text not null check (author_role in ('realtor')),
  author_name text not null default '' check (char_length(author_name) <= 120),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists commercial_tenant_suggestions_idx on public.commercial_tenant_suggestions(deal_id, status, created_at);

alter table public.commercial_tenant_suggestions enable row level security;
revoke all on public.commercial_tenant_suggestions from anon, authenticated;
grant select, insert, update on public.commercial_tenant_suggestions to authenticated;

create policy commercial_tenant_suggestions_owner on public.commercial_tenant_suggestions
  for all to authenticated
  using (public.commercial_member_role(deal_id) = 'owner')
  with check (public.commercial_member_role(deal_id) = 'owner');
create policy commercial_tenant_suggestions_realtor_read on public.commercial_tenant_suggestions
  for select to authenticated using (public.commercial_member_role(deal_id) = 'realtor');
create policy commercial_tenant_suggestions_realtor_insert on public.commercial_tenant_suggestions
  for insert to authenticated
  with check (
    public.commercial_member_role(deal_id) = 'realtor' and author_role = 'realtor' and author_uid = auth.uid() and status = 'pending'
    and exists (select 1 from public.commercial_tenant_leads l where l.id = lead_id and l.deal_id = commercial_tenant_suggestions.deal_id)
  );

-- 6. Comps keep where they came from.
alter table public.commercial_comps
  add column if not exists sale_date date,
  add column if not exists source text not null default '' check (char_length(source) <= 600);

commit;
