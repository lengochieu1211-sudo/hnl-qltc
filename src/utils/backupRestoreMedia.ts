export interface BackupRestorePhotoLike {
  id?: string;
  entityType?: string;
  entityId?: string;
  [key: string]: any;
}

export interface AuthoritativeRestorePhotoSelection<T extends BackupRestorePhotoLike> {
  photos: T[];
  skippedParentless: T[];
}

/**
 * Full/authoritative JSON restore may only reactivate media whose business parent is
 * present in the same authoritative backup. Defect/Crew parents are part of the nine
 * business collections, so a photo that points at a missing parent is historical/orphan
 * media and must not be staged back into the active photo outbox.
 *
 * Chat is intentionally left untouched because chat messages are not part of the
 * authoritative project backup contract; there is no parent collection here to verify.
 */
export function selectAuthoritativeRestorePhotos<T extends BackupRestorePhotoLike>(
  photos: T[] | null | undefined,
  payload: Record<string, any> | null | undefined,
): AuthoritativeRestorePhotoSelection<T> {
  const source = Array.isArray(photos) ? photos : [];
  const defects = Array.isArray(payload?.defects) ? payload!.defects : [];
  const crewRecords = Array.isArray(payload?.crewRecords) ? payload!.crewRecords : [];
  const defectIds = new Set(defects.map((item: any) => String(item?.id || '').trim()).filter(Boolean));
  const crewRecordIds = new Set(crewRecords.map((item: any) => String(item?.id || '').trim()).filter(Boolean));

  const kept: T[] = [];
  const skippedParentless: T[] = [];

  for (const photo of source) {
    const id = String(photo?.id || '').trim();
    if (!id) {
      skippedParentless.push(photo);
      continue;
    }

    const entityType = String(photo?.entityType || '');
    const entityId = String(photo?.entityId || '').trim();
    if (entityType === 'defect' && (!entityId || !defectIds.has(entityId))) {
      skippedParentless.push(photo);
      continue;
    }
    if (entityType === 'crewRecord' && (!entityId || !crewRecordIds.has(entityId))) {
      skippedParentless.push(photo);
      continue;
    }

    kept.push(photo);
  }

  return { photos: kept, skippedParentless };
}
