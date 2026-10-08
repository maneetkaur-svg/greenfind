/**
 * ONE-OFF: fills in vendor_site.gstin wherever it is currently blank, by
 * matching legacy_vendor_code between the database and
 * scripts/import/input/finance-vendors.xlsx's "GST / Aadhaar" column.
 *
 * Never overwrites a GSTIN that is already on record — only fills blanks.
 * An Aadhaar value in that column is left alone (GSTIN only, same rule as
 * the rest of this import). A GSTIN whose derived PAN would not match the
 * company already on record is left alone and reported, never forced.
 *
 *   npm run import:gstin -- --dry-run
 *   npm run import:gstin -- --allow-prod
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';
import { readWorkbook } from './lib/excel';
import { matchColumns, findMissingRequiredColumns } from './lib/columns';
import { parseTaxId } from '../../lib/import/normalise';
import { RX } from '../../lib/constants';

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(ROOT, 'scripts', 'import', 'input', 'finance-vendors.xlsx');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'gstin-update-report.csv');
const ENV_PATH = path.join(ROOT, '.env.import');

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

type ReportRow = { vendorCode: string; excelRow: number; siteId: string; newGstin: string; status: string; detail: string };

function writeCsv(path: string, rows: ReportRow[]) {
  const header = ['Vendor Code', 'Excel Row', 'Site ID', 'New GSTIN', 'Status', 'Detail'];
  const body = rows.map(r => [r.vendorCode, String(r.excelRow), r.siteId, r.newGstin, r.status, r.detail]);
  const bom = String.fromCharCode(0xfeff);
  const csv = bom + [header, ...body].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
  fs.writeFileSync(path, csv);
}

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

  const sheet = await readWorkbook(args.input);
  const columnMatches = matchColumns(sheet.headers);
  const missing = findMissingRequiredColumns(columnMatches).filter(k => k === 'vendor_code');
  if (missing.length) fail(`The sheet is missing required column(s): ${missing.join(', ')}.`);
  const gstinIdx = columnMatches.find(m => m.key === 'gstin')?.index;
  const codeIdx = columnMatches.find(m => m.key === 'vendor_code')!.index;
  if (gstinIdx === undefined) fail('No GST / Aadhaar column was recognised in the sheet.');

  // --- build Vendor Code -> valid GSTIN, straight from the sheet, Aadhaar/invalid/blank excluded ---
  const gstinByCode = new Map<string, { gstin: string; excelRow: number }>();
  for (const row of sheet.rows) {
    const code = (row.cells[codeIdx] ?? '').trim();
    if (!code) continue;
    const parsed = parseTaxId(row.cells[gstinIdx], RX.gstin);
    if (parsed.kind === 'gstin') {
      if (gstinByCode.has(code)) {
        console.warn(`Vendor Code "${code}" appears more than once with a GSTIN in the sheet — skipping both, ambiguous.`);
        gstinByCode.delete(code);
        continue;
      }
      gstinByCode.set(code, { gstin: parsed.gstin, excelRow: row.rowNumber });
    }
  }
  console.log(`Sheet has a usable GSTIN for ${gstinByCode.size} Vendor Code(s).`);

  // --- vendor_site rows currently missing a GSTIN ---
  const { data: blankSites, error } = await supabase
    .from('vendor_site')
    .select('id, legacy_vendor_code, company_id')
    .is('gstin', null)
    .is('deleted_at', null);
  if (error) fail(`Could not read vendor_site: ${error.message}`);

  console.log(`${blankSites?.length ?? 0} vendor_site row(s) currently have a blank GSTIN.`);

  const report: ReportRow[] = [];

  for (const site of blankSites ?? []) {
    const code = site.legacy_vendor_code as string | null;
    if (!code) {
      report.push({ vendorCode: '', excelRow: 0, siteId: site.id, newGstin: '', status: 'SKIPPED_NO_CODE', detail: 'This site has no legacy_vendor_code to match on.' });
      continue;
    }
    const found = gstinByCode.get(code);
    if (!found) {
      report.push({ vendorCode: code, excelRow: 0, siteId: site.id, newGstin: '', status: 'NOT_IN_SHEET', detail: 'No usable GSTIN for this Vendor Code in the sheet (blank, Aadhaar, or not found).' });
      continue;
    }

    const derivedPan = found.gstin.slice(2, 12);
    const { data: company, error: compErr } = await supabase
      .from('company').select('pan').eq('id', site.company_id).single();
    if (compErr || !company) {
      report.push({ vendorCode: code, excelRow: found.excelRow, siteId: site.id, newGstin: found.gstin, status: 'FAILED', detail: `Could not read the company on record: ${compErr?.message ?? 'not found'}.` });
      continue;
    }
    if (company.pan !== derivedPan) {
      report.push({
        vendorCode: code, excelRow: found.excelRow, siteId: site.id, newGstin: found.gstin, status: 'CONFLICT',
        detail: `GSTIN ${found.gstin} implies PAN ${derivedPan}, which does not match the company already on record (${company.pan}). Not applied.`,
      });
      continue;
    }

    if (args.dryRun) {
      report.push({ vendorCode: code, excelRow: found.excelRow, siteId: site.id, newGstin: found.gstin, status: 'WOULD_UPDATE', detail: '' });
      continue;
    }

    const { error: updErr } = await supabase.from('vendor_site').update({ gstin: found.gstin }).eq('id', site.id);
    if (updErr) {
      report.push({ vendorCode: code, excelRow: found.excelRow, siteId: site.id, newGstin: found.gstin, status: 'FAILED', detail: updErr.message });
    } else {
      report.push({ vendorCode: code, excelRow: found.excelRow, siteId: site.id, newGstin: found.gstin, status: 'UPDATED', detail: '' });
    }
  }

  if (!args.dryRun) writeCsv(OUTPUT_PATH, report);

  const byStatus: Record<string, number> = {};
  for (const r of report) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log('\nDone.');
  for (const [status, n] of Object.entries(byStatus).sort()) console.log(`  ${String(n).padStart(5)}  ${status}`);
  if (!args.dryRun) console.log(`\nFull detail in ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
