-- Tracks how each vendor_site was created, so the master list can show it
-- (requested: "every vendor source, created by - import"). Backfilled from
-- the one signal already on record: migrated_from_portal distinguishes the
-- original legacy-system import from everything created in this app since,
-- which until today was only ever the authenticated Add Vendor wizard —
-- hence 'manual' for every existing non-imported row.
--
-- Split from one long file into two (20 and 21) purely so each one is
-- short enough to paste into the SQL editor without the paste getting cut
-- off partway through — that is what caused the "syntax error at end of
-- input" error. Run this one first, then sql/21_vendor_source_signup.sql.
do $$ begin
  create type vendor_source as enum ('import', 'manual', 'public_form');
exception when duplicate_object then null;
end $$;

alter table public.vendor_site add column if not exists source vendor_source;

update public.vendor_site
   set source = (case when migrated_from_portal then 'import' else 'manual' end)::vendor_source
 where source is null;

alter table public.vendor_site alter column source set default 'manual';
alter table public.vendor_site alter column source set not null;

create or replace view public.site_summary as
select
  s.id, s.site_code, s.site_name, s.gstin, s.industry, s.state, s.city, s.pincode,
  c.id as company_id, c.company_code, c.legal_name, c.pan,
  c.is_msme, c.msme_category,
  (select count(*) from public.vendor_site x
     where x.company_id = c.id and x.deleted_at is null) as sibling_sites,
  (select count(*) from public.site_document d
     where d.site_id = s.id and d.superseded_at is null
       and d.doc_type in (
         select r.doc_type from public.document_requirement r
         join public.document_type t on t.code = r.doc_type
         where r.industry = coalesce(s.industry, 'transportation') and r.level = 'required'
           and t.uploaded_by_party = 'vendor'
       )) as docs_attached,
  (select count(*) from public.site_document d
     where d.site_id = s.id and d.superseded_at is null and d.verified_at is not null) as docs_verified,
  (select count(*) from public.document_requirement r
     join public.document_type t on t.code = r.doc_type
     where r.industry = coalesce(s.industry, 'transportation') and r.level = 'required'
       and t.uploaded_by_party = 'vendor') as docs_required,
  (select min(d.valid_until) - 30 from public.site_document d
     where d.site_id = s.id and d.superseded_at is null and d.valid_until is not null) as reverification_due,
  case when c.year_established is null then null
       else extract(year from now())::int - c.year_established end as years_in_market,
  exists (select 1 from public.change_request cr
            where cr.site_id = s.id and cr.status = 'pending') as has_pending_request,
  s.migrated_from_portal, s.updated_at,
  s.status, s.legacy_vendor_code, s.services_text, c.credit_period_days,
  s.aadhaar_last4, s.source
from public.vendor_site s
join public.company c on c.id = s.company_id
where s.deleted_at is null and c.deleted_at is null;

alter view public.site_summary set (security_invoker = true);
revoke all on public.site_summary from anon;
grant select on public.site_summary to authenticated;
grant select on public.site_summary to service_role;

-- So a future run of the bulk importer (scripts/import, which calls this)
-- keeps tagging what it creates as 'import' too, rather than falling back
-- to the 'manual' column default.
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

  select id, company_code into v_company, v_code
    from public.company where pan = v_pan and deleted_at is null;

  if v_company is null then
    v_code := public.next_company_code();
    insert into public.company (
      company_code, pan, legal_name, entity, cin, is_msme, msme_category,
      udyam_number, year_established, website, bank_account_name, bank_account_number,
      ifsc, bank_branch, cheque_on_file, authorised_signatory, nda_status, nda_signed_date,
      turnover_current, turnover_previous, key_clients, serves_tier1_oem,
      credit_period_days, credit_period_note,
      migrated_from_portal, created_at, created_by, updated_by
    ) values (
      v_code, v_pan, v_co->>'legal_name',
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
    begin
      v_site_cd := public.next_site_code(v_company);

      insert into public.vendor_site (
        company_id, site_code, site_name, pan, gstin, industry, address_line1, city, state, pincode,
        legacy_vendor_code, services_text, projects_text, status, aadhaar_last4, legacy_documents,
        migrated_from_portal, source, created_at, created_by, updated_by
      ) values (
        v_company, v_site_cd, v_site->>'site_name', v_pan, v_site->>'gstin',
        (v_site->>'industry')::industry_type, v_site->>'address_line1', v_site->>'city',
        v_site->>'state', v_site->>'pincode',
        v_site->>'legacy_vendor_code', v_site->>'services_text', v_site->>'projects_text',
        coalesce((v_site->>'status')::vendor_status, 'pending'),
        v_site->>'aadhaar_last4', nullif(v_site->'legacy_documents', 'null'::jsonb),
        true, 'import', coalesce((v_site->>'created_at')::timestamptz, now()), v_uid, v_uid
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

  if v_created and v_ok = 0 then
    raise exception 'No site could be saved for this company: %',
      (select string_agg(r->>'error', ' | ') from jsonb_array_elements(v_results) r);
  end if;

  return jsonb_build_object(
    'company_id', v_company, 'company_code', v_code,
    'company_created', v_created, 'sites', v_results);
end $$;

grant execute on function public.import_vendor_group(jsonb) to authenticated;
