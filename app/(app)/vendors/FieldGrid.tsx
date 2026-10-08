'use client';
import type { Field } from '@/lib/schema';

/** Renders a list of fields. Shared by the create wizard and the record editor,
 *  so a field added to lib/schema.ts appears in both without further work. */
export default function FieldGrid({
  fields, values, onChange, disabled,
}: {
  fields: Field[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}) {
  const visible = fields.filter(f => !f.showIf || f.showIf(values));

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {visible.map(f => {
        const v = values[f.key];
        const wide = !f.half || f.type === 'longtext';
        return (
          <div key={f.key} className={wide ? 'md:col-span-2' : ''}>
            <label className="lab" htmlFor={f.key}>
              {f.label} {f.required && <span className="req">*</span>}
            </label>

            {f.type === 'readonly' ? (
              <input id={f.key} value={f.options?.find(([val]) => val === v)?.[1] ?? String(v ?? '')} disabled
                     placeholder={f.placeholder} />
            ) : f.type === 'bool' ? (
              <select id={f.key} disabled={disabled}
                      value={v === true ? 'true' : v === false ? 'false' : ''}
                      onChange={e => onChange(f.key,
                        e.target.value === 'true' ? true
                        : e.target.value === 'false' ? false : null)}>
                <option value="">Not set</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : f.type === 'select' ? (
              <select id={f.key} disabled={disabled} value={String(v ?? '')}
                      onChange={e => onChange(f.key, e.target.value)}>
                <option value="">Select…</option>
                {(f.options ?? []).map(([val, lab]) => (
                  <option key={val} value={val}>{lab}</option>
                ))}
              </select>
            ) : f.type === 'longtext' ? (
              <textarea id={f.key} disabled={disabled} rows={3}
                        placeholder={f.placeholder} value={String(v ?? '')}
                        onChange={e => onChange(f.key, e.target.value)} />
            ) : (
              <input id={f.key} disabled={disabled}
                     type={f.type === 'number' || f.type === 'currency' ? 'number'
                          : f.type === 'date' ? 'date' : 'text'}
                     step={f.type === 'number' || f.type === 'currency' ? 'any' : undefined}
                     maxLength={f.max} placeholder={f.placeholder}
                     value={String(v ?? '')}
                     onChange={e => onChange(f.key, e.target.value)} />
            )}

            {f.hint && <div className="hint">{f.hint}</div>}
          </div>
        );
      })}
    </div>
  );
}
