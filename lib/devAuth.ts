/** DEVELOPMENT-ONLY AUTHENTICATION BYPASS
 *
 *  One place decides whether the bypass is active. Everything else asks here,
 *  so turning it off is a single change and there is nothing to hunt for.
 *
 *  Three conditions must all hold. Any one of them failing disables it:
 *
 *    1. NODE_ENV is not 'production'      — `next build` sets this, so a
 *                                           production build can never enable it
 *    2. VERCEL is not set                 — set on every Vercel deployment,
 *                                           including previews
 *    3. DEV_AUTH_BYPASS is exactly 'true' — you have to opt in deliberately
 *
 *  The first two are not configurable. Setting DEV_AUTH_BYPASS=true in Vercel
 *  does nothing, which is the point.
 */
export const DEV_AUTH_BYPASS =
  process.env.NODE_ENV !== 'production' &&
  !process.env.VERCEL &&
  process.env.DEV_AUTH_BYPASS === 'true';

/** Who the app runs as while the bypass is on. Not a real account — there is
 *  no row in `profile` with this id, and no password anywhere. */
export const DEV_PROFILE = {
  id: '00000000-0000-0000-0000-000000000000',
  full_name: 'Developer',
  email: null,
  role: 'super_admin' as const,
  is_active: true,
};

/** Why the bypass is off, when it is. Used by the dev banner so the reason is
 *  visible rather than something to guess at. */
export function bypassStatus(): string {
  if (DEV_AUTH_BYPASS) return 'on';
  if (process.env.NODE_ENV === 'production') return 'off — production build';
  if (process.env.VERCEL) return 'off — running on Vercel';
  if (process.env.DEV_AUTH_BYPASS !== 'true') return 'off — DEV_AUTH_BYPASS is not "true"';
  return 'off';
}
