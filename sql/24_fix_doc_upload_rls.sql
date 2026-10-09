-- sql/19's anon policies queried vendor_site directly inside their WITH CHECK.
-- That subquery is itself subject to vendor_site's own RLS (site_select requires
-- can_read(), i.e. a staff profile), so for role anon it always saw zero rows and
-- the check always failed -- regardless of whether the site was really pending.
-- Fix: do the lookup in a security-definer function that bypasses vendor_site's
-- RLS internally, and have the policies call that instead of querying the table.

create or replace function public.is_recent_pending_public_site(p_site_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.vendor_site s
    where s.id::text = p_site_id
      and s.status = 'pending'
      and s.created_at > now() - interval '1 hour'
  );
$$;

revoke all on function public.is_recent_pending_public_site(text) from public;
grant execute on function public.is_recent_pending_public_site(text) to anon;

drop policy if exists doc_insert_public_signup on public.site_document;
create policy doc_insert_public_signup on public.site_document for insert
  to anon
  with check (
    uploaded_by is null
    and doc_type in ('gst', 'pan')
    and public.is_recent_pending_public_site(site_id::text)
  );

drop policy if exists vdocs_write_public_signup on storage.objects;
create policy vdocs_write_public_signup on storage.objects for insert
  to anon
  with check (
    bucket_id = 'vendor-documents'
    and (storage.foldername(name))[2] in ('gst', 'pan')
    and public.is_recent_pending_public_site((storage.foldername(name))[1])
  );
