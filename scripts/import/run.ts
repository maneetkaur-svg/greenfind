/**
 * ONE-OFF bulk import: attaches vendor documents from scripts/import/input/
 * finance-vendors.xlsx to the existing company/vendor_site/site_document
 * structure and the private vendor-documents bucket.
 *
 *   npm run import:docs -- --dry-run
 *   npm run import:docs -- --limit 5
 *   npm run import:docs -- --vendor VEN-0053
 *   npm run import:docs -- --retry-failed
 *
 * See scripts/import/README.md before the first real run.
 */
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';
import { readWorkbook } from './lib/excel';
import { matchColumns, findMissingRequiredColumns, DOC_COLUMN_KEYS, DOC_COLUMN_TO_TYPE, type ColumnKey } from './lib/columns';
import { decideBlankStatus } from './lib/docStatus';
import { assertPublicHttpUrl } from './lib/ssrf';
import { downloadDocument, type DownloadResult } from './lib/download';
import { EXT_FOR_TYPE, type DetectedType } from './lib/magicBytes';
import { ImportDocError, isTransient } from './lib/errors';
import { detectConflict, type MatchedSite } from './lib/matching';
import { runWithConcurrency } from './lib/pool';
import { writeReportCsv, writeReviewCsv, readPreviousFailed, type ReportRow, type ReviewRow } from './lib/report';
import type { ParsedRow } from './lib/types';
// Relative, not "@/..." — tsx runs this outside the Next webpack graph, which is what resolves that alias (see scripts/preflight.ts for the same pattern).
import { normBool } from '../../lib/import/normalise';

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(ROOT, 'scripts', 'import', 'input', 'finance-vendors.xlsx');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const REPORT_PATH = path.join(OUTPUT_DIR, 'report.csv');
const REVIEW_PATH = path.join(OUTPUT_DIR, 'review.csv');
const ENV_PATH = path.join(ROOT, '.env.import');
const CONCURRENCY = 5;
const BUCKET = 'vendor-documents';
const REQUIRED_DOC_TYPE_CODES = Object.values(DOC_COLUMN_TO_TYPE);

type Args = { dryRun: boolean; limit: number | null; vendor: string | null; retryFailed: boolean; allowProd: boolean; input: string };

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, limit: null, vendor: null, retryFailed: false, allowProd: false, input: DEFAULT_INPUT };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run') a.dryRun = true;
    else if (t === '--retry-failed') a.retryFailed = true;
    else if (t === '--allow-prod') a.allowProd = true;
    else if (t === '--limit') a.limit = Number(argv[++i]);
    else if (t === '--vendor') a.vendor = argv[++i];
    else if (t === '--input') a.input = path.resolve(argv[++i]);
  }
  return a;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function reportRow(row: ParsedRow, columnKey: ColumnKey, status: string, errorCode: string, extra: Partial<ReportRow> = {}): ReportRow {
  return {
    vendorCode: row.vendorCode,
    excelRow: row.excelRow,
    docType: DOC_COLUMN_TO_TYPE[columnKey],
    status,
    errorCode,
    httpStatus: '',
    sha256: '',
    storagePath: '',
    ...extra,
  };
}

function deriveFileName(rawUrl: string, fileType: DetectedType): string {
  try {
    const u = new URL(rawUrl);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last && /\.[a-z0-9]{2,4}$/i.test(last)) return decodeURIComponent(last);
  } catch {
    /* fall through to a generic name */
  }
  return `document.${EXT_FOR_TYPE[fileType]}`;
}

type SiteMatchResult = { ok: true; site: MatchedSite } | { ok: false; reason: string; detail: string };

