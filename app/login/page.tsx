import { signIn } from './actions';
import SubmitButton from '@/app/SubmitButton';

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  const Logo = ({ light }: { light?: boolean }) => (
    <div className="flex items-center gap-3">
      <span className="w-9 h-9 rounded-[10px] grid place-items-center shrink-0"
            style={{ background: 'var(--p500)' }}>
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="#fff"
             strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
          <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
        </svg>
      </span>
      <div>
        <div className="text-[18px] font-bold leading-tight" style={{ color: light ? '#fff' : 'var(--head)' }}>
          GreenFind
        </div>
        <div className="text-[9px] font-bold tracking-[.14em]" style={{ color: light ? '#69C6A9' : 'var(--faint)' }}>
          BY FITSOL
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="hidden md:flex flex-col justify-between p-10 lg:p-14"
           style={{ background: 'var(--navy)' }}>
        <Logo light />
        <div className="max-w-[420px]">
          <h2 className="text-[30px] lg:text-[34px] font-bold leading-[1.25] mb-4" style={{ color: '#fff' }}>
            Every vendor, one system.
          </h2>
          <p className="text-[14.5px]" style={{ color: 'rgba(255,255,255,.65)' }}>
            Onboarding, documents, RFQs and delivery — tracked end to end.
          </p>
        </div>
        <div className="text-[12px]" style={{ color: 'rgba(255,255,255,.4)' }}>
          © {new Date().getFullYear()} Fitsol. Internal use only.
        </div>
      </div>

      <div className="grid place-items-center p-5">
        <div className="w-full max-w-[380px]">
          <div className="md:hidden mb-8"><Logo /></div>

          <h1 className="text-[22px] font-bold mb-1">Sign in</h1>
          <p className="text-[13px] mb-6" style={{ color: 'var(--faint)' }}>
            Internal vendor master. Access is by account, not by link.
          </p>

          {error && <div className="note r mb-4">{decodeURIComponent(error)}</div>}

          <form action={signIn} className="space-y-4">
            <div>
              <label className="lab" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div>
              <label className="lab" htmlFor="password">Password</label>
              <input id="password" name="password" type="password" required
                     autoComplete="current-password" />
            </div>
            <SubmitButton className="btn btn-p w-full justify-center" pendingText="Signing in…">
              Continue
            </SubmitButton>
          </form>

          <p className="hint mt-4">
            No account yet? Ask a Super Admin to add you.
          </p>
        </div>
      </div>
    </div>
  );
}
