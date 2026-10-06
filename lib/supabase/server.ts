import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createDirectClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { DEV_AUTH_BYPASS, DEV_PROFILE, devMode } from '@/lib/devAuth';
import { getDevSessionClient } from './devSession';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  role: 'super_admin' | 'operations' | 'user';
  is_active: boolean;
};

export async function createClient() {
  if (DEV_AUTH_BYPASS) {
    const mode = devMode();

    // Preferred. A real Supabase session, so auth.uid() is a real user and
    // every row-level security policy applies exactly as in production.
    if (mode === 'session') return await getDevSessionClient();

    // Bootstrap only, for before any account exists. The service key outranks
    // RLS, so role restrictions are not exercised in this mode. Server side
    // only — this file never reaches a browser.
    if (mode === 'service') {
      return createDirectClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
    }

    throw new Error(
      'DEV_AUTH_BYPASS is on but nothing tells the server who to be.\n\n' +
      'Preferred — add a real account to .env.local:\n' +
      '    DEV_AUTH_EMAIL=you@fitsol.green\n' +
      '    DEV_AUTH_PASSWORD=your-password\n' +
      'Row-level security stays fully enforced and writes are attributed to that user.\n\n' +
      'If no account exists yet, bootstrap with:\n' +
      '    SUPABASE_SERVICE_ROLE_KEY=eyJ...\n' +
      'then create one at /users and switch to the pair above.\n\n' +
      'Restart the dev server after editing .env.local — it is read once, at startup.'
    );
  }

  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list: CookieToSet[]) => {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options));
          } catch {
            /* called from a server component; middleware refreshes instead */
          }
        },
      },
    }
  );
}

/** The signed-in user with their profile row.
 *  No profile row means no permissions at all — that is deliberate. */
export async function getMe(): Promise<Profile | null> {
  // In service mode there is no real user, so a stand-in is the only option.
  // In session mode the real profile is read, which means the real role is
  // used and role restrictions behave as they will in production.
  if (DEV_AUTH_BYPASS && devMode() === 'service') return DEV_PROFILE;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profile')
    .select('id, full_name, email, role, is_active')
    .eq('id', user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile as Profile;
}
