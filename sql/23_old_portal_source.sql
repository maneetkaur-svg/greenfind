-- A new batch of vendors is being onboarded from a spreadsheet the old
-- (pre-GreenFind) vendor-approval process produced, with its own locally
-- saved documents — distinct from both the legacy bulk import done earlier
-- this project ('import') and a brand-new vendor added by staff ('manual').
--
-- Run this one BY ITSELF, same reason as sql/13 (warehouse): Postgres will
-- not let a statement that uses a brand-new enum value run in the same
-- transaction that added it. The script that sets source = 'old_portal'
-- is a separate step, run only after this is confirmed applied.
alter type vendor_source add value if not exists 'old_portal';
