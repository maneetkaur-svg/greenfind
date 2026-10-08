import { redirect } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import { setRole, setActive } from './actions';
import AddUserForm from './AddUserForm';
import { ROLE_LABEL } from '@/lib/constants';
import SubmitButton from '@/app/SubmitButton';

type Row = { id: string; full_name: string; email: string | null;
             role: string; is_active: boolean; created_at: string };

export default async function UsersPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.role !== 'super_admin') redirect('/vendors');

  const supabase = await createClient();
  const { data } = await supabase.from('profile')
    .select('id, full_name, email, role, is_active, created_at')
    .order('created_at');
  const rows = (data ?? []) as Row[];

  return (
    <>
      <h1 className="text-[26px] font-bold">Internal users</h1>
      <p className="text-[13.5px] mt-1 mb-5" style={{ color: 'var(--faint)' }}>
        {rows.length} {rows.length === 1 ? 'person' : 'people'}. Only a Super Admin sees this page.
      </p>

      <AddUserForm />

      <div className="card overflow-x-auto mt-5">
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>
                  <span className="font-bold" style={{ color: 'var(--head)' }}>{r.full_name}</span>
                  {r.id === me.id && <span className="chip c-g ml-2">YOU</span>}
                </td>
                <td className="text-[13px]">{r.email}</td>
                <td>
                  {r.id === me.id ? (
                    <span className="chip c-n">{ROLE_LABEL[r.role]}</span>
                  ) : (
                    <form action={setRole} className="flex gap-2 items-center">
                      <input type="hidden" name="id" value={r.id} />
                      <select name="role" defaultValue={r.role} className="w-[150px]">
                        <option value="super_admin">Super Admin</option>
                        <option value="operations">Operations</option>
                        <option value="user">User</option>
                      </select>
                      <SubmitButton className="btn btn-o" pendingText="Saving…"
                                    style={{ padding: '6px 12px', fontSize: 13 }}>
                        Save
                      </SubmitButton>
                    </form>
                  )}
                </td>
                <td>
                  <span className={`chip ${r.is_active ? 'c-g' : 'c-r'}`}>
                    {r.is_active ? 'ACTIVE' : 'DISABLED'}
                  </span>
                </td>
                <td>
                  {r.id !== me.id && (
                    <form action={setActive}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="active" value={r.is_active ? 'false' : 'true'} />
                      <SubmitButton className="btn btn-o" pendingText="Working…"
                                    style={{ padding: '6px 12px', fontSize: 13 }}>
                        {r.is_active ? 'Disable' : 'Enable'}
                      </SubmitButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="note mt-5">
        <b>Disabling is better than deleting.</b> A disabled account cannot sign in,
        but anything they verified or changed keeps their name against it.
      </div>
    </>
  );
}
