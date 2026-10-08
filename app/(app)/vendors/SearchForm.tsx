'use client';
import { useRouter } from 'next/navigation';
import { INDUSTRIES } from '@/lib/constants';

/** A plain <form> with no onSubmit does a native GET — a full browser
 *  reload, not a Next.js navigation, so nothing client-side (including the
 *  nav-click loader) ever gets a chance to run. This does the same search
 *  through the router instead, so it is a normal SPA transition like every
 *  other link in the app. */
export default function SearchForm({ q, industry, sort }: { q?: string; industry?: string; sort?: string }) {
  const router = useRouter();

  return (
    <form className="flex items-center gap-2 flex-wrap"
          onSubmit={e => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const params = new URLSearchParams();
            const nq = String(fd.get('q') ?? '').trim();
            const nIndustry = String(fd.get('industry') ?? '');
            if (nq) params.set('q', nq);
            if (nIndustry) params.set('industry', nIndustry);
            if (sort) params.set('sort', sort);
            router.push(`/vendors?${params.toString()}`);
          }}>
      <div className="relative w-[300px]">
        <span className="absolute pointer-events-none" style={{ left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--faint)' }}>
          🔍
        </span>
        <input name="q" defaultValue={q ?? ''} placeholder="Search name, GSTIN, vendor code or services"
               style={{ paddingLeft: 36 }} />
      </div>
      <select name="industry" defaultValue={industry ?? ''} className="w-[170px]">
        <option value="">All industries</option>
        {INDUSTRIES.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
      </select>
      <button className="btn btn-o">Search</button>
    </form>
  );
}
