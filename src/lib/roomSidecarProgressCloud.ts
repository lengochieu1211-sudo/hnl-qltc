/**
 * P9 opt-in cloud writer for ADMIN-seeded room subItem progress documents.
 * Not enabled from the UI until DEV migration+parity+emulator gates PASS.
 * This intentionally does not modify legacy rooms, nested IDs or schema.
 */
import { doc, runTransaction, getDocsFromServer, collection, onSnapshot } from 'firebase/firestore';
import type { RoomSubItem } from '../types';
import { db, getCurrentRealFirebaseUser } from './firebase';
import { validateRoomSidecarProgressPatch, type RoomSidecarProgress, type RoomSidecarDefinition } from '../utils/roomSidecarProgressSafety';

function assertId(value: string): void {
  if (typeof value !== 'string' || !value || value.trim() !== value ||
      value === '.' || value === '..' || value.includes('/') || /^__.*__$/.test(value) ||
      new TextEncoder().encode(value).length > 1500) {
    throw new Error('ROOM_SIDECAR_INVALID_PATH_ID');
  }
}

export async function readMigratedRoomSidecarProgress(
  projectId: string, roomId: string,
): Promise<RoomSidecarProgress[]> {
  assertId(projectId); assertId(roomId);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('ROOM_SIDECAR_SERVER_READ_REQUIRES_ONLINE');
  }
  const snap = await getDocsFromServer(collection(db, 'projects', projectId, 'rooms', roomId, 'subitem_progress'));
  return snap.docs.map((row) => ({ ...row.data(), id: row.id } as RoomSidecarProgress));
}

/** CAS = compare-and-swap (ghi khi revision máy chủ vẫn đúng phiên bản đã đọc). */
export async function updateMigratedRoomSubItemProgressAtomic(
  projectId: string,
  roomId: string,
  subItemId: string,
  changes: Readonly<Record<string, unknown>>,
  expectedRevision: number,
): Promise<{ revision: number; updatedAt: number }> {
  assertId(projectId); assertId(roomId); assertId(subItemId);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('ROOM_SIDECAR_EXPECTED_REVISION_REQUIRED');
  }
  const safeChanges = validateRoomSidecarProgressPatch(changes);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('ROOM_SIDECAR_OFFLINE_RETRY_REQUIRED');
  }
  const user = getCurrentRealFirebaseUser();
  if (!user?.uid) throw new Error('ROOM_SIDECAR_AUTH_REQUIRED');
  const roomRef = doc(db, 'projects', projectId, 'rooms', roomId);
  const definitionRef = doc(db, 'projects', projectId, 'rooms', roomId, 'subitem_definitions', subItemId);
  const progressRef = doc(db, 'projects', projectId, 'rooms', roomId, 'subitem_progress', subItemId);
  return runTransaction(db, async (tx) => {
    const [roomSnap, definitionSnap, progressSnap] = await Promise.all([
      tx.get(roomRef), tx.get(definitionRef), tx.get(progressRef),
    ]);
    if (!roomSnap.exists() || roomSnap.data().subItemProgressMigrated !== true || roomSnap.data().deleted === true) {
      throw new Error('ROOM_SIDECAR_MIGRATION_NOT_ENABLED');
    }
    if (!definitionSnap.exists() || !progressSnap.exists()) {
      throw new Error('ROOM_SIDECAR_MISSING_SEEDED_RECORD');
    }
    const current = progressSnap.data();
    if (current.id !== subItemId || current.projectId !== projectId || current.roomId !== roomId ||
        definitionSnap.data().id !== subItemId) {
      throw new Error('ROOM_SIDECAR_IDENTITY_MISMATCH');
    }
    const revision = Number(current.revision || 0);
    if (revision !== expectedRevision) throw new Error('ROOM_SIDECAR_CONFLICT_RELOAD_REQUIRED');
    // Auth may have switched accounts while async Firestore reads were pending.
    if (getCurrentRealFirebaseUser()?.uid !== user.uid) throw new Error('ROOM_SIDECAR_AUTH_CHANGED');
    const updatedAt = Math.max(Date.now(), Number(current.updatedAt || 0) + 1);
    tx.update(progressRef, {
      ...safeChanges,
      revision: revision + 1,
      updatedAt,
      updatedByUid: user.uid,
    });
    return { revision: revision + 1, updatedAt };
  });
}


/** Realtime stream for an already-migrated room. Local cache is never certified as a
 * successful sidecar read; callers must suppress edits until a server snapshot passes parity.
 */
export function subscribeMigratedRoomSidecarProgress(
  projectId: string,
  roomId: string,
  onVerified: (progress: RoomSidecarProgress[]) => void,
  onUnavailable: (error: Error) => void,
): () => void {
  assertId(projectId); assertId(roomId);
  return onSnapshot(collection(db, 'projects', projectId, 'rooms', roomId, 'subitem_progress'),
    { includeMetadataChanges: true },
    snap => {
      if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) {
        onUnavailable(new Error('ROOM_SIDECAR_UNVERIFIED_CACHE'));
        return;
      }
      onVerified(snap.docs.map(row => ({ ...row.data(), id: row.id } as RoomSidecarProgress)));
    },
    err => onUnavailable(err instanceof Error ? err : new Error(String(err))),
  );
}

