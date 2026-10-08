/**
 * ONE-OFF: two cleanups requested directly against the live vendor list,
 * both keyed on the exact Services text already on record (checked against
 * production first — see the chat for the distinct-value dump this was
 * built from):
 *
 * 1. SOFT-DELETE every vendor_site whose Services is one of 15 internal
 *    finance/expense categories (Opex, Casual Labour and its combos,
 *    Administrative Expenses, Office Expenses, Security, IT Cost,
 *    Subscription, API Service, Business Promotion, Washing Vendor, Keka,
 *    Manpower, Internet) — these are cost-center tags from the old
 *    system, not real recycling/packaging/transportation vendors, and
 *    will not be used. Sets deleted_at (same soft-delete every other
 *    "remove" in this app uses — reversible, keeps the audit trail,
 *    matches HANDOVER.md's "disabling is better than deleting"). If a
 *    deleted site's company ends up with no other active site, the
 *    company is soft-deleted too so it stops being an orphan; a company
 *    with a remaining legitimate site is left alone.
 *
 * 2. RECLASSIFY by exact Services text: "Capex"/"CAPEX" -> packaging,
 *    "Material Trading" / "EPR Credit Transfer" -> recycling. Additive
 *    only — it only ever sets industry where it is currently null.
 *
 *   npm run cleanup:vendors -- --dry-run
 *   npm run cleanup:vendors -- --allow-prod
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT, '.env.import');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'cleanup-report.csv');

const DELETE_SERVICES = [
  'Opex', 'Casual Labour, Manpower', 'Administrative Expenses', 'Subscription', 'API Service',
  'Business Promotion', 'Casual Labour', 'Office Expenses', 'Security', 'IT Cost', 'Washing Vendor',
  'Keka', 'Manpower', 'Casual Labour, Security', 'Internet',
];
const RECLASSIFY: { services: string[]; industry: 'packaging' | 'recycling' }[] = [
  { services: ['Capex', 'CAPEX'], industry: 'packaging' },
  { services: ['Material Trading', 'EPR Credit Transfer'], industry: 'recycling' },
];

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

type ReportRow = { vendorCode: string; legalName: string; servicesText: string; action: string; status: string };

function writeCsv(path: string, rows: ReportRow[]) {
  const header = ['Vendor Code', 'Legal Name', 'Services', 'Action', 'Status'];
  const body = rows.map(r => [r.vendorCode, r.legalName, r.servicesText, r.action, r.status]);
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

  // --- 1) reclassify first (additive, no risk, do it before deletion) ---
  for (const { services, industry } of RECLASSIFY) {
    const { data: sites, error } = await supabase
      .from('vendor_site')
      .select('id, legacy_vendor_code, services_text, company_id, industry')
      .in('services_text', services)
      .is('deleted_at', null);
    if (error) fail(`Could not read vendor_site: ${error.message}`);

    for (const site of sites ?? []) {
      const { data: company } = await supabase.from('company').select('legal_name').eq('id', site.company_id).single();
      const legalName = company?.legal_name ?? '';
      if (site.industry) {
        report.push({ vendorCode: site.legacy_vendor_code ?? '', legalName, servicesText: site.services_text ?? '', action: `RECLASSIFY_TO_${industry}`, status: 'SKIPPED_ALREADY_CLASSIFIED' });
        continue;
      }
      if (args.dryRun) {
        report.push({ vendorCode: site.legacy_vendor_code ?? '', legalName, servicesText: site.services_text ?? '', action: `RECLASSIFY_TO_${industry}`, status: 'WOULD_APPLY' });
        continue;
      }
      const { error: updErr } = await supabase.from('vendor_site').update({ industry }).eq('id', site.id);
      report.push({ vendorCode: site.legacy_vendor_code ?? '', legalName, servicesText: site.services_text ?? '', action: `RECLASSIFY_TO_${industry}`, status: updErr ? `FAILED: ${updErr.message}` : 'APPLIED' });
    }
  }

  // --- 2) soft-delete the junk-category sites ---
  const { data: junkSites, error: junkErr } = await supabase
    .from('vendor_site')
    .select('id, legacy_vendor_code, services_text, company_id')
    .in('services_text', DELETE_SERVICES)
    .is('deleted_at', null);
  if (junkErr) fail(`Could not read vendor_site: ${junkErr.message}`);

  const companyIds = new Set<string>();
  for (const site of junkSites ?? []) {
    const { data: company } = await supabase.from('company').select('legal_name').eq('id', site.company_id).single();
    const legalName = company?.legal_name ?? '';

    if (args.dryRun) {
      report.push({ vendorCode: site.legacy_vendor_code ?? '', legalName, servicesText: site.services_text ?? '', action: 'SOFT_DELETE_SITE', status: 'WOULD_APPLY' });
      continue;
    }
    const { error: updErr } = await supabase.from('vendor_site').update({ deleted_at: new Date().toISOString() }).eq('id', site.id);
    report.push({ vendorCode: site.legacy_vendor_code ?? '', legalName, servicesText: site.services_text ?? '', action: 'SOFT_DELETE_SITE', status: updErr ? `FAILED: ${updErr.message}` : 'APPLIED' });
    if (!updErr) companyIds.add(site.company_id);
  }

  // --- 3) a company left with zero active sites is soft-deleted too ---
  for (const companyId of companyIds) {
    const { count } = await supabase.from('vendor_site').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).is('deleted_at', null);
    if (count) continue; // still has a live site — leave the company alone
    const { data: company } = await supabase.from('company').select('legal_name').eq('id', companyId).single();
    if (args.dryRun) {
      report.push({ vendorCode: '', legalName: company?.legal_name ?? companyId, servicesText: '', action: 'SOFT_DELETE_COMPANY', status: 'WOULD_APPLY' });
      continue;
    }
    const { error: updErr } = await supabase.from('company').update({ deleted_at: new Date().toISOString() }).eq('id', companyId);
    report.push({ vendorCode: '', legalName: company?.legal_name ?? companyId, servicesText: '', action: 'SOFT_DELETE_COMPANY', status: updErr ? `FAILED: ${updErr.message}` : 'APPLIED' });
  }

  writeCsv(OUTPUT_PATH, report);
  const byAction: Record<string, Record<string, number>> = {};
  for (const r of report) {
    byAction[r.action] = byAction[r.action] ?? {};
    byAction[r.action][r.status] = (byAction[r.action][r.status] ?? 0) + 1;
  }
  console.log('\nDone.');
  for (const [action, statuses] of Object.entries(byAction)) {
    console.log(`  ${action}`);
    for (const [status, n] of Object.entries(statuses)) console.log(`    ${String(n).padStart(4)}  ${status}`);
  }
  console.log(`\nFull detail in ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
