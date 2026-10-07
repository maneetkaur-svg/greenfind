import { test, expect } from '@playwright/test';
import { matchHeaders } from '@/lib/import/mapping';
import { parseRow, checkFile, type Mapping } from '@/lib/import/validate';
import { buildPlan } from '@/lib/import/plan';
import { IMPORT_FIELDS } from '@/lib/import/fields';
import { normBool, normPhone, normMoney, normIndustry, normState, normDate, normDigits, normGeography } from '@/lib/import/normalise';

const mapFor = (headers: string[]): Mapping => {
  const m: Mapping = {};
  matchHeaders(headers).forEach(c => { if (c.key) m[c.key] = c.index; });
  return m;
};

test.describe('header matching', () => {
  test('recognises what people actually type', () => {
    const pairs: [string, string][] = [
      ['Company Name', 'legal_name'], ['GST No', 'gstin'], ['GSTIN Number', 'gstin'], ['MSME?', 'is_msme'],
      ['Annual Turnover (FY 24-25)', 'turnover_current'], ['Contact Person', 'contact1_name'], ['Mobile No', 'contact1_mobile'],
    ];
    for (const [h, key] of pairs) expect(matchHeaders([h])[0].key, h).toBe(key);
  });

  test('longest alias wins: "Turnover previous FY" is not "Turnover"', () => {
    const m = matchHeaders(['Turnover', 'Turnover previous FY']);
    expect(m[0].key).toBe('turnover_current');
    expect(m[1].key).toBe('turnover_previous');
    // and the other way round in the file
    const m2 = matchHeaders(['Turnover previous FY', 'Turnover']);
    expect(m2[0].key).toBe('turnover_previous');
    expect(m2[1].key).toBe('turnover_current');
  });

  test('one field is claimed by one column only', () => {
    const m = matchHeaders(['GSTIN', 'GST No']);
    expect(m.filter(c => c.key === 'gstin')).toHaveLength(1);
  });

  test('every header the template writes maps back to its own field', () => {
    for (const f of IMPORT_FIELDS) expect(matchHeaders([f.header])[0].key, f.header).toBe(f.key);
  });

  test('unknown headers match nothing', () => {
    expect(matchHeaders(['Favourite colour'])[0].key).toBeNull();
  });
});

