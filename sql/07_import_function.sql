-- ============================================================
-- GREENFIND — 07 IMPORT FUNCTION  (replaces the earlier 05_import.sql)
-- Run AFTER 06_data_fit.sql. Safe to re-run.
--
-- One call saves one company and its sites, all or nothing.
-- It is "security invoker": it runs as the signed-in user, so
-- row-level security still applies. A read-only user calling it
-- is refused by the same policies as everywhere else.
--
-- Input:
-- { "pan": "AYEPP3943P",
--   "company": { legal_name, credit_period_days, created_at, ... },   -- ignored if the PAN is already on record
--   "sites": [ { "row": 4,
--                "site": { gstin, industry, legacy_vendor_code, status, services_text, ... },
--                "contacts": [...], "geography": [...] } ] }
--
-- Output:
-- { "company_id": "...", "company_code": "VEN 007", "company_created": true,
--   "sites": [ { "row": 4, "ok": true, "site_code": "VEN 007-A" },
--              { "row": 5, "ok": false, "error": "..." } ] }
--
-- Imported records are always flagged migrated_from_portal. A site with no
-- status in the file lands as 'pending', never silently as 'active'.
-- ============================================================

create or replace function public.import_vendor_group(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pan      text := upper(p->>'pan');
  v_co       jsonb := coalesce(p->'company', '{}'::jsonb);
  v_company  uuid;
  v_code     text;
  v_created  boolean := false;
  v_item     jsonb;
  v_site     jsonb;
  v_site_id  uuid;
  v_site_cd  text;
  v_c        jsonb;
  v_state    text;
  v_results  jsonb := '[]'::jsonb;
  v_ok       int := 0;
  v_uid      uuid := auth.uid();
begin
  if v_pan is null or v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'PAN missing or malformed';
  end if;

  -- Already on record under this PAN? Then the sites attach to it and the
  -- company's own details are left exactly as they are.
  select id, company_code into v_company, v_code
    from public.company where pan = v_pan and deleted_at is null;

  if v_company is null then
    v_code := public.next_company_code();
    insert into public.company (
      company_code, pan, legal_name, trade_name, entity, cin, is_msme, msme_category,
      udyam_number, year_established, website, bank_account_name, bank_account_number,
      ifsc, bank_branch, cheque_on_file, authorised_signatory, nda_status, nda_signed_date,
      turnover_current, turnover_previous, key_clients, serves_tier1_oem,
      credit_period_days, credit_period_note,
      migrated_from_portal, created_at, created_by, updated_by
    ) values (
      v_code, v_pan, v_co->>'legal_name', v_co->>'trade_name',
      (v_co->>'entity')::entity_type, v_co->>'cin',
      coalesce((v_co->>'is_msme')::boolean, false), (v_co->>'msme_category')::msme_category,
      v_co->>'udyam_number', (v_co->>'year_established')::smallint, v_co->>'website',
      v_co->>'bank_account_name', v_co->>'bank_account_number', v_co->>'ifsc', v_co->>'bank_branch',
      coalesce((v_co->>'cheque_on_file')::boolean, false), v_co->>'authorised_signatory',
      (v_co->>'nda_status')::nda_status, (v_co->>'nda_signed_date')::date,
      (v_co->>'turnover_current')::numeric, (v_co->>'turnover_previous')::numeric,
      v_co->>'key_clients', (v_co->>'serves_tier1_oem')::boolean,
      (v_co->>'credit_period_days')::smallint, v_co->>'credit_period_note',
      true, coalesce((v_co->>'created_at')::timestamptz, now()), v_uid, v_uid
    ) returning id into v_company;
    v_created := true;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p->'sites', '[]'::jsonb)) loop
    v_site := v_item->'site';
    begin  -- a sub-transaction: one bad site undoes only itself
      v_site_cd := public.next_site_code(v_company);

      insert into public.vendor_site (
        company_id, site_code, site_name, pan, gstin, industry, address_line1, city, state, pincode,
        legacy_vendor_code, services_text, projects_text, status, aadhaar_last4, legacy_documents,
        migrated_from_portal, created_at, created_by, updated_by
      ) values (
        v_company, v_site_cd, v_site->>'site_name', v_pan, v_site->>'gstin',
        (v_site->>'industry')::industry_type, v_site->>'address_line1', v_site->>'city',
        v_site->>'state', v_site->>'pincode',
        v_site->>'legacy_vendor_code', v_site->>'services_text', v_site->>'projects_text',
        coalesce((v_site->>'status')::vendor_status, 'pending'),
        v_site->>'aadhaar_last4', nullif(v_site->'legacy_documents', 'null'::jsonb),
        true, coalesce((v_site->>'created_at')::timestamptz, now()), v_uid, v_uid
      ) returning id into v_site_id;

      for v_c in select * from jsonb_array_elements(coalesce(v_item->'contacts', '[]'::jsonb)) loop
        insert into public.site_contact (site_id, rank, name, designation, mobile, email)
        values (v_site_id, (v_c->>'rank')::smallint, v_c->>'name',
                nullif(v_c->>'designation',''), nullif(v_c->>'mobile',''), nullif(v_c->>'email',''));
      end loop;

      for v_state in select jsonb_array_elements_text(coalesce(v_item->'geography', '[]'::jsonb)) loop
        insert into public.site_geography (site_id, state) values (v_site_id, v_state)
        on conflict do nothing;
      end loop;

      v_ok := v_ok + 1;
      v_results := v_results || jsonb_build_object(
        'row', v_item->'row', 'ok', true, 'site_code', v_site_cd, 'site_id', v_site_id);
    exception when others then
      v_results := v_results || jsonb_build_object(
        'row', v_item->'row', 'ok', false,
        'error', case
          when sqlerrm like '%site_unique%' then
            'This GSTIN and pincode already exists (possibly a deleted record). Same plant, not a new one.'
          when sqlerrm like '%site_legacy_code_uq%' then
            'This vendor code is already on record (possibly a deleted record).'
          else sqlerrm end);
    end;
  end loop;

  -- A company created for sites that all failed would be left with nothing
  -- under it. Raising rolls the whole call back, company included.
  if v_created and v_ok = 0 then
    raise exception 'No site could be saved for this company: %',
      (select string_agg(r->>'error', ' | ') from jsonb_array_elements(v_results) r);
  end if;

  return jsonb_build_object(
    'company_id', v_company, 'company_code', v_code,
    'company_created', v_created, 'sites', v_results);
end $$;

grant execute on function public.import_vendor_group(jsonb) to authenticated;
