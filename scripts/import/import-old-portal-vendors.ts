/**
 * ONE-OFF: onboards the vendors from the old (pre-GreenFind) vendor-approval
 * spreadsheet that are NOT already in the system (matched by PAN against
 * the live database first). The other 19 rows in that sheet already exist
 * here from the original legacy import — this script does not touch them;
 * see the chat for that separate, still-pending enrichment pass (CTO/EPR
 * documents + a service category for those 19).
 *
 * Source: "Copy of GreenFind_Vendor_Approval_Queue.xlsx", sheet
 * "Vendor Approval Queue". Documents: local files in Downloads named
 * GF<S.No>-<n>_<Vendor>_<Document type>_<original file name>, matched by
 * S.No and the document-type label in the name.
 *
 * Deliberately excluded by design, not oversight:
 * - Aadhaar files are never uploaded as documents (this app never stores a
 *   full Aadhaar number or scan, only last-4 digits, and only when there is
 *   no GSTIN at all — every one of these vendors has a GSTIN).
 * - Three specific files, found by manually reviewing the sheet's own
 *   "Review notes / flags" column against the real local files: a CTO slot
 *   that is an exact duplicate of the EPR file (S.No 3), a cancelled
 *   cheque filed under the wrong vendor entirely (S.No 9), and an Aadhaar
 *   slot that is an exact duplicate of the PAN file (S.No 28). See
 *   SKIP_FILES below.
 *
 *   npm run import:old-portal -- --dry-run
 *   npm run import:old-portal -- --allow-prod
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';
import { readWorkbook } from './lib/excel';

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT, '.env.import');
const EXCEL_PATH = 'C:/Users/HP/Downloads/Copy of GreenFind_Vendor_Approval_Queue.xlsx';
const DOCS_DIR = 'C:/Users/HP/Downloads';
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'old-portal-import-report.csv');
const BUCKET = 'vendor-documents';
const MAX_FILE = 10 * 1024 * 1024;

// S.No of every row NOT already matched to an existing company by PAN
// (confirmed live against the database before writing this script).
const NEW_SNOS = new Set(['2', '3', '4', '9', '11', '12', '19', '25', '28']);

const CATEGORY_CODE_BY_LABEL: Record<string, string> = {
  'Plastic': 'plastic', 'E-waste': 'ewaste', 'Battery': 'battery', 'Used Oil': 'usedoil',
  // No "PET Scrap" category exists — flagged to the user, falls back to
  // the closest real one (PET is a plastic) until/unless a dedicated
  // category is added.
  'PET Scrap': 'plastic', 'PET Scrap, Flex': 'plastic',
};

const DOC_LABEL_TO_TYPE: Record<string, string> = {
  'GST Certificate': 'gst', 'PAN Card': 'pan', 'CTO (Consent to Operate)': 'cto',
  'Cancelled Cheque': 'cheque', 'EPR Authorization': 'epr', 'Udyam Certificate': 'udyam',
  'Signed Agreement': 'nda',
  // 'Aadhaar (Proprietor)' intentionally absent — never uploaded, see above.
};

// Exact local filenames to leave out, found by cross-checking the sheet's
// own "Review notes / flags" column against the real files.
const SKIP_FILES = new Set([
  'GF03-6_Ecovision Environmental Resources LLP_CTO (Consent to Operate)_PWP_Ecovision Surat.pdf',
  'GF09-5_Sunshine PAP Tech Pvt Ltd_Cancelled Cheque_Cheque HDFC Bank Sukraft Recycling Pvt Ltd.pdf',
  'GF28-7_Ms. BOMBAY BARREL SUPPLY COMPANY_Aadhaar (Proprietor)_Rizwan Pan Card .pdf',
]);

// The other 19 rows in the sheet, already in the system from the original
// legacy import — mapped S.No -> their real legacy_vendor_code, so their
// CTO/EPR files (the only document types none of them already have) can be
// attached to the site that already exists, without creating anything new.
const EXISTING_SNO_TO_LEGACY_CODE: Record<string, string> = {
  '1': 'VEN-0100', '5': 'VEN-0152', '6': 'VEN-0134', '7': 'VEN-0119', '8': 'VEN-0061',
  '10': 'VEN-0011', '13': 'VEN-0178', '14': 'VEN-0164', '15': 'VEN-0159', '16': 'VEN-0157',
  '17': 'VEN-0153', '18': 'VEN-0150', '20': 'VEN-0144', '21': 'VEN-0132', '22': 'VEN-0118',
  '23': 'VEN-0117', '24': 'VEN-0101', '26': 'VEN-0102', '27': 'VEN-0103',
};

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

type ReportRow = { sno: string; vendor: string; item: string; status: string; detail: string };
function writeCsv(path: string, rows: ReportRow[]) {
  const header = ['S.No', 'Vendor', 'Item', 'Status', 'Detail'];
  const body = rows.map(r => [r.sno, r.vendor, r.item, r.status, r.detail]);
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
  if (!fs.existsSync(EXCEL_PATH)) fail(`Excel file not found: ${EXCEL_PATH}`);
  if (!fs.existsSync(DOCS_DIR)) fail(`Documents folder not found: ${DOCS_DIR}`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const supabase = createImportAdminClient(env);
  const report: ReportRow[] = [];

  const sheet = await readWorkbook(EXCEL_PATH, 'Vendor Approval Queue');
  const rows = sheet.rows.filter(r => NEW_SNOS.has((r.cells[0] ?? '').trim()));
  console.log(`Matched ${rows.length} of ${NEW_SNOS.size} expected new vendors in the sheet.`);

  const allLocalFiles = fs.readdirSync(DOCS_DIR);

  for (const row of rows) {
    const c = row.cells;
    const sno = c[0]?.trim() ?? '';
    const vendor = c[1]?.trim() ?? '';
    const legalName = c[6]?.trim() || vendor;
    const gstin = (c[8] ?? '').trim().toUpperCase();
    const panTyped = (c[9] ?? '').trim().toUpperCase();
    const categoryLabel = (c[11] ?? '').trim();
    const firmType = (c[12] ?? '').trim();
    const addressLine1 = (c[13] ?? '').trim();
    const city = (c[14] ?? '').trim();
    const state = (c[15] ?? '').trim();
    const pincode = (c[16] ?? '').trim();

    const panFromGstin = gstin.length === 15 ? gstin.slice(2, 12) : '';
    if (!gstin || gstin.length !== 15) {
      report.push({ sno, vendor, item: 'GSTIN', status: 'BLOCKED', detail: `"${gstin}" is not fifteen characters.` });
      continue;
    }
    if (panTyped && panTyped !== panFromGstin) {
      report.push({ sno, vendor, item: 'PAN', status: 'REVIEW', detail: `Sheet PAN "${panTyped}" does not match GSTIN-derived PAN "${panFromGstin}" — used the GSTIN-derived one.` });
    }
    const categoryCode = CATEGORY_CODE_BY_LABEL[categoryLabel];
    if (categoryLabel && !categoryCode) {
      report.push({ sno, vendor, item: 'Category', status: 'REVIEW', detail: `"${categoryLabel}" has no known mapping — left unassigned.` });
    }
    if (categoryLabel.startsWith('PET Scrap')) {
      report.push({ sno, vendor, item: 'Category', status: 'REVIEW', detail: `"${categoryLabel}" mapped to Plastic waste management — no dedicated category exists for PET scrap.` });
    }

    let siteId = '<new-site-id>';

    if (!args.dryRun) {
      const { data: already } = await supabase.from('company').select('id').eq('pan', panFromGstin).is('deleted_at', null).maybeSingle();
      if (already) {
        report.push({ sno, vendor, item: 'Company + site', status: 'SKIPPED_ALREADY_EXISTS', detail: `A company with PAN ${panFromGstin} appeared since this script started — not touching it.` });
        continue;
      }

      const { data: code, error: codeErr } = await supabase.rpc('next_company_code');
      if (codeErr) { report.push({ sno, vendor, item: 'Company + site', status: 'FAILED', detail: codeErr.message }); continue; }

      const { data: company, error: coErr } = await supabase.from('company').insert({
        company_code: code, pan: panFromGstin, legal_name: legalName,
        entity: firmType || null, migrated_from_portal: false,
      }).select('id').single();
      if (coErr) { report.push({ sno, vendor, item: 'Company + site', status: 'FAILED', detail: coErr.message }); continue; }

      const { data: siteCode, error: scErr } = await supabase.rpc('next_site_code', { p_company: company.id });
      if (scErr) { report.push({ sno, vendor, item: 'Company + site', status: 'FAILED', detail: scErr.message }); continue; }

      const { data: site, error: siteErr } = await supabase.from('vendor_site').insert({
        company_id: company.id, site_code: siteCode, gstin, industry: 'recycling',
        address_line1: addressLine1 || null, city: city || null, state: state || null, pincode: pincode || null,
        status: 'pending', migrated_from_portal: false, source: 'old_portal',
      }).select('id').single();
      if (siteErr) {
        await supabase.from('company').delete().eq('id', company.id);
        report.push({ sno, vendor, item: 'Company + site', status: 'FAILED', detail: siteErr.message });
        continue;
      }
      siteId = site.id;
      report.push({ sno, vendor, item: 'Company + site', status: 'CREATED', detail: `${code} / ${siteCode}` });

      if (categoryCode) {
        const { data: cat } = await supabase.from('service_category').select('id').eq('industry', 'recycling').eq('code', categoryCode).single();
        if (cat) await supabase.from('site_service_category').insert({ site_id: siteId, category_id: cat.id });
      }
    } else {
      report.push({ sno, vendor, item: 'Company + site', status: 'WOULD_CREATE', detail: `${legalName} · ${firmType} · ${gstin} · ${city}, ${state} ${pincode} · category=${categoryCode ?? '(none)'}` });
    }

    // --- documents: matched and validated in both modes, only actually
    //     written to storage/the database when not a dry run ---
    const prefix = `GF${sno.padStart(2, '0')}-`;
    const files = allLocalFiles.filter(f => f.startsWith(prefix));
    if (!files.length) {
      report.push({ sno, vendor, item: '(documents)', status: 'REVIEW', detail: `No local files found matching prefix "${prefix}".` });
    }
    for (const fileName of files) {
      if (SKIP_FILES.has(fileName)) {
        report.push({ sno, vendor, item: fileName, status: 'SKIPPED_KNOWN_ISSUE', detail: 'Matches a file flagged in the sheet\'s review notes — see script comments.' });
        continue;
      }
      const m = fileName.match(/^GF\d+-\d+_.*?_([^_]+(?:\s*\([^)]*\))?)_(.+)$/);
      const label = m?.[1] ?? '';
      if (label.startsWith('Aadhaar')) {
        report.push({ sno, vendor, item: fileName, status: 'SKIPPED_AADHAAR', detail: 'Never uploaded as a document in this app.' });
        continue;
      }
      const docType = DOC_LABEL_TO_TYPE[label];
      if (!docType) {
        report.push({ sno, vendor, item: fileName, status: 'REVIEW', detail: `Unrecognised document-type label "${label}" — not uploaded.` });
        continue;
      }

      const fullPath = path.join(DOCS_DIR, fileName);
      if (!fs.existsSync(fullPath)) {
        report.push({ sno, vendor, item: fileName, status: 'FAILED', detail: 'File listed but could not be read (not found at read time).' });
        continue;
      }
      const size = fs.statSync(fullPath).size;
      if (size > MAX_FILE) {
        report.push({ sno, vendor, item: fileName, status: 'FAILED', detail: `${(size / 1048576).toFixed(1)} MB exceeds the 10 MB limit.` });
        continue;
      }
      const ext = (fileName.split('.').pop() ?? '').toLowerCase();
      if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
        report.push({ sno, vendor, item: fileName, status: 'FAILED', detail: `Unsupported file type ".${ext}" — only PDF, JPG and PNG are accepted.` });
        continue;
      }

      if (args.dryRun) {
        report.push({ sno, vendor, item: fileName, status: 'WOULD_UPLOAD', detail: `as ${docType} (${(size / 1024).toFixed(0)} KB)` });
        continue;
      }

      const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg';
      const buf = fs.readFileSync(fullPath);
      const safe = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
      const storagePath = `${siteId}/${docType}/${Date.now()}_${safe}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, buf, { contentType: mime, upsert: false });
      if (upErr) { report.push({ sno, vendor, item: fileName, status: 'FAILED', detail: upErr.message }); continue; }

      const { error: rowErr } = await supabase.from('site_document').insert({
        site_id: siteId, doc_type: docType, storage_path: storagePath,
        file_name: fileName, file_size: buf.length, mime_type: mime,
      });
      if (rowErr) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        report.push({ sno, vendor, item: fileName, status: 'FAILED', detail: rowErr.message });
        continue;
      }
      report.push({ sno, vendor, item: fileName, status: 'UPLOADED', detail: `as ${docType}` });
    }
  }

  // --- phase 2: CTO/EPR only, for the 19 vendors already in the system ---
  for (const [sno, legacyCode] of Object.entries(EXISTING_SNO_TO_LEGACY_CODE)) {
    const row = sheet.rows.find(r => (r.cells[0] ?? '').trim() === sno);
    const vendor = row?.cells[1]?.trim() ?? legacyCode;

    const prefix = `GF${sno.padStart(2, '0')}-`;
    const files = allLocalFiles.filter(f => f.startsWith(prefix) && /CTO \(Consent to Operate\)|EPR Authorization/.test(f));
    if (!files.length) continue; // most of the 19 genuinely have neither — not an error

    const { data: site, error: siteErr } = await supabase
      .from('vendor_site').select('id').eq('legacy_vendor_code', legacyCode).is('deleted_at', null).maybeSingle();
    if (siteErr || !site) {
      report.push({ sno, vendor, item: legacyCode, status: 'FAILED', detail: siteErr?.message ?? 'Existing site not found by legacy_vendor_code.' });
      continue;
    }

    for (const fileName of files) {
      const m = fileName.match(/^GF\d+-\d+_.*?_([^_]+(?:\s*\([^)]*\))?)_(.+)$/);
      const label = m?.[1] ?? '';
      const docType = DOC_LABEL_TO_TYPE[label]; // only ever 'cto' or 'epr' given the filter above

      const { data: existingDoc } = await supabase
        .from('site_document').select('id').eq('site_id', site.id).eq('doc_type', docType).is('superseded_at', null).maybeSingle();
      if (existingDoc) {
        report.push({ sno, vendor, item: fileName, status: 'SKIPPED_ALREADY_HAS_ONE', detail: `${legacyCode} already has a ${docType} document on file.` });
        continue;
      }

      const fullPath = path.join(DOCS_DIR, fileName);
      const size = fs.statSync(fullPath).size;
      const ext = (fileName.split('.').pop() ?? '').toLowerCase();
      if (size > MAX_FILE || !['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
        report.push({ sno, vendor, item: fileName, status: 'FAILED', detail: size > MAX_FILE ? 'Exceeds 10 MB.' : `Unsupported type ".${ext}".` });
        continue;
      }

      if (args.dryRun) {
        report.push({ sno, vendor, item: fileName, status: 'WOULD_UPLOAD', detail: `as ${docType} for existing ${legacyCode}` });
        continue;
      }

      const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg';
      const buf = fs.readFileSync(fullPath);
      const safe = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
      const storagePath = `${site.id}/${docType}/${Date.now()}_${safe}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, buf, { contentType: mime, upsert: false });
      if (upErr) { report.push({ sno, vendor, item: fileName, status: 'FAILED', detail: upErr.message }); continue; }

      const { error: rowErr } = await supabase.from('site_document').insert({
        site_id: site.id, doc_type: docType, storage_path: storagePath,
        file_name: fileName, file_size: buf.length, mime_type: mime,
      });
      if (rowErr) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        report.push({ sno, vendor, item: fileName, status: 'FAILED', detail: rowErr.message });
        continue;
      }
      report.push({ sno, vendor, item: fileName, status: 'UPLOADED', detail: `as ${docType} for existing ${legacyCode}` });
    }
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
