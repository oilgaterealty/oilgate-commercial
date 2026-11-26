-- A realtor can invite a seller to the existing seller page, and nothing else.
-- The realtor never sees or changes anyone else's access. The owner gets a push and can remove it.
alter table public.commercial_members add column if not exists invited_by_email text;

create or replace function public.commercial_realtor_invite_seller(p_deal uuid, p_name text, p_email text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  me text := public.commercial_jwt_email();
  r text := public.commercial_member_role(p_deal);
  e text := lower(btrim(coalesce(p_email, '')));
  n text := nullif(left(btrim(coalesce(p_name, '')), 120), '');
  existing public.commercial_members%rowtype;
begin
  if r is distinct from 'realtor' then raise exception 'Only the realtor can invite the seller here.'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e) > 254 then raise exception 'Enter a valid email.'; end if;
  if n is null then raise exception 'Enter the seller''s name.'; end if;
  if e = me or exists (select 1 from commercial_owners where email = e) then raise exception 'That email can''t be invited as the seller.'; end if;

  select * into existing from commercial_members where deal_id = p_deal and email = e;
  if found then
    if existing.role = 'seller' and existing.status = 'active' then return 'already'; end if;
    -- Any other role, or access the buyer removed, stays the buyer's call.
    raise exception 'That email already has a place here. Ask the buyer to add them.';
  end if;

  insert into commercial_members (deal_id, email, role, display_name, status, invited_by_email)
  values (p_deal, e, 'seller', n, 'active', me);

  -- Activity for the owner only; commercial_record also pushes it to the owner's alerts.
  perform public.commercial_record(p_deal, 'invite', coalesce(nullif(btrim(public.commercial_actor_name(p_deal)), ''), 'The realtor') || ' invited the seller: ' || n || ' (' || e || '). You can remove it in People.', 'owner');
  return 'invited';
end $$;

revoke execute on function public.commercial_realtor_invite_seller(uuid, text, text) from public, anon;
grant execute on function public.commercial_realtor_invite_seller(uuid, text, text) to authenticated;
notify pgrst, 'reload schema';
