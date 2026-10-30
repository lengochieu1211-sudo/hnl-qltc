import { doc, runTransaction } from 'firebase/firestore';
import { db, fetchProjectUserRoleFromCloud, getCurrentRealFirebaseUser } from './firebase';

export type PositionLockKind = 'room' | 'defect';
export type PositionLockEntry = { id: string; expectedLocked: boolean };

/**
 * Only Cloud-authenticated position locks count as saved.
 * Change the lock field alone, retaining geometry, photos, IDs and all other fields.
 * Firestore retries a concurrent transaction, but changed lock state fails closed.
 */
export async function commitPositionLocksOnCloud(
  projectId: string,
  kind: PositionLockKind,
  entries: PositionLockEntry[],
  locked: boolean,
): Promise<void> {
  if (!projectId) throw new Error('POSITION_LOCK_PROJECT_REQUIRED');
  if (kind !== 'room' && kind !== 'defect') throw new Error('POSITION_LOCK_KIND_INVALID');
  if (typeof locked !== 'boolean' || !Array.isArray(entries) || entries.length < 1 || entries.length > 40) {
    throw new Error('POSITION_LOCK_UNSAFE_SCOPE');
  }
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length || entries.some((entry) =>
    !entry.id || entry.id.includes('/') || typeof entry.expectedLocked !== 'boolean')) {
    throw new Error('POSITION_LOCK_INVALID_IDS');
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('POSITION_LOCK_REQUIRES_ONLINE');
  const actor = getCurrentRealFirebaseUser();
  if (!actor?.uid) throw new Error('POSITION_LOCK_SIGN_IN_REQUIRED');
  const role = await fetchProjectUserRoleFromCloud(projectId, actor);
  const allowedRole = role.role === 'ADMIN'
    || (kind === 'defect' && role.role === 'EDITOR');
  if (role.verification !== 'verified' || !role.allowed || !allowedRole) {
    throw new Error('POSITION_LOCK_ROLE_NOT_VERIFIED');
  }
  const name = kind === 'room' ? 'rooms' : 'defects';
  const refs = entries.map((entry) => doc(db, 'projects', projectId, name, entry.id));
  await runTransaction(db, async (tx) => {
    // Read every target before the first write, as Firestore transactions require.
    const snapshots = [];
    for (const ref of refs) snapshots.push(await tx.get(ref));
    const changes: Array<{ index: number; revision: number; updatedAt: number }> = [];
    const now = Date.now();
    for (let i = 0; i < entries.length; i++) {
      const snap = snapshots[i];
      const row = snap.data();
      if (!snap.exists() || !row || row.deleted === true || (row.id && row.id !== entries[i].id)) {
        throw new Error('POSITION_LOCK_TARGET_MISSING_OR_DELETED:' + entries[i].id);
      }
      if (Boolean(row.positionLocked) !== entries[i].expectedLocked) {
        throw new Error('POSITION_LOCK_CONCURRENT_CHANGE:' + entries[i].id);
      }
      if (Boolean(row.positionLocked) === locked && typeof row.positionLocked === 'boolean') continue;
      if (row.updatedAt !== undefined && typeof row.updatedAt !== 'number') {
        throw new Error('POSITION_LOCK_LEGACY_TIME_NEEDS_REVIEW:' + entries[i].id);
      }
      const revision = Math.max(1, Number(row.revision || 0) + 1);
      const updatedAt = Math.max(now, Number(row.updatedAt || 0) + 1);
      changes.push({ index: i, revision, updatedAt });
    }
    for (const change of changes) {
      tx.update(refs[change.index], {
        positionLocked: locked,
        revision: change.revision,
        updatedAt: change.updatedAt,
        updatedByUid: actor.uid,
      });
    }
  });
}
