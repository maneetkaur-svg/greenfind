import { redirect } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import { ACTIVITY_LOG_EMAIL } from '@/lib/constants';
import { istDateKey } from '@/lib/format';

const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pct = (n: number, total: number) => total ? Math.round((n / total) * 100) : 0;
const dayKey = istDateKey;
/** `key` is already a YYYY-MM-DD IST calendar day — format it for display
 *  without parsing it back through Date/timeZone, which would re-apply a
 *  (now redundant, possibly conflicting) zone conversion. */
const formatDayKey = (key: string) => {
  const [, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

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

/** Visible to Maneet only (same gate as /activity). Everything here is
 *  computed fresh from existing logs — nothing is a scheduled report or a
 *  cached export. */
export default async function AdoptionPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.email?.toLowerCase() !== ACTIVITY_LOG_EMAIL) redirect('/vendors');

  const supabase = await createClient();
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString();
  const todayKey = istDateKey(now);

  const [
    { data: loginsRaw, error: loginErr },
    { data: onboardVisitsRaw, error: onboardVisitErr },
    { data: wizardVisitsRaw, error: wizardVisitErr },
    { data: sitesRaw, error: sitesErr },
    { data: docSitesRaw },
  ] = await Promise.all([
    supabase.from('login_log').select('profile_id, logged_in_at').gte('logged_in_at', since30),
    supabase.from('onboard_visit').select('visited_at').gte('visited_at', since30),
    supabase.from('wizard_visit').select('visited_at').gte('visited_at', since30),
    supabase.from('vendor_site').select('source, created_at').is('deleted_at', null).gte('created_at', since30),
    supabase.from('site_summary').select('docs_attached, docs_required'),
  ]);

  const logins = (loginsRaw ?? []) as { profile_id: string; logged_in_at: string }[];
  const onboardVisits = (onboardVisitsRaw ?? []) as { visited_at: string }[];
  const wizardVisits = (wizardVisitsRaw ?? []) as { visited_at: string }[];
  const sites = (sitesRaw ?? []) as { source: string | null; created_at: string }[];
  const docSites = (docSitesRaw ?? []) as { docs_attached: number; docs_required: number }[];

  const dau = new Set(logins.filter(l => dayKey(l.logged_in_at) === todayKey).map(l => l.profile_id)).size;
  const mau = new Set(logins.map(l => l.profile_id)).size;

  const publicVisits30 = onboardVisits.length;
  const publicSubmits30 = sites.filter(s => s.source === 'public_form').length;
  const wizardOpens30 = wizardVisits.length;
  const manualSubmits30 = sites.filter(s => s.source === 'manual').length;

  const totalDocs = docSites.length;
  const docsComplete = docSites.filter(s => s.docs_required === 0 || s.docs_attached >= s.docs_required).length;

  // Last 14 days, one row per day, oldest first.
  const days: { date: string; dau: number; onboardVisits: number; wizardOpens: number; publicSubmits: number; manualSubmits: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY);
    const key = istDateKey(d);
    days.push({
      date: key,
      dau: new Set(logins.filter(l => dayKey(l.logged_in_at) === key).map(l => l.profile_id)).size,
      onboardVisits: onboardVisits.filter(v => dayKey(v.visited_at) === key).length,
      wizardOpens: wizardVisits.filter(v => dayKey(v.visited_at) === key).length,
      publicSubmits: sites.filter(s => s.source === 'public_form' && dayKey(s.created_at) === key).length,
      manualSubmits: sites.filter(s => s.source === 'manual' && dayKey(s.created_at) === key).length,
    });
  }

  return (
    <>
      <h1 className="text-[26px] font-bold mt-2 mb-1">Adoption & Usage</h1>
      <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
        Visible to you only. Computed fresh from existing logs on every load — nothing here is a scheduled report.
      </p>

      {(loginErr || onboardVisitErr || wizardVisitErr || sitesErr) && (
        <div className="note r mb-5">
          <b>Some of this could not be loaded.</b>{' '}
          {loginErr?.message} {onboardVisitErr?.message} {wizardVisitErr?.message} {sitesErr?.message}
          <div className="hint mt-2">
            If this says a relation does not exist, sql/44_adoption_usage.sql has not been run.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Metric label="Daily active staff (today)" value={dau} />
        <Metric label="Monthly active staff" value={mau} note="Distinct sign-ins, last 30 days" />
        <Metric label="Vendors with docs complete" value={docsComplete} note={`${pct(docsComplete, totalDocs)}% of ${totalDocs} total`} />
        <Metric label="Vendors with docs incomplete" value={totalDocs - docsComplete} note={`${pct(totalDocs - docsComplete, totalDocs)}% of ${totalDocs} total`} />
      </div>

      <Section title="Public sign-up form — opened vs. submitted"
                blurb="Last 30 days. An 'open' is anyone loading the public link, not just vendors who go on to submit.">
        <div className="grid sm:grid-cols-3 gap-4">
          <Metric label="Form opened" value={publicVisits30} />
          <Metric label="Submitted" value={publicSubmits30} />
          <Metric label="Conversion rate" value={`${pct(publicSubmits30, publicVisits30)}%`}
                  note={publicVisits30 === 0 ? 'No opens recorded yet' : undefined} />
        </div>
      </Section>

      <Section title="Add Vendor wizard — opened vs. created"
                blurb="Last 30 days. Same idea, for staff creating a vendor directly. Counting only started once this was added — early numbers will look low until more history builds up.">
        <div className="grid sm:grid-cols-3 gap-4">
          <Metric label="Wizard opened" value={wizardOpens30} />
          <Metric label="Vendor created" value={manualSubmits30} />
          <Metric label="Conversion rate" value={`${pct(manualSubmits30, wizardOpens30)}%`}
                  note={wizardOpens30 === 0 ? 'No opens recorded yet' : undefined} />
        </div>
      </Section>

      <Section title="Last 14 days">
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ color: 'var(--faint)' }}>
              <th className="text-left font-bold pb-2">Date</th>
              <th className="text-right font-bold pb-2">Active staff</th>
              <th className="text-right font-bold pb-2">Sign-up form opens</th>
              <th className="text-right font-bold pb-2">Sign-up submits</th>
              <th className="text-right font-bold pb-2">Wizard opens</th>
              <th className="text-right font-bold pb-2">Vendors created (Internal)</th>
            </tr>
          </thead>
          <tbody>
            {days.map(d => (
              <tr key={d.date} className="border-t" style={{ borderColor: 'var(--line)' }}>
                <td className="py-2">{formatDayKey(d.date)}</td>
                <td className="py-2 text-right">{d.dau}</td>
                <td className="py-2 text-right">{d.onboardVisits}</td>
                <td className="py-2 text-right">{d.publicSubmits}</td>
                <td className="py-2 text-right">{d.wizardOpens}</td>
                <td className="py-2 text-right">{d.manualSubmits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Not covered here"
                blurb="Left out of this version deliberately, rather than shown with made-up numbers.">
        <ul className="ml-4 list-disc text-[13px]" style={{ color: 'var(--head)' }}>
          <li>Page load times, API error rates, uptime%, crash-free sessions — infrastructure metrics a dedicated tool (Vercel Analytics/Speed Insights, Sentry) measures properly; nothing in this app currently tracks them.</li>
          <li>Session length and per-feature click-through — would need tracking every page view/click across the app, which nothing here does today.</li>
          <li>Time-to-value (how long a vendor takes to go from created to fully verified) — there is a current status snapshot, but no record of when a vendor&apos;s status actually changed, so a real duration can&apos;t be computed yet.</li>
        </ul>
      </Section>
    </>
  );
}
