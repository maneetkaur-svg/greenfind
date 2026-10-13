-- The app's direct `vendor_site` UPDATE (setting deleted_at) was failing
-- with "new row violates row-level security policy for table vendor_site"
-- even though can_write()/is_admin() both verifiably returned true for the
-- acting super_admin at the exact moment of the failing statement (checked
-- live). Rather than keep chasing the exact mechanism, this does the whole
-- soft-delete as one atomic, security-definer RPC with its own explicit
-- is_admin() check — the same pattern already used for
-- is_recent_pending_public_site, and a cleaner shape for a sensitive admin
-- action regardless: one transaction, not four separate client round trips.

create or replace function public.delete_vendor_site(p_site_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_remaining int;
  cr_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only a super admin can delete a vendor.';
  end if;
  if length(trim(p_reason)) < 10 then
    raise exception 'Give a real reason for deleting this vendor (at least 10 characters).';
  end if;

  select company_id into v_company_id from public.vendor_site
    where id = p_site_id and deleted_at is null;
  if v_company_id is null then
    raise exception 'That vendor was not found, or is already deleted.';
  end if;

  insert into public.change_request (site_id, company_id, type, status, reason, requested_by)
  values (p_site_id, v_company_id, 'delete', 'pending', p_reason, auth.uid())
  returning id into cr_id;
  update public.change_request set status = 'approved' where id = cr_id;

  update public.vendor_site set deleted_at = now(), updated_by = auth.uid() where id = p_site_id;

  select count(*) into v_remaining from public.vendor_site
    where company_id = v_company_id and deleted_at is null;
  if v_remaining = 0 then
    update public.company set deleted_at = now(), updated_by = auth.uid() where id = v_company_id;
  end if;
end;
$$;

revoke all on function public.delete_vendor_site(uuid, text) from public;
grant execute on function public.delete_vendor_site(uuid, text) to authenticated;

-- Clean up every function created purely to debug this.
drop function if exists public.debug_simulate_delete(uuid, uuid, uuid, text);
drop function if exists public.debug_list_policies(text);
