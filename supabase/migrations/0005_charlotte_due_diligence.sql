-- Owner-requested realtor desk starter. No private negotiation history or ceiling numbers.
-- Historical source pointers are labeled; they are not current verified property facts.
begin;
insert into public.commercial_work_items (deal_id, kind, body, audience, author_email, author_role)
select d.id, seed.kind, seed.body, array['realtor'], o.email, 'owner'
from public.commercial_deals d
cross join lateral (select email from public.commercial_owners order by email limit 1) o
cross join (values
  ('research', E'Unit-count research: prior county review (November 6, 2026) identified a discrepancy between the county commercial card and the nine-unit operating basis. The county portal could not be refreshed on November 20. Verify the legal and physical unit count at the walkthrough; do not underwrite additional income. Potential for a 10th unit ? must be seen/verified first. Underwriting stays on nine units.\nHistorical source pointer: https://propertyaccess.summitoh.net/datalets/datalet.aspx?UseSearch=no&pin=6801234&jur=000&taxyr=2025&LMparent=20&mode=commercial'),
  ('research', E'Operating evidence for the BIA: obtain the current dated rent roll, executed leases and collection history, trailing twelve-month income/expenses, actual insurance/utilities bills, and repair bids. Distinguish advertised rents from signed leases and collections. Current occupancy, collections and rent-ready condition require verification.\nCounty tax source pointer (2025 tax year; not a current bill or future-tax forecast): https://propertyaccess.summitoh.net/datalets/datalet.aspx?UseSearch=no&pin=6801234&jur=000&taxyr=2025&LMparent=20&mode=tax_summary'),
  ('task', 'Arrange the walkthrough; record unit-by-unit condition and verify the potential tenth unit before adding any income.'),
  ('task', 'Request current rent roll, leases, collection history and trailing operating statements; fill in the BIA sheet from the documents.'),
  ('task', 'Document comparable sales/rents with sources and dates; identify differences in condition and occupancy.'),
  ('update', 'Due diligence workspace is ready: use Research, BIA sheet, Tasks, Updates and Files. Questions about seller options go through the seller conversation; private realtor discussions stay in the owner thread.')
) as seed(kind, body)
where d.slug = 'charlotte' and not exists (
  select 1 from public.commercial_work_items w where w.deal_id = d.id and w.kind = seed.kind and w.body = seed.body
);
commit;
