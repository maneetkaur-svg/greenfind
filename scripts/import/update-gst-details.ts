/**
 * ONE-OFF: fills in company identity + site address fields from a GST
 * certificate extract (ULIP API output) keyed by GSTIN.
 *
 * Column mapping, as given:
 *   Constitution of Business        -> company.entity
 *   Legal Name                      -> company.legal_name
 *   Trade Name                      -> company.trade_name (restored by
 *                                      sql/33_restore_trade_name.sql, run
 *                                      that first — it was dropped by
 *                                      sql/11_drop_trade_name.sql, then
 *                                      asked for again)
 *   Date of Liability (year only)   -> company.year_established
 *   Principal Place of Business     -> vendor_site.address_line1 (whole
 *                                      string, kept readable) plus
 *                                      vendor_site.state (derived from the
 *                                      GSTIN itself, not parsed text — far
 *                                      more reliable) and .pincode (the
 *                                      trailing 6-digit number). city is
 *                                      left alone: GST addresses don't
 *                                      separate city from district/taluk
 *                                      cleanly enough to guess at safely.
 *
 * Only rows the file itself marked Status=SUCCESS are used. A GSTIN that
 * does not match any vendor_site on record is reported, never guessed at.
 * entity values with no matching entity_type (e.g. "Hindu Undivided
 * Family") are reported and left alone rather than forced into the
 * nearest-sounding option.
 *
 *   npm run import:gst-details -- --dry-run
 *   npm run import:gst-details -- --allow-prod
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';
import { RX, stateFromGstin } from '../../lib/constants';

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(ROOT, 'scripts', 'import', 'input', 'vendor-gst-details.csv');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'gst-details-update-report.csv');
const ENV_PATH = path.join(ROOT, '.env.import');

type Args = { dryRun: boolean; allowProd: boolean; input: string };

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, allowProd: false, input: DEFAULT_INPUT };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run') a.dryRun = true;
    else if (t === '--allow-prod') a.allowProd = true;
    else if (t === '--input') a.input = path.resolve(argv[++i]);
  }
  return a;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** Quote-aware CSV parser — good enough for this one shape, no dependency
 *  needed for a file this size. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const ENTITY_MAP: Record<string, string> = {
  'proprietorship': 'proprietorship',
  'partnership': 'partnership',
  'limited liability partnership': 'llp',
  'private limited company': 'pvt_ltd',
  'public limited company': 'public_ltd',
  'society/ club/ trust/ aop': 'trust',
  'opc': 'pvt_ltd', // closest legal structure this schema has (sql/27_proprietor_and_plant_fields.sql)
};

/** "27/01/2021" -> 2021. Anything that does not parse as DD/MM/YYYY is left out. */
function yearFromDateOfLiability(s: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? Number(m[3]) : null;
}

type ReportRow = {
  gstin: string; siteId: string; companyId: string; status: string; detail: string;
};

