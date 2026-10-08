'use server';
import { revalidatePath } from 'next/cache';
import { createClient, getMe } from '@/lib/supabase/server';
import { panFromGstin, RX } from '@/lib/constants';
import { verifyEntityFromGstin } from '@/lib/gstVerify';

export type LookupResult =
  | { found: false }
  | { found: true; id: string; company_code: string; legal_name: string; site_count: number };

/** Characters 3–12 of a GSTIN are the PAN, so the system can tell on its own
 *  whether this company is already on record. Nobody has to remember to say so. */
export async function lookupCompany(gstin: string): Promise<LookupResult> {
  if (!panFromGstin(gstin)) return { found: false };
  const supabase = await createClient();
  const { data } = await supabase.rpc('company_for_gstin', { p_gstin: gstin.toUpperCase() });
  const hit = data?.[0];
  return hit
    ? { found: true, id: hit.id, company_code: hit.company_code,
        legal_name: hit.legal_name, site_count: Number(hit.site_count) }
    : { found: false };
}

export type VendorPayload = {
  linkCompanyId: string | null;
  company: Record<string, unknown>;
  site: Record<string, unknown>;
  operations: Record<string, unknown>;
  certificates: Record<string, unknown>;
  contacts: { rank: number; name: string; designation: string;
              mobile: string; email: string }[];
  geography: string[];
  categories: string[];
  subcategories: string[];
};

export type CreateResult = { error?: string; siteId?: string };

/** Creates everything in one go: company if new, then the site and every child
 *  table. If the site fails, a company created moments earlier is rolled back,
 *  so a half-made vendor is never left behind. */
export async function createVendor(p: VendorPayload): Promise<CreateResult> {
  const me = await getMe();
  if (!me) return { error: 'You are not signed in.' };
  if (me.role === 'user') return { error: 'Your role is read-only.' };

  const gstin = String(p.site.gstin ?? '').toUpperCase();
  const pan = panFromGstin(gstin);
  if (!pan) return { error: 'That GSTIN is not valid. Fifteen characters, with the PAN inside it.' };
  if (!p.site.industry) return { error: 'Industry type is required.' };
  if (!p.site.address_line1) return { error: 'Address is required.' };
  if (!p.site.city) return { error: 'City is required.' };
  if (!p.site.state) return { error: 'State is required.' };
  if (!RX.pincode.test(String(p.site.pincode ?? '')))
    return { error: 'Pincode must be six digits and cannot start with zero.' };

  if (!p.linkCompanyId) {
    if (!p.company.legal_name) return { error: 'Legal name is required.' };
    if (p.company.is_msme === true && (!p.company.msme_category || !p.company.udyam_number))
      return { error: 'An MSME needs both an enterprise category and a Udyam number.' };
  }

  const named = p.contacts.filter(c => c.name.trim());
  if (named.length < 2)
    return { error: 'Two contacts are required — a primary and a secondary.' };
  for (const c of named) {
    if (c.mobile && !RX.mobile.test(c.mobile))
      return { error: `${c.name}: mobile must be ten digits starting 6 to 9.` };
    if (c.email && !RX.email.test(c.email))
      return { error: `${c.name}: that email does not look right.` };
  }

  const supabase = await createClient();
  let companyId = p.linkCompanyId;
  let createdCompany = false;

  if (!companyId) {
    const { data: code, error: codeErr } = await supabase.rpc('next_company_code');
    if (codeErr) return { error: 'Could not generate a company code: ' + codeErr.message };

    const body: Record<string, unknown> = { ...p.company, company_code: code, pan,
      created_by: me.id, updated_by: me.id };
    if (body.is_msme !== true) { body.msme_category = null; body.udyam_number = null; }

    const { data: company, error } = await supabase
      .from('company').insert(body).select('id').single();
    if (error) return { error: 'Could not create the company: ' + error.message };
    companyId = company.id;
    createdCompany = true;
  }

  const { data: siteCode, error: scErr } =
    await supabase.rpc('next_site_code', { p_company: companyId });
  if (scErr) return { error: 'Could not generate a site code: ' + scErr.message };

  const { data: site, error: siteErr } = await supabase.from('vendor_site').insert({
    ...p.site, gstin, company_id: companyId, site_code: siteCode,
    created_by: me.id, updated_by: me.id,
  }).select('id').single();

  if (siteErr) {
    if (createdCompany) await supabase.from('company').delete().eq('id', companyId);
    if (siteErr.message.includes('site_unique'))
      return { error: 'A site with this GSTIN and pincode already exists. That is the same plant, not a new one.' };
    if (siteErr.message.includes('site_belongs_to_company'))
      return { error: 'The PAN inside this GSTIN does not match the company it is being linked to.' };
    return { error: 'Could not create the site: ' + siteErr.message };
  }

  const siteId = site.id;

  if (named.length)
    await supabase.from('site_contact').insert(named.map(c => ({
      site_id: siteId, rank: c.rank, name: c.name.trim(),
      designation: c.designation.trim() || null,
      mobile: c.mobile.trim() || null, email: c.email.trim() || null,
    })));

  if (p.geography.length)
    await supabase.from('site_geography')
      .insert(p.geography.map(state => ({ site_id: siteId, state })));

  if (p.categories.length)
    await supabase.from('site_service_category')
      .insert(p.categories.map(category_id => ({ site_id: siteId, category_id })));

  if (p.subcategories.length)
    await supabase.from('site_service_subcategory')
      .insert(p.subcategories.map(subcategory_id => ({ site_id: siteId, subcategory_id })));

  if (Object.values(p.operations).some(v => v !== null && v !== ''))
    await supabase.from('site_operations').insert({ site_id: siteId, ...p.operations });

  if (Object.values(p.certificates).some(v => v !== null && v !== ''))
    await supabase.from('site_certificate_data').insert({ site_id: siteId, ...p.certificates });

  // Best-effort: entity type is read off the GSTIN automatically. A slow or
  // unreachable verification service never blocks or fails vendor creation —
  // it just leaves entity blank for scripts/import/verify-gst-bulk.ts (or a
  // later automatic retry) to pick up.
  try {
    const { data: co } = await supabase.from('company').select('entity').eq('id', companyId!).single();
    if (!co?.entity) await verifyEntityFromGstin(supabase, companyId!, gstin);
  } catch {
    /* ignored — see above */
  }

  revalidatePath('/vendors');
  return { siteId };
}
