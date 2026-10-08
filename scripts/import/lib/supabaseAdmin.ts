import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ImportEnv } from './env';

/** Service-role client pointed at whatever .env.import names — never the
 *  app's .env.local. Bypasses row-level security, so it must never run
 *  anywhere but this local, one-off script. */
export function createImportAdminClient(env: Pick<ImportEnv, 'supabaseUrl' | 'serviceRoleKey'>): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
