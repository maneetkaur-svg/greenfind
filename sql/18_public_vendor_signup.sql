-- Backs the public, no-login vendor sign-up form (app/onboard). Unlike
-- import_vendor_group (security invoker — relies on the caller already
-- being an authenticated, RLS-permitted user), this is called by an
-- anonymous visitor, so it must be security definer to write at all; every
-- validation the authenticated wizard does in JS (new/actions.ts) is
-- re-done here in SQL, because nothing from an anonymous caller can be
-- trusted. A submission always lands as status = 'pending', regardless of
-- what is sent, so nothing becomes a live, active vendor without a staff
-- member reviewing it first through the normal app. A company that
-- already exists under the submitted PAN is refused rather than silently
-- linked — a stranger attaching an unverified new site to an existing
-- vendor's record is a worse outcome than asking them to contact the team.
--
-- Fields, matching the form exactly: legal name; GSTIN (PAN is read off
-- it, same as everywhere else in the app — never independently typed);
-- industry; registered address; one service category and its
-- sub-categories; serviceable states; one point of contact; a location
-- label. GST/PAN document uploads are a separate step after this returns
-- (see sql/19_public_doc_upload.sql) — they need a site to attach to,
-- which does not exist until this function creates it.
create or replace function public.public_vendor_signup(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gstin     text := upper(trim(p->>'gstin'));
  v_pan       text;
  v_industry  text := p->>'industry';
  v_legal     text := trim(coalesce(p->>'legal_name', ''));
  v_site      jsonb := coalesce(p->'site', '{}'::jsonb);
  v_contact   jsonb := coalesce(p->'contact', '{}'::jsonb);
  v_category  uuid := nullif(p->>'category_id', '')::uuid;
  v_subs      jsonb := coalesce(p->'subcategory_ids', '[]'::jsonb);
  v_states    jsonb := coalesce(p->'geography', '[]'::jsonb);
  v_sub       uuid;
  v_state     text;
  v_company   uuid;
  v_code      text;
  v_site_id   uuid;
  v_site_cd   text;
  v_sub_count int;
begin
  if v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$' then
    raise exception 'That GSTIN is not valid. Fifteen characters, with the PAN inside it.';
  end if;
  v_pan := substring(v_gstin from 3 for 10);

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

  if coalesce(v_contact->>'name','') = '' then
    raise exception 'The point of contact needs a name.';
  end if;
  if coalesce(v_contact->>'mobile','') !~ '^[6-9][0-9]{9}$' then
    raise exception 'Mobile must be ten digits starting 6 to 9.';
  end if;
  if coalesce(v_contact->>'email','') <> '' and v_contact->>'email' !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    raise exception 'That email does not look right.';
  end if;

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
  insert into public.company (company_code, pan, legal_name, migrated_from_portal, created_at)
  values (v_code, v_pan, v_legal, false, now())
  returning id into v_company;

  v_site_cd := public.next_site_code(v_company);
  begin
    insert into public.vendor_site (
      company_id, site_code, site_name, gstin, industry, address_line1, city, state, pincode,
      status, migrated_from_portal, created_at
    ) values (
      v_company, v_site_cd, nullif(v_site->>'location',''), v_gstin, v_industry::industry_type,
      v_site->>'address_line1', v_site->>'city', v_site->>'state', v_site->>'pincode',
      'pending', false, now()
    ) returning id into v_site_id;
  exception when others then
    delete from public.company where id = v_company;
    if sqlerrm like '%site_unique%' then
      raise exception 'A site with this GSTIN and pincode is already on record.';
    end if;
    raise;
  end;

  insert into public.site_contact (site_id, rank, name, mobile, email)
  values (v_site_id, 1, v_contact->>'name', v_contact->>'mobile', nullif(v_contact->>'email',''));

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

-- Reference data the form needs to render the service/sub-category picker —
-- service_category and service_subcategory are otherwise only readable by
-- a signed-in user (sql/02_security.sql), which an anonymous visitor never
-- is. Read-only, no site-specific data, safe to expose narrowly like this.
create or replace function public.public_service_categories()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'industry', c.industry, 'code', c.code, 'label', c.label,
    'subs', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label) order by s.sort), '[]'::jsonb)
             from public.service_subcategory s where s.category_id = c.id)
  ) order by c.industry, c.sort), '[]'::jsonb)
  from public.service_category c where c.is_active;
$$;

grant execute on function public.public_service_categories() to anon;
