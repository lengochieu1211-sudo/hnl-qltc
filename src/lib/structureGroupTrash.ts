import { collection, doc, getDocsFromServer, runTransaction } from 'firebase/firestore';
import { db, fetchProjectUserRoleFromCloud, getCurrentRealFirebaseUser } from './firebase';
import { normalizeTrashSettings, estimateTrashBytes, type TrashOperation } from './trash';
import { normalizeStructureGroupConfig, type ProjectStructureConfig } from '../utils/structureGroupUtils';
import { planEmptyStructureGroupDelete } from '../utils/structureGroupTrashPolicy';
import { createEntityId } from '../utils/idUtils';

/** Online ADMIN-only: group removal and its recoverable receipt commit together.
 * Every existing floor (including a tombstone) is re-read inside the transaction,
 * so concurrent edits to existing floor references force a retry. */
export async function deleteEmptyStructureGroupToTrash(
  projectId: string, groupId: string,
): Promise<ProjectStructureConfig> {
  if (!projectId || !groupId) throw new Error('STRUCTURE_TRASH_PROJECT_OR_GROUP_MISSING');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('STRUCTURE_TRASH_REQUIRES_ONLINE');
  const user = getCurrentRealFirebaseUser();
  if (!user?.uid || !user.email) throw new Error('STRUCTURE_TRASH_LOGIN_REQUIRED');
  const role = await fetchProjectUserRoleFromCloud(projectId, user);
  if (!role.allowed || role.verification !== 'verified' || role.role !== 'ADMIN') {
    throw new Error('STRUCTURE_TRASH_ADMIN_REQUIRED');
  }
  const floorIndex = await getDocsFromServer(collection(db, 'projects', projectId, 'floor_plans'));
  const settingsRef = doc(db, 'projects', projectId, 'settings', 'shared');
  const receiptId = createEntityId('TRASH');
  const receiptRef = doc(db, 'projects', projectId, 'trash', receiptId);
  return runTransaction(db, async (tx) => {
    const settingsSnap = await tx.get(settingsRef);
    if (!settingsSnap.exists() || !settingsSnap.data().structure) throw new Error('STRUCTURE_TRASH_SHARED_SETTINGS_MISSING');
    const floors = await Promise.all(floorIndex.docs.map((item) => tx.get(item.ref)));
    const config = normalizeStructureGroupConfig(settingsSnap.data().structure);
    const { deleted, next } = planEmptyStructureGroupDelete(
      config, groupId, floors.filter((row) => row.exists()).map((row) => row.data() as any),
    );
    const trashSettings = normalizeTrashSettings(settingsSnap.data().trash);
    // Do not silently delete without recovery; ADMIN must enable Trash first.
    if (!trashSettings.enabled) throw new Error('STRUCTURE_TRASH_MUST_ENABLE_TRASH');
    const deletedAt = Date.now();
    const operation: TrashOperation = {
      id: receiptId, projectId, deletedAt,
      expiresAt: deletedAt + trashSettings.retentionDays * 86400000,
      retentionDays: trashSettings.retentionDays,
      deletedByUid: user.uid, deletedByEmail: user.email.trim().toLowerCase(),
      deletedByName: user.displayName || '',
      deletedItems: [{
        collection: 'structureGroups', entityId: deleted.id,
        label: `Khu/Khối: ${deleted.name}`,
        snapshot: deleted,
      }],
      relatedBefore: {},
    };
    operation.approxBytes = estimateTrashBytes(operation);
    // No local-first removal and no separate asynchronous Trash receipt write.
    tx.update(settingsRef, {
      structure: next, updatedAt: deletedAt,
      updatedByUid: user.uid, updatedByEmail: user.email.trim().toLowerCase(),
    });
    tx.set(receiptRef, operation);
    return next;
  });
}
