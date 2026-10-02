import { parseLegacyTimestamp } from './dateFormatter';
import { smartMergeProjectData } from './dataNormalizer';

/**
 * Build a data-loss-safe backup snapshot from the authoritative Cloud payload plus
 * the current local React state. Cloud seeds the complete dataset; newer local edits
 * are layered on top, while tombstones prevent an intentional local delete from being
 * resurrected just because Firestore has not observed that delete yet.
 *
 * smartMergeProjectData() intentionally advances top-level updatedAt for a live merge.
 * A backup must not do that: export time is not business-data time, otherwise importing
 * an older backup later could look newer than the records it actually contains.
 */
export function reconcileBackupSnapshot(
  cloudPayload: Record<string, any> | null | undefined,
  localSnapshot: Record<string, any> | null | undefined,
): Record<string, any> {
  const cloud = cloudPayload && typeof cloudPayload === 'object' ? cloudPayload : {};
  const local = localSnapshot && typeof localSnapshot === 'object' ? localSnapshot : {};
  const merged = smartMergeProjectData(cloud, local);

  merged.updatedAt = Math.max(
    parseLegacyTimestamp(cloud.updatedAt, 0),
    parseLegacyTimestamp(local.updatedAt, 0),
  );

  return merged;
}
