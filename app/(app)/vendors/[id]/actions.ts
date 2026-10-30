'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import { SECTIONS } from '@/lib/schema';
import { RX } from '@/lib/constants';

export type SaveState = { error?: string; ok?: string };

/** Turns form values into the shape the column expects.
 *  An empty box means null, not an empty string, so numbers and dates
 *  do not fail on a blank. */
function coerce(type: string, raw: FormDataEntryValue | null) {
  const v = raw === null ? '' : String(raw).trim();
  if (type === 'bool') return v === 'true' ? true : v === 'false' ? false : null;
  if (v === '') return null;
  if (type === 'number' || type === 'currency') {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return v;
}

export async function saveSection(
  _prev: SaveState, formData: FormData
): Promise<SaveState> {
  const me = await getMe();
  if (!me) return { error: 'You are not signed in.' };
  if (me.role === 'user') return { error: 'Your role is read-only.' };

  const siteId = String(formData.get('__site_id') ?? '');
  const companyId = String(formData.get('__company_id') ?? '');
  const sectionId = String(formData.get('__section') ?? '');
  const section = SECTIONS.find(s => s.id === sectionId);
  if (!section || !siteId) return { error: 'Something is missing from the form.' };

  const values: Record<string, unknown> = {};
  for (const f of section.fields) {
    if (f.type === 'readonly') continue;
    // Super-Admin-only fields: never take a value from this submission unless
    // the signed-in user actually is one, or holds the named per-person
    // exception (sql/51_industry_edit_exception.sql) — a disabled control
    // submits nothing, which would otherwise read as "clear it". The
    // database enforces this rule too (see sql/09_industry_super_admin_only.sql
    // and guard_industry_change()).
    if (f.superAdminOnly && me.role !== 'super_admin' && !me.can_edit_vendor_industry) continue;
    values[f.key] = coerce(f.type, formData.get(f.key));
  }

  // The same checks the database enforces, reported in plain words first.
  if (section.id === 'identity') {
    if (!values.legal_name) return { error: 'Legal name cannot be empty.' };
    if (values.is_msme === true && (!values.msme_category || !values.udyam_number)) {
      // A vendor imported from the old portal may only say "MSME: Yes". New vendors may not.
      const { data: co } = await (await createClient()).from('company')
        .select('migrated_from_portal').eq('id', companyId).maybeSingle();
      if (!co?.migrated_from_portal)
        return { error: 'An MSME needs both an enterprise category and a Udyam number.' };
    }
    if (values.is_msme !== true) { values.msme_category = null; values.udyam_number = null; }
    const y = values.year_established as number | null;
    if (y !== null && (y < 1900 || y > new Date().getFullYear()))
      return { error: 'Year established must be between 1900 and this year.' };
  }
  if (section.id === 'banking') {
    const ifsc = values.ifsc as string | null;
    if (ifsc && !RX.ifsc.test(ifsc.toUpperCase()))
      return { error: 'IFSC must be eleven characters, like HDFC0000432.' };
    if (ifsc) values.ifsc = ifsc.toUpperCase();
  }
  if (section.id === 'operations') {
    // Not a plain Field -- one MOQ per product (service sub-category), named
    // moq__<subcategory_id> by SectionForm. Keyed on whatever is actually on
    // the form, so removing a sub-category elsewhere just stops that MOQ
    // being asked for rather than silently keeping a stale number.
    const moq: Record<string, number> = {};
    for (const [key, raw] of formData.entries()) {
      if (!key.startsWith('moq__')) continue;
      const v = String(raw).trim();
      if (v === '') continue;
      const n = Number(v);
      if (Number.isFinite(n)) moq[key.slice(5)] = n;
    }
    values.moq_by_subcategory = Object.keys(moq).length ? moq : null;
  }
  if (section.id === 'site') {
    const pin = values.pincode as string | null;
    if (pin && !RX.pincode.test(pin))
      return { error: 'Pincode must be six digits and cannot start with zero.' };
    // The repeating plant blocks aren't a plain Field (see SectionForm.tsx) —
    // read separately, and only kept when the plant address actually differs
    // from the registered one; otherwise there is nothing to save.
    if (values.is_registered_address === false) {
      try {
        const parsed = JSON.parse(String(formData.get('__plants') ?? '[]'));
        values.plants = Array.isArray(parsed) ? parsed : [];
      } catch {
        values.plants = [];
      }
    } else {
      values.plants = [];
    }
  }

  const supabase = await createClient();
  let error = null;

  if (section.table === 'company') {
    if (!companyId) return { error: 'No company on this record.' };
    ({ error } = await supabase.from('company')
      .update({ ...values, updated_by: me.id }).eq('id', companyId));
  } else if (section.table === 'vendor_site') {
    ({ error } = await supabase.from('vendor_site')
      .update({ ...values, updated_by: me.id }).eq('id', siteId));
  } else {
    // one row per site, created on first save
    ({ error } = await supabase.from(section.table)
      .upsert({ site_id: siteId, ...values }, { onConflict: 'site_id' }));
  }

  if (error) {
    if (error.message.includes('required_unless_migrated'))
      return { error: 'GSTIN, industry, address, city, state and pincode are all required for a vendor created in this app. Fill in every one.' };
    if (error.message.includes('msme_complete'))
      return { error: 'An MSME needs both an enterprise category and a Udyam number.' };
    return { error: error.message };
  }
  revalidatePath(`/vendors/${siteId}`);
  revalidatePath('/vendors');
  return { ok: 'Saved.' };
}

/** All three contacts in one go. */
export async function saveContacts(
  _prev: SaveState, formData: FormData
): Promise<SaveState> {
  const me = await getMe();
  if (!me) return { error: 'You are not signed in.' };
  if (me.role === 'user') return { error: 'Your role is read-only.' };

  const siteId = String(formData.get('__site_id') ?? '');
  if (!siteId) return { error: 'No site on this form.' };

  const supabase = await createClient();

  for (const rank of [1, 2, 3]) {
    const name = String(formData.get(`c${rank}_name`) ?? '').trim();
    const mobile = String(formData.get(`c${rank}_mobile`) ?? '').trim();
    const email = String(formData.get(`c${rank}_email`) ?? '').trim();

    if (rank <= 2 && !name)
      return { error: `Contact ${rank} needs a name. The first two are required.` };
    if (mobile && !RX.mobile.test(mobile))
      return { error: `Contact ${rank}: mobile must be ten digits starting 6 to 9.` };
    if (email && !RX.email.test(email))
      return { error: `Contact ${rank}: that email does not look right.` };

    if (!name) {
      await supabase.from('site_contact').delete().eq('site_id', siteId).eq('rank', rank);
      continue;
    }
    const { error } = await supabase.from('site_contact').upsert({
      site_id: siteId, rank, name,
      designation: String(formData.get(`c${rank}_designation`) ?? '').trim() || null,
      mobile: mobile || null, email: email || null,
    }, { onConflict: 'site_id,rank' });
    if (error) return { error: error.message };
  }

  revalidatePath(`/vendors/${siteId}`);
  return { ok: 'Contacts saved.' };
}

/** Serviceable states, replaced wholesale. */
export async function saveGeography(
  _prev: SaveState, formData: FormData
): Promise<SaveState> {
  const me = await getMe();
  if (!me) return { error: 'You are not signed in.' };
  if (me.role === 'user') return { error: 'Your role is read-only.' };

  const siteId = String(formData.get('__site_id') ?? '');
  const states = formData.getAll('states').map(String);

  const supabase = await createClient();
  await supabase.from('site_geography').delete().eq('site_id', siteId);
  if (states.length) {
    const { error } = await supabase.from('site_geography')
      .insert(states.map(state => ({ site_id: siteId, state })));
    if (error) return { error: error.message };
  }
  revalidatePath(`/vendors/${siteId}`);
  return { ok: `${states.length} state${states.length === 1 ? '' : 's'} saved.` };
}

/** Service categories and their sub-categories. */
export async function saveCategories(
  _prev: SaveState, formData: FormData
): Promise<SaveState> {
  const me = await getMe();
  if (!me) return { error: 'You are not signed in.' };
  if (me.role === 'user') return { error: 'Your role is read-only.' };

  const siteId = String(formData.get('__site_id') ?? '');
  const cats = formData.getAll('categories').map(String);
  const subs = formData.getAll('subcategories').map(String);

  const supabase = await createClient();
  await supabase.from('site_service_subcategory').delete().eq('site_id', siteId);
  await supabase.from('site_service_category').delete().eq('site_id', siteId);

  if (cats.length) {
    const { error } = await supabase.from('site_service_category')
      .insert(cats.map(category_id => ({ site_id: siteId, category_id })));
    if (error) return { error: error.message };
  }
  if (subs.length) {
    const { error } = await supabase.from('site_service_subcategory')
      .insert(subs.map(subcategory_id => ({ site_id: siteId, subcategory_id })));
    if (error) return { error: error.message };
  }
  revalidatePath(`/vendors/${siteId}`);
  return { ok: 'Categories saved.' };
}

export type DeleteState = { error?: string };

/** Soft-deletes a vendor site (and its company too, if this was its only
 *  site) — super_admin only, and only after a reason is on record. Done as
 *  one atomic security-definer RPC (sql/26_delete_vendor_rpc.sql), which
 *  does the change_request bookkeeping and the actual soft-delete inside a
 *  single transaction with its own is_admin() check, rather than four
 *  separate client calls against individually RLS-gated tables. */
export async function deleteVendor(
  _prev: DeleteState, formData: FormData
): Promise<DeleteState> {
  const me = await getMe();
  if (!me) return { error: 'You are not signed in.' };
  if (me.role !== 'super_admin') return { error: 'Only a super admin can delete a vendor.' };

  const siteId = String(formData.get('__site_id') ?? '');
  const siteCode = String(formData.get('__site_code') ?? '').trim();
  const confirmCode = String(formData.get('__confirm_code') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();

  if (!siteId) return { error: 'Something is missing from the form.' };
  if (confirmCode !== siteCode) return { error: `Type "${siteCode}" exactly to confirm.` };
  if (reason.length < 10) return { error: 'Give a real reason for deleting this vendor (at least 10 characters).' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_vendor_site', { p_site_id: siteId, p_reason: reason });
  if (error) return { error: error.message };

  revalidatePath('/vendors');
  redirect('/vendors');
}
