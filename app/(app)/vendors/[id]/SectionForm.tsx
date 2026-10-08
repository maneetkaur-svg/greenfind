'use client';
import { useActionState, useState } from 'react';
import { saveSection, type SaveState } from './actions';
import { SECTIONS } from '@/lib/schema';
import SubmitButton from '@/app/SubmitButton';

/** Takes the section id, not the section. The definitions contain showIf
 *  functions, and a function cannot be passed from a server component to a
 *  client one — React throws when it tries to serialise it. Looking it up
 *  here keeps only plain strings crossing the boundary. */
export default function SectionForm({
  sectionId, values, siteId, companyId, readOnly, isSuperAdmin,
}: {
  sectionId: string;
  values: Record<string, unknown>;
  siteId: string;
  companyId: string;
  readOnly: boolean;
  isSuperAdmin: boolean;
}) {
  const section = SECTIONS.find(s => s.id === sectionId);
  const [state, action] = useActionState<SaveState, FormData>(saveSection, {});
  const [live, setLive] = useState<Record<string, unknown>>(values);
  const [gst, setGst] = useState<{ busy: boolean; msg: string; err: string }>({ busy: false, msg: '', err: '' });

  const set = (k: string, v: unknown) => setLive(p => ({ ...p, [k]: v }));
  if (!section) return <p className="text-[13.5px]">Unknown section.</p>;
  const visible = section.fields.filter(f => !f.showIf || f.showIf(live));
  const isBlank = (v: unknown) => v === null || v === undefined || v === '';

  const verifyFromGst = async () => {
    setGst({ busy: true, msg: '', err: '' });
    try {
      const res = await fetch('/api/verify-gst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: siteId }),
      });
      const data = await res.json();
      if (!res.ok) { setGst({ busy: false, msg: '', err: data.error ?? 'Could not verify.' }); return; }
      set('entity', data.entity); // the <select> re-renders with this immediately
      setGst({ busy: false, msg: `Set from GST: ${data.ctb}.`, err: '' });
    } catch {
      setGst({ busy: false, msg: '', err: 'Could not reach the server.' });
    }
  };

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

              {f.type === 'readonly' ? (
                <input id={f.key} value={String(v ?? '')} disabled />
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
                <>
                  <select id={f.key} name={f.key} disabled={locked} style={fieldStyle}
                          value={String(v ?? '')}
                          onChange={e => set(f.key, e.target.value)}>
                    <option value="">Select…</option>
                    {(f.options ?? []).map(([val, lab]) => (
                      <option key={val} value={val}>{lab}</option>
                    ))}
                  </select>
                  {f.key === 'entity' && !locked && (
                    <div className="mt-2">
                      <button type="button" className="btn btn-o" disabled={gst.busy}
                              style={{ padding: '6px 12px', fontSize: 12.5 }}
                              onClick={verifyFromGst}>
                        {gst.busy && <span className="spinner" aria-hidden="true" />}
                        {gst.busy ? 'Checking GST…' : 'Verify from GST'}
                      </button>
                      {gst.msg && <div className="hint" style={{ color: 'var(--p600)' }}>{gst.msg}</div>}
                      {gst.err && <div className="err mt-1">{gst.err}</div>}
                    </div>
                  )}
                </>
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
          <SubmitButton pendingText="Saving…">Save {section.label.toLowerCase()}</SubmitButton>
        </div>
      )}
    </form>
  );
}