test.describe('normalisation', () => {
  test('yes/no in any form', () => {
    for (const v of ['Y', 'yes', 'TRUE', 1, '1', '✓']) expect(normBool(v), String(v)).toBe(true);
    for (const v of ['n', 'No', 'false', 0, '0']) expect(normBool(v), String(v)).toBe(false);
    expect(normBool('maybe')).toBeNull();
  });
  test('phones lose +91 and punctuation', () => {
    expect(normPhone('+91 98765-43210')).toBe('9876543210');
    expect(normPhone('09876543210')).toBe('9876543210');
    expect(normPhone('919876543210')).toBe('9876543210');
  });
  test('money loses commas and rupee signs', () => {
    expect(normMoney('₹1,25,00,000')).toBe(12500000);
    expect(normMoney('abc')).toBeNull();
  });
  test('industry aliases', () => {
    expect(normIndustry('Logistics')).toBe('transportation');
    expect(normIndustry('Circularity')).toBe('recycling');
    expect(normIndustry('Packing')).toBe('packaging');
    expect(normIndustry('Pharma')).toBeNull();
  });
  test('states matched loosely', () => {
    expect(normState('orissa')).toBe('Odisha');
    expect(normState('  RAJASTHAN ')).toBe('Rajasthan');
    expect(normState('J&K')).toBe('Jammu & Kashmir');
  });
  test('Excel damage is repaired', () => {
    expect(normDigits(301707)).toBe('301707');
    expect(normDigits('5.02E+13')).toBe('50200000000000');
    expect(normDate(46280)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(normDate('15/09/2026')).toBe('2026-09-15');
    expect(normDate('31/02/2026')).toBeNull();
  });
  test('geography: regions, Pan India, unknowns', () => {
    expect(normGeography('Pan India').states).toHaveLength(36);
    expect(normGeography('Central').states.sort()).toEqual(['Chhattisgarh', 'Madhya Pradesh']);
    const g = normGeography('Rajasthan; Atlantis | Gujarat');
    expect(g.states.sort()).toEqual(['Gujarat', 'Rajasthan']);
    expect(g.unknown).toEqual(['Atlantis']);
  });
});

const HEAD = ['Company Name', 'GST No', 'Industry', 'Address', 'City', 'Pincode', 'MSME?', 'Udyam No', 'IFSC', 'Primary contact name', 'Mobile No', 'Email'];
const good = (over: Partial<Record<string, string>> = {}) => {
  const base: Record<string, string> = {
    'Company Name': 'Shree Jageram Industries', 'GST No': '08AYEPP3943P1ZK', 'Industry': 'Recycling',
    'Address': 'Plot 14, RIICO', 'City': 'Alwar', 'Pincode': '301707', 'MSME?': 'No', 'Udyam No': '',
    'IFSC': 'HDFC0000432', 'Primary contact name': 'Ramesh', 'Mobile No': '+91 98765 43210', 'Email': 'r@example.com', ...over,
  };
  return HEAD.map(h => base[h]);
};

test.describe('row checks', () => {
  const mapping = mapFor(HEAD);

  test('a clean row has no problems and the state comes from the GSTIN', () => {
    const r = parseRow(good(), mapping, 2);
    expect(r.problems).toEqual([]);
    expect(r.pan).toBe('AYEPP3943P');
    expect(r.site.state).toBe('Rajasthan');
    expect(r.contacts[0].mobile).toBe('9876543210');
  });

  test('a bad GSTIN with nothing else to identify the company is held back', () => {
    const r = parseRow(good({ 'GST No': '08AYEPP3943' }), mapping, 2);
    const p = r.problems.find(x => x.code === 'no_identity')!;
    expect(p.severity).toBe('blocking');
    expect(r.problems.map(x => x.code)).not.toContain('gstin_format');   // one root cause, reported once
  });

  test('a bad GSTIN with a good PAN imports, GSTIN left blank', () => {
    const h = [...HEAD, 'PAN']; const m = mapFor(h);
    const r = parseRow([...good({ 'GST No': '08AYEPP3943' }), 'AYEPP3943P'], m, 2);
    expect(r.problems.map(x => x.code)).toEqual(['gstin_format']);
    expect(r.problems[0].severity).toBe('fixable');
    expect(r.pan).toBe('AYEPP3943P');
    expect(r.site.gstin).toBeUndefined();
  });

  test('bad optional values are dropped and flagged, row still importable', () => {
    const r = parseRow(good({ IFSC: 'HDFC123', 'Mobile No': '12345', Email: 'nope' }), mapping, 2);
    expect(r.problems.map(p => p.code).sort()).toEqual(['email', 'ifsc', 'mobile']);
    expect(r.problems.every(p => p.severity === 'fixable')).toBe(true);
    expect(r.company.ifsc).toBeUndefined();
    expect(r.contacts[0].mobile).toBe('');
  });

  test('MSME yes with no Udyam is flagged but still imports (migrated records may be incomplete)', () => {
    const r = parseRow(good({ 'MSME?': 'Y' }), mapping, 2);
    const p = r.problems.find(x => x.code === 'msme_no_udyam')!;
    expect(p.severity).toBe('fixable');
  });

  test('no industry is flagged, and the row still imports unclassified', () => {
    const r = parseRow(good({ Industry: '' }), mapping, 2);
    expect(r.problems.find(p => p.code === 'no_industry')!.severity).toBe('fixable');
    expect(r.site.industry).toBeUndefined();
  });

  test('PAN column that disagrees with the GSTIN is flagged', () => {
    const h = [...HEAD, 'PAN']; const m = mapFor(h);
    const r = parseRow([...good(), 'ABCDE1234F'], m, 2);
    expect(r.problems.map(p => p.code)).toContain('pan_mismatch');
  });

  test('duplicate in file and already in system', () => {
    const rows = [parseRow(good(), mapping, 2), parseRow(good(), mapping, 3), parseRow(good({ 'GST No': '27ABCDE1234F1Z5' }), mapping, 4)];
    const c = checkFile(rows, new Set(['G:27ABCDE1234F1Z5|301707']));
    const codes = c.byProblem.map(b => b.code);
    expect(codes).toContain('duplicate_in_file');
    expect(codes).toContain('already_in_system');
    expect(c.byProblem.find(b => b.code === 'duplicate_in_file')!.rows).toEqual([3]);
  });

  test('same GSTIN with a different pincode is a second plant, not a duplicate', () => {
    const c = checkFile([parseRow(good(), mapping, 2), parseRow(good({ Pincode: '301001' }), mapping, 3)]);
    expect(c.byProblem.map(b => b.code)).not.toContain('duplicate_in_file');
  });
});

test.describe('company and site split', () => {
  const mapping = mapFor(HEAD);

  test('two rows sharing a PAN make one company with two sites', () => {
    const rows = [
      parseRow(good(), mapping, 2),                                              // Rajasthan
      parseRow(good({ 'GST No': '24AYEPP3943P1ZB', City: 'Surat', Pincode: '395003' }), mapping, 3), // Gujarat, same PAN
      parseRow(good({ 'Company Name': 'Other Co', 'GST No': '27ABCDE1234F1Z5' }), mapping, 4),
    ];
    const plan = buildPlan(checkFile(rows).rows);
    expect(plan.companies).toHaveLength(2);
    const jag = plan.companies.find(c => c.pan === 'AYEPP3943P')!;
    expect(jag.sites).toHaveLength(2);
    expect(jag.sites.map(s => s.site.state).sort()).toEqual(['Gujarat', 'Rajasthan']);
  });

  test('later rows fill gaps in company fields but never overwrite', () => {
    const h = [...HEAD, 'Website']; const m = mapFor(h);
    const a = parseRow([...good({ }), ''], m, 2);
    const b = parseRow([...good({ 'Company Name': 'Different Name', 'GST No': '24AYEPP3943P1ZB', Pincode: '395003' }), 'www.x.example'], m, 3);
    const jag = buildPlan([a, b]).companies[0];
    expect(jag.company.legal_name).toBe('Shree Jageram Industries');
    expect(jag.company.website).toBe('www.x.example');
  });

  test('rows with blocking problems are held, not planned', () => {
    const rows = [parseRow(good(), mapping, 2), parseRow(good({ 'GST No': 'bad' }), mapping, 3)];
    const plan = buildPlan(checkFile(rows).rows);
    expect(plan.companies[0].sites).toHaveLength(1);
    expect(plan.held.map(r => r.rowNumber)).toEqual([3]);
  });

  test('a fixable problem still imports, flagged', () => {
    const plan = buildPlan(checkFile([parseRow(good({ IFSC: 'bad' }), mapping, 2)]).rows);
    expect(plan.companies[0].sites[0].flagged).toBe(true);
  });
});

import * as XLSX from 'xlsx';
import { unzipSync, strFromU8 } from 'fflate';
import { buildTemplate, templateHeaders, templateBytes } from '@/lib/import/template';
import { readFile, splitSheet } from '@/lib/import/readFile';

const toBuffer = (wb: XLSX.WorkBook) => {
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
};

test.describe('template', () => {
  test('has the three sheets, and headers match the importer exactly', () => {
    const r = readFile('t.xlsx', toBuffer(buildTemplate()));
    expect(r.sheets.map(s => s.name)).toEqual(['Vendor data', 'How to fill', 'Example']);
    expect(r.sheets[r.defaultSheet].name).toBe('Vendor data');
    const { headers, data } = splitSheet(r.sheets[0].rows);
    expect(headers).toEqual(templateHeaders());
    expect(data).toHaveLength(0);                                   // headers only
    const m = matchHeaders(headers as string[]);
    expect(m.every(c => c.key)).toBe(true);                          // every column recognised
  });

  test('the Example sheet imports: row 2 clean, row 3 scruffy but fully understood', () => {
    const r = readFile('t.xlsx', toBuffer(buildTemplate()));
    const { headers, data } = splitSheet(r.sheets[2].rows);
    const mapping = mapFor(headers as string[]);
    const parsed = data.filter(d => String(d.cells[0] ?? '').length < 100).map(d => parseRow(d.cells, mapping, d.rowNumber));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].problems).toEqual([]);
    expect(parsed[1].problems).toEqual([]);
    expect(parsed[1].site.industry).toBe('packaging');
    expect(parsed[1].company.entity).toBe('pvt_ltd');
    expect(parsed[1].company.turnover_current).toBe(12500000);
    expect(parsed[1].contacts[0].mobile).toBe('9876543210');
    expect(parsed[1].geography).toHaveLength(36);
    expect(parsed[1].site.state).toBe('Maharashtra');
  });

  test('the saved file really carries a frozen top row, Text columns, and still reads back', () => {
    const bytes = templateBytes();
    const files = unzipSync(bytes);
    expect(strFromU8(files['xl/worksheets/sheet1.xml'])).toContain('state="frozen"');
    expect(strFromU8(files['xl/styles.xml'])).toContain('numFmtId="49"')   // 49 is Excel's built-in Text format;
    const r = readFile('t.xlsx', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(r.sheets.map(s => s.name)).toEqual(['Vendor data', 'How to fill', 'Example']);
  });
});

