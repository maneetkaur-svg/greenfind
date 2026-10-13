-- Proprietor/OPC identity fields (Add Vendor wizard, Identity section) and
-- a "how many plants" field (Address section). All optional — none of this
-- blocks creating or saving a vendor.
--
-- Note: this app's entity_type enum has no distinct "One Person Company"
-- value (sql/01_schema.sql's entity_type: proprietorship, partnership, llp,
-- llc, pvt_ltd, public_ltd, trust, foreign) -- these fields key off
-- entity = 'proprietorship', the closest existing match. An OPC is legally
-- closer to a private company in structure, so flag this to a person if it
-- ever needs to be a real, distinct option later.

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
