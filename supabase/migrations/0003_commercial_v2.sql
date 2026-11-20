-- Oilgate Commercial v2: new roles, person-to-person messaging, photos, offers with live math.
-- Only commercial_-prefixed objects are touched. Safe on a shared project.

-- ---------- roles ----------
alter table public.commercial_members drop constraint if exists commercial_members_role_check;
alter table public.commercial_members add constraint commercial_members_role_check
  check (role in ('realtor','seller','guest','lender','reviewer','viewer'));

-- ---------- conversations: the owner picks who is in each one ----------
create table public.commercial_conversations (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  title text not null default '' check (length(title) <= 120),
  -- Everyone in the conversation except the owner, who is always in every conversation.
  participants text[] not null check (cardinality(participants) between 1 and 20),
  created_by text not null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index on public.commercial_conversations (deal_id, last_message_at desc);

alter table public.commercial_messages alter column channel drop not null;
alter table public.commercial_messages add column conversation_id uuid references public.commercial_conversations(id) on delete cascade;
alter table public.commercial_messages add column topic text check (length(topic) <= 80);
create index on public.commercial_messages (conversation_id, created_at);

create or replace function public.commercial_in_conversation(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from commercial_conversations c
    where c.id = p_conv
      and public.commercial_member_role(c.deal_id) is not null
      and (public.commercial_member_role(c.deal_id) = 'owner' or public.commercial_jwt_email() = any (c.participants))
  )
$$;

-- Who may start a conversation with whom.
create or replace function public.commercial_can_open(p_deal uuid, p_participants text[]) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text := public.commercial_member_role(p_deal); me text := public.commercial_jwt_email(); p text; pr text;
begin
  if r is null or r in ('guest','viewer') then return false; end if;
  foreach p in array p_participants loop
    select role into pr from commercial_members where deal_id = p_deal and email = p and status = 'active';
    if pr is null then return false; end if;
    if r = 'owner' then continue; end if;
    if p = me then continue; end if;
    -- A realtor may bring in the seller. Everyone else talks to the owner only.
    if r = 'realtor' and pr = 'seller' then continue; end if;
    return false;
  end loop;
  return r = 'owner' or me = any (p_participants);
end $$;

alter table public.commercial_conversations enable row level security;
create policy conv_read on public.commercial_conversations for select using (public.commercial_in_conversation(id));
create policy conv_open on public.commercial_conversations for insert with check (
  created_by = public.commercial_jwt_email() and public.commercial_can_open(deal_id, participants)
);
create policy conv_owner_edit on public.commercial_conversations for update
  using (public.commercial_member_role(deal_id) = 'owner') with check (public.commercial_member_role(deal_id) = 'owner');

drop policy if exists messages_read on public.commercial_messages;
drop policy if exists messages_write on public.commercial_messages;
create policy messages_read on public.commercial_messages for select using (
  public.commercial_member_role(deal_id) = 'owner'
  or (conversation_id is not null and public.commercial_in_conversation(conversation_id))
  or (conversation_id is null and channel = 'team' and public.commercial_member_role(deal_id) in ('realtor','guest'))
  or (conversation_id is null and channel = 'seller' and public.commercial_member_role(deal_id) in ('realtor','seller'))
);
create policy messages_write on public.commercial_messages for insert with check (
  author_email = public.commercial_jwt_email()
  and author_role = public.commercial_member_role(deal_id)
  and conversation_id is not null
  and public.commercial_member_role(deal_id) not in ('guest','viewer')
  and public.commercial_in_conversation(conversation_id)
  and exists (select 1 from public.commercial_conversations c where c.id = conversation_id and c.deal_id = commercial_messages.deal_id)
);

-- Private conversations stay private: the activity line goes to the owner only,
-- and the alert goes to the owner and the other people in that conversation.
create or replace function public.commercial_on_message() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare t text; d text; who text;
begin
  if new.conversation_id is null then
    perform public.commercial_record(new.deal_id, 'message',
      initcap(new.author_role) || ' wrote: ' || left(new.body, 140), 'team');
    return new;
  end if;
  update commercial_conversations set last_message_at = now() where id = new.conversation_id;
  who := coalesce(nullif(new.author_name, ''), initcap(new.author_role));
  insert into commercial_activity (deal_id, actor_email, actor_role, kind, summary, visibility)
  values (new.deal_id, new.author_email, new.author_role, 'message',
    who || coalesce(' (' || new.topic || ')', '') || ': ' || left(new.body, 140), 'owner');
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

-- ---------- photos and file sharing per role ----------
alter table public.commercial_uploads add column audience text[] not null default '{}'
  check (audience <@ array['reviewer','lender','viewer']::text[]);
alter table public.commercial_uploads add column featured boolean not null default false;

drop policy if exists uploads_read on public.commercial_uploads;
drop policy if exists uploads_write on public.commercial_uploads;
drop policy if exists uploads_share on public.commercial_uploads;
create policy uploads_read on public.commercial_uploads for select using (
  public.commercial_member_role(deal_id) in ('owner','realtor','guest')
  or uploaded_by_email = public.commercial_jwt_email()
  or (public.commercial_member_role(deal_id) = 'seller' and visibility = 'seller')
  or (public.commercial_member_role(deal_id) in ('reviewer','lender','viewer') and public.commercial_member_role(deal_id) = any (audience))
);
create policy uploads_write on public.commercial_uploads for insert with check (
  uploaded_by_email = public.commercial_jwt_email()
  and uploaded_by_role = public.commercial_member_role(deal_id)
  and public.commercial_member_role(deal_id) in ('owner','realtor','seller','reviewer','lender')
  and storage_path like deal_id::text || '/%'
  and (public.commercial_member_role(deal_id) in ('owner','realtor') or (visibility = 'team' and audience = '{}' and not featured))
);
create policy uploads_share on public.commercial_uploads for update
  using (public.commercial_member_role(deal_id) in ('owner','realtor'))
  with check (public.commercial_member_role(deal_id) in ('owner','realtor'));
create policy uploads_owner_delete on public.commercial_uploads for delete
  using (public.commercial_member_role(deal_id) = 'owner');

drop policy if exists commercial_files_write on storage.objects;
create policy commercial_files_write on storage.objects for insert to authenticated with check (
  case when bucket_id = 'commercial-files' and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.commercial_member_role(((storage.foldername(name))[1])::uuid) in ('owner','realtor','seller','reviewer','lender')
    else false end
);

-- ---------- seller's favourite option ----------
alter table public.commercial_interest add column favorite_option text check (length(favorite_option) <= 20);
create or replace function public.commercial_on_interest() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.commercial_record(new.deal_id, 'interest',
    'Seller marked: ' || case new.level when 'interested' then 'interested in talking' when 'questions' then 'has questions first' else 'not right now' end
    || coalesce(', likes option ' || new.favorite_option, ''),
    'team');
  return new;
end $$;

-- ---------- deal math: shared base numbers + offers ----------
create table public.commercial_models (
  deal_id uuid primary key references public.commercial_deals(id) on delete cascade,
  base jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.commercial_offers (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  structure text not null check (structure in ('master_lease','wrap','partnership','cash')),
  inputs jsonb not null default '{}'::jsonb,
  note text not null default '' check (length(note) <= 2000),
  share_reviewer boolean not null default false,
  share_lender boolean not null default false,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
create index on public.commercial_offers (deal_id, sort);

alter table public.commercial_models enable row level security;
alter table public.commercial_offers enable row level security;
create policy models_owner on public.commercial_models for all
  using (public.commercial_member_role(deal_id) = 'owner') with check (public.commercial_member_role(deal_id) = 'owner');
create policy models_review on public.commercial_models for select
  using (public.commercial_member_role(deal_id) in ('reviewer','lender'));
create policy offers_owner on public.commercial_offers for all
  using (public.commercial_member_role(deal_id) = 'owner') with check (public.commercial_member_role(deal_id) = 'owner');
create policy offers_shared on public.commercial_offers for select using (
  (share_reviewer and public.commercial_member_role(deal_id) = 'reviewer')
  or (share_lender and public.commercial_member_role(deal_id) = 'lender')
);

revoke all on public.commercial_conversations, public.commercial_models, public.commercial_offers from anon;
revoke execute on function public.commercial_in_conversation(uuid), public.commercial_can_open(uuid, text[]) from public, anon;
grant execute on function public.commercial_in_conversation(uuid), public.commercial_can_open(uuid, text[]) to authenticated;

alter publication supabase_realtime add table public.commercial_conversations;
