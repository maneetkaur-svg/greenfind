import { NextRequest, NextResponse } from 'next/server';
import { createClient, getMe } from '@/lib/supabase/server';
import { vendorTier, TIER_LABEL } from '@/lib/vendorTier';
import { parseFilters, filtersToJsonb, SOURCE_LABEL } from '@/lib/analyticsFilters';
import type { VendorsResponse } from '@/lib/analyticsTypes';

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Backs the vendor drawer (JSON, paged) and both Export CSV buttons —
 *  the header's (the whole current filtered list) and the drawer's own
 *  (whatever it's currently scoped to) — with ?format=csv and no page
 *  size, since analytics_vendors(..., p_page_size => null) means "all
 *  rows, unpaged" on the database side. Vendor names/cities are never
 *  part of the dashboard's own analytics_summary call — they only ever
 *  come from here, fetched only once the drawer actually opens. */
export async function GET(request: NextRequest) {
  const me = await getMe();
  if (!me) return new NextResponse('Not signed in.', { status: 401 });
  if (me.role !== 'super_admin') return new NextResponse('Not permitted.', { status: 403 });

  const { searchParams } = new URL(request.url);
  const filters = parseFilters(Object.fromEntries(searchParams.entries()));
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const q = searchParams.get('q') ?? '';
  const format = searchParams.get('format');
  const page = Number(searchParams.get('page') ?? '1') || 1;
  const pageSize = format === 'csv' ? null : Number(searchParams.get('pageSize') ?? '50') || 50;

  const p: Record<string, string> = { ...filtersToJsonb(filters) };
  if (from) p.from = from;
  if (to) p.to = to;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('analytics_vendors', {
    p, p_q: q || null, p_page: page, p_page_size: pageSize,
  });
  if (error) {
    return format === 'csv'
      ? new NextResponse('Could not read the vendor list: ' + error.message, { status: 500 })
      : NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = data as VendorsResponse;

  if (format === 'csv') {
    const header = ['Vendor', 'City', 'State', 'Status', 'Source', 'Date added'];
    const body = result.rows.map(r => [
      r.legal_name, r.city ?? '', r.state ?? '',
      TIER_LABEL[vendorTier(r.core_complete, r.banking_complete)],
      r.source ? (SOURCE_LABEL[r.source] ?? r.source) : '',
      new Date(r.created_at).toISOString().slice(0, 10),
    ]);
    const bom = '﻿';
    const csv = bom + [header, ...body].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="vendors-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json(result);
}
