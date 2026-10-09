-- The 'warehouse' industry (sql/13_add_warehouse_industry.sql) never got
-- document_requirement rows seeded for it, unlike every other industry.
-- The vendor list's "attached/required" count and the Documents tab are
-- both driven entirely by this table (per site.industry) — with zero rows
-- for 'warehouse', both silently degraded to 0/0 and an empty tab for every
-- warehouse vendor, even though their actual documents were never touched
-- and are still on file. This seeds the same baseline every non-recycling
-- industry already has (transportation, packaging): gst/pan/cheque
-- required, udyam conditional on MSME, profile optional, NDA required
-- (issued by Fitsol). Warehousing has no CTO/EPR requirement, same as
-- transportation and packaging.
insert into public.document_requirement (doc_type, industry, level, condition_note)
values
  ('gst',     'warehouse', 'required',    null),
  ('pan',     'warehouse', 'required',    null),
  ('cheque',  'warehouse', 'required',    'Must be on file before any payment is released'),
  ('udyam',   'warehouse', 'conditional', 'Only when is_msme is true'),
  ('profile', 'warehouse', 'optional',    null),
  ('nda',     'warehouse', 'required',    'Issued by Fitsol, returned signed')
on conflict (doc_type, industry) do nothing;
