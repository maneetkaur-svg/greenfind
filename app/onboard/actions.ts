'use server';
import { createClient } from '@/lib/supabase/server';

export type SignupPayload = {
  gstin: string;
  pan_number: string;
  industry: string;
  legal_name: string;
  is_msme: boolean;
  msme_category: string;
  udyam_number: string;
  site: { address_line1: string; city: string; state: string; pincode: string; location: string };
  contacts: { name: string; designation: string; mobile: string; email: string }[];
  category_id: string;
  subcategory_ids: string[];
  geography: string[];
  how_heard: string;
  first_time_with_fitsol: boolean;
  consent: boolean;
};

export type SignupResult = { error?: string; companyCode?: string; siteCode?: string; siteId?: string };

/** No getMe() check — there is no signed-in user here. The anon-key client
 *  this returns has no session, so it calls the RPC as Postgres role
 *  `anon`; public_vendor_signup (sql/18 and sql/20) is security definer and
 *  does every validation itself, because nothing from this caller can be
 *  trusted. */
export async function submitVendorSignup(payload: SignupPayload): Promise<SignupResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('public_vendor_signup', { p: payload });
  if (error) {
    if (error.message.includes('public_vendor_signup'))
      return { error: 'This form is not set up yet. Run sql/18_public_vendor_signup.sql in Supabase first.' };
    return { error: error.message };
  }
  return { companyCode: data?.company_code, siteCode: data?.site_code, siteId: data?.site_id };
}