/** ADMIN structural definitions are independently realtime. A cached snapshot is
 * never treated as verified. All-or-nothing parity is checked by the UI overlay.
 */
export function subscribeMigratedRoomSidecarDefinitions(
  projectId: string,
  roomId: string,
  onVerified: (definitions: RoomSidecarDefinition[]) => void,
  onUnavailable: (error: Error) => void,
): () => void {
  assertId(projectId); assertId(roomId);
  return onSnapshot(collection(db, 'projects', projectId, 'rooms', roomId, 'subitem_definitions'),
    { includeMetadataChanges: true },
    snap => {
      if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) {
        onUnavailable(new Error('ROOM_SIDECAR_DEFINITION_UNVERIFIED_CACHE'));
        return;
      }
      onVerified(snap.docs.map(row => ({ ...row.data(), id: row.id } as RoomSidecarDefinition)));
    },
    err => onUnavailable(err instanceof Error ? err : new Error(String(err))),
  );
}

/** All changed subitems of one room commit in one compare-and-swap transaction. */
export async function updateMigratedRoomSubItemsProgressAtomic(
  projectId: string,
  roomId: string,
  changes: readonly { id: string; changes: Readonly<Record<string, unknown>>; expectedRevision: number;
    expectedDefinition: RoomSidecarDefinition }[],
): Promise<void> {
  assertId(projectId); assertId(roomId);
  if (!changes.length) return;
  if (changes.length > 60) throw new Error('ROOM_SIDECAR_BATCH_TOO_LARGE');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('ROOM_SIDECAR_OFFLINE_RETRY_REQUIRED');
  }
  const actor = getCurrentRealFirebaseUser();
  if (!actor?.uid) throw new Error('ROOM_SIDECAR_AUTH_REQUIRED');
  const seen = new Set<string>();
  const prepared = changes.map(entry => {
    assertId(entry.id);
    if (seen.has(entry.id) || !Number.isSafeInteger(entry.expectedRevision) || entry.expectedRevision < 0) {
      throw new Error('ROOM_SIDECAR_INVALID_BATCH');
    }
    seen.add(entry.id);
    if (!entry.expectedDefinition || entry.expectedDefinition.id !== entry.id ||
        entry.expectedDefinition.projectId !== projectId || entry.expectedDefinition.roomId !== roomId) {
      throw new Error('ROOM_SIDECAR_STALE_DEFINITION');
    }
    return { ...entry, changes: validateRoomSidecarProgressPatch(entry.changes) };
  });
  const roomRef = doc(db, 'projects', projectId, 'rooms', roomId);
  await runTransaction(db, async tx => {
    const room = await tx.get(roomRef);
    if (!room.exists() || room.data().subItemProgressMigrated !== true || room.data().deleted === true || room.data().deletedAt != null) {
      throw new Error('ROOM_SIDECAR_MIGRATION_NOT_ENABLED');
    }
    const progress = await Promise.all(prepared.map(async entry => {
      const definitionRef = doc(db, 'projects', projectId, 'rooms', roomId, 'subitem_definitions', entry.id);
      const progressRef = doc(db, 'projects', projectId, 'rooms', roomId, 'subitem_progress', entry.id);
      const [definition, current] = await Promise.all([tx.get(definitionRef), tx.get(progressRef)]);
      if (!definition.exists() || definition.data().id !== entry.id || !current.exists()) {
        throw new Error('ROOM_SIDECAR_MISSING_SEEDED_RECORD');
      }
      // ADMIN may alter an unversioned definition after EDITOR opened the form.
      // Only write progress if all structural fields still equal the verified UI.
      const canonical = definition.data();
      for (const field of ['name','category','workCategoryId','workVolume','volumeUnit','progressWeight','order'] as const) {
        if (canonical[field] !== entry.expectedDefinition[field]) {
          throw new Error('ROOM_SIDECAR_STALE_DEFINITION');
        }
      }
      const data = current.data();
      if (data.id !== entry.id || data.projectId !== projectId || data.roomId !== roomId ||
          Number(data.revision || 0) !== entry.expectedRevision) throw new Error('ROOM_SIDECAR_CONFLICT_RELOAD_REQUIRED');
      return { entry, progressRef, data };
    }));
    if (getCurrentRealFirebaseUser()?.uid !== actor.uid) throw new Error('ROOM_SIDECAR_AUTH_CHANGED');
    for (const { entry, progressRef, data } of progress) {
      tx.update(progressRef, {
        ...entry.changes,
        revision: entry.expectedRevision + 1,
        updatedAt: Math.max(Date.now(), Number(data.updatedAt || 0) + 1),
        updatedByUid: actor.uid,
      });
    }
  });
}
