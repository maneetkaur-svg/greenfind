'use client';
import { useActionState, useState } from 'react';
import { uploadDocument, removeDocument, getDownloadUrl, type DocState }
  from './documentActions';
import SubmitButton from '@/app/SubmitButton';

export type SignedNda = {
  id: string; file_name: string; file_size: number | null;
  uploaded_at: string; storage_path: string;
} | null;

const size = (b: number | null) =>
  !b ? '' : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;

export default function NdaPanel({
  siteId, signed, signatory, readOnly,
}: { siteId: string; signed: SignedNda; signatory: string | null; readOnly: boolean }) {
  const [state, action] = useActionState<DocState, FormData>(uploadDocument, {});
  const [open, setOpen] = useState(false);

  const view = async (path: string) => {
    const url = await getDownloadUrl(path);
    if (url) window.open(url, '_blank');
  };

  return (
    <div className="mb-6">
      <div className="text-[11px] font-bold uppercase tracking-[.07em] mb-3"
           style={{ color: 'var(--p600)' }}>Non-disclosure agreement</div>

      {state.error && <div className="note r mb-4">{state.error}</div>}
      {state.ok && <div className="note mb-4">{state.ok}</div>}

      <div className="card overflow-hidden">
        <div className="flex gap-3 items-center p-4 border-b flex-wrap"
             style={{ borderColor: 'var(--line)' }}>
          <div className="flex-1 min-w-[200px]">
            <div className="text-[13.5px] font-bold" style={{ color: 'var(--head)' }}>
              Blank NDA, filled in for this vendor
            </div>
            <div className="text-[12px]" style={{ color: 'var(--faint)' }}>
              Legal name, address and GSTIN are merged in.
              {signatory ? ` For signature by ${signatory}.` : ' Set an authorised signatory below and it appears on the form.'}
            </div>
          </div>
          <a className="btn btn-o" style={{ padding: '7px 14px', fontSize: 13 }}
             href={`/api/nda/${siteId}`}>Download</a>
        </div>

        <div className="flex gap-3 items-center p-4 flex-wrap"
             style={signed ? { background: 'var(--p50)' } : undefined}>
          <div className="flex-1 min-w-[200px]">
            <div className="text-[13.5px] font-bold" style={{ color: 'var(--head)' }}>
              Signed copy
            </div>
            <div className="text-[12px]" style={{ color: 'var(--faint)' }}>
              {signed
                ? `${signed.file_name}${signed.file_size ? ' · ' + size(signed.file_size) : ''} · added ${new Date(signed.uploaded_at).toLocaleDateString('en-GB')}`
                : 'Not received yet.'}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {signed && (
              <button type="button" className="btn btn-o"
                      style={{ padding: '7px 14px', fontSize: 13 }}
                      onClick={() => view(signed.storage_path)}>View</button>
            )}
            {!readOnly && (
              <button type="button" className="btn btn-o"
                      style={{ padding: '7px 14px', fontSize: 13 }}
                      onClick={() => setOpen(!open)}>
                {signed ? 'Replace' : 'Upload signed copy'}
              </button>
            )}
            {signed && !readOnly && (
              <form action={removeDocument}>
                <input type="hidden" name="id" value={signed.id} />
                <input type="hidden" name="site_id" value={siteId} />
                <button className="btn btn-o"
                        style={{ padding: '7px 14px', fontSize: 13, color: 'var(--err)',
                                 borderColor: 'rgba(239,68,68,.35)' }}>Remove</button>
              </form>
            )}
          </div>
        </div>

        {open && !readOnly && (
          <form action={action} className="p-4 border-t" style={{ borderColor: 'var(--line)' }}>
            <input type="hidden" name="site_id" value={siteId} />
            <input type="hidden" name="doc_type" value="nda" />
            <label className="lab" htmlFor="nda_file">Signed NDA</label>
            <input id="nda_file" name="file" type="file" required
                   accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" />
            <div className="flex gap-3 mt-4">
              <SubmitButton pendingText="Uploading…">Attach</SubmitButton>
              <button type="button" className="btn btn-o" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="hint mt-2">
        This is the same record as <b>NDA (signed)</b> under Documents — uploading
        here or there is the same thing.
      </div>
    </div>
  );
}
