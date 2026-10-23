-- The anonymous document-upload RLS error is back (reported again on
-- VEN 278-A, after VEN 268-A earlier) -- and this time verified directly,
-- not assumed away as a timing fluke:
--
--   * is_recent_pending_public_site(site_id) returns true for the site in
--     question, called directly with the anon key.
--   * The matching storage.objects insert (same site, same function,
--     uploaded via the public form) succeeded.
--   * But inserting into public.site_document with the anon key failed
--     with "new row violates row-level security policy", identically
--     regardless of doc_type (gst, pan, even a doc_type not in the
--     allowed list all failed the same way) -- which only makes sense if
--     doc_insert_public_signup (sql/19, then sql/24, then sql/25) is no
--     longer the policy actually in effect on the live table, leaving
--     only doc_insert (sql/02, staff-only via can_write()) applicable,
--     which is always false for anon.
--
-- Re-asserting the policy and the grant, unchanged from sql/25, plus a
-- query at the end to list what's actually on the table right now --
-- paste its output back if the error still happens after running this.

drop policy if exists doc_insert_public_signup on public.site_document;
create policy doc_insert_public_signup on public.site_document for insert
  to anon
  with check (
    uploaded_by is null
    and doc_type in ('gst', 'pan', 'udyam')
    and public.is_recent_pending_public_site(site_id::text)
  );

grant insert on public.site_document to anon;

-- CHECK — should list doc_insert (authenticated staff) and
-- doc_insert_public_signup (anon) as the two INSERT policies on this table.
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'site_document';
