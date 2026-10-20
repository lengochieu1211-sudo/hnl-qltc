import { deleteField, doc, runTransaction } from 'firebase/firestore';
import { db, fetchProjectUserRoleFromCloud, getCurrentRealFirebaseUser } from './firebase';
import { planTrashRestore, TRASH_RECOVERY_CLOUD_COLLECTIONS, TRASH_RELATED_LINK_FIELDS } from '../utils/trashRestorePolicy';
import type { TrashOperation } from './trash';
import { normalizeStructureGroupConfig } from '../utils/structureGroupUtils';
import { planRestoreStructureGroup } from '../utils/structureGroupTrashPolicy';

export interface TrashRestoreReceipt {
  restored: number;
  relatedReconnected: number;
  relatedSkipped: number;
}

/**
 * Online, ADMIN-authorized, all-or-nothing restore for the 8 NON-warehouse core
 * collections. Uses only the *current server tombstone* (not a stale client
 * snapshot); restores related links only if nobody edited the row since deletion.
 * The Trash metadata is removed IN THE SAME transaction after all checks/writes.
 * Photos remain attached to stable entity IDs and are never physically deleted.
 */
export async function restoreProjectTrashAtomic(projectId: string, operationId: string): Promise<TrashRestoreReceipt> {
  if (!projectId || !operationId) throw new Error('TRASH_RECOVERY_MISSING_ID');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('TRASH_RECOVERY_REQUIRES_ONLINE');
  const user = getCurrentRealFirebaseUser();
  if (!user?.uid || !user.email) throw new Error('TRASH_RECOVERY_SIGN_IN_REQUIRED');
  const role = await fetchProjectUserRoleFromCloud(projectId, user);
  if (role.verification !== 'verified' || !role.allowed || role.role !== 'ADMIN') {
    throw new Error('TRASH_RECOVERY_ADMIN_VERIFICATION_FAILED');
  }

  return runTransaction(db, async (transaction) => {
    const operationRef = doc(db, 'projects', projectId, 'trash', operationId);
    const opSnap = await transaction.get(operationRef);
    if (!opSnap.exists()) throw new Error('TRASH_RECOVERY_OPERATION_NOT_ON_SERVER');
    const operation = { ...opSnap.data(), id: opSnap.id, projectId } as TrashOperation;
    if (operation.deletedItems?.length === 1 && operation.deletedItems[0]?.collection === 'structureGroups') {
      if (operation.projectId !== projectId || Number(operation.expiresAt || 0) <= Date.now()) {
        throw new Error('STRUCTURE_TRASH_RECEIPT_EXPIRED_OR_MISMATCH');
      }
      if (Object.values(operation.relatedBefore || {}).some((rows) => Array.isArray(rows) && rows.length > 0)) {
        throw new Error('STRUCTURE_TRASH_UNEXPECTED_RELATED_RECORDS');
      }
      const item = operation.deletedItems[0];
      if (!item.entityId || item.entityId !== item.snapshot?.id) throw new Error('STRUCTURE_TRASH_INVALID_RECEIPT');
      const settingsRef = doc(db, 'projects', projectId, 'settings', 'shared');
      const settingsSnap = await transaction.get(settingsRef);
      if (!settingsSnap.exists() || !settingsSnap.data().structure) throw new Error('STRUCTURE_TRASH_SHARED_SETTINGS_MISSING');
      const restoredConfig = planRestoreStructureGroup(normalizeStructureGroupConfig(settingsSnap.data().structure), item.snapshot);
      transaction.update(settingsRef, {
        structure: restoredConfig, updatedAt: Date.now(),
        updatedByUid: user.uid, updatedByEmail: user.email.trim().toLowerCase(),
      });
      transaction.delete(operationRef);
      return { restored: 1, relatedReconnected: 0, relatedSkipped: 0 };
    }
    const { targets, related } = planTrashRestore(operation, projectId);
    const restoreRefs = targets.map((target) => doc(db, 'projects', projectId, TRASH_RECOVERY_CLOUD_COLLECTIONS[target.collection], target.entityId));
    const relatedRefs = related.map((target) => doc(db, 'projects', projectId, TRASH_RECOVERY_CLOUD_COLLECTIONS[target.collection], target.entityId));

    // All reads MUST precede any transaction update. Firestore retries on concurrent writes.
    const restoreSnaps = [];
    for (const ref of restoreRefs) restoreSnaps.push(await transaction.get(ref));
    const relatedSnaps = [];
    for (const ref of relatedRefs) relatedSnaps.push(await transaction.get(ref));

    for (let index = 0; index < targets.length; index += 1) {
      const row = restoreSnaps[index];
      if (!row.exists()) throw new Error(`TRASH_RECOVERY_TOMBSTONE_MISSING:${targets[index].collection}/${targets[index].entityId}`);
      const data = row.data();
      if (data.id && data.id !== targets[index].entityId) throw new Error('TRASH_RECOVERY_SERVER_ID_MISMATCH');
      if (data.deleted !== true && !(Number(data.deletedAt || 0) > 0)) {
        throw new Error(`TRASH_RECOVERY_TARGET_ALREADY_ACTIVE:${targets[index].entityId}`);
      }
    }

    const timestamp = Date.now();
    for (let index = 0; index < restoreRefs.length; index += 1) {
      const current = restoreSnaps[index].data()!;
      transaction.update(restoreRefs[index], {
        deleted: false,
        deletedAt: null,
        deletedByUid: null,
        deletedBy: null,
        revision: Math.max(Number(current.revision || 0) + 1, 1),
        updatedAt: Math.max(timestamp, Number(current.updatedAt || 0) + 1),
        updatedByUid: user.uid,
      });
    }

    let relatedReconnected = 0;
    let relatedSkipped = 0;
    for (let index = 0; index < relatedRefs.length; index += 1) {
      const item = related[index];
      const row = relatedSnaps[index];
      if (!row.exists() || row.data()?.deleted === true || Number(row.data()?.deletedAt || 0) > 0
        || Number(row.data()?.updatedAt || 0) > Number(operation.deletedAt || 0)) {
        relatedSkipped += 1;
        continue;
      }
      const before = item.before;
      const serverData = row.data()!;
      const fields = TRASH_RELATED_LINK_FIELDS[item.collection] || [];
      const changes: Record<string, unknown> = {};
      for (const field of fields) {
        if (JSON.stringify(serverData[field] ?? null) === JSON.stringify(before[field] ?? null)) continue;
        changes[field] = Object.prototype.hasOwnProperty.call(before, field) && before[field] !== undefined ? before[field] : deleteField();
      }
      if (Object.keys(changes).length === 0) continue;
      transaction.update(relatedRefs[index], {
        ...changes,
        revision: Math.max(Number(serverData.revision || 0) + 1, 1),
        updatedAt: Math.max(timestamp, Number(serverData.updatedAt || 0) + 1),
        updatedByUid: user.uid,
      });
      relatedReconnected += 1;
    }

    // No local-first mutation: if any network/permission/reference check fails,
    // neither the original records nor the Cloud Trash receipt is touched.
    transaction.delete(operationRef);
    return { restored: restoreRefs.length, relatedReconnected, relatedSkipped };
  });
}
