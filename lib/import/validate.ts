import { RX, panFromGstin, stateFromGstin } from '@/lib/constants';
import { FIELD_BY_KEY, IMPORT_FIELDS } from './fields';
import {
  clean, normBool, normPhone, normMoney, normNumber, normIndustry, normEntity, normMsmeCategory,
  normNda, normState, normGeography, normPan, normIfsc, normDigits, normDate,
  normStatus, normCredit, deriveIndustry, parseTaxId, normMsmeValue, docRef,
} from './normalise';

export type ProblemCode =
  | 'no_identity' | 'gstin_format' | 'aadhaar_masked' | 'pan_mismatch' | 'no_legal_name'
  | 'duplicate_in_file' | 'already_in_system'
  | 'pincode' | 'ifsc' | 'email' | 'mobile' | 'year_range'
  | 'msme_no_udyam' | 'no_industry' | 'cin_missing' | 'status' | 'credit_period' | 'date'
  | 'too_long' | 'bad_value';

/** blocking: this row cannot be saved, or would duplicate something. It is held back and listed.
 *  fixable: a value was blank, bad or unknown; it is left blank (or set to a safe default) and the row still imports. */
export type Severity = 'blocking' | 'fixable';

export type Problem = { code: ProblemCode; severity: Severity; message: string; field?: string };

export const PROBLEM_TITLE: Record<ProblemCode, string> = {
  no_identity: 'No valid PAN or GSTIN — cannot tell which company this is',
  gstin_format: 'GSTIN not valid (left blank)',
  aadhaar_masked: 'Aadhaar number found — only the last four digits are kept',
  pan_mismatch: 'PAN does not match the PAN inside the GSTIN',
  no_legal_name: 'No vendor name',
  duplicate_in_file: 'Same vendor appears twice in this file',
  already_in_system: 'Already on record',
  pincode: 'Pincode malformed (left blank)',
  ifsc: 'IFSC malformed (left blank)',
  email: 'Email malformed (left blank)',
  mobile: 'Mobile malformed (left blank)',
  year_range: 'Year established out of range (left blank)',
  msme_no_udyam: 'MSME is Yes but category or Udyam number is missing',
  no_industry: 'Industry not known (left unclassified)',
  cin_missing: 'Entity type dropped: a company or LLP needs a CIN and none was given',
  status: 'Status not recognised (set to Pending)',
  credit_period: 'Credit period is not a number of days (wording kept as a note)',
  date: 'Created date not understood or in the future (ignored)',
  too_long: 'Value too long for its field',
  bad_value: 'Value not understood (left blank)',
};

/** What the person should be told about a group of rows. */
export function problemNote(code: ProblemCode, severity: Severity): string {
  if (code === 'duplicate_in_file' || code === 'already_in_system')
    return 'These rows are skipped: the vendor is already on record, or is repeated in the file.';
  if (severity === 'blocking')
    return 'These rows cannot be saved as they are, so they are held back and not imported.';
  return 'These rows still import. The value is left blank (or set to a safe default) so it can be fixed on the record.';
}

export type Contact = { rank: number; name: string; designation: string; mobile: string; email: string };

export type ParsedRow = {
  rowNumber: number;                        // as seen in the spreadsheet (header = 1)
  company: Record<string, unknown>;
  site: Record<string, unknown>;
  contacts: Contact[];
  geography: string[];
  problems: Problem[];
  gstin: string;                            // '' when there is none. Never holds an Aadhaar number.
  pan: string | null;
  legacyCode: string | null;
  industryDerived: boolean;
  statusBlank: boolean;                     // a Status column exists but this cell was empty
};

/** mapping: field key → column index in the sheet. */
export type Mapping = Record<string, number>;

const currentYear = () => new Date().getFullYear();

