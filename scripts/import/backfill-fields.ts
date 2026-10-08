/**
 * ONE-OFF: fills blank company/vendor_site fields from
 * scripts/import/input/finance-vendors.xlsx, matched by legacy_vendor_code —
 * the same matching key every other script here uses. Reuses the exact
 * parsing the legacy-sheet importer already has (lib/import/readFile,
 * mapping, validate) rather than re-deriving column meaning from scratch.
 *
 * Fills blanks ONLY. A field that already has a value on the database is
 * never touched, whatever the sheet says — this is a backfill, not a
 * re-import. Three fields are deliberately excluded even when blank,
 * because a more careful, dedicated script already owns them:
 *   - gstin     → npm run import:gstin (checks the derived PAN still
 *                 matches the company on record before writing)
 *   - industry  → npm run classify:industry (tries Services text, then
 *                 legal/trade name, and never guesses an ambiguous case)
 *   - pan       → never changed by anything; it is the company's key
 * legacy_documents is also skipped: it exists to remind staff what still
 * needs uploading, and the real files are already attached via the
 * document bulk import, so refreshing it now would be misleading, not
 * helpful. Contacts and serviceable states are only added when the site
 * currently has NONE at all — never merged into a partial list.
 *
 *   npm run backfill:fields -- --dry-run
 *   npm run backfill:fields -- --allow-prod
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';
import { readFile, splitSheet } from '../../lib/import/readFile';
import { matchHeaders } from '../../lib/import/mapping';
import { parseRow, type Mapping } from '../../lib/import/validate';

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(ROOT, 'scripts', 'import', 'input', 'finance-vendors.xlsx');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'backfill-report.csv');
const ENV_PATH = path.join(ROOT, '.env.import');

const COMPANY_EXCLUDE = new Set(['pan', 'is_msme']); // is_msme handled separately — see the upgrade step below
const SITE_EXCLUDE = new Set(['gstin', 'industry', 'legacy_vendor_code', 'legacy_documents', 'aadhaar_last4']);

type Args = { dryRun: boolean; allowProd: boolean; input: string };

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, allowProd: false, input: DEFAULT_INPUT };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run') a.dryRun = true;
    else if (t === '--allow-prod') a.allowProd = true;
    else if (t === '--input') a.input = path.resolve(argv[++i]);
  }
  return a;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

type ReportRow = { vendorCode: string; excelRow: number; table: string; field: string; newValue: string; status: string };

function writeCsv(path: string, rows: ReportRow[]) {
  const header = ['Vendor Code', 'Excel Row', 'Table', 'Field', 'New Value', 'Status'];
  const body = rows.map(r => [r.vendorCode, String(r.excelRow), r.table, r.field, r.newValue, r.status]);
  const bom = String.fromCharCode(0xfeff);
  const csv = bom + [header, ...body].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
  fs.writeFileSync(path, csv);
}

/** Only genuinely blank — not 0, not false. */
const isBlank = (v: unknown) => v === null || v === undefined || v === '';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let env;
  try {
    env = loadImportEnv(ENV_PATH);
    assertNotProd(env, args.allowProd);
  } catch (e) {
    if (e instanceof ImportEnvError) fail(e.message);
    throw e;
  }

  if (!fs.existsSync(args.input)) fail(`Input file not found: ${args.input}`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const supabase = createImportAdminClient(env);

  const buf = fs.readFileSync(args.input);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const book = readFile(path.basename(args.input), ab);
  const sheet = book.sheets[book.defaultSheet];
  const { headers, data } = splitSheet(sheet.rows);

  const matches = matchHeaders(headers, data[0]?.cells ?? []);
  const mapping: Mapping = {};
  matches.forEach(m => { if (m.key) mapping[m.key] = m.index; });
  if (!('legacy_code' in mapping)) fail('No Vendor Code column was recognised in the sheet.');

  console.log(`Read ${data.length} data row(s) from "${sheet.name}".`);

  const byCode = new Map<string, number[]>();
  for (const d of data) {
    const r = parseRow(d.cells, mapping, d.rowNumber);
    if (!r.legacyCode) continue;
    const list = byCode.get(r.legacyCode) ?? [];
    list.push(d.rowNumber);
    byCode.set(r.legacyCode, list);
  }

  const report: ReportRow[] = [];
  let matched = 0, noMatch = 0, duplicateInFile = 0, fieldsFilled = 0, contactsAdded = 0, geographyAdded = 0;

  for (const d of data) {
    const r = parseRow(d.cells, mapping, d.rowNumber);
    const code = r.legacyCode;
    if (!code) continue;

    if ((byCode.get(code) ?? []).length > 1) {
      report.push({ vendorCode: code, excelRow: d.rowNumber, table: '', field: '', newValue: '', status: 'DUPLICATE_VENDOR_CODE_IN_FILE' });
      duplicateInFile++;
      continue;
    }

    const { data: sites, error } = await supabase
      .from('vendor_site').select('*').eq('legacy_vendor_code', code).is('deleted_at', null);
    if (error) { report.push({ vendorCode: code, excelRow: d.rowNumber, table: '', field: '', newValue: '', status: `FAILED: ${error.message}` }); continue; }
    if (!sites || sites.length !== 1) {
      report.push({ vendorCode: code, excelRow: d.rowNumber, table: '', field: '', newValue: '', status: sites?.length ? 'AMBIGUOUS_MATCH' : 'NO_MATCH' });
      noMatch++;
      continue;
    }
    const site = sites[0];
    const { data: company, error: compErr } = await supabase.from('company').select('*').eq('id', site.company_id).single();
    if (compErr || !company) {
      report.push({ vendorCode: code, excelRow: d.rowNumber, table: '', field: '', newValue: '', status: `FAILED: company not found` });
      continue;
    }
    matched++;

    // --- MSME: upgrade false -> true on real evidence, never the other way.
    // is_msme defaults to false (not null), so the generic "fill blanks
    // only" loop below would never touch it — this is a deliberate
    // exception, not a gap in that rule. Evidence: the sheet's MSME column
    // said Yes, or a real Udyam/MSME certificate is already on file (the
    // document bulk import's "udyam" doc_type), not just a legacy sheet
    // reference string.
    if (company.is_msme !== true) {
      const excelSaysYes = r.company.is_msme === true;
      let hasUdyamDoc = false;
      if (!excelSaysYes) {
        const { count } = await supabase.from('site_document').select('id', { count: 'exact', head: true })
          .eq('site_id', site.id).eq('doc_type', 'udyam').is('superseded_at', null);
        hasUdyamDoc = !!count;
      }
      if (excelSaysYes || hasUdyamDoc) {
        report.push({
          vendorCode: code, excelRow: d.rowNumber, table: 'company', field: 'is_msme', newValue: 'true',
          status: args.dryRun ? 'WOULD_FILL' : 'FILLED',
        });
        fieldsFilled++;
        if (!args.dryRun) {
          const { error: msmeErr } = await supabase.from('company').update({ is_msme: true }).eq('id', company.id);
          if (msmeErr) report.push({ vendorCode: code, excelRow: d.rowNumber, table: 'company', field: 'is_msme', newValue: '', status: `FAILED: ${msmeErr.message}` });
        }
      }
    }

    const companyPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.company)) {
      if (COMPANY_EXCLUDE.has(k) || isBlank(v) || !isBlank(company[k])) continue;
      companyPatch[k] = v;
    }
    const sitePatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.site)) {
      if (SITE_EXCLUDE.has(k) || isBlank(v) || !isBlank(site[k])) continue;
      sitePatch[k] = v;
    }

    for (const [k, v] of Object.entries(companyPatch))
      report.push({ vendorCode: code, excelRow: d.rowNumber, table: 'company', field: k, newValue: String(v), status: args.dryRun ? 'WOULD_FILL' : 'FILLED' });
    for (const [k, v] of Object.entries(sitePatch))
      report.push({ vendorCode: code, excelRow: d.rowNumber, table: 'vendor_site', field: k, newValue: String(v), status: args.dryRun ? 'WOULD_FILL' : 'FILLED' });
    fieldsFilled += Object.keys(companyPatch).length + Object.keys(sitePatch).length;

    if (!args.dryRun) {
      if (Object.keys(companyPatch).length) {
        const { error: upErr } = await supabase.from('company').update(companyPatch).eq('id', company.id);
        if (upErr) report.push({ vendorCode: code, excelRow: d.rowNumber, table: 'company', field: '(update)', newValue: '', status: `FAILED: ${upErr.message}` });
      }
      if (Object.keys(sitePatch).length) {
        const { error: upErr } = await supabase.from('vendor_site').update(sitePatch).eq('id', site.id);
        if (upErr) report.push({ vendorCode: code, excelRow: d.rowNumber, table: 'vendor_site', field: '(update)', newValue: '', status: `FAILED: ${upErr.message}` });
      }
    }

    // --- contacts: only when the site currently has none at all ---
    if (r.contacts.length) {
      const { count } = await supabase.from('site_contact').select('id', { count: 'exact', head: true }).eq('site_id', site.id);
      if (!count) {
        report.push({ vendorCode: code, excelRow: d.rowNumber, table: 'site_contact', field: 'contacts', newValue: `${r.contacts.length} contact(s)`, status: args.dryRun ? 'WOULD_FILL' : 'FILLED' });
        contactsAdded++;
        if (!args.dryRun) {
          const { error: cErr } = await supabase.from('site_contact').insert(
            r.contacts.map(c => ({ site_id: site.id, rank: c.rank, name: c.name, designation: c.designation || null, mobile: c.mobile || null, email: c.email || null })));
          if (cErr) report.push({ vendorCode: code, excelRow: d.rowNumber, table: 'site_contact', field: '(insert)', newValue: '', status: `FAILED: ${cErr.message}` });
        }
      }
    }

    // --- serviceable states: only when the site currently has none at all ---
    if (r.geography.length) {
      const { count } = await supabase.from('site_geography').select('site_id', { count: 'exact', head: true }).eq('site_id', site.id);
      if (!count) {
        report.push({ vendorCode: code, excelRow: d.rowNumber, table: 'site_geography', field: 'geography', newValue: r.geography.join('; '), status: args.dryRun ? 'WOULD_FILL' : 'FILLED' });
        geographyAdded++;
        if (!args.dryRun) {
          const { error: gErr } = await supabase.from('site_geography').insert(r.geography.map(state => ({ site_id: site.id, state })));
          if (gErr) report.push({ vendorCode: code, excelRow: d.rowNumber, table: 'site_geography', field: '(insert)', newValue: '', status: `FAILED: ${gErr.message}` });
        }
      }
    }
  }

  writeCsv(OUTPUT_PATH, report);
  console.log('\nDone.');
  console.log(`  ${matched}  matched vendor_site rows checked`);
  console.log(`  ${fieldsFilled}  field(s) ${args.dryRun ? 'would be' : ''} filled`);
  console.log(`  ${contactsAdded}  site(s) ${args.dryRun ? 'would get' : 'got'} contacts added`);
  console.log(`  ${geographyAdded}  site(s) ${args.dryRun ? 'would get' : 'got'} serviceable states added`);
  console.log(`  ${noMatch}  Vendor Code(s) with no (or ambiguous) match`);
  console.log(`  ${duplicateInFile}  Vendor Code(s) duplicated within the sheet — skipped`);
  console.log(`\nFull detail in ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
