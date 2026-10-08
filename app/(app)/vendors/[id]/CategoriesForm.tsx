'use client';
import { useActionState, useState } from 'react';
import { saveCategories, type SaveState } from './actions';
import SubmitButton from '@/app/SubmitButton';

export type Cat = { id: string; code: string; label: string;
                    subs: { id: string; code: string; label: string }[] };

export default function CategoriesForm({
  cats, selectedCats, selectedSubs, siteId, readOnly, servicesText,
}: {
  cats: Cat[]; selectedCats: string[]; selectedSubs: string[];
  siteId: string; readOnly: boolean; servicesText?: string | null;
}) {
  const [state, action] = useActionState<SaveState, FormData>(saveCategories, {});
  const [picked, setPicked] = useState<string[]>(selectedCats);
  const [subs, setSubs] = useState<string[]>(selectedSubs);

  const toggleCat = (c: Cat) => {
    if (readOnly) return;
    if (picked.includes(c.id)) {
      setPicked(p => p.filter(x => x !== c.id));
      setSubs(p => p.filter(s => !c.subs.some(sub => sub.id === s)));
    } else setPicked(p => [...p, c.id]);
  };
  const toggleSub = (id: string) => {
    if (readOnly) return;
    setSubs(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  };

  const servicesNote = servicesText && (
    <div className="note mb-4">
      <b>Services, as recorded:</b> {servicesText}
    </div>
  );

  if (!cats.length)
    return <>
      {servicesNote}
      <p className="text-[13.5px]" style={{ color: 'var(--faint)' }}>
        No categories configured for this industry. Run 03_reference_data.sql.
      </p>
    </>;

  return (
    <form action={action}>
      <input type="hidden" name="__site_id" value={siteId} />
      {picked.map(id => <input key={id} type="hidden" name="categories" value={id} />)}
      {subs.map(id => <input key={id} type="hidden" name="subcategories" value={id} />)}

      {servicesNote}
      <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
        Pick every category this site is registered or set up for. Where a category has
        sub-categories, pick at least one.
      </p>
      {state.error && <div className="note r mb-4">{state.error}</div>}
      {state.ok && <div className="note mb-4">{state.ok}</div>}

      <div className="flex gap-2 flex-wrap mb-4">
        {cats.map(c => (
          <button key={c.id} type="button" disabled={readOnly}
                  className={`chip ${picked.includes(c.id) ? 'c-g' : 'c-n'}`}
                  style={{ padding: '7px 14px', fontSize: 13, cursor: readOnly ? 'default' : 'pointer' }}
                  onClick={() => toggleCat(c)}>
            {c.label}
          </button>
        ))}
      </div>

      {picked.map(id => {
        const c = cats.find(x => x.id === id);
        if (!c || !c.subs.length) return null;
        const n = c.subs.filter(s => subs.includes(s.id)).length;
        return (
          <div key={id} className="card p-4 mb-3" style={{ background: 'var(--surface-2)' }}>
            <div className="flex justify-between items-center gap-3 mb-3 flex-wrap">
              <span className="text-[13px] font-bold" style={{ color: 'var(--head)' }}>{c.label}</span>
              <span className={`chip ${n ? 'c-g' : 'c-r'}`}>{n}/{c.subs.length} selected</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {c.subs.map(s => (
                <button key={s.id} type="button" disabled={readOnly}
                        className={`chip ${subs.includes(s.id) ? 'c-g' : 'c-n'}`}
                        style={{ padding: '6px 12px', fontSize: 12.5, cursor: readOnly ? 'default' : 'pointer' }}
                        onClick={() => toggleSub(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
            {!n && <div className="err mt-2">Pick at least one, or remove the category.</div>}
          </div>
        );
      })}

      {picked.some(id => {
        const c = cats.find(x => x.id === id);
        return c && !c.subs.length;
      }) && (
        <div className="hint mb-3">
          Categories without sub-categories are complete on their own — those lists have not been supplied yet.
        </div>
      )}

      {!readOnly && (
        <div className="mt-5">
          <SubmitButton pendingText="Saving…">Save categories</SubmitButton>
        </div>
      )}
    </form>
  );
}