test.describe('reading files', () => {
  test('CSV, including a BOM, blank rows and spreadsheet row numbers', () => {
    const csv = '\uFEFFCompany Name,GST No,Pincode\n\nShree Jageram,08AYEPP3943P1ZK,301707\n,,\nOther,27ABCDE1234F1Z5,411001\n';
    const r = readFile('x.csv', new TextEncoder().encode(csv).buffer as ArrayBuffer);
    const { headers, data } = splitSheet(r.sheets[0].rows);
    expect(String(headers[0]).replace(/^\uFEFF/, '')).toBe('Company Name');
    expect(data.map(d => d.rowNumber)).toEqual([3, 5]);   // header=1, blank=2, Shree=3, ',,'=4, Other=5
  });

  test('JSON: array of records, lists joined, missing keys filled', () => {
    const json = JSON.stringify([{ 'Company Name': 'A', 'GST No': '08AYEPP3943P1ZK', states: ['Goa', 'Kerala'] }, { 'Company Name': 'B' }]);
    const r = readFile('x.json', new TextEncoder().encode(json).buffer as ArrayBuffer);
    expect(r.sheets[0].rows[1]).toEqual(['A', '08AYEPP3943P1ZK', 'Goa; Kerala']);
    expect(r.sheets[0].rows[2]).toEqual(['B', '', '']);
  });

  test('unsupported files are refused with a plain message', () => {
    expect(() => readFile('x.pdf', new ArrayBuffer(4))).toThrow(/\.xlsx/);
  });
});

