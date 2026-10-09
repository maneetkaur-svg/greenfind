import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getMe } from '@/lib/supabase/server';
import { signOut } from '@/app/login/actions';
import { ROLE_LABEL } from '@/lib/constants';
import { DEV_AUTH_BYPASS } from '@/lib/devAuth';
import DevBanner from './DevBanner';
import Sidebar from './Sidebar';
import NavProgress from './NavProgress';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login');

  return (
    <div className="min-h-screen">
      <NavProgress />
      <DevBanner />
      <header className="sticky top-0 z-30 border-b"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
        <div className="max-w-[1240px] mx-auto px-5 py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <Link href="/vendors" className="flex items-center gap-2.5 justify-self-start">
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

          <span className="text-[17px] font-bold justify-self-center" style={{ color: 'var(--muted)' }}>
            Vendor Management Tool
          </span>

          <div className="flex items-center gap-3 justify-self-end">
            <span className="chip c-n">{me.full_name} · {ROLE_LABEL[me.role]}</span>
            {!DEV_AUTH_BYPASS && (
              <form action={signOut}>
                <button className="text-[13px] font-semibold" style={{ color: 'var(--faint)' }}>
                  Sign out
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-[1240px] mx-auto px-5 flex gap-6">
        <Sidebar isSuperAdmin={me.role === 'super_admin'} />
        <main className="flex-1 min-w-0 py-6 pb-20">{children}</main>
      </div>
    </div>
  );
}
