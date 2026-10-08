-- ============================================================
-- GREENFIND — 12 DROP CIN CONSTRAINT
-- Run AFTER 11_drop_trade_name.sql. Safe to re-run.
--
-- cin_when_company (01_schema.sql) required a CIN before entity could be
-- set to pvt_ltd / public_ltd / llp — a sensible rule when entity was
-- manually typed, but CIN was never captured for most of this vendor base
-- (DATA-FIT.md already notes it as "required, unless migrated" and mostly
-- blank). Now that entity is read automatically from the GSTIN
-- (lib/gstVerify.ts) rather than typed in, this constraint only blocks a
-- real, GST-confirmed result from being saved — it was hit on 16 of the
-- first 35 vendors verified. Dropped outright rather than scoped to
-- migrated records, because entity is no longer manually editable by
-- anyone, old vendor or new: the only way it gets set at all is this one
-- automatic, GST-sourced path.
-- ============================================================

alter table public.company drop constraint if exists cin_when_company;

-- ------------------------------------------------------------
-- CHECK — should no longer be listed
-- ------------------------------------------------------------
select conname from pg_constraint
where conrelid = 'public.company'::regclass and conname = 'cin_when_company';
