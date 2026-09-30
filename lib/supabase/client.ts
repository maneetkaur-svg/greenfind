'use client';
import { createBrowserClient } from '@supabase/ssr';

/** Supabase in the browser. Uses the anon key, which is safe here only
 *  because row-level security is switched on. The two go together. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