test.describe('schema-driven rules', () => {
  const mapping = mapFor(HEAD);
  test('Private Limited with no CIN: entity is dropped and reported, not left to fail the insert', () => {
    const h = [...HEAD, 'Entity Type']; const m = mapFor(h);
    const r = parseRow([...good(), 'Private Limited'], m, 2);
    expect(r.company.entity).toBeUndefined();
    expect(r.problems.map(p => p.code)).toContain('cin_missing');
    expect(r.problems.every(p => p.severity === 'fixable')).toBe(true);
  });
  test('over-long Udyam number is blocking, not silently cut', () => {
    const r = parseRow(good({ 'MSME?': 'Y', 'Udyam No': 'UDYAM-RJ-02-0041178-EXTRA' }), mapping, 2);
    expect(r.problems.map(p => p.code)).toContain('too_long');
  });
  test('MSME left blank is not recorded as No, so a later row can still supply it', () => {
    const r = parseRow(good({ 'MSME?': '' }), mapping, 2);
    expect(r.company.is_msme).toBeUndefined();
  });
});

/* ===================== the legacy vendor sheet: the client's exact 17 columns ===================== */
const LEGACY = ['Vendor Code', 'Vendor Name', 'Services', 'Credit Period', 'GST / Aadhaar', 'PAN Number', 'Account Number', 'IFSC Code',
  'Projects', 'MSME', 'Status', 'GST/Aadhaar Document', 'PAN Document', 'Agreement Document', 'Cancelled Cheque', 'MSME Document', 'Created Date'];
