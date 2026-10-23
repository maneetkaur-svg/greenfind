-- The anon document-upload RLS error on site_document (VEN 268-A, then
-- VEN 278-A again) traced back further than a bad policy: a direct SQL
-- editor test (`set role anon; insert into site_document ...`) succeeds
-- against the exact same policy that fails when the identical insert goes
-- through the REST API with the project's anon/publishable key. The
-- analogous storage.objects policy, using the same is_recent_pending_
-- public_site() check, works fine over the REST API with that same key.
-- So this is scoped specifically to PostgREST's handling of a raw table
-- INSERT on this one table -- not the policy itself, and not something
-- fixable by redefining the policy again.
--
-- Every other anonymous write in this app already goes through a security
-- definer RPC instead of a raw table insert (public_vendor_signup,
-- log_onboard_visit, submit_rfq_response...) -- site_document was the one
-- exception. RPC calls over the REST API with the same key are confirmed
-- working (is_recent_pending_public_site itself is called this way from
-- the client already), so moving document attachment onto an RPC too
-- sidesteps whatever is specific to table inserts, and brings it in line
-- with how everything else here is built.
create or replace function public.public_attach_document(
  p_site_id text, p_doc_type text, p_storage_path text,
  p_file_name text, p_file_size bigint, p_mime_type text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_doc_type not in ('gst', 'pan', 'udyam') then
    raise exception 'That document type cannot be attached from the public form.';
  end if;
  if not public.is_recent_pending_public_site(p_site_id) then
    raise exception 'This submission is no longer open for document uploads.';
  end if;

  insert into public.site_document (site_id, doc_type, storage_path, file_name, file_size, mime_type)
  values (p_site_id::uuid, p_doc_type, p_storage_path, p_file_name, p_file_size, p_mime_type)
  returning id into v_id;

  return v_id;
end $$;

grant execute on function public.public_attach_document(text, text, text, text, bigint, text) to anon;
