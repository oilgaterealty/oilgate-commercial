-- Signed-out visitors get no table access at all; trigger functions can't be called directly.
revoke all on public.commercial_owners, public.commercial_deals, public.commercial_members,
  public.commercial_deal_private, public.commercial_owner_notes, public.commercial_messages,
  public.commercial_uploads, public.commercial_interest, public.commercial_activity,
  public.commercial_settings from anon;
revoke execute on function public.commercial_on_message(), public.commercial_on_upload(),
  public.commercial_on_interest() from public, anon, authenticated;
