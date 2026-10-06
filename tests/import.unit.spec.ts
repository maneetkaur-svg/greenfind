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

  test('bad GSTIN is blocking', () => {
    const r = parseRow(good({ 'GST No': '08AYEPP3943' }), mapping, 2);
    expect(r.problems.map(p => p.code)).toContain('gstin_format');
    expect(r.problems.find(p => p.code === 'gstin_format')!.severity).toBe('blocking');
  });

  test('bad optional values are dropped and flagged, row still importable', () => {
    const r = parseRow(good({ IFSC: 'HDFC123', 'Mobile No': '12345', Email: 'nope' }), mapping, 2);
    expect(r.problems.map(p => p.code).sort()).toEqual(['email', 'ifsc', 'mobile']);
    expect(r.problems.every(p => p.severity === 'fixable')).toBe(true);
    expect(r.company.ifsc).toBeUndefined();
    expect(r.contacts[0].mobile).toBe('');
  });

  test('MSME yes with no Udyam is flagged', () => {
    const r = parseRow(good({ 'MSME?': 'Y' }), mapping, 2);
    expect(r.problems.map(p => p.code)).toContain('msme_no_udyam');
  });

  test('no industry is flagged', () => {
    expect(parseRow(good({ Industry: '' }), mapping, 2).problems.map(p => p.code)).toContain('no_industry');
  });

  test('PAN column that disagrees with the GSTIN is flagged', () => {
    const h = [...HEAD, 'PAN']; const m = mapFor(h);
    const r = parseRow([...good(), 'ABCDE1234F'], m, 2);
    expect(r.problems.map(p => p.code)).toContain('pan_mismatch');
  });

  test('duplicate in file and already in system', () => {
    const rows = [parseRow(good(), mapping, 2), parseRow(good(), mapping, 3), parseRow(good({ 'GST No': '27ABCDE1234F1Z5' }), mapping, 4)];
    const c = checkFile(rows, new Set(['27ABCDE1234F1Z5|301707']));
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
