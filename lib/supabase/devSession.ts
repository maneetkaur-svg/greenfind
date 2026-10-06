import { createClient as createDirectClient, type SupabaseClient }
  from '@supabase/supabase-js';

/** Signs in once as a real Supabase account and reuses that client.
 *  Development only — it is imported solely from the DEV_AUTH_BYPASS branch.
 *
 *  Because this is a genuine session, auth.uid() is a real user id, every
 *  row-level security policy applies exactly as it does in production, and
 *  anything written is attributed to that account rather than to nobody.
 *
 *  Cached in module scope so a sign-in does not happen on every request.
 *  The dev server discards this on reload, which is fine.
 */
let cached: SupabaseClient | null = null;
let cachedFor: string | null = null;

export async function getDevSessionClient(): Promise<SupabaseClient> {
  const email = process.env.DEV_AUTH_EMAIL!;
  const password = process.env.DEV_AUTH_PASSWORD!;

  if (cached && cachedFor === email) return cached;

  const client = createDirectClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: true, persistSession: false } }
  );

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error)
    throw new Error(
      `DEV_AUTH_EMAIL could not sign in: ${error.message}. ` +
      `Check the address and password in .env.local, and that the account exists ` +
      `in Supabase with Auto Confirm on. To bootstrap without an account, remove ` +
      `DEV_AUTH_EMAIL and DEV_AUTH_PASSWORD and set SUPABASE_SERVICE_ROLE_KEY instead.`
    );

  cached = client;
  cachedFor = email;
  return client;
}
