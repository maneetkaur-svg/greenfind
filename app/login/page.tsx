import { signIn } from './actions';

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <div className="min-h-screen grid place-items-center p-5">
      <div className="card w-full max-w-[400px] p-7">
        <div className="flex items-center gap-3 mb-6">
          <span className="w-9 h-9 rounded-[10px] grid place-items-center"
                style={{ background: 'var(--p500)' }}>
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="#fff"
                 strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
              <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
            </svg>
          </span>
          <div>
            <div className="text-[18px] font-bold leading-tight"
                 style={{ color: 'var(--head)' }}>GreenFind</div>
            <div className="text-[9px] font-bold tracking-[.14em]"
                 style={{ color: 'var(--faint)' }}>BY FITSOL</div>
          </div>
        </div>

        <h1 className="text-[19px] font-bold mb-1">Sign in</h1>
        <p className="text-[13px] mb-5" style={{ color: 'var(--faint)' }}>
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
          <button className="btn btn-p w-full justify-center" type="submit">Continue</button>
        </form>

        <p className="hint mt-4">
          No account? A Super Admin creates one in Supabase and adds your profile row.
        </p>
      </div>
    </div>
  );
}
