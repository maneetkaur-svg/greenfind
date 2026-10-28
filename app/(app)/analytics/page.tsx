import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import { INDUSTRIES } from '@/lib/constants';
import { vendorTier, TIER_LABEL, type VendorTier } from '@/lib/vendorTier';
import PocSearch from './PocSearch';

const SOURCE_LABEL: Record<string, string> = {
  import: 'Bulk / legacy import', manual: 'Manual (staff Add Vendor)', public_form: 'Public sign-up form',
  public_form_full: 'Public complete onboarding form', old_portal: 'Old GreenFind Portal',
};
const SOURCE_SHORT: Record<string, string> = {
  import: 'Import', manual: 'Internal', public_form: 'Quick sign-up',
  public_form_full: 'Complete onboarding', old_portal: 'Old portal',
};
const INDUSTRY_LABEL: Record<string, string> = Object.fromEntries(INDUSTRIES.map(i => [i.code, i.label]));
const INDUSTRY_ICON: Record<string, string> = {
  recycling: '♻️', transportation: '🚚', packaging: '📦', warehouse: '🏭', scrap_trading: '🔩',
};
// The same solid tier colors used for chips (TIER_CHIP_CLASS) elsewhere in
// the app — c-a (amber), c-n (grey), c-g (green) — just as a bar fill rather
// than a pale chip background, so a vendor's status reads the same color
// wherever it shows up.
const TIER_FILL: Record<VendorTier, string> = { onboarded: 'var(--warn)', unverified: 'var(--line-2)', verified: 'var(--p500)' };
const TIER_ICON: Record<VendorTier, string> = { onboarded: '◐', unverified: '◑', verified: '●' };

type Site = {
  id: string; company_id: string; industry: string | null; source: string | null;
  docs_attached: number; docs_required: number; is_msme: boolean; msme_category: string | null;
  core_complete: boolean; banking_complete: boolean;
};
type Company = {
  id: string; entity: string | null; year_established: number | null;
  authorised_signatory: string | null; cheque_on_file: boolean; udyam_number: string | null;
  trade_name: string | null;
};

const pct = (n: number, total: number) => total ? Math.round((n / total) * 100) : 0;

/** Live numbers, pulled fresh on every load. Vendor status is the Onboarded /
 *  Unverified / Verified tier (see vendor_status_schema.xlsx and
 *  sql/50_vendor_tier_schema.sql). One screen, tile-first: the headline
 *  tiles and every industry/source tile are themselves the filter controls
 *  (click one the same way the vendor list's dashboard tiles work) — the
 *  dropdowns above exist for the cases a tile can't cover (Source needs its
 *  own control too since there are more values than fit as tiles cleanly,
 *  and POC is free-text search). Document/data-quality detail that would
 *  otherwise make this scroll lives in one collapsed panel at the bottom. */
