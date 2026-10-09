'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar({ isSuperAdmin }: { isSuperAdmin: boolean }) {
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
          <span className="nav-tab disabled" title="Coming soon">
            RFQs
          </span>
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
        </nav>
      </div>
    </aside>
  );
}
