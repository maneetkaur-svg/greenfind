'use server';
import { revalidatePath } from 'next/cache';
import { createClient, getMe } from '@/lib/supabase/server';
import { extractEntityFromCertificate } from '@/lib/entityFromCertificate';

export type DocState = { error?: string; ok?: string };

const MAX = 10 * 1024 * 1024;
const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

/** Uploads the file to Storage, then records it. Replacing a document
 *  supersedes the previous row rather than overwriting it, so the
 *  verification trail survives. */
export async function uploadDocument(
  _prev: DocState, formData: FormData
): Promise<DocState> {
  const me = await getMe();
  if (!me) return { error: 'You are not signed in.' };
  if (me.role === 'user') return { error: 'Your role is read-only.' };

  const siteId = String(formData.get('site_id') ?? '');
  const docType = String(formData.get('doc_type') ?? '');
  const file = formData.get('file') as File | null;

  if (!siteId || !docType) return { error: 'Something is missing from the form.' };
  if (!file || file.size === 0) return { error: 'Choose a file first.' };
  if (file.size > MAX)
    return { error: `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 10 MB.` };

  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!OK_TYPES.includes(file.type) && !['pdf', 'jpg', 'jpeg', 'png'].includes(ext))
    return { error: 'Only PDF, JPG and PNG are accepted.' };

  const supabase = await createClient();
  const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
  const path = `${siteId}/${docType}/${Date.now()}_${safe}`;

  const { error: upErr } = await supabase.storage
    .from('vendor-documents')
    .upload(path, file, { contentType: file.type || undefined, upsert: false });

  if (upErr) {
    if (upErr.message.toLowerCase().includes('bucket'))
      return { error: 'The vendor-documents bucket does not exist. Run 02_security.sql in Supabase.' };
    return { error: 'Upload failed: ' + upErr.message };
  }

  const validUntil = String(formData.get('valid_until') ?? '').trim();
  const docNumber = String(formData.get('doc_number') ?? '').trim();

  const { error: rowErr } = await supabase.from('site_document').insert({
    site_id: siteId, doc_type: docType, storage_path: path,
    file_name: file.name, file_size: file.size, mime_type: file.type || null,
    doc_number: docNumber || null,
    valid_until: validUntil || null,
    uploaded_by: me.id,
  });

  if (rowErr) {
    await supabase.storage.from('vendor-documents').remove([path]);
    return { error: 'Saved the file but could not record it, so it has been removed: ' + rowErr.message };
  }

  // Best-effort: a GST certificate just arrived, so this is the one moment a
  // fresh entity-type reading is actually possible. Never blocks or fails
  // the upload itself — see lib/entityFromCertificate.ts.
  if (docType === 'gst') {
    try {
      const { data: site } = await supabase.from('vendor_site').select('company_id').eq('id', siteId).single();
      const { data: co } = site
        ? await supabase.from('company').select('entity').eq('id', site.company_id).single()
        : { data: null };
      if (site && !co?.entity) {
        const buffer = Buffer.from(await file.arrayBuffer());
        await extractEntityFromCertificate(supabase, site.company_id, buffer, file.type || 'application/pdf');
      }
    } catch {
      /* ignored — see above */
    }
  }

  revalidatePath(`/vendors/${siteId}`);
  revalidatePath('/vendors');
  return { ok: `${file.name} attached.` };
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
