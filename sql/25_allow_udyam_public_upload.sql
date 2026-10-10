-- The public sign-up form now offers an optional Udyam certificate upload
-- for MSME vendors. sql/24's anon upload policies only allowed gst/pan.

drop policy if exists doc_insert_public_signup on public.site_document;
create policy doc_insert_public_signup on public.site_document for insert
  to anon
  with check (
    uploaded_by is null
    and doc_type in ('gst', 'pan', 'udyam')
    and public.is_recent_pending_public_site(site_id::text)
  );

drop policy if exists vdocs_write_public_signup on storage.objects;
create policy vdocs_write_public_signup on storage.objects for insert
  to anon
  with check (
    bucket_id = 'vendor-documents'
    and (storage.foldername(name))[2] in ('gst', 'pan', 'udyam')
    and public.is_recent_pending_public_site((storage.foldername(name))[1])
  );
