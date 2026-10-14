import { redirect } from 'next/navigation';
import { getMe } from '@/lib/supabase/server';
import RfqsNav from './RfqsNav';

export default async function RfqsLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.role !== 'super_admin') redirect('/vendors');

  return (
    <>
      <h1 className="text-[26px] font-bold mb-1">RFQs</h1>
      <p className="text-[13.5px] mb-5" style={{ color: 'var(--faint)' }}>
        Requirements in, a confirmed order and delivery out.
      </p>
      <RfqsNav />
      {children}
    </>
  );
}
