import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
} from 'firebase/firestore';
import { db, fetchProjectUserRoleFromCloud, getCurrentRealFirebaseUser } from './firebase';
import { purgeBinaryObject } from './binaryStorage';
import { getAsyncItem, setAsyncItem } from '../utils/asyncStorage';
import type { TrashOperation } from './trash';

export type BinaryPurgeArea = 'photos' | 'floor-plans';

interface BinaryPointer {
  provider: 'r2' | 'firebase-storage';
  path: string;
}

interface BinaryPurgeRetryEntry {
  id: string;
  projectId: string;
  operationId: string;
  area: BinaryPurgeArea;
  force: boolean;
  attempts: number;
  lastError?: string;
  updatedAt: number;
}

export interface TrashBinaryPurgeResult {
  complete: boolean;
  missing?: boolean;
  notDue?: boolean;
  purged: number;
  retainedShared: number;
  queuedAreas: BinaryPurgeArea[];
  error?: string;
}

export interface BinaryPurgeDrainResult {
  completedOperationIds: string[];
  pending: number;
  failed: number;
}

function onlineRequired(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('BINARY_PURGE_REQUIRES_ONLINE');
  }
}

function normalizeProvider(value: unknown): 'r2' | 'firebase-storage' | '' {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'r2' || raw.startsWith('r2:')) return 'r2';
  if (raw === 'firebase-storage' || raw === 'storage' || raw.startsWith('storage:')) return 'firebase-storage';
  return '';
}

function parseLegacyPointer(value: unknown): BinaryPointer | null {
  const raw = String(value || '').trim();
  if (raw.startsWith('r2:')) {
    const path = raw.slice(3).trim();
    return path ? { provider: 'r2', path } : null;
  }
  if (raw.startsWith('storage:')) {
    const path = raw.slice('storage:'.length).trim();
    return path ? { provider: 'firebase-storage', path } : null;
  }
  return null;
}

/** New metadata (storagePath/thumbnailPath) and legacy r2:/storage: pointers are both
 * authoritative references. This intentionally ignores Drive/firestore chunk pointers:
 * this purge module owns only R2/Firebase Storage physical objects. */
export function collectBinaryPointers(record: any): BinaryPointer[] {
  if (!record || typeof record !== 'object') return [];
  const legacy = parseLegacyPointer(record.cloudFileId) || parseLegacyPointer(record.cloudUrl) || parseLegacyPointer(record.driveUrl);
  const explicitProvider = normalizeProvider(record.storageProvider) || legacy?.provider || '';
  const pointers: BinaryPointer[] = [];
  const add = (provider: string, path: unknown) => {
    const normalized = normalizeProvider(provider);
    const cleanPath = String(path || '').trim();
    if (!normalized || !cleanPath) return;
    if (!pointers.some((item) => item.provider === normalized && item.path === cleanPath)) {
      pointers.push({ provider: normalized, path: cleanPath });
    }
  };

  if (record.storagePath) add(explicitProvider, record.storagePath);
  if (record.thumbnailPath) add(explicitProvider, record.thumbnailPath);
  if (legacy) add(legacy.provider, legacy.path);
  return pointers;
}

function pointerKey(pointer: BinaryPointer): string {
  return `${pointer.provider}:${pointer.path}`;
}

function entityKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function trashEntityKeys(operation: TrashOperation): Set<string> {
  const keys = new Set<string>();
  for (const item of operation.deletedItems || []) {
    if (item.collection === 'defects') keys.add(entityKey('defect', item.entityId));
    if (item.collection === 'crewRecords') keys.add(entityKey('crewRecord', item.entityId));
  }
  return keys;
}

function floorTargetIds(operation: TrashOperation): Set<string> {
  return new Set(
    (operation.deletedItems || [])
      .filter((item) => item.collection === 'floorPlans')
      .map((item) => String(item.entityId || ''))
      .filter(Boolean),
  );
}

function queueKey(area: BinaryPurgeArea, projectId: string, uid: string): string {
  return `construction_binary_purge_${area}_${uid}_${projectId}`;
}

async function readQueue(area: BinaryPurgeArea, projectId: string, uid: string): Promise<BinaryPurgeRetryEntry[]> {
  const rows = await getAsyncItem<BinaryPurgeRetryEntry[]>(queueKey(area, projectId, uid), []);
  return Array.isArray(rows) ? rows.filter((item) => item?.operationId && item?.projectId === projectId) : [];
}

async function writeQueue(area: BinaryPurgeArea, projectId: string, uid: string, rows: BinaryPurgeRetryEntry[]): Promise<void> {
  await setAsyncItem(queueKey(area, projectId, uid), rows);
}

