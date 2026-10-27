-- Run this AFTER sql/52_full_vendor_signup_enum.sql has committed on its own.
--
-- Backs /onboard/full ("Complete Vendor Onboarding") -- a second, public,
-- no-login form alongside the existing quick one (app/onboard,
-- public_vendor_signup). Where the quick form takes a handful of fields
-- to start a conversation, this one lets a vendor fill in literally every
-- section the internal Add Vendor wizard does (new/Wizard.tsx): identity,
-- commercials, banking, agreements, operations/fleet, CTO/EPR, three
-- contacts, every category, geography, and every document -- in one
-- sitting, with no staff involvement until review.
--
-- Same ground rules as public_vendor_signup: security definer because an
-- anonymous caller cannot write directly; every validation the app does in
-- JS is re-done here because nothing from that caller can be trusted;
-- the row always lands as status = 'pending', so nothing becomes a live,
-- active vendor without a staff member reviewing it through the normal app;
-- a company that already exists under the submitted PAN is refused rather
-- than silently linked.
--
-- Two things this file also does, because both are needed to show the
-- document step on this form and to accept its uploads afterward:
--   1. public_document_requirements() -- the same kind of narrow read-only
--      RPC as public_service_categories, for a table anon otherwise cannot
--      read at all (sql/02_security.sql).
--   2. public_attach_document is redefined so its allowed doc_type list is
--      no longer the three hardcoded codes the quick form happens to use
--      (gst, pan, udyam) -- it now checks document_requirement for the
--      site's own industry instead, so this form's wider set of documents
--      (cheque, profile, nda, cto, epr) can attach too, plus the free-form
--      'other' every document step in this app allows.
create or replace function public.public_document_requirements()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'industry', r.industry, 'code', r.doc_type, 'level', r.level,
    'label', t.label, 'applies_to', t.applies_to,
    'expiry_tracked', t.expiry_tracked, 'uploaded_by_party', t.uploaded_by_party,
    'sort', t.sort
  ) order by r.industry, t.sort), '[]'::jsonb)
  from public.document_requirement r
  join public.document_type t on t.code = r.doc_type;
$$;

grant execute on function public.public_document_requirements() to anon;


