-- Lets the public sign-up form (app/onboard) attach the GST certificate and
-- PAN card the visitor was just asked for, right after
-- public_vendor_signup (sql/18) creates their site. Deliberately NOT done
-- with the service-role key (unlike a couple of existing authenticated,
-- staff-only admin flows elsewhere in this app) — this is the one truly
-- unauthenticated entry point into the system, so it gets the narrowest
-- possible grant instead: an anonymous upload is only ever accepted for a
-- site that is still 'pending' review and was created within the last
-- hour, and only for the gst/pan document types. An older or already-
-- reviewed site, or any other document type, is refused. The window does
-- not make this airtight — site ids are random, unguessable UUIDs, so the
-- realistic risk is limited to someone attaching a bogus extra document to
-- their own, still-unreviewed submission, which a staff reviewer would
-- simply see and reject.
--
-- Policies are additive — this does not touch doc_insert (sql/02), which
-- still governs authenticated uploads exactly as before.
drop policy if exists doc_insert_public_signup on public.site_document;
create policy doc_insert_public_signup on public.site_document for insert
  to anon
  with check (
    uploaded_by is null
    and doc_type in ('gst', 'pan')
    and exists (
      select 1 from public.vendor_site s
      where s.id = site_id and s.status = 'pending' and s.created_at > now() - interval '1 hour'
    )
  );

grant insert on public.site_document to anon;

drop policy if exists vdocs_write_public_signup on storage.objects;
create policy vdocs_write_public_signup on storage.objects for insert
  to anon
  with check (
    bucket_id = 'vendor-documents'
    and (storage.foldername(name))[2] in ('gst', 'pan')
    and exists (
      select 1 from public.vendor_site s
      where s.id::text = (storage.foldername(name))[1]
        and s.status = 'pending' and s.created_at > now() - interval '1 hour'
    )
  );
