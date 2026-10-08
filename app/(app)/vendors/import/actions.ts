'use server';
import { revalidatePath } from 'next/cache';
import { createClient, getMe } from '@/lib/supabase/server';

export type GroupPayload = {
  pan: string;
  company: Record<string, unknown>;
  sites: {
    row: number;
    site: Record<string, unknown>;
    contacts: { rank: number; name: string; designation: string; mobile: string; email: string }[];
    geography: string[];
  }[];
};

export type GroupResult = {
  pan: string;
  error?: string;                          // the whole group failed and was rolled back
  company_code?: string;
  company_created?: boolean;
  sites: { row: number; ok: boolean; site_code?: string; error?: string }[];
};

const chunks = <T,>(a: T[], n: number) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** What is already on record. Returns identity keys — "L:<vendor code>" and
 *  "G:<GSTIN>|<PINCODE>" — plus the PANs that already have a company. Reads go
 *  through the signed-in user's permissions, so a soft-deleted record is not
 *  visible here; the database will still refuse it, and the import reports that
 *  per row. */
export async function checkExisting(gstins: string[], pans: string[], legacyCodes: string[] = []):
  Promise<{ sites: string[]; pans: string[]; error?: string }> {
  const me = await getMe();
  if (!me) return { sites: [], pans: [], error: 'You are not signed in.' };
  if (me.role === 'user') return { sites: [], pans: [], error: 'Your role is read-only.' };

  const supabase = await createClient();
  const sites: string[] = [];
  for (const part of chunks([...new Set(gstins)], 100)) {
    const { data, error } = await supabase.from('vendor_site').select('gstin, pincode').in('gstin', part);
    if (error) return { sites: [], pans: [], error: error.message };
    for (const r of data ?? []) sites.push(`G:${String(r.gstin).trim()}|${String(r.pincode ?? '').trim()}`);
  }
  for (const part of chunks([...new Set(legacyCodes.map(c => c.toUpperCase()))], 50)) {
    // legacy codes are compared case-insensitively
    const { data, error } = await supabase.from('vendor_site').select('legacy_vendor_code')
      .or(part.map(c => `legacy_vendor_code.ilike.${c.replace(/[,()*%]/g, '_')}`).join(','));
    if (error) return { sites: [], pans: [], error: error.message };
    for (const r of data ?? []) sites.push(`L:${String(r.legacy_vendor_code).trim().toUpperCase()}`);
  }
  const found: string[] = [];
  for (const part of chunks([...new Set(pans)], 100)) {
    const { data, error } = await supabase.from('company').select('pan').in('pan', part);
    if (error) return { sites: [], pans: [], error: error.message };
    for (const r of data ?? []) found.push(String(r.pan).trim());
  }
  return { sites, pans: found };
}

/** One call per company, each all-or-nothing inside the database
 *  (see sql/05_import.sql). The client sends a few at a time so a large file
 *  shows progress and never exceeds the request size limit. */
export async function importGroups(groups: GroupPayload[]): Promise<GroupResult[]> {
  const me = await getMe();
  const fail = (msg: string): GroupResult[] =>
    groups.map(g => ({ pan: g.pan, error: msg, sites: g.sites.map(s => ({ row: s.row, ok: false, error: msg })) }));
  if (!me) return fail('You are not signed in.');
  if (me.role !== 'super_admin') return fail('Import is restricted to super admins.');
  if (groups.length > 50) return fail('Too many companies in one request.');

  const supabase = await createClient();
  const out: GroupResult[] = [];
  for (const g of groups) {
    const { data, error } = await supabase.rpc('import_vendor_group', { p: g });
    if (error) {
      const msg = error.message.includes('import_vendor_group')
        ? 'The import function is missing from the database. Run sql/05_import.sql in Supabase first.'
        : error.message;
      out.push({ pan: g.pan, error: msg, sites: g.sites.map(s => ({ row: s.row, ok: false, error: msg })) });
      continue;
    }
    const d = data as { company_code: string; company_created: boolean; sites: GroupResult['sites'] };
    out.push({ pan: g.pan, company_code: d.company_code, company_created: d.company_created, sites: d.sites });
  }
  revalidatePath('/vendors');
  return out;
}
