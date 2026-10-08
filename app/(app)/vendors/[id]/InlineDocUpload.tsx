'use client';
import { useActionState, useState } from 'react';
import { uploadDocument, removeDocument, getDownloadUrl, type DocState } from './documentActions';
import SubmitButton from '@/app/SubmitButton';

export type ExistingDoc = {
  id: string; file_name: string; file_size: number | null;
  doc_number: string | null; valid_until: string | null;
  uploaded_at: string; storage_path: string;
} | null;

const size = (b: number | null) =>
  !b ? '' : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;

/** The same upload/view/replace/remove block NdaPanel.tsx already does for
 *  the NDA, generalised to any document type — so the GST certificate can
 *  be asked for right on the Identity tab, the cancelled cheque right on
 *  Banking, and so on, instead of only in one consolidated Documents tab. */
export default function InlineDocUpload({
  siteId, docType, label, hint, doc, expiryTracked, readOnly,
}: {
  siteId: string; docType: string; label: string; hint?: string;
  doc: ExistingDoc; expiryTracked: boolean; readOnly: boolean;
}) {
  const [state, action] = useActionState<DocState, FormData>(uploadDocument, {});
  const [open, setOpen] = useState(false);

  const view = async (path: string) => {
    const url = await getDownloadUrl(path);
    if (url) window.open(url, '_blank');
  };

  return (
    <div className="card p-4 mb-4" style={doc ? { borderColor: 'var(--p400)', background: 'var(--p50)' } : undefined}>
      <div className="flex gap-3 items-center flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="text-[13.5px] font-bold" style={{ color: 'var(--head)' }}>{label}</div>
          <div className="text-[12px]" style={{ color: 'var(--faint)' }}>
            {doc ? (
              <>
                {doc.file_name}{doc.file_size && ` · ${size(doc.file_size)}`}
                {doc.doc_number && ` · no. ${doc.doc_number}`}
                {doc.valid_until && ` · valid to ${doc.valid_until}`}
              </>
            ) : (hint ?? 'Not on file yet.')}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {doc && (
            <button type="button" className="btn btn-o" style={{ padding: '6px 12px', fontSize: 13 }}
                    onClick={() => view(doc.storage_path)}>View</button>
          )}
          {!readOnly && (
            <button type="button" className="btn btn-o" style={{ padding: '6px 12px', fontSize: 13 }}
                    onClick={() => setOpen(!open)}>
              {doc ? 'Replace' : 'Upload'}
            </button>
          )}
          {doc && !readOnly && (
            <form action={removeDocument}>
              <input type="hidden" name="id" value={doc.id} />
              <input type="hidden" name="site_id" value={siteId} />
              <button className="btn btn-o"
                      style={{ padding: '6px 12px', fontSize: 13, color: 'var(--err)', borderColor: 'rgba(239,68,68,.35)' }}>
                Remove
              </button>
            </form>
          )}
        </div>
      </div>

      {state.error && <div className="note r mt-3">{state.error}</div>}
      {state.ok && <div className="note mt-3">{state.ok}</div>}

      {open && !readOnly && (
        <form action={action} className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
          <input type="hidden" name="site_id" value={siteId} />
          <input type="hidden" name="doc_type" value={docType} />
          <div className="grid md:grid-cols-3 gap-4">
            <div className={expiryTracked ? '' : 'md:col-span-2'}>
              <label className="lab" htmlFor={`idu_f_${docType}`}>File</label>
              <input id={`idu_f_${docType}`} name="file" type="file" required
                     accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" />
            </div>
            <div>
              <label className="lab" htmlFor={`idu_n_${docType}`}>Document number</label>
              <input id={`idu_n_${docType}`} name="doc_number" maxLength={60} placeholder="As printed on it" />
            </div>
            {expiryTracked && (
              <div>
                <label className="lab" htmlFor={`idu_v_${docType}`}>Valid until</label>
                <input id={`idu_v_${docType}`} name="valid_until" type="date" />
              </div>
            )}
          </div>
          <div className="flex gap-3 mt-4">
            <SubmitButton pendingText="Uploading…">Attach</SubmitButton>
            <button type="button" className="btn btn-o" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
