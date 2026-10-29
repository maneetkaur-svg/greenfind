import { NextRequest, NextResponse } from 'next/server';
import { createClient, getMe } from '@/lib/supabase/server';
import { parseFilters, filtersToJsonb } from '@/lib/analyticsFilters';

/** Backs the "Vendors added over time" chart's own granularity/vertical
 *  controls — the only two things on the page that change independently
 *  of a full navigation, so this is the only read that needs a real
 *  client-side fetch instead of the page's usual Link-driven re-render. */
export async function GET(request: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (me.role !== 'super_admin') return NextResponse.json({ error: 'Not permitted.' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const granularity = searchParams.get('granularity') ?? 'monthly';
  if (!['daily', 'weekly', 'monthly'].includes(granularity))
    return NextResponse.json({ error: 'granularity must be daily, weekly or monthly.' }, { status: 400 });
  const includeImports = searchParams.get('includeImports') === '1';

  // The chart's own vertical dropdown already overrides the page's vertical
  // filter client-side (TrendChart.tsx computes effectiveVertical and sends
  // it as `vertical`), so parseFilters picks up the right value as-is.
  const filters = parseFilters(Object.fromEntries(searchParams.entries()));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('analytics_trend', {
    p: filtersToJsonb(filters), p_granularity: granularity, p_include_imports: includeImports,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
