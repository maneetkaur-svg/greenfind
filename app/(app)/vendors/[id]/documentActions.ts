'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createClient, getMe } from '@/lib/supabase/server';
import { extractEntityFromCertificate } from '@/lib/entityFromCertificate';

export type DocState = { error?: string; ok?: string };

// Runs fully in the background (after()) — never on the critical path of
// an upload. Flip to false to stop the Gemini call from happening at all.
const GST_ENTITY_EXTRACTION_ENABLED = true;

export type AttachDocumentInput = {
  siteId: string; docType: string; storagePath: string;
  fileName: string; fileSize: number; mimeType: string | null;
  docNumber?: string; validUntil?: string;
};

/** Records a file already uploaded to Storage by the browser (see
 *  lib/clientDocumentUpload.ts) -- this action never receives the file
 *  itself, only its path and metadata, so it stays far under Vercel's
 *  4.5MB Server Action body limit regardless of how large the document is
 *  (see lib/fileUpload.ts for the full explanation). Replacing a document
 *  supersedes the previous row rather than overwriting it, so the
 *  verification trail survives (sql/01_schema.sql's doc_supersede trigger). */
export async function attachUploadedDocument(input: AttachDocumentInput): Promise<DocState> {
  const me = await getMe();
  if (!me) return { error: 'You are not signed in.' };
  if (me.role === 'user') return { error: 'Your role is read-only.' };

  const { siteId, docType, storagePath, fileName, fileSize, mimeType, docNumber, validUntil } = input;
  if (!siteId || !docType || !storagePath) return { error: 'Something is missing from the upload.' };

  const supabase = await createClient();
  const { error: rowErr } = await supabase.from('site_document').insert({
    site_id: siteId, doc_type: docType, storage_path: storagePath,
    file_name: fileName, file_size: fileSize, mime_type: mimeType,
    doc_number: docNumber || null,
    valid_until: validUntil || null,
    uploaded_by: me.id,
  });

  if (rowErr) {
    await supabase.storage.from('vendor-documents').remove([storagePath]);
    return { error: 'Saved the file but could not record it, so it has been removed: ' + rowErr.message };
  }

  // Best-effort: a GST certificate just arrived, so this is the one moment a
  // fresh entity-type reading is actually possible. A Gemini call can take
  // up to ~150s worst case (60s timeout + 30s backoff + a 60s retry) — that
  // used to sit in the critical path the user's "Uploading…" spinner was
  // waiting on. after() runs it once the response has already gone back,
  // so the upload itself always completes in the time the insert itself
  // takes, never blocking on Gemini. The file is read back from Storage
  // here (rather than carried over from the request) because this action
  // never receives the file's bytes in the first place. See
  // lib/entityFromCertificate.ts.
  if (docType === 'gst' && GST_ENTITY_EXTRACTION_ENABLED) {
    after(async () => {
      try {
        const { data: site } = await supabase.from('vendor_site').select('company_id').eq('id', siteId).single();
        const { data: co } = site
          ? await supabase.from('company').select('entity').eq('id', site.company_id).single()
          : { data: null };
        if (site && !co?.entity) {
          const { data: blob } = await supabase.storage.from('vendor-documents').download(storagePath);
          if (!blob) return;
          const buffer = Buffer.from(await blob.arrayBuffer());
          const result = await extractEntityFromCertificate(supabase, site.company_id, buffer, mimeType || 'application/pdf');
          // The page that triggered the upload has already rendered by now
          // (it's past response time) — revalidate again so the entity
          // type shows up next time this vendor is opened, not just after
          // some unrelated future edit happens to revalidate it.
          if (result.ok) revalidatePath(`/vendors/${siteId}`);
        }
      } catch {
        /* ignored — see above */
      }
    });
  }

  revalidatePath(`/vendors/${siteId}`);
  revalidatePath('/vendors');
  return { ok: `${fileName} attached.` };
}

export async function removeDocument(formData: FormData) {
  const me = await getMe();
  if (!me || me.role === 'user') return;
  const id = String(formData.get('id') ?? '');
  const siteId = String(formData.get('site_id') ?? '');

  const supabase = await createClient();
  const { data: doc } = await supabase.from('site_document')
    .select('storage_path').eq('id', id).single();

  await supabase.from('site_document').delete().eq('id', id);
  if (doc?.storage_path)
    await supabase.storage.from('vendor-documents').remove([doc.storage_path]);

  revalidatePath(`/vendors/${siteId}`);
  revalidatePath('/vendors');
}

/** Files are private, so they are served through a link that expires. */
export async function getDownloadUrl(path: string): Promise<string | null> {
  const me = await getMe();
  if (!me) return null;
  const supabase = await createClient();
  const { data } = await supabase.storage
    .from('vendor-documents').createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}