async function upsertRetry(
  area: BinaryPurgeArea,
  projectId: string,
  operationId: string,
  force: boolean,
  error: unknown,
): Promise<void> {
  const user = getCurrentRealFirebaseUser();
  if (!user?.uid) return;
  const rows = await readQueue(area, projectId, user.uid).catch(() => []);
  const id = `${area}:${projectId}:${operationId}`;
  const existing = rows.find((item) => item.id === id);
  const next: BinaryPurgeRetryEntry = {
    id,
    projectId,
    operationId,
    area,
    force: Boolean(force || existing?.force),
    attempts: Number(existing?.attempts || 0) + 1,
    lastError: error instanceof Error ? error.message : String(error || 'BINARY_PURGE_RETRY'),
    updatedAt: Date.now(),
  };
  await writeQueue(area, projectId, user.uid, [next, ...rows.filter((item) => item.id !== id)]);
}

async function clearRetry(area: BinaryPurgeArea, projectId: string, operationId: string): Promise<void> {
  const user = getCurrentRealFirebaseUser();
  if (!user?.uid) return;
  const rows = await readQueue(area, projectId, user.uid).catch(() => []);
  const next = rows.filter((item) => item.operationId !== operationId);
  if (next.length !== rows.length) await writeQueue(area, projectId, user.uid, next);
}

async function requireAdmin(projectId: string) {
  onlineRequired();
  const user = getCurrentRealFirebaseUser();
  if (!user || !user.email) throw new Error('BINARY_PURGE_AUTH_REQUIRED');
  const roleInfo = await fetchProjectUserRoleFromCloud(projectId, user);
  if (roleInfo.verification !== 'verified' || !roleInfo.allowed || roleInfo.role !== 'ADMIN') {
    throw new Error('BINARY_PURGE_ADMIN_REQUIRED');
  }
  return user;
}

async function readOperation(projectId: string, operationId: string): Promise<TrashOperation | null> {
  const snap = await getDocFromServer(doc(db, 'projects', projectId, 'trash', operationId));
  if (!snap.exists()) return null;
  const data = snap.data() as TrashOperation;
  return { ...data, id: operationId, projectId };
}

function assertOperationDue(operation: TrashOperation, force: boolean): void {
  if (force) return;
  const expiresAt = Number(operation.expiresAt || 0);
  if (!expiresAt || expiresAt > Date.now()) throw new Error('BINARY_PURGE_RETENTION_NOT_EXPIRED');
}

async function purgeFloorPlanArea(operation: TrashOperation): Promise<{ purged: number; retainedShared: number }> {
  const projectId = operation.projectId;
  const targetIds = floorTargetIds(operation);
  if (targetIds.size === 0) return { purged: 0, retainedShared: 0 };

  // Read every reference from the SERVER immediately before physical DELETE. Never use
  // a cached "safe" decision from the retry queue.
  const [floorSnap, trashSnap] = await Promise.all([
    getDocsFromServer(collection(db, 'projects', projectId, 'floor_plans')),
    getDocsFromServer(collection(db, 'projects', projectId, 'trash')),
  ]);
  const floorRows = floorSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as any));

  for (const targetId of targetIds) {
    const row = floorRows.find((item) => item.id === targetId);
    if (!row || row.deleted !== true) throw new Error(`FLOOR_PURGE_TARGET_NOT_TOMBSTONED:${targetId}`);
  }

  const candidatePointers = new Map<string, BinaryPointer>();
  for (const deleted of operation.deletedItems || []) {
    if (deleted.collection !== 'floorPlans') continue;
    for (const pointer of collectBinaryPointers(deleted.snapshot)) candidatePointers.set(pointerKey(pointer), pointer);
    const row = floorRows.find((item) => item.id === deleted.entityId);
    for (const pointer of collectBinaryPointers(row)) candidatePointers.set(pointerKey(pointer), pointer);
  }

  const activeReferenceKeys = new Set<string>();
  for (const row of floorRows) {
    if (targetIds.has(row.id) || row.deleted === true) continue;
    for (const pointer of collectBinaryPointers(row)) activeReferenceKeys.add(pointerKey(pointer));
  }

  const retainedTrashReferenceKeys = new Set<string>();
  const now = Date.now();
  for (const trashDoc of trashSnap.docs) {
    if (trashDoc.id === operation.id) continue;
    const other = { ...trashDoc.data(), id: trashDoc.id, projectId } as TrashOperation;
    if (Number(other.expiresAt || 0) <= now) continue;
    for (const deleted of other.deletedItems || []) {
      if (deleted.collection !== 'floorPlans') continue;
      for (const pointer of collectBinaryPointers(deleted.snapshot)) retainedTrashReferenceKeys.add(pointerKey(pointer));
    }
  }

  let purged = 0;
  let retainedShared = 0;
  for (const [key, pointer] of candidatePointers) {
    if (activeReferenceKeys.has(key) || retainedTrashReferenceKeys.has(key)) {
      retainedShared += 1;
      continue;
    }
    await purgeBinaryObject(pointer.provider, pointer.path);
    purged += 1;
  }
  return { purged, retainedShared };
}