export function parseRow(raw: unknown[], mapping: Mapping, rowNumber: number): ParsedRow {
  const get = (k: string) => (k in mapping ? raw[mapping[k]] : undefined);
  const problems: Problem[] = [];
  const add = (code: ProblemCode, severity: Severity, message: string, field?: string) =>
    problems.push({ code, severity, message, field });

  const company: Record<string, unknown> = {};
  const site: Record<string, unknown> = {};

  /* ---------- who is this? GSTIN (or Aadhaar) and PAN ---------- */
  const tax = parseTaxId(get('gstin'), RX.gstin);
  const gstin = tax.kind === 'gstin' ? tax.gstin : '';
  const derivedPan = gstin ? panFromGstin(gstin) : null;

  const givenPan = normPan(get('pan'));
  const givenPanOk = !!givenPan && RX.pan.test(givenPan);
  let pan: string | null = derivedPan ?? (givenPanOk ? givenPan : null);

  if (givenPan && !givenPanOk && derivedPan)
    add('bad_value', 'fixable', `PAN "${givenPan}" is malformed; the PAN from the GSTIN was used.`, 'pan');
  if (givenPanOk && derivedPan && givenPan !== derivedPan) {
    add('pan_mismatch', 'blocking', `PAN column says ${givenPan}, the GSTIN says ${derivedPan}.`, 'pan');
    pan = null;
  }

  if (!pan && !problems.some(p => p.code === 'pan_mismatch')) {
    const parts: string[] = [];
    if (tax.kind === 'blank') parts.push('the GSTIN / Aadhaar column is empty');
    else if (tax.kind === 'aadhaar') parts.push('the GSTIN / Aadhaar column holds an Aadhaar number, which cannot identify a company');
    else if (tax.kind === 'invalid') parts.push(`the GSTIN / Aadhaar column holds ${tax.shown}, which is not a GSTIN`);
    if (!givenPan) parts.push('the PAN column is empty');
    else if (!givenPanOk) parts.push(`the PAN "${givenPan}" is malformed`);
    add('no_identity', 'blocking', `A PAN or a valid GSTIN is needed: ${parts.join(', and ')}.`, 'pan');
  } else if (pan) {
    if (tax.kind === 'invalid') add('gstin_format', 'fixable', `GSTIN ${tax.shown} is not valid and was left blank; the PAN was used.`, 'gstin');
    if (tax.kind === 'aadhaar') {
      add('aadhaar_masked', 'fixable', 'An Aadhaar number was found. Only its last four digits are stored; the full number is not.', 'gstin');
      site.aadhaar_last4 = tax.last4;
    }
  }
  if (pan) company.pan = pan;
  if (gstin) site.gstin = gstin;

  /* ---------- the vendor ---------- */
  const legal = clean(get('legal_name'));
  if (!legal) add('no_legal_name', 'blocking', 'Vendor name is empty.', 'legal_name'); else company.legal_name = legal;
  for (const k of ['website', 'key_clients', 'bank_account_name', 'bank_branch', 'authorised_signatory', 'cin', 'udyam_number'] as const) {
    const v = clean(get(k)); if (v) company[k] = k === 'cin' || k === 'udyam_number' ? v.toUpperCase() : v;
  }

  const legacyCode = clean(get('legacy_code')) || null;
  if (legacyCode) site.legacy_vendor_code = legacyCode;

  const entityRaw = clean(get('entity'));
  if (entityRaw) {
    const e = normEntity(entityRaw);
    if (e) company.entity = e; else add('bad_value', 'fixable', `Entity type "${entityRaw}" not recognised.`, 'entity');
  }
  // The database refuses an entity of pvt_ltd / public_ltd / llp without a CIN.
  // Rather than hold the row, the entity type is left blank and reported.
  if (['pvt_ltd', 'public_ltd', 'llp'].includes(String(company.entity ?? '')) && !company.cin) {
    add('cin_missing', 'fixable', `Entity type "${entityRaw}" was not stored because no CIN / LLPIN was given. Add both on the record.`, 'entity');
    delete company.entity;
  }

  /* ---------- MSME: the column may be Yes/No, a Udyam number, or a category ---------- */
  const msmeRaw = get('is_msme');
  const msme = normMsmeValue(msmeRaw);
  if (clean(msmeRaw) && msme.is_msme === null) add('bad_value', 'fixable', `MSME "${clean(msmeRaw)}" is not a yes or no.`, 'is_msme');
  if (msme.is_msme !== null) company.is_msme = msme.is_msme;
  if (msme.udyam && !company.udyam_number) company.udyam_number = msme.udyam;
  const catCol = normMsmeCategory(get('msme_category'));
  if (catCol) company.msme_category = catCol; else if (msme.category) company.msme_category = msme.category;
  if (msme.is_msme === true) {
    if (!company.msme_category || !company.udyam_number)
      add('msme_no_udyam', 'fixable', 'MSME is Yes but the category or Udyam number is missing. Add them on the record.', 'udyam_number');
  } else if (msme.is_msme === false) { delete company.msme_category; delete company.udyam_number; }

  const yr = normNumber(get('year_established'));
  if (yr !== null) {
    if (Number.isInteger(yr) && yr >= 1900 && yr <= currentYear()) company.year_established = yr;
    else add('year_range', 'fixable', `Year ${yr} is outside 1900 to ${currentYear()} and was dropped.`, 'year_established');
  }

  for (const k of ['turnover_current', 'turnover_previous'] as const) {
    const r = get(k); const n = normMoney(r);
    if (n !== null) company[k] = n; else if (clean(r)) add('bad_value', 'fixable', `${FIELD_BY_KEY[k].header} "${clean(r)}" is not a number.`, k);
  }
  const t1 = normBool(get('serves_tier1_oem')); if (t1 !== null) company.serves_tier1_oem = t1;
  const chq = normBool(get('cheque_on_file')); if (chq !== null) company.cheque_on_file = chq;

  /* ---------- credit period ---------- */
  const credit = normCredit(get('credit_period'));
  if (credit) {
    if (credit.days !== null) company.credit_period_days = credit.days;
    if (credit.note) company.credit_period_note = credit.note;
    if (!credit.understood) add('credit_period', 'fixable', `Credit period "${clean(get('credit_period')).slice(0, 40)}" is not a number of days; kept as a note.`, 'credit_period');
  }

  /* ---------- created date ---------- */
  const createdRaw = get('created_date');
  if (clean(createdRaw) || createdRaw instanceof Date) {
    const d = normDate(createdRaw);
    const today = new Date().toISOString().slice(0, 10);
    if (d && d <= today && d >= '1990-01-01') { company.created_at = d; site.created_at = d; }
    else add('date', 'fixable', `Created date "${clean(createdRaw)}" is not a usable past date and was ignored.`, 'created_date');
  }

  /* ---------- banking ---------- */
  const acct = normDigits(get('bank_account_number')); if (acct) company.bank_account_number = acct;
  const ifscRaw = normIfsc(get('ifsc'));
  if (ifscRaw) {
    if (RX.ifsc.test(ifscRaw)) company.ifsc = ifscRaw;
    else add('ifsc', 'fixable', `IFSC "${ifscRaw}" is malformed and was dropped.`, 'ifsc');
  }
  const nda = clean(get('nda_status'));
  if (nda) { const s = normNda(nda); if (s) company.nda_status = s; else add('bad_value', 'fixable', `NDA status "${nda}" not understood.`, 'nda_status'); }
  const ndaDateRaw = get('nda_signed_date');
  if (clean(ndaDateRaw) || ndaDateRaw instanceof Date) {
    const d = normDate(ndaDateRaw); if (d) company.nda_signed_date = d; else add('bad_value', 'fixable', `NDA date "${clean(ndaDateRaw)}" not understood.`, 'nda_signed_date');
  }

  /* ---------- site: services, industry, status, projects ---------- */
  const services = clean(get('services_text')); if (services) site.services_text = services;
  const projects = clean(get('projects_text')); if (projects) site.projects_text = projects;

  let industry = normIndustry(get('industry'));
  let industryDerived = false;
  const industryRaw = clean(get('industry'));
  if (!industry && services) {
    const d = deriveIndustry(services);
    if (d.industry) { industry = d.industry; industryDerived = true; }
    else add('no_industry', 'fixable', d.ambiguous ? 'Services point to more than one industry, so the vendor was left unclassified.' : 'The industry could not be worked out from Services, so the vendor was left unclassified.', 'industry');
  } else if (!industry) {
    add('no_industry', 'fixable', industryRaw ? `Industry "${industryRaw}" not recognised; left unclassified.` : 'No industry and no Services to work it out from; left unclassified.', 'industry');
  }
  if (industry) site.industry = industry;

  // A blank status quietly becomes Pending (and is counted in the summary of what is blank);
  // a status that is written but not understood is flagged, because someone meant something by it.
  let statusBlank = false;
  if ('status' in mapping) {
    const statusRaw = clean(get('status'));
    const st = normStatus(statusRaw);
    if (st) site.status = st;
    else {
      site.status = 'pending';
      if (statusRaw) add('status', 'fixable', `Status "${statusRaw.slice(0, 30)}" not recognised; set to Pending.`, 'status');
      else statusBlank = true;
    }
  }

  const sn = clean(get('site_name')); if (sn) site.site_name = sn;
  const addr = clean(get('address_line1')); if (addr) site.address_line1 = addr;
  const city = clean(get('city')); if (city) site.city = city;

  let state = normState(get('state'));
  if (!state && clean(get('state'))) add('bad_value', 'fixable', `State "${clean(get('state'))}" not recognised.`, 'state');
  if (!state && gstin) state = stateFromGstin(gstin);
  if (state) site.state = state;

  const pin = normDigits(get('pincode'));
  if (pin) { if (RX.pincode.test(pin)) site.pincode = pin; else add('pincode', 'fixable', `Pincode "${pin}" is not six digits, or starts with zero; left blank.`, 'pincode'); }

  /* ---------- document references ---------- */
  const refs: Record<string, string> = {};
  for (const [k, label] of [['doc_gst', 'gst'], ['doc_pan', 'pan'], ['doc_agreement', 'agreement'], ['doc_cheque', 'cheque'], ['doc_msme', 'msme']] as const) {
    const r = docRef(get(k)); if (r) refs[label] = r;
  }
  if (Object.keys(refs).length) site.legacy_documents = refs;
  if (refs.cheque && !('cheque_on_file' in company)) company.cheque_on_file = true;

  /* ---------- geography ---------- */
  const geoRaw = get('geography');
  let geography: string[] = [];
  if (clean(geoRaw)) {
    const g = normGeography(geoRaw);
    geography = g.states;
    if (g.unknown.length) add('bad_value', 'fixable', `Serviceable states not recognised: ${g.unknown.join(', ')}.`, 'geography');
  }

  /* ---------- contacts ---------- */
  const contacts: Contact[] = [];
  for (const n of [1, 2, 3] as const) {
    const k = `contact${n}`;
    const name = clean(get(`${k}_name`));
    const mobileRaw = get(`${k}_mobile`); const emailRaw = clean(get(`${k}_email`));
    const mobile = normPhone(normDigits(mobileRaw) || mobileRaw);
    const hasAny = name || mobile || emailRaw || clean(get(`${k}_designation`));
    if (!hasAny) continue;
    if (!name) { add('bad_value', 'fixable', `Contact ${n} has details but no name, so it was skipped.`, `${k}_name`); continue; }
    let m = '', e = '';
    if (mobile) { if (RX.mobile.test(mobile)) m = mobile; else add('mobile', 'fixable', `${name}: mobile "${mobile}" is not ten digits starting 6 to 9; dropped.`, `${k}_mobile`); }
    if (emailRaw) { if (RX.email.test(emailRaw)) e = emailRaw; else add('email', 'fixable', `${name}: email "${emailRaw}" looks wrong; dropped.`, `${k}_email`); }
    contacts.push({ rank: n, name, designation: clean(get(`${k}_designation`)), mobile: m, email: e });
  }

  /* ---------- length limits: over-long text would fail the insert, and cutting an account number silently would be worse ---------- */
  for (const [obj, limits] of [[company, COMPANY_MAX], [site, SITE_MAX]] as const)
    for (const [k, max] of Object.entries(limits)) {
      const v = obj[k];
      if (typeof v === 'string' && v.length > max)
        add('too_long', 'blocking', `${FIELD_BY_KEY[k]?.header ?? k} is ${v.length} characters; the limit is ${max}.`, k);
    }
  for (const c of contacts)
    for (const [k, max] of [['name', 100], ['designation', 100], ['email', 255]] as const)
      if (c[k].length > max) add('too_long', 'blocking', `${c.name}: ${k} is ${c[k].length} characters; the limit is ${max}.`, `contact${c.rank}_${k}`);

  return { rowNumber, company, site, contacts, geography, problems, gstin, pan, legacyCode, industryDerived, statusBlank };
}

