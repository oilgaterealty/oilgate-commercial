-- 0026: the owner decides what the realtor sees, like the reviewer and lender.
-- Existing files stay shared with the realtor (audience gets 'realtor'); new uploads start hidden from her
-- until the owner turns her on. The realtor still sees her own uploads and anything shared with the seller.
update public.commercial_uploads
   set audience = array_append(coalesce(audience, '{}'::text[]), 'realtor')
 where not ('realtor' = any(coalesce(audience, '{}'::text[])));

drop policy if exists uploads_read on public.commercial_uploads;
create policy uploads_read on public.commercial_uploads for select using (
  (public.commercial_member_role(deal_id) = any (array['owner'::text, 'guest'::text]))
  or (uploaded_by_email = public.commercial_jwt_email())
  or ((public.commercial_member_role(deal_id) = any (array['seller'::text, 'realtor'::text])) and (visibility = 'seller'::text))
  or ((public.commercial_member_role(deal_id) = 'lead_guest'::text) and (kind = 'photo'::text) and (featured = true) and ((visibility = 'seller'::text) or ('viewer'::text = any (audience))))
  or ((public.commercial_member_role(deal_id) = any (array['reviewer'::text, 'lender'::text, 'viewer'::text, 'realtor'::text])) and (public.commercial_member_role(deal_id) = any (audience)))
);