async function purgePhotoArea(operation: TrashOperation): Promise<{ purged: number; retainedShared: number }> {
  const projectId = operation.projectId;
  const targetEntityKeys = trashEntityKeys(operation);
  if (targetEntityKeys.size === 0) return { purged: 0, retainedShared: 0 };

  const [photoSnap, defectSnap, crewSnap, trashSnap] = await Promise.all([
    getDocsFromServer(collection(db, 'projects', projectId, 'photos')),
    getDocsFromServer(collection(db, 'projects', projectId, 'defects')),
    getDocsFromServer(collection(db, 'projects', projectId, 'crew_records')),
    getDocsFromServer(collection(db, 'projects', projectId, 'trash')),
  ]);
  const photoRows = photoSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() } as any));
  const defectRows = new Map(defectSnap.docs.map((entry) => [entry.id, entry.data()]));
  const crewRows = new Map(crewSnap.docs.map((entry) => [entry.id, entry.data()]));

  for (const key of targetEntityKeys) {
    const [type, id] = key.split(':', 2);
    const row = type === 'defect' ? defectRows.get(id) : crewRows.get(id);
    if (!row || row.deleted !== true) throw new Error(`PHOTO_PURGE_ENTITY_NOT_TOMBSTONED:${key}`);
  }

  const targets = photoRows.filter((photo) => targetEntityKeys.has(entityKey(String(photo.entityType || ''), String(photo.entityId || ''))));
  if (targets.length === 0) return { purged: 0, retainedShared: 0 };

  const candidatePointers = new Map<string, BinaryPointer>();
  for (const photo of targets) {
    for (const pointer of collectBinaryPointers(photo)) candidatePointers.set(pointerKey(pointer), pointer);
  }

  const otherActiveReferenceKeys = new Set<string>();
  for (const photo of photoRows) {
    const key = entityKey(String(photo.entityType || ''), String(photo.entityId || ''));
    if (targetEntityKeys.has(key) || photo.deleted === true) continue;
    for (const pointer of collectBinaryPointers(photo)) otherActiveReferenceKeys.add(pointerKey(pointer));
  }

  // Deleted photo rows can still be recoverable through another, unexpired Trash
  // operation. Build that relationship fresh from server trash snapshots on every try.
  const retainedDeletedEntities = new Set<string>();
  const now = Date.now();
  for (const trashDoc of trashSnap.docs) {
    if (trashDoc.id === operation.id) continue;
    const other = { ...trashDoc.data(), id: trashDoc.id, projectId } as TrashOperation;
    if (Number(other.expiresAt || 0) <= now) continue;
    for (const key of trashEntityKeys(other)) retainedDeletedEntities.add(key);
  }
  const retainedDeletedReferenceKeys = new Set<string>();
  for (const photo of photoRows) {
    const key = entityKey(String(photo.entityType || ''), String(photo.entityId || ''));
    if (!retainedDeletedEntities.has(key)) continue;
    for (const pointer of collectBinaryPointers(photo)) retainedDeletedReferenceKeys.add(pointerKey(pointer));
  }

  const retainedKeys = new Set<string>();
  let purged = 0;
  let retainedShared = 0;
  for (const [key, pointer] of candidatePointers) {
    if (otherActiveReferenceKeys.has(key) || retainedDeletedReferenceKeys.has(key)) {
      retainedKeys.add(key);
      retainedShared += 1;
      continue;
    }
    await purgeBinaryObject(pointer.provider, pointer.path);
    purged += 1;
  }

  // Only after every provider operation/reference check succeeds do we transition the
  // photo metadata to a tombstone. If this write fails, the durable retry queue keeps
  // the Trash operation and the provider DELETE is safe to replay idempotently.
  const user = getCurrentRealFirebaseUser();
  const stamp = Date.now();
  for (const photo of targets) {
    const pointers = collectBinaryPointers(photo);
    const hasRetainedPointer = pointers.some((pointer) => retainedKeys.has(pointerKey(pointer)));
    await setDoc(doc(db, 'projects', projectId, 'photos', photo.id), {
      id: photo.id,
      deleted: true,
      deletedAt: Number(photo.deletedAt || operation.deletedAt || stamp),
      deletedByUid: String(photo.deletedByUid || user?.uid || ''),
      deletedBy: String(photo.deletedBy || photo.deletedByUid || user?.uid || ''),
      revision: Math.max(Number(photo.revision || 0) + 1, 1),
      updatedAt: Math.max(Number(photo.updatedAt || 0) + 1, stamp),
      purgeAfter: Number(operation.expiresAt || stamp),
      ...(hasRetainedPointer ? { binaryRetainedSharedAt: stamp } : { binaryPurgedAt: stamp }),
    }, { merge: true });
  }
  return { purged, retainedShared };
}

