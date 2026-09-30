import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/** Supabase on the server. Still the anon key and still the signed-in
 *  user's own permissions — server components do not bypass RLS. */
export async function createClient() {
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

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  role: 'super_admin' | 'operations' | 'user';
  is_active: boolean;
};

/** The signed-in user with their profile row.
 *  No profile row means no permissions at all — that is deliberate. */
export async function getMe(): Promise<Profile | null> {
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
