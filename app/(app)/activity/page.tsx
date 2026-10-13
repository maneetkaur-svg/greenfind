import { redirect } from 'next/navigation';
import { createClient, getMe } from '@/lib/supabase/server';
import { ACTIVITY_LOG_EMAIL } from '@/lib/constants';

type ProfileRef = { full_name: string; email: string | null };
type LoginRow = { logged_in_at: string; profile: ProfileRef | ProfileRef[] | null };
type AuditRow = {
  at: string; table_name: string; record_id: string; action: string;
  changed: Record<string, unknown> | null; actor: string | null;
};

const one = <T,>(v: T | T[] | null): T | null => Array.isArray(v) ? (v[0] ?? null) : v;

export default async function ActivityPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.email?.toLowerCase() !== ACTIVITY_LOG_EMAIL) redirect('/vendors');

  const supabase = await createClient();

  const { data: loginsRaw, error: loginErr } = await supabase
    .from('login_log')
    .select('logged_in_at, profile:profile_id(full_name, email)')
    .order('logged_in_at', { ascending: false })
    .limit(200);
  const logins = (loginsRaw ?? []) as unknown as LoginRow[];

  const { data: changesRaw, error: changesErr } = await supabase
    .from('audit_log')
    .select('at, table_name, record_id, action, changed, actor')
    .order('at', { ascending: false })
    .limit(200);
  const changes = (changesRaw ?? []) as AuditRow[];

  // audit_log.actor has no foreign key (it's append-only and deliberately
  // decoupled from everything), so this has to be a second query joined
  // by hand rather than a PostgREST embed.
  const actorIds = [...new Set(changes.map(c => c.actor).filter((x): x is string => !!x))];
  const { data: actorsRaw } = actorIds.length
    ? await supabase.from('profile').select('id, full_name, email').in('id', actorIds)
    : { data: [] as { id: string; full_name: string; email: string | null }[] };
  const actorMap = new Map((actorsRaw ?? []).map(a => [a.id, a]));

  return (
    <>
      <h1 className="text-[26px] font-bold">Activity</h1>
      <p className="text-[13.5px] mt-1 mb-5" style={{ color: 'var(--faint)' }}>
        Visible to you only. Sign-ins and changes across the system, most recent first — up to 200 of each.
      </p>

      {(loginErr || changesErr) && (
        <div className="note r mb-5">
          <b>Some of this could not be loaded.</b>{' '}
          {loginErr?.message} {changesErr?.message}
          <div className="hint mt-2">
            If this says the relation does not exist, sql/28_login_log.sql has not been run.
          </div>
        </div>
      )}

      <div className="card overflow-x-auto mb-6">
        <div className="p-4 border-b" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-[15px] font-bold">Sign-ins</h2>
        </div>
        <table>
          <thead><tr><th>Who</th><th>Email</th><th>When</th></tr></thead>
          <tbody>
            {logins.map((l, i) => {
              const p = one(l.profile);
              return (
                <tr key={i}>
                  <td className="font-semibold" style={{ color: 'var(--head)' }}>{p?.full_name ?? '—'}</td>
                  <td className="text-[13px]">{p?.email ?? '—'}</td>
                  <td className="text-[13px]">{new Date(l.logged_in_at).toLocaleString()}</td>
                </tr>
              );
            })}
            {logins.length === 0 && (
              <tr><td colSpan={3} className="text-center" style={{ color: 'var(--faint)' }}>
                No sign-ins recorded yet — this only starts counting from when it was added.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <div className="p-4 border-b" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-[15px] font-bold">Changes made</h2>
          <p className="text-[12.5px] mt-1" style={{ color: 'var(--faint)' }}>
            Covers company, vendor and document records. Does not cover sign-ins themselves, or
            tables without an audit trigger (contacts, geography, service categories).
          </p>
        </div>
        <table>
          <thead><tr><th>Who</th><th>Table</th><th>Action</th><th>What changed</th><th>When</th></tr></thead>
          <tbody>
            {changes.map((c, i) => {
              const actor = c.actor ? actorMap.get(c.actor) : null;
              return (
                <tr key={i}>
                  <td className="font-semibold" style={{ color: 'var(--head)' }}>
                    {actor?.full_name ?? (c.actor ? '(no longer on record)' : '—')}
                  </td>
                  <td className="text-[13px]">{c.table_name}</td>
                  <td>
                    <span className={`chip ${c.action === 'delete' ? 'c-r' : c.action === 'insert' ? 'c-g' : 'c-a'}`}>
                      {c.action.toUpperCase()}
                    </span>
                  </td>
                  <td className="text-[12.5px]">
                    {c.changed ? Object.entries(c.changed).map(([field, val]) => (
                      <div key={field}>
                        <b>{field}</b>:{' '}
                        {Array.isArray(val) && val.length === 2
                          ? `${JSON.stringify(val[0])} → ${JSON.stringify(val[1])}`
                          : JSON.stringify(val)}
                      </div>
                    )) : '—'}
                  </td>
                  <td className="text-[13px]">{new Date(c.at).toLocaleString()}</td>
                </tr>
              );
            })}
            {changes.length === 0 && (
              <tr><td colSpan={5} className="text-center" style={{ color: 'var(--faint)' }}>
                No changes recorded yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
