/**
 * PREFLIGHT — checks a vendor spreadsheet WITHOUT touching any database.
 *
 *   npm run preflight -- "C:\path\to\vendors.xlsx"
 *   npm run preflight -- "C:\path\to\vendors.xlsx" --sheet "Sheet2"
 *
 * It runs the same rules as the import screen, then prints a profile of the data
 * (which statuses, MSME values, credit periods, services and document formats it
 * actually contains) so decisions can be made from facts. It also writes
 * <file>-preflight.csv listing every problem by row.
 *
 * Nothing is saved anywhere. GST / Aadhaar values are never printed: only counts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readFile, splitSheet } from '../lib/import/readFile';
import { matchHeaders } from '../lib/import/mapping';
import { parseRow, checkFile, problemNote, type Mapping } from '../lib/import/validate';
import { buildPlan } from '../lib/import/plan';
import { parseTaxId, normStatus, normMsmeValue, normCredit, clean } from '../lib/import/normalise';
import { RX } from '../lib/constants';
import { FIELD_BY_KEY } from '../lib/import/fields';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const sheetArg = args.includes('--sheet') ? args[args.indexOf('--sheet') + 1] : undefined;
if (!file) { console.error('Usage: npm run preflight -- "path\\to\\file.xlsx" [--sheet "Name"]'); process.exit(2); }
if (!fs.existsSync(file)) { console.error(`File not found: ${file}`); process.exit(2); }

const buf = fs.readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const book = readFile(path.basename(file), ab);
let idx = book.defaultSheet;
if (sheetArg) { idx = book.sheets.findIndex(s => s.name.toLowerCase() === sheetArg.toLowerCase()); if (idx < 0) { console.error(`No sheet called "${sheetArg}". Sheets: ${book.sheets.map(s => s.name).join(', ')}`); process.exit(2); } }
const sheet = book.sheets[idx];
const { headers, data } = splitSheet(sheet.rows);

const line = (c = '─') => console.log(c.repeat(78));
const h1 = (t: string) => { console.log(); line('═'); console.log(t); line('═'); };
const top = (vals: string[], n = 12) => {
  const m = new Map<string, number>(); vals.forEach(v => m.set(v, (m.get(v) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
};
const show = (vals: string[], n = 12) => { for (const [v, c] of top(vals, n)) console.log(`   ${String(c).padStart(5)}  ${v === '' ? '(blank)' : v}`); const d = new Set(vals).size; if (d > n) console.log(`         … ${d - n} more distinct values`); };

h1(`PREFLIGHT  ${path.basename(file)}  ·  sheet "${sheet.name}"  ·  ${data.length} rows`);
if (book.sheets.length > 1) console.log(`Other sheets in this file: ${book.sheets.filter((_, i) => i !== idx).map(s => s.name).join(', ')}  (use --sheet to check one)`);

/* ---- 1. columns ---- */
h1('1. COLUMNS — what each heading was understood as');
const matches = matchHeaders(headers, data[0]?.cells ?? []);
const mapping: Mapping = {}; matches.forEach(m => { if (m.key) mapping[m.key] = m.index; });
for (const m of matches) console.log(`   ${m.key ? '✓' : '✗'}  ${m.header.padEnd(30)} ${m.key ? `→ ${FIELD_BY_KEY[m.key].header}  (matched on "${m.via}")` : '→ NOT RECOGNISED (will be ignored)'}`);
const missing: string[] = [];
if (!('legal_name' in mapping)) missing.push('a vendor name column');
if (!('gstin' in mapping) && !('pan' in mapping)) missing.push('a GSTIN or PAN column');
if (missing.length) { console.log(`\n   ✗✗ CANNOT IMPORT: no ${missing.join(' and no ')} was found.`); process.exit(1); }

/* ---- 2. what the data actually contains ---- */
const col = (k: string) => (k in mapping ? data.map(d => clean(d.cells[mapping[k]])) : null);
h1('2. WHAT THE DATA CONTAINS');