async function matchSite(supabase: SupabaseClient, row: ParsedRow): Promise<SiteMatchResult> {
  const { data: sites, error } = await supabase
    .from('vendor_site')
    .select('id, site_code, company_id, gstin, legacy_vendor_code')
    .eq('legacy_vendor_code', row.vendorCode)
    .is('deleted_at', null);

  if (error) return { ok: false, reason: 'NO_MATCH', detail: `Lookup failed: ${error.message}` };
  if (!sites || sites.length === 0)
    return { ok: false, reason: 'NO_MATCH', detail: `No vendor_site with legacy_vendor_code = "${row.vendorCode}".` };
  if (sites.length > 1)
    return { ok: false, reason: 'AMBIGUOUS_MATCH', detail: `${sites.length} vendor_site rows share legacy_vendor_code "${row.vendorCode}".` };

  const site = sites[0] as { id: string; site_code: string; company_id: string; gstin: string | null };
  const { data: company, error: compErr } = await supabase
    .from('company').select('id, legal_name, pan').eq('id', site.company_id).single();
  if (compErr || !company)
    return { ok: false, reason: 'NO_MATCH', detail: `Matched site has no company on record (${compErr?.message ?? 'not found'}).` };

  const matched: MatchedSite = {
    id: site.id, siteCode: site.site_code, gstin: site.gstin,
    companyId: company.id, companyLegalName: company.legal_name, companyPan: company.pan,
  };

  const conflict = detectConflict(row, matched);
  if (conflict) return { ok: false, reason: 'CONFLICT', detail: conflict };

  return { ok: true, site: matched };
}

/** One automatic retry, and only for errors classified as transient — a bad
 *  scheme, an SSRF block or a 4xx is permanent and goes straight to FAILED. */
async function downloadWithRetry(url: string): Promise<DownloadResult> {
  try {
    return await downloadDocument(url);
  } catch (e) {
    const err = e instanceof ImportDocError ? e : new ImportDocError('NETWORK_ERROR', e instanceof Error ? e.message : String(e));
    if (!isTransient(err.code, err.httpStatus)) throw err;
    try {
      return await downloadDocument(url);
    } catch (e2) {
      throw e2 instanceof ImportDocError ? e2 : new ImportDocError('NETWORK_ERROR', e2 instanceof Error ? e2.message : String(e2));
    }
  }
}

async function processOneDocument(
  supabase: SupabaseClient, row: ParsedRow, columnKey: ColumnKey, docType: string, site: MatchedSite
): Promise<ReportRow> {
  const doc = row.docs[columnKey];
  const url = doc.url;
  if (!url) {
    return reportRow(row, columnKey, decideBlankStatus(columnKey, row.isMsme), '');
  }

  let downloaded: DownloadResult;
  try {
    downloaded = await downloadWithRetry(url);
  } catch (e) {
    const err = e as ImportDocError;
    return reportRow(row, columnKey, 'FAILED', err.code, { httpStatus: err.httpStatus ? String(err.httpStatus) : '' });
  }

  // --- idempotency: compare against whatever is currently stored, not a stored hash ---
  const { data: existingRows, error: existingErr } = await supabase
    .from('site_document').select('id, storage_path')
    .eq('site_id', site.id).eq('doc_type', docType).is('superseded_at', null)
    .order('uploaded_at', { ascending: false }).limit(1);

  if (!existingErr && existingRows && existingRows.length) {
    const existing = existingRows[0] as { id: string; storage_path: string };
    const { data: existingBlob, error: dlErr } = await supabase.storage.from(BUCKET).download(existing.storage_path);
    if (!dlErr && existingBlob) {
      const existingBuf = Buffer.from(await existingBlob.arrayBuffer());
      const existingHash = createHash('sha256').update(existingBuf).digest('hex');
      if (existingHash === downloaded.sha256) {
        return reportRow(row, columnKey, 'DUPLICATE', '', {
          httpStatus: String(downloaded.httpStatus), sha256: downloaded.sha256, storagePath: existing.storage_path,
        });
      }
    }
    // different (or the existing file could not be read) — upload; the
    // existing doc_supersede trigger retires `existing` on insert.
  }

  const fileName = deriveFileName(url, downloaded.fileType);
  const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
  const storagePath = `${site.id}/${docType}/${Date.now()}_${safeName}`;

  const doUpload = () => supabase.storage.from(BUCKET)
    .upload(storagePath, downloaded.buffer, { contentType: downloaded.contentType, upsert: false });

  let upload = await doUpload();
  if (upload.error) upload = await doUpload(); // one automatic retry
  if (upload.error) {
    return reportRow(row, columnKey, 'FAILED', 'UPLOAD_FAILED', { httpStatus: String(downloaded.httpStatus) });
  }

  const { error: insErr } = await supabase.from('site_document').insert({
    site_id: site.id, doc_type: docType, storage_path: storagePath,
    file_name: fileName, file_size: downloaded.buffer.length, mime_type: downloaded.contentType,
  });

  if (insErr) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return reportRow(row, columnKey, 'FAILED', 'DB_INSERT_FAILED', { httpStatus: String(downloaded.httpStatus) });
  }

  return reportRow(row, columnKey, 'COMPLETED', '', {
    httpStatus: String(downloaded.httpStatus), sha256: downloaded.sha256, storagePath,
  });
}

