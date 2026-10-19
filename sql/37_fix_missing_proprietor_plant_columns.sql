-- sql/27_proprietor_and_plant_fields.sql was apparently never actually run
-- against this database -- all four columns it adds (company.proprietor_pan,
-- company.proprietor_aadhaar_last4, company.proprietor_same_as_poc,
-- vendor_site.plant_count) were confirmed missing via a direct query
-- (Postgres error 42703, "column does not exist" -- a real missing column,
-- not a PostgREST schema-cache issue).
--
-- Since saveSection (app/(app)/vendors/[id]/actions.ts) always includes
-- every field in a section's update payload, whether or not it was
-- touched, this has been silently failing every single "Save KYB" on
-- every vendor the whole time these fields have been in lib/schema.ts --
-- not a new regression, just never caught until now.
--
-- Re-running sql/27's own content here, unchanged and idempotent.

alter table public.company
  add column if not exists proprietor_pan char(10),
  add column if not exists proprietor_aadhaar_last4 char(4),
  add column if not exists proprietor_same_as_poc boolean not null default false;

alter table public.company drop constraint if exists proprietor_pan_format;
alter table public.company add constraint proprietor_pan_format
  check (proprietor_pan is null or proprietor_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');

alter table public.company drop constraint if exists proprietor_aadhaar_last4_format;
alter table public.company add constraint proprietor_aadhaar_last4_format
  check (proprietor_aadhaar_last4 is null or proprietor_aadhaar_last4 ~ '^[0-9]{4}$');

alter table public.vendor_site
  add column if not exists plant_count smallint;
