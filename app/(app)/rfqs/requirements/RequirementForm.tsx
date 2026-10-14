'use client';
import { useActionState, useState } from 'react';
import { createRequirement, type FormState } from '../actions';
import { INDUSTRIES, STATES } from '@/lib/constants';
import SubmitButton from '@/app/SubmitButton';

export default function RequirementForm() {
  const [state, action] = useActionState<FormState, FormData>(createRequirement, {});
  const [geo, setGeo] = useState<string[]>([]);

  return (
    <form action={action}>
      {state.error && <div className="note r mb-4">{state.error}</div>}
      {state.ok && <div className="note mb-4">{state.ok}</div>}

      <div className="grid md:grid-cols-4 gap-4 mb-4">
        <div className="md:col-span-2">
          <label className="lab" htmlFor="title">Title</label>
          <input id="title" name="title" required placeholder="e.g. 50 MT/month PET scrap, NCR" />
        </div>
        <div>
          <label className="lab" htmlFor="industry">Industry</label>
          <select id="industry" name="industry" required>
            <option value="">Select…</option>
            {INDUSTRIES.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
          </select>
        </div>
        <div>
          <label className="lab" htmlFor="needed_by">Needed by</label>
          <input id="needed_by" name="needed_by" type="date" />
        </div>
        <div>
          <label className="lab" htmlFor="quantity">Quantity</label>
          <input id="quantity" name="quantity" type="number" step="any" />
        </div>
        <div>
          <label className="lab" htmlFor="unit">Unit</label>
          <input id="unit" name="unit" placeholder="MT, pieces, trips…" />
        </div>
        <div>
          <label className="lab" htmlFor="target_price">Target price</label>
          <input id="target_price" name="target_price" type="number" step="any" />
        </div>
        <div className="md:col-span-4">
          <label className="lab" htmlFor="description">Description</label>
          <textarea id="description" name="description" rows={2} />
        </div>
      </div>

      <label className="lab">Geography</label>
      <div className="flex gap-2 flex-wrap mb-4">
        {STATES.map(s => {
          const on = geo.includes(s);
          return (
            <button key={s} type="button"
                    className={`chip ${on ? 'c-g tick' : 'c-n'}`}
                    style={{ padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' }}
                    onClick={() => setGeo(p => on ? p.filter(x => x !== s) : [...p, s])}>
              {on && '✓ '}{s}
            </button>
          );
        })}
      </div>
      {geo.map(s => <input key={s} type="hidden" name="geography" value={s} />)}

      <SubmitButton pendingText="Adding…">Add requirement</SubmitButton>
    </form>
  );
}
