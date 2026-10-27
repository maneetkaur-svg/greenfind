-- Consent to Operate and EPR registration now apply to Scrap Trading too,
-- same as Recycling (same required documents, same condition notes).
-- Applied directly to the live database (a data insert using the already-
-- committed scrap_trading enum value, not a schema change); this file is
-- the record of it.
insert into public.document_requirement (doc_type, industry, level, condition_note)
values
  ('cto', 'scrap_trading', 'required', 'Consent to Operate from the state pollution control board'),
  ('epr', 'scrap_trading', 'required', 'Plastic waste processor or PIBO registration')
on conflict (doc_type, industry) do nothing;
