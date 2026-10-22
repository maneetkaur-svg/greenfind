-- Onboarding a new vendor no longer requires Payments and Banking (bank
-- account name, account number, IFSC, bank branch) or the cancelled
-- cheque / NDA documents to be filled in up front -- all of it can be
-- added later, same as before this was ever enforced. The app-side
-- required flags/checks (lib/schema.ts, Wizard.tsx's problems()) are
-- removed in the same change; this is the one piece that lives in the
-- database -- document_requirement.level, which drives the REQUIRED/
-- OPTIONAL chip on the Add Vendor wizard's document cards and (for
-- doc_type 'cheque', the only one of the two uploaded by the vendor)
-- the vendor master list's docs_required count.
update public.document_requirement
   set level = 'optional'
 where doc_type in ('cheque', 'nda')
   and level = 'required';
