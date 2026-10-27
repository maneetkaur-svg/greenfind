'use server';
import { createClient } from '@/lib/supabase/server';

export type FullSignupPayload = {
  gstin: string;
  pan_number: string;
  industry: string;
  company: Record<string, unknown>;
  site: Record<string, unknown>;
  operations: Record<string, unknown>;
  certificates: Record<string, unknown>;
  contacts: { name: string; designation: string; mobile: string; email: string }[];
  category_ids: string[];
  subcategory_ids: string[];
  geography: string[];
  how_heard: string;
  first_time_with_fitsol: boolean;
  consent: boolean;
};

export type SignupResult = { error?: string; companyCode?: string; siteCode?: string; siteId?: string };

/** No getMe() check — there is no signed-in user here, same as the quick
 *  form (app/onboard/actions.ts). public_vendor_signup_full (sql/53) is
 *  security definer and re-does every validation itself. */
export async function submitVendorSignupFull(payload: FullSignupPayload): Promise<SignupResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('public_vendor_signup_full', { p: payload });
  if (error) {
    if (error.message.includes('public_vendor_signup_full'))
      return { error: 'This form is not set up yet. Run sql/52 then sql/53 in Supabase first.' };
    return { error: error.message };
  }
  return { companyCode: data?.company_code, siteCode: data?.site_code, siteId: data?.site_id };
}
