-- Supports the Documents tab's new "+ Add more documents" flow: a person
-- types what the document is (free text, kept in site_document.doc_number,
-- which already exists for exactly this "as printed on it" purpose) and
-- uploads it under a new, generic 'other' document type — there is no
-- per-industry requirement for it, it is just a bucket for anything that
-- does not fit gst/pan/udyam/cheque/profile/nda/cto/epr.
--
-- Every other doc_type on this site is "replace in place" — uploading a
-- second one supersedes the first (see supersede_previous_document() in
-- 01_schema.sql), which is right for a GST certificate but wrong here: two
-- different "other" documents (say, an ISO certificate and a rate card)
-- must both stay on file, not have the second bury the first. So this type
-- alone is excluded from the supersede trigger.
insert into public.document_type (code, label, applies_to, expiry_tracked, uploaded_by_party, is_certificate, sort)
values ('other', 'Other document', 'All', false, 'vendor', false, 9)
on conflict (code) do nothing;

create or replace function public.supersede_previous_document() returns trigger
language plpgsql as $$
begin
  if new.doc_type <> 'other' then
    update public.site_document
       set superseded_at = now()
     where site_id = new.site_id and doc_type = new.doc_type
       and id <> new.id and superseded_at is null;
  end if;
  return new;
end $$;
