import { IMPORT_FIELDS } from './fields';
import { normHeader } from './normalise';

export type ColumnMatch = {
  index: number;
  header: string;
  /** field key, or null if nothing matched */
  key: string | null;
  /** the alias that matched — shown to the user so a wrong guess is visible */
  via: string | null;
  sample: string;
};

/** Every alias, normalised once, longest first. "turnover previous fy" is tried
 *  before "turnover", so the longer header can never collapse into the shorter
 *  field. This ordering is the fix for the real bug the prototype had. */
const ALIASES: { alias: string; key: string }[] = IMPORT_FIELDS
  .flatMap(f => [f.header, ...f.aliases].map(a => ({ alias: normHeader(a), key: f.key })))
  .filter((x, i, arr) => x.alias && arr.findIndex(y => y.alias === x.alias) === i)
  .sort((a, b) => b.alias.length - a.alias.length);

/** Exact match on a whole header wins. Otherwise the longest alias that the
 *  header *contains as whole words*. Each field is claimed by one column only —
 *  the best (exact, then longest) wins; the loser is left for the user. */
export function matchHeaders(headers: unknown[], firstRow: unknown[] = []): ColumnMatch[] {
  const norm = headers.map(h => normHeader(h));
  const picks = norm.map((h, index) => {
    if (!h) return { index, key: null as string | null, via: null as string | null, score: 0 };
    const exact = ALIASES.find(a => a.alias === h);
    if (exact) return { index, key: exact.key, via: exact.alias, score: 1000 + exact.alias.length };
    // Very short aliases (name, pan, gst, bank…) are too generic to match inside a longer header.
    const hit = ALIASES.find(a => a.alias.length > 4 && ` ${h} `.includes(` ${a.alias} `));
    return hit ? { index, key: hit.key, via: hit.alias, score: hit.alias.length }
               : { index, key: null, via: null, score: 0 };
  });

  const best = new Map<string, number>();
  for (const p of picks) if (p.key && (best.get(p.key) === undefined || p.score > picks[best.get(p.key)!].score)) best.set(p.key, p.index);

  return picks.map(p => ({
    index: p.index,
    header: String(headers[p.index] ?? '').trim() || `(column ${p.index + 1})`,
    key: p.key && best.get(p.key) === p.index ? p.key : null,
    via: p.key && best.get(p.key) === p.index ? p.via : null,
    sample: String(firstRow[p.index] ?? '').slice(0, 40),
  }));
}
