const RESTORED_FLOOR_PLAN_CLOUD_POINTER_FIELDS = [
  'driveFileId',
  'driveUrl',
  'cloudFileId',
  'storageProvider',
  'storagePath',
  'thumbnailPath',
  'storageMd5Hash',
  'storageEtag',
  'imageCloudSyncedAt',
  'imageAssetId',
  'imageAssetOwnerFloorId',
] as const;

function isEmbeddedFloorPlanBinary(value: unknown): boolean {
  const raw = String(value || '').trim();
  return raw.startsWith('data:image/') || raw.startsWith('blob:');
}

function hasHistoricalCloudIdentity(plan: Record<string, any>): boolean {
  return RESTORED_FLOOR_PLAN_CLOUD_POINTER_FIELDS.some((key) => Boolean(plan?.[key]))
    || Number(plan?.imageCloudRevision || 0) > 0;
}

/**
 * JSON backup image bytes are self-contained restore input. Cloud/R2 pointers stored
 * beside those bytes describe the environment where the backup was created and must
 * never be treated as the destination authority. Otherwise importing a PROD/older DEV
 * backup can silently repoint the destination floor to an old immutable R2 object and
 * floorPlanNeedsCloudUpload() will incorrectly skip the embedded image.
 *
 * Only rows that actually carry embedded image bytes are rewritten. Pointer-only legacy
 * rows remain untouched for backward compatibility; current backup v4 refuses to create
 * a backup with an unresolved floor-plan binary.
 */
export function prepareFloorPlansForBackupRestore<T extends Record<string, any>>(
  plans: T[] | null | undefined,
  restoreStartedAt = Date.now(),
): T[] {
  if (!Array.isArray(plans)) return [];

  return plans.map((rawPlan, index) => {
    const plan = { ...rawPlan } as Record<string, any>;
    if (!isEmbeddedFloorPlanBinary(plan.imageUrl) || !hasHistoricalCloudIdentity(plan)) {
      return plan as T;
    }

    const restoreRevision = Math.max(
      restoreStartedAt + index,
      Number(plan.imageRevision || 0) + 1,
      Number(plan.imageCloudRevision || 0) + 1,
      Number(plan.updatedAt || 0) + 1,
      1,
    );

    for (const key of RESTORED_FLOOR_PLAN_CLOUD_POINTER_FIELDS) delete plan[key];

    plan.imageRevision = restoreRevision;
    plan.imageCloudRevision = 0;
    plan.imageUploadState = 'pending';
    plan.imagePendingByUid = null;
    plan.imageOutboxRevision = restoreRevision;
    plan.updatedAt = restoreRevision;

    return plan as T;
  });
}
