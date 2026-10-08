/**
 * ONE-OFF: runs GST entity-type verification (same logic the "Add vendor"
 * flow now does automatically for new vendors — lib/gstVerify.ts) against
 * every EXISTING company that has a GSTIN on file and no entity type set
 * yet. Needs SUREPASS_API_TOKEN in .env.import (see scripts/import/README.md
 * and the chat — this will fail closed with a clear message per row until
 * that is set, never silently).
 *
 * Only fills company.entity when it is currently blank — never overwrites
 * an entity someone already set or already verified.
 *
 *   npm run verify:gst-bulk -- --dry-run
 *   npm run verify:gst-bulk -- --allow-prod
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';
import { verifyEntityFromGstin } from '../../lib/gstVerify';
import { runWithConcurrency } from './lib/pool';

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT, '.env.import');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'gst-verify-report.csv');
const CONCURRENCY = 3; // a paid, rate-limited third-party API — gentle by default

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

type ReportRow = { companyCode: string; legalName: string; gstin: string; status: string; detail: string };

function writeCsv(path: string, rows: ReportRow[]) {
  const header = ['Company Code', 'Legal Name', 'A GSTIN (one of this company\'s sites)', 'Status', 'Detail'];
  const body = rows.map(r => [r.companyCode, r.legalName, r.gstin, r.status, r.detail]);
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

  const { data: companies, error } = await supabase
    .from('company')
    .select('id, company_code, legal_name, entity')
    .is('entity', null)
    .is('deleted_at', null);
  if (error) fail(`Could not read company: ${error.message}`);

  // One GSTIN per company is enough to verify the company's own structure —
  // take the first non-deleted site that has one.
  const todo: { id: string; companyCode: string; legalName: string; gstin: string }[] = [];
  for (const co of companies ?? []) {
    const { data: site } = await supabase
      .from('vendor_site').select('gstin').eq('company_id', co.id).is('deleted_at', null)
      .not('gstin', 'is', null).limit(1).maybeSingle();
    if (site?.gstin) todo.push({ id: co.id, companyCode: co.company_code, legalName: co.legal_name, gstin: site.gstin });
  }

  console.log(`${companies?.length ?? 0} compan(y/ies) with no entity type on file, ${todo.length} of them have a GSTIN to verify against.`);

  const report = await runWithConcurrency(todo, CONCURRENCY, async (co): Promise<ReportRow> => {
    if (args.dryRun) return { companyCode: co.companyCode, legalName: co.legalName, gstin: co.gstin, status: 'WOULD_VERIFY', detail: '' };
    const result = await verifyEntityFromGstin(supabase, co.id, co.gstin);
    return result.ok
      ? { companyCode: co.companyCode, legalName: co.legalName, gstin: co.gstin, status: 'VERIFIED', detail: `${result.entity} (${result.ctb})` }
      : { companyCode: co.companyCode, legalName: co.legalName, gstin: co.gstin, status: 'FAILED', detail: result.reason + (result.ctb ? ` [ctb: ${result.ctb}]` : '') };
  });

  writeCsv(OUTPUT_PATH, report);
  const byStatus: Record<string, number> = {};
  for (const r of report) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log('\nDone.');
  for (const [status, n] of Object.entries(byStatus).sort()) console.log(`  ${String(n).padStart(4)}  ${status}`);
  console.log(`\nFull detail in ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