function relevantAreas(operation: TrashOperation): BinaryPurgeArea[] {
  const areas: BinaryPurgeArea[] = [];
  if (floorTargetIds(operation).size > 0) areas.push('floor-plans');
  if (trashEntityKeys(operation).size > 0) areas.push('photos');
  return areas;
}

async function processArea(operation: TrashOperation, area: BinaryPurgeArea) {
  return area === 'floor-plans' ? purgeFloorPlanArea(operation) : purgePhotoArea(operation);
}

/** Authorize and process one Trash operation. A failed area is persisted in its own
 * queue; successful/shared-safe areas are removed from their queue. The Cloud Trash
 * row must remain until `complete === true`. */
export async function purgeTrashOperationBinaries(
  projectId: string,
  operationId: string,
  options: { force?: boolean } = {},
): Promise<TrashBinaryPurgeResult> {
  const force = Boolean(options.force);
  await requireAdmin(projectId);
  const operation = await readOperation(projectId, operationId);
  if (!operation) return { complete: true, missing: true, purged: 0, retainedShared: 0, queuedAreas: [] };
  try {
    assertOperationDue(operation, force);
  } catch (err) {
    if (!force && err instanceof Error && err.message === 'BINARY_PURGE_RETENTION_NOT_EXPIRED') {
      return { complete: false, notDue: true, purged: 0, retainedShared: 0, queuedAreas: [] };
    }
    throw err;
  }

  let purged = 0;
  let retainedShared = 0;
  const queuedAreas: BinaryPurgeArea[] = [];
  const errors: string[] = [];
  const areas = relevantAreas(operation);
  for (const area of areas) {
    try {
      const result = await processArea(operation, area);
      purged += result.purged;
      retainedShared += result.retainedShared;
      await clearRetry(area, projectId, operationId).catch(() => {});
    } catch (err) {
      queuedAreas.push(area);
      errors.push(`${area}:${err instanceof Error ? err.message : String(err)}`);
      await upsertRetry(area, projectId, operationId, force, err).catch((queueErr) => {
        console.warn('[Binary purge] could not persist retry queue:', area, queueErr);
      });
    }
  }

  return {
    complete: queuedAreas.length === 0,
    purged,
    retainedShared,
    queuedAreas,
    error: errors.length ? errors.join(' | ') : undefined,
  };
}

/** Retry persistent photo/floor-plan purge intents after reconnect. Every retry re-reads
 * the server Trash row, canonical ADMIN role and all references from scratch. */
export async function drainBinaryPurgeRetryQueues(projectId: string): Promise<BinaryPurgeDrainResult> {
  const user = await requireAdmin(projectId);
  const areas: BinaryPurgeArea[] = ['photos', 'floor-plans'];
  let failed = 0;
  const touched = new Set<string>();

  for (const area of areas) {
    const rows = await readQueue(area, projectId, user.uid);
    for (const entry of rows) {
      touched.add(entry.operationId);
      try {
        const operation = await readOperation(projectId, entry.operationId);
        if (!operation) {
          await clearRetry(area, projectId, entry.operationId);
          continue;
        }
        assertOperationDue(operation, entry.force);
        await processArea(operation, area);
        await clearRetry(area, projectId, entry.operationId);
      } catch (err) {
        failed += 1;
        await upsertRetry(area, projectId, entry.operationId, entry.force, err).catch(() => {});
      }
    }
  }

  const [photoQueue, floorQueue] = await Promise.all([
    readQueue('photos', projectId, user.uid),
    readQueue('floor-plans', projectId, user.uid),
  ]);
  const pendingIds = new Set([...photoQueue, ...floorQueue].map((entry) => entry.operationId));
  const completedOperationIds = [...touched].filter((operationId) => !pendingIds.has(operationId));
  return { completedOperationIds, pending: photoQueue.length + floorQueue.length, failed };
}
