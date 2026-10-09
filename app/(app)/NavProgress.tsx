'use client';
import { Suspense, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/** The veil+spinner from loading.tsx, but triggered on the click itself
 *  rather than on Next's Suspense fallback. Next prefetches every visible
 *  link automatically, so by the time a click actually happens the data is
 *  usually already in hand — loading.tsx then has nothing left to cover and
 *  never shows. This shows the instant any internal link is clicked, and
 *  clears once the URL this component sees has actually changed, i.e. the
 *  new page has rendered. */
function Veil() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement)?.closest?.('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      const current = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '');
      if (href === current) return;
      setNavigating(true);
    };
    // NOT a blanket 'submit' listener: almost every form in this app (Save
    // identity, document uploads, contacts, geography…) is a server action
    // that re-renders in place and never changes the URL — this veil would
    // show on submit and then never clear, since clearing depends entirely
    // on the URL changing. Only a form that actually intends to navigate
    // (SearchForm, for instance) opts in by dispatching this itself.
    const onNavigating = () => setNavigating(true);
    document.addEventListener('click', onClick);
    window.addEventListener('app:navigating', onNavigating);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('app:navigating', onNavigating);
    };
  }, [pathname, searchParams]);

  // The URL this component sees only changes once the new route has
  // actually rendered — that is what turns the veil back off.
  useEffect(() => { setNavigating(false); }, [pathname, searchParams]);

  if (!navigating) return null;
  return (
    <div className="nav-loading-veil" role="status" aria-live="polite">
      <span className="spinner-lg" aria-hidden="true" />
      <span className="label">Loading…</span>
    </div>
  );
}

export default function NavProgress() {
  return (
    <Suspense fallback={null}>
      <Veil />
    </Suspense>
  );
}
