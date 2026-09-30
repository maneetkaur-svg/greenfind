import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getMe, DEMO_MODE } from '@/lib/supabase/server';
import { signOut } from '@/app/login/actions';
import { ROLE_LABEL } from '@/lib/constants';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login');

  return (
    <div className="min-h-screen">
      {DEMO_MODE && (
        <div style={{ background: 'var(--warn-l)', color: 'var(--warn-d)',
                      borderBottom: '1px solid rgba(234,179,8,.4)', fontSize: 12.5 }}>
          <div className="max-w-[1240px] mx-auto px-5 py-1.5">
            <b>DEMO MODE</b> — the login is switched off and everyone is a Super Admin.
            Turn it off before any real vendor data goes in.
          </div>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
        <div className="max-w-[1240px] mx-auto px-5 py-3 flex items-center gap-4 flex-wrap">
          <Link href="/vendors" className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-[9px] grid place-items-center"
                  style={{ background: 'var(--p500)' }}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#fff"
                   strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
                <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
              </svg>
            </span>
            <span>
              <span className="block text-[17px] font-bold leading-tight"
                    style={{ color: 'var(--head)' }}>GreenFind</span>
              <span className="block text-[9px] font-bold tracking-[.14em]"
                    style={{ color: 'var(--faint)' }}>BY FITSOL</span>
            </span>
          </Link>

          <nav className="flex gap-1 ml-4">
            <Link href="/vendors" className="text-[13.5px] font-semibold px-3 py-2 rounded-lg"
                  style={{ color: 'var(--muted)' }}>Vendors</Link>
            {me.role === 'super_admin' && (
              <Link href="/users" className="text-[13.5px] font-semibold px-3 py-2 rounded-lg"
                    style={{ color: 'var(--muted)' }}>Users</Link>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="chip c-n">{me.full_name} · {ROLE_LABEL[me.role]}</span>
            {!DEMO_MODE && (
              <form action={signOut}>
                <button className="text-[13px] font-semibold" style={{ color: 'var(--faint)' }}>
                  Sign out
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1240px] mx-auto px-5 py-6 pb-20">{children}</main>
    </div>
  );
}
