import { createClient } from '@supabase/supabase-js';

/** Admin client. Uses the service key, which ignores every row-level
 *  security rule, so it must only ever be created inside a server action.
 *  Never import this from a file marked 'use client'. */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set on this deployment.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