const legacyRow = (o: Record<string, unknown> = {}) => {
  const base: Record<string, unknown> = {
    'Vendor Code': 'V-001', 'Vendor Name': 'ZZ Legacy Recyclers', 'Services': 'PET bottle recycling', 'Credit Period': '45 days',
    'GST / Aadhaar': '08AYEPP3943P1ZK', 'PAN Number': 'AYEPP3943P', 'Account Number': '50200012345678', 'IFSC Code': 'HDFC0000432',
    'Projects': 'Reliance EPR', 'MSME': 'No', 'Status': 'Active', 'GST/Aadhaar Document': 'gst.pdf', 'PAN Document': 'pan.pdf',
    'Agreement Document': 'agr.pdf', 'Cancelled Cheque': 'chq.pdf', 'MSME Document': '', 'Created Date': '15/03/2024', ...o,
  };
  return LEGACY.map(h => base[h] ?? '');
};
const legacyMap = mapFor(LEGACY);
const legacyParse = (o: Record<string, unknown> = {}, n = 2) => parseRow(legacyRow(o), legacyMap, n);

test.describe('legacy sheet: columns', () => {
  test('all 17 headings are recognised, each as the right field', () => {
    const want: Record<string, string> = {
      'Vendor Code': 'legacy_code', 'Vendor Name': 'legal_name', 'Services': 'services_text', 'Credit Period': 'credit_period',
      'GST / Aadhaar': 'gstin', 'PAN Number': 'pan', 'Account Number': 'bank_account_number', 'IFSC Code': 'ifsc', 'Projects': 'projects_text',
      'MSME': 'is_msme', 'Status': 'status', 'GST/Aadhaar Document': 'doc_gst', 'PAN Document': 'doc_pan', 'Agreement Document': 'doc_agreement',
      'Cancelled Cheque': 'doc_cheque', 'MSME Document': 'doc_msme', 'Created Date': 'created_date',
    };
    const got = matchHeaders(LEGACY);
    for (const c of got) expect(c.key, c.header).toBe(want[c.header]);
    expect(new Set(got.map(c => c.key)).size).toBe(17);
  });

  test('a full legacy row imports clean, with no address, state or contact required', () => {
    const r = legacyParse();
    expect(r.problems).toEqual([]);
    expect(r.pan).toBe('AYEPP3943P');
    expect(r.site.state).toBe('Rajasthan');                      // from the GSTIN
    expect(r.site.industry).toBe('recycling');                   // from Services
    expect(r.industryDerived).toBe(true);
    expect(r.site.status).toBe('active');
    expect(r.site.legacy_vendor_code).toBe('V-001');
    expect(r.company.credit_period_days).toBe(45);
    expect(r.company.created_at).toBe('2024-03-15');
    expect(r.company.cheque_on_file).toBe(true);                 // a cheque reference means one is on file
    expect(r.site.legacy_documents).toEqual({ gst: 'gst.pdf', pan: 'pan.pdf', agreement: 'agr.pdf', cheque: 'chq.pdf' });
    expect(r.site.address_line1).toBeUndefined();
  });

  test('legacy rows report what will be blank as a summary, not as per-row problems', () => {
    const c = checkFile([legacyParse({}, 2), legacyParse({ 'Vendor Code': 'V-002', 'GST / Aadhaar': '24AYEPP3943P1ZB' }, 3)]);
    expect(c.rows.every(r => r.problems.length === 0)).toBe(true);
    const labels = c.gaps.map(g => g.label);
    expect(labels).toEqual(expect.arrayContaining(['No address', 'No pincode', 'No contact person']));
    expect(c.gaps.find(g => g.label === 'No address')!.rows).toBe(2);
    expect(c.industryDerived).toBe(2);
  });
});

