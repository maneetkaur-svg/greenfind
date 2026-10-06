import { RX, panFromGstin, stateFromGstin } from '@/lib/constants';
import { FIELD_BY_KEY, IMPORT_FIELDS } from './fields';
import {
  clean, normBool, normPhone, normMoney, normNumber, normIndustry, normEntity, normMsmeCategory,
  normNda, normState, normGeography, normGstin, normPan, normIfsc, normDigits, normDate,
} from './normalise';

export type ProblemCode =
  | 'gstin_format' | 'pan_mismatch' | 'duplicate_in_file' | 'already_in_system'
  | 'pincode' | 'ifsc' | 'email' | 'mobile' | 'year_range'
  | 'msme_no_udyam' | 'no_industry' | 'no_legal_name' | 'no_address' | 'no_city'
  | 'no_state' | 'cin_missing' | 'too_long' | 'bad_value';

/** blocking: the database cannot store the row as it stands.
 *  fixable: a bad optional value was dropped; the row still imports. */
export type Severity = 'blocking' | 'fixable';

export type Problem = { code: ProblemCode; severity: Severity; message: string; field?: string };

export const PROBLEM_TITLE: Record<ProblemCode, string> = {
  gstin_format: 'GSTIN format wrong',
  pan_mismatch: 'PAN does not match the PAN inside the GSTIN',
  duplicate_in_file: 'Same GSTIN and pincode appears twice in this file',
  already_in_system: 'This GSTIN and pincode is already in the system',
  pincode: 'Pincode missing or malformed',
  ifsc: 'IFSC malformed',
  email: 'Email malformed',
  mobile: 'Mobile malformed',
  year_range: 'Year established out of range',
  msme_no_udyam: 'MSME is Yes but category or Udyam number is missing',
  no_industry: 'No industry, or not recognised',
  no_legal_name: 'No legal name',
  no_address: 'No address',
  no_city: 'No city',
  no_state: 'No state, and none could be worked out from the GSTIN',
  cin_missing: 'Entity type dropped: a company or LLP needs a CIN and none was given',
  too_long: 'Value too long for its field',
  bad_value: 'Value not understood',
};

export type Contact = { rank: number; name: string; designation: string; mobile: string; email: string };

export type ParsedRow = {
  rowNumber: number;                        // as seen in the spreadsheet (header = 1)
  company: Record<string, unknown>;
  site: Record<string, unknown>;
  contacts: Contact[];
  geography: string[];
  problems: Problem[];
  gstin: string;
  pan: string | null;
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

  // ---- identity of the row: GSTIN and PAN ----
  const gstin = normGstin(get('gstin'));
  const derivedPan = panFromGstin(gstin);
  if (!gstin || !RX.gstin.test(gstin)) add('gstin_format', 'blocking', gstin ? `"${gstin}" is not a valid GSTIN.` : 'GSTIN is empty.', 'gstin');

  const givenPan = normPan(get('pan'));
  let pan: string | null = derivedPan;
  if (givenPan) {
    if (!RX.pan.test(givenPan)) add('bad_value', 'fixable', `PAN "${givenPan}" is malformed and was ignored.`, 'pan');
    else if (derivedPan && givenPan !== derivedPan)
      add('pan_mismatch', 'blocking', `PAN column says ${givenPan}, the GSTIN says ${derivedPan}.`, 'pan');
    else if (!derivedPan) pan = null; // a PAN with no valid GSTIN cannot make a site
  }
  if (pan) company.pan = pan;

  // ---- company ----
  const legal = clean(get('legal_name'));
  if (!legal) add('no_legal_name', 'blocking', 'Legal name is empty.', 'legal_name'); else company.legal_name = legal;
  for (const k of ['trade_name', 'website', 'key_clients', 'bank_account_name', 'bank_branch', 'authorised_signatory', 'cin', 'udyam_number'] as const) {
    const v = clean(get(k)); if (v) company[k] = k === 'cin' || k === 'udyam_number' ? v.toUpperCase() : v;
  }

  const entityRaw = clean(get('entity'));
  if (entityRaw) {
    const e = normEntity(entityRaw);
    if (e) company.entity = e; else add('bad_value', 'fixable', `Entity type "${entityRaw}" not recognised.`, 'entity');
  }
  // The database refuses an entity of pvt_ltd / public_ltd / llp without a CIN.
  // Rather than hold the row, the entity type is left blank and reported, so it
  // can be filled in on the record together with the CIN.
  if (['pvt_ltd', 'public_ltd', 'llp'].includes(String(company.entity ?? '')) && !company.cin) {
    add('cin_missing', 'fixable', `Entity type "${entityRaw}" was not stored because no CIN / LLPIN was given. Add both on the record.`, 'entity');
    delete company.entity;
  }

  const msmeRaw = get('is_msme');
  const msme = normBool(msmeRaw);
  if (clean(msmeRaw) && msme === null) add('bad_value', 'fixable', `MSME "${clean(msmeRaw)}" is not a yes or no.`, 'is_msme');
  if (msme !== null) company.is_msme = msme;
  if (msme === true) {
    const cat = normMsmeCategory(get('msme_category'));
    if (cat) company.msme_category = cat;
    if (!cat || !company.udyam_number) add('msme_no_udyam', 'blocking', 'MSME is Yes, so category and Udyam number are both needed.', 'udyam_number');
  } else { delete company.msme_category; delete company.udyam_number; }

  const yr = normNumber(get('year_established'));
  if (yr !== null) {
    if (Number.isInteger(yr) && yr >= 1900 && yr <= currentYear()) company.year_established = yr;
    else add('year_range', 'fixable', `Year ${yr} is outside 1900 to ${currentYear()} and was dropped.`, 'year_established');
  }

  for (const k of ['turnover_current', 'turnover_previous'] as const) {
    const raw = get(k); const n = normMoney(raw);
    if (n !== null) company[k] = n; else if (clean(raw)) add('bad_value', 'fixable', `${FIELD_BY_KEY[k].header} "${clean(raw)}" is not a number.`, k);
  }
  const t1 = normBool(get('serves_tier1_oem')); if (t1 !== null) company.serves_tier1_oem = t1;
  const chq = normBool(get('cheque_on_file')); if (chq !== null) company.cheque_on_file = chq;

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

  // ---- site ----
  if (gstin && RX.gstin.test(gstin)) site.gstin = gstin;
  const ind = normIndustry(get('industry'));
  if (ind) site.industry = ind; else add('no_industry', 'blocking', clean(get('industry')) ? `Industry "${clean(get('industry'))}" not recognised.` : 'Industry is empty.', 'industry');

  const sn = clean(get('site_name')); if (sn) site.site_name = sn;
  const addr = clean(get('address_line1'));
  if (addr) site.address_line1 = addr; else add('no_address', 'blocking', 'Address is empty.', 'address_line1');
  const city = clean(get('city'));
  if (city) site.city = city; else add('no_city', 'blocking', 'City is empty.', 'city');

  let state = normState(get('state'));
  if (!state && clean(get('state'))) add('bad_value', 'fixable', `State "${clean(get('state'))}" not recognised; using the GSTIN's state.`, 'state');
  if (!state) state = stateFromGstin(gstin);
  if (state) site.state = state; else add('no_state', 'blocking', 'No state given and the GSTIN does not give one.', 'state');

  const pin = normDigits(get('pincode'));
  if (RX.pincode.test(pin)) site.pincode = pin;
  else add('pincode', 'blocking', pin ? `Pincode "${pin}" is not six digits, or starts with zero.` : 'Pincode is empty.', 'pincode');

  // ---- geography ----
  const geoRaw = get('geography');
  let geography: string[] = [];
  if (clean(geoRaw)) {
    const g = normGeography(geoRaw);
    geography = g.states;
    if (g.unknown.length) add('bad_value', 'fixable', `Serviceable states not recognised: ${g.unknown.join(', ')}.`, 'geography');
  }

  // ---- contacts ----
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

  // Longest values the database will accept. Over-long text would fail the insert,
  // and silently cutting an account number or Udyam number would be worse.
  for (const [obj, limits] of [[company, COMPANY_MAX], [site, SITE_MAX]] as const)
    for (const [k, max] of Object.entries(limits)) {
      const v = obj[k];
      if (typeof v === 'string' && v.length > max)
        add('too_long', 'blocking', `${FIELD_BY_KEY[k]?.header ?? k} is ${v.length} characters; the limit is ${max}.`, k);
    }
  for (const c of contacts)
    for (const [k, max] of [['name', 100], ['designation', 100], ['email', 255]] as const)
      if (c[k].length > max) add('too_long', 'blocking', `${c.name}: ${k} is ${c[k].length} characters; the limit is ${max}.`, `contact${c.rank}_${k}`);

  return { rowNumber, company, site, contacts, geography, problems, gstin, pan };
}

