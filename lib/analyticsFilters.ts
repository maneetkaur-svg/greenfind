/** The one filter shape every Analytics piece shares — the page itself,
 *  analytics_summary()/analytics_trend()/analytics_vendors() on the
 *  database side (sql/54c), and the drawer's own, separate copy of it
 *  (see buildDrawerHref below). Keeping the keys identical everywhere
 *  means a filter never needs translating from one shape to another. */
export type AnalyticsFilters = {
  vertical?: string;
  category?: string;
  subcategory?: string;
  state?: string;
  region?: string;
  source?: string;
  addedBy?: string;
  window?: string;
};

export const FILTER_KEYS = ['vertical', 'category', 'subcategory', 'state', 'region', 'source', 'addedBy', 'window'] as const;

export function parseFilters(sp: Record<string, string | undefined>): AnalyticsFilters {
  const out: AnalyticsFilters = {};
  for (const k of FILTER_KEYS) if (sp[k]) out[k] = sp[k];
  return out;
}

export function filtersToJsonb(f: AnalyticsFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of FILTER_KEYS) if (f[k]) out[k] = f[k] as string;
  return out;
}

/** Applies a set of changes (a key set to a value, or cleared with null)
 *  on top of the current filters, returning the resolved filter object —
 *  the one place both buildHref and buildDrawerHref compute "current
 *  filters, with these overrides" so the two can't drift apart. */
export function withFilters(current: AnalyticsFilters, changes: Partial<Record<keyof AnalyticsFilters, string | null>>): AnalyticsFilters {
  const next: AnalyticsFilters = { ...current };
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined) delete next[k as keyof AnalyticsFilters];
    else next[k as keyof AnalyticsFilters] = v;
  }
  return next;
}

/** An href for the page's own filters — toggling, setting, or clearing one
 *  or more keys while leaving the rest of the current query string (and
 *  the drawer's own `d*` params, if a drawer happens to be open) alone. */
export function buildHref(current: AnalyticsFilters, changes: Partial<Record<keyof AnalyticsFilters, string | null>>): string {
  const next = withFilters(current, changes);
  const params = new URLSearchParams();
  for (const k of FILTER_KEYS) if (next[k]) params.set(k, next[k] as string);
  const qs = params.toString();
  return qs ? `/analytics?${qs}` : '/analytics';
}

/** Toggle one value into (or out of) a comma-joined filter — the
 *  established click-to-filter convention this app already uses
 *  everywhere else (vendors/DashboardCard.tsx, the old Analytics tiles). */
export function toggleHref(current: AnalyticsFilters, key: keyof AnalyticsFilters, value: string): string {
  const existing = (current[key] ?? '').split(',').filter(Boolean);
  const next = existing.includes(value) ? existing.filter(v => v !== value) : [...existing, value];
  return buildHref(current, { [key]: next.length ? next.join(',') : null });
}

export type DrawerSpec = {
  label: string;
  breadcrumb?: string;
  /** The drawer's own fully-resolved filter set — build it with
   *  withFilters(pageFilters, { ... }) so clearing a dimension (e.g. city,
   *  under a state row) is explicit rather than silently inherited. */
  filters: AnalyticsFilters;
  from?: string;
  to?: string;
};

const D_PREFIX: Record<keyof AnalyticsFilters, string> = {
  vertical: 'dVertical', category: 'dCategory', subcategory: 'dSubcategory',
  state: 'dState', region: 'dRegion', source: 'dSource', addedBy: 'dAddedBy', window: 'dWindow',
};

/** A link that opens the vendor drawer scoped to one summary row — built
 *  from the CURRENT page filters plus that row's own overrides (its one
 *  concrete value for the dimension it represents, with any sibling
 *  dimension its count ignored — e.g. city, under a state row — cleared).
 *  This never touches the page's own `?vertical=...` etc. query, so
 *  opening and closing the drawer never changes what the tables show. */
export function buildDrawerHref(
  pageHref: string,
  spec: DrawerSpec,
): string {
  const url = new URL(pageHref, 'http://x');
  const drawerFilters = spec.filters;
  url.searchParams.set('drawer', '1');
  url.searchParams.set('dLabel', spec.label);
  if (spec.breadcrumb) url.searchParams.set('dBreadcrumb', spec.breadcrumb);
  if (spec.from) url.searchParams.set('dFrom', spec.from);
  if (spec.to) url.searchParams.set('dTo', spec.to);
  for (const k of FILTER_KEYS) {
    const v = drawerFilters[k];
    if (v) url.searchParams.set(D_PREFIX[k], v);
  }
  return url.pathname + '?' + url.searchParams.toString();
}

export function parseDrawerFromSearch(sp: URLSearchParams): DrawerSpec | null {
  if (sp.get('drawer') !== '1') return null;
  const filters: AnalyticsFilters = {};
  for (const k of FILTER_KEYS) {
    const v = sp.get(D_PREFIX[k]);
    if (v) filters[k] = v;
  }
  return {
    label: sp.get('dLabel') ?? 'Vendors',
    breadcrumb: sp.get('dBreadcrumb') ?? undefined,
    filters,
    from: sp.get('dFrom') ?? undefined,
    to: sp.get('dTo') ?? undefined,
  };
}

export const WINDOW_LABEL: Record<string, string> = {
  '30d': 'Last 30 days', '90d': 'Last 90 days', '12m': 'Last 12 months',
};

// Fixed, data-independent -- the Region select always offers all seven,
// even one with zero vendors right now (sql/54d_region_filter.sql defines
// exactly these seven; keep the two in sync).
export const REGION_OPTIONS: [string, string][] = [
  ['north', 'North'], ['south', 'South'], ['east', 'East'], ['west', 'West'],
  ['northeast', 'North East'], ['pan_india', 'Pan India'], ['outside_india', 'Outside India'],
];

export const SOURCE_LABEL: Record<string, string> = {
  import: 'Import', manual: 'Internal', public_form: 'Quick sign-up',
  public_form_full: 'Complete onboarding', old_portal: 'Old portal',
};
