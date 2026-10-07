-- ============================================================
-- GREENFIND VENDOR MASTER — 02 SECURITY
-- Run after 01_schema.sql.
--
-- This is the file people skip. Your anon key ships to every
-- browser; without these policies anyone holding it can read
-- every vendor's bank details. With them, the database refuses.
--
-- Three roles:
--   super_admin  everything — edits directly, deletes, approves
--   operations   creates, verifies documents, requests changes
--   user         reads. No writes of any kind.
-- ============================================================

-- ------------------------------------------------------------
-- Helpers. security definer so they can read profile without
-- recursing through profile's own policies.
-- ------------------------------------------------------------
create or replace function public.my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from public.profile where id = auth.uid() and is_active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'super_admin', false)
$$;

-- operations and super_admin can write vendor data
create or replace function public.can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','operations'), false)
$$;

-- anyone with a profile can read
create or replace function public.can_read() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null
$$;


-- ------------------------------------------------------------
-- PROFILE
-- ------------------------------------------------------------
alter table public.profile enable row level security;

drop policy if exists profile_read on public.profile;
create policy profile_read on public.profile for select using (auth.uid() is not null);

drop policy if exists profile_self_update on public.profile;
create policy profile_self_update on public.profile for update
  using (id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    -- a user may edit their own name, but never their own role
    or (id = auth.uid() and role = (select role from public.profile where id = auth.uid()))
  );

drop policy if exists profile_admin_insert on public.profile;
create policy profile_admin_insert on public.profile for insert with check (public.is_admin());

drop policy if exists profile_admin_delete on public.profile;
create policy profile_admin_delete on public.profile for delete using (public.is_admin());


-- ------------------------------------------------------------
-- COMPANY and VENDOR_SITE
-- Writes are open to operations because the change-request
-- workflow is enforced in the application, not here. Deletion is
-- Super Admin only, and that IS enforced here.
-- ------------------------------------------------------------
alter table public.company enable row level security;

drop policy if exists company_select on public.company;
create policy company_select on public.company for select
  using (deleted_at is null and public.can_read());

drop policy if exists company_insert on public.company;
create policy company_insert on public.company for insert with check (public.can_write());

drop policy if exists company_update on public.company;
create policy company_update on public.company for update
  using (public.can_write()) with check (public.can_write());

drop policy if exists company_delete on public.company;
create policy company_delete on public.company for delete using (public.is_admin());


alter table public.vendor_site enable row level security;

drop policy if exists site_select on public.vendor_site;
create policy site_select on public.vendor_site for select
  using (deleted_at is null and public.can_read());

drop policy if exists site_insert on public.vendor_site;
create policy site_insert on public.vendor_site for insert with check (public.can_write());

drop policy if exists site_update on public.vendor_site;
create policy site_update on public.vendor_site for update
  using (public.can_write()) with check (public.can_write());

drop policy if exists site_delete on public.vendor_site;
create policy site_delete on public.vendor_site for delete using (public.is_admin());


-- ------------------------------------------------------------
-- CHILD TABLES — follow the site
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'site_contact','site_geography','site_service_category',
    'site_service_subcategory','site_operations','site_certificate_data'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (public.can_read())', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all
                      using (public.can_write()) with check (public.can_write())', t, t);
  end loop;
end $$;


-- ------------------------------------------------------------
-- DOCUMENTS
-- ------------------------------------------------------------
alter table public.site_document enable row level security;

drop policy if exists doc_select on public.site_document;
create policy doc_select on public.site_document for select using (public.can_read());

drop policy if exists doc_insert on public.site_document;
create policy doc_insert on public.site_document for insert
  with check (public.can_write() and uploaded_by = auth.uid());

drop policy if exists doc_update on public.site_document;
create policy doc_update on public.site_document for update
  using (public.can_write()) with check (public.can_write());

drop policy if exists doc_delete on public.site_document;
create policy doc_delete on public.site_document for delete using (public.is_admin());

-- A verification is stamped with whoever is actually signed in, not with
-- a name the client sent. This closes the obvious hole.
create or replace function public.stamp_verifier() returns trigger
language plpgsql as $$
begin
  if new.verified_at is not null
     and (old.verified_at is null or old.verified_by is distinct from new.verified_by) then
    new.verified_by := auth.uid();
    new.verified_at := now();
  end if;
  return new;
end $$;

drop trigger if exists doc_stamp on public.site_document;
create trigger doc_stamp before update on public.site_document
for each row execute function public.stamp_verifier();


-- ------------------------------------------------------------
-- CHANGE REQUESTS
-- Operations raises them. Only a Super Admin decides them.
-- ------------------------------------------------------------
alter table public.change_request enable row level security;

drop policy if exists cr_select on public.change_request;
create policy cr_select on public.change_request for select
  using (public.is_admin() or requested_by = auth.uid());

drop policy if exists cr_insert on public.change_request;
create policy cr_insert on public.change_request for insert
  with check (public.can_write() and requested_by = auth.uid() and status = 'pending');

-- only an admin can move a request out of pending
drop policy if exists cr_decide on public.change_request;
create policy cr_decide on public.change_request for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists cr_delete on public.change_request;
create policy cr_delete on public.change_request for delete using (public.is_admin());

-- and the decision is stamped server-side
create or replace function public.stamp_decider() returns trigger
language plpgsql as $$
begin
  if new.status <> old.status and new.status in ('approved','rejected') then
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end $$;

drop trigger if exists cr_stamp on public.change_request;
create trigger cr_stamp before update on public.change_request
for each row execute function public.stamp_decider();


-- ------------------------------------------------------------
-- AUDIT — readable, never writable from outside
-- ------------------------------------------------------------
alter table public.audit_log enable row level security;

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select using (public.can_read());
-- deliberately no insert, update or delete policy. Only the
-- security-definer trigger writes here. Append-only by design.


-- ------------------------------------------------------------
-- REFERENCE TABLES — everyone reads, Super Admin edits
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'service_category','service_subcategory','document_type','document_requirement'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (auth.uid() is not null)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all
                      using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end $$;


-- ------------------------------------------------------------
-- STORAGE — the private bucket that holds the actual files
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vendor-documents','vendor-documents', false, 10485760,
        array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['application/pdf','image/jpeg','image/png'];

drop policy if exists vdocs_read on storage.objects;
create policy vdocs_read on storage.objects for select
  using (bucket_id = 'vendor-documents' and public.can_read());

drop policy if exists vdocs_write on storage.objects;
create policy vdocs_write on storage.objects for insert
  with check (bucket_id = 'vendor-documents' and public.can_write());

drop policy if exists vdocs_delete on storage.objects;
create policy vdocs_delete on storage.objects for delete
  using (bucket_id = 'vendor-documents' and public.is_admin());

-- Never make this bucket public. It holds PAN cards and cancelled cheques.
-- Files are served through signed URLs that expire.


-- ------------------------------------------------------------
-- CHECK
-- ------------------------------------------------------------
select tablename,
       case when rowsecurity then 'RLS on' else '*** RLS OFF ***' end as status
from pg_tables where schemaname = 'public' order by tablename;
