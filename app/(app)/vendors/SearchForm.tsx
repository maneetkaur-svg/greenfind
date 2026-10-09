'use client';
import { useRouter } from 'next/navigation';
import { INDUSTRIES, STATES } from '@/lib/constants';

/** A plain <form> with no onSubmit does a native GET — a full browser
 *  reload, not a Next.js navigation, so nothing client-side (including the
 *  nav-click loader) ever gets a chance to run. This does the same search
 *  through the router instead, so it is a normal SPA transition like every
 *  other link in the app. Industry is a checkbox group (not a single
 *  <select>) so more than one can be picked at once — recycling and
 *  packaging both selected shows both. */
export default function SearchForm({
  q, industries, state, sort,
}: { q?: string; industries: string[]; state?: string; sort?: string }) {
  const router = useRouter();

  const label = industries.length === 0 ? 'All industries'
    : industries.length === 1
      ? (industries[0] === 'unclassified' ? 'Others' : INDUSTRIES.find(i => i.code === industries[0])?.label ?? industries[0])
      : `${industries.length} industries`;

  return (
    <form className="flex items-center gap-2 flex-wrap"
          onSubmit={e => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const params = new URLSearchParams();
            const nq = String(fd.get('q') ?? '').trim();
            const nIndustries = fd.getAll('industry').map(String);
            const nState = String(fd.get('state') ?? '');
            if (nq) params.set('q', nq);
            if (nIndustries.length) params.set('industry', nIndustries.join(','));
            if (nState) params.set('state', nState);
            if (sort) params.set('sort', sort);
            window.dispatchEvent(new Event('app:navigating'));
            router.push(`/vendors?${params.toString()}`);
          }}>
      <div className="relative w-[220px]">
        <span className="absolute pointer-events-none" style={{ left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--faint)' }}>
          🔍
        </span>
        <input name="q" defaultValue={q ?? ''} placeholder="Search vendors…" style={{ paddingLeft: 32 }} />
      </div>

      <details className="relative">
        <summary className="btn btn-o" style={{ listStyle: 'none', cursor: 'pointer' }}>{label} ▾</summary>
        <div className="absolute z-10 mt-2 card p-3" style={{ minWidth: 190 }}>
          {INDUSTRIES.map(i => (
            <label key={i.code} className="flex items-center gap-2 py-1 text-[13px]" style={{ cursor: 'pointer' }}>
              <input type="checkbox" name="industry" value={i.code} defaultChecked={industries.includes(i.code)} />
              {i.label}
            </label>
          ))}
          <label className="flex items-center gap-2 py-1 text-[13px]" style={{ cursor: 'pointer' }}>
            <input type="checkbox" name="industry" value="unclassified" defaultChecked={industries.includes('unclassified')} />
            Others
          </label>
        </div>
      </details>

      <select name="state" defaultValue={state ?? ''} className="w-[140px]">
        <option value="">All states</option>
        {STATES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <button className="btn btn-o">Search</button>
    </form>
  );
}
