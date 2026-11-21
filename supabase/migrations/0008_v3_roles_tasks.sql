-- v3: the realtor sees the deal numbers and offers (read only), tasks carry who owns them.
alter table public.commercial_offers add column if not exists share_realtor boolean not null default true;

drop policy if exists offers_shared on public.commercial_offers;
create policy offers_shared on public.commercial_offers for select using (
  (share_reviewer and public.commercial_member_role(deal_id) = 'reviewer')
  or (share_lender and public.commercial_member_role(deal_id) = 'lender')
  or (share_realtor and public.commercial_member_role(deal_id) = 'realtor')
);

drop policy if exists models_review on public.commercial_models;
create policy models_review on public.commercial_models for select
  using (public.commercial_member_role(deal_id) in ('reviewer','lender','realtor'));

alter table public.commercial_work_items add column if not exists assignee text;
alter table public.commercial_work_items drop constraint if exists commercial_work_items_assignee_len;
alter table public.commercial_work_items add constraint commercial_work_items_assignee_len check (assignee is null or char_length(assignee) <= 80);
