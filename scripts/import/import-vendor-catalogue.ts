/**
 * ONE-OFF: onboards the 15 vendors marked "Legitimate (New)" in the Vendors
 * sheet of GreenFind_Vendor_Catalogue.xlsx (NOT the older
 * "Copy of GreenFind_Vendor_Approval_Queue.xlsx" — different file, checked
 * directly before writing this). One of the 15 ("Disha Industries Pvt Ltd")
 * turned out to already exist in the system (PAN match against VEN 053) —
 * this script does not touch it, only flags it; see the chat for whether to
 * separately enrich it with its missing documents.
 *
 * Per explicit instruction this run:
 * - vendor_site.status is set to 'active' directly (not 'pending') — there
 *   is no draft/review state in between for this batch.
 * - source is set to 'old_portal' for every row created here, even though
 *   these are not from the legacy portal — a deliberate tagging choice, not
 *   a mistake.
 * - Data-quality flags (the Vendors sheet's own column E) are recorded only
 *   in this script's CSV log, not anywhere in the database — there is no
 *   notes/remarks column on company or vendor_site to put them in.
 *
 * Source: GreenFind_Vendor_Catalogue.xlsx, sheets "Vendors" (vendor fields,
 * column C = Classification) and "Documents" (one row per file, with CTO/
 * EPR_AUTH expiry dates). Documents: local files in Downloads named
 * "<Vendor (portal name)> - <DOC_TYPE> - <original file name>", matched by
 * the exact file name the Documents sheet itself records.
 *
 * Deliberately excluded by design:
 * - AADHAR files are never uploaded (no doc_type for Aadhaar in this app —
 *   same rule as every other import this session).
 *
 *   npm run import:catalogue -- --dry-run
 *   npm run import:catalogue -- --allow-prod
 */
import path from 'node:path';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT, '.env.import');
const EXCEL_PATH = 'C:/Users/HP/Downloads/GreenFind_Vendor_Catalogue.xlsx';
const DOCS_DIR = 'C:/Users/HP/Downloads';
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const DETAIL_OUTPUT_PATH = path.join(OUTPUT_DIR, 'vendor-catalogue-import-detail.csv');
const SUMMARY_OUTPUT_PATH = path.join(OUTPUT_DIR, 'vendor-catalogue-import-summary.csv');
const BUCKET = 'vendor-documents';
const MAX_FILE = 10 * 1024 * 1024;

const DOC_LABEL_TO_TYPE: Record<string, string> = {
  GST: 'gst', PAN: 'pan', CANCELLED_CHEQUE: 'cheque', EPR_AUTH: 'epr',
  CTO: 'cto', UDYAM_CERT: 'udyam', 'Signed Agreement': 'nda',
  // AADHAR intentionally absent — never uploaded, see file header.
};
const EXPIRY_DOC_TYPES = new Set(['cto', 'epr']);

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

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v && typeof v === 'object' && 'hyperlink' in (v as Record<string, unknown>)) {
    return String((v as { text?: unknown }).text ?? '').trim();
  }
  if (v && typeof v === 'object' && 'result' in (v as Record<string, unknown>)) {
    return String((v as { result?: unknown }).result ?? '').trim();
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').trim();
}

function readSheetRows(ws: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = cellText(cell); });
    if (cells.some(c => c)) rows.push(cells);
  });
  return rows;
}

