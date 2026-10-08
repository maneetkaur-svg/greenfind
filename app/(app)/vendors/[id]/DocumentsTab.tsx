'use client';
import { useActionState, useState } from 'react';
import { uploadDocument, removeDocument, getDownloadUrl,
         type DocState } from './documentActions';
import SubmitButton from '@/app/SubmitButton';

export type DocType = {
  code: string; label: string; applies_to: string | null;
  expiry_tracked: boolean; uploaded_by_party: string;
  level: string;
};
export type DocRow = {
  id: string; doc_type: string; file_name: string; file_size: number | null;
  doc_number: string | null; valid_until: string | null;
  uploaded_at: string;
  storage_path: string;
};

const size = (b: number | null) =>
  !b ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB`
  : `${(b / 1048576).toFixed(1)} MB`;

const daysLeft = (d: string | null) => {
  if (!d) return null;
  return Math.round((new Date(d).getTime() - Date.now()) / 86400000);
};

export default function DocumentsTab({
  types, docs, siteId, readOnly,
}: { types: DocType[]; docs: DocRow[]; siteId: string; readOnly: boolean }) {
  const [state, action] = useActionState<DocState, FormData>(uploadDocument, {});
  const [open, setOpen] = useState<string | null>(null);

  const have = (code: string) => docs.find(d => d.doc_type === code);
  const required = types.filter(t => t.level === 'required' && t.uploaded_by_party === 'vendor');
  const done = required.filter(t => have(t.code)).length;
  const expiringSoon = docs.filter(d => {
    const n = daysLeft(d.valid_until);
    return n !== null && n < 60;
  }).length;

  const view = async (path: string) => {
    const url = await getDownloadUrl(path);
    if (url) window.open(url, '_blank');
  };

  const chip = (level: string) =>
    level === 'required' ? 'c-r' : level === 'conditional' ? 'c-a'
    : level === 'recommended' ? 'c-n' : 'c-n';

  return (
    <>
      <div className="grid md:grid-cols-3 gap-4 mb-5">
        {[['Required attached', `${done}/${required.length}`],
          ['On file', String(docs.length)],
          ['Expiring or expired', String(expiringSoon)]].map(([k, v]) => (
          <div key={k} className="card p-4 text-center" style={{ background: 'var(--surface-2)' }}>
            <div className="text-[21px] font-bold" style={{ color: 'var(--head)' }}>{v}</div>
            <div className="text-[10.5px] font-bold uppercase tracking-[.07em] mt-1"
                 style={{ color: 'var(--faint)' }}>{k}</div>
          </div>
        ))}
      </div>

      {state.error && <div className="note r mb-4">{state.error}</div>}
      {state.ok && <div className="note mb-4">{state.ok}</div>}

      <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
        Only what applies to this industry is listed. PDF, JPG or PNG, up to 10 MB.
      </p>

      {types.map(t => {
        const d = have(t.code);
        const left = daysLeft(d?.valid_until ?? null);
        const expiring = left !== null && left < 60;
        const isOpen = open === t.code;

        return (
          <div key={t.code} className="card p-4 mb-3"
               style={d ? { borderColor: 'var(--p400)', background: 'var(--p50)' } : undefined}>
            <div className="flex gap-3 items-center flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="text-[13.5px] font-bold" style={{ color: 'var(--head)' }}>
                  {t.label}
                </div>
                <div className="text-[12px]" style={{ color: 'var(--faint)' }}>
                  {d ? (
                    <>
                      {d.file_name}
                      {d.file_size && ` · ${size(d.file_size)}`}
                      {d.doc_number && ` · no. ${d.doc_number}`}
                      {d.valid_until && ` · valid to ${d.valid_until}`}
                      {t.expiry_tracked && !d.valid_until && ' · no expiry recorded'}
                    </>
                  ) : (
                    <>{t.applies_to}{t.expiry_tracked && ' · expiry tracked'}
                      {t.uploaded_by_party === 'fitsol' && ' · issued by Fitsol'}</>
                  )}
                </div>
              </div>

              {expiring && left !== null && (
                <span className="chip c-a">
                  {left < 0 ? `EXPIRED ${Math.abs(left)}d AGO` : `${left}d LEFT`}
                </span>
              )}
              <span className={`chip ${chip(t.level)}`}>{t.level.toUpperCase()}</span>

              <div className="flex gap-2 flex-wrap">
                {d && (
                  <button type="button" className="btn btn-o"
                          style={{ padding: '6px 12px', fontSize: 13 }}
                          onClick={() => view(d.storage_path)}>View</button>
                )}
                {!readOnly && (
                  <button type="button" className="btn btn-o"
                          style={{ padding: '6px 12px', fontSize: 13 }}
                          onClick={() => setOpen(isOpen ? null : t.code)}>
                    {d ? 'Replace' : 'Upload'}
                  </button>
                )}
                {d && !readOnly && (
                  <form action={removeDocument}>
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="site_id" value={siteId} />
                    <button className="btn btn-o"
                            style={{ padding: '6px 12px', fontSize: 13, color: 'var(--err)',
                                     borderColor: 'rgba(239,68,68,.35)' }}>Remove</button>
                  </form>
                )}
              </div>
            </div>

            {isOpen && !readOnly && (
              <form action={action} className="mt-4 pt-4 border-t"
                    style={{ borderColor: 'var(--line)' }}>
                <input type="hidden" name="site_id" value={siteId} />
                <input type="hidden" name="doc_type" value={t.code} />
                <div className="grid md:grid-cols-3 gap-4">
                  <div className={t.expiry_tracked ? '' : 'md:col-span-2'}>
                    <label className="lab" htmlFor={`f_${t.code}`}>File</label>
                    <input id={`f_${t.code}`} name="file" type="file" required
                           accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" />
                  </div>
                  <div>
                    <label className="lab" htmlFor={`n_${t.code}`}>Document number</label>
                    <input id={`n_${t.code}`} name="doc_number" maxLength={60}
                           placeholder="As printed on it" />
                  </div>
                  {t.expiry_tracked && (
                    <div>
                      <label className="lab" htmlFor={`v_${t.code}`}>Valid until</label>
                      <input id={`v_${t.code}`} name="valid_until" type="date" />
                    </div>
                  )}
                </div>
                <div className="flex gap-3 mt-4">
                  <SubmitButton pendingText="Uploading…">Attach</SubmitButton>
                  <button type="button" className="btn btn-o" onClick={() => setOpen(null)}>
                    Cancel
                  </button>
                </div>
                {t.expiry_tracked && (
                  <div className="hint mt-3">
                    The expiry date is what drives the renewal warning. Leave it blank and
                    nothing will tell you when this lapses.
                  </div>
                )}
              </form>
            )}
          </div>
        );
      })}

      {!types.length && (
        <div className="note a">
          No document rules are configured for this industry. Run 03_reference_data.sql.
        </div>
      )}
    </>
  );
}
