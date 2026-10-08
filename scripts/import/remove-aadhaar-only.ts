/**
 * ONE-OFF: soft-deletes every vendor_site that has an Aadhaar number on file
 * but no GSTIN — these cannot legally be onboarded (checked against
 * production: 11 sites match). Writes a CSV of exactly what was removed so
 * it can be shown to supervisors as the record of why. A company left with
 * no other active site is soft-deleted too, same as cleanup-vendors.ts.
 *
 *   npm run remove:aadhaar-only -- --dry-run
 *   npm run remove:aadhaar-only -- --allow-prod
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT, '.env.import');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'removed-aadhaar-only-vendors.csv');

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

type ReportRow = { vendorCode: string; legalName: string; aadhaarLast4: string; city: string; state: string; status: string };

function writeCsv(path: string, rows: ReportRow[]) {
  const header = ['Vendor Code', 'Legal Name', 'Aadhaar (last 4)', 'City', 'State', 'Status'];
  const body = rows.map(r => [r.vendorCode, r.legalName, r.aadhaarLast4, r.city, r.state, r.status]);
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
    .select('id, legacy_vendor_code, city, state, company_id, aadhaar_last4')
    .is('gstin', null).not('aadhaar_last4', 'is', null).is('deleted_at', null);
  if (error) fail(`Could not read vendor_site: ${error.message}`);

  const report: ReportRow[] = [];
  const companyIds = new Set<string>();

  for (const site of sites ?? []) {
    const { data: company } = await supabase.from('company').select('legal_name').eq('id', site.company_id).single();
    const legalName = company?.legal_name ?? '';

    if (args.dryRun) {
      report.push({ vendorCode: site.legacy_vendor_code ?? '', legalName, aadhaarLast4: site.aadhaar_last4 ?? '', city: site.city ?? '', state: site.state ?? '', status: 'WOULD_REMOVE' });
      continue;
    }
    const { error: updErr } = await supabase.from('vendor_site').update({ deleted_at: new Date().toISOString() }).eq('id', site.id);
    report.push({ vendorCode: site.legacy_vendor_code ?? '', legalName, aadhaarLast4: site.aadhaar_last4 ?? '', city: site.city ?? '', state: site.state ?? '', status: updErr ? `FAILED: ${updErr.message}` : 'REMOVED' });
    if (!updErr) companyIds.add(site.company_id);
  }

  for (const companyId of companyIds) {
    const { count } = await supabase.from('vendor_site').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).is('deleted_at', null);
    if (count) continue;
    await supabase.from('company').update({ deleted_at: new Date().toISOString() }).eq('id', companyId);
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