test.describe('legacy sheet: GST / Aadhaar', () => {
  const AADHAAR = '234567890123';
  const everything = (r: ReturnType<typeof legacyParse>) => JSON.stringify(r);

  test('an Aadhaar number keeps only its last four digits — and the full number appears nowhere', () => {
    const r = legacyParse({ 'GST / Aadhaar': AADHAAR });
    expect(r.site.aadhaar_last4).toBe('0123');
    expect(r.site.gstin).toBeUndefined();
    expect(r.gstin).toBe('');
    expect(r.problems.map(p => p.code)).toEqual(['aadhaar_masked']);
    expect(everything(r)).not.toContain(AADHAAR);
    expect(r.problems.every(p => p.severity === 'fixable')).toBe(true);
  });
  test('Aadhaar with spaces, as a number, as Excel scientific notation, or already masked', () => {
    for (const v of ['2345 6789 0123', 234567890123, '2.34567890123E+11', 'XXXXXXXX0123']) {
      const r = legacyParse({ 'GST / Aadhaar': v });
      expect(r.site.aadhaar_last4, String(v)).toBe('0123');
      expect(everything(r), String(v)).not.toContain(AADHAAR);
    }
  });
  test('an Aadhaar vendor with no PAN is held back, and the message does not echo the number', () => {
    const r = legacyParse({ 'GST / Aadhaar': AADHAAR, 'PAN Number': '' });
    expect(r.problems.map(p => p.code)).toEqual(['no_identity']);
    expect(r.problems[0].severity).toBe('blocking');
    expect(everything(r)).not.toContain(AADHAAR);
  });
  test('a long number that is not an Aadhaar is described, not echoed', () => {
    const r = legacyParse({ 'GST / Aadhaar': '99887766554433', 'PAN Number': '' });
    expect(r.problems[0].message).toContain('14 digits');
    expect(r.problems[0].message).not.toContain('99887766554433');
  });
  test('a valid PAN lets a vendor with no GSTIN at all import', () => {
    const r = legacyParse({ 'GST / Aadhaar': '' });
    expect(r.problems).toEqual([]);
    expect(r.pan).toBe('AYEPP3943P');
    expect(r.site.gstin).toBeUndefined();
    expect(r.site.state).toBeUndefined();
  });
  test('PAN column disagreeing with the GSTIN is still a conflict', () => {
    expect(legacyParse({ 'PAN Number': 'ABCDE1234F' }).problems.map(p => p.code)).toContain('pan_mismatch');
  });
});

test.describe('legacy sheet: status, credit period, MSME, industry, dates', () => {
  test('status words are understood; blank and unknown become Pending, never Active; only unknown is flagged', () => {
    const cases: [string, string][] = [['Approved', 'active'], ['ONBOARDED', 'active'], ['Inactive', 'inactive'], ['Blacklisted', 'blocked'],
      ['Draft', 'pending'], ['In Process', 'pending']];
    for (const [v, want] of cases) { const r = legacyParse({ Status: v }); expect(r.site.status, v).toBe(want); expect(r.problems).toEqual([]); }
    const odd = legacyParse({ Status: 'weird thing' });
    expect(odd.site.status).toBe('pending');
    expect(odd.problems.map(p => p.code)).toEqual(['status']);
    const blank = legacyParse({ Status: '' });
    expect(blank.site.status).toBe('pending');
    expect(blank.problems).toEqual([]);                       // not noise on every row
    expect(blank.statusBlank).toBe(true);
    expect(checkFile([blank]).gaps.map(g => g.label)).toContain('No status given (set to Pending)');
  });
  test('credit period: days, months, words, and what cannot be understood', () => {
    expect(legacyParse({ 'Credit Period': '30' }).company.credit_period_days).toBe(30);
    expect(legacyParse({ 'Credit Period': 60 }).company.credit_period_days).toBe(60);
    expect(legacyParse({ 'Credit Period': '2 months' }).company.credit_period_days).toBe(60);
    const adv = legacyParse({ 'Credit Period': 'Advance' });
    expect(adv.company.credit_period_days).toBe(0); expect(adv.company.credit_period_note).toBe('Advance'); expect(adv.problems).toEqual([]);
    const odd = legacyParse({ 'Credit Period': '30-45 days' });
    expect(odd.company.credit_period_days).toBeUndefined(); expect(odd.company.credit_period_note).toBe('30-45 days');
    expect(odd.problems.map(p => p.code)).toEqual(['credit_period']);
    expect(legacyParse({ 'Credit Period': '500' }).company.credit_period_days).toBeUndefined();   // over 365: kept as a note
  });
  test('the MSME column may hold Yes/No, a Udyam number, or a category', () => {
    expect(legacyParse({ MSME: 'No' }).company.is_msme).toBe(false);
    const udyam = legacyParse({ MSME: 'UDYAM-RJ-02-0041178' });
    expect(udyam.company.is_msme).toBe(true); expect(udyam.company.udyam_number).toBe('UDYAM-RJ-02-0041178');
    expect(udyam.problems.map(p => p.code)).toEqual(['msme_no_udyam']);                 // category still missing
    const yes = legacyParse({ MSME: 'Yes' });
    expect(yes.problems.map(p => p.code)).toEqual(['msme_no_udyam']);
    expect(yes.problems[0].severity).toBe('fixable');
    expect(legacyParse({ MSME: 'Small' }).company.msme_category).toBe('small');
  });
  test('industry is worked out from Services; ambiguous or unknown stays unclassified', () => {
    const cases: [string, string | undefined][] = [
      ['PET bottle recycling', 'recycling'], ['E-waste and EPR compliance', 'recycling'],
      ['Corrugated boxes and pallets', 'packaging'], ['FTL and PTL logistics', 'transportation'],
      ['Recycling and packaging', undefined], ['Legal consulting', undefined], ['', undefined]];
    for (const [svc, want] of cases) {
      const r = legacyParse({ Services: svc });
      expect(r.site.industry, svc).toBe(want);
      if (!want) expect(r.problems.map(p => p.code), svc).toContain('no_industry');
    }
    expect(legacyParse({ Services: 'Recycling and packaging' }).problems[0].message).toContain('more than one');
  });
  test('created date: DD/MM/YYYY, an Excel serial, a Date; a future date is ignored', () => {
    expect(legacyParse({ 'Created Date': '15/03/2024' }).company.created_at).toBe('2024-03-15');
    expect(legacyParse({ 'Created Date': 45000 }).company.created_at).toBe('2023-03-15');
    expect(legacyParse({ 'Created Date': new Date('2023-01-09T00:00:00Z') }).company.created_at).toBe('2023-01-09');
    const fut = legacyParse({ 'Created Date': '01/01/2999' });
    expect(fut.company.created_at).toBeUndefined(); expect(fut.problems.map(p => p.code)).toEqual(['date']);
  });
  test('document columns keep real references and drop No / blank', () => {
    const r = legacyParse({ 'GST/Aadhaar Document': 'No', 'PAN Document': 'N/A', 'Agreement Document': '', 'Cancelled Cheque': '', 'MSME Document': 'https://x.example/u.pdf' });
    expect(r.site.legacy_documents).toEqual({ msme: 'https://x.example/u.pdf' });
    expect(r.company.cheque_on_file).toBeUndefined();
  });
});

