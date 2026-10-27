/** Onboarded / Unverified / Verified — see vendor_status_schema.xlsx and
 *  sql/50_vendor_tier_schema.sql. core_complete and banking_complete are
 *  computed in the database (site_summary); the three-way label itself is
 *  intentionally just this one small function, so relabelling a tier or
 *  moving the Unverified/Verified boundary is a one-line change here, not a
 *  database migration. Changing which fields count towards completeness is
 *  the one case that still means editing the SQL view instead. */
export type VendorTier = 'onboarded' | 'unverified' | 'verified';

export function vendorTier(coreComplete: boolean, bankingComplete: boolean): VendorTier {
  if (!coreComplete) return 'onboarded';
  return bankingComplete ? 'verified' : 'unverified';
}

export const TIER_LABEL: Record<VendorTier, string> = {
  onboarded: 'Onboarded',
  unverified: 'Unverified',
  verified: 'Verified',
};

export const TIER_CHIP_CLASS: Record<VendorTier, string> = {
  onboarded: 'c-a',
  unverified: 'c-n',
  verified: 'c-g',
};