if ('gstin' in mapping) {
  const kinds = { gstin: 0, aadhaar: 0, invalid: 0, blank: 0 };
  for (const d of data) kinds[parseTaxId(d.cells[mapping.gstin], RX.gstin).kind]++;
  console.log(`\n GST / Aadhaar column   (values are never printed)`);
  console.log(`   ${String(kinds.gstin).padStart(5)}  valid GSTIN\n   ${String(kinds.aadhaar).padStart(5)}  Aadhaar number  → only the last four digits would be kept\n   ${String(kinds.invalid).padStart(5)}  not a GSTIN or Aadhaar\n   ${String(kinds.blank).padStart(5)}  blank`);
}
if ('pan' in mapping) {
  const v = col('pan')!; console.log(`\n PAN column\n   ${String(v.filter(x => RX.pan.test(x.toUpperCase().replace(/\s/g, ''))).length).padStart(5)}  valid\n   ${String(v.filter(x => !x).length).padStart(5)}  blank\n   ${String(v.filter(x => x && !RX.pan.test(x.toUpperCase().replace(/\s/g, ''))).length).padStart(5)}  malformed`);
}
if ('legacy_code' in mapping) {
  const v = col('legacy_code')!; const nonblank = v.filter(Boolean); const dup = nonblank.length - new Set(nonblank.map(x => x.toUpperCase())).size;
  console.log(`\n Vendor code\n   ${String(nonblank.length).padStart(5)}  filled     ${String(v.length - nonblank.length).padStart(5)}  blank     ${String(dup).padStart(5)}  repeated`);
}
if ('status' in mapping) {
  const v = col('status')!; console.log(`\n Status — distinct values (and what each becomes)`);
  for (const [val, c] of top(v, 15)) console.log(`   ${String(c).padStart(5)}  ${(val || '(blank)').padEnd(24)} → ${val ? (normStatus(val) ?? 'NOT RECOGNISED → pending') : 'pending'}`);
}
if ('is_msme' in mapping) {
  const v = col('is_msme')!; console.log(`\n MSME — distinct values`);
  for (const [val, c] of top(v, 12)) { const m = normMsmeValue(val); console.log(`   ${String(c).padStart(5)}  ${(val || '(blank)').padEnd(24)} → ${m.is_msme === null ? (val ? 'NOT UNDERSTOOD' : '—') : m.is_msme ? (m.udyam ? 'MSME, Udyam number found' : 'MSME') : 'not MSME'}`); }
}
if ('credit_period' in mapping) {
  const v = col('credit_period')!; console.log(`\n Credit period — distinct values`);
  for (const [val, c] of top(v, 12)) { const r = normCredit(val); console.log(`   ${String(c).padStart(5)}  ${(val || '(blank)').padEnd(24)} → ${r ? (r.days !== null ? `${r.days} days` : 'kept as a note only') : '—'}`); }
}
if ('services_text' in mapping) { console.log(`\n Services — most common values (${new Set(col('services_text')).size} distinct)`); show(col('services_text')!, 12); }
if ('projects_text' in mapping) { const v = col('projects_text')!; console.log(`\n Projects — ${new Set(v.filter(Boolean)).size} distinct values, ${v.filter(x => !x).length} blank. Most common:`); show(v, 6); }
if ('created_date' in mapping) {
  const parsed = data.map(d => { const r = parseRow(d.cells, mapping, d.rowNumber); return r.company.created_at as string | undefined; });
  const ok = parsed.filter((x): x is string => !!x).sort();
  console.log(`\n Created date\n   ${String(ok.length).padStart(5)}  usable${ok.length ? `   (earliest ${ok[0]}, latest ${ok[ok.length - 1]})` : ''}\n   ${String(parsed.length - ok.length).padStart(5)}  blank, unreadable or in the future`);
}
for (const k of ['doc_gst', 'doc_pan', 'doc_agreement', 'doc_cheque', 'doc_msme']) if (k in mapping) {
  const v = col(k)!; const real = v.filter(x => x && !/^(no|n|na|n\/a|nil|none|-+|false|0|not available|not received|pending|missing)$/i.test(x));
  console.log(`\n ${FIELD_BY_KEY[k].header}\n   ${String(real.filter(x => /^https?:\/\//i.test(x)).length).padStart(5)}  web links   ${String(real.filter(x => !/^https?:\/\//i.test(x) && /\.[a-z0-9]{2,4}$/i.test(x)).length).padStart(5)}  file names   ${String(real.filter(x => !/^https?:\/\//i.test(x) && !/\.[a-z0-9]{2,4}$/i.test(x)).length).padStart(5)}  other text (e.g. Yes)   ${String(v.length - real.length).padStart(5)}  empty or "No"`);
  if (real.length) console.log(`   e.g. ${top(real, 2).map(([x]) => `"${x.slice(0, 50)}"`).join(', ')}`);
}