function writeCsv(path: string, header: string[], rows: string[][]) {
  const bom = String.fromCharCode(0xfeff);
  const csv = bom + [header, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
  fs.writeFileSync(path, csv);
}

type DetailRow = { vendor: string; item: string; status: string; detail: string };

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
  if (!fs.existsSync(EXCEL_PATH)) fail(`Excel file not found: ${EXCEL_PATH}`);
  if (!fs.existsSync(DOCS_DIR)) fail(`Documents folder not found: ${DOCS_DIR}`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const supabase = createImportAdminClient(env);
  const detail: DetailRow[] = [];

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);
  const vendorsWs = wb.getWorksheet('Vendors');
  const docsWs = wb.getWorksheet('Documents');
  if (!vendorsWs) fail('No "Vendors" sheet in the workbook.');
  if (!docsWs) fail('No "Documents" sheet in the workbook.');

  const vendorRows = readSheetRows(vendorsWs).filter(r => (r[2] ?? '').trim() === 'Legitimate (New)');
  const docRows = readSheetRows(docsWs);
  console.log(`${vendorRows.length} vendors classified "Legitimate (New)".`);

  const allLocalFiles = fs.readdirSync(DOCS_DIR);

  for (const r of vendorRows) {
    const portalName = (r[1] ?? '').trim();
    const flags = (r[4] ?? '').trim();
    const legalNameCol = (r[9] ?? '').trim();
    const firmType = (r[11] ?? '').trim();
    const gstin = (r[12] ?? '').trim().toUpperCase();
    const panTyped = (r[13] ?? '').trim().toUpperCase();
    const registeredAddress = (r[19] ?? '').trim();
    const cityStatePin = (r[20] ?? '').trim();

    const issues: string[] = [];
    if (flags) issues.push(flags);

    let legalName = legalNameCol;
    if (!legalName) {
      legalName = portalName;
      issues.push(`Legal name blank in source — used vendor's portal/brand name "${portalName}".`);
    }

    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(gstin)) {
      detail.push({ vendor: portalName, item: 'profile', status: 'BLOCKED', detail: `GSTIN "${gstin}" is not a valid format.` });
      continue;
    }
    const panFromGstin = gstin.slice(2, 12);
    if (panTyped && panTyped !== panFromGstin) {
      issues.push(`Sheet PAN "${panTyped}" does not match GSTIN-derived PAN "${panFromGstin}" — used the GSTIN-derived one.`);
    }

    const emdashIdx = cityStatePin.indexOf('—');
    const pincode = emdashIdx >= 0 ? cityStatePin.slice(emdashIdx + 1).trim() : '';
    const cityState = emdashIdx >= 0 ? cityStatePin.slice(0, emdashIdx) : cityStatePin;
    const commaIdx = cityState.indexOf(',');
    const city = (commaIdx >= 0 ? cityState.slice(0, commaIdx) : cityState).trim();
    const state = (commaIdx >= 0 ? cityState.slice(commaIdx + 1) : '').trim();
    if (!registeredAddress || !city || !state || !pincode) {
      issues.push(`Address incomplete after parsing (address="${registeredAddress}", city="${city}", state="${state}", pincode="${pincode}").`);
    }

    let siteId = '<new-site-id>';
    let profileCreated: 'Y' | 'N' | 'SKIPPED_EXISTS' = 'N';

    const { data: already } = await supabase.from('company').select('id, company_code').eq('pan', panFromGstin).is('deleted_at', null).maybeSingle();
    if (already) {
      detail.push({ vendor: portalName, item: 'profile', status: 'SKIPPED_ALREADY_EXISTS', detail: `PAN ${panFromGstin} already belongs to ${already.company_code}. Not touched.` });
      issues.push(`Already exists as ${already.company_code} — not created, not enriched.`);
      writeVendorSummary(portalName, 'SKIPPED_EXISTS', 0, 0, flags, issues);
      continue;
    }

    if (!args.dryRun) {
      const { data: code, error: codeErr } = await supabase.rpc('next_company_code');
      if (codeErr) { detail.push({ vendor: portalName, item: 'profile', status: 'FAILED', detail: codeErr.message }); writeVendorSummary(portalName, 'N', 0, 0, flags, [...issues, codeErr.message]); continue; }

      const { data: company, error: coErr } = await supabase.from('company').insert({
        company_code: code, pan: panFromGstin, legal_name: legalName,
        entity: firmType || null, migrated_from_portal: false,
      }).select('id').single();
      if (coErr) { detail.push({ vendor: portalName, item: 'profile', status: 'FAILED', detail: coErr.message }); writeVendorSummary(portalName, 'N', 0, 0, flags, [...issues, coErr.message]); continue; }

      const { data: siteCode, error: scErr } = await supabase.rpc('next_site_code', { p_company: company.id });
      if (scErr) { detail.push({ vendor: portalName, item: 'profile', status: 'FAILED', detail: scErr.message }); writeVendorSummary(portalName, 'N', 0, 0, flags, [...issues, scErr.message]); continue; }

      const { data: site, error: siteErr } = await supabase.from('vendor_site').insert({
        company_id: company.id, site_code: siteCode, gstin, industry: 'recycling',
        address_line1: registeredAddress || null, city: city || null, state: state || null, pincode: pincode || null,
        status: 'active', migrated_from_portal: false, source: 'old_portal',
      }).select('id').single();
      if (siteErr) {
        await supabase.from('company').delete().eq('id', company.id);
        detail.push({ vendor: portalName, item: 'profile', status: 'FAILED', detail: siteErr.message });
        writeVendorSummary(portalName, 'N', 0, 0, flags, [...issues, siteErr.message]);
        continue;
      }
      siteId = site.id;
      profileCreated = 'Y';
      detail.push({ vendor: portalName, item: 'profile', status: 'CREATED', detail: `${code} / ${siteCode}` });
    } else {
      detail.push({ vendor: portalName, item: 'profile', status: 'WOULD_CREATE', detail: `${legalName} · ${firmType} · ${gstin} · ${city}, ${state} ${pincode}` });
    }

    // --- documents for this vendor, from the Documents sheet's own rows ---
    const docsForVendor = docRows.filter(d => (d[0] ?? '').trim() === portalName);
    let uploaded = 0;
    const totalExpected = docsForVendor.length;

    for (const d of docsForVendor) {
      const docTypeLabel = (d[3] ?? '').trim();
      const fileName = (d[5] ?? '').trim();
      const expiry = (d[7] ?? '').trim();

      if (docTypeLabel === 'AADHAR') {
        detail.push({ vendor: portalName, item: fileName, status: 'SKIPPED_AADHAAR', detail: 'Never uploaded as a document in this app.' });
        continue;
      }
      const docType = DOC_LABEL_TO_TYPE[docTypeLabel];
      if (!docType) {
        detail.push({ vendor: portalName, item: fileName, status: 'REVIEW', detail: `Unrecognised document type "${docTypeLabel}" — not uploaded.` });
        issues.push(`Unrecognised document type "${docTypeLabel}" for file "${fileName}".`);
        continue;
      }

      let expectedFileName = `${portalName} - ${docTypeLabel} - ${fileName}`;
      let realFileName = fileName;
      if (!allLocalFiles.includes(expectedFileName)) {
        // The Documents sheet's recorded file name doesn't always match what
        // actually got saved to disk (e.g. Starsun's EPR row names an
        // encoded blob, but the real file was saved with a plain name) —
        // fall back to a prefix match and use it only if exactly one file
        // qualifies, so an ambiguous case still fails loudly instead of
        // silently grabbing the wrong file.
        const prefix = `${portalName} - ${docTypeLabel} - `;
        const candidates = allLocalFiles.filter(f => f.startsWith(prefix));
        if (candidates.length === 1) {
          issues.push(`Documents sheet names "${fileName}" for this file, but the file actually on disk is "${candidates[0]}" — used the file on disk.`);
          expectedFileName = candidates[0];
          realFileName = candidates[0].slice(prefix.length);
        } else {
          detail.push({ vendor: portalName, item: expectedFileName, status: 'FAILED', detail: candidates.length ? `Sheet names "${fileName}", and ${candidates.length} candidate files match the prefix — ambiguous, not uploaded.` : 'Expected local file not found.' });
          issues.push(`Missing local file: "${expectedFileName}".`);
          continue;
        }
      }
      const fullPath = path.join(DOCS_DIR, expectedFileName);
      const size = fs.statSync(fullPath).size;
      if (size > MAX_FILE) {
        detail.push({ vendor: portalName, item: expectedFileName, status: 'FAILED', detail: `${(size / 1048576).toFixed(1)} MB exceeds the 10 MB limit.` });
        continue;
      }
      const ext = (realFileName.split('.').pop() ?? '').toLowerCase();
      if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
        detail.push({ vendor: portalName, item: expectedFileName, status: 'FAILED', detail: `Unsupported file type ".${ext}".` });
        continue;
      }

      if (args.dryRun) {
        detail.push({ vendor: portalName, item: expectedFileName, status: 'WOULD_UPLOAD', detail: `as ${docType}${EXPIRY_DOC_TYPES.has(docType) && expiry ? `, expiry ${expiry}` : ''}` });
        uploaded++;
        continue;
      }

      const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg';
      const buf = fs.readFileSync(fullPath);
      const safe = expectedFileName.replace(/[^A-Za-z0-9._-]/g, '_');
      const storagePath = `${siteId}/${docType}/${Date.now()}_${safe}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, buf, { contentType: mime, upsert: false });
      if (upErr) { detail.push({ vendor: portalName, item: expectedFileName, status: 'FAILED', detail: upErr.message }); continue; }

      const { error: rowErr } = await supabase.from('site_document').insert({
        site_id: siteId, doc_type: docType, storage_path: storagePath,
        file_name: realFileName, file_size: buf.length, mime_type: mime,
        valid_until: EXPIRY_DOC_TYPES.has(docType) && expiry ? expiry : null,
      });
      if (rowErr) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        detail.push({ vendor: portalName, item: expectedFileName, status: 'FAILED', detail: rowErr.message });
        continue;
      }
      uploaded++;
      detail.push({ vendor: portalName, item: expectedFileName, status: 'UPLOADED', detail: `as ${docType}${EXPIRY_DOC_TYPES.has(docType) && expiry ? `, expiry ${expiry}` : ''}` });
    }

    writeVendorSummary(portalName, args.dryRun ? 'Y (dry-run)' : profileCreated, uploaded, totalExpected, flags, issues);
  }

  writeCsv(DETAIL_OUTPUT_PATH, ['Vendor', 'Item', 'Status', 'Detail'], detail.map(r => [r.vendor, r.item, r.status, r.detail]));
  writeCsv(SUMMARY_OUTPUT_PATH, ['Vendor', 'Profile Created (Y/N)', 'Docs Uploaded', 'Data-Quality Flags', 'Issues'], summaryRows);

  const byStatus: Record<string, number> = {};
  for (const r of detail) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log('\nDone.');
  for (const [status, n] of Object.entries(byStatus)) console.log(`  ${String(n).padStart(4)}  ${status}`);
  console.log(`\nDetail:  ${DETAIL_OUTPUT_PATH}`);
  console.log(`Summary: ${SUMMARY_OUTPUT_PATH}`);
}

const summaryRows: string[][] = [];
function writeVendorSummary(vendor: string, profileCreated: string, uploaded: number, total: number, flags: string, issues: string[]) {
  summaryRows.push([vendor, profileCreated, `${uploaded} of ${total}`, flags, issues.join(' | ')]);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
