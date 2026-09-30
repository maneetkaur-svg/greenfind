import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createDirectClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/** DEMO MODE
 *  Set DEMO_MODE=true in the environment to switch the login off for a
 *  stakeholder demo. Everyone who opens the link is treated as a Super Admin.
 *
 *  Turn it off — delete the variable, or set it to false — and real
 *  authentication comes straight back. Nothing has been removed.
 *
 *  Never leave this on once real vendor data is in the database. Anyone with
 *  the address can read and change everything, including bank details. */
export const DEMO_MODE = process.env.DEMO_MODE === 'true';

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  role: 'super_admin' | 'operations' | 'user';
  is_active: boolean;
};

/** The account the app runs as while DEMO_MODE is on. */
export const DEMO_PROFILE: Profile = {
  id: '00000000-0000-0000-0000-000000000000',
  full_name: 'Demo',
  email: null,
  role: 'super_admin',
  is_active: true,
};

export async function createClient() {
  // In demo mode there is no signed-in user, so the row-level security rules
  // would refuse every query. The service key steps past them for the demo.
  if (DEMO_MODE) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key)
      throw new Error(
        'DEMO_MODE is on but SUPABASE_SERVICE_ROLE_KEY is not set. Demo mode needs it, because with nobody signed in the database refuses every query.'
      );
    return createDirectClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
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
  if (DEMO_MODE) return DEMO_PROFILE;

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
