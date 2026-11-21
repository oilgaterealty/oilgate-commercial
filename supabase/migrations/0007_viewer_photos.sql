-- Owner explicitly requested viewer photos, while keeping research/documents private.
begin;
create policy commercial_viewer_photos_only on public.commercial_uploads as restrictive for select to authenticated
  using (public.commercial_member_role(deal_id) not in ('viewer','guest') or kind = 'photo');
-- Only the existing seller-visible listing photos are added to the viewer audience.
update public.commercial_uploads
set audience = array(select distinct x from unnest(audience || array['viewer']) x)
where deal_id in (select id from public.commercial_deals where slug = 'charlotte')
  and kind = 'photo' and uploaded_by_role = 'owner' and visibility = 'seller'
  and file_name ~ '^charlotte-listing-[0-9]{2}\.jpg$'
  and not ('viewer' = any(audience));
commit;
