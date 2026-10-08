/**
 * ONE-OFF: runs GST entity-type verification (same logic the "Add vendor"
 * flow now does automatically for new vendors — lib/gstVerify.ts, backed by
 * gstinapi.in) against every EXISTING company that has a GSTIN on file and
 * no entity type set yet. Needs GSTINAPI_TOKEN in .env.import (see
 * scripts/import/README.md — this will fail closed with a clear message per
 * row until that is set, never silently).
 *
 * gstinapi.in's free tier is 100 credits total, 1 credit per successful
 * lookup — this only calls it for companies that actually need one, and
 * --dry-run costs nothing, so check the count before running for real.
 *
 * Only fills company.entity when it is currently blank — never overwrites
 * an entity someone already set or already verified.
 *
 *   npm run verify:gst-bulk -- --dry-run
 *   npm run verify:gst-bulk -- --limit 20 --allow-prod   # spend at most 20 credits
 *   npm run verify:gst-bulk -- --allow-prod
 *   npm run verify:gst-bulk -- --retry-cached --allow-prod   # see below, costs 0 credits
 *
 * --retry-cached: re-applies constitutions already fetched in a previous
 * run's report.csv that failed to SAVE (e.g. cin_when_company, before that
 * constraint was dropped) — no new API calls, no credits spent. Useful the
 * moment a blocking constraint is fixed: the GST result was already paid
 * for once, no reason to pay for it again.
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';
import { verifyEntityFromGstin, mapConstitutionToEntity } from '../../lib/gstVerify';
import { runWithConcurrency } from './lib/pool';

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT, '.env.import');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'gst-verify-report.csv');
const CONCURRENCY = 3; // a paid, rate-limited third-party API — gentle by default

type Args = { dryRun: boolean; allowProd: boolean; limit: number | null; retryCached: boolean };
function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, allowProd: false, limit: null, retryCached: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run') a.dryRun = true;
    else if (t === '--allow-prod') a.allowProd = true;
    else if (t === '--retry-cached') a.retryCached = true;
    else if (t === '--limit') a.limit = Number(argv[++i]);
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

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Rows from a previous run that got a real constitution back but failed to
 *  save it (e.g. a constraint since removed) — the fetched value is reused,
 *  not re-requested. */
function readCachedFailures(path: string): { companyCode: string; constitution: string }[] {
  if (!fs.existsSync(path)) return [];
  const text = fs.readFileSync(path, 'utf8').replace(/^﻿/, '');
  const out: { companyCode: string; constitution: string }[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const [companyCode, , , status, detail] = parseCsvLine(line);
    if (status !== 'FAILED') continue;
    const m = detail.match(/\[constitution: (.+)\]$/);
    if (m) out.push({ companyCode, constitution: m[1] });
  }
  return out;
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

  // lib/gstVerify.ts reads real process.env vars (that's how the actual app
  // gets them, via .env.local/Vercel) — .env.import is a separate, hand-parsed
  // file, so its values never land in process.env on their own.
  if (!env.gstinapiToken) fail(`GSTINAPI_TOKEN is missing or blank in ${ENV_PATH}.`);
  process.env.GSTINAPI_TOKEN = env.gstinapiToken;
  if (env.gstinapiBaseUrl) process.env.GSTINAPI_BASE_URL = env.gstinapiBaseUrl;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const supabase = createImportAdminClient(env);

  if (args.retryCached) {
    const cached = readCachedFailures(OUTPUT_PATH);
    if (!cached.length) fail(`No FAILED rows with a cached constitution were found in ${OUTPUT_PATH}.`);
    console.log(`${cached.length} cached result(s) to retry — no API calls, no credits spent.`);

    const report: ReportRow[] = [];
    for (const row of cached) {
      const entity = mapConstitutionToEntity(row.constitution);
      if (!entity) { report.push({ companyCode: row.companyCode, legalName: '', gstin: '', status: 'FAILED', detail: `No internal entity type matches "${row.constitution}".` }); continue; }
      if (args.dryRun) { report.push({ companyCode: row.companyCode, legalName: '', gstin: '', status: 'WOULD_APPLY', detail: `${entity} (${row.constitution})` }); continue; }

      const { data: co } = await supabase.from('company').select('id').eq('company_code', row.companyCode).maybeSingle();
      if (!co) { report.push({ companyCode: row.companyCode, legalName: '', gstin: '', status: 'FAILED', detail: 'Company not found (was it deleted?).' }); continue; }
      const { error: updErr } = await supabase.from('company').update({ entity }).eq('id', co.id);
      report.push({
        companyCode: row.companyCode, legalName: '', gstin: '',
        status: updErr ? 'FAILED' : 'APPLIED',
        detail: updErr ? updErr.message : `${entity} (${row.constitution})`,
      });
    }

    const retryPath = path.join(OUTPUT_DIR, 'gst-verify-retry-cached-report.csv');
    writeCsv(retryPath, report);
    const byStatus: Record<string, number> = {};
    for (const r of report) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    console.log('\nDone.');
    for (const [status, n] of Object.entries(byStatus).sort()) console.log(`  ${String(n).padStart(4)}  ${status}`);
    console.log(`\nFull detail in ${retryPath}`);
    return;
  }

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
  const batch = args.limit !== null ? todo.slice(0, args.limit) : todo;
  if (args.limit !== null) console.log(`--limit ${args.limit}: this run will use at most ${batch.length} credit(s).`);

  const report = await runWithConcurrency(batch, CONCURRENCY, async (co): Promise<ReportRow> => {
    if (args.dryRun) return { companyCode: co.companyCode, legalName: co.legalName, gstin: co.gstin, status: 'WOULD_VERIFY', detail: '' };
    const result = await verifyEntityFromGstin(supabase, co.id, co.gstin);
    return result.ok
      ? { companyCode: co.companyCode, legalName: co.legalName, gstin: co.gstin, status: 'VERIFIED', detail: `${result.entity} (${result.constitution})` }
      : { companyCode: co.companyCode, legalName: co.legalName, gstin: co.gstin, status: 'FAILED', detail: result.reason + (result.constitution ? ` [constitution: ${result.constitution}]` : '') };
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
