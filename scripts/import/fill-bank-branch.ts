/**
 * ONE-OFF: fills company.bank_branch ("Bank and branch", e.g. "HDFC Bank,
 * Alwar") from the IFSC already on record, using the public IFSC lookup at
 * https://ifsc.razorpay.com/<CODE> — no key needed, read-only, nothing
 * sensitive leaves the system beyond the IFSC code itself.
 *
 * Only fills a BLANK bank_branch. Never touches bank_account_name — that
 * field is the account HOLDER's name (checked against the legal name) and
 * an IFSC cannot tell you who holds an account, only which bank/branch it
 * is at.
 *
 *   npm run fill:bank-branch -- --dry-run
 *   npm run fill:bank-branch -- --allow-prod
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';
import { runWithConcurrency } from './lib/pool';

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'bank-branch-report.csv');
const ENV_PATH = path.join(ROOT, '.env.import');
const CONCURRENCY = 5;

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

type ReportRow = { companyCode: string; legalName: string; ifsc: string; bankBranch: string; status: string };

function writeCsv(path: string, rows: ReportRow[]) {
  const header = ['Company Code', 'Legal Name', 'IFSC', 'Bank And Branch', 'Status'];
  const body = rows.map(r => [r.companyCode, r.legalName, r.ifsc, r.bankBranch, r.status]);
  const bom = String.fromCharCode(0xfeff);
  const csv = bom + [header, ...body].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
  fs.writeFileSync(path, csv);
}

async function lookupIfsc(code: string): Promise<{ bank: string; branch: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(code)}`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { BANK?: string; BRANCH?: string };
    if (!data.BANK) return null;
    return { bank: data.BANK, branch: data.BRANCH ?? '' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    .select('id, company_code, legal_name, ifsc, bank_branch')
    .not('ifsc', 'is', null)
    .is('bank_branch', null)
    .is('deleted_at', null);
  if (error) fail(`Could not read company: ${error.message}`);

  console.log(`${companies?.length ?? 0} compan(y/ies) have an IFSC but no bank/branch on file.`);

  const cache = new Map<string, { bank: string; branch: string } | null>();
  const report = await runWithConcurrency(companies ?? [], CONCURRENCY, async (co): Promise<ReportRow> => {
    const ifsc = (co.ifsc as string).toUpperCase();
    let looked = cache.get(ifsc);
    if (looked === undefined) {
      looked = await lookupIfsc(ifsc);
      cache.set(ifsc, looked);
    }
    if (!looked) {
      return { companyCode: co.company_code, legalName: co.legal_name, ifsc, bankBranch: '', status: 'NOT_FOUND' };
    }
    const value = looked.branch ? `${looked.bank}, ${looked.branch}` : looked.bank;
    if (args.dryRun) {
      return { companyCode: co.company_code, legalName: co.legal_name, ifsc, bankBranch: value, status: 'WOULD_FILL' };
    }
    const { error: updErr } = await supabase.from('company').update({ bank_branch: value }).eq('id', co.id);
    return { companyCode: co.company_code, legalName: co.legal_name, ifsc, bankBranch: value, status: updErr ? `FAILED: ${updErr.message}` : 'FILLED' };
  });

  writeCsv(OUTPUT_PATH, report);
  const byStatus: Record<string, number> = {};
  for (const r of report) {
    const key = r.status.startsWith('FAILED') ? 'FAILED' : r.status;
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }
  console.log('\nDone.');
  for (const [status, n] of Object.entries(byStatus).sort()) console.log(`  ${String(n).padStart(5)}  ${status}`);
  console.log(`\nFull detail in ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
