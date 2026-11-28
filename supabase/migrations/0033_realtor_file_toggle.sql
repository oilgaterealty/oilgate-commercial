-- Owner-controlled realtor file audience: allow 'realtor' in commercial_uploads.audience
-- and enforce it in uploads_read without backfilling existing rows.
begin;

alter table public.commercial_uploads
  drop constraint if exists commercial_uploads_audience_check;

alter table public.commercial_uploads
  add constraint commercial_uploads_audience_check
  check (audience <@ array['reviewer','lender','viewer','realtor']::text[]);

drop policy if exists uploads_read on public.commercial_uploads;
create policy uploads_read on public.commercial_uploads for select using (
  (public.commercial_member_role(deal_id) = any (array['owner'::text, 'guest'::text]))
  or (uploaded_by_email = public.commercial_jwt_email())
  or ((public.commercial_member_role(deal_id) = any (array['seller'::text, 'realtor'::text])) and (visibility = 'seller'::text))
  or ((public.commercial_member_role(deal_id) = 'lead_guest'::text) and (kind = 'photo'::text) and (featured = true) and ((visibility = 'seller'::text) or ('viewer'::text = any (audience))))
  or ((public.commercial_member_role(deal_id) = any (array['reviewer'::text, 'lender'::text, 'viewer'::text, 'realtor'::text])) and (public.commercial_member_role(deal_id) = any (audience)))
);

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'commercial_uploads'
     and c.conname = 'commercial_uploads_audience_check';
  if v_def is null or position('realtor' in v_def) = 0 then
    raise exception 'commercial_uploads_audience_check missing realtor: %', coalesce(v_def, '<missing>');
  end if;
end
$$;

commit;
