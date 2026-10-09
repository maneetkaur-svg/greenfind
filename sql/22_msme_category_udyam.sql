-- The public form now collects enterprise category and Udyam number
-- whenever "Registered as MSME?" is Yes — the same requirement the rest of
-- the app already enforces (company.msme_complete, sql/06_data_fit.sql),
-- so this needs no schema or constraint change at all, just the RPC
-- actually asking for and inserting the two fields instead of leaving them
-- null. Replaces the self_registered escape hatch from the previous
-- revision of this migration, which is no longer needed now that the form
-- supplies complete data instead of bypassing the check.
create or replace function public.public_vendor_signup(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gstin         text := upper(trim(p->>'gstin'));
  v_pan           text;
  v_pan_typed     text := upper(trim(coalesce(p->>'pan_number', '')));
  v_industry      text := p->>'industry';
  v_legal         text := trim(coalesce(p->>'legal_name', ''));
  v_is_msme       boolean := coalesce((p->>'is_msme')::boolean, false);
  v_msme_category text := nullif(trim(coalesce(p->>'msme_category', '')), '');
  v_udyam_number  text := nullif(trim(coalesce(p->>'udyam_number', '')), '');
  v_site          jsonb := coalesce(p->'site', '{}'::jsonb);
  v_contacts      jsonb := coalesce(p->'contacts', '[]'::jsonb);
  v_contact       jsonb;
  v_category      uuid := nullif(p->>'category_id', '')::uuid;
  v_subs          jsonb := coalesce(p->'subcategory_ids', '[]'::jsonb);
  v_states        jsonb := coalesce(p->'geography', '[]'::jsonb);
  v_how_heard     text := nullif(trim(coalesce(p->>'how_heard', '')), '');
  v_first_time    boolean := (p->>'first_time_with_fitsol')::boolean;
  v_consent       boolean := coalesce((p->>'consent')::boolean, false);
  v_sub           uuid;
  v_state         text;
  v_rank          int := 0;
  v_company       uuid;
  v_code          text;
  v_site_id       uuid;
  v_site_cd       text;
  v_sub_count     int;
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

  if v_is_msme and (v_msme_category is null or v_udyam_number is null) then
    raise exception 'An MSME needs both an enterprise category and a Udyam number.';
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
    company_code, pan, legal_name, is_msme, msme_category, udyam_number,
    how_heard_about_fitsol, first_time_with_fitsol, data_consent_given, data_consent_at,
    migrated_from_portal, created_at
  ) values (
    v_code, v_pan, v_legal, v_is_msme, v_msme_category::msme_category, v_udyam_number,
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
