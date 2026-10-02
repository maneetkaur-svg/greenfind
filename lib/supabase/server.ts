import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createDirectClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { DEV_AUTH_BYPASS, DEV_PROFILE } from '@/lib/devAuth';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  role: 'super_admin' | 'operations' | 'user';
  is_active: boolean;
};

export async function createClient() {
  // With the bypass on there is no signed-in user, so auth.uid() is null and
  // every row-level security policy denies. The service key is what lets the
  // dev server read and write. RLS itself is untouched — the policies are all
  // still there, this key simply outranks them.
  //
  // This file only ever runs on the server. The key is never sent to a browser,
  // and DEV_AUTH_BYPASS cannot be true in a production build or on Vercel.
  if (DEV_AUTH_BYPASS) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key)
      throw new Error(
        'DEV_AUTH_BYPASS is on but SUPABASE_SERVICE_ROLE_KEY is missing from .env.local. ' +
        'Without a signed-in user, row-level security refuses every query, so the key is required.'
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
  if (DEV_AUTH_BYPASS) return DEV_PROFILE;

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
