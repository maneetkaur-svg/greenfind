/**
 * ONE-OFF: fills in vendor_site.city for the bulk-imported ("import"
 * source) vendors that have never had one — the legacy sheet never had a
 * separate city column (sql/06_data_fit.sql made city nullable for exactly
 * this reason), so the city sits only inside the free-text address.
 *
 * These addresses were themselves machine-generated (GST/ULIP-style) in a
 * very consistent shape:
 *   <building/street/locality...>, <City>, <District>, <State>, <Pincode>
 * — comma-separated, pincode last, state second-to-last, district third,
 * city fourth. Verified by hand against ~30 real rows before writing this.
 *
 * Only ever fills a BLANK city. Never touches a row that already has one,
 * and never guesses when the tail doesn't look like this shape (wrong
 * token count, or the state position doesn't match a real Indian state) —
 * those are reported as NEEDS_REVIEW, not forced.
 *
 *   npm run backfill:city -- --dry-run
 *   npm run backfill:city -- --allow-prod
 */
import path from 'node:path';
import fs from 'node:fs';
import { loadImportEnv, assertNotProd, ImportEnvError } from './lib/env';
import { createImportAdminClient } from './lib/supabaseAdmin';
import { STATES } from '../../lib/constants';

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'scripts', 'import', 'output');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'city-backfill-report.csv');
const ENV_PATH = path.join(__dirname, '..', '..', '.env.import');

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

const STATE_SET = new Set(STATES.map(s => s.toLowerCase()));

/** "GHAZIABAD" / "new delhi" -> "Ghaziabad" / "New Delhi". Leaves anything
 *  already mixed-case alone — only normalises all-caps or all-lower. */
function tidyCase(s: string): string {
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function extractCity(address: string, siteState: string | null): { city: string; status: 'WOULD_UPDATE' } | { status: 'NEEDS_REVIEW'; reason: string } {
  const tokens = address.split(',').map(t => t.trim()).filter(Boolean);
  if (tokens.length < 4) return { status: 'NEEDS_REVIEW', reason: `Only ${tokens.length} usable comma-separated segment(s) — too few to locate a city.` };

  const pincode = tokens[tokens.length - 1];
  const stateToken = tokens[tokens.length - 2];
  const cityToken = tokens[tokens.length - 4];

  if (!/^\d{6}$/.test(pincode)) return { status: 'NEEDS_REVIEW', reason: `Last segment "${pincode}" doesn't look like a pincode.` };
  if (!STATE_SET.has(stateToken.toLowerCase()))
    return { status: 'NEEDS_REVIEW', reason: `Second-to-last segment "${stateToken}" doesn't match a known state.` };
  if (siteState && stateToken.toLowerCase() !== siteState.toLowerCase())
    return { status: 'NEEDS_REVIEW', reason: `Address says "${stateToken}" but the record's state is "${siteState}".` };
  if (!cityToken || /^\d+$/.test(cityToken))
    return { status: 'NEEDS_REVIEW', reason: `Fourth-from-last segment "${cityToken}" doesn't look like a city.` };

  return { city: tidyCase(cityToken), status: 'WOULD_UPDATE' };
}

type ReportRow = { siteCode: string; siteId: string; address: string; status: string; detail: string };
function writeCsv(filePath: string, rows: ReportRow[]) {
  const header = ['Site Code', 'Site ID', 'Address', 'Status', 'Detail'];
  const body = rows.map(r => [r.siteCode, r.siteId, r.address, r.status, r.detail]);
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

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const supabase = createImportAdminClient(env);

  const { data: sites, error } = await supabase
    .from('vendor_site').select('id, site_code, address_line1, state')
    .is('deleted_at', null).is('city', null);
  if (error) fail(`Could not read vendor_site: ${error.message}`);

  console.log(`${sites?.length ?? 0} site(s) currently have a blank city.`);

  const report: ReportRow[] = [];
  for (const s of sites ?? []) {
    if (!s.address_line1) {
      report.push({ siteCode: s.site_code, siteId: s.id, address: '', status: 'NEEDS_REVIEW', detail: 'No address on file to extract a city from.' });
      continue;
    }
    const result = extractCity(s.address_line1, s.state);
    if (result.status === 'NEEDS_REVIEW') {
      report.push({ siteCode: s.site_code, siteId: s.id, address: s.address_line1, status: 'NEEDS_REVIEW', detail: result.reason });
      continue;
    }
    if (args.dryRun) {
      report.push({ siteCode: s.site_code, siteId: s.id, address: s.address_line1, status: 'WOULD_UPDATE', detail: `city would be set to "${result.city}"` });
      continue;
    }
    const { error: updErr } = await supabase.from('vendor_site').update({ city: result.city }).eq('id', s.id);
    report.push(updErr
      ? { siteCode: s.site_code, siteId: s.id, address: s.address_line1, status: 'FAILED', detail: updErr.message }
      : { siteCode: s.site_code, siteId: s.id, address: s.address_line1, status: 'UPDATED', detail: `city set to "${result.city}"` });
  }

  writeCsv(OUTPUT_PATH, report);
  const byStatus: Record<string, number> = {};
  for (const r of report) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log('\nDone.');
  for (const [status, n] of Object.entries(byStatus).sort()) console.log(`  ${String(n).padStart(5)}  ${status}`);
  console.log(`\nFull detail in ${OUTPUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
