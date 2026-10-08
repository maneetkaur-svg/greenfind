-- Adds 'warehouse' as a new industry_type value, for the dashboard's new
-- Warehouse metric box and the vendors whose Services text says so.
--
-- Run this file BY ITSELF. Postgres will not let a statement that uses a
-- brand-new enum value run in the same transaction that added the value
-- (the value is not visible until that transaction commits), so the
-- reclassification of existing vendors is a separate step: after this
-- runs, `npm run reclassify:warehouse` in scripts/import.
alter type industry_type add value if not exists 'warehouse';
