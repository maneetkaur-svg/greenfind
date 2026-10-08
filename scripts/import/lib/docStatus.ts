export type BlankDecision = 'MISSING' | 'NOT_APPLICABLE';

/** What a blank document link means. Only the MSME document column depends
 *  on the MSME flag — every other blank is always MISSING, never silently
 *  treated as fine. An unclear or blank MSME flag also means MISSING, not
 *  NOT_APPLICABLE: we only excuse it when we are sure it does not apply. */
export function decideBlankStatus(columnKey: string, isMsme: boolean | null): BlankDecision {
  if (columnKey === 'doc_msme' && isMsme === false) return 'NOT_APPLICABLE';
  return 'MISSING';
}
