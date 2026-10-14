-- Replaces the single flat plant_* columns (sql/30_plant_address_fields.sql,
-- merged minutes earlier, not yet used by any real record) with one JSONB
-- array -- the Address step now repeats the plant block once per plant
-- counted in "How many plants?", which a fixed set of scalar columns cannot
-- represent. Each array element holds the same facts the old columns did:
-- name, product, address_line1, city, state, pincode, gstin, contact_name,
-- contact_mobile, contact_email.

alter table public.vendor_site drop constraint if exists plant_pincode_format;
alter table public.vendor_site drop constraint if exists plant_gstin_format;
alter table public.vendor_site drop constraint if exists plant_contact_mobile_format;

alter table public.vendor_site
  drop column if exists plant_name,
  drop column if exists plant_product,
  drop column if exists plant_address_line1,
  drop column if exists plant_city,
  drop column if exists plant_state,
  drop column if exists plant_pincode,
  drop column if exists plant_gstin,
  drop column if exists plant_contact_name,
  drop column if exists plant_contact_mobile,
  drop column if exists plant_contact_email;

alter table public.vendor_site
  add column if not exists plants jsonb not null default '[]'::jsonb;
