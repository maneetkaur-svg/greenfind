'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/** Where an invite (or password-reset) email's link lands. The token lives
 *  in the URL fragment, which `createBrowserClient` picks up and turns into
 *  a real session automatically on load — this page only has to wait for
 *  that, then let the person choose their own password. Nothing resembling
 *  a credential ever travelled by email to get here. */
export default function SetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setReady(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async () => {
    setError('');
    if (password.length < 8) { setError('Use a password of at least 8 characters.'); return; }
    if (password !== confirm) { setError('Those two do not match.'); return; }
    setBusy(true);
    const supabase = createClient();
    const { error: upErr } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (upErr) { setError(upErr.message); return; }
    router.push('/vendors');
  };

  return (
    <div className="min-h-screen grid place-items-center p-5">
      <div className="card w-full max-w-[400px] p-7">
        <h1 className="text-[19px] font-bold mb-1">Set your password</h1>
        <p className="text-[13px] mb-5" style={{ color: 'var(--faint)' }}>
          Choose a password for your GreenFind account. You will use this to sign in from now on.
        </p>

        {!ready ? (
          <p className="text-[13px]" style={{ color: 'var(--faint)' }}>
            Checking your invite link…
          </p>
        ) : (
          <div className="space-y-4">
            {error && <div className="note r">{error}</div>}
            <div>
              <label className="lab" htmlFor="password">New password</label>
              <input id="password" type="password" value={password} minLength={8}
                     autoComplete="new-password" onChange={e => setPassword(e.target.value)} />
            </div>
            <div>
              <label className="lab" htmlFor="confirm">Confirm password</label>
              <input id="confirm" type="password" value={confirm} minLength={8}
                     autoComplete="new-password" onChange={e => setConfirm(e.target.value)} />
            </div>
            <button type="button" className="btn btn-p w-full justify-center" disabled={busy} onClick={submit}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {busy ? 'Saving…' : 'Set password and continue'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
