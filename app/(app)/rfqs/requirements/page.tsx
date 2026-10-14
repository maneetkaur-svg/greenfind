import { createClient, getMe } from '@/lib/supabase/server';
import { INDUSTRIES } from '@/lib/constants';
import RequirementForm from './RequirementForm';
import CloseRequirementButton from './CloseRequirementButton';

type Row = {
  id: string; title: string; industry: string; description: string | null;
  geography: string[]; quantity: number | null; unit: string | null;
  needed_by: string | null; status: string; created_at: string;
};

export default async function RequirementsPage() {
  const me = await getMe();
  const supabase = await createClient();
  const { data, error } = await supabase.from('requirement')
    .select('*').order('created_at', { ascending: false });
  const rows = (data ?? []) as Row[];

  return (
    <>
      <div className="card p-6 mb-5">
        <h2 className="text-[15px] font-bold mb-1">Add a requirement</h2>
        <p className="text-[13px] mb-4" style={{ color: 'var(--faint)' }}>
          Created manually for now. A CRM connection can write into this same list later —
          this is already where that would land.
        </p>
        {me?.role !== 'user' && <RequirementForm />}
      </div>

      {error && <div className="note r mb-4">Could not load requirements: {error.message}</div>}

      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Title</th><th>Industry</th><th>Geography</th><th>Qty</th>
              <th>Needed by</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>
                  <div className="font-semibold" style={{ color: 'var(--head)' }}>{r.title}</div>
                  {r.description && <div className="text-[12px]" style={{ color: 'var(--faint)' }}>{r.description}</div>}
                </td>
                <td className="text-[13px]">{INDUSTRIES.find(i => i.code === r.industry)?.label ?? r.industry}</td>
                <td className="text-[13px]">{r.geography.length ? `${r.geography.length} state${r.geography.length === 1 ? '' : 's'}` : '—'}</td>
                <td className="text-[13px]">{r.quantity ? `${r.quantity} ${r.unit ?? ''}` : '—'}</td>
                <td className="text-[13px]">{r.needed_by ?? '—'}</td>
                <td><span className={`chip ${r.status === 'open' ? 'c-g' : r.status === 'cancelled' ? 'c-r' : 'c-n'}`}>{r.status.toUpperCase()}</span></td>
                <td>
                  {r.status === 'open' && me?.role !== 'user' && <CloseRequirementButton id={r.id} />}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={7} className="text-center" style={{ color: 'var(--faint)' }}>No requirements yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
