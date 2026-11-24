-- v6.3: owner can see every upload file in their deal folder, so Storage
-- deletes from the Files tab match the object (delete needs read access).
create policy commercial_v63_upload_files_owner_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'commercial-files'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.commercial_member_role(((storage.foldername(name))[1])::uuid) = 'owner'
  );