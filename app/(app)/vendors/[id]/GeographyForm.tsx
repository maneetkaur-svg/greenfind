'use client';
import { useActionState, useState } from 'react';
import { saveGeography, type SaveState } from './actions';
import { REGIONS, STATES } from '@/lib/constants';
import SubmitButton from '@/app/SubmitButton';

export default function GeographyForm({
  selected, siteId, readOnly,
}: { selected: string[]; siteId: string; readOnly: boolean }) {
  const [state, action] = useActionState<SaveState, FormData>(saveGeography, {});
  const [picked, setPicked] = useState<string[]>(selected);
  const [openRegions, setOpenRegions] = useState<string[]>(
    REGIONS.filter(([, , sts]) => sts.some(s => selected.includes(s))).map(([k]) => k)
  );

  const toggleRegion = (code: string, states: string[]) => {
    if (readOnly) return;
    if (openRegions.includes(code)) {
      setOpenRegions(p => p.filter(r => r !== code));
      setPicked(p => p.filter(s => !states.includes(s)));
    } else {
      setOpenRegions(p => [...p, code]);
      setPicked(p => [...new Set([...p, ...states])]);
    }
  };
  const toggleState = (s: string) => {
    if (readOnly) return;
    setPicked(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
  };
  const panIndia = picked.length === STATES.length;

  return (
    <form action={action}>
      <input type="hidden" name="__site_id" value={siteId} />
      {picked.map(s => <input key={s} type="hidden" name="states" value={s} />)}

      <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
        Pick a region and its states appear, all selected. Untick anything this site does not serve.
      </p>
      {state.error && <div className="note r mb-4">{state.error}</div>}
      {state.ok && <div className="note mb-4">{state.ok}</div>}

      <div className="flex gap-2 flex-wrap mb-4">
        <button type="button" disabled={readOnly}
                className={`chip ${panIndia ? 'c-g' : 'c-n'}`}
                style={{ padding: '7px 14px', fontSize: 13, cursor: readOnly ? 'default' : 'pointer' }}
                onClick={() => {
                  if (readOnly) return;
                  if (panIndia) { setPicked([]); setOpenRegions([]); }
                  else { setPicked([...STATES]); setOpenRegions(REGIONS.map(r => r[0])); }
                }}>
          Pan India
        </button>
        {REGIONS.map(([code, label, sts]) => {
          const on = openRegions.includes(code);
          const n = sts.filter(s => picked.includes(s)).length;
          return (
            <button key={code} type="button" disabled={readOnly}
                    className={`chip ${on ? 'c-g' : 'c-n'}`}
                    style={{ padding: '7px 14px', fontSize: 13, cursor: readOnly ? 'default' : 'pointer' }}
                    onClick={() => toggleRegion(code, sts)}>
              {label}{on && ` · ${n}/${sts.length}`}
            </button>
          );
        })}
      </div>

      {openRegions.map(code => {
        const region = REGIONS.find(r => r[0] === code);
        if (!region) return null;
        const [, label, sts] = region;
        return (
          <div key={code} className="card p-4 mb-3" style={{ background: 'var(--surface-2)' }}>
            <div className="text-[13px] font-bold mb-3" style={{ color: 'var(--head)' }}>{label}</div>
            <div className="flex gap-2 flex-wrap">
              {sts.map(s => (
                <button key={s} type="button" disabled={readOnly}
                        className={`chip ${picked.includes(s) ? 'c-g' : 'c-n'}`}
                        style={{ padding: '6px 12px', fontSize: 12.5, cursor: readOnly ? 'default' : 'pointer' }}
                        onClick={() => toggleState(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <div className="hint">{picked.length} of {STATES.length} states selected.</div>

      {!readOnly && (
        <div className="mt-5">
          <SubmitButton pendingText="Saving…">Save geography</SubmitButton>
        </div>
      )}
    </form>
  );
}
