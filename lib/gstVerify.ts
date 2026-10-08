import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Calls Surepass's GST verification API for a GSTIN, maps the returned
 * Constitution of Business (data.ctb) onto this app's existing entity_type
 * enum, and — only on a confident match — saves it to the company's
 * `entity` column. Shared by the automatic hook in the "Add vendor" flow
 * and the one-off bulk backfill script (scripts/import/verify-gst-bulk.ts).
 *
 * Requires SUREPASS_API_TOKEN (server-only env var — never sent to the
 * browser). Without it, every call fails closed with a clear reason.
 *
 * ADJUST BEFORE RELYING ON THIS — the request field name and endpoint path
 * below are Surepass's documented convention, not a verified live call (no
 * account/token was available to test against). `data.ctb` is the one
 * field name confirmed directly. Everything provider-specific is isolated
 * in fetchGstProfile() so it's a one-function fix if your account's actual
 * contract differs.
 */

const SUREPASS_BASE_URL = process.env.SUREPASS_API_BASE_URL ?? 'https://kyc-api.surepass.io';
const SUREPASS_GST_PATH = process.env.SUREPASS_GST_ENDPOINT_PATH ?? '/api/v1/corporate/gstin';
const TIMEOUT_MS = 15_000;

/** Only GSTN's own standard "Constitution of Business" categories that map
 *  unambiguously onto an existing entity_type value. Everything else
 *  (Trust/Society/AOP, HUF, Government Department, PSU, Local Authority,
 *  Statutory Body, Foreign LLP/Company, Unlimited Company, Others) is left
 *  unmapped on purpose — forcing a guess would be worse than leaving it
 *  blank for a person to set. */
const CTB_TO_ENTITY: Record<string, string> = {
  'proprietorship': 'proprietorship',
  'partnership': 'partnership',
  'private limited company': 'pvt_ltd',
  'public limited company': 'public_ltd',
  'limited liability partnership': 'llp',
};

const normaliseCtb = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');

export type GstVerifyResult =
  | { ok: true; entity: string; ctb: string }
  | { ok: false; reason: string; ctb?: string };

async function fetchCtb(gstin: string): Promise<{ ctb: string } | { error: string }> {
  const token = process.env.SUREPASS_API_TOKEN;
  if (!token) return { error: 'SUREPASS_API_TOKEN is not configured on the server.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${SUREPASS_BASE_URL}${SUREPASS_GST_PATH}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id_number: gstin }),
    });
  } catch (e) {
    return { error: e instanceof Error && e.name === 'AbortError' ? 'GST verification timed out.' : 'Could not reach the GST verification service.' };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) return { error: `GST verification service returned HTTP ${res.status}.` };
  const body = await res.json().catch(() => null);
  const ctb = body?.data?.ctb;
  if (typeof ctb !== 'string' || !ctb.trim()) return { error: 'GST verification service returned no legal structure (data.ctb).' };
  return { ctb };
}

/** Looks up the GSTIN, maps it, and writes company.entity. Never throws —
 *  always resolves to a result the caller can log or ignore. */
export async function verifyEntityFromGstin(
  supabase: SupabaseClient, companyId: string, gstin: string
): Promise<GstVerifyResult> {
  const profile = await fetchCtb(gstin);
  if ('error' in profile) return { ok: false, reason: profile.error };

  const entity = CTB_TO_ENTITY[normaliseCtb(profile.ctb)];
  if (!entity) return { ok: false, reason: `No internal entity type matches "${profile.ctb}".`, ctb: profile.ctb };

  const { error } = await supabase.from('company').update({ entity }).eq('id', companyId);
  if (error) return { ok: false, reason: error.message, ctb: profile.ctb };
  return { ok: true, entity, ctb: profile.ctb };
}
