import { redirect } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import { INDUSTRIES } from '@/lib/constants';

const SOURCE_LABEL: Record<string, string> = {
  import: 'Bulk / legacy import', manual: 'Manual (staff Add Vendor)', public_form: 'Public sign-up form',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'Active', pending: 'Pending', inactive: 'Inactive', blocked: 'Blocked',
};
const INDUSTRY_LABEL: Record<string, string> = Object.fromEntries(INDUSTRIES.map(i => [i.code, i.label]));

type Site = {
  id: string; company_id: string; industry: string | null; status: string; source: string | null;
  docs_attached: number; docs_required: number; is_msme: boolean; msme_category: string | null;
};
type Company = {
  id: string; entity: string | null; year_established: number | null;
  authorised_signatory: string | null; cheque_on_file: boolean; udyam_number: string | null;
};

const pct = (n: number, total: number) => total ? Math.round((n / total) * 100) : 0;

/** Live numbers, pulled fresh on every load — nothing here is a cached
 *  export. Two tiers below the headline figures: gaps the portal already
 *  blocks on, which should be close to zero, and gaps the portal only asks
 *  about without enforcing, which is why these counts are not zero. */
export default async function AnalyticsPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.role !== 'super_admin') redirect('/vendors');
  const supabase = await createClient();

  const { data: sitesRaw, error: sitesErr } = await supabase
    .from('site_summary')
    .select('id, company_id, industry, status, source, docs_attached, docs_required, is_msme, msme_category');
  const sites = (sitesRaw ?? []) as Site[];
  const siteIds = sites.map(s => s.id);
  const companyIds = [...new Set(sites.map(s => s.company_id))];

  const [{ data: companiesRaw }, { data: contactsRaw }, { data: catsRaw }, { data: reqRaw }, { data: docsRaw }] = await Promise.all([
    companyIds.length
      ? supabase.from('company').select('id, entity, year_established, authorised_signatory, cheque_on_file, udyam_number').in('id', companyIds)
      : Promise.resolve({ data: [] as Company[] }),
    siteIds.length
      ? supabase.from('site_contact').select('site_id, rank, designation, email').in('site_id', siteIds).in('rank', [1, 2])
      : Promise.resolve({ data: [] as { site_id: string; rank: number; designation: string | null; email: string | null }[] }),
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
  for (const c of (contactsRaw ?? [])) if (!c.designation || !c.email) contactGapSites.add(c.site_id);

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
  const isDocsComplete = (s: Site) => s.docs_required === 0 || s.docs_attached >= s.docs_required;
  const docsComplete = sites.filter(isDocsComplete).length;

  const byStatus = new Map<string, number>();
  for (const s of sites) byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);

  const bySource = new Map<string, number>();
  for (const s of sites) { const k = s.source ?? 'unknown'; bySource.set(k, (bySource.get(k) ?? 0) + 1); }

  const byIndustry = new Map<string, { total: number; complete: number }>();
  for (const s of sites) {
    const k = s.industry ?? 'Unclassified';
    const row = byIndustry.get(k) ?? { total: 0, complete: 0 };
    row.total++;
    if (isDocsComplete(s)) row.complete++;
    byIndustry.set(k, row);
  }

  let entityBlank = 0, msmeIncomplete = 0, yearBlank = 0, signatoryBlank = 0, chequeFalse = 0;
  for (const s of sites) {
    const c = companyById.get(s.company_id);
    if (!c) continue;
    if (!c.entity) entityBlank++;
    if (s.is_msme && (!s.msme_category || !c.udyam_number)) msmeIncomplete++;
    if (c.year_established === null) yearBlank++;
    if (!c.authorised_signatory) signatoryBlank++;
    if (!c.cheque_on_file) chequeFalse++;
  }
  const zeroCategories = sites.filter(s => !sitesWithCategory.has(s.id)).length;
  const contactGapCount = contactGapSites.size;

  const Metric = ({ label, value, note }: { label: string; value: number | string; note?: string }) => (
    <div className="card p-4">
      <div className="text-[24px] font-bold leading-tight" style={{ color: 'var(--head)' }}>{value}</div>
      <div className="text-[12.5px] font-bold mt-1" style={{ color: 'var(--head)' }}>{label}</div>
      {note && <div className="text-[11.5px] mt-1" style={{ color: 'var(--faint)' }}>{note}</div>}
    </div>
  );

  const Section = ({ title, blurb, children }: { title: string; blurb?: string; children: React.ReactNode }) => (
    <div className="card p-5 mb-5">
      <h2 className="text-[15px] font-bold mb-1">{title}</h2>
      {blurb && <p className="text-[12.5px] mb-4" style={{ color: 'var(--faint)' }}>{blurb}</p>}
      {children}
    </div>
  );

  const Bar = ({ n, total: t }: { n: number; total: number }) => (
    <div className="h-[6px] rounded-full mt-1.5" style={{ background: 'var(--surface-2)' }}>
      <div className="h-full rounded-full" style={{ width: `${pct(n, t)}%`, background: 'var(--p500)' }} />
    </div>
  );

  return (
    <>
      <h1 className="text-[26px] font-bold mt-2 mb-1">Analytics</h1>
      <p className="text-[13.5px] mb-6" style={{ color: 'var(--faint)' }}>
        Vendor onboarding and data-completeness, computed fresh from the database on every load.
      </p>

      {sitesErr && <div className="note r mb-5"><b>Could not read vendor data.</b> {sitesErr.message}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Metric label="Vendors onboarded" value={total} />
        <Metric label="Active" value={byStatus.get('active') ?? 0} note={`${pct(byStatus.get('active') ?? 0, total)}% of total`} />
        <Metric label="Documents complete" value={docsComplete} note={`${pct(docsComplete, total)}% of vendors`} />
        <Metric label="Documents incomplete" value={total - docsComplete} note={`${pct(total - docsComplete, total)}% of vendors`} />
      </div>

      <Section title="Status breakdown">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
            <div key={k}>
              <div className="flex justify-between text-[13px]">
                <span style={{ color: 'var(--head)' }}>{STATUS_LABEL[k] ?? k}</span>
                <span className="font-bold">{n} · {pct(n, total)}%</span>
              </div>
              <Bar n={n} total={total} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Onboarded from">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
            <div key={k}>
              <div className="flex justify-between text-[13px]">
                <span style={{ color: 'var(--head)' }}>{SOURCE_LABEL[k] ?? k}</span>
                <span className="font-bold">{n} · {pct(n, total)}%</span>
              </div>
              <Bar n={n} total={total} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="By industry — document completeness">
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ color: 'var(--faint)' }}>
              <th className="text-left font-bold pb-2">Industry</th>
              <th className="text-right font-bold pb-2">Vendors</th>
              <th className="text-right font-bold pb-2">Docs complete</th>
              <th className="text-right font-bold pb-2">Docs incomplete</th>
              <th className="text-right font-bold pb-2">% complete</th>
            </tr>
          </thead>
          <tbody>
            {[...byIndustry.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, row]) => (
              <tr key={k} className="border-t" style={{ borderColor: 'var(--line)' }}>
                <td className="py-2">{INDUSTRY_LABEL[k] ?? k}</td>
                <td className="py-2 text-right">{row.total}</td>
                <td className="py-2 text-right">{row.complete}</td>
                <td className="py-2 text-right">{row.total - row.complete}</td>
                <td className="py-2 text-right font-bold">{pct(row.complete, row.total)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Missing documents" blurb="Required documents not currently on file, counted across every vendor that needs each one.">
        {missingDocCounts.size === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--faint)' }}>Nothing missing.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {[...missingDocCounts.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => (
              <div key={label}>
                <div className="flex justify-between text-[13px]">
                  <span style={{ color: 'var(--head)' }}>{label}</span>
                  <span className="font-bold">{n} · {pct(n, total)}%</span>
                </div>
                <Bar n={n} total={total} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Required by policy, not yet enforced by the portal"
                blurb="The Vendor Master Form schema calls these mandatory, but the portal does not currently block saving a vendor without them — so counts here will not be zero.">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between text-[13px]"><span>Entity type blank</span><span className="font-bold">{entityBlank} · {pct(entityBlank, total)}%</span></div>
            <Bar n={entityBlank} total={total} />
          </div>
          <div>
            <div className="flex justify-between text-[13px]"><span>MSME, but category/Udyam missing</span><span className="font-bold">{msmeIncomplete} · {pct(msmeIncomplete, total)}%</span></div>
            <Bar n={msmeIncomplete} total={total} />
          </div>
          <div>
            <div className="flex justify-between text-[13px]"><span>Year established blank</span><span className="font-bold">{yearBlank} · {pct(yearBlank, total)}%</span></div>
            <Bar n={yearBlank} total={total} />
          </div>
          <div>
            <div className="flex justify-between text-[13px]"><span>No service category picked</span><span className="font-bold">{zeroCategories} · {pct(zeroCategories, total)}%</span></div>
            <Bar n={zeroCategories} total={total} />
          </div>
          <div>
            <div className="flex justify-between text-[13px]"><span>Primary/secondary contact missing designation or email</span><span className="font-bold">{contactGapCount} · {pct(contactGapCount, total)}%</span></div>
            <Bar n={contactGapCount} total={total} />
          </div>
          <div>
            <div className="flex justify-between text-[13px]"><span>Authorised signatory blank</span><span className="font-bold">{signatoryBlank} · {pct(signatoryBlank, total)}%</span></div>
            <Bar n={signatoryBlank} total={total} />
          </div>
          <div>
            <div className="flex justify-between text-[13px]"><span>Cancelled cheque not marked on file</span><span className="font-bold">{chequeFalse} · {pct(chequeFalse, total)}%</span></div>
            <Bar n={chequeFalse} total={total} />
            <div className="hint mt-1">No screen sets this flag directly — only a bulk import carrying that column can.</div>
          </div>
        </div>
      </Section>

      <Section title="Required by policy, not captured at all"
                blurb="These cannot be counted, because there is nowhere in the portal to enter them yet.">
        <ul className="ml-4 list-disc text-[13px]" style={{ color: 'var(--head)' }}>
          <li>Trade name / brand — the column was removed from the database.</li>
          <li>Geo-tagged image and Site Report (Physical Verification) — scoped, not yet built.</li>
          <li>PAN / Aadhaar of the individual — only asked for Proprietorship; Partnership, LLP and Foreign entities are never asked.</li>
        </ul>
      </Section>
    </>
  );
}