/* ---- 3. the check, exactly as the import screen runs it ---- */
h1('3. THE CHECK  (same rules as the import screen)');
const rows = data.map(d => parseRow(d.cells, mapping, d.rowNumber));
const check = checkFile(rows);
const plan = buildPlan(check.rows);
console.log(`   Rows in file .............. ${rows.length}`);
console.log(`   Clean ..................... ${check.clean}`);
console.log(`   Will import ............... ${check.importable}   (${check.importable - check.clean} with something left blank)`);
console.log(`   Held back or skipped ...... ${check.held}`);
console.log(`   New companies ............. ${plan.companies.length}   (rows sharing a PAN become one company with several sites)`);
console.log(`   Companies with 2+ sites ... ${plan.companies.filter(c => c.sites.length > 1).length}`);
console.log(`   Industry worked out ....... ${check.industryDerived} rows, from Services`);
const st = top(check.rows.filter(r => !r.problems.some(p => p.severity === 'blocking')).map(r => String(r.site.status ?? '(not given)')), 6);
if (st.length) console.log(`   Statuses that will import . ${st.map(([s, c]) => `${s} ${c}`).join(' · ')}`);

if (check.gaps.length) { console.log('\n   Will be blank after import (expected when the file does not carry it):'); for (const g of check.gaps) console.log(`     ${String(g.rows).padStart(5)} of ${check.importable}  ${g.label}`); }
if (check.byProblem.length) {
  console.log('\n   Problems:');
  for (const p of check.byProblem) {
    console.log(`\n   [${p.severity === 'blocking' ? 'HELD BACK' : 'FIXABLE '}] ${p.title}  —  ${p.rows.length} row${p.rows.length === 1 ? '' : 's'}`);
    console.log(`      ${problemNote(p.code, p.severity)}`);
    console.log(`      Rows: ${p.rows.slice(0, 15).join(', ')}${p.rows.length > 15 ? ` … +${p.rows.length - 15} more` : ''}`);
    const ex = check.rows.find(r => r.problems.some(x => x.code === p.code))!; console.log(`      e.g. row ${ex.rowNumber}: ${ex.problems.find(x => x.code === p.code)!.message}`);
  }
}

/* ---- 4. report ---- */
const csv = [['Row', 'Vendor code', 'Vendor', 'Severity', 'Problem', 'Outcome']];
for (const r of check.rows) for (const p of r.problems)
  csv.push([String(r.rowNumber), r.legacyCode ?? '', String(r.company.legal_name ?? ''), p.severity, p.message,
    p.severity === 'blocking' ? (p.code.startsWith('duplicate') || p.code === 'already_in_system' ? 'Skipped' : 'Held back — not imported') : 'Imported, value left blank']);
const out = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}-preflight.csv`);
fs.writeFileSync(out, '\uFEFF' + csv.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n'));
h1('RESULT');
const verdict = check.held === 0 && check.byProblem.length === 0 ? 'READY — nothing to fix.'
  : check.importable === 0 ? 'NOT READY — nothing in this file can be imported yet.'
  : `REVIEW — ${check.importable} of ${rows.length} rows would import; ${check.held} need attention first.`;
console.log(`   ${verdict}`);
console.log(`   Problem list written to: ${out}`);
console.log('   Nothing was saved to any database.');
process.exit(check.importable === 0 ? 1 : 0);