async function dryRun(supabase: SupabaseClient, rows: ParsedRow[], rowLevelReview: ReviewRow[]) {
  console.log('\n[dry run] Nothing will be downloaded, uploaded, or written to the database or disk.\n');
  const counts: Record<string, number> = {};
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };

  for (const r of rowLevelReview) bump(`row: ${r.reason}`);

  for (const row of rows) {
    const match = await matchSite(supabase, row);
    if (!match.ok) { bump(`row: ${match.reason}`); continue; }
    bump('row: MATCHED');
    for (const columnKey of DOC_COLUMN_KEYS) {
      const doc = row.docs[columnKey];
      if (!doc.url) { bump(`${columnKey}: ${decideBlankStatus(columnKey, row.isMsme)}`); continue; }
      try {
        await assertPublicHttpUrl(doc.url);
        bump(`${columnKey}: LINK_OK`);
      } catch {
        bump(`${columnKey}: LINK_BLOCKED`);
      }
    }
  }

  console.log('Summary:');
  for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${String(v).padStart(5)}  ${k}`);
  console.log('\nNo report.csv or review.csv was written in --dry-run mode.');
}

function summarize(reportRows: ReportRow[], reviewRows: ReviewRow[]) {
  const byStatus: Record<string, number> = {};
  for (const r of reportRows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log('\nDone.');
  for (const [status, n] of Object.entries(byStatus).sort()) console.log(`  ${String(n).padStart(5)}  ${status}`);
  console.log(`\n  ${reviewRows.length} row(s) need review — see ${REVIEW_PATH}`);
  console.log(`  Full detail in ${REPORT_PATH}`);
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

  // --- the five document_type codes must already exist; never invented here ---
  const { data: docTypeRows, error: docTypeErr } = await supabase
    .from('document_type').select('code').in('code', REQUIRED_DOC_TYPE_CODES);
  if (docTypeErr) fail(`Could not read document_type: ${docTypeErr.message}`);
  const haveCodes = new Set((docTypeRows ?? []).map((r: { code: string }) => r.code));
  const missingCodes = REQUIRED_DOC_TYPE_CODES.filter(c => !haveCodes.has(c));
  if (missingCodes.length)
    fail(`document_type is missing code(s) this import needs: ${missingCodes.join(', ')}. Nothing was changed.`);

  // --- read and map the sheet ---
  const sheet = await readWorkbook(args.input);
  const columnMatches = matchColumns(sheet.headers);
  const missingRequired = findMissingRequiredColumns(columnMatches);
  if (missingRequired.length)
    fail(`The sheet is missing required column(s): ${missingRequired.join(', ')}. Found headers: ${sheet.headers.join(' | ')}`);

  const indexOf = new Map(columnMatches.map(m => [m.key, m.index]));
  const cellAt = (cells: string[], key: ColumnKey) => { const i = indexOf.get(key); return i === undefined ? '' : (cells[i] ?? '').trim(); };
  const linkAt = (hyperlinks: (string | null)[], key: ColumnKey) => { const i = indexOf.get(key); return i === undefined ? null : (hyperlinks[i] ?? null); };

  const parsedRows: ParsedRow[] = sheet.rows.map(r => ({
    excelRow: r.rowNumber,
    vendorCode: cellAt(r.cells, 'vendor_code'),
    legalName: cellAt(r.cells, 'legal_name'),
    pan: cellAt(r.cells, 'pan'),
    gstin: cellAt(r.cells, 'gstin'),
    isMsme: normBool(cellAt(r.cells, 'is_msme')),
    docs: Object.fromEntries(DOC_COLUMN_KEYS.map(k => [k, { url: linkAt(r.hyperlinks, k), displayText: cellAt(r.cells, k) }])),
  }));

  console.log(`Read ${parsedRows.length} data row(s) from "${sheet.sheetName}".`);

  // --- duplicate / missing Vendor Codes, decided before any matching ---
  const byCode = new Map<string, ParsedRow[]>();
  for (const row of parsedRows) {
    if (!row.vendorCode) continue;
    const list = byCode.get(row.vendorCode) ?? [];
    list.push(row);
    byCode.set(row.vendorCode, list);
  }

  const reviewRows: ReviewRow[] = [];
  const reportRows: ReportRow[] = [];
  const held = new Set<number>();

  for (const row of parsedRows) {
    if (!row.vendorCode) {
      held.add(row.excelRow);
      reviewRows.push({ excelRow: row.excelRow, vendorCode: '', vendorName: row.legalName, reason: 'MISSING_VENDOR_CODE', detail: 'No Vendor Code on this row.' });
      for (const k of DOC_COLUMN_KEYS) reportRows.push(reportRow(row, k, 'REVIEW_REQUIRED', 'MISSING_VENDOR_CODE'));
      continue;
    }
    const dupes = byCode.get(row.vendorCode)!;
    if (dupes.length > 1) {
      held.add(row.excelRow);
      reviewRows.push({
        excelRow: row.excelRow, vendorCode: row.vendorCode, vendorName: row.legalName,
        reason: 'DUPLICATE_VENDOR_CODE_IN_FILE',
        detail: `Vendor Code appears on ${dupes.length} rows: ${dupes.map(d => d.excelRow).join(', ')}.`,
      });
      for (const k of DOC_COLUMN_KEYS) reportRows.push(reportRow(row, k, 'REVIEW_REQUIRED', 'DUPLICATE_VENDOR_CODE_IN_FILE'));
    }
  }

  let eligible = parsedRows.filter(r => !held.has(r.excelRow));
  if (args.vendor) eligible = eligible.filter(r => r.vendorCode === args.vendor);
  if (args.limit !== null) eligible = eligible.slice(0, args.limit);

  if (args.dryRun) {
    await dryRun(supabase, eligible, reviewRows);
    return;
  }

  let retrySet: Set<string> | null = null;
  if (args.retryFailed) {
    const prevFailed = readPreviousFailed(REPORT_PATH);
    if (!prevFailed.length) fail(`--retry-failed was given but no FAILED rows were found in ${REPORT_PATH}.`);
    retrySet = new Set(prevFailed.map(f => `${f.vendorCode}|${f.excelRow}|${f.docType}`));
    console.log(`--retry-failed: re-running ${retrySet.size} previously FAILED document(s).`);
  }

  type Task = { row: ParsedRow; columnKey: ColumnKey };
  const tasks: Task[] = [];
  for (const row of eligible) {
    for (const columnKey of DOC_COLUMN_KEYS) {
      if (retrySet && !retrySet.has(`${row.vendorCode}|${row.excelRow}|${DOC_COLUMN_TO_TYPE[columnKey]}`)) continue;
      tasks.push({ row, columnKey });
    }
  }

  const siteCache = new Map<string, SiteMatchResult>();
  async function getSite(row: ParsedRow): Promise<SiteMatchResult> {
    const cached = siteCache.get(row.vendorCode);
    if (cached) return cached;
    const result = await matchSite(supabase, row);
    siteCache.set(row.vendorCode, result);
    return result;
  }

  const taskResults = await runWithConcurrency(tasks, CONCURRENCY, async ({ row, columnKey }) => {
    const match = await getSite(row);
    if (!match.ok) return reportRow(row, columnKey, 'REVIEW_REQUIRED', match.reason);
    return processOneDocument(supabase, row, columnKey, DOC_COLUMN_TO_TYPE[columnKey], match.site);
  });
  reportRows.push(...taskResults);

  // one review.csv line per unmatched row, not per document
  const alreadyReviewed = new Set(reviewRows.map(r => r.excelRow));
  for (const row of eligible) {
    const match = siteCache.get(row.vendorCode);
    if (match && !match.ok && !alreadyReviewed.has(row.excelRow)) {
      reviewRows.push({ excelRow: row.excelRow, vendorCode: row.vendorCode, vendorName: row.legalName, reason: match.reason, detail: match.detail });
      alreadyReviewed.add(row.excelRow);
    }
  }

  writeReportCsv(REPORT_PATH, reportRows);
  writeReviewCsv(REVIEW_PATH, reviewRows);
  summarize(reportRows, reviewRows);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
