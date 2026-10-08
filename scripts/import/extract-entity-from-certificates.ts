/**
 * ONE-OFF: backlog runner for lib/entityFromCertificate.ts — reads each
 * company's existing GST certificate (already on file, from the earlier
 * document bulk import) with Gemini and fills in entity type. Free (Gemini
 * free tier), reads a document Fitsol already has — no third-party GST
 * API, no scraping.
 *
 * Only companies with entity still blank, and only one request per
 * company (the first GST certificate found among its sites). Sequential,
 * not concurrent, with a delay between calls — Gemini's free tier is
 * rate-limited per minute, not just per day, and a burst would just start
 * failing requests rather than going faster.
 *
 *   npm run extract:entity -- --dry-run
 *   npm run extract:entity -- --limit 10 --allow-prod
 *   npm run extract:entity -- --allow-prod
 *   npm run extract:entity -- --retry-cached --allow-prod   # 0 Gemini calls, see below
 *
 * --retry-cached: re-applies a constitution already extracted in a
 * previous run that failed to SAVE (e.g. cin_when_company, before that
 * constraint was dropped) — no new Gemini calls. The certificate was
 * already read once; no reason to read it again.
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';
import { extractEntityFromCertificate, mapConstitutionToEntity } from '../../lib/entityFromCertificate';

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT, '.env.import');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'entity-extract-report.csv');
const BUCKET = 'vendor-documents';
const DELAY_MS = 5_000; // PRD mitigation: stay well under Gemini free tier's per-minute limit

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

type ReportRow = { companyCode: string; legalName: string; status: string; detail: string };

function writeCsv(path: string, rows: ReportRow[]) {
  const header = ['Company Code', 'Legal Name', 'Status', 'Detail'];
  const body = rows.map(r => [r.companyCode, r.legalName, r.status, r.detail]);
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

function readCachedFailures(path: string): { companyCode: string; constitution: string }[] {
  if (!fs.existsSync(path)) return [];
  const text = fs.readFileSync(path, 'utf8').replace(/^﻿/, '');
  const out: { companyCode: string; constitution: string }[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const [companyCode, , status, detail] = parseCsvLine(line);
    if (status !== 'FAILED') continue;
    const m = detail.match(/\[constitution: (.+)\]$/);
    if (m) out.push({ companyCode, constitution: m[1] });
  }
  return out;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

  if (!env.geminiApiKey) fail(`GEMINI_API_KEY is missing or blank in ${ENV_PATH}.`);
  process.env.GEMINI_API_KEY = env.geminiApiKey;
  if (env.geminiModel) process.env.GEMINI_MODEL = env.geminiModel;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const supabase = createImportAdminClient(env);

  if (args.retryCached) {
    const cached = readCachedFailures(OUTPUT_PATH);
    if (!cached.length) fail(`No FAILED rows with a cached constitution were found in ${OUTPUT_PATH}.`);
    console.log(`${cached.length} cached result(s) to retry — no Gemini calls.`);

    const report: ReportRow[] = [];
    for (const row of cached) {
      const entity = mapConstitutionToEntity(row.constitution);
      if (!entity) { report.push({ companyCode: row.companyCode, legalName: '', status: 'FAILED', detail: `No internal entity type matches "${row.constitution}".` }); continue; }
      if (args.dryRun) { report.push({ companyCode: row.companyCode, legalName: '', status: 'WOULD_APPLY', detail: `${entity} (${row.constitution})` }); continue; }

      const { data: co } = await supabase.from('company').select('id').eq('company_code', row.companyCode).maybeSingle();
      if (!co) { report.push({ companyCode: row.companyCode, legalName: '', status: 'FAILED', detail: 'Company not found (was it deleted?).' }); continue; }
      const { error: updErr } = await supabase.from('company').update({ entity }).eq('id', co.id);
      report.push({ companyCode: row.companyCode, legalName: '', status: updErr ? 'FAILED' : 'APPLIED', detail: updErr ? updErr.message : `${entity} (${row.constitution})` });
    }

    const retryPath = path.join(OUTPUT_DIR, 'entity-extract-retry-cached-report.csv');
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

  // One GST certificate per company is enough — the first non-superseded
  // one found among that company's sites.
  const todo: { id: string; companyCode: string; legalName: string; storagePath: string; mimeType: string }[] = [];
  for (const co of companies ?? []) {
    const { data: sites } = await supabase.from('vendor_site').select('id').eq('company_id', co.id).is('deleted_at', null);
    const siteIds = (sites ?? []).map(s => s.id);
    if (!siteIds.length) continue;
    const { data: doc } = await supabase
      .from('site_document').select('storage_path, mime_type')
      .in('site_id', siteIds).eq('doc_type', 'gst').is('superseded_at', null)
      .limit(1).maybeSingle();
    if (doc?.storage_path) todo.push({ id: co.id, companyCode: co.company_code, legalName: co.legal_name, storagePath: doc.storage_path, mimeType: doc.mime_type ?? 'application/pdf' });
  }

  console.log(`${companies?.length ?? 0} compan(y/ies) with no entity type on file, ${todo.length} of them have a GST certificate to read.`);
  const batch = args.limit !== null ? todo.slice(0, args.limit) : todo;
  if (args.limit !== null) console.log(`--limit ${args.limit}: this run will call Gemini at most ${batch.length} time(s).`);
  if (!args.dryRun) console.log(`Sequential, ~${DELAY_MS / 1000}s between calls — this will take a while for a large batch.`);

  const report: ReportRow[] = [];
  for (let i = 0; i < batch.length; i++) {
    const co = batch[i];
    if (args.dryRun) {
      report.push({ companyCode: co.companyCode, legalName: co.legalName, status: 'WOULD_EXTRACT', detail: co.storagePath });
      continue;
    }

    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(co.storagePath);
    if (dlErr || !blob) {
      report.push({ companyCode: co.companyCode, legalName: co.legalName, status: 'FAILED', detail: `Could not download certificate: ${dlErr?.message ?? 'no data'}` });
      continue;
    }
    const buffer = Buffer.from(await blob.arrayBuffer());

    const result = await extractEntityFromCertificate(supabase, co.id, buffer, co.mimeType);
    report.push(
      result.ok
        ? { companyCode: co.companyCode, legalName: co.legalName, status: 'EXTRACTED', detail: `${result.entity} (${result.fields.constitution_of_business})` }
        : { companyCode: co.companyCode, legalName: co.legalName, status: 'FAILED', detail: result.reason + (result.fields?.constitution_of_business ? ` [constitution: ${result.fields.constitution_of_business}]` : '') }
    );

    console.log(`  [${i + 1}/${batch.length}] ${co.companyCode}: ${report[report.length - 1].status}`);
    if (i < batch.length - 1) await sleep(DELAY_MS);
  }

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
