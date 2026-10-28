import { createClient } from '@/lib/supabase/client';
import { attachUploadedDocument, type DocState } from '@/app/(app)/vendors/[id]/documentActions';
import { fileValidationError, MAX_FILE_BYTES_DIRECT } from '@/lib/fileUpload';

export type { DocState };

/** Uploads a vendor document straight from the browser to Storage, then
 *  makes a second, tiny, metadata-only call to record it (attachUploadedDocument)
 *  -- the file itself never travels through a Server Action's request body,
 *  so Vercel's 4.5MB Function limit never applies (see lib/fileUpload.ts).
 *  Used by every authenticated staff upload surface: DocumentsTab, NdaPanel,
 *  InlineDocUpload, and the Add Vendor wizard. */
export async function uploadStaffDocument(params: {
  siteId: string; docType: string; file: File; docNumber?: string; validUntil?: string;
}): Promise<DocState> {
  const { siteId, docType, file, docNumber, validUntil } = params;

  const fileErr = fileValidationError(file, MAX_FILE_BYTES_DIRECT);
  if (fileErr) return { error: fileErr };

  const supabase = createClient();
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

  return attachUploadedDocument({
    siteId, docType, storagePath: path,
    fileName: file.name, fileSize: file.size, mimeType: file.type || null,
    docNumber, validUntil,
  });
}
