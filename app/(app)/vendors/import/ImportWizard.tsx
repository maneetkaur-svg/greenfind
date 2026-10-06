'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { IMPORT_FIELDS, FIELD_BY_KEY } from '@/lib/import/fields';
import { matchHeaders } from '@/lib/import/mapping';
import { readFile, splitSheet, type ReadResult } from '@/lib/import/readFile';
import { parseRow, checkFile, type FileCheck, type Mapping } from '@/lib/import/validate';
import { buildPlan } from '@/lib/import/plan';
import { downloadTemplate } from '@/lib/import/template';
import { checkExisting, importGroups, type GroupResult } from './actions';

type Step = 'file' | 'map' | 'check' | 'run' | 'done';
const MAX_ROWS = 5000;
const BATCH = 10;                       // companies per server call
const NEEDED = ['gstin', 'legal_name', 'industry', 'address_line1', 'city', 'pincode'];

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function saveCsv(name: string, rows: unknown[][]) {
  const blob = new Blob(['\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function ImportWizard({ canUndo }: { canUndo: boolean }) {
  const [step, setStep] = useState<Step>('file');
  const [fileName, setFileName] = useState('');
  const [wb, setWb] = useState<ReadResult | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [assign, setAssign] = useState<(string | null)[]>([]);      // column index → field key
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<FileCheck | null>(null);
  const [existingPans, setExistingPans] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<GroupResult[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const sheet = wb?.sheets[sheetIdx];
  const split = useMemo(() => (sheet ? splitSheet(sheet.rows) : null), [sheet]);
  const matches = useMemo(
    () => (split ? matchHeaders(split.headers, split.data[0]?.cells ?? []) : []),
    [split],
  );

  /* ---------- step 1: file ---------- */
  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(''); setBusy(true);
    try {
      const r = readFile(f.name, await f.arrayBuffer());
      setWb(r); setSheetIdx(r.defaultSheet); setFileName(f.name);
      pickSheet(r, r.defaultSheet);
      setStep('map');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.');
    } finally { setBusy(false); }
  }
  function pickSheet(r: ReadResult, i: number) {
    setSheetIdx(i);
    const s = splitSheet(r.sheets[i].rows);
    if (s.data.length > MAX_ROWS) setError(`This sheet has ${s.data.length} rows. The limit is ${MAX_ROWS} per import; split the file.`);
    else setError('');
    setAssign(matchHeaders(s.headers, s.data[0]?.cells ?? []).map(m => m.key));
  }

  /* ---------- step 2: mapping ---------- */
  function setCol(col: number, key: string | null) {
    setAssign(a => a.map((k, i) => (i === col ? key : key && k === key ? null : k)));   // a field can sit on one column only
  }
  const mapping: Mapping = useMemo(() => {
    const m: Mapping = {}; assign.forEach((k, i) => { if (k) m[k] = i; }); return m;
  }, [assign]);
  const missing = NEEDED.filter(k => !(k in mapping));

  /* ---------- step 3: data check ---------- */
  async function runCheck() {
    if (!split) return;
    setBusy(true); setError('');
    try {
      const rows = split.data.map(d => parseRow(d.cells, mapping, d.rowNumber));
      const keys = rows.filter(r => r.site.gstin && r.site.pincode).map(r => r.gstin);
      const ex = await checkExisting(keys, rows.map(r => r.pan).filter((p): p is string => !!p));
      if (ex.error) throw new Error(ex.error);
      setExistingPans(new Set(ex.pans));
      setCheck(checkFile(rows, new Set(ex.sites)));
      setStep('check');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The check failed.');
    } finally { setBusy(false); }
  }

  const plan = useMemo(() => (check ? buildPlan(check.rows) : null), [check]);

  function problemReport() {
    if (!check) return;
    const out: unknown[][] = [['Row', 'GSTIN', 'Company', 'Severity', 'Problem', 'Outcome']];
    for (const r of check.rows) for (const p of r.problems)
      out.push([r.rowNumber, r.gstin, r.company.legal_name ?? '', p.severity, p.message,
        p.severity === 'blocking' ? 'Held back — not imported' : 'Imported, value left blank']);
    saveCsv('import-problems.csv', out);
  }

  /* ---------- step 4: write ---------- */
  async function runImport() {
    if (!plan) return;
    setStep('run'); setResults([]); setError('');
    const groups = plan.companies.map(c => ({
      pan: c.pan, company: c.company,
      sites: c.sites.map(s => ({ row: s.rowNumber, site: s.site, contacts: s.contacts, geography: s.geography })),
    }));
    setProgress({ done: 0, total: groups.length });
    const all: GroupResult[] = [];
    for (let i = 0; i < groups.length; i += BATCH) {
      try {
        all.push(...await importGroups(groups.slice(i, i + BATCH)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'The request failed.';
        for (const g of groups.slice(i, i + BATCH))
          all.push({ pan: g.pan, error: msg, sites: g.sites.map(s => ({ row: s.row, ok: false, error: msg })) });
      }
      setProgress({ done: Math.min(i + BATCH, groups.length), total: groups.length });
      setResults([...all]);
    }
    setStep('done');
  }

  const saved = results.flatMap(g => g.sites.filter(s => s.ok));
  const refused = results.flatMap(g => g.sites.filter(s => !s.ok).map(s => ({ ...s, pan: g.pan })));
  const createdCompanies = results.filter(g => g.company_created);
  const undoSql = (() => {
    const siteCodes = saved.map(s => `'${s.site_code}'`);
    const coCodes = createdCompanies.map(g => `'${g.company_code}'`);
    if (!siteCodes.length) return '';
    return `-- Undo exactly this import (Super Admin, Supabase SQL Editor)\n` +
      `delete from vendor_site where site_code in (${siteCodes.join(', ')});\n` +
      (coCodes.length ? `delete from company where company_code in (${coCodes.join(', ')});\n` : '');
  })();

  function reset() {
    setStep('file'); setWb(null); setCheck(null); setResults([]); setError(''); setAssign([]); setFileName('');
    if (input.current) input.current.value = '';
  }

  /* ---------- render ---------- */
  const stepper = (
    <div className="flex gap-2 mb-5 text-[12.5px] font-bold flex-wrap">
      {([['file', '1 · File'], ['map', '2 · Columns'], ['check', '3 · Check'], ['done', '4 · Import']] as [Step, string][]).map(([s, label]) => {
        const order: Step[] = ['file', 'map', 'check', 'run', 'done'];
        const active = s === step || (s === 'done' && step === 'run');
        const past = order.indexOf(step) > order.indexOf(s);
        return <span key={s} className={`chip ${active ? 'c-g' : past ? 'c-n' : 'c-n'}`} style={{ opacity: active || past ? 1 : .55 }}>{label}</span>;
      })}
    </div>
  );

  return (
    <div>
      {stepper}
      {error && <div className="note r mb-4"><b>{error}</b></div>}

      {step === 'file' && (
        <div className="card p-6">
          <div
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}
            className="rounded-xl p-10 text-center"
            style={{ border: `2px dashed ${drag ? 'var(--p500)' : 'var(--line-2)'}`, background: drag ? 'var(--p50)' : 'transparent' }}>
            <p className="font-bold mb-1">Drop a file here</p>
            <p className="hint mb-4">.xlsx, .xls, .csv or .json</p>
            <label className="btn btn-p cursor-pointer">
              Choose a file
              <input ref={input} data-testid="import-file" type="file" accept=".xlsx,.xls,.csv,.json" className="hidden"
                     onChange={e => onFile(e.target.files?.[0])} />
            </label>
            {busy && <p className="hint mt-3">Reading…</p>}
          </div>
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <button type="button" className="btn btn-o" onClick={downloadTemplate}>Download the Excel template</button>
            <span className="hint" style={{ marginTop: 0 }}>Three sheets: the data sheet, how to fill it, and an example.</span>
          </div>
        </div>
      )}

      {step === 'map' && split && wb && (
        <div className="card p-6">
          <div className="flex justify-between gap-3 flex-wrap mb-3">
            <div>
              <h2 className="text-[17px] font-bold">Match the columns</h2>
              <p className="hint">{fileName} · {split.data.length} row{split.data.length === 1 ? '' : 's'}. Each match is a guess — change any that is wrong, or leave a column out.</p>
            </div>
            {wb.sheets.length > 1 && (
              <label className="text-[13px] font-semibold">Sheet{' '}
                <select value={sheetIdx} onChange={e => pickSheet(wb, +e.target.value)} className="ml-1">
                  {wb.sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                </select>
              </label>
            )}
          </div>

          {missing.length > 0 && (
            <div className="note a mb-4">
              <b>Not matched yet:</b> {missing.map(k => FIELD_BY_KEY[k].header).join(', ')}.
              <div className="hint">Rows cannot be saved without these (State can be filled from the GSTIN). They will be held back and listed.</div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>Column in your file</th><th>Example</th><th>Goes to</th></tr></thead>
              <tbody>
                {matches.map(m => (
                  <tr key={m.index}>
                    <td className="font-semibold text-[13.5px]">{m.header}</td>
                    <td className="text-[13px]" style={{ color: 'var(--faint)' }}>{m.sample || '—'}</td>
                    <td>
                      <select aria-label={`Field for ${m.header}`} value={assign[m.index] ?? ''}
                              onChange={e => setCol(m.index, e.target.value || null)} style={{ minWidth: 230 }}>
                        <option value="">— don’t import —</option>
                        {IMPORT_FIELDS.map(f => <option key={f.key} value={f.key}>{f.header}{f.required ? ' *' : ''}</option>)}
                      </select>
                      {assign[m.index] && assign[m.index] === m.key && m.via && (
                        <div className="hint">matched on “{m.via}”</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3 mt-5">
            <button type="button" className="btn btn-o" onClick={reset}>Back</button>
            <button type="button" className="btn btn-p" disabled={busy || split.data.length === 0 || split.data.length > MAX_ROWS || !('gstin' in mapping)}
                    onClick={runCheck}>{busy ? 'Checking…' : 'Check the data'}</button>
            {!('gstin' in mapping) && <span className="hint self-center" style={{ marginTop: 0 }}>A GSTIN column is needed to continue.</span>}
          </div>
        </div>
      )}

      {step === 'check' && check && plan && (
        <div className="card p-6">
          <h2 className="text-[17px] font-bold mb-3">Review before anything is saved</h2>
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            {[
              ['Rows in file', check.rows.length, 'c-n'],
              ['Clean', check.clean, 'c-g'],
              ['Will import', check.importable, 'c-g'],
              ['Imported with a blank value', check.importable - check.clean, 'c-a'],
              ['Held back', check.held, check.held ? 'c-r' : 'c-n'],
            ].map(([label, n, cls]) => (
              <div key={String(label)} className="card p-3">
                <div className="text-[24px] font-bold" data-testid={`stat-${String(label).toLowerCase().replace(/[^a-z]+/g, '-')}`}>{n}</div>
                <div className={`chip ${cls}`}>{label}</div>
              </div>
            ))}
          </div>

          <p className="text-[13.5px] mb-4">
            This will add <b>{plan.companies.filter(c => !existingPans.has(c.pan)).length}</b> new compan{plan.companies.filter(c => !existingPans.has(c.pan)).length === 1 ? 'y' : 'ies'} and <b>{check.importable}</b> site{check.importable === 1 ? '' : 's'}.
            {plan.companies.some(c => existingPans.has(c.pan)) && (
              <> {plan.companies.filter(c => existingPans.has(c.pan)).length} compan{plan.companies.filter(c => existingPans.has(c.pan)).length === 1 ? 'y is' : 'ies are'} already on record under the same PAN; the new sites attach to them and their company details are left exactly as they are.</>
            )}
          </p>

          {check.byProblem.length === 0 ? (
            <div className="note mb-4"><b>No problems found.</b></div>
          ) : (
            <div className="mb-4">
              {check.byProblem.map(p => (
                <details key={p.code} className="card mb-2 p-3" open={p.severity === 'blocking'}>
                  <summary className="cursor-pointer font-semibold text-[13.5px]">
                    <span className={`chip ${p.severity === 'blocking' ? 'c-r' : 'c-a'} mr-2`}>{p.severity === 'blocking' ? 'HELD BACK' : 'FIXABLE'}</span>
                    {p.title} <span style={{ color: 'var(--faint)' }}>· {p.rows.length} row{p.rows.length === 1 ? '' : 's'}</span>
                  </summary>
                  <div className="hint mt-2">
                    {p.severity === 'blocking' ? 'The database cannot store these rows as they are, so they are not imported.' : 'These rows import; the bad value is left blank so you can fix it on the record.'}
                  </div>
                  <div className="text-[13px] mt-2">Rows: {p.rows.slice(0, 25).join(', ')}{p.rows.length > 25 ? ` … and ${p.rows.length - 25} more` : ''}</div>
                  <ul className="text-[12.5px] mt-2" style={{ color: 'var(--muted)' }}>
                    {check.rows.filter(r => r.problems.some(x => x.code === p.code)).slice(0, 3).map(r => (
                      <li key={r.rowNumber}>Row {r.rowNumber}: {r.problems.find(x => x.code === p.code)!.message}</li>
                    ))}
                  </ul>
                </details>
              ))}
              <button type="button" className="btn btn-o mt-1" onClick={problemReport}>Download the full problem list (CSV)</button>
            </div>
          )}

          <div className="flex gap-3 items-center flex-wrap">
            <button type="button" className="btn btn-o" onClick={() => setStep('map')}>Back</button>
            <button type="button" className="btn btn-p" disabled={check.importable === 0} onClick={runImport}>
              Import {check.importable} row{check.importable === 1 ? '' : 's'}
            </button>
            {check.importable === 0 && <span className="hint" style={{ marginTop: 0 }}>Nothing can be imported yet — see the problems above.</span>}
          </div>
        </div>
      )}

      {step === 'run' && (
        <div className="card p-6">
          <h2 className="text-[17px] font-bold mb-2">Importing…</h2>
          <div style={{ height: 8, background: 'var(--line)', borderRadius: 99 }}>
            <div style={{ height: 8, width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: 'var(--p500)', borderRadius: 99, transition: 'width .2s' }} />
          </div>
          <p className="hint">{progress.done} of {progress.total} companies. Keep this page open.</p>
        </div>
      )}

      {step === 'done' && (
        <div className="card p-6">
          <h2 className="text-[17px] font-bold mb-3" data-testid="import-done">Import finished</h2>
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            <div className="card p-3"><div className="text-[24px] font-bold" data-testid="done-sites">{saved.length}</div><span className="chip c-g">Sites saved</span></div>
            <div className="card p-3"><div className="text-[24px] font-bold" data-testid="done-companies">{createdCompanies.length}</div><span className="chip c-g">New companies</span></div>
            <div className="card p-3"><div className="text-[24px] font-bold">{refused.length}</div><span className={`chip ${refused.length ? 'c-r' : 'c-n'}`}>Refused by the database</span></div>
            <div className="card p-3"><div className="text-[24px] font-bold">{check?.held ?? 0}</div><span className={`chip ${check?.held ? 'c-a' : 'c-n'}`}>Held back at check</span></div>
          </div>

          {refused.length > 0 && (
            <div className="note r mb-4">
              <b>These rows were not saved:</b>
              <ul className="text-[13px] mt-1">
                {refused.slice(0, 20).map(r => <li key={`${r.pan}-${r.row}`}>Row {r.row}: {r.error}</li>)}
                {refused.length > 20 && <li>… and {refused.length - 20} more</li>}
              </ul>
            </div>
          )}

          <p className="text-[13.5px] mb-3">
            Everything imported is marked <b>migrated</b>. Service categories are not part of the import — open each vendor to set them, and upload its documents.
          </p>

          {undoSql && (
            <details className="card p-3 mb-4">
              <summary className="cursor-pointer font-semibold text-[13.5px]">Undo this import</summary>
              <p className="hint mt-2">{canUndo
                ? 'Run this in the Supabase SQL Editor. It removes only what this import added.'
                : 'Only a Super Admin can delete. Give this to one if the import needs to be reversed.'}</p>
              <pre className="text-[12px] mt-2 p-3 overflow-x-auto" style={{ background: 'var(--surface-2)', borderRadius: 8 }}>{undoSql}</pre>
              <button type="button" className="btn btn-o mt-2" onClick={() => navigator.clipboard?.writeText(undoSql)}>Copy</button>
            </details>
          )}

          <div className="flex gap-3">
            <Link href="/vendors" className="btn btn-p">See the vendors</Link>
            <button type="button" className="btn btn-o" onClick={reset}>Import another file</button>
          </div>
        </div>
      )}
    </div>
  );
}
