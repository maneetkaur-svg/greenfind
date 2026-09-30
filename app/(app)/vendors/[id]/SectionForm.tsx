'use client';
import { useActionState, useState } from 'react';
import { saveSection, type SaveState } from './actions';
import type { Section } from '@/lib/schema';

export default function SectionForm({
  section, values, siteId, companyId, readOnly,
}: {
  section: Section;
  values: Record<string, unknown>;
  siteId: string;
  companyId: string;
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveSection, {});
  const [live, setLive] = useState<Record<string, unknown>>(values);

  const set = (k: string, v: unknown) => setLive(p => ({ ...p, [k]: v }));
  const visible = section.fields.filter(f => !f.showIf || f.showIf(live));

  return (
    <form action={action}>
      <input type="hidden" name="__site_id" value={siteId} />
      <input type="hidden" name="__company_id" value={companyId} />
      <input type="hidden" name="__section" value={section.id} />

      {section.blurb && (
        <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>{section.blurb}</p>
      )}
      {state.error && <div className="note r mb-4">{state.error}</div>}
      {state.ok && <div className="note mb-4">{state.ok}</div>}

      <div className="grid md:grid-cols-2 gap-4">
        {visible.map(f => {
          const v = live[f.key];
          const wide = !f.half || f.type === 'longtext';
          return (
            <div key={f.key} className={wide ? 'md:col-span-2' : ''}>
              <label className="lab" htmlFor={f.key}>
                {f.label} {f.required && <span className="req">*</span>}
              </label>

              {f.type === 'readonly' ? (
                <input id={f.key} value={String(v ?? '')} disabled />
              ) : f.type === 'bool' ? (
                <select id={f.key} name={f.key} disabled={readOnly}
                        value={v === true ? 'true' : v === false ? 'false' : ''}
                        onChange={e => set(f.key, e.target.value === 'true' ? true
                                       : e.target.value === 'false' ? false : null)}>
                  <option value="">Not set</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : f.type === 'select' ? (
                <select id={f.key} name={f.key} disabled={readOnly}
                        value={String(v ?? '')}
                        onChange={e => set(f.key, e.target.value)}>
                  <option value="">Select…</option>
                  {(f.options ?? []).map(([val, lab]) => (
                    <option key={val} value={val}>{lab}</option>
                  ))}
                </select>
              ) : f.type === 'longtext' ? (
                <textarea id={f.key} name={f.key} disabled={readOnly} rows={3}
                          placeholder={f.placeholder}
                          value={String(v ?? '')}
                          onChange={e => set(f.key, e.target.value)} />
              ) : (
                <input id={f.key} name={f.key} disabled={readOnly}
                       type={f.type === 'number' || f.type === 'currency' ? 'number'
                            : f.type === 'date' ? 'date' : 'text'}
                       step={f.type === 'number' || f.type === 'currency' ? 'any' : undefined}
                       maxLength={f.max}
                       placeholder={f.placeholder}
                       value={String(v ?? '')}
                       onChange={e => set(f.key, e.target.value)} />
              )}

              {f.hint && <div className="hint">{f.hint}</div>}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div className="mt-5">
          <button className="btn btn-p" disabled={pending}>
            {pending ? 'Saving…' : 'Save ' + section.label.toLowerCase()}
          </button>
        </div>
      )}
    </form>
  );
}
