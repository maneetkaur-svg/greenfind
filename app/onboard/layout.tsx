/** Deliberately outside app/(app) — no auth check, no sidebar, no header
 *  with a user chip or sign-out, nothing that hints at the dashboard or
 *  vendor list existing. A visitor who fills this in sees only this page,
 *  never anything else in the app. */
export default function OnboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <header className="border-b" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
        <div className="max-w-[760px] mx-auto px-5 py-4 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fitsol-logo.svg" alt="Fitsol" className="h-7 w-auto" />
          <span className="h-6 w-px" style={{ background: 'var(--line)' }} />
          <span>
            <span className="block text-[17px] font-bold leading-tight" style={{ color: 'var(--head)' }}>GreenFind</span>
            <span className="block text-[9px] font-bold tracking-[.14em]" style={{ color: 'var(--faint)' }}>VENDOR SIGN-UP</span>
          </span>
        </div>
      </header>
      <main className="max-w-[760px] mx-auto px-5 py-8 pb-20">{children}</main>
    </div>
  );
}
