/** Shown automatically by Next.js while a page within (app) is navigating
 *  to and its server data is still loading — a translucent veil over the
 *  previous screen with a spinner, for every link (sidebar, a vendor row,
 *  "+ Add vendor", anywhere), with no per-link wiring needed. */
export default function Loading() {
  return (
    <div className="nav-loading-veil" role="status" aria-live="polite">
      <span className="spinner-lg" aria-hidden="true" />
      <span className="label">Loading…</span>
    </div>
  );
}