const COMPANY_MAX: Record<string, number> = {
  cin: 21, udyam_number: 19, bank_account_name: 150, bank_account_number: 18, bank_branch: 150, authorised_signatory: 100,
};
const SITE_MAX: Record<string, number> = { site_name: 120, address_line1: 255, city: 100, legacy_vendor_code: 60 };

export type FileCheck = {
  rows: ParsedRow[];
  clean: number;                          // rows with no problems at all
  importable: number;                     // rows with no blocking problem
  held: number;                           // rows with at least one blocking problem
  byProblem: { code: ProblemCode; title: string; severity: Severity; rows: number[] }[];
  /** what will be blank after import — expected for legacy data, so shown as a summary, not as per-row problems */
  gaps: { label: string; rows: number }[];
  industryDerived: number;                // rows whose industry was worked out from Services
};

/** The keys that make one row "the same vendor" as another. A legacy vendor code is the strongest;
 *  otherwise GSTIN + pincode; otherwise the PAN alone. */
export function identityKeys(r: ParsedRow): string[] {
  const k: string[] = [];
  if (r.legacyCode) k.push(`L:${r.legacyCode.toUpperCase()}`);
  if (r.gstin && r.site.pincode) k.push(`G:${r.gstin}|${r.site.pincode}`);
  if (!r.legacyCode && r.gstin && !r.site.pincode) k.push(`G:${r.gstin}|`);
  if (!r.legacyCode && !r.gstin && r.pan) k.push(`P:${r.pan}`);
  return k;
}

