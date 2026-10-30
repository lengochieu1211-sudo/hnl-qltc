import { deleteField, doc, runTransaction } from 'firebase/firestore';
import { db, fetchProjectUserRoleFromCloud, getCurrentRealFirebaseUser, sanitizePayloadForCloud } from './firebase';
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
    if (trashRef) {
      // A pending local Trash receipt must not appear later after Undo succeeded.
      // Delete/Undo of the receipt is part of the same server transaction.
      if (!trashSnap?.exists()) throw new Error('UNDO_TRASH_RECEIPT_NOT_SYNCED');
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


/** Redo the same deletion with a new Cloud tombstone and optional atomic Trash receipt.
 * A changed server revision invalidates the step. Inventory is never handled here.
 */
export async function redoDeletedHistoryOnCloud(
  projectId: string,
  step: ScopedUndoStep,
  expectedActiveVersions: Record<string, number>,
  deletedAt: number,
  receipt?: import('./trash').TrashOperation,
): Promise<Array<{ collection: string; id: string; row: Record<string, any> }>> {
  if (!projectId || step.projectId !== projectId || !Number.isFinite(deletedAt)) throw new Error('REDO_PROJECT_OR_TIME_INVALID');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('REDO_REQUIRES_ONLINE');
  if (step.changes.length === 0 || step.changes.length > 100
    || !step.changes.some((c) => c.before && !c.after)
    || step.changes.some((c) => !c.before || c.collection === 'inventory')) {
    throw new Error('REDO_UNSAFE_HISTORY_SCOPE');
  }
  const actor = getCurrentRealFirebaseUser();
  if (!actor?.uid) throw new Error('REDO_SIGN_IN_REQUIRED');
  const role = await fetchProjectUserRoleFromCloud(projectId, actor);
  if (role.verification !== 'verified' || !role.allowed || role.role !== 'ADMIN') throw new Error('REDO_ADMIN_ROLE_NOT_VERIFIED');
  const changes = step.changes.map((c) => {
    const name = STATE_KEY_TO_CLOUD_NAME[c.collection];
    if (!name || !c.id || c.id.includes('/')) throw new Error('REDO_INVALID_TARGET');
    return { ...c, ref: doc(db, 'projects', projectId, name, c.id) };
  });
  const receiptRef = receipt ? doc(db, 'projects', projectId, 'trash', receipt.id) : null;
  const skip = new Set(['id', 'revision', 'updatedAt', 'updatedByUid', 'updatedByEmail',
    'updatedByDeviceId', 'updatedByDeviceName', 'deleted', 'deletedAt', 'deletedByUid', 'deletedBy']);
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return runTransaction(db, async (tx) => {
    const snaps = [];
    for (const c of changes) snaps.push(await tx.get(c.ref));
    const existingReceipt = receiptRef ? await tx.get(receiptRef) : null;
    if (existingReceipt?.exists()) throw new Error('REDO_TRASH_RECEIPT_ALREADY_EXISTS');
    const result: Array<{ collection: string; id: string; row: Record<string, any> }> = [];
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i];
      const snap = snaps[i];
      if (!snap.exists()) throw new Error('REDO_TARGET_MISSING:' + c.id);
      const current = snap.data() as Record<string, any>;
      const key = c.collection + '_' + c.id;
      if ((current.id && current.id !== c.id) || current.deleted === true
        || Number(current.revision || 0) !== Number(expectedActiveVersions[key] || 0)) {
        throw new Error('REDO_SERVER_REVISION_CONFLICT:' + c.id);
      }
      const revision = Math.max(Number(current.revision || 0) + 1, 1);
      const updatedAt = Math.max(Date.now(), Number(current.updatedAt || 0) + 1);
      if (!c.after) {
        const deleted = { deleted: true, deletedAt, deletedByUid: actor.uid,
          deletedBy: actor.uid, revision, updatedAt, updatedByUid: actor.uid };
        tx.update(c.ref, deleted);
        result.push({ collection: c.collection, id: c.id, row: { ...current, ...deleted } });
        continue;
      }
      const original = c.before as Record<string, any>;
      const desired = c.after as Record<string, any>;
      const patch: Record<string, any> = {};
      const removed: string[] = [];
      for (const field of new Set([...Object.keys(original), ...Object.keys(desired)])) {
        if (skip.has(field) || same(original[field], desired[field])) continue;
        if (!same(current[field], original[field])) throw new Error('REDO_LINKED_CONFLICT:' + c.id + '/' + field);
        if (!Object.prototype.hasOwnProperty.call(desired, field) || desired[field] === undefined) {
          patch[field] = deleteField(); removed.push(field);
        } else patch[field] = desired[field];
      }
      if (Object.keys(patch).length > 0) tx.update(c.ref, {
        ...patch, revision, updatedAt, updatedByUid: actor.uid,
      });
      const next = { ...current, ...(Object.keys(patch).length > 0 ? { revision, updatedAt, updatedByUid: actor.uid } : {}) };
      for (const [field, value] of Object.entries(patch)) {
        if (removed.includes(field)) delete next[field]; else next[field] = value;
      }
      result.push({ collection: c.collection, id: c.id, row: next });
    }
    if (receiptRef && receipt) {
      const receiptIds = new Set((receipt.deletedItems || []).map((x) => x.collection + ':' + x.entityId));
      const ids = new Set(changes.filter((c) => !c.after).map((c) => c.collection + ':' + c.id));
      if (receipt.projectId !== projectId || receipt.deletedByUid !== actor.uid
        || receipt.deletedAt !== deletedAt || receiptIds.size !== ids.size
        || [...ids].some((id) => !receiptIds.has(id))) throw new Error('REDO_RECEIPT_MISMATCH');
      // Sanitizer skips undefined optional fields; no schema or ID changes.
      tx.set(receiptRef, sanitizePayloadForCloud(receipt));
    }
    return result;
  });
}