const COMPANY_MAX: Record<string, number> = {
  cin: 21, udyam_number: 19, bank_account_name: 150, bank_account_number: 18, bank_branch: 150, authorised_signatory: 100,
};
const SITE_MAX: Record<string, number> = { site_name: 120, address_line1: 255, city: 100 };

export type FileCheck = {
  rows: ParsedRow[];
  clean: number;                          // rows with no problems at all
  importable: number;                     // rows with no blocking problem
  held: number;                           // rows with at least one blocking problem
  byProblem: { code: ProblemCode; title: string; severity: Severity; rows: number[] }[];
};

/** Cross-row checks, then the summary. existing = "GSTIN|PINCODE" keys already in the database. */
export function checkFile(rows: ParsedRow[], existing: Set<string> = new Set()): FileCheck {
  const seen = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.gstin}|${r.site.pincode ?? ''}`;
    if (!r.site.gstin || !r.site.pincode) continue;     // already blocked for other reasons
    if (seen.has(key))
      r.problems.push({ code: 'duplicate_in_file', severity: 'blocking', field: 'gstin',
        message: `Same GSTIN and pincode as row ${seen.get(key)}. That is the same plant, not a second one.` });
    else seen.set(key, r.rowNumber);
    if (existing.has(key))
      r.problems.push({ code: 'already_in_system', severity: 'blocking', field: 'gstin',
        message: 'This GSTIN and pincode is already on record.' });
  }

  const map = new Map<ProblemCode, { severity: Severity; rows: number[] }>();
  for (const r of rows) for (const p of r.problems) {
    const e = map.get(p.code) ?? { severity: p.severity, rows: [] };
    if (!e.rows.includes(r.rowNumber)) e.rows.push(r.rowNumber);
    map.set(p.code, e);
  }
  const byProblem = [...map.entries()].map(([code, v]) => ({ code, title: PROBLEM_TITLE[code], severity: v.severity, rows: v.rows }))
    .sort((a, b) => (a.severity === b.severity ? b.rows.length - a.rows.length : a.severity === 'blocking' ? -1 : 1));

  return {
    rows,
    clean: rows.filter(r => r.problems.length === 0).length,
    importable: rows.filter(r => !r.problems.some(p => p.severity === 'blocking')).length,
    held: rows.filter(r => r.problems.some(p => p.severity === 'blocking')).length,
    byProblem,
  };
}

export { IMPORT_FIELDS };
