-- Run after sql/54a-d have committed.
--
-- Backs a metric selector on the "Vendors onboarded timeline" chart:
-- Added (unchanged) / Became Unverified / Became Verified. core_complete
-- and banking_complete (site_summary, sql/01+54b/54d) are computed live --
-- nothing stores the MOMENT either one first became true. The only real
-- history available is public.audit_log (sql/01_schema.sql): a trigger-
-- written, append-only diff of every company/vendor_site/site_document
-- change, with a timestamp.
--
-- IMPORTANT LIMITATION, confirmed against the schema, not assumed: three
-- of core_complete's nine conditions -- has_primary_contact
-- (site_contact), has_service_category (site_service_category),
-- has_geography (site_geography) -- are existence checks against tables
-- that have NO audit trigger and NO created_at column. There is no way,
-- even in principle, to know exactly when those three became true for an
-- existing vendor; only whether they are true right now. This backfill
-- therefore deliberately leaves them OUT of the computed date -- a site's
-- "became Unverified" timestamp here is the later of its identity fields
-- and its required documents becoming ready, NOT also gated on contact/
-- category/geography. In practice these are usually filled in during the
-- same onboarding session as everything else, but if a vendor added its
-- contact or service category noticeably later than the rest, this
-- timestamp will read EARLIER than what truly happened -- a known,
-- one-directional (never late, sometimes early) approximation, not a bug.
--
-- Because this reads straight from audit_log rather than a snapshot taken
-- once, it stays correct automatically as more history accumulates --
-- there is no separate backfill run to repeat and no drift to manage.

-- Normalizes one audit_log row's "changed" column (a full `to_jsonb(new)`
-- snapshot on insert, an {field: [old, new]} diff on update) into "what
-- did this field become, if this row touched it at all".
create or replace function public.audit_new_value(p_action text, p_changed jsonb, p_field text)
returns text
language sql immutable
as $$
  select case
    when p_action = 'insert' then p_changed ->> p_field
    when p_changed ? p_field then p_changed -> p_field ->> 1
    else null
  end
$$;

-- For every site: the earliest timestamp each required condition first
-- held a non-empty value (per audit_new_value, "once set, never cleared"
-- assumed -- reasonable for an onboarding form), then combined with AND
-- (all required -> greatest, but null if ANY is still null) or OR (either
-- one -> least, Postgres's own null-skipping LEAST/GREATEST behavior is
-- exactly OR semantics here).
create or replace function public.site_status_timestamps()
returns table (site_id uuid, unverified_at timestamptz, verified_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with
  site_field_times as (
    select record_id as site_id,
      min(at) filter (where coalesce(public.audit_new_value(action, changed, 'address_line1'), '') <> '') as address_line1_at,
      min(at) filter (where coalesce(public.audit_new_value(action, changed, 'city'), '') <> '') as city_at,
      min(at) filter (where coalesce(public.audit_new_value(action, changed, 'state'), '') <> '') as state_at,
      min(at) filter (where coalesce(public.audit_new_value(action, changed, 'pincode'), '') <> '') as pincode_at,
      min(at) filter (where public.audit_new_value(action, changed, 'industry') is not null) as industry_at,
      min(at) filter (where coalesce(public.audit_new_value(action, changed, 'gstin'), '') <> '') as gstin_at,
      min(at) filter (where coalesce(public.audit_new_value(action, changed, 'aadhaar_last4'), '') <> '') as aadhaar_at
    from public.audit_log
    where table_name = 'vendor_site'
    group by record_id
  ),
  company_field_times as (
    select record_id as company_id,
      min(at) filter (where coalesce(public.audit_new_value(action, changed, 'legal_name'), '') <> '') as legal_name_at,
      min(at) filter (where coalesce(public.audit_new_value(action, changed, 'bank_account_name'), '') <> '') as bank_name_at,
      min(at) filter (where coalesce(public.audit_new_value(action, changed, 'bank_account_number'), '') <> '') as bank_acct_at,
      min(at) filter (where coalesce(public.audit_new_value(action, changed, 'ifsc'), '') <> '') as ifsc_at,
      min(at) filter (where coalesce(public.audit_new_value(action, changed, 'bank_branch'), '') <> '') as bank_branch_at
    from public.audit_log
    where table_name = 'company'
    group by record_id
  ),
  doc_first_upload as (
    -- site_document's own audit rows are keyed by the document's id, not
    -- the site's -- site_id and doc_type live inside the insert snapshot.
    select
      (changed ->> 'site_id')::uuid as site_id,
      changed ->> 'doc_type' as doc_type,
      min(at) as first_at
    from public.audit_log
    where table_name = 'site_document' and action = 'insert'
    group by 1, 2
  ),
  required_docs as (
    select s.id as site_id, r.doc_type
    from public.vendor_site s
    join public.document_requirement r on r.industry = coalesce(s.industry, 'transportation')
    join public.document_type t on t.code = r.doc_type
    where r.level = 'required' and t.uploaded_by_party = 'vendor'
  ),
  docs_ready as (
    select s.id as site_id,
      case
        -- no required doc types for this industry -> ready since creation
        when not exists (select 1 from required_docs rd where rd.site_id = s.id) then s.created_at
        -- at least one required type was never uploaded -> not ready
        when exists (
          select 1 from required_docs rd
          where rd.site_id = s.id
            and not exists (select 1 from doc_first_upload du where du.site_id = rd.site_id and du.doc_type = rd.doc_type)
        ) then null
        else (
          select max(du.first_at) from required_docs rd
          join doc_first_upload du on du.site_id = rd.site_id and du.doc_type = rd.doc_type
          where rd.site_id = s.id
        )
      end as docs_ready_at
    from public.vendor_site s
  ),
  identity_ready as (
    select s.id as site_id,
      case
        when sft.address_line1_at is null or sft.city_at is null or sft.state_at is null
          or sft.pincode_at is null or sft.industry_at is null or cft.legal_name_at is null
          or least(sft.gstin_at, sft.aadhaar_at) is null
        then null
        else greatest(sft.address_line1_at, sft.city_at, sft.state_at, sft.pincode_at,
                       sft.industry_at, cft.legal_name_at, least(sft.gstin_at, sft.aadhaar_at))
      end as identity_ready_at
    from public.vendor_site s
    join public.company c on c.id = s.company_id
    left join site_field_times sft on sft.site_id = s.id
    left join company_field_times cft on cft.company_id = c.id
  ),
  banking_ready as (
    select c.id as company_id,
      case
        when cft.bank_name_at is null or cft.bank_acct_at is null or cft.ifsc_at is null or cft.bank_branch_at is null
        then null
        else greatest(cft.bank_name_at, cft.bank_acct_at, cft.ifsc_at, cft.bank_branch_at)
      end as banking_ready_at
    from public.company c
    left join company_field_times cft on cft.company_id = c.id
  )
  select
    ss.id as site_id,
    case when ss.core_complete then greatest(ir.identity_ready_at, dr.docs_ready_at) else null end as unverified_at,
    case when ss.core_complete and ss.banking_complete
         then greatest(ir.identity_ready_at, dr.docs_ready_at, br.banking_ready_at)
         else null end as verified_at
  from public.site_summary ss
  join identity_ready ir on ir.site_id = ss.id
  join docs_ready dr on dr.site_id = ss.id
  join banking_ready br on br.company_id = ss.company_id;
$$;

revoke all on function public.site_status_timestamps() from public;
grant execute on function public.site_status_timestamps() to authenticated;
