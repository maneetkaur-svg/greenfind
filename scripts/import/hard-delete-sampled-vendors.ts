/**
 * ONE-OFF: permanently removes test/sample vendor records created while
 * building and debugging the public sign-up form and the old-portal import
 * — not real vendors, never meant to be kept. Hard-deletes (not soft) the
 * company row, which cascades (on delete cascade, sql/01_schema.sql) to its
 * vendor_site, site_document, site_contact, site_service_category and
 * change_request rows. Storage objects are NOT covered by that cascade, so
 * this script deletes the underlying files from the vendor-documents bucket
 * first, while the site_document rows pointing at them still exist.
 *
 * Exact target list (confirmed against production before writing this):
 *   - VEN 202 "Sample Vendor", VEN 203 "Sample Vendor 10" (source=import)
 *   - VEN 234, VEN 235, VEN 236, VEN 248, VEN 249 (every source=public_form
 *     company on record, all still status=pending, all test submissions
 *     created while diagnosing the sign-up form's RLS bug this session)
 *
 *   npm run hard-delete:sampled -- --dry-run
 *   npm run hard-delete:sampled -- --allow-prod
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT, '.env.import');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'hard-delete-sampled-report.csv');
const BUCKET = 'vendor-documents';

const TARGET_COMPANY_CODES = ['VEN 202', 'VEN 203', 'VEN 234', 'VEN 235', 'VEN 236', 'VEN 248', 'VEN 249'];

type Args = { dryRun: boolean; allowProd: boolean };
function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, allowProd: false };
  for (const t of argv) {
    if (t === '--dry-run') a.dryRun = true;
    else if (t === '--allow-prod') a.allowProd = true;
  }
  return a;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

type ReportRow = { companyCode: string; legalName: string; item: string; status: string; detail: string };

function writeCsv(path: string, rows: ReportRow[]) {
  const header = ['Company Code', 'Legal Name', 'Item', 'Status', 'Detail'];
  const body = rows.map(r => [r.companyCode, r.legalName, r.item, r.status, r.detail]);
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

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const supabase = createImportAdminClient(env);
  const report: ReportRow[] = [];

  for (const companyCode of TARGET_COMPANY_CODES) {
    const { data: company, error: compErr } = await supabase
      .from('company').select('id, company_code, legal_name, pan, deleted_at')
      .eq('company_code', companyCode).maybeSingle();
    if (compErr) { report.push({ companyCode, legalName: '', item: 'company', status: 'FAILED', detail: compErr.message }); continue; }
    if (!company) { report.push({ companyCode, legalName: '', item: 'company', status: 'NOT_FOUND', detail: '' }); continue; }

    const { data: sites, error: siteErr } = await supabase
      .from('vendor_site').select('id, site_code').eq('company_id', company.id);
    if (siteErr) { report.push({ companyCode, legalName: company.legal_name, item: 'vendor_site lookup', status: 'FAILED', detail: siteErr.message }); continue; }

    let storagePaths: string[] = [];
    for (const site of sites ?? []) {
      const { data: docs, error: docErr } = await supabase
        .from('site_document').select('storage_path').eq('site_id', site.id);
      if (docErr) { report.push({ companyCode, legalName: company.legal_name, item: `${site.site_code} documents lookup`, status: 'FAILED', detail: docErr.message }); continue; }
      storagePaths.push(...(docs ?? []).map(d => d.storage_path));
    }

    if (args.dryRun) {
      report.push({ companyCode, legalName: company.legal_name, item: 'company + sites + documents', status: 'WOULD_DELETE', detail: `${(sites ?? []).length} site(s), ${storagePaths.length} storage file(s)` });
      continue;
    }

    if (storagePaths.length) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(storagePaths);
      report.push({ companyCode, legalName: company.legal_name, item: 'storage files', status: rmErr ? 'FAILED' : 'DELETED', detail: rmErr ? rmErr.message : storagePaths.join('; ') });
      if (rmErr) continue; // don't drop the DB rows if the files couldn't be removed
    }

    const { error: delErr } = await supabase.from('company').delete().eq('id', company.id);
    report.push({ companyCode, legalName: company.legal_name, item: 'company (cascades to sites/documents/contacts)', status: delErr ? 'FAILED' : 'DELETED', detail: delErr ? delErr.message : `${(sites ?? []).length} site(s) removed` });
  }

  writeCsv(OUTPUT_PATH, report);
  const byStatus: Record<string, number> = {};
  for (const r of report) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log('\nDone.');
  for (const [status, n] of Object.entries(byStatus)) console.log(`  ${String(n).padStart(4)}  ${status}`);
  console.log(`\nFull detail in ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
