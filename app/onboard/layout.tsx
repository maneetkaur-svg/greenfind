/** Deliberately outside app/(app) — no auth check, no sidebar, no header
 *  with a user chip or sign-out, nothing that hints at the dashboard or
 *  vendor list existing. A visitor who fills this in sees only this page,
 *  never anything else in the app. */
export default function OnboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <header className="border-b" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
        <div className="max-w-[760px] mx-auto px-5 py-4 flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-[9px] grid place-items-center" style={{ background: 'var(--p500)' }}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#fff"
                 strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
              <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
            </svg>
          </span>
          <span>
            <span className="block text-[17px] font-bold leading-tight" style={{ color: 'var(--head)' }}>GreenFind</span>
            <span className="block text-[9px] font-bold tracking-[.14em]" style={{ color: 'var(--faint)' }}>BY FITSOL</span>
          </span>
        </div>
      </header>
      <main className="max-w-[760px] mx-auto px-5 py-8 pb-20">{children}</main>
    </div>
  );
}
