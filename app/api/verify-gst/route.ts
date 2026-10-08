import { NextResponse } from 'next/server';
import { createClient, getMe } from '@/lib/supabase/server';

/**
 * POST /api/verify-gst  { recordId: <vendor_site.id> }
 *
 * Looks up the GSTIN already saved against that site, asks Surepass's GST
 * verification API for the registered business's legal structure
 * ("Constitution of Business"), maps it onto this app's existing
 * entity_type enum, and — only on a confident match — saves it to that
 * site's company and returns the resolved code so the frontend's Entity
 * type <select> can update immediately.
 *
 * Nothing is forced: a ctb value with no safe mapping (e.g. "Trust",
 * "HUF", "Government Department") is reported back, not guessed into the
 * nearest enum value.
 *
 * ADJUST BEFORE GOING LIVE — I do not have a Surepass account or sandbox
 * token to test this against, so the request shape below (field name,
 * endpoint path) is Surepass's documented convention as of my knowledge,
 * not a verified live call. `data.ctb` is the one field name confirmed
 * directly by whoever asked for this endpoint; everything else here is
 * isolated in fetchGstProfile() so it's a one-function fix if your
 * account's actual contract differs.
 */

const SUREPASS_BASE_URL = process.env.SUREPASS_API_BASE_URL ?? 'https://kyc-api.surepass.io';
const SUREPASS_GST_PATH = process.env.SUREPASS_GST_ENDPOINT_PATH ?? '/api/v1/corporate/gstin';
const TIMEOUT_MS = 15_000;

/** Only GSTN's own standard "Constitution of Business" categories that map
 *  unambiguously onto an existing entity_type value. Everything else
 *  (Trust/Society/AOP, HUF, Government Department, PSU, Local Authority,
 *  Statutory Body, Foreign LLP/Company, Unlimited Company, Others) is left
 *  unmapped on purpose — this app's enum has no safe home for them, and
 *  forcing a guess would be worse than asking a person to set it by hand. */
const CTB_TO_ENTITY: Record<string, string> = {
  'proprietorship': 'proprietorship',
  'partnership': 'partnership',
  'private limited company': 'pvt_ltd',
  'public limited company': 'public_ltd',
  'limited liability partnership': 'llp',
};

function normaliseCtb(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, ' ');
}

type GstProfile = { ctb: string | null; raw: unknown };

class VerifyGstError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function fetchGstProfile(gstin: string): Promise<GstProfile> {
  const token = process.env.SUREPASS_API_TOKEN;
  if (!token) throw new VerifyGstError(500, 'SUREPASS_API_TOKEN is not configured on the server.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${SUREPASS_BASE_URL}${SUREPASS_GST_PATH}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // Surepass's KYC endpoints (PAN, Aadhaar, GSTIN) conventionally take
      // the id being checked as "id_number" — confirm against your account's
      // docs if this endpoint differs.
      body: JSON.stringify({ id_number: gstin }),
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError')
      throw new VerifyGstError(504, 'The GST verification service timed out.');
    throw new VerifyGstError(502, 'Could not reach the GST verification service.');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new VerifyGstError(502, `GST verification service returned HTTP ${res.status}.`);
  }

  const body = await res.json().catch(() => null);
  const ctb = body?.data?.ctb;
  if (typeof ctb !== 'string' || !ctb.trim()) {
    throw new VerifyGstError(502, 'GST verification service returned no legal structure (data.ctb) for this GSTIN.');
  }
  return { ctb, raw: body };
}

export async function POST(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'You are not signed in.' }, { status: 401 });
  if (me.role === 'user') return NextResponse.json({ error: 'Your role is read-only.' }, { status: 403 });

  let recordId: string;
  try {
    const body = await req.json();
    recordId = String(body?.recordId ?? '');
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with a recordId.' }, { status: 400 });
  }
  if (!recordId) return NextResponse.json({ error: 'recordId is required.' }, { status: 400 });

  // The ordinary signed-in-user client — row-level security applies exactly
  // as it does everywhere else in the app, not the service-role key.
  const supabase = await createClient();

  const { data: site, error: siteErr } = await supabase
    .from('vendor_site')
    .select('id, company_id, gstin')
    .eq('id', recordId)
    .is('deleted_at', null)
    .maybeSingle();

  if (siteErr) return NextResponse.json({ error: siteErr.message }, { status: 500 });
  if (!site) return NextResponse.json({ error: 'No vendor found for that recordId.' }, { status: 404 });
  if (!site.gstin) return NextResponse.json({ error: 'This vendor has no GSTIN on file to verify.' }, { status: 400 });

  let profile: GstProfile;
  try {
    profile = await fetchGstProfile(site.gstin);
  } catch (e) {
    if (e instanceof VerifyGstError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Unexpected error calling the GST verification service.' }, { status: 500 });
  }

  const entity = CTB_TO_ENTITY[normaliseCtb(profile.ctb!)];
  if (!entity) {
    return NextResponse.json(
      { error: `No internal entity type matches "${profile.ctb}". Set it manually on the Identity tab.`, ctb: profile.ctb },
      { status: 422 },
    );
  }

  const { error: updErr } = await supabase
    .from('company')
    .update({ entity, updated_by: me.id })
    .eq('id', site.company_id);

  if (updErr) {
    // The same constraint actions.ts already translates for the Identity form.
    if (updErr.message.includes('cin_when_company'))
      return NextResponse.json({
        error: `GST records this as "${profile.ctb}" (${entity}), but that needs a CIN on file first — add it on the Identity tab, then verify again.`,
        ctb: profile.ctb,
      }, { status: 422 });
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ entity, ctb: profile.ctb });
}
