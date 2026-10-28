import { collection, doc, getDocsFromServer, runTransaction } from 'firebase/firestore';
import { db, fetchProjectUserRoleFromCloud, getCurrentRealFirebaseUser } from './firebase';
import { normalizeTrashSettings, estimateTrashBytes, type TrashOperation } from './trash';
import { normalizeStructureGroupConfig, type ProjectStructureConfig } from '../utils/structureGroupUtils';
import { planEmptyStructureGroupDelete } from '../utils/structureGroupTrashPolicy';
import { createEntityId } from '../utils/idUtils';

/**
 * Two-phase delete: lock on Cloud first, query all floors second, commit
 * structure + permanent deleted-ID guard + Trash receipt third. Firestore Rules
 * deny floor create/move into a locked or deleted group, even from stale clients.
 */
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
  const settingsRef = doc(db, 'projects', projectId, 'settings', 'shared');
  const receiptId = createEntityId('TRASH');
  const receiptRef = doc(db, 'projects', projectId, 'trash', receiptId);
  const actorEmail = user.email.trim().toLowerCase();

  // A short-lived lock is persisted BEFORE the floor-index query. Any floor
  // arriving before this commit is included in the subsequent server query;
  // any floor arriving after this commit is rejected by the deployed Rules.
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(settingsRef);
    if (!snap.exists() || !snap.data().structure) throw new Error('STRUCTURE_TRASH_SHARED_SETTINGS_MISSING');
    const current = snap.data();
    const config = normalizeStructureGroupConfig(current.structure);
    if (!config.enabled) throw new Error('STRUCTURE_TRASH_GROUPING_DISABLED');
    if (groupId.includes('/') || !config.groups.some((g) => g.id === groupId)) {
      throw new Error('STRUCTURE_TRASH_GROUP_NOT_FOUND');
    }
    if (config.groups.length <= 1) throw new Error('STRUCTURE_TRASH_LAST_GROUP');
    if (!normalizeTrashSettings(current.trash).enabled) throw new Error('STRUCTURE_TRASH_MUST_ENABLE_TRASH');
    const locks: Record<string, { token: string; lockedAt: number }> =
      current.structureGroupDeleteLocks && typeof current.structureGroupDeleteLocks === 'object'
        ? { ...current.structureGroupDeleteLocks } : {};
    const previous = locks[groupId];
    const now = Date.now();
    if (previous && now - Number(previous.lockedAt || 0) < 120_000) {
      throw new Error('STRUCTURE_TRASH_GROUP_DELETE_IN_PROGRESS');
    }
    locks[groupId] = { token: receiptId, lockedAt: now };
    tx.update(settingsRef, { structureGroupDeleteLocks: locks });
  });

  try {
    const floorIndex = await getDocsFromServer(collection(db, 'projects', projectId, 'floor_plans'));
    return await runTransaction(db, async (tx) => {
      const settingsSnap = await tx.get(settingsRef);
      if (!settingsSnap.exists() || !settingsSnap.data().structure) throw new Error('STRUCTURE_TRASH_SHARED_SETTINGS_MISSING');
      const current = settingsSnap.data();
      if (current.structureGroupDeleteLocks?.[groupId]?.token !== receiptId) {
        throw new Error('STRUCTURE_TRASH_GROUP_LOCK_LOST');
      }
      const floors = await Promise.all(floorIndex.docs.map((item) => tx.get(item.ref)));
      const config = normalizeStructureGroupConfig(current.structure);
      const { deleted, next } = planEmptyStructureGroupDelete(
        config, groupId, floors.filter((row) => row.exists()).map((row) => row.data() as any),
      );
      const trashSettings = normalizeTrashSettings(current.trash);
      if (!trashSettings.enabled) throw new Error('STRUCTURE_TRASH_MUST_ENABLE_TRASH');
      const deletedAt = Date.now();
      const operation: TrashOperation = {
        id: receiptId, projectId, deletedAt,
        expiresAt: deletedAt + trashSettings.retentionDays * 86400000,
        retentionDays: trashSettings.retentionDays,
        deletedByUid: user.uid, deletedByEmail: actorEmail,
        deletedByName: user.displayName || '',
        deletedItems: [{
          collection: 'structureGroups', entityId: deleted.id,
          label: `Khu/Khối: ${deleted.name}`,
          snapshot: deleted,
        }],
        relatedBefore: {},
      };
      operation.approxBytes = estimateTrashBytes(operation);
      const remainingLocks = { ...(current.structureGroupDeleteLocks || {}) };
      delete remainingLocks[groupId];
      const deletedIds = Array.isArray(current.structureGroupDeletedIds)
        ? current.structureGroupDeletedIds.filter((id: unknown) => typeof id === 'string') as string[]
        : [];
      tx.update(settingsRef, {
        structure: next,
        structureGroupDeleteLocks: remainingLocks,
        // A permanent guard closes the lock-release / delete-commit gap.
        // Restore removes this ID atomically when the original group returns.
        structureGroupDeletedIds: Array.from(new Set([...deletedIds, deleted.id])),
        updatedAt: deletedAt, updatedByUid: user.uid, updatedByEmail: actorEmail,
      });
      tx.set(receiptRef, operation);
      return next;
    });
  } catch (error) {
    // Do not unlock a newer attempt. A disconnected attempt leaves a safe
    // (reclaimable after two minutes) lock rather than risking orphan floors.
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(settingsRef);
        if (!snap.exists() || snap.data()?.structureGroupDeleteLocks?.[groupId]?.token !== receiptId) return;
        const locks = { ...(snap.data().structureGroupDeleteLocks || {}) };
        delete locks[groupId];
        tx.update(settingsRef, { structureGroupDeleteLocks: locks });
      });
    } catch (releaseError) {
      console.warn('[Structure Trash] Group delete lock release deferred:', releaseError);
    }
    throw error;
  }
}
