'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function RfqsNav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const tabs = [
    { href: '/rfqs/requirements', label: 'Requirements' },
    { href: '/rfqs/orders', label: 'Order Journey' },
  ];

  return (
    <div className="flex gap-1 flex-wrap mb-5 pb-3 border-b" style={{ borderColor: 'var(--line)' }}>
      {tabs.map(t => (
        <Link key={t.href} href={t.href} className="text-[13.5px] font-semibold px-3 py-2 rounded-lg"
              style={isActive(t.href)
                ? { background: 'var(--p50)', color: 'var(--p700)' }
                : { color: 'var(--muted)' }}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
