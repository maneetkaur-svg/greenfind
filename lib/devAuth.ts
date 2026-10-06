/** DEVELOPMENT-ONLY AUTHENTICATION BYPASS
 *
 *  Three conditions must all hold. Any one failing disables it:
 *
 *    1. NODE_ENV is not 'production'      — `next build` sets this
 *    2. VERCEL is not set                 — set on every Vercel deployment
 *    3. DEV_AUTH_BYPASS is exactly 'true' — deliberate opt-in
 *
 *  The first two are not configurable. Setting the flag in Vercel does nothing.
 */
export const DEV_AUTH_BYPASS =
  process.env.NODE_ENV !== 'production' &&
  !process.env.VERCEL &&
  process.env.DEV_AUTH_BYPASS === 'true';

/** Two ways to satisfy row-level security without a browser login.
 *
 *  'session'  — the server signs in as a real Supabase account using
 *               DEV_AUTH_EMAIL and DEV_AUTH_PASSWORD. auth.uid() is a real
 *               user, every policy applies exactly as in production, and
 *               writes are attributed properly. Preferred, and the default
 *               whenever those two variables are set.
 *
 *  'service'  — the server uses SUPABASE_SERVICE_ROLE_KEY, which outranks
 *               RLS. Only for bootstrapping, before any account exists.
 *               Role restrictions are not exercised in this mode.
 */
export type DevMode = 'session' | 'service' | 'none';

export function devMode(): DevMode {
  if (!DEV_AUTH_BYPASS) return 'none';
  if (process.env.DEV_AUTH_EMAIL && process.env.DEV_AUTH_PASSWORD) return 'session';
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return 'service';
  return 'none';
}

/** Who the app reports as while in service mode. There is no password for
 *  this anywhere, and no row in `profile` with this id. In session mode the
 *  real profile is read from the database instead. */
export const DEV_PROFILE = {
  id: '00000000-0000-0000-0000-000000000000',
  full_name: 'Developer',
  email: null,
  role: 'super_admin' as const,
  is_active: true,
};

/** Explains the current state in one line, for the banner and for errors. */
export function devStatus(): string {
  if (!DEV_AUTH_BYPASS) {
    if (process.env.NODE_ENV === 'production') return 'off — production build';
    if (process.env.VERCEL) return 'off — running on Vercel';
    return 'off — DEV_AUTH_BYPASS is not "true"';
  }
  const m = devMode();
  if (m === 'session')
    return `signed in as ${process.env.DEV_AUTH_EMAIL} · row-level security fully enforced`;
  if (m === 'service')
    return 'using the service key · row-level security bypassed, roles not exercised';
  return 'no credentials configured';
}