function writeCsv(filePath: string, rows: ReportRow[]) {
  const header = ['GSTIN', 'Site ID', 'Company ID', 'Status', 'Detail'];
  const body = rows.map(r => [r.gstin, r.siteId, r.companyId, r.status, r.detail]);
  const bom = String.fromCharCode(0xfeff);
  const csv = bom + [header, ...body].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
  fs.writeFileSync(filePath, csv);
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

  const text = fs.readFileSync(args.input, 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(text);
  const header = rows[0].map(h => h.trim());
  const col = (name: string) => header.indexOf(name);
  const idx = {
    gstin: col('GSTIN'), trade: col('Trade Name'), legal: col('Legal Name'),
    entity: col('Constitution of Business'), address: col('Principal Place of Business Address'),
    liability: col('Date of Liability'), status: col('Status'),
  };
  for (const [k, v] of Object.entries(idx)) if (v < 0) fail(`Column not found in the file: ${k}`);

  const data = rows.slice(1).map(r => ({
    gstin: (r[idx.gstin] ?? '').trim().toUpperCase(),
    trade: (r[idx.trade] ?? '').trim(),
    legal: (r[idx.legal] ?? '').trim(),
    entityRaw: (r[idx.entity] ?? '').trim(),
    address: (r[idx.address] ?? '').trim(),
    liability: (r[idx.liability] ?? '').trim(),
    status: (r[idx.status] ?? '').trim(),
  }));

  const usable = data.filter(d => d.status === 'SUCCESS' && RX.gstin.test(d.gstin));
  console.log(`${data.length} row(s) in the file, ${usable.length} usable (Status=SUCCESS, valid GSTIN).`);

  const report: ReportRow[] = [];

  for (const d of usable) {
    const { data: site, error: siteErr } = await supabase
      .from('vendor_site').select('id, company_id, company:company(cin)')
      .eq('gstin', d.gstin).is('deleted_at', null).maybeSingle();
    if (siteErr) {
      report.push({ gstin: d.gstin, siteId: '', companyId: '', status: 'FAILED', detail: siteErr.message });
      continue;
    }
    if (!site) {
      report.push({ gstin: d.gstin, siteId: '', companyId: '', status: 'NOT_FOUND', detail: 'No vendor_site on record with this GSTIN.' });
      continue;
    }
    const existingCin = (Array.isArray(site.company) ? site.company[0] : site.company)?.cin as string | null | undefined;

    const entity = d.entityRaw ? ENTITY_MAP[d.entityRaw.toLowerCase()] : undefined;
    if (d.entityRaw && !entity) {
      report.push({ gstin: d.gstin, siteId: site.id, companyId: site.company_id, status: 'NO_ENTITY_MAPPING',
        detail: `"${d.entityRaw}" has no matching entity type in this app — left alone.` });
      continue;
    }
    // The database refuses pvt_ltd/public_ltd/llp without a CIN on file, and
    // this file never supplies one — setting entity here would just fail
    // the whole company update, so skip only that one field and say so.
    const entityNeedsCin = entity === 'pvt_ltd' || entity === 'public_ltd' || entity === 'llp';
    const entitySkipped = entityNeedsCin && !existingCin;

    const year = d.liability ? yearFromDateOfLiability(d.liability) : null;
    const state = stateFromGstin(d.gstin);
    const pincodeMatch = /(\d{6})\D*$/.exec(d.address);
    const pincode = pincodeMatch ? pincodeMatch[1] : null;

    const companyBody: Record<string, unknown> = {};
    if (d.legal) companyBody.legal_name = d.legal;
    if (d.trade) companyBody.trade_name = d.trade;
    if (entity && !entitySkipped) companyBody.entity = entity;
    if (year) companyBody.year_established = year;

    const siteBody: Record<string, unknown> = {};
    if (d.address) siteBody.address_line1 = d.address;
    if (state) siteBody.state = state;
    if (pincode) siteBody.pincode = pincode;

    if (args.dryRun) {
      report.push({
        gstin: d.gstin, siteId: site.id, companyId: site.company_id, status: 'WOULD_UPDATE',
        detail: `company: ${JSON.stringify(companyBody)} · site: ${JSON.stringify(siteBody)}`
          + (entitySkipped ? ` · entity would stay as-is — "${entity}" needs a CIN this company doesn't have on file.` : ''),
      });
      continue;
    }

    if (Object.keys(companyBody).length) {
      const { error: compErr } = await supabase.from('company').update(companyBody).eq('id', site.company_id);
      if (compErr) {
        report.push({ gstin: d.gstin, siteId: site.id, companyId: site.company_id, status: 'FAILED', detail: `company update: ${compErr.message}` });
        continue;
      }
    }
    if (Object.keys(siteBody).length) {
      const { error: siteUpdErr } = await supabase.from('vendor_site').update(siteBody).eq('id', site.id);
      if (siteUpdErr) {
        report.push({ gstin: d.gstin, siteId: site.id, companyId: site.company_id, status: 'FAILED', detail: `site update: ${siteUpdErr.message}` });
        continue;
      }
    }
    report.push({
      gstin: d.gstin, siteId: site.id, companyId: site.company_id, status: 'UPDATED',
      detail: entitySkipped ? `Entity left as-is — would be "${entity}" but the company has no CIN on file yet.` : '',
    });
  }

  writeCsv(OUTPUT_PATH, report);

  const byStatus: Record<string, number> = {};
  for (const r of report) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log('\nDone.');
  for (const [status, n] of Object.entries(byStatus).sort()) console.log(`  ${String(n).padStart(5)}  ${status}`);
  console.log(`\nFull detail in ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
