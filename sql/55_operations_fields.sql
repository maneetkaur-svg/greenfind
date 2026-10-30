-- Oct 2026 Operational Capacity redesign. Run after sql/54e has committed.
--
-- Deliberately additive only -- products_made, minimum_order_qty, workers,
-- employees, hours_per_shift and working_days_week are dropped from the
-- FORM (lib/schema.ts) but their columns are left in place here, not
-- dropped, so nothing already recorded against a live vendor is destroyed.
-- They are simply unused going forward.
--
-- has_storage_capacity: "Storage capacity" is now a Yes/No gate in front of
-- the existing numeric storage_capacity column (shown only when Yes).
-- manpower_skilled / manpower_unskilled / total_staff: replace the old
-- "Workers" and "Employees" pair.
-- moq_by_subcategory: minimum order quantity is no longer one number for
-- the whole site -- it's one per product (service sub-category) picked in
-- the KYB step, keyed by subcategory id: {"<subcategory_id>": 50, ...}.
alter table public.site_operations
  add column if not exists has_storage_capacity boolean,
  add column if not exists manpower_skilled      integer,
  add column if not exists manpower_unskilled    integer,
  add column if not exists total_staff           integer,
  add column if not exists moq_by_subcategory     jsonb;

-- KYB: whether what the vendor supplies is made in-house or outsourced.
alter table public.company
  add column if not exists manufactures_in_house boolean;
