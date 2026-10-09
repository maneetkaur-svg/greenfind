-- Tracks how each vendor_site was created, so the master list can show it
-- (requested: "every vendor source, created by - import"). Backfilled from
-- the one signal already on record: migrated_from_portal distinguishes the
-- original legacy-system import from everything created in this app since,
-- which until today was only ever the authenticated Add Vendor wizard —
-- hence 'manual' for every existing non-imported row.
do $$ begin
  create type vendor_source as enum ('import', 'manual', 'public_form');
exception when duplicate_object then null;
end $$;

alter table public.vendor_site add column if not exists source vendor_source;

update public.vendor_site
   set source = case when migrated_from_portal then 'import' else 'manual' end
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

-- Same reason: public_vendor_signup (sql/18) was defined before this column
-- existed, so it needs to be redefined now that it does, to set
-- source = 'public_form' instead of falling back to the 'manual' default.
-- Everything else here is identical to sql/18 — only the vendor_site
-- insert's column list and values change.
create or replace function public.public_vendor_signup(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gstin      text := upper(trim(p->>'gstin'));
  v_pan        text;
  v_pan_typed  text := upper(trim(coalesce(p->>'pan_number', '')));
  v_industry   text := p->>'industry';
  v_legal      text := trim(coalesce(p->>'legal_name', ''));
  v_site       jsonb := coalesce(p->'site', '{}'::jsonb);
  v_contacts   jsonb := coalesce(p->'contacts', '[]'::jsonb);
  v_contact    jsonb;
  v_category   uuid := nullif(p->>'category_id', '')::uuid;
  v_subs       jsonb := coalesce(p->'subcategory_ids', '[]'::jsonb);
  v_states     jsonb := coalesce(p->'geography', '[]'::jsonb);
  v_how_heard  text := nullif(trim(coalesce(p->>'how_heard', '')), '');
  v_first_time boolean := (p->>'first_time_with_fitsol')::boolean;
  v_consent    boolean := coalesce((p->>'consent')::boolean, false);
  v_sub        uuid;
  v_state      text;
  v_rank       int := 0;
  v_company    uuid;
  v_code       text;
  v_site_id    uuid;
  v_site_cd    text;
  v_sub_count  int;
begin
  if v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$' then
    raise exception 'That GSTIN is not valid. Fifteen characters, with the PAN inside it.';
  end if;
  v_pan := substring(v_gstin from 3 for 10);
  if v_pan_typed = '' then
    raise exception 'PAN number is required.';
  end if;
  if v_pan_typed <> v_pan then
    raise exception 'The PAN you entered does not match the one inside your GSTIN. Please check both.';
  end if;

  if v_legal = '' then
    raise exception 'Legal name is required.';
  end if;

  if v_industry is null or v_industry not in ('recycling','packaging','transportation','warehouse') then
    raise exception 'Choose an industry type.';
  end if;

  if coalesce(v_site->>'address_line1','') = '' or coalesce(v_site->>'city','') = ''
     or coalesce(v_site->>'state','') = '' then
    raise exception 'Address, city and state are all required.';
  end if;
  if coalesce(v_site->>'pincode','') !~ '^[1-9][0-9]{5}$' then
    raise exception 'Pincode must be six digits and cannot start with zero.';
  end if;

  if not v_consent then
    raise exception 'You must agree to the data-use disclaimer to submit.';
  end if;

  if jsonb_array_length(v_contacts) = 0 or coalesce(v_contacts->0->>'name','') = '' then
    raise exception 'The primary contact needs a name.';
  end if;
  for v_contact in select * from jsonb_array_elements(v_contacts) loop
    if coalesce(v_contact->>'name','') <> '' then
      if coalesce(v_contact->>'mobile','') !~ '^[6-9][0-9]{9}$' then
        raise exception '%: mobile must be ten digits starting 6 to 9.', v_contact->>'name';
      end if;
      if coalesce(v_contact->>'email','') <> '' and v_contact->>'email' !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
        raise exception '%: that email does not look right.', v_contact->>'name';
      end if;
    end if;
  end loop;

  if v_category is null then
    raise exception 'Pick a service.';
  end if;
  if not exists (select 1 from public.service_category
                 where id = v_category and industry = v_industry::industry_type and is_active) then
    raise exception 'That service does not belong to the chosen industry.';
  end if;

  select count(*) into v_sub_count from public.service_subcategory where category_id = v_category;
  if v_sub_count > 0 and jsonb_array_length(v_subs) = 0 then
    raise exception 'Pick at least one sub-category.';
  end if;
  for v_sub in select (jsonb_array_elements_text(v_subs))::uuid loop
    if not exists (select 1 from public.service_subcategory where id = v_sub and category_id = v_category) then
      raise exception 'A chosen sub-category does not belong to the chosen service.';
    end if;
  end loop;

  if exists (select 1 from public.company where pan = v_pan and deleted_at is null) then
    raise exception 'A company with this PAN is already on record. Contact our team to add another site to it.';
  end if;

  v_code := public.next_company_code();
  insert into public.company (
    company_code, pan, legal_name, is_msme,
    how_heard_about_fitsol, first_time_with_fitsol, data_consent_given, data_consent_at,
    migrated_from_portal, created_at
  ) values (
    v_code, v_pan, v_legal, coalesce((p->>'is_msme')::boolean, false),
    v_how_heard, v_first_time, true, now(),
    false, now()
  ) returning id into v_company;

  v_site_cd := public.next_site_code(v_company);
  begin
    insert into public.vendor_site (
      company_id, site_code, site_name, gstin, industry, address_line1, city, state, pincode,
      status, migrated_from_portal, source, created_at
    ) values (
      v_company, v_site_cd, nullif(v_site->>'location',''), v_gstin, v_industry::industry_type,
      v_site->>'address_line1', v_site->>'city', v_site->>'state', v_site->>'pincode',
      'pending', false, 'public_form', now()
    ) returning id into v_site_id;
  exception when others then
    delete from public.company where id = v_company;
    if sqlerrm like '%site_unique%' then
      raise exception 'A site with this GSTIN and pincode is already on record.';
    end if;
    raise;
  end;

  for v_contact in select * from jsonb_array_elements(v_contacts) loop
    if coalesce(v_contact->>'name','') <> '' then
      v_rank := v_rank + 1;
      insert into public.site_contact (site_id, rank, name, designation, mobile, email)
      values (v_site_id, v_rank, v_contact->>'name', nullif(v_contact->>'designation',''),
              v_contact->>'mobile', nullif(v_contact->>'email',''));
    end if;
  end loop;

  insert into public.site_service_category (site_id, category_id) values (v_site_id, v_category);
  for v_sub in select (jsonb_array_elements_text(v_subs))::uuid loop
    insert into public.site_service_subcategory (site_id, subcategory_id) values (v_site_id, v_sub);
  end loop;

  for v_state in select jsonb_array_elements_text(v_states) loop
    insert into public.site_geography (site_id, state) values (v_site_id, v_state)
    on conflict do nothing;
  end loop;

  return jsonb_build_object('company_code', v_code, 'site_code', v_site_cd, 'site_id', v_site_id);
end $$;

grant execute on function public.public_vendor_signup(jsonb) to anon;
