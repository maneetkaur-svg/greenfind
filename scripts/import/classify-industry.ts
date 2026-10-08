/**
 * ONE-OFF: classifies vendor_site rows that are currently Unclassified
 * (industry is null) by re-deriving the industry from the vendor's own
 * data, using the exact same heuristic the original legacy import used
 * (lib/import/normalise.ts's deriveIndustry — recycling/packaging/
 * transportation only, nothing invented). Several vendors' Services text
 * turned out to be finance expense categories ("Opex", "Material Trading",
 * "Office Expenses") rather than a description of what they do, so this
 * tries, in order, until one gives a confident single match: Services text,
 * then the company's legal name, then its trade name — "OM LOGISTIC" and
 * "Eco Recycling Plant" classify correctly from their name even though their
 * Services column carries no signal at all. Each report row says which
 * source actually matched, so a name-derived guess is easy to double check.
 *
 * Only a confident, single-industry match is applied; anything ambiguous,
 * unmatched everywhere, or with nothing to go on is left Unclassified and
 * listed in the report for a manual decision (edit it, or delete the
 * record).
 *
 *   npm run classify:industry -- --dry-run
 *   npm run classify:industry -- --allow-prod
 *
 * Reclassifying an EXISTING vendor is Super Admin only inside the app
 * (sql/09_industry_super_admin_only.sql) — this script is exempt the same
 * way every local script here is: it runs with the service-role key, which
 * already bypasses every row-level security rule in the project.
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';
import { deriveIndustry } from '../../lib/import/normalise';

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'industry-classify-report.csv');
const ENV_PATH = path.join(ROOT, '.env.import');

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

type ReportRow = {
  vendorCode: string; siteId: string; legalName: string;
  servicesText: string; result: string; detail: string;
};

function writeCsv(path: string, rows: ReportRow[]) {
  const header = ['Vendor Code', 'Site ID', 'Legal Name', 'Services', 'Result', 'Detail'];
  const body = rows.map(r => [r.vendorCode, r.siteId, r.legalName, r.servicesText, r.result, r.detail]);
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
    .select('id, legacy_vendor_code, services_text, company_id')
    .is('industry', null)
    .is('deleted_at', null);
  if (error) fail(`Could not read vendor_site: ${error.message}`);

  console.log(`${sites?.length ?? 0} unclassified vendor_site row(s) found.`);

  const report: ReportRow[] = [];
  let classified = 0, ambiguous = 0, noMatch = 0;

  for (const site of sites ?? []) {
    const code = site.legacy_vendor_code ?? '';
    const services = (site.services_text ?? '').trim();
    const { data: company } = await supabase.from('company').select('legal_name, trade_name').eq('id', site.company_id).single();
    const legalName = company?.legal_name ?? '';
    const tradeName = company?.trade_name ?? '';

    const attempts: { source: string; text: string }[] = [
      { source: 'Services text', text: services },
      { source: 'Legal name', text: legalName },
      { source: 'Trade name', text: tradeName },
    ].filter(a => a.text);

    let industry: 'recycling' | 'packaging' | 'transportation' | null = null;
    let matchedSource = '';
    let sawAmbiguous = false;

    for (const attempt of attempts) {
      const result = deriveIndustry(attempt.text);
      if (result.industry) { industry = result.industry; matchedSource = attempt.source; break; }
      if (result.ambiguous) sawAmbiguous = true;
    }

    if (!industry) {
      const result = sawAmbiguous ? 'AMBIGUOUS' : 'NO_MATCH';
      report.push({
        vendorCode: code, siteId: site.id, legalName, servicesText: services, result,
        detail: attempts.length
          ? `Tried ${attempts.map(a => a.source).join(', ')} — ${sawAmbiguous ? 'at least one matched more than one industry' : 'none matched'}.`
          : 'No Services text, legal name, or trade name to classify from.',
      });
      if (sawAmbiguous) ambiguous++; else noMatch++;
      continue;
    }

    if (args.dryRun) {
      report.push({ vendorCode: code, siteId: site.id, legalName, servicesText: services, result: 'WOULD_CLASSIFY', detail: `${industry} (from ${matchedSource})` });
      classified++;
      continue;
    }

    const { error: updErr } = await supabase.from('vendor_site').update({ industry }).eq('id', site.id);
    if (updErr) {
      report.push({ vendorCode: code, siteId: site.id, legalName, servicesText: services, result: 'FAILED', detail: updErr.message });
    } else {
      report.push({ vendorCode: code, siteId: site.id, legalName, servicesText: services, result: 'CLASSIFIED', detail: `${industry} (from ${matchedSource})` });
      classified++;
    }
  }

  writeCsv(OUTPUT_PATH, report);
  console.log('\nDone.');
  console.log(`  ${classified}  ${args.dryRun ? 'would be classified' : 'classified'}`);
  console.log(`  ${ambiguous}  left Unclassified — at least one source matched more than one industry`);
  console.log(`  ${noMatch}  left Unclassified — nothing matched (or nothing to go on)`);
  console.log(`\nFull detail in ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