/** Cross-row checks, then the summary. existing = identity keys already in the database ('L:…' and 'G:GSTIN|PINCODE'). */
export function checkFile(rows: ParsedRow[], existing: Set<string> = new Set()): FileCheck {
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (r.problems.some(p => p.severity === 'blocking')) continue;     // already held for another reason
    let done = false;
    for (const key of identityKeys(r)) {
      const what = key.startsWith('L:') ? 'vendor code' : key.startsWith('G:') ? 'GSTIN and pincode' : 'PAN';
      if (seen.has(key)) {
        r.problems.push({ code: 'duplicate_in_file', severity: 'blocking', field: 'gstin',
          message: `Same ${what} as row ${seen.get(key)}. That is the same vendor, not a second one.` });
        done = true; break;
      }
      if (existing.has(key)) {
        r.problems.push({ code: 'already_in_system', severity: 'blocking', field: 'gstin',
          message: `This ${what} is already on record.` });
        done = true; break;
      }
    }
    if (!done) for (const key of identityKeys(r)) seen.set(key, r.rowNumber);
  }

  const map = new Map<ProblemCode, { severity: Severity; rows: number[] }>();
  for (const r of rows) for (const p of r.problems) {
    const e = map.get(p.code) ?? { severity: p.severity, rows: [] };
    if (!e.rows.includes(r.rowNumber)) e.rows.push(r.rowNumber);
    map.set(p.code, e);
  }
  const byProblem = [...map.entries()].map(([code, v]) => ({ code, title: PROBLEM_TITLE[code], severity: v.severity, rows: v.rows }))
    .sort((a, b) => (a.severity === b.severity ? b.rows.length - a.rows.length : a.severity === 'blocking' ? -1 : 1));

  const ok = rows.filter(r => !r.problems.some(p => p.severity === 'blocking'));
  const count = (f: (r: ParsedRow) => boolean) => ok.filter(f).length;
  const gaps = [
    { label: 'No status given (set to Pending)', rows: count(r => r.statusBlank) },
    { label: 'No industry', rows: count(r => !r.site.industry) },
    { label: 'No address', rows: count(r => !r.site.address_line1) },
    { label: 'No state', rows: count(r => !r.site.state) },
    { label: 'No pincode', rows: count(r => !r.site.pincode) },
    { label: 'No GSTIN', rows: count(r => !r.site.gstin) },
    { label: 'No contact person', rows: count(r => r.contacts.length === 0) },
    { label: 'No bank account number or IFSC', rows: count(r => !r.company.bank_account_number || !r.company.ifsc) },
    { label: 'MSME without category or Udyam number', rows: count(r => r.company.is_msme === true && (!r.company.msme_category || !r.company.udyam_number)) },
  ].filter(g => g.rows > 0);

  return {
    rows,
    clean: rows.filter(r => r.problems.length === 0).length,
    importable: ok.length,
    held: rows.length - ok.length,
    byProblem, gaps,
    industryDerived: ok.filter(r => r.industryDerived).length,
  };
}

export { IMPORT_FIELDS };
