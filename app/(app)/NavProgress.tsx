'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

const MAX_VEIL_MS = 1500;

/** The veil+spinner from loading.tsx, but triggered on the click itself
 *  rather than on Next's Suspense fallback. Next prefetches every visible
 *  link automatically, so by the time a click actually happens the data is
 *  usually already in hand — loading.tsx then has nothing left to cover and
 *  never shows. This shows on every internal link click — even one back to
 *  the page already on screen — and clears once the URL this component sees
 *  has actually changed (the new page has rendered), or after MAX_VEIL_MS
 *  regardless, so a click that never navigates anywhere does not leave it
 *  on screen forever. */
function Veil() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, setNavigating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    setNavigating(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNavigating(false), MAX_VEIL_MS);
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement)?.closest?.('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      show();
    };
    // NOT a blanket 'submit' listener: almost every form in this app (Save
    // identity, document uploads, contacts, geography…) is a server action
    // that re-renders in place and never changes the URL, so clearing on a
    // URL change would never fire for those — the MAX_VEIL_MS floor above
    // is what keeps this safe for them, not a guard against showing it at
    // all. Only a form that actually intends to navigate (SearchForm, for
    // instance) opts in by dispatching this itself.
    const onNavigating = () => show();
    document.addEventListener('click', onClick);
    window.addEventListener('app:navigating', onNavigating);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('app:navigating', onNavigating);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // The URL this component sees only changes once the new route has
  // actually rendered — that is what turns the veil back off early.
  useEffect(() => {
    setNavigating(false);
    if (timer.current) clearTimeout(timer.current);
  }, [pathname, searchParams]);

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
