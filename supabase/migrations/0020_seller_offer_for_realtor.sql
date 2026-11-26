-- The realtor sees the same one offer the seller sees (seller-facing fields only).
CREATE OR REPLACE FUNCTION commercial_access_private.get_seller_offer(p_deal uuid)
 RETURNS TABLE(id uuid, name text, structure text, seller_summary jsonb, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r text := public.commercial_member_role(p_deal);
begin
  if r is null or r not in ('seller', 'realtor', 'owner') then
    return;
  end if;
  return query
    select o.id, o.name, o.structure,
      case when o.seller_summary is null then null else
        jsonb_strip_nulls(jsonb_build_object(
          'version', o.seller_summary->'version',
          'locked', o.seller_summary->'locked',
          'title', o.seller_summary->'title',
          'intro', o.seller_summary->'intro',
          'sellerCoveredAt', o.seller_summary->'sellerCoveredAt',
          'refiLine', o.seller_summary->'refiLine',
          'terms', o.seller_summary->'terms',
          'steps', o.seller_summary->'steps',
          'sellerTable', (
            select jsonb_agg(jsonb_build_object('units', t->'units', 'rentIn', t->'rentIn', 'covered', t->'covered') order by ord)
            from jsonb_array_elements(case when jsonb_typeof(o.seller_summary->'sellerTable') = 'array' then o.seller_summary->'sellerTable' else '[]'::jsonb end) with ordinality as x(t, ord)
          )
        ))
      end,
      o.updated_at
    from public.commercial_offers o
    where o.deal_id = p_deal and o.is_lead = true
    order by o.sort, o.updated_at desc
    limit 1;
end
$function$;
