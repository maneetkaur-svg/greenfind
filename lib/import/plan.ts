import type { ParsedRow } from './validate';

export type PlannedSite = { rowNumber: number; site: Record<string, unknown>;
  contacts: ParsedRow['contacts']; geography: string[]; flagged: boolean; problems: string[] };
export type PlannedCompany = { pan: string; company: Record<string, unknown>; sites: PlannedSite[] };

/** Group importable rows by the PAN inside the GSTIN. One PAN → one company,
 *  however many rows share it. Company-level fields come from the first row of
 *  each group, and later rows only fill gaps — they never overwrite. */
export function buildPlan(rows: ParsedRow[]): { companies: PlannedCompany[]; held: ParsedRow[] } {
  const held: ParsedRow[] = [];
  const byPan = new Map<string, PlannedCompany>();

  for (const r of rows) {
    if (r.problems.some(p => p.severity === 'blocking') || !r.pan) { held.push(r); continue; }
    let c = byPan.get(r.pan);
    if (!c) { c = { pan: r.pan, company: { ...r.company }, sites: [] }; byPan.set(r.pan, c); }
    else for (const [k, v] of Object.entries(r.company))
      if (c.company[k] === undefined || c.company[k] === null || c.company[k] === '') c.company[k] = v;
    c.sites.push({
      rowNumber: r.rowNumber, site: r.site, contacts: r.contacts, geography: r.geography,
      flagged: r.problems.length > 0, problems: r.problems.map(p => p.message),
    });
  }
  return { companies: [...byPan.values()], held };
}
