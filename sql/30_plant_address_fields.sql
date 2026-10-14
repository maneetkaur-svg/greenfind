-- Add Vendor wizard, Address step: restores the older "registered address +
-- separate plant address" shape. address_line1/city/state/pincode and
-- is_registered_address already exist and now read as the REGISTERED
-- address and "is the plant the same as it" -- only the label text changes,
-- not the columns. These new columns hold the plant's own details, asked
-- only when the plant address is not the registered address. All optional --
-- none of this blocks creating or saving a vendor.

alter table public.vendor_site
  add column if not exists plant_name text,
  add column if not exists plant_product text,
  add column if not exists plant_address_line1 text,
  add column if not exists plant_city text,
  add column if not exists plant_state varchar(100),
  add column if not exists plant_pincode char(6),
  add column if not exists plant_gstin varchar(15),
  add column if not exists plant_contact_name text,
  add column if not exists plant_contact_mobile varchar(10),
  add column if not exists plant_contact_email text;

alter table public.vendor_site drop constraint if exists plant_pincode_format;
alter table public.vendor_site add constraint plant_pincode_format
  check (plant_pincode is null or plant_pincode ~ '^[1-9][0-9]{5}$');

alter table public.vendor_site drop constraint if exists plant_gstin_format;
alter table public.vendor_site add constraint plant_gstin_format
  check (plant_gstin is null or plant_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$');

alter table public.vendor_site drop constraint if exists plant_contact_mobile_format;
alter table public.vendor_site add constraint plant_contact_mobile_format
  check (plant_contact_mobile is null or plant_contact_mobile ~ '^[6-9][0-9]{9}$');
