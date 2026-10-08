/**
 * ONE-OFF: sets industry = 'warehouse' for every vendor_site whose Services
 * text mentions "Warehouse" — including sites already classified as
 * transportation (checked against production: 11 sites match, 3 of them
 * already 'transportation'; warehouse is the more specific, correct label
 * for those once it exists as its own industry). Everything else is left
 * alone — it stays whatever it already was, including unclassified.
 *
 * Requires sql/13_add_warehouse_industry.sql to have been run first (the
 * 'warehouse' enum value must already exist and be committed).
 *
 *   npm run reclassify:warehouse -- --dry-run
 *   npm run reclassify:warehouse -- --allow-prod
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT, '.env.import');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'reclassify-warehouse-report.csv');

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

type ReportRow = { vendorCode: string; legalName: string; servicesText: string; previousIndustry: string; status: string };

function writeCsv(path: string, rows: ReportRow[]) {
  const header = ['Vendor Code', 'Legal Name', 'Services', 'Previous Industry', 'Status'];
  const body = rows.map(r => [r.vendorCode, r.legalName, r.servicesText, r.previousIndustry, r.status]);
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

  const { data: sites, error } = await supabase
    .from('vendor_site')
    .select('id, legacy_vendor_code, services_text, company_id, industry')
    .ilike('services_text', '%warehouse%')
    .is('deleted_at', null);
  if (error) fail(`Could not read vendor_site: ${error.message}`);

  const report: ReportRow[] = [];
  for (const site of sites ?? []) {
    const { data: company } = await supabase.from('company').select('legal_name').eq('id', site.company_id).single();
    const legalName = company?.legal_name ?? '';
    const previousIndustry = site.industry ?? 'unclassified';

    if (args.dryRun) {
      report.push({ vendorCode: site.legacy_vendor_code ?? '', legalName, servicesText: site.services_text ?? '', previousIndustry, status: 'WOULD_APPLY' });
      continue;
    }
    const { error: updErr } = await supabase.from('vendor_site').update({ industry: 'warehouse' }).eq('id', site.id);
    report.push({ vendorCode: site.legacy_vendor_code ?? '', legalName, servicesText: site.services_text ?? '', previousIndustry, status: updErr ? `FAILED: ${updErr.message}` : 'APPLIED' });
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
