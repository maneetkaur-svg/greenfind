import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/supabase/server';
import ImportWizard from './ImportWizard';

export default async function ImportPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.role === 'user') redirect('/vendors');       // read-only accounts cannot import

  return (
    <>
      <div className="mb-5">
        <Link href="/vendors" className="text-[13px] font-semibold" style={{ color: 'var(--faint)' }}>← Vendors</Link>
        <h1 className="text-[26px] font-bold mt-1">Import vendors</h1>
        <p className="text-[13.5px] mt-1" style={{ color: 'var(--faint)' }}>
          Excel, CSV or JSON. The file is read in your browser; nothing is saved until you have reviewed it.
        </p>
      </div>
      <ImportWizard canUndo={me.role === 'super_admin'} />
    </>
  );
}