test.describe('legacy sheet: duplicates and grouping', () => {
  test('the same vendor code twice, or already on record, is held', () => {
    const a = legacyParse({}, 2), b = legacyParse({ 'GST / Aadhaar': '24AYEPP3943P1ZB' }, 3);          // same V-001
    const c = checkFile([a, b], new Set(['L:V-777']));
    expect(c.byProblem.find(p => p.code === 'duplicate_in_file')!.rows).toEqual([3]);
    const d = checkFile([legacyParse({ 'Vendor Code': 'V-777' }, 2)], new Set(['L:V-777']));
    expect(d.byProblem.map(p => p.code)).toEqual(['already_in_system']);
  });
  test('two vendor codes sharing one GSTIN and no pincode are two sites, not duplicates', () => {
    const c = checkFile([legacyParse({ 'Vendor Code': 'V-1' }, 2), legacyParse({ 'Vendor Code': 'V-2' }, 3)]);
    expect(c.held).toBe(0);
    const plan = buildPlan(c.rows);
    expect(plan.companies).toHaveLength(1);
    expect(plan.companies[0].sites).toHaveLength(2);
  });
  test('two rows with no vendor code and the same GSTIN and no pincode are the same vendor', () => {
    const c = checkFile([legacyParse({ 'Vendor Code': '' }, 2), legacyParse({ 'Vendor Code': '' }, 3)]);
    expect(c.byProblem.map(p => p.code)).toEqual(['duplicate_in_file']);
  });
  test('vendors with no GSTIN and different codes under one PAN are one company, two sites', () => {
    const c = checkFile([legacyParse({ 'Vendor Code': 'V-1', 'GST / Aadhaar': '' }, 2), legacyParse({ 'Vendor Code': 'V-2', 'GST / Aadhaar': '234567890123' }, 3)]);
    const plan = buildPlan(c.rows);
    expect(plan.companies).toHaveLength(1);
    expect(plan.companies[0].sites).toHaveLength(2);
  });
});
