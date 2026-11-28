-- Seed Charlotte seller protections as owner-editable deal content (commercial_deals.seller_content -> 'protections').
update public.commercial_deals
set seller_content = jsonb_set(
  coalesce(seller_content, '{}'::jsonb),
  '{protections}',
  jsonb_build_array(
    'Your bank gets paid first. A neutral payment company pays your mortgage every month, and you see every payment.',
    'The building comes back to you if payments stop. A signed deed waits at the title company.',
    '15-day grace, then default.',
    'You''re named on the insurance.',
    'Monthly updates here: rents, leases and repair photos.',
    'Extra collateral: one of my other rentals backs this loan too.'
  ),
  true
)
where slug = 'charlotte'
  and not (coalesce(seller_content, '{}'::jsonb) ? 'protections');
