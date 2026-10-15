'use client';
import { useActionState, useState, useEffect } from 'react';
import { saveSection, type SaveState } from './actions';
import { SECTIONS } from '@/lib/schema';
import SubmitButton from '@/app/SubmitButton';
import PlantBlocks, { blankPlant, type Plant } from '../PlantBlocks';

/** Takes the section id, not the section. The definitions contain showIf
 *  functions, and a function cannot be passed from a server component to a
 *  client one — React throws when it tries to serialise it. Looking it up
 *  here keeps only plain strings crossing the boundary. */
export default function SectionForm({
  sectionId, values, siteId, companyId, readOnly, isSuperAdmin, gstin, aadhaarLast4,
}: {
  sectionId: string;
  values: Record<string, unknown>;
  siteId: string;
  companyId: string;
  readOnly: boolean;
  isSuperAdmin: boolean;
  gstin?: string | null;
  aadhaarLast4?: string | null;
}) {
  const section = SECTIONS.find(s => s.id === sectionId);
  const [state, action] = useActionState<SaveState, FormData>(saveSection, {});
  const [live, setLive] = useState<Record<string, unknown>>(values);

  // The Facility section's plant block is not a plain Field — it's a
  // repeating array, driven by two of this same section's own fields
  // (is_registered_address, plant_count), so it lives here rather than
  // in the generic fields loop below. All hooks are declared unconditionally,
  // ahead of the "unknown section" early return below.
  const isSiteSection = sectionId === 'site';
  const sameAsRegistered = live.is_registered_address !== false;
  const plantCount = Math.min(50, Math.max(0, Math.floor(Number(live.plant_count) || 0)));
  const [plants, setPlants] = useState<Plant[]>(
    isSiteSection && Array.isArray(values.plants) ? (values.plants as Plant[]) : []);

  useEffect(() => {
    if (!isSiteSection) return;
    if (sameAsRegistered) { setPlants([]); return; }
    setPlants(prev => {
      if (prev.length === plantCount) return prev;
      const next = prev.slice(0, plantCount);
      while (next.length < plantCount) next.push({ ...blankPlant });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantCount, sameAsRegistered, isSiteSection]);

  const set = (k: string, v: unknown) => setLive(p => ({ ...p, [k]: v }));
  const setPlantField = (i: number, k: keyof Plant, v: string) =>
    setPlants(prev => prev.map((p, idx) => idx === i ? { ...p, [k]: v } : p));

  if (!section) return <p className="text-[13.5px]">Unknown section.</p>;
  const visible = section.fields.filter(f => !f.showIf || f.showIf(live));
  const isBlank = (v: unknown) => v === null || v === undefined || v === '';

  return (
    <form action={action}>
      <input type="hidden" name="__site_id" value={siteId} />
      <input type="hidden" name="__company_id" value={companyId} />
      <input type="hidden" name="__section" value={sectionId} />

      {section.blurb && (
        <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>{section.blurb}</p>
      )}
      {state.error && <div className="note r mb-4">{state.error}</div>}
      {state.ok && <div className="note mb-4">{state.ok}</div>}

      <div className="grid md:grid-cols-2 gap-4">
        {visible.map(f => {
          const v = live[f.key];
          const wide = !f.half || f.type === 'longtext';
          const locked = readOnly || (f.superAdminOnly && !isSuperAdmin);
          const incomplete = !!f.required && f.type !== 'readonly' && isBlank(v);
          const fieldStyle = incomplete ? { borderColor: 'var(--err)' } : undefined;
          return (
            <div key={f.key} className={wide ? 'md:col-span-2' : ''}
                 style={incomplete ? { borderLeft: '3px solid var(--err)', paddingLeft: 10, marginLeft: -13 } : undefined}>
              <label className="lab" htmlFor={f.key}>
                {incomplete && <span className="inline-block rounded-full mr-1"
                                      style={{ width: 7, height: 7, background: 'var(--err)' }} />}
                {f.label} {f.required && <span className="req">*</span>}
                {f.superAdminOnly && !isSuperAdmin && <span className="chip c-n ml-1">SUPER ADMIN</span>}
              </label>

              {f.type === 'readonly' || (f.superAdminOnly && !isSuperAdmin) ? (
                <>
                  {/* A disabled <select> renders faint-to-illegible on some
                      browsers regardless of our own CSS, so a value locked by
                      permission (not just the readonly fields that are
                      always locked) gets the same plain, clearly-visible
                      text treatment rather than a native disabled control. */}
                  <input id={f.key} value={f.options?.find(([val]) => val === v)?.[1] ?? (String(v ?? '') || '—')} disabled />
                  {f.key === 'entity' && !gstin && (
                    <div className="hint">
                      {aadhaarLast4 ? `No GST — Aadhaar ••••${aadhaarLast4} on file instead.` : 'No GST or Aadhaar on file.'}
                    </div>
                  )}
                </>
              ) : f.type === 'bool' ? (
                <select id={f.key} name={f.key} disabled={locked} style={fieldStyle}
                        value={v === true ? 'true' : v === false ? 'false' : ''}
                        onChange={e => set(f.key, e.target.value === 'true' ? true
                                       : e.target.value === 'false' ? false : null)}>
                  <option value="">Not set</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : f.type === 'select' ? (
                <select id={f.key} name={f.key} disabled={locked} style={fieldStyle}
                        value={String(v ?? '')}
                        onChange={e => set(f.key, e.target.value)}>
                  <option value="">Select…</option>
                  {(f.options ?? []).map(([val, lab]) => (
                    <option key={val} value={val}>{lab}</option>
                  ))}
                </select>
              ) : f.type === 'longtext' ? (
                <textarea id={f.key} name={f.key} disabled={locked} rows={3} style={fieldStyle}
                          placeholder={f.placeholder}
                          value={String(v ?? '')}
                          onChange={e => set(f.key, e.target.value)} />
              ) : (
                <input id={f.key} name={f.key} disabled={locked} style={fieldStyle}
                       type={f.type === 'number' || f.type === 'currency' ? 'number'
                            : f.type === 'date' ? 'date' : 'text'}
                       step={f.type === 'number' || f.type === 'currency' ? 'any' : undefined}
                       min={f.type === 'number' || f.type === 'currency' ? f.min : undefined}
                       max={f.type === 'number' || f.type === 'currency' ? f.max : undefined}
                       maxLength={f.type === 'number' || f.type === 'currency' ? undefined : f.max}
                       placeholder={f.placeholder}
                       value={String(v ?? '')}
                       onWheel={e => {
                         // Scrolling over a focused number input silently changes its
                         // value in most browsers — never wanted here.
                         if (f.type === 'number' || f.type === 'currency') e.currentTarget.blur();
                       }}
                       onChange={e => {
                         let val = e.target.value;
                         if ((f.type === 'number' || f.type === 'currency') && val !== '') {
                           const n = Number(val);
                           if (!Number.isNaN(n)) {
                             if (f.max !== undefined && n > f.max) val = String(f.max);
                             else if (f.min !== undefined && n < f.min) val = String(f.min);
                           }
                         }
                         set(f.key, val);
                       }} />
              )}

              {f.hint && <div className="hint">{f.hint}</div>}
            </div>
          );
        })}
      </div>

      {isSiteSection && !sameAsRegistered && (
        <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <input type="hidden" name="__plants" value={JSON.stringify(plants)} />
          <PlantBlocks plants={plants} onChange={setPlantField} disabled={readOnly} />
        </div>
      )}

      {!readOnly && (
        <div className="mt-5">
          <SubmitButton pendingText="Saving…">Save {section.label}</SubmitButton>
        </div>
      )}
    </form>
  );
}
