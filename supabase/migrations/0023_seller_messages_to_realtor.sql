-- Where the seller's messages go. One setting per deal: 'realtor' (default) or 'buyer'.
-- 'realtor': the seller writes to the realtor; the buyer still sees the thread but gets no push for it.
insert into public.commercial_settings (key, value)
select 'seller_messages_to:' || slug, 'realtor' from public.commercial_deals where slug = 'charlotte'
on conflict (key) do nothing;

create or replace function public.commercial_seller_messages_to(p_deal uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case when public.commercial_member_role(p_deal) is null then null else
    coalesce((select s.value from commercial_settings s join commercial_deals d on s.key = 'seller_messages_to:' || d.slug where d.id = p_deal), 'realtor')
  end;
$$;
revoke execute on function public.commercial_seller_messages_to(uuid) from public, anon;
grant execute on function public.commercial_seller_messages_to(uuid) to authenticated;

create or replace function public.commercial_on_message()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare t text; d text; who text; skip_owner boolean := false;
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
  -- Seller messages go to the realtor when that is the setting and a realtor is in the thread.
  if new.author_role = 'seller' and coalesce(public.commercial_seller_messages_to(new.deal_id), 'realtor') = 'realtor' then
    select exists (
      select 1 from commercial_members m join commercial_conversations c on c.id = new.conversation_id
      where m.deal_id = new.deal_id and m.status = 'active' and m.role = 'realtor' and m.email = any (c.participants)
    ) into skip_owner;
  end if;
  if new.author_role <> 'owner' and not skip_owner then
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

notify pgrst, 'reload schema';
