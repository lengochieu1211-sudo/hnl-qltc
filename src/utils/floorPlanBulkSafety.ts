export type FloorPlanBulkTargetSafety =
  | 'ready'
  | 'legacy-overwrite-safe'
  | 'needs-server-check'
  | 'blocked-pending';

export interface FloorPlanBulkSafetyInput {
  imageUrl?: string | null;
  imageRevision?: number | null;
  imageCloudRevision?: number | null;
  imageUploadState?: string | null;
  imagePendingByUid?: string | null;
  storageProvider?: string | null;
  storagePath?: string | null;
}

export interface FloorPlanBulkSafetyDecision {
  status: FloorPlanBulkTargetSafety;
  reason:
    | 'cloud-stable'
    | 'legacy-revision-only'
    | 'local-binary-pending'
    | 'local-outbox-pending'
    | 'owned-pending'
    | 'ambiguous-pending';
}

function isLocalBinaryUrl(value: unknown): boolean {
  const url = String(value || '').trim();
  return url.startsWith('data:image/') || url.startsWith('blob:');
}

/**
 * Pure classifier for bulk floor-plan replacement.
 * Historical rows can have imageRevision > imageCloudRevision simply because
 * imageCloudRevision did not exist yet. They are safe to overwrite only when
 * there is no durable evidence of an in-flight replacement.
 */
export function classifyFloorPlanBulkTarget(
  plan: FloorPlanBulkSafetyInput,
  latestLocalOutboxRevision = 0,
  binaryStorageProvider = 'r2',
): FloorPlanBulkSafetyDecision {
  const imageRevision = Math.max(0, Number(plan.imageRevision || 0));
  const cloudRevision = Math.max(0, Number(plan.imageCloudRevision || 0));
  const uploadState = String(plan.imageUploadState || '').trim().toLowerCase();
  const pendingOwner = String(plan.imagePendingByUid || '').trim();
  const storageProvider = String(plan.storageProvider || '').trim().toLowerCase();
  const storagePath = String(plan.storagePath || '').trim();
  const localBinary = isLocalBinaryUrl(plan.imageUrl);

  const cloudStable = imageRevision > 0
    && cloudRevision >= imageRevision
    && storageProvider === String(binaryStorageProvider || '').trim().toLowerCase()
    && Boolean(storagePath);

  if (cloudStable) return { status: 'ready', reason: 'cloud-stable' };
  if (localBinary && imageRevision > cloudRevision) return { status: 'blocked-pending', reason: 'local-binary-pending' };
  if (Number(latestLocalOutboxRevision || 0) > cloudRevision) return { status: 'blocked-pending', reason: 'local-outbox-pending' };
  if (pendingOwner && imageRevision > cloudRevision) return { status: 'blocked-pending', reason: 'owned-pending' };
  if (uploadState === 'pending') return { status: 'needs-server-check', reason: 'ambiguous-pending' };
  if (imageRevision > cloudRevision) return { status: 'legacy-overwrite-safe', reason: 'legacy-revision-only' };
  return { status: 'ready', reason: 'cloud-stable' };
}
