/** Mirrors exactly what sql/54c's functions return as jsonb — see the
 *  comment above each function there for what each field means. */

export type TaxonomySubcategory = { id: string; label: string; is_active: boolean };
export type TaxonomyCategory = { id: string; label: string; is_active: boolean; subcategories: TaxonomySubcategory[] };
export type TaxonomyVertical = { id: string; label: string; is_active: boolean; categories: TaxonomyCategory[] };
export type AddedByOption = { id: string; name: string };
export type Taxonomy = { verticals: TaxonomyVertical[]; added_by: AddedByOption[] };

export type Kpi = { total: number; added_this_month: number; onboarded: number; verified: number; unverified: number };
export type SourceRow = { source: string; count: number };
export type VerticalRow = { id: string; label: string; is_active: boolean; count: number; verified: number };
export type CategoryRow = { id: string; label: string; is_active: boolean; has_subcategories: boolean; count: number; verified: number };
export type SubcategoryRow = { id: string; label: string; is_active: boolean; count: number; verified: number };
export type GeoRow = { state?: string; count: number };
export type RegionRow = { region: string; label: string; count: number };

export type AnalyticsSummary = {
  kpi: Kpi;
  by_source: SourceRow[];
  by_vertical: VerticalRow[];
  by_category: CategoryRow[];
  by_subcategory: Record<string, SubcategoryRow[]>;
  by_state: GeoRow[];
  by_region: RegionRow[];
};

export type TrendBucket = { bucket: string; count: number };
export type TrendResponse = { granularity: 'daily' | 'weekly' | 'monthly'; buckets: TrendBucket[]; excluded_imports: number };

/** 'unverified'/'verified' are approximated from audit_log (sql/54e) --
 *  see that file's comment for exactly what they can and can't capture. */
export type TrendMetric = 'onboarded' | 'unverified' | 'verified';
export const METRIC_LABEL: Record<TrendMetric, string> = {
  onboarded: 'Added', unverified: 'Became Unverified', verified: 'Became Verified',
};

export type VendorRow = {
  id: string; legal_name: string; city: string | null; state: string | null;
  core_complete: boolean; banking_complete: boolean; source: string | null; created_at: string;
};
export type VendorsResponse = { total: number; rows: VendorRow[] };

export const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : null);
export const pctLabel = (n: number, total: number) => {
  const p = pct(n, total);
  return p === null ? '—' : `${p}%`;
};