create or replace function public.public_vendor_signup_full(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gstin       text := upper(trim(p->>'gstin'));
  v_pan         text;
  v_pan_typed   text := upper(trim(coalesce(p->>'pan_number', '')));
  v_industry    text := p->>'industry';
  v_company     jsonb := coalesce(p->'company', '{}'::jsonb);
  v_site        jsonb := coalesce(p->'site', '{}'::jsonb);
  v_ops         jsonb := coalesce(p->'operations', '{}'::jsonb);
  v_certs       jsonb := coalesce(p->'certificates', '{}'::jsonb);
  v_contacts    jsonb := coalesce(p->'contacts', '[]'::jsonb);
  v_contact     jsonb;
  v_categories  uuid[] := array(
                   select (jsonb_array_elements_text(coalesce(p->'category_ids', '[]'::jsonb)))::uuid
                 );
  v_cat         uuid;
  v_subs        jsonb := coalesce(p->'subcategory_ids', '[]'::jsonb);
  v_states      jsonb := coalesce(p->'geography', '[]'::jsonb);
  v_geo_outside boolean := coalesce((v_site->>'geo_outside_india')::boolean, false);
  v_how_heard   text := nullif(trim(coalesce(p->>'how_heard', '')), '');
  v_first_time  boolean := (p->>'first_time_with_fitsol')::boolean;
  v_consent     boolean := coalesce((p->>'consent')::boolean, false);
  v_is_msme     boolean := coalesce((v_company->>'is_msme')::boolean, false);
  v_ifsc        text := upper(trim(coalesce(v_company->>'ifsc', '')));
  v_sub         uuid;
  v_state       text;
  v_rank        int := 0;
  v_company_id  uuid;
  v_code        text;
  v_site_id     uuid;
  v_site_cd     text;
  v_sub_count   int;
  v_has_ops     boolean;
  v_has_certs   boolean;
  v_uid         uuid := (select id from public.profile where id = auth.uid() and is_active);
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

  if coalesce(trim(v_company->>'legal_name'), '') = '' then
    raise exception 'Legal name is required.';
  end if;

  if v_industry is null or v_industry not in ('recycling','packaging','transportation','warehouse','scrap_trading') then
    raise exception 'Choose an industry type.';
  end if;

  if coalesce(v_site->>'address_line1','') = '' or coalesce(v_site->>'city','') = ''
     or coalesce(v_site->>'state','') = '' then
    raise exception 'Address, city and state are all required.';
  end if;
  if coalesce(v_site->>'pincode','') !~ '^[1-9][0-9]{5}$' then
    raise exception 'Pincode must be six digits and cannot start with zero.';
  end if;

  if v_is_msme and (coalesce(v_company->>'msme_category','') = '' or coalesce(v_company->>'udyam_number','') = '') then
    raise exception 'An MSME needs both an enterprise category and a Udyam number.';
  end if;
  if v_ifsc <> '' and v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
    raise exception 'IFSC must be eleven characters, like HDFC0000432.';
  end if;

  if not v_geo_outside and jsonb_array_length(v_states) = 0 then
    raise exception 'Pick at least one serviceable state, or mark this site as serving locations outside India.';
  end if;

  if not v_consent then
    raise exception 'You must agree to the data-use disclaimer to submit.';
  end if;

  if jsonb_array_length(v_contacts) < 2
     or coalesce(v_contacts->0->>'name','') = '' or coalesce(v_contacts->1->>'name','') = '' then
    raise exception 'A primary and a secondary contact are both required.';
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

  if array_length(v_categories, 1) is null or array_length(v_categories, 1) = 0 then
    raise exception 'Pick at least one service.';
  end if;
  foreach v_cat in array v_categories loop
    if not exists (select 1 from public.service_category
                   where id = v_cat and industry = v_industry::industry_type and is_active) then
      raise exception 'A chosen service does not belong to the chosen industry.';
    end if;
    select count(*) into v_sub_count from public.service_subcategory where category_id = v_cat;
    if v_sub_count > 0 and not exists (
      select 1 from jsonb_array_elements_text(v_subs) s
        join public.service_subcategory sc on sc.id = s::uuid
       where sc.category_id = v_cat
    ) then
      raise exception '%: pick at least one sub-category, or remove this service.',
        (select label from public.service_category where id = v_cat);
    end if;
  end loop;
  for v_sub in select (jsonb_array_elements_text(v_subs))::uuid loop
    if not exists (select 1 from public.service_subcategory where id = v_sub and category_id = any(v_categories)) then
      raise exception 'A chosen sub-category does not belong to any of the chosen services.';
    end if;
  end loop;

  if exists (select 1 from public.company where pan = v_pan and deleted_at is null) then
    raise exception 'A company with this PAN is already on record. Contact our team to add another site to it.';
  end if;

  v_code := public.next_company_code();
  insert into public.company (
    company_code, pan, legal_name, trade_name, is_msme, msme_category, udyam_number,
    year_established, website,
    proprietor_pan, proprietor_aadhaar_last4, proprietor_same_as_poc,
    bank_account_name, bank_account_number, ifsc, bank_branch,
    authorised_signatory, nda_status, nda_signed_date,
    turnover_current, turnover_previous, key_clients, serves_tier1_oem, credit_period_days,
    how_heard_about_fitsol, first_time_with_fitsol, data_consent_given, data_consent_at,
    migrated_from_portal, created_at, created_by
  ) values (
    v_code, v_pan, trim(v_company->>'legal_name'), nullif(trim(v_company->>'trade_name'), ''),
    v_is_msme, nullif(v_company->>'msme_category','')::msme_category, nullif(v_company->>'udyam_number',''),
    nullif(v_company->>'year_established','')::smallint, nullif(trim(v_company->>'website'), ''),
    nullif(upper(trim(coalesce(v_company->>'proprietor_pan',''))), ''),
    nullif(trim(coalesce(v_company->>'proprietor_aadhaar_last4','')), ''),
    coalesce((v_company->>'proprietor_same_as_poc')::boolean, false),
    nullif(trim(coalesce(v_company->>'bank_account_name','')), ''),
    nullif(trim(coalesce(v_company->>'bank_account_number','')), ''),
    nullif(v_ifsc, ''), nullif(trim(coalesce(v_company->>'bank_branch','')), ''),
    nullif(trim(coalesce(v_company->>'authorised_signatory','')), ''),
    nullif(v_company->>'nda_status','')::nda_status, nullif(v_company->>'nda_signed_date','')::date,
    nullif(v_company->>'turnover_current','')::numeric, nullif(v_company->>'turnover_previous','')::numeric,
    nullif(trim(coalesce(v_company->>'key_clients','')), ''),
    (v_company->>'serves_tier1_oem')::boolean, nullif(v_company->>'credit_period_days','')::smallint,
    v_how_heard, v_first_time, true, now(),
    false, now(), v_uid
  ) returning id into v_company_id;

  v_site_cd := public.next_site_code(v_company_id);
  begin
    insert into public.vendor_site (
      company_id, site_code, site_name, gstin, industry, address_line1, city, state, pincode,
      is_registered_address, plant_count, plants, geo_outside_india,
      status, migrated_from_portal, source, created_at, created_by
    ) values (
      v_company_id, v_site_cd, nullif(trim(coalesce(v_site->>'site_name','')), ''), v_gstin, v_industry::industry_type,
      v_site->>'address_line1', v_site->>'city', v_site->>'state', v_site->>'pincode',
      coalesce((v_site->>'is_registered_address')::boolean, true),
      nullif(v_site->>'plant_count','')::smallint, coalesce(v_site->'plants', '[]'::jsonb), v_geo_outside,
      'pending', false, 'public_form_full', now(), v_uid
    ) returning id into v_site_id;
  exception when others then
    delete from public.company where id = v_company_id;
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

  foreach v_cat in array v_categories loop
    insert into public.site_service_category (site_id, category_id) values (v_site_id, v_cat)
    on conflict do nothing;
  end loop;
  for v_sub in select (jsonb_array_elements_text(v_subs))::uuid loop
    insert into public.site_service_subcategory (site_id, subcategory_id) values (v_site_id, v_sub)
    on conflict do nothing;
  end loop;

  for v_state in select jsonb_array_elements_text(v_states) loop
    insert into public.site_geography (site_id, state) values (v_site_id, v_state)
    on conflict do nothing;
  end loop;

  -- Both entirely optional (same as the authenticated Add Vendor wizard) --
  -- only written at all if at least one field in them was actually filled.
  v_has_ops := (select bool_or(value is not null and value <> '""'::jsonb)
                from jsonb_each(v_ops));
  if v_has_ops then
    insert into public.site_operations (
      site_id, installed_capacity, capacity_unit, utilisation_pct, storage_capacity,
      products_made, minimum_order_qty, lead_time_days, machines, workers, employees,
      shifts_per_day, hours_per_shift, working_days_week, floor_area, power_backup,
      fleet_owned, fleet_attached, fleet_ev, fleet_cng, charging_infra, telematics_provider,
      drivers_on_roll, depots, lanes_served
    ) values (
      v_site_id,
      nullif(v_ops->>'installed_capacity','')::numeric, nullif(v_ops->>'capacity_unit',''),
      nullif(v_ops->>'utilisation_pct','')::numeric, nullif(v_ops->>'storage_capacity','')::numeric,
      nullif(v_ops->>'products_made',''), nullif(v_ops->>'minimum_order_qty','')::numeric,
      nullif(v_ops->>'lead_time_days','')::smallint, nullif(v_ops->>'machines','')::smallint,
      nullif(v_ops->>'workers','')::integer, nullif(v_ops->>'employees','')::integer,
      nullif(v_ops->>'shifts_per_day','')::smallint, nullif(v_ops->>'hours_per_shift','')::numeric,
      nullif(v_ops->>'working_days_week','')::smallint, nullif(v_ops->>'floor_area','')::numeric,
      (v_ops->>'power_backup')::boolean,
      nullif(v_ops->>'fleet_owned','')::integer, nullif(v_ops->>'fleet_attached','')::integer,
      nullif(v_ops->>'fleet_ev','')::integer, nullif(v_ops->>'fleet_cng','')::integer,
      nullif(v_ops->>'charging_infra',''), nullif(v_ops->>'telematics_provider',''),
      nullif(v_ops->>'drivers_on_roll','')::integer, nullif(v_ops->>'depots','')::integer,
      nullif(v_ops->>'lanes_served','')
    );
  end if;

  v_has_certs := (select bool_or(value is not null and value <> '""'::jsonb)
                  from jsonb_each(v_certs));
  if v_has_certs and v_industry in ('recycling', 'scrap_trading') then
    insert into public.site_certificate_data (
      site_id, cto_order_no, cto_valid_from, cto_valid_to,
      epr_reg_no, epr_issue_date, epr_valid_to
    ) values (
      v_site_id, nullif(v_certs->>'cto_order_no',''), nullif(v_certs->>'cto_valid_from','')::date,
      nullif(v_certs->>'cto_valid_to','')::date,
      nullif(v_certs->>'epr_reg_no',''), nullif(v_certs->>'epr_issue_date','')::date,
      nullif(v_certs->>'epr_valid_to','')::date
    );
  end if;

  return jsonb_build_object('company_code', v_code, 'site_code', v_site_cd, 'site_id', v_site_id);
end $$;

grant execute on function public.public_vendor_signup_full(jsonb) to anon;


-- Widened from the hardcoded ('gst','pan','udyam') so this form's document
-- step (cheque, profile, nda, cto, epr) and the free-form "anything else"
-- upload can attach too -- validated against document_requirement for the
-- site's own industry instead of a fixed list, so a new document type added
-- to that table later never needs this function touched again. The 'recent
-- pending public site' gate is unchanged -- still the one thing standing
-- between this and an anonymous caller attaching a file to any vendor at all.
-- p_doc_number/p_valid_until are new, trailing, and defaulted -- existing
-- callers (the quick form) pass the six original named arguments and never
-- see these two, so nothing about that call changes. Postgres identifies a
-- function by name AND parameter list, though, so a different argument
-- count is a distinct overload, not a replacement -- the old six-argument
-- version (sql/42/43, with the narrow gst/pan/udyam check) must be dropped
-- explicitly, or both would exist side by side and an anon caller could
-- still reach the stale, narrower one.
drop function if exists public.public_attach_document(text, text, text, text, bigint, text);

create or replace function public.public_attach_document(
  p_site_id text, p_doc_type text, p_storage_path text,
  p_file_name text, p_file_size bigint, p_mime_type text,
  p_doc_number text default null, p_valid_until date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_industry industry_type;
begin
  if not public.is_recent_pending_public_site(p_site_id) then
    raise exception 'This submission is no longer open for document uploads.';
  end if;

  select industry into v_industry from public.vendor_site where id = p_site_id::uuid;
  if p_doc_type <> 'other'
     and not exists (select 1 from public.document_requirement
                     where industry = v_industry and doc_type = p_doc_type) then
    raise exception 'That document type cannot be attached from the public form.';
  end if;

  insert into public.site_document (
    site_id, doc_type, storage_path, file_name, file_size, mime_type, doc_number, valid_until
  ) values (
    p_site_id::uuid, p_doc_type, p_storage_path, p_file_name, p_file_size, p_mime_type,
    nullif(p_doc_number, ''), p_valid_until
  ) returning id into v_id;

  return v_id;
end $$;

grant execute on function public.public_attach_document(text, text, text, text, bigint, text, text, date) to anon;
