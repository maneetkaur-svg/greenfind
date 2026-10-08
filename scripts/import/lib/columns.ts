/** Column recognition for finance-vendors.xlsx. Deliberately separate from
 *  lib/import/fields.ts — that file drives the company/site importer; this
 *  one only cares about the Vendor Code and the five document columns. */

export type ColumnKey =
  | 'vendor_code' | 'legal_name' | 'pan' | 'gstin' | 'is_msme'
  | 'doc_gst' | 'doc_pan' | 'doc_agreement' | 'doc_cheque' | 'doc_msme';

export const DOC_COLUMN_KEYS: readonly ColumnKey[] = ['doc_gst', 'doc_pan', 'doc_agreement', 'doc_cheque', 'doc_msme'];

/** The five Excel document columns, mapped to document_type.code values that
 *  already exist in the database (confirmed 2026-10-07). Never invented, and
 *  never touches document_type codes outside this list (profile, cto, epr). */
export const DOC_COLUMN_TO_TYPE: Record<string, string> = {
  doc_gst: 'gst',
  doc_pan: 'pan',
  doc_agreement: 'nda',
  doc_cheque: 'cheque',
  doc_msme: 'udyam',
};

type ColumnDef = { key: ColumnKey; required: boolean; aliases: string[] };

export const COLUMN_DEFS: ColumnDef[] = [
  { key: 'vendor_code', required: true,
    aliases: ['vendor code', 'legacy code', 'vendor id', 'supplier code', 'code', 'vendor no', 'vendor number', 'old vendor code'] },
  { key: 'legal_name', required: false,
    aliases: ['vendor name', 'legal name', 'company name', 'name of company', 'firm name', 'name'] },
  { key: 'pan', required: false,
    aliases: ['pan', 'pan no', 'pan number', 'pan card'] },
  { key: 'gstin', required: false,
    aliases: ['gstin', 'gst no', 'gst number', 'gst', 'gstin no', 'gst aadhaar', 'gst/aadhaar', 'gstin/uin'] },
  { key: 'is_msme', required: true,
    aliases: ['msme', 'is msme', 'msme registered', 'registered as msme', 'registered as an msme'] },
  { key: 'doc_gst', required: true,
    aliases: ['gst / aadhaar document', 'gst aadhaar document', 'gst document', 'gst certificate', 'gst doc', 'aadhaar document'] },
  { key: 'doc_pan', required: true,
    aliases: ['pan document', 'pan card document', 'pan doc', 'pan copy', 'pan card copy'] },
  { key: 'doc_agreement', required: true,
    aliases: ['agreement document', 'agreement', 'agreement doc', 'nda document', 'contract document', 'agreement copy'] },
  { key: 'doc_cheque', required: true,
    aliases: ['cancelled cheque', 'cancelled cheque document', 'cheque document', 'cancelled cheque copy', 'cheque copy'] },
  { key: 'doc_msme', required: true,
    aliases: ['msme document', 'udyam document', 'msme certificate', 'udyam certificate', 'msme doc'] },
];

const normHeader = (h: string) =>
  h.toLowerCase().replace(/[_\-/\\.:]+/g, ' ').replace(/[^a-z0-9? ()]/g, ' ')
    .replace(/\?/g, '').replace(/\s+/g, ' ').trim();

export type ColumnMatch = { key: ColumnKey; index: number };

/** Exact header match wins; otherwise the longest alias contained as whole
 *  words. Each key is claimed by at most one column — same approach as
 *  lib/import/mapping.ts, kept local so this script has no app-UI coupling. */
export function matchColumns(headers: string[]): ColumnMatch[] {
  const normed = headers.map(normHeader);
  const aliasList = COLUMN_DEFS
    .flatMap(d => d.aliases.map(a => ({ key: d.key, alias: normHeader(a) })))
    .sort((a, b) => b.alias.length - a.alias.length);

  const picks: { index: number; key: ColumnKey | null; score: number }[] = normed.map((h, index) => {
    if (!h) return { index, key: null, score: 0 };
    const exact = aliasList.find(a => a.alias === h);
    if (exact) return { index, key: exact.key, score: 1000 + exact.alias.length };
    const hit = aliasList.find(a => a.alias.length > 2 && ` ${h} `.includes(` ${a.alias} `));
    return hit ? { index, key: hit.key, score: hit.alias.length } : { index, key: null, score: 0 };
  });

  const best = new Map<ColumnKey, number>();
  for (const p of picks) {
    if (!p.key) continue;
    const current = best.get(p.key);
    if (current === undefined || p.score > picks[current].score) best.set(p.key, p.index);
  }

  return [...best.entries()].map(([key, index]) => ({ key, index }));
}

export function findMissingRequiredColumns(matches: ColumnMatch[]): ColumnKey[] {
  const found = new Set(matches.map(m => m.key));
  return COLUMN_DEFS.filter(d => d.required && !found.has(d.key)).map(d => d.key);
}
