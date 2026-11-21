-- Only the completion flag is editable by the person receiving an owner task.
begin;
create or replace function public.commercial_set_task_done(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare item public.commercial_work_items; r text; me text := public.commercial_jwt_email();
begin
  select * into item from public.commercial_work_items where id = p_id for update;
  if item.id is null or item.kind <> 'task' then raise exception 'Task unavailable'; end if;
  r := public.commercial_member_role(item.deal_id);
  if r = 'owner' or (r in ('realtor','reviewer','lender') and r = any(item.audience) and (item.author_role = 'owner' or item.author_email = me)) then
    update public.commercial_work_items set done = p_done where id = p_id;
  else
    raise exception 'Task unavailable';
  end if;
end $$;
revoke all on function public.commercial_set_task_done(uuid, boolean) from public, anon;
grant execute on function public.commercial_set_task_done(uuid, boolean) to authenticated;
commit;
