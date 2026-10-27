import { NextRequest, NextResponse } from 'next/server';
import { createClient, getMe } from '@/lib/supabase/server';
import { vendorTier, TIER_LABEL } from '@/lib/vendorTier';

const SOURCE_LABEL: Record<string, string> = {
  import: 'Import', manual: 'Internal', public_form: 'External', old_portal: 'Old GreenFind Portal',
};

type Row = {
  site_code: string; legacy_vendor_code: string | null; legal_name: string;
  gstin: string | null; industry: string | null; services_text: string | null;
  state: string | null; city: string | null; source: string | null;
  added_by_name: string | null; core_complete: boolean; banking_complete: boolean;
};

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Same filter shape as the vendor list page itself, so "Export" always
 *  matches exactly what's currently on screen — industry/state filtered
 *  in the query, q filtered the same way the page does it (client-side,
 *  after fetch), not duplicated as a second, possibly-drifting rule. */
export async function GET(request: NextRequest) {
  const me = await getMe();
  if (!me) return new NextResponse('Not signed in.', { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const industryParam = searchParams.get('industry') ?? '';
  const state = searchParams.get('state') ?? '';
  const sourceParam = searchParams.get('source') ?? '';
  const addedByParam = searchParams.get('addedBy') ?? '';

  const industries = industryParam.split(',').filter(Boolean);
  const sources = sourceParam.split(',').filter(Boolean);
  const addedBys = addedByParam.split(',').filter(Boolean);
  const realIndustries = industries.filter(i => i !== 'unclassified');
  const wantsUnclassified = industries.includes('unclassified');

  const supabase = await createClient();
  let query = supabase.from('site_summary').select(
    'site_code, legacy_vendor_code, legal_name, gstin, industry, services_text, state, city, source, added_by_name, core_complete, banking_complete'
  ).order('updated_at', { ascending: false });

  if (industries.length) {
    if (wantsUnclassified && realIndustries.length)
      query = query.or(`industry.is.null,industry.in.(${realIndustries.join(',')})`);
    else if (wantsUnclassified) query = query.is('industry', null);
    else query = query.in('industry', realIndustries);
  }
  if (state) query = query.eq('state', state);

  const { data, error } = await query;
  if (error) return new NextResponse('Could not read the vendor list: ' + error.message, { status: 500 });

  let rows = (data ?? []) as Row[];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(r =>
      `${r.legal_name} ${r.gstin ?? ''} ${r.site_code} ${r.legacy_vendor_code ?? ''} ${r.services_text ?? ''}`
        .toLowerCase().includes(needle));
  }
  if (sources.length) rows = rows.filter(r => !!r.source && sources.includes(r.source));
  if (addedBys.length) rows = rows.filter(r => !!r.added_by_name && addedBys.includes(r.added_by_name));

  const header = ['Site Code', 'Legacy Code', 'Vendor', 'GSTIN', 'Industry', 'State', 'City', 'Source', 'Added By', 'Status'];
  const body = rows.map(r => [
    r.site_code, r.legacy_vendor_code ?? '', r.legal_name, r.gstin ?? '',
    r.industry ?? 'Unclassified', r.state ?? '', r.city ?? '',
    r.source ? (SOURCE_LABEL[r.source] ?? r.source) : '',
    r.added_by_name ?? '',
    TIER_LABEL[vendorTier(r.core_complete, r.banking_complete)],
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
