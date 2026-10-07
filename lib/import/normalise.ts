import { ENTITY_TYPES, MSME_CATEGORIES, STATES, GST_STATES, REGIONS } from '@/lib/constants';

/** Everything here takes whatever a spreadsheet cell contains and returns a
 *  clean value, or null when there is nothing usable. None of it throws. */

export const clean = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).replace(/\u00a0/g, ' ').trim();
};

/** Header matching: lower case, punctuation to spaces, single spaces. */
export const normHeader = (h: unknown) =>
  clean(h).toLowerCase().replace(/[_\-\/\\.:]+/g, ' ').replace(/[^a-z0-9? ()]/g, ' ')
    .replace(/\?/g, '').replace(/\s+/g, ' ').trim();

const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function normBool(v: unknown): boolean | null {
  const s = clean(v).toLowerCase();
  if (!s) return null;
  if (['y', 'yes', 'true', '1', '✓', '✔', 'x', 'yeah', 'yep', 'registered', 'done', 'received', 'available'].includes(s)) return true;
  if (['n', 'no', 'false', '0', '✗', '✘', 'nope', 'na', 'n/a', 'not registered', 'none', 'nil'].includes(s)) return false;
  return null;
}

/** Strip +91 / 91 / 0 prefix and every non-digit. */
export function normPhone(v: unknown): string {
  let d = clean(v).replace(/[^\d]/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

export function normMoney(v: unknown): number | null {
  const s = clean(v).replace(/[₹,\s]|rs\.?|inr/gi, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function normNumber(v: unknown): number | null {
  const s = clean(v).replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const INDUSTRY_ALIASES: Record<string, string> = {
  recycling: 'recycling', recycler: 'recycling', recyclers: 'recycling', circularity: 'recycling',
  circular: 'recycling', epr: 'recycling', 'waste management': 'recycling', 'waste recycling': 'recycling',
  packaging: 'packaging', packing: 'packaging', packager: 'packaging', 'packaging supplier': 'packaging',
  transportation: 'transportation', transport: 'transportation', transporter: 'transportation',
  logistics: 'transportation', 'logistics & transport': 'transportation', freight: 'transportation',
};
export function normIndustry(v: unknown): string | null {
  const s = clean(v).toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  if (INDUSTRY_ALIASES[s]) return INDUSTRY_ALIASES[s];
  for (const [k, val] of Object.entries(INDUSTRY_ALIASES)) if (s.includes(k)) return val;
  return null;
}

export function normEntity(v: unknown): string | null {
  const s = loose(clean(v));
  if (!s) return null;
  for (const [code, label] of ENTITY_TYPES) if (s === loose(code) || s === loose(label)) return code;
  const map: Record<string, string> = {
    pvtltd: 'pvt_ltd', privatelimited: 'pvt_ltd', privatelimitedcompany: 'pvt_ltd', pvtltdcompany: 'pvt_ltd', pltd: 'pvt_ltd',
    ltd: 'public_ltd', limited: 'public_ltd', publiclimitedcompany: 'public_ltd', publicltd: 'public_ltd',
    proprietor: 'proprietorship', proprietary: 'proprietorship', soleproprietorship: 'proprietorship', individual: 'proprietorship',
    partnershipfirm: 'partnership', limitedliabilitypartnership: 'llp', limitedliabilitycompany: 'llc',
    ngo: 'trust', society: 'trust', foreigncompany: 'foreign', overseas: 'foreign',
  };
  return map[s] ?? null;
}

export function normMsmeCategory(v: unknown): string | null {
  const s = loose(clean(v));
  if (!s) return null;
  for (const [code, label] of MSME_CATEGORIES) if (s === code || s === loose(label) || s.startsWith(code)) return code;
  return null;
}

export function normNda(v: unknown): string | null {
  const s = clean(v).toLowerCase();
  if (!s) return null;
  if (/process|pending|progress|sent|awaiting/.test(s)) return 'inprocess';
  const b = normBool(s);
  return b === null ? null : b ? 'yes' : 'no';
}

/** Common alternative spellings → the exact name used in constants.STATES. */
const STATE_ALIASES: Record<string, string> = {
  orissa: 'Odisha', pondicherry: 'Puducherry', uttaranchal: 'Uttarakhand', delhi: 'Delhi', newdelhi: 'Delhi', nctofdelhi: 'Delhi',
  jammuandkashmir: 'Jammu & Kashmir', jk: 'Jammu & Kashmir', jammukashmir: 'Jammu & Kashmir',
  andamanandnicobar: 'Andaman & Nicobar', andamannicobar: 'Andaman & Nicobar', andamannicobarislands: 'Andaman & Nicobar',
  dadraandnagarhaveli: 'DNH & Daman Diu', damananddiu: 'DNH & Daman Diu', dnh: 'DNH & Daman Diu',
  dadranagarhavelidamandiu: 'DNH & Daman Diu', dnhdd: 'DNH & Daman Diu',
  up: 'Uttar Pradesh', mp: 'Madhya Pradesh', hp: 'Himachal Pradesh', tn: 'Tamil Nadu', wb: 'West Bengal',
  ap: 'Andhra Pradesh', uk: 'Uttarakhand', cg: 'Chhattisgarh', chattisgarh: 'Chhattisgarh', tamilnadu: 'Tamil Nadu',
  mh: 'Maharashtra', gj: 'Gujarat', rj: 'Rajasthan', hr: 'Haryana', pb: 'Punjab', ka: 'Karnataka', kl: 'Kerala', ts: 'Telangana', br: 'Bihar',
  jh: 'Jharkhand', od: 'Odisha', as: 'Assam', ga: 'Goa', dl: 'Delhi',
};
export function normState(v: unknown): string | null {
  const s = loose(clean(v));
  if (!s) return null;
  for (const st of STATES) if (loose(st) === s) return st;
  return STATE_ALIASES[s] ?? null;
}

export const splitList = (v: unknown): string[] =>
  clean(v).split(/[;,|\n]+/).map(x => x.trim()).filter(Boolean);

/** States from a list cell. "Pan India" → all. A region name → its states. */
export function normGeography(v: unknown): { states: string[]; unknown: string[] } {
  const states = new Set<string>(); const unknown: string[] = [];
  for (const item of splitList(v)) {
    const l = loose(item);
    if (l === 'panindia' || l === 'allindia' || l === 'india' || l === 'pan') { STATES.forEach(s => states.add(s)); continue; }
    const region = REGIONS.find(([code, label]) => l === loose(code) || l === loose(label));
    if (region) { region[2].forEach(s => states.add(s)); continue; }
    const st = normState(item);
    if (st) states.add(st); else unknown.push(item);
  }
  return { states: [...states], unknown };
}

export const normGstin = (v: unknown) => clean(v).toUpperCase().replace(/[\s-]/g, '');
export const normPan = (v: unknown) => clean(v).toUpperCase().replace(/[\s-]/g, '');
export const normIfsc = (v: unknown) => clean(v).toUpperCase().replace(/[\s-]/g, '');

/** Excel turns 301707 into a number, and 50200012345678 into 5.02E+13 if the
 *  column was General. Digits-only fields are rebuilt from whatever arrived. */
export function normDigits(v: unknown): string {
  if (typeof v === 'number') return Number.isFinite(v) ? v.toLocaleString('fullwide', { useGrouping: false }) : '';
  const s = clean(v);
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) return Number(s).toLocaleString('fullwide', { useGrouping: false });
  return s.replace(/\.0+$/, '').replace(/[\s-]/g, '');
}

/** Excel serial numbers, DD/MM/YYYY, DD-MM-YYYY, and ISO. Returns YYYY-MM-DD. */
export function normDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(+v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = clean(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return ok(y, +m[2], +m[1]); }
  return null;
}
function ok(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export { GST_STATES };

/* ================= added for the legacy vendor sheet ================= */

export type StatusCode = 'active' | 'inactive' | 'pending' | 'blocked';
const STATUS_WORDS: Record<StatusCode, string[]> = {
  active:   ['active', 'approved', 'onboarded', 'live', 'current', 'enabled', 'verified', 'registered', 'empanelled', 'empaneled', 'yes', 'y', 'true', '1'],
  inactive: ['inactive', 'in active', 'disabled', 'dormant', 'closed', 'discontinued', 'not active', 'deactivated', 'no', 'n', 'false', '0'],
  pending:  ['pending', 'draft', 'in process', 'in progress', 'under review', 'new', 'awaiting', 'submitted', 'applied', 'on hold', 'hold', 'review', 'to be verified', 'unverified'],
  blocked:  ['blocked', 'blacklisted', 'black listed', 'rejected', 'suspended', 'banned', 'debarred', 'terminated', 'disqualified'],
};
/** Returns null for blank AND for anything not recognised — the caller decides what that means. */
export function normStatus(v: unknown): StatusCode | null {
  const s = clean(v).toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  for (const [code, words] of Object.entries(STATUS_WORDS) as [StatusCode, string[]][])
    if (words.includes(s)) return code;
  return null;
}

/** "30", "45 days", "1 month", "Advance" … → days, plus the original wording when it is not a plain number. */
export function normCredit(v: unknown): { days: number | null; note: string | null; understood: boolean } | null {
  const raw = clean(v);
  if (!raw) return null;
  const s = raw.toLowerCase();
  let m = s.match(/^(\d{1,3})(?:\.0+)?\s*(?:d|day|days)?$/);
  if (m) { const d = +m[1]; return d <= 365 ? { days: d, note: null, understood: true } : { days: null, note: raw.slice(0, 100), understood: false }; }
  m = s.match(/^(\d{1,2})\s*(?:month|months|mth|mths)$/);
  if (m) return { days: +m[1] * 30, note: raw.slice(0, 100), understood: true };
  if (/^(advance|immediate|immediately|nil|cod|cash|prepaid|upfront|pro ?forma|on delivery|against delivery|on receipt|same day)\b/.test(s))
    return { days: 0, note: raw.slice(0, 100), understood: true };
  return { days: null, note: raw.slice(0, 100), understood: false };
}

/** Work out the industry from free-text Services. Returns null when nothing matches OR when more than one industry does. */
const IND_RX: Record<string, RegExp> = {
  recycling: /recycl|\bepr\b|waste|scrap|e-?waste|battery|batteries|tyre|tire|used oil|end of life|\bpwp\b|\bpibo\b|reprocess|pyrolysis|crumb rubber|granul|flake/i,
  packaging: /packag|packing|corrugat|carton|pallet|\bbox(es)?\b|stretch film|\bfilm\b|foam|bopp|strapping|\bcrate|\bpouch|bubble wrap|wrapping/i,
  transportation: /transport|logistic|freight|trucking|\btruck|\bfleet\b|\bftl\b|\bptl\b|\bvtl\b|cargo|courier|haulage|shipping|\bcarrier|\bdelivery vehicle/i,
};
export function deriveIndustry(text: unknown): { industry: 'recycling' | 'packaging' | 'transportation' | null; ambiguous: boolean } {
  const s = clean(text);
  if (!s) return { industry: null, ambiguous: false };
  const hits = (Object.keys(IND_RX) as ('recycling' | 'packaging' | 'transportation')[]).filter(k => IND_RX[k].test(s));
  if (hits.length === 1) return { industry: hits[0], ambiguous: false };
  return { industry: null, ambiguous: hits.length > 1 };
}

/** The "GST / Aadhaar" column holds either. A GSTIN is kept. An Aadhaar number is
 *  NEVER kept in full: only the last four digits survive, and the full number is
 *  never returned, echoed in a message, or written to a report. */
export type TaxId =
  | { kind: 'blank' }
  | { kind: 'gstin'; gstin: string }
  | { kind: 'aadhaar'; last4: string }
  | { kind: 'invalid'; shown: string };

export function parseTaxId(v: unknown, gstinRx: RegExp): TaxId {
  let s = normGstin(v);
  if (!s) return { kind: 'blank' };
  if (/^\d+(\.\d+)?E\+?\d+$/i.test(s)) s = normDigits(s);          // Excel turned it into 1.23E+11
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
  if (gstinRx.test(s)) return { kind: 'gstin', gstin: s };
  if (/^\d{12}$/.test(s)) return { kind: 'aadhaar', last4: s.slice(-4) };
  if (/^[X*•]{8}\d{4}$/i.test(s)) return { kind: 'aadhaar', last4: s.slice(-4) };
  // Anything that looks like a long number is described, not echoed.
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 9 && digits.length >= s.length - 2) return { kind: 'invalid', shown: `a number with ${digits.length} digits` };
  return { kind: 'invalid', shown: `"${s.slice(0, 20)}"` };
}

/** The MSME column may say Yes/No — or hold the Udyam number, or the category. */
export function normMsmeValue(v: unknown): { is_msme: boolean | null; category?: string; udyam?: string } {
  const raw = clean(v);
  if (!raw) return { is_msme: null };
  const u = raw.toUpperCase().replace(/\s+/g, '');
  if (/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(u)) return { is_msme: true, udyam: u };
  const b = normBool(raw);
  if (b !== null) return { is_msme: b };
  const cat = normMsmeCategory(raw);
  if (cat) return { is_msme: true, category: cat };
  return { is_msme: null };
}

/** A document column holds a link, a file name, or Yes/No. Only something real is kept. */
export function docRef(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  if (/^(no|n|na|n\/a|nil|none|null|-+|false|0|not available|not received|pending|missing)$/i.test(s)) return null;
  return s.slice(0, 300);
}
