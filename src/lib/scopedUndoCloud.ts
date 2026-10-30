import { deleteField, doc, runTransaction } from 'firebase/firestore';
import { db, fetchProjectUserRoleFromCloud, getCurrentRealFirebaseUser } from './firebase';
import { STATE_KEY_TO_CLOUD_NAME } from '../config/realtimeCollections';
import type { ScopedUndoStep } from '../utils/undoRedoScoped';

/**
 * Server-acknowledged deletion Undo for non-warehouse business records.
 * No whole-app snapshot replay, no local-only success, and no inventory balance
 * mutation. Other users' newer edits are protected by the transaction reads.
 */
export async function restoreDeletedUndoOnCloud(
  projectId: string,
  step: ScopedUndoStep,
  expectedDeletionTimes: Record<string, number>,
  trashOperationId?: string,
): Promise<Array<{ collection: string; id: string; row: Record<string, any> }>> {
  if (!projectId || step.projectId !== projectId) throw new Error('UNDO_PROJECT_MISMATCH');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('UNDO_REQUIRES_ONLINE');
  if (step.changes.length === 0 || step.changes.length > 100) throw new Error('UNDO_UNSAFE_CHANGE_COUNT');
  if (!step.changes.some((c) => c.before && !c.after)) throw new Error('UNDO_NOT_A_DELETION');
  if (step.changes.some((c) => c.collection === 'inventory')) throw new Error('UNDO_INVENTORY_REQUIRES_STOCK_TRANSACTION');
  const actor = getCurrentRealFirebaseUser();
  if (!actor?.uid) throw new Error('UNDO_SIGN_IN_REQUIRED');
  const role = await fetchProjectUserRoleFromCloud(projectId, actor);
  if (role.verification !== 'verified' || !role.allowed || role.role !== 'ADMIN') {
    throw new Error('UNDO_ADMIN_ROLE_NOT_VERIFIED');
  }
  const changes = step.changes.map((c) => {
    const cloudName = STATE_KEY_TO_CLOUD_NAME[c.collection];
    if (!cloudName || !c.id || c.id.includes('/')) throw new Error('UNDO_UNSUPPORTED_COLLECTION_OR_ID');
    if (!c.before) throw new Error('UNDO_MIXED_CREATE_DELETE_REQUIRES_TRASH');
    return { ...c, ref: doc(db, 'projects', projectId, cloudName, c.id) };
  });
  const trashRef = trashOperationId ? doc(db, 'projects', projectId, 'trash', trashOperationId) : null;
  const skip = new Set(['id', 'revision', 'updatedAt', 'updatedByUid', 'updatedByEmail',
    'updatedByDeviceId', 'updatedByDeviceName', 'deleted', 'deletedAt', 'deletedByUid', 'deletedBy']);
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  return runTransaction(db, async (tx) => {
    // Firestore requires all reads before any writes.
    const snaps = [];
    for (const change of changes) snaps.push(await tx.get(change.ref));
    const trashSnap = trashRef ? await tx.get(trashRef) : null;
    const results: Array<{ collection: string; id: string; row: Record<string, any> }> = [];
    const now = Date.now();
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i], snap = snaps[i];
      if (!snap.exists()) throw new Error('UNDO_SERVER_RECORD_MISSING:' + c.id);
      const server = snap.data() as Record<string, any>;
      if (server.id && server.id !== c.id) throw new Error('UNDO_IDENTITY_MISMATCH:' + c.id);
      if (!c.after) {
        if (server.deleted === true) {
          const localDeletion = Number(expectedDeletionTimes[c.collection + '_' + c.id] || 0);
          if (!localDeletion || Number(server.deletedAt || 0) !== localDeletion || server.deletedByUid !== actor.uid) {
            throw new Error('UNDO_DELETION_CONFLICT:' + c.id);
          }
          const revision = Math.max(Number(server.revision || 0) + 1, 1);
          const updatedAt = Math.max(now, Number(server.updatedAt || 0) + 1);
          tx.update(c.ref, { deleted: false, deletedAt: null, deletedByUid: null, deletedBy: null,
            revision, updatedAt, updatedByUid: actor.uid });
          results.push({ collection: c.collection, id: c.id, row: {
            ...server, deleted: false, deletedAt: null, deletedByUid: null, deletedBy: null,
            revision, updatedAt, updatedByUid: actor.uid } });
        } else {
          // A pending local deletion was cancelled before reaching the server.
          if (Number(server.revision || 0) !== Number(c.before?.revision || 0)) {
            throw new Error('UNDO_ACTIVE_RECORD_CHANGED:' + c.id);
          }
          results.push({ collection: c.collection, id: c.id, row: server });
        }
        continue;
      }
      if (server.deleted === true) throw new Error('UNDO_LINKED_RECORD_DELETED:' + c.id);
      const desired = c.before as Record<string, any>;
      const expected = c.after as Record<string, any>;
      const patch: Record<string, any> = {};
      const removedKeys: string[] = [];
      for (const key of new Set([...Object.keys(expected), ...Object.keys(desired)])) {
        if (skip.has(key) || same(expected[key], desired[key])) continue;
        if (!same(server[key], expected[key])) throw new Error('UNDO_CONCURRENT_EDIT:' + c.id + '/' + key);
        if (!Object.prototype.hasOwnProperty.call(desired, key) || desired[key] === undefined) {
          patch[key] = deleteField(); removedKeys.push(key);
        } else patch[key] = desired[key];
      }
      if (Object.keys(patch).length === 0) {
        results.push({ collection: c.collection, id: c.id, row: server });
        continue;
      }
      const revision = Math.max(Number(server.revision || 0) + 1, 1);
      const updatedAt = Math.max(now, Number(server.updatedAt || 0) + 1);
      tx.update(c.ref, { ...patch, revision, updatedAt, updatedByUid: actor.uid });
      const next = { ...server, revision, updatedAt, updatedByUid: actor.uid };
      for (const [key, value] of Object.entries(patch)) {
        if (removedKeys.includes(key)) delete next[key]; else next[key] = value;
      }
      results.push({ collection: c.collection, id: c.id, row: next });
    }
    if (trashRef && trashSnap?.exists()) {
      const receipt = trashSnap.data();
      const ids = new Set(changes.filter((c) => !c.after).map((c) => c.collection + ':' + c.id));
      const receiptIds = new Set<string>((receipt.deletedItems || []).map((x: any) => x.collection + ':' + x.entityId));
      if (receipt.deletedByUid !== actor.uid || receipt.projectId !== projectId
        || ids.size !== receiptIds.size || [...ids].some((id) => !receiptIds.has(id))) {
        throw new Error('UNDO_TRASH_RECEIPT_MISMATCH');
      }
      tx.delete(trashRef);
    }
    return results;
  });
}
