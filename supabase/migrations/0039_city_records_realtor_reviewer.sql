begin;

drop policy if exists settings_city_records_realtor_reviewer on public.commercial_settings;
create policy settings_city_records_realtor_reviewer on public.commercial_settings
  for select to authenticated
  using (
    key like 'city_records:%'
    and exists (
      select 1 from public.commercial_deals d
      where 'city_records:' || d.slug = commercial_settings.key
        and public.commercial_member_role(d.id) in ('realtor', 'reviewer')
    )
  );

drop policy if exists commercial_city_records_realtor_reviewer_read on storage.objects;
create policy commercial_city_records_realtor_reviewer_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'commercial-files'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (storage.foldername(name))[2] = 'city-records'
    and public.commercial_member_role(((storage.foldername(name))[1])::uuid) in ('realtor', 'reviewer')
  );

notify pgrst, 'reload schema';

commit;
