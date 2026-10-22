-- Combined, one-paste run of everything currently pending against the live
-- database: sql/37, sql/38, sql/39 and sql/41, unchanged, concatenated in
-- order and wrapped in one transaction so it applies atomically -- either
-- all of it lands, or (if something unexpected fails) none of it does.
--
--   37 — adds company.proprietor_pan / proprietor_aadhaar_last4 /
--        proprietor_same_as_poc and vendor_site.plant_count, which were
--        confirmed missing live (the "could not find ... in the schema
--        cache" / "column does not exist" error on Save).
--   38 — adds site_summary.added_by_name (Source column "Added by" names
--        on the vendor master view).
--   39 — public_vendor_signup: drops MSME entirely from the public sign-up
--        form, makes the PAN upload optional, and attributes an External
--        site to the signed-in staff member who filled it in themselves.
--   41 — makes the cancelled cheque and NDA document requirements optional
--        instead of required, for every industry.
--
-- Run this once in the Supabase SQL editor instead of pasting each one
-- separately. Safe to re-run — every statement in it is idempotent.

begin;

-- ============================================================
-- sql/37_fix_missing_proprietor_plant_columns.sql
-- ============================================================

alter table public.company
  add column if not exists proprietor_pan char(10),
  add column if not exists proprietor_aadhaar_last4 char(4),
  add column if not exists proprietor_same_as_poc boolean not null default false;

alter table public.company drop constraint if exists proprietor_pan_format;
alter table public.company add constraint proprietor_pan_format
  check (proprietor_pan is null or proprietor_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');

alter table public.company drop constraint if exists proprietor_aadhaar_last4_format;
alter table public.company add constraint proprietor_aadhaar_last4_format
  check (proprietor_aadhaar_last4 is null or proprietor_aadhaar_last4 ~ '^[0-9]{4}$');

alter table public.vendor_site
  add column if not exists plant_count smallint;


-- ============================================================
-- sql/38_vendor_added_by.sql
-- ============================================================

create or replace view public.site_summary as
select
  s.id, s.site_code, s.site_name, s.gstin, s.industry, s.state, s.city, s.pincode,
  c.id as company_id, c.company_code, c.legal_name, c.trade_name, c.pan,
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
  s.aadhaar_last4, s.source,
  case
    when s.source in ('manual', 'public_form')
      then (select p.full_name from public.profile p where p.id = s.created_by)
    else null
  end as added_by_name
from public.vendor_site s
join public.company c on c.id = s.company_id
where s.deleted_at is null and c.deleted_at is null;

alter view public.site_summary set (security_invoker = true);
revoke all on public.site_summary from anon;
grant select on public.site_summary to authenticated;
grant select on public.site_summary to service_role;


-- ============================================================
-- sql/39_remove_public_msme.sql
-- ============================================================

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
  v_site          jsonb := coalesce(p->'site', '{}'::jsonb);
  v_contacts      jsonb := coalesce(p->'contacts', '[]'::jsonb);
  v_contact       jsonb;
  v_categories    uuid[] := array(
                     select (jsonb_array_elements_text(coalesce(p->'category_ids', '[]'::jsonb)))::uuid
                   );
  v_cat           uuid;
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
  v_uid           uuid := (select id from public.profile where id = auth.uid() and is_active);
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
  if coalesce(v_contacts->0->>'designation','') = '' then
    raise exception 'The primary contact needs a designation.';
  end if;
  if coalesce(v_contacts->0->>'email','') = '' then
    raise exception 'The primary contact needs an email address.';
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
    company_code, pan, legal_name,
    how_heard_about_fitsol, first_time_with_fitsol, data_consent_given, data_consent_at,
    migrated_from_portal, created_at
  ) values (
    v_code, v_pan, v_legal,
    v_how_heard, v_first_time, true, now(),
    false, now()
  ) returning id into v_company;

  v_site_cd := public.next_site_code(v_company);
  begin
    insert into public.vendor_site (
      company_id, site_code, site_name, gstin, industry, address_line1, city, state, pincode,
      status, migrated_from_portal, source, created_at, created_by
    ) values (
      v_company, v_site_cd, nullif(v_site->>'location',''), v_gstin, v_industry::industry_type,
      v_site->>'address_line1', v_site->>'city', v_site->>'state', v_site->>'pincode',
      'pending', false, 'public_form', now(), v_uid
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

  return jsonb_build_object('company_code', v_code, 'site_code', v_site_cd, 'site_id', v_site_id);
end $$;

grant execute on function public.public_vendor_signup(jsonb) to anon;


-- ============================================================
-- sql/41_optional_banking_and_cheque_nda.sql
-- ============================================================

update public.document_requirement
   set level = 'optional'
 where doc_type in ('cheque', 'nda')
   and level = 'required';

commit;
