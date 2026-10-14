'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar({ isSuperAdmin, showActivity }: { isSuperAdmin: boolean; showActivity: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <aside className="w-[200px] shrink-0 hidden md:block"
           style={{ minHeight: 'calc(100vh - 73px)' }}>
      <div className="sidebar-pane h-full">
        <nav className="sticky top-[73px] flex flex-col gap-1 p-3">
          <Link href="/vendors" className={`nav-tab ${isActive('/vendors') ? 'active' : ''}`}>
            Vendors
          </Link>
          <Link href="/rfqs" className={`nav-tab ${isActive('/rfqs') ? 'active' : ''}`}>
            RFQs
          </Link>
          <span className="nav-tab disabled" title="Coming soon">
            Vendor Evaluation
          </span>
          <span className="nav-tab disabled" title="Coming soon">
            Analytics
          </span>
          {isSuperAdmin && (
            <Link href="/users" className={`nav-tab ${isActive('/users') ? 'active' : ''}`}>
              Users
            </Link>
          )}
          {showActivity && (
            <Link href="/activity" className={`nav-tab ${isActive('/activity') ? 'active' : ''}`}>
              Activity
            </Link>
          )}
          <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
            <Link href="/onboard" target="_blank" rel="noopener noreferrer"
                  className="nav-tab" style={{ fontSize: 12.5 }}>
              Vendor sign-up link ↗
            </Link>
          </div>
        </nav>
      </div>
    </aside>
  );
}
