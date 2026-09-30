'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient, getMe } from '@/lib/supabase/server';
import { panFromGstin, RX } from '@/lib/constants';

export type LookupResult =
  | { found: false }
  | { found: true; id: string; company_code: string; legal_name: string; site_count: number };

/** Characters 3–12 of the GSTIN are the PAN, so the system can tell on its
 *  own whether this company is already on record. Nobody has to remember
 *  to say "we've dealt with them before". */
export async function lookupCompany(gstin: string): Promise<LookupResult> {
  const pan = panFromGstin(gstin);
  if (!pan) return { found: false };

  const supabase = await createClient();
  const { data } = await supabase.rpc('company_for_gstin', { p_gstin: gstin.toUpperCase() });
  const hit = data?.[0];
  return hit
    ? { found: true, id: hit.id, company_code: hit.company_code,
        legal_name: hit.legal_name, site_count: Number(hit.site_count) }
    : { found: false };
}

export type CreateState = { error?: string };

export async function createVendor(
  _prev: CreateState, formData: FormData
): Promise<CreateState> {
  const me = await getMe();
  if (!me || me.role === 'user') return { error: 'You do not have permission to create a vendor.' };

  const supabase = await createClient();
  const get = (k: string) => String(formData.get(k) ?? '').trim();

  const gstin = get('gstin').toUpperCase();
  const pan = panFromGstin(gstin);
  if (!pan) return { error: 'That GSTIN is not valid. Fifteen characters, with the PAN inside it.' };
  if (!RX.pincode.test(get('pincode'))) return { error: 'Pincode must be six digits and cannot start with zero.' };
  if (!get('legal_name')) return { error: 'Legal name is required.' };
  if (!get('industry')) return { error: 'Industry type is required.' };

  const linkTo = get('link_company_id');
  let companyId = linkTo || null;

  // New company: mint a code and insert. Existing: nothing is copied,
  // the new site simply points at it.
  if (!companyId) {
    const { data: code, error: codeErr } = await supabase.rpc('next_company_code');
    if (codeErr) return { error: 'Could not generate a company code: ' + codeErr.message };

    const { data: company, error: compErr } = await supabase
      .from('company')
      .insert({
        company_code: code, pan,
        legal_name: get('legal_name'),
        trade_name: get('trade_name') || null,
        entity: get('entity') || null,
        is_msme: get('is_msme') === 'yes',
        msme_category: get('is_msme') === 'yes' ? (get('msme_category') || null) : null,
        udyam_number: get('is_msme') === 'yes' ? (get('udyam_number') || null) : null,
        authorised_signatory: get('signatory') || null,
        created_by: me.id, updated_by: me.id,
      })
      .select('id').single();

    if (compErr) return { error: 'Could not create the company: ' + compErr.message };
    companyId = company.id;
  }

  const { data: siteCode, error: sErr } = await supabase
    .rpc('next_site_code', { p_company: companyId });
  if (sErr) return { error: 'Could not generate a site code: ' + sErr.message };

  const { data: site, error: siteErr } = await supabase
    .from('vendor_site')
    .insert({
      company_id: companyId, site_code: siteCode,
      site_name: get('site_name') || null,
      gstin, industry: get('industry'),
      address_line1: get('address_line1'), city: get('city'),
      state: get('state'), pincode: get('pincode'),
      created_by: me.id, updated_by: me.id,
    })
    .select('id').single();

  if (siteErr) {
    // The most likely two, in plain words.
    if (siteErr.message.includes('site_unique'))
      return { error: 'A site with this GSTIN and pincode already exists. That is the same plant, not a new one.' };
    if (siteErr.message.includes('site_belongs_to_company'))
      return { error: 'This GSTIN does not belong to the company it is being linked to. The PAN inside it does not match.' };
    return { error: 'Could not create the site: ' + siteErr.message };
  }

  // Primary contact, if given
  if (get('pc_name')) {
    await supabase.from('site_contact').insert({
      site_id: site.id, rank: 1,
      name: get('pc_name'), designation: get('pc_designation') || null,
      mobile: get('pc_mobile') || null, email: get('pc_email') || null,
    });
  }

  revalidatePath('/vendors');
  redirect(`/vendors/${site.id}`);
}
