import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reads a vendor's own GST certificate (PDF or image, already on file —
 * uploaded through the app's own document upload) with Gemini's multimodal
 * API, extracts the Constitution of Business, and maps it onto this app's
 * existing entity_type enum. Replaces the earlier gstinapi.in integration:
 * no third-party lookup service, no per-call cost (Gemini free tier), and
 * no dependency on the vendor's GSTIN resolving in an external registry —
 * just reads the document Fitsol already has.
 *
 * Two call sites:
 *   - documentActions.ts's uploadDocument: fires right after a "gst"
 *     document is attached (best-effort — a slow/failed call never blocks
 *     the upload itself).
 *   - scripts/import/extract-entity-from-certificates.ts: the one-off
 *     backlog run, for every company that already had a GST document on
 *     file before this existed.
 *
 * Verified live (2026-10): a real GST certificate PDF already on file for
 * this project returned GSTIN, legal name and Constitution of Business
 * ("Partnership") that exactly matched an independent lookup done earlier
 * against the same vendor via a different provider (gstinapi.in) — cross-
 * confirms both the request shape and the extraction's accuracy. Model
 * gemini-2.5-flash-lite is no longer available to new API keys; the
 * current equivalent is gemini-3.5-flash-lite, used as the default below.
 */

const GEMINI_BASE_URL = process.env.GEMINI_API_BASE_URL ?? 'https://generativelanguage.googleapis.com';
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
const TIMEOUT_MS = 60_000; // a multimodal document call is slower than a plain JSON API

/** Only GSTN's own standard "Constitution of Business" categories that map
 *  unambiguously onto an existing entity_type value. Everything else
 *  (Trust/Society/AOP, HUF, Government Department, PSU, Local Authority,
 *  Statutory Body, Foreign LLP/Company, Unlimited Company, Others, or a
 *  certificate Gemini simply couldn't read it from) is left unmapped on
 *  purpose — forcing a guess would be worse than leaving it blank for a
 *  person to set. */
const CONSTITUTION_TO_ENTITY: Record<string, string> = {
  'proprietorship': 'proprietorship',
  'partnership': 'partnership',
  'private limited company': 'pvt_ltd',
  'public limited company': 'public_ltd',
  'limited liability partnership': 'llp',
};

const normalise = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');

/** Exported so a result already extracted once can be re-applied (e.g.
 *  after a constraint blocking the save is fixed) without calling Gemini
 *  again. */
export function mapConstitutionToEntity(constitution: string): string | null {
  return CONSTITUTION_TO_ENTITY[normalise(constitution)] ?? null;
}

export type CertificateFields = {
  gstin: string | null;
  legal_name: string | null;
  trade_name: string | null;
  registration_date: string | null;
  constitution_of_business: string | null;
};

export type ExtractResult =
  | { ok: true; entity: string; fields: CertificateFields }
  | { ok: false; reason: string; fields?: CertificateFields };

const PROMPT = `This is a scanned or digital copy of an Indian GST registration certificate (Form REG-06) or a similar GST registration document.

Read it and return ONLY a JSON object with exactly these keys:
{
  "gstin": string or null,
  "legal_name": string or null,
  "trade_name": string or null,
  "registration_date": string or null (format YYYY-MM-DD, or null if not confidently readable),
  "constitution_of_business": string or null
}

"constitution_of_business" must be copied verbatim as printed on the certificate (e.g. "Proprietorship", "Partnership", "Private Limited Company", "Public Limited Company", "Limited Liability Partnership", "Society/Club/Trust/AOP", "Hindu Undivided Family", "Government Department", "Public Sector Undertaking", "Statutory Body", "Local Authority", "Foreign Company", "Foreign Limited Liability Partnership", "Unlimited Company", "Others") — do not translate, abbreviate or guess it from the legal name.

If a field is not clearly legible, use null for that field rather than guessing. Return ONLY the JSON object, no other text.`;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 502;
}

async function callGemini(fileBase64: string, mimeType: string): Promise<{ data: unknown } | { error: string; status?: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: 'GEMINI_API_KEY is not configured on the server.' };

  const url = `${GEMINI_BASE_URL}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{
      parts: [
        { text: PROMPT },
        { inlineData: { mimeType, data: fileBase64 } },
      ],
    }],
    generationConfig: { responseMimeType: 'application/json' },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { error: e instanceof Error && e.name === 'AbortError' ? 'Gemini request timed out.' : 'Could not reach Gemini.' };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `Gemini returned HTTP ${res.status}: ${text.slice(0, 300)}`, status: res.status };
  }

  const json = await res.json().catch(() => null);
  return { data: json };
}

function extractJsonText(geminiResponse: unknown): string | null {
  const r = geminiResponse as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null;
  const text = r?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' ? text : null;
}

/** Calls Gemini once, retrying a single time on a rate-limit/transient
 *  status after a short backoff (the PRD's "sleep and retry" mitigation). */
async function callGeminiWithRetry(fileBase64: string, mimeType: string) {
  const first = await callGemini(fileBase64, mimeType);
  if (!('error' in first)) return first;
  if (!first.status || !isRetryableStatus(first.status)) return first;
  await new Promise(r => setTimeout(r, 30_000));
  return callGemini(fileBase64, mimeType);
}

/** Reads one certificate file and writes company.entity. Never throws —
 *  always resolves to a result the caller can log or ignore. `fileBuffer`
 *  is the certificate's raw bytes (PDF, JPG or PNG). */
export async function extractEntityFromCertificate(
  supabase: SupabaseClient, companyId: string, fileBuffer: Buffer, mimeType: string
): Promise<ExtractResult> {
  const result = await callGeminiWithRetry(fileBuffer.toString('base64'), mimeType);
  if ('error' in result) return { ok: false, reason: result.error };

  const jsonText = extractJsonText(result.data);
  if (!jsonText) return { ok: false, reason: 'Gemini returned no readable content for this certificate.' };

  let fields: CertificateFields;
  try {
    fields = JSON.parse(jsonText);
  } catch {
    return { ok: false, reason: `Gemini's response was not valid JSON: ${jsonText.slice(0, 200)}` };
  }

  const constitution = fields.constitution_of_business;
  if (typeof constitution !== 'string' || !constitution.trim())
    return { ok: false, reason: 'Gemini could not read a Constitution of Business from this certificate.', fields };

  const entity = mapConstitutionToEntity(constitution);
  if (!entity) return { ok: false, reason: `No internal entity type matches "${constitution}".`, fields };

  const { error } = await supabase.from('company').update({ entity }).eq('id', companyId);
  if (error) return { ok: false, reason: error.message, fields };
  return { ok: true, entity, fields };
}