export default async function AnalyticsPage({
  searchParams,
}: { searchParams: Promise<{ industry?: string; source?: string; tier?: string; poc?: string }> }) {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.role !== 'super_admin') redirect('/vendors');
  const supabase = await createClient();

  const { industry: industryParam, source: sourceParam, tier: tierParam, poc } = await searchParams;
  const industries = (industryParam ?? '').split(',').filter(Boolean);
  const realIndustries = industries.filter(i => i !== 'unclassified');
  const wantsUnclassified = industries.includes('unclassified');
  const sources = (sourceParam ?? '').split(',').filter(Boolean);
  const tiers = (tierParam ?? '').split(',').filter(Boolean) as VendorTier[];
  const pocNeedle = (poc ?? '').trim().toLowerCase();

  let sitesQuery = supabase
    .from('site_summary')
    .select('id, company_id, industry, source, docs_attached, docs_required, is_msme, msme_category, core_complete, banking_complete');
  if (industries.length) {
    if (wantsUnclassified && realIndustries.length)
      sitesQuery = sitesQuery.or(`industry.is.null,industry.in.(${realIndustries.join(',')})`);
    else if (wantsUnclassified) sitesQuery = sitesQuery.is('industry', null);
    else sitesQuery = sitesQuery.in('industry', realIndustries);
  }
  if (sources.length) sitesQuery = sitesQuery.in('source', sources);
  const { data: sitesRaw, error: sitesErr } = await sitesQuery;
  let sites = (sitesRaw ?? []) as Site[];
  if (tiers.length) sites = sites.filter(s => tiers.includes(vendorTier(s.core_complete, s.banking_complete)));

  const siteIds = sites.map(s => s.id);
  const companyIds = [...new Set(sites.map(s => s.company_id))];

  const [{ data: companiesRaw }, { data: contactsRaw }, { data: catsRaw }, { data: reqRaw }, { data: docsRaw }] = await Promise.all([
    companyIds.length
      ? supabase.from('company').select('id, entity, year_established, authorised_signatory, cheque_on_file, udyam_number, trade_name').in('id', companyIds)
      : Promise.resolve({ data: [] as Company[] }),
    siteIds.length
      ? supabase.from('site_contact').select('site_id, rank, name, designation, email').in('site_id', siteIds).in('rank', [1, 2])
      : Promise.resolve({ data: [] as { site_id: string; rank: number; name: string | null; designation: string | null; email: string | null }[] }),
    siteIds.length
      ? supabase.from('site_service_category').select('site_id').in('site_id', siteIds)
      : Promise.resolve({ data: [] as { site_id: string }[] }),
    supabase.from('document_requirement')
      .select('doc_type, industry, level, document_type:doc_type(label, uploaded_by_party)'),
    siteIds.length
      ? supabase.from('site_document').select('site_id, doc_type').is('superseded_at', null).in('site_id', siteIds)
      : Promise.resolve({ data: [] as { site_id: string; doc_type: string }[] }),
  ]);

  const companyById = new Map((companiesRaw ?? []).map(c => [c.id, c as Company]));

  const contactGapSites = new Set<string>();
  const primaryContactName = new Map<string, string>();
  for (const c of (contactsRaw ?? [])) {
    if (!c.designation || !c.email) contactGapSites.add(c.site_id);
    if (c.rank === 1 && c.name) primaryContactName.set(c.site_id, c.name);
  }

  if (pocNeedle) {
    sites = sites.filter(s => (primaryContactName.get(s.id) ?? '').toLowerCase().includes(pocNeedle));
  }

  const sitesWithCategory = new Set((catsRaw ?? []).map(c => c.site_id));

  type ReqRow = { doc_type: string; industry: string; level: string;
                  document_type: { label: string; uploaded_by_party: string } | { label: string; uploaded_by_party: string }[] | null };
  const one = <T,>(v: T | T[] | null): T | null => Array.isArray(v) ? (v[0] ?? null) : v;
  const reqByIndustry = new Map<string, { code: string; label: string }[]>();
  for (const r of (reqRaw ?? []) as ReqRow[]) {
    const dt = one(r.document_type);
    if (r.level !== 'required' || dt?.uploaded_by_party !== 'vendor') continue;
    const list = reqByIndustry.get(r.industry) ?? [];
    list.push({ code: r.doc_type, label: dt.label });
    reqByIndustry.set(r.industry, list);
  }
  const attachedBySite = new Map<string, Set<string>>();
  for (const d of (docsRaw ?? [])) {
    const set = attachedBySite.get(d.site_id) ?? new Set<string>();
    set.add(d.doc_type);
    attachedBySite.set(d.site_id, set);
  }
  const missingDocCounts = new Map<string, number>();
  for (const s of sites) {
    const required = reqByIndustry.get(s.industry ?? '') ?? [];
    const attached = attachedBySite.get(s.id) ?? new Set<string>();
    for (const r of required) if (!attached.has(r.code)) missingDocCounts.set(r.label, (missingDocCounts.get(r.label) ?? 0) + 1);
  }

  const total = sites.length;

  const byTier = new Map<VendorTier, number>([['onboarded', 0], ['unverified', 0], ['verified', 0]]);
  for (const s of sites) {
    const t = vendorTier(s.core_complete, s.banking_complete);
    byTier.set(t, (byTier.get(t) ?? 0) + 1);
  }

  const bySource = new Map<string, number>();
  for (const s of sites) { const k = s.source ?? 'unknown'; bySource.set(k, (bySource.get(k) ?? 0) + 1); }

  const byIndustryTier = new Map<string, Record<VendorTier, number> & { total: number }>();
  for (const s of sites) {
    const k = s.industry ?? 'unclassified';
    const row = byIndustryTier.get(k) ?? { onboarded: 0, unverified: 0, verified: 0, total: 0 };
    row[vendorTier(s.core_complete, s.banking_complete)]++;
    row.total++;
    byIndustryTier.set(k, row);
  }
  // Every fixed industry shows even at zero, same reasoning as the vendor
  // list's own dashboard (DashboardCard.tsx) — a brand-new industry with
  // nothing in it yet is a real zero, not a missing tile.
  const industryOrder = [...INDUSTRIES.map(i => i.code), 'unclassified'];

  let entityBlank = 0, msmeIncomplete = 0, yearBlank = 0, signatoryBlank = 0, chequeFalse = 0, tradeNameBlank = 0;
  for (const s of sites) {
    const c = companyById.get(s.company_id);
    if (!c) continue;
    if (!c.entity) entityBlank++;
    if (s.is_msme && (!s.msme_category || !c.udyam_number)) msmeIncomplete++;
    if (c.year_established === null) yearBlank++;
    if (!c.authorised_signatory) signatoryBlank++;
    if (!c.cheque_on_file) chequeFalse++;
    if (!c.trade_name) tradeNameBlank++;
  }
  const zeroCategories = sites.filter(s => !sitesWithCategory.has(s.id)).length;
  const contactGapCount = sites.filter(s => contactGapSites.has(s.id)).length;

  // Every tile below toggles one value into (or out of) its own filter array,
  // carrying the other three filters over unchanged — same convention as
  // the vendor list's dashboard tiles (vendors/DashboardCard.tsx).
  const hrefFor = (next: { industry?: string[]; source?: string[]; tier?: string[] }) => {
    const params = new URLSearchParams();
    const i = next.industry ?? industries;
    const s = next.source ?? sources;
    const t = next.tier ?? tiers;
    if (i.length) params.set('industry', i.join(','));
    if (s.length) params.set('source', s.join(','));
    if (t.length) params.set('tier', t.join(','));
    if (poc) params.set('poc', poc);
    const qs = params.toString();
    return qs ? `/analytics?${qs}` : '/analytics';
  };
  const toggleTier = (t: VendorTier) =>
    hrefFor({ tier: tiers.includes(t) ? tiers.filter(x => x !== t) : [...tiers, t] });
  const toggleIndustry = (code: string) =>
    hrefFor({ industry: industries.includes(code) ? industries.filter(x => x !== code) : [...industries, code] });
  const toggleSource = (code: string) =>
    hrefFor({ source: sources.includes(code) ? sources.filter(x => x !== code) : [...sources, code] });

  const StackBar = ({ row }: { row: Record<VendorTier, number> & { total: number } }) => (
    <div className="flex gap-[2px] h-[7px] rounded-full overflow-hidden mt-2" style={{ background: 'var(--surface-2)' }}>
      {(['onboarded', 'unverified', 'verified'] as VendorTier[]).map(t => row[t] > 0 && (
        <div key={t} style={{ width: `${pct(row[t], row.total)}%`, background: TIER_FILL[t] }} title={`${TIER_LABEL[t]}: ${row[t]}`} />
      ))}
    </div>
  );

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-[24px] font-bold mt-1 mb-0.5">Analytics</h1>
          <p className="text-[13px]" style={{ color: 'var(--faint)' }}>
            Vendor onboarding status, computed fresh from the database. Click any tile below
            to filter by industry, source or status — search by contact name here.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PocSearch value={poc} industry={industryParam} source={sourceParam} tier={tierParam} />
          {(industries.length > 0 || sources.length > 0 || tiers.length > 0 || !!poc) && (
            <Link href="/analytics" className="text-[12.5px] font-semibold" style={{ color: 'var(--faint)' }}>
              Clear all
            </Link>
          )}
        </div>
      </div>

      {sitesErr && <div className="note r mb-4"><b>Could not read vendor data.</b> {sitesErr.message}</div>}

      {/* Headline — the four numbers that matter most, each a filter toggle. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="card metric-box p-4">
          <div className="flex items-center gap-3">
            <span className="icon-circle icon-green">🏢</span>
            <div className="text-[28px] font-bold leading-tight">{total}</div>
          </div>
          <div className="text-[13px] font-bold mt-2" style={{ color: 'var(--head)' }}>Total Vendors</div>
        </div>
        {(['onboarded', 'unverified', 'verified'] as VendorTier[]).map(t => {
          const on = tiers.includes(t);
          const n = byTier.get(t) ?? 0;
          return (
            <Link key={t} href={toggleTier(t)}
                  className={`card metric-box p-4 block ${on ? 'metric-box-selected' : ''}`}
                  title={`${n} ${TIER_LABEL[t].toLowerCase()} · ${pct(n, total)}% — click to ${on ? 'remove from' : 'add to'} the filter`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="icon-circle" style={{ background: 'var(--surface-2)', color: TIER_FILL[t], fontSize: 20 }}>
                    {TIER_ICON[t]}
                  </span>
                  <div className="text-[28px] font-bold leading-tight">{n}</div>
                </div>
                <span className="text-[12px] font-bold" style={{ color: 'var(--faint)' }}>{pct(n, total)}%</span>
              </div>
              <div className="text-[13px] font-bold mt-2" style={{ color: 'var(--head)' }}>{TIER_LABEL[t]}</div>
            </Link>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 mb-4">
        {/* By industry — one tile each, a status bar standing in for the table. */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-[13px] font-bold" style={{ color: 'var(--head)' }}>By industry</h2>
            <div className="flex items-center gap-3 text-[11px] font-semibold" style={{ color: 'var(--faint)' }}>
              <span className="flex items-center gap-1.5"><span style={{ width: 8, height: 8, borderRadius: 2, background: TIER_FILL.onboarded, display: 'inline-block' }} />Onboarded</span>
              <span className="flex items-center gap-1.5"><span style={{ width: 8, height: 8, borderRadius: 2, background: TIER_FILL.unverified, display: 'inline-block' }} />Unverified</span>
              <span className="flex items-center gap-1.5"><span style={{ width: 8, height: 8, borderRadius: 2, background: TIER_FILL.verified, display: 'inline-block' }} />Verified</span>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {industryOrder.map(code => {
              const row = byIndustryTier.get(code) ?? { onboarded: 0, unverified: 0, verified: 0, total: 0 };
              const on = industries.includes(code);
              const label = code === 'unclassified' ? 'Others' : INDUSTRY_LABEL[code] ?? code;
              return (
                <Link key={code} href={toggleIndustry(code)}
                      className={`card metric-box p-3 block ${on ? 'metric-box-selected' : ''}`}
                      title={`${row.total} vendors — click to ${on ? 'remove from' : 'add to'} the filter`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--head)' }}>
                      <span>{code === 'unclassified' ? '•••' : INDUSTRY_ICON[code]}</span>{label}
                    </span>
                    <span className="text-[16px] font-bold">{row.total}</span>
                  </div>
                  <StackBar row={row} />
                </Link>
              );
            })}
          </div>
        </div>

        {/* By source — narrower column alongside, same tile pattern. */}
        <div className="card p-4">
          <h2 className="text-[13px] font-bold mb-3" style={{ color: 'var(--head)' }}>Onboarded from</h2>
          <div className="flex flex-col gap-2">
            {[...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => {
              const on = sources.includes(k);
              return (
                <Link key={k} href={toggleSource(k)}
                      className={`card metric-box p-3 block ${on ? 'metric-box-selected' : ''}`}
                      title={`${SOURCE_LABEL[k] ?? k} — click to ${on ? 'remove from' : 'add to'} the filter`}>
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="font-bold" style={{ color: 'var(--head)' }}>{SOURCE_SHORT[k] ?? k}</span>
                    <span className="font-bold">{n} <span style={{ color: 'var(--faint)', fontWeight: 600 }}>· {pct(n, total)}%</span></span>
                  </div>
                  <div className="h-[6px] rounded-full mt-2" style={{ background: 'var(--surface-2)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct(n, total)}%`, background: 'var(--p500)' }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Data-quality gaps — collapsed by default so the dashboard above is
          the whole view; the detail is one click away, not pre-scrolled. */}
      <details className="card p-4">
        <summary className="text-[13px] font-bold cursor-pointer" style={{ color: 'var(--head)', listStyle: 'none' }}>
          Data quality details — missing documents and policy gaps
          {missingDocCounts.size > 0 && <span className="chip c-a ml-2">{missingDocCounts.size} doc type{missingDocCounts.size === 1 ? '' : 's'} with gaps</span>}
        </summary>

        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
          <h3 className="text-[12px] font-bold uppercase tracking-[.06em] mb-3" style={{ color: 'var(--faint)' }}>
            Missing documents <span className="font-normal normal-case">— required, not currently on file</span>
          </h3>
          {missingDocCounts.size === 0 ? (
            <p className="text-[13px] mb-4" style={{ color: 'var(--faint)' }}>Nothing missing.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
              {[...missingDocCounts.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => (
                <div key={label} className="card p-3">
                  <div className="flex justify-between text-[13px]">
                    <span style={{ color: 'var(--head)' }}>{label}</span>
                    <span className="font-bold">{n} · {pct(n, total)}%</span>
                  </div>
                  <div className="h-[6px] rounded-full mt-2" style={{ background: 'var(--surface-2)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct(n, total)}%`, background: 'var(--warn)' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <h3 className="text-[12px] font-bold uppercase tracking-[.06em] mb-1" style={{ color: 'var(--faint)' }}>
            Required by policy, not yet enforced by the portal
          </h3>
          <p className="text-[12px] mb-3" style={{ color: 'var(--faint)' }}>
            The Vendor Master Form schema calls these mandatory, but the portal does not currently
            block saving a vendor without them — so counts here will not be zero.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            {[
              ['Trade / brand name blank', tradeNameBlank],
              ['Entity type blank', entityBlank],
              ['MSME, but category/Udyam missing', msmeIncomplete],
              ['Year established blank', yearBlank],
              ['No service category picked', zeroCategories],
              ['Contact missing designation or email', contactGapCount],
              ['Authorised signatory blank', signatoryBlank],
              ['Cancelled cheque not marked on file', chequeFalse],
            ].map(([label, n]) => (
              <div key={label as string} className="card p-3">
                <div className="text-[13px]" style={{ color: 'var(--head)' }}>{label}</div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-[17px] font-bold">{n as number}</span>
                  <span className="text-[11.5px] font-bold" style={{ color: 'var(--faint)' }}>{pct(n as number, total)}%</span>
                </div>
              </div>
            ))}
          </div>

          <h3 className="text-[12px] font-bold uppercase tracking-[.06em] mb-2" style={{ color: 'var(--faint)' }}>
            Required by policy, not captured at all
          </h3>
          <ul className="ml-4 list-disc text-[13px]" style={{ color: 'var(--head)' }}>
            <li>Geo-tagged image and Site Report (Physical Verification) — scoped, not yet built.</li>
            <li>PAN / Aadhaar of the individual — only asked for Proprietorship; Partnership, LLP and Foreign entities are never asked.</li>
          </ul>
        </div>
      </details>
    </>
  );
}
