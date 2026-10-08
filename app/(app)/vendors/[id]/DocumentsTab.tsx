'use client';
import Link from 'next/link';
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

/** These have their own upload spot elsewhere in the record (Identity,
 *  Banking, the CTO/EPR tabs, Agreements) — see InlineDocUpload.tsx. This
 *  tab shows them as a plain status line instead of a second upload form,
 *  so there is exactly one place to attach each of them, not two. */
const CONTEXTUAL: Record<string, string> = {
  gst: 'identity', pan: 'identity', udyam: 'identity',
  cheque: 'banking', nda: 'agreements', cto: 'cto', epr: 'epr',
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
  const [addingExtra, setAddingExtra] = useState(false);

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

  const contextualTypes = types.filter(t => CONTEXTUAL[t.code]);
  const otherTypes = types.filter(t => !CONTEXTUAL[t.code]);
  const extraDocs = docs.filter(d => d.doc_type === 'other');

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

      {contextualTypes.length > 0 && (
        <div className="card p-4 mb-4" style={{ background: 'var(--surface-2)' }}>
          <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-3"
               style={{ color: 'var(--faint)' }}>Asked for on their own tab</div>
          <div className="grid gap-2">
            {contextualTypes.map(t => {
              const d = have(t.code);
              return (
                <div key={t.code} className="flex items-center justify-between gap-3">
                  <span className="text-[13px]" style={{ color: 'var(--head)' }}>
                    {d ? '✓ ' : '○ '}{t.label}
                  </span>
                  <Link href={`/vendors/${siteId}?tab=${CONTEXTUAL[t.code]}`}
                        className="text-[12.5px] font-semibold" style={{ color: 'var(--p600)' }}>
                    {d ? 'View' : 'Go add it'}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[13.5px] mb-4" style={{ color: 'var(--faint)' }}>
        Only what applies to this industry is listed. PDF, JPG or PNG, up to 10 MB.
      </p>

      {otherTypes.map(t => {
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

      <div className="card p-4 mb-3">
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <div>
            <div className="text-[13.5px] font-bold" style={{ color: 'var(--head)' }}>Anything else</div>
            <div className="text-[12px]" style={{ color: 'var(--faint)' }}>
              ISO certificates, a rate card — whatever else is worth attaching.
            </div>
          </div>
          {!readOnly && !addingExtra && (
            <button type="button" className="btn btn-o" onClick={() => setAddingExtra(true)}>
              + Add more documents
            </button>
          )}
        </div>

        {extraDocs.map(d => (
          <div key={d.id} className="flex items-center justify-between gap-3 mt-3 pt-3 border-t"
               style={{ borderColor: 'var(--line)' }}>
            <span className="text-[13px]" style={{ color: 'var(--head)' }}>
              {d.doc_number || d.file_name}
              <span style={{ color: 'var(--faint)' }}> · {d.file_name}{d.file_size && ` · ${size(d.file_size)}`}</span>
            </span>
            <div className="flex gap-2">
              <button type="button" className="text-[12.5px] font-semibold" style={{ color: 'var(--p600)' }}
                      onClick={() => view(d.storage_path)}>View</button>
              {!readOnly && (
                <form action={removeDocument}>
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="site_id" value={siteId} />
                  <button className="text-[12.5px] font-semibold" style={{ color: 'var(--err)' }}>Remove</button>
                </form>
              )}
            </div>
          </div>
        ))}

        {addingExtra && !readOnly && (
          <form action={action} className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--line)' }}
                onSubmit={() => setAddingExtra(false)}>
            <input type="hidden" name="site_id" value={siteId} />
            <input type="hidden" name="doc_type" value="other" />
            <div className="grid md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="lab" htmlFor="extra_label">What document is this?</label>
                <input id="extra_label" name="doc_number" required maxLength={60}
                       placeholder="e.g. ISO 14001 certificate" />
              </div>
              <div>
                <label className="lab" htmlFor="extra_file">File</label>
                <input id="extra_file" name="file" type="file" required
                       accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <SubmitButton pendingText="Uploading…">Attach</SubmitButton>
              <button type="button" className="btn btn-o" onClick={() => setAddingExtra(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      {!types.length && (
        <div className="note a">
          No document rules are configured for this industry. Run 03_reference_data.sql.
        </div>
      )}
    </>
  );
}
