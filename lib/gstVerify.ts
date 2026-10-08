import type { SupabaseClient } from '@supabase/supabase-js';
import { RX } from '@/lib/constants';

/**
 * Calls gstinapi.in's GSTIN verification API, maps the returned
 * business_constitution onto this app's existing entity_type enum, and —
 * only on a confident match — saves it to the company's `entity` column.
 * Shared by the automatic hook in the "Add vendor" flow and the one-off
 * bulk backfill script (scripts/import/verify-gst-bulk.ts).
 *
 * Verified directly against https://www.gstinapi.in/docs AND a handful of
 * live calls against real GSTINs already on file (2026-10):
 *   GET https://www.gstinapi.in/v1/gstin/{gstin}?include=profile
 *   Header: x-api-key: <GSTINAPI_TOKEN>
 *   200 -> { success: true, data: { ..., business_constitution, ... } }
 *   anything else -> { success: false, error: "..." }
 *
 * `?include=profile` is required — the basic lookup (no query param)
 * ALWAYS returns business_constitution: null by design (confirmed live: 8
 * real GSTINs, including known Private Limited companies, every one null
 * without it). `?include=profile` costs the same 1 credit and reliably
 * returns real values ("Private Limited Company", "Partnership",
 * "Proprietorship", confirmed live against this project's own vendors).
 *
 * Free tier: 100 credits total (not monthly — they do not expire), 1
 * credit per successful (200) lookup, 60 requests/minute/key.
 *
 * Requires GSTINAPI_TOKEN (server-only env var — never sent to the
 * browser). Without it, every call fails closed with a clear reason.
 */

const GSTINAPI_BASE_URL = process.env.GSTINAPI_BASE_URL ?? 'https://www.gstinapi.in';
const TIMEOUT_MS = 15_000;

/** Only GSTN's own standard "Constitution of Business" categories that map
 *  unambiguously onto an existing entity_type value. Everything else
 *  (Trust/Society/AOP, HUF, Government Department, PSU, Local Authority,
 *  Statutory Body, Foreign LLP/Company, Unlimited Company, Others, or
 *  simply null — GSTN does not always carry this field) is left unmapped
 *  on purpose — forcing a guess would be worse than leaving it blank for
 *  a person to set. */
const CONSTITUTION_TO_ENTITY: Record<string, string> = {
  'proprietorship': 'proprietorship',
  'partnership': 'partnership',
  'private limited company': 'pvt_ltd',
  'public limited company': 'public_ltd',
  'limited liability partnership': 'llp',
};

const normalise = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');

/** Exported so a result already fetched once (e.g. from a previous bulk
 *  run's report.csv) can be re-applied without spending another credit. */
export function mapConstitutionToEntity(constitution: string): string | null {
  return CONSTITUTION_TO_ENTITY[normalise(constitution)] ?? null;
}

export type GstVerifyResult =
  | { ok: true; entity: string; constitution: string }
  | { ok: false; reason: string; constitution?: string | null };

type GstinApiData = { business_constitution: string | null; [k: string]: unknown };
type GstinApiResponse =
  | { success: true; data: GstinApiData }
  | { success: false; error: string };

async function fetchGstinRecord(gstin: string): Promise<{ data: GstinApiData } | { error: string }> {
  const token = process.env.GSTINAPI_TOKEN;
  if (!token) return { error: 'GSTINAPI_TOKEN is not configured on the server.' };
  if (!RX.gstin.test(gstin)) return { error: `"${gstin}" is not a validly formatted GSTIN.` };

  const call = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(`${GSTINAPI_BASE_URL}/v1/gstin/${encodeURIComponent(gstin)}?include=profile`, {
        signal: controller.signal,
        headers: { 'x-api-key': token },
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let res: Response;
  try {
    res = await call();
    if (res.status === 502) res = await call(); // the one status code the docs say is safe to retry
  } catch (e) {
    return { error: e instanceof Error && e.name === 'AbortError' ? 'GST verification timed out.' : 'Could not reach the GST verification service.' };
  }

  const body = (await res.json().catch(() => null)) as GstinApiResponse | null;

  if (res.status === 401) return { error: 'GSTINAPI_TOKEN was rejected (invalid or revoked key).' };
  if (res.status === 402) return { error: 'gstinapi.in account is out of credits.' };
  if (res.status === 403) return { error: 'gstinapi.in account is deactivated.' };
  if (res.status === 404) return { error: 'This GSTIN is not registered in the GST database.' };
  if (res.status === 429) return { error: 'gstinapi.in rate limit exceeded — try again shortly.' };
  if (!res.ok || !body || !body.success)
    return { error: (body && !body.success && body.error) || `GST verification service returned HTTP ${res.status}.` };

  return { data: body.data };
}

/** Looks up the GSTIN, maps it, and writes company.entity. Never throws —
 *  always resolves to a result the caller can log or ignore. */
export async function verifyEntityFromGstin(
  supabase: SupabaseClient, companyId: string, gstin: string
): Promise<GstVerifyResult> {
  const record = await fetchGstinRecord(gstin);
  if ('error' in record) return { ok: false, reason: record.error };

  const constitution = record.data.business_constitution;
  if (typeof constitution !== 'string' || !constitution.trim())
    return { ok: false, reason: 'GST verification service did not return a Constitution of Business for this GSTIN.', constitution: null };

  const entity = CONSTITUTION_TO_ENTITY[normalise(constitution)];
  if (!entity) return { ok: false, reason: `No internal entity type matches "${constitution}".`, constitution };

  const { error } = await supabase.from('company').update({ entity }).eq('id', companyId);
  if (error) return { ok: false, reason: error.message, constitution };
  return { ok: true, entity, constitution };
}
