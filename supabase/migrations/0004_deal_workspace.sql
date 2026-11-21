-- Forward-only workspace additions. Private history is never re-participated or copied.
begin;
create table if not exists public.commercial_seller_loans (
  deal_id uuid primary key references public.commercial_deals(id) on delete cascade,
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 5000),
  updated_at timestamptz not null default now()
);
alter table public.commercial_seller_loans enable row level security;
create policy commercial_loan_read on public.commercial_seller_loans for select to authenticated
  using (public.commercial_member_role(deal_id) in ('owner','seller'));
create policy commercial_loan_write on public.commercial_seller_loans for all to authenticated
  using (public.commercial_member_role(deal_id) = 'owner') with check (public.commercial_member_role(deal_id) = 'owner');
revoke all on public.commercial_seller_loans from anon;
grant select, insert, update on public.commercial_seller_loans to authenticated;
create table if not exists public.commercial_work_items (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  kind text not null check (kind in ('task','research','update')),
  body text not null check (length(body) between 1 and 4000),
  audience text[] not null default '{}' check (audience <@ array['realtor','reviewer','lender']::text[]),
  author_email text not null,
  author_role text not null check (author_role in ('owner','realtor','reviewer','lender')),
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.commercial_bia (
  deal_id uuid not null references public.commercial_deals(id) on delete cascade,
  author_email text not null,
  answers jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (deal_id, author_email),
  check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 30000)
);
alter table public.commercial_work_items enable row level security;
alter table public.commercial_bia enable row level security;
create policy commercial_work_read on public.commercial_work_items for select to authenticated using (
  public.commercial_member_role(deal_id) = 'owner'
  or (public.commercial_member_role(deal_id) in ('realtor','reviewer','lender') and public.commercial_member_role(deal_id) = any(audience) and (author_role = 'owner' or author_email = public.commercial_jwt_email()))
);
create policy commercial_work_insert on public.commercial_work_items for insert to authenticated with check (
  author_email = public.commercial_jwt_email() and author_role = public.commercial_member_role(deal_id) and (
    public.commercial_member_role(deal_id) = 'owner'
    or (kind in ('task','update') and public.commercial_member_role(deal_id) in ('realtor','reviewer','lender') and audience = array[public.commercial_member_role(deal_id)])
  )
);
create policy commercial_work_update on public.commercial_work_items for update to authenticated
  using (public.commercial_member_role(deal_id) = 'owner' or (author_email = public.commercial_jwt_email() and public.commercial_member_role(deal_id) in ('realtor','reviewer','lender')))
  with check (public.commercial_member_role(deal_id) = 'owner' or (author_email = public.commercial_jwt_email() and author_role = public.commercial_member_role(deal_id) and kind in ('task','update') and audience = array[public.commercial_member_role(deal_id)]));
create policy commercial_bia_read on public.commercial_bia for select to authenticated using (
  public.commercial_member_role(deal_id) = 'owner' or (public.commercial_member_role(deal_id) = 'realtor' and author_email = public.commercial_jwt_email())
);
create policy commercial_bia_insert on public.commercial_bia for insert to authenticated with check (
  public.commercial_member_role(deal_id) = 'realtor' and author_email = public.commercial_jwt_email()
);
create policy commercial_bia_update on public.commercial_bia for update to authenticated
  using (public.commercial_member_role(deal_id) = 'realtor' and author_email = public.commercial_jwt_email())
  with check (public.commercial_member_role(deal_id) = 'realtor' and author_email = public.commercial_jwt_email());
revoke all on public.commercial_work_items, public.commercial_bia from anon;
grant select, insert, update on public.commercial_work_items, public.commercial_bia to authenticated;

-- Canonical new thread: seller + active realtors, every other role + owner only.
-- An advisory transaction lock prevents duplicate first-send conversations.
create or replace function public.commercial_open_own_thread(p_deal uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r text := public.commercial_member_role(p_deal); me text := public.commercial_jwt_email(); people text[]; cid uuid;
begin
  if r is null or r not in ('seller','realtor','reviewer','lender') then raise exception 'This role cannot start a thread'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_deal::text || me, 0));
  select array_agg(email order by email) into people from (
    select me as email union select email from commercial_members where deal_id = p_deal and status = 'active' and role = 'realtor' and r = 'seller'
  ) p;
  select id into cid from commercial_conversations where deal_id = p_deal and participants @> people and participants <@ people order by created_at limit 1;
  if cid is null then
    insert into commercial_conversations(deal_id, participants, created_by, title)
    values(p_deal, people, me, case when r = 'seller' then 'Seller questions · owner and realtor' else '' end) returning id into cid;
  end if;
  return cid;
end $$;
revoke all on function public.commercial_open_own_thread(uuid) from public, anon;
grant execute on function public.commercial_open_own_thread(uuid) to authenticated;

create or replace function public.commercial_check_conversation_route() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.participants is distinct from old.participants or new.deal_id is distinct from old.deal_id) then
    raise exception 'Conversation history is private. Create a new thread for a different audience';
  end if;
  if cardinality(new.participants) <> 1 and exists(select 1 from commercial_members where deal_id = new.deal_id and status = 'active' and role = 'lender' and email = any(new.participants)) then
    raise exception 'Lender conversations must remain owner-only';
  end if;
  return new;
end $$;
revoke all on function public.commercial_check_conversation_route() from public, anon, authenticated;
create trigger commercial_check_conversation_route before insert or update on public.commercial_conversations for each row execute function public.commercial_check_conversation_route();

-- Keep lender comments owner-only even if a client attempts a mixed-role thread.
create or replace function public.commercial_can_open(p_deal uuid, p_participants text[]) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text := public.commercial_member_role(p_deal); me text := public.commercial_jwt_email(); p text; pr text; has_lender boolean := false;
begin
  if r is null or r in ('guest','viewer') or cardinality(p_participants) not between 1 and 20 then return false; end if;
  foreach p in array p_participants loop
    select role into pr from commercial_members where deal_id = p_deal and email = p and status = 'active';
    if pr is null then return false; end if;
    if pr = 'lender' then has_lender := true; end if;
    if r = 'owner' or p = me then continue; end if;
    if r = 'realtor' and pr = 'seller' then continue; end if;
    return false;
  end loop;
  if has_lender and cardinality(p_participants) <> 1 then return false; end if;
  return r = 'owner' or me = any(p_participants);
end $$;

-- Validate lender privacy and seller routing for direct REST writes as well as the UI.
create or replace function public.commercial_check_message_route() returns trigger
language plpgsql security definer set search_path = public as $$
declare people text[];
begin
  select participants into people from commercial_conversations where id = new.conversation_id and deal_id = new.deal_id;
  if exists(select 1 from commercial_members where deal_id = new.deal_id and status = 'active' and role = 'lender' and email = any(people)) and cardinality(people) <> 1 then
    raise exception 'Lender comments must remain owner-only';
  end if;
  if new.author_role = 'seller' and exists(select 1 from commercial_members where deal_id = new.deal_id and status = 'active' and role = 'realtor' and not(email = any(people))) then
    raise exception 'Use the seller question thread shared with owner and realtor';
  end if;
  return new;
end $$;
revoke all on function public.commercial_check_message_route() from public, anon, authenticated;
create trigger commercial_check_message_route before insert on public.commercial_messages for each row execute function public.commercial_check_message_route();
commit;
