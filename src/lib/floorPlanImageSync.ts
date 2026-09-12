import localforage from 'localforage';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, fetchProjectUserRoleFromCloud, getCurrentRealFirebaseUser } from './firebase';
import type { FloorPlan } from '../types';
import { downloadFloorPlanFromPrimaryDrive } from './primaryDriveBridge';
import { LEGACY_DRIVE_READ_FALLBACK } from '../config/runtimeArchitecture';
import { BINARY_STORAGE_PROVIDER, downloadBinaryBlob, uploadFloorPlanBinaryToCloud } from './binaryStorage';
import { compressImageToBlob } from '../utils/imageCompressor';

const FLOOR_PLAN_OUTBOX_PREFIX = 'floor_plan_image_outbox_v1';
const FLOOR_PLAN_CACHE_PREFIX = 'floor_plan_image_cache_v1';
const FLOOR_PLAN_CACHE_REVISIONS_PER_FLOOR = 2;
const FLOOR_PLAN_CACHE_DEFAULT_SOFT_LIMIT_BYTES = 96 * 1024 * 1024;
const FLOOR_PLAN_CACHE_MIN_SOFT_LIMIT_BYTES = 32 * 1024 * 1024;
const FLOOR_PLAN_CACHE_MAX_SOFT_LIMIT_BYTES = 160 * 1024 * 1024;

interface FloorPlanImageOutboxRecord {
  projectId: string;
  floorPlanId: string;
  revision: number;
  createdByUid: string;
  createdAt: number;
  blob: Blob;
}

export interface FloorPlanImageOutboxDiagnosticRow {
  projectId: string;
  floorPlanId: string;
  revision: number;
  createdByUid: string;
  createdAt: number;
  bytes: number;
  mimeType: string;
}

interface FloorPlanImageCacheRecord {
  projectId: string;
  floorPlanId: string;
  revision: number;
  storageProvider: string;
  storagePath: string;
  mimeType: string;
  bytes: number;
  createdAt: number;
  lastAccessedAt: number;
  blob: Blob;
}

export interface FloorPlanImageCacheDiagnosticRow {
  projectId: string;
  floorPlanId: string;
  revision: number;
  storageProvider: string;
  storagePath: string;
  bytes: number;
  mimeType: string;
  createdAt: number;
  lastAccessedAt: number;
}

export interface FloorPlanImageDisplayResolution {
  imageUrl: string;
  revision: number;
  source: 'memory' | 'cache' | 'cloud' | 'legacy' | 'remote-url';
  stale: boolean;
  bytes: number;
}

export interface FloorPlanOfflineCacheResult {
  total: number;
  cached: number;
  downloaded: number;
  skipped: number;
  failed: number;
  bytes: number;
  paused?: boolean;
}

export interface FloorPlanOfflineCacheOptions {
  priorityFloorPlanId?: string;
  shouldContinue?: () => boolean;
}

export interface FloorPlanBulkApplyResult {
  applied: number;
  storagePath: string;
  assetId: string;
  ownerFloorPlanId: string;
  bytes: number;
  metadataByFloorId: Record<string, Partial<FloorPlan>>;
}

/**
 * Smart background prefetch should be invisible to the field user. Respect explicit
 * data-saver/very slow network hints; on browsers without Network Information support
 * we fall back to navigator.onLine and download one drawing at a time.
 */
export function isFloorPlanAutoCacheNetworkSuitable(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (navigator.onLine === false) return false;
  const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  if (!connection) return true;
  if (connection.saveData === true) return false;
  const effectiveType = String(connection.effectiveType || '').toLowerCase();
  return effectiveType !== 'slow-2g' && effectiveType !== '2g';
}

function encodeOutboxSegment(value: unknown): string {
  return encodeURIComponent(String(value || '').trim());
}

function floorPlanOutboxPrefixFor(projectId: string, uid: string): string {
  return `${FLOOR_PLAN_OUTBOX_PREFIX}:${encodeOutboxSegment(uid)}:${encodeOutboxSegment(projectId)}:`;
}

function floorPlanOutboxKey(projectId: string, floorPlanId: string, revision: number, uid: string): string {
  return `${floorPlanOutboxPrefixFor(projectId, uid)}${encodeOutboxSegment(floorPlanId)}:${Math.max(0, Number(revision || 0))}`;
}

export function isDisplayableFloorPlanUrl(value?: string | null): boolean {
  const url = String(value || '').trim();
  return url.startsWith('data:image/') || url.startsWith('blob:') || /^https?:\/\//i.test(url);
}

export function isLocalFloorPlanBinaryUrl(value?: string | null): boolean {
  const url = String(value || '').trim();
  return url.startsWith('data:image/') || url.startsWith('blob:');
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i);
  if (!match) return null;
  try {
    const binary = atob(match[2] || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] || 'image/jpeg' });
  } catch (_) {
    return null;
  }
}

async function sourceToBlob(source: string): Promise<Blob | null> {
  const value = String(source || '').trim();
  if (!value) return null;
  if (value.startsWith('data:image/')) return dataUrlToBlob(value);
  if (value.startsWith('blob:')) {
    try {
      const response = await fetch(value);
      if (!response.ok) return null;
      const blob = await response.blob();
      return blob.size > 0 ? blob : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Không đọc được ảnh mặt bằng.'));
    reader.readAsDataURL(blob);
  });
}

function floorPlanCachePrefixFor(projectId: string, floorPlanId?: string): string {
  const projectPrefix = `${FLOOR_PLAN_CACHE_PREFIX}:${encodeOutboxSegment(projectId)}:`;
  return floorPlanId ? `${projectPrefix}${encodeOutboxSegment(floorPlanId)}:` : projectPrefix;
}

function floorPlanCacheKey(projectId: string, floorPlanId: string, revision: number): string {
  return `${floorPlanCachePrefixFor(projectId, floorPlanId)}${Math.max(0, Number(revision || 0))}`;
}

function resolveFloorPlanCloudRevision(plan: FloorPlan): number {
  return Math.max(0, Number(plan.imageCloudRevision || plan.imageRevision || (plan as any).imageOutboxRevision || plan.updatedAt || 0));
}

async function validateFloorPlanCacheBlob(blob: Blob): Promise<boolean> {
  if (!(blob instanceof Blob) || blob.size <= 0) return false;
  const mimeType = String(blob.type || '').toLowerCase();
  if (mimeType && !mimeType.startsWith('image/')) return false;
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      const valid = bitmap.width > 0 && bitmap.height > 0;
      bitmap.close();
      return valid;
    } catch (_) {
      return false;
    }
  }
  return true;
}

async function getFloorPlanCacheBudgetBytes(): Promise<number> {
  try {
    const estimate = typeof navigator !== 'undefined' && navigator.storage?.estimate
      ? await navigator.storage.estimate()
      : null;
    const quota = Number(estimate?.quota || 0);
    if (quota > 0) {
      return Math.max(
        FLOOR_PLAN_CACHE_MIN_SOFT_LIMIT_BYTES,
        Math.min(FLOOR_PLAN_CACHE_MAX_SOFT_LIMIT_BYTES, Math.floor(quota * 0.15)),
      );
    }
  } catch (_) {}
  return FLOOR_PLAN_CACHE_DEFAULT_SOFT_LIMIT_BYTES;
}

async function readFloorPlanCacheRecord(
  projectId: string,
  floorPlanId: string,
  revision: number,
): Promise<FloorPlanImageCacheRecord | null> {
  if (!projectId || !floorPlanId || revision <= 0) return null;
  const key = floorPlanCacheKey(projectId, floorPlanId, revision);
  const record = await localforage.getItem<FloorPlanImageCacheRecord>(key).catch(() => null);
  if (!record?.blob || record.projectId !== projectId || record.floorPlanId !== floorPlanId || Number(record.revision || 0) !== revision) {
    if (record) await localforage.removeItem(key).catch(() => {});
    return null;
  }
  if (!(await validateFloorPlanCacheBlob(record.blob))) {
    await localforage.removeItem(key).catch(() => {});
    return null;
  }
  const touched = { ...record, bytes: record.blob.size, lastAccessedAt: Date.now() };
  await localforage.setItem(key, touched).catch(() => {});
  return touched;
}

async function readLatestFloorPlanCacheRecord(
  projectId: string,
  floorPlanId: string,
  maxRevision = Number.MAX_SAFE_INTEGER,
): Promise<FloorPlanImageCacheRecord | null> {
  if (!projectId || !floorPlanId) return null;
  const prefix = floorPlanCachePrefixFor(projectId, floorPlanId);
  const keys = await localforage.keys();
  const revisions = keys
    .filter((key) => key.startsWith(prefix))
    .map((key) => Number(decodeURIComponent(key.slice(prefix.length)) || 0))
    .filter((revision) => Number.isFinite(revision) && revision > 0 && revision <= maxRevision)
    .sort((a, b) => b - a);
  for (const revision of revisions) {
    const record = await readFloorPlanCacheRecord(projectId, floorPlanId, revision);
    if (record) return record;
  }
  return null;
}

/** Reuse one cached immutable binary across every floor that points at the same asset.
 * This avoids storing/downloading the same typical-floor drawing 20-30 times. */
async function readFloorPlanCacheRecordByStoragePointer(
  projectId: string,
  plan: FloorPlan,
): Promise<FloorPlanImageCacheRecord | null> {
  const pointer = parseStoragePointer(plan);
  const path = String(pointer.path || plan.storagePath || '').trim();
  if (!projectId || !path) return null;
  const provider = String(pointer.provider || plan.storageProvider || '').trim();
  const prefix = floorPlanCachePrefixFor(projectId);
  const keys = await localforage.keys();
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const record = await localforage.getItem<FloorPlanImageCacheRecord>(key).catch(() => null);
    if (!record?.blob || String(record.storagePath || '').trim() !== path) continue;
    if (provider && record.storageProvider && String(record.storageProvider) !== provider) continue;
    const verified = await readFloorPlanCacheRecord(record.projectId, record.floorPlanId, Number(record.revision || 0));
    if (verified) return verified;
  }
  return null;
}

async function pruneFloorPlanImageCache(projectId: string, floorPlanId: string, keepKey: string): Promise<void> {
  const floorPrefix = floorPlanCachePrefixFor(projectId, floorPlanId);
  const keys = await localforage.keys();
  const floorRows: Array<{ key: string; record: FloorPlanImageCacheRecord }> = [];
  for (const key of keys) {
    if (!key.startsWith(floorPrefix)) continue;
    const record = await localforage.getItem<FloorPlanImageCacheRecord>(key).catch(() => null);
    if (!record?.blob || !(record.blob instanceof Blob) || record.blob.size <= 0) {
      await localforage.removeItem(key).catch(() => {});
      continue;
    }
    floorRows.push({ key, record });
  }
  floorRows.sort((a, b) => Number(b.record.revision || 0) - Number(a.record.revision || 0));
  for (const row of floorRows.slice(FLOOR_PLAN_CACHE_REVISIONS_PER_FLOOR)) {
    if (row.key !== keepKey) await localforage.removeItem(row.key).catch(() => {});
  }

  const budget = await getFloorPlanCacheBudgetBytes();
  const remainingKeys = (await localforage.keys()).filter((key) => key.startsWith(`${FLOOR_PLAN_CACHE_PREFIX}:`));
  const rows: Array<{ key: string; bytes: number; lastAccessedAt: number }> = [];
  let totalBytes = 0;
  for (const key of remainingKeys) {
    const record = await localforage.getItem<FloorPlanImageCacheRecord>(key).catch(() => null);
    if (!record?.blob || !(record.blob instanceof Blob) || record.blob.size <= 0) continue;
    const bytes = Number(record.blob.size || record.bytes || 0);
    totalBytes += bytes;
    rows.push({ key, bytes, lastAccessedAt: Number(record.lastAccessedAt || record.createdAt || 0) });
  }
  if (totalBytes <= budget) return;
  rows.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
  for (const row of rows) {
    if (totalBytes <= budget) break;
    if (row.key === keepKey) continue;
    await localforage.removeItem(row.key).catch(() => {});
    totalBytes -= row.bytes;
  }
}

async function cacheFloorPlanBlob(projectId: string, plan: FloorPlan, revision: number, blob: Blob): Promise<FloorPlanImageCacheRecord | null> {
  if (!projectId || !plan?.id || revision <= 0 || !(await validateFloorPlanCacheBlob(blob))) return null;
  const now = Date.now();
  const pointer = parseStoragePointer(plan);
  const record: FloorPlanImageCacheRecord = {
    projectId,
    floorPlanId: plan.id,
    revision,
    storageProvider: pointer.provider || String(plan.storageProvider || ''),
    storagePath: pointer.path || String(plan.storagePath || ''),
    mimeType: blob.type || plan.imageMimeType || 'image/jpeg',
    bytes: blob.size,
    createdAt: now,
    lastAccessedAt: now,
    blob,
  };
  const key = floorPlanCacheKey(projectId, plan.id, revision);
  await localforage.setItem(key, record);
  await pruneFloorPlanImageCache(projectId, plan.id, key).catch(() => {});
  return record;
}

async function writeFloorPlanOutboxBlob(
  projectId: string,
  floorPlanId: string,
  revision: number,
  blob: Blob,
  uid: string,
): Promise<void> {
  if (!projectId || !floorPlanId || !uid || !blob || blob.size <= 0) {
    throw new Error('FLOOR_PLAN_OUTBOX_INVALID');
  }
  const record: FloorPlanImageOutboxRecord = {
    projectId,
    floorPlanId,
    revision: Number(revision || Date.now()),
    createdByUid: uid,
    createdAt: Date.now(),
    blob,
  };
  await localforage.setItem(floorPlanOutboxKey(projectId, floorPlanId, record.revision, uid), record);
}

/** Persist the replacement drawing before React/Firestore reconciliation can touch it. */
export async function stageFloorPlanImageOutbox(
  projectId: string,
  floorPlanId: string,
  revision: number,
  imageUrl: string,
): Promise<{ bytes: number; mimeType: string }> {
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous || !user.uid) throw new Error('FLOOR_PLAN_OUTBOX_AUTH_UNAVAILABLE');
  const blob = await sourceToBlob(imageUrl);
  if (!blob || blob.size <= 0) throw new Error('FLOOR_PLAN_OUTBOX_BINARY_UNREADABLE');
  await writeFloorPlanOutboxBlob(projectId, floorPlanId, revision, blob, user.uid);
  return { bytes: blob.size, mimeType: blob.type || 'image/jpeg' };
}

async function getFloorPlanOutboxRecord(
  projectId: string,
  floorPlanId: string,
  revision: number,
  uid: string,
): Promise<FloorPlanImageOutboxRecord | null> {
  if (!projectId || !floorPlanId || !uid || !revision) return null;
  const record = await localforage.getItem<FloorPlanImageOutboxRecord>(floorPlanOutboxKey(projectId, floorPlanId, revision, uid));
  if (!record?.blob || !(record.blob instanceof Blob) || record.blob.size <= 0) return null;
  if (record.projectId !== projectId || record.floorPlanId !== floorPlanId || Number(record.revision || 0) !== Number(revision)) return null;
  if (record.createdByUid !== uid) return null;
  return record;
}

async function getLatestFloorPlanOutboxRevision(projectId: string, floorPlanId: string, uid: string): Promise<number> {
  if (!projectId || !floorPlanId || !uid) return 0;
  const prefix = floorPlanOutboxPrefixFor(projectId, uid);
  const keys = await localforage.keys();
  let latest = 0;
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const record = await localforage.getItem<FloorPlanImageOutboxRecord>(key).catch(() => null);
    if (!record || record.floorPlanId !== floorPlanId || record.createdByUid !== uid) continue;
    latest = Math.max(latest, Number(record.revision || 0));
  }
  return latest;
}

async function clearFloorPlanOutboxUpTo(projectId: string, floorPlanId: string, revision: number, uid: string): Promise<void> {
  if (!projectId || !floorPlanId || !uid) return;
  const prefix = floorPlanOutboxPrefixFor(projectId, uid);
  const keys = await localforage.keys();
  await Promise.all(keys.map(async (key) => {
    if (!key.startsWith(prefix)) return;
    const record = await localforage.getItem<FloorPlanImageOutboxRecord>(key).catch(() => null);
    if (!record || record.floorPlanId !== floorPlanId || record.createdByUid !== uid) return;
    if (Number(record.revision || 0) <= Number(revision || 0)) await localforage.removeItem(key).catch(() => {});
  }));
}

export async function getFloorPlanImageOutboxSnapshot(projectId: string): Promise<FloorPlanImageOutboxDiagnosticRow[]> {
  const user = getCurrentRealFirebaseUser();
  if (!projectId || !user?.uid) return [];
  const prefix = floorPlanOutboxPrefixFor(projectId, user.uid);
  const keys = await localforage.keys();
  const rows: FloorPlanImageOutboxDiagnosticRow[] = [];
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const record = await localforage.getItem<FloorPlanImageOutboxRecord>(key).catch(() => null);
    if (!record?.blob || record.projectId !== projectId || record.createdByUid !== user.uid) continue;
    rows.push({
      projectId,
      floorPlanId: record.floorPlanId,
      revision: Number(record.revision || 0),
      createdByUid: record.createdByUid,
      createdAt: Number(record.createdAt || 0),
      bytes: Number(record.blob.size || 0),
      mimeType: String(record.blob.type || ''),
    });
  }
  return rows.sort((a, b) => b.revision - a.revision);
}

export async function getFloorPlanImageCacheSnapshot(projectId: string): Promise<FloorPlanImageCacheDiagnosticRow[]> {
  if (!projectId) return [];
  const prefix = floorPlanCachePrefixFor(projectId);
  const keys = await localforage.keys();
  const rows: FloorPlanImageCacheDiagnosticRow[] = [];
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const record = await localforage.getItem<FloorPlanImageCacheRecord>(key).catch(() => null);
    if (!record?.blob || !(record.blob instanceof Blob) || record.projectId !== projectId || record.blob.size <= 0) continue;
    if (!(await validateFloorPlanCacheBlob(record.blob))) {
      await localforage.removeItem(key).catch(() => {});
      continue;
    }
    rows.push({
      projectId,
      floorPlanId: record.floorPlanId,
      revision: Number(record.revision || 0),
      storageProvider: String(record.storageProvider || ''),
      storagePath: String(record.storagePath || ''),
      bytes: Number(record.blob.size || record.bytes || 0),
      mimeType: String(record.blob.type || record.mimeType || ''),
      createdAt: Number(record.createdAt || 0),
      lastAccessedAt: Number(record.lastAccessedAt || 0),
    });
  }
  return rows.sort((a, b) => b.revision - a.revision || b.lastAccessedAt - a.lastAccessedAt);
}

async function deleteFallbackChunks(projectId: string, floorPlanId: string): Promise<void> {
  const chunksRef = collection(db, 'projects', projectId, 'floor_plan_images', floorPlanId, 'chunks');
  const snap = await getDocs(chunksRef);
  if (snap.empty) return;
  let batch = writeBatch(db);
  let count = 0;
  for (const chunkDoc of snap.docs) {
    batch.delete(chunkDoc.ref);
    count++;
    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

export async function syncFloorPlanImageToCloud(projectId: string, plan: FloorPlan): Promise<Partial<FloorPlan> | null> {
  if (!projectId || !plan?.id) return null;
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous || !user.uid) return null;

  const revision = Number(plan.imageRevision || (plan as any).imageOutboxRevision || (plan as any).updatedAt || Date.now());
  if (Number(plan.imageCloudRevision || 0) >= revision && plan.storageProvider === BINARY_STORAGE_PROVIDER && plan.storagePath) {
    await clearFloorPlanOutboxUpTo(projectId, plan.id, revision, user.uid).catch(() => {});
    return null;
  }

  // Capture a local data/blob URL into IndexedDB BEFORE any auth/network work. If a
  // realtime snapshot races this upload, the binary still survives under this revision.
  let blob: Blob | null = null;
  if (isLocalFloorPlanBinaryUrl(plan.imageUrl)) {
    blob = await sourceToBlob(plan.imageUrl);
    if (blob && blob.size > 0) {
      await writeFloorPlanOutboxBlob(projectId, plan.id, revision, blob, user.uid);
    }
  }
  if (!blob || blob.size <= 0) {
    const outbox = await getFloorPlanOutboxRecord(projectId, plan.id, revision, user.uid);
    blob = outbox?.blob || null;
  }
  if (!blob || blob.size <= 0) throw new Error(`FLOOR_PLAN_BINARY_MISSING:${plan.floorName || plan.id}:${revision}`);

  // Firebase-only deliberately makes getCurrentUserRole() return VIEWER, so upload
  // authorization MUST use the project-scoped Cloud role instead of the legacy cache.
  const roleInfo = await fetchProjectUserRoleFromCloud(projectId, user);
  if (roleInfo.verification !== 'verified') throw new Error('FLOOR_PLAN_ROLE_VERIFICATION_UNAVAILABLE');
  if (!roleInfo.allowed || roleInfo.role !== 'ADMIN') throw new Error('FLOOR_PLAN_ADMIN_REQUIRED');

  let thumbnailBlob: Blob | null = null;
  try { thumbnailBlob = await compressImageToBlob(blob, 480, 0.72); } catch (_) {}
  const uploaded = await uploadFloorPlanBinaryToCloud({
    projectId,
    floorPlanId: plan.id,
    blob,
    thumbnailBlob,
    createdByUid: user.uid,
    createdAt: Number((plan as any).createdAt || Date.now()),
  });

  // If the user replaced the same floor again while revision A was uploading, never
  // publish A as the latest Firestore pointer. B remains in the outbox and wins.
  const latestPendingRevision = await getLatestFloorPlanOutboxRevision(projectId, plan.id, user.uid).catch(() => revision);
  if (latestPendingRevision > revision) {
    await clearFloorPlanOutboxUpTo(projectId, plan.id, revision, user.uid).catch(() => {});
    return null;
  }

  const now = Date.now();
  const metadata: Partial<FloorPlan> & Record<string, any> = {
    imageUrl: `cloud-floorplan:${uploaded.provider}:${uploaded.storagePath}`,
    cloudFileId: `${uploaded.provider === 'r2' ? 'r2' : 'storage'}:${uploaded.storagePath}`,
    storageProvider: uploaded.provider,
    storagePath: uploaded.storagePath,
    thumbnailPath: uploaded.thumbnailPath || '',
    storageMd5Hash: uploaded.checksum || '',
    storageEtag: uploaded.etag || '',
    imageMimeType: uploaded.mimeType || blob.type || 'image/jpeg',
    imageFileSize: Number(uploaded.size || blob.size || 0),
    imageRevision: revision,
    imageCloudRevision: revision,
    imageCloudSyncedAt: now,
    imageAssetId: `floor-plan-asset:${uploaded.provider}:${uploaded.storagePath}`,
    imageAssetOwnerFloorId: plan.id,
    imageUploadState: 'ready',
    imagePendingByUid: null,
    imageOutboxRevision: revision,
    revision: Math.max(Number((plan as any).revision || 0), 0) + 1,
    updatedByUid: user.uid,
    deletedAt: null,
    deletedByUid: null,
    deletedBy: null,
    updatedAt: Math.max(now, Number((plan as any).updatedAt || 0) + 1),
  };
  await setDoc(doc(db, 'projects', projectId, 'floor_plans', plan.id), metadata, { merge: true });
  // The uploader should be offline-ready immediately after a successful atomic publish;
  // cache failure must never turn a successful Cloud upload into a failed business write.
  await cacheFloorPlanBlob(projectId, { ...plan, ...metadata } as FloorPlan, revision, blob).catch((err) => {
    console.warn('[Floor Plan Image] post-upload offline cache warning:', plan.floorName, err);
  });
  await clearFloorPlanOutboxUpTo(projectId, plan.id, revision, user.uid).catch(() => {});

  // Do not delete Drive/chunk legacy binary yet. Migration cleanup is a separate,
  // verified purge pass after count + checksum + Firestore-reference parity.
  return metadata;
}

/**
 * Apply one immutable drawing binary to multiple existing floors. The binary is uploaded
 * exactly once; each floor keeps its own document/revision and only shares the asset
 * pointer. Business data (rooms, defects, progress, checklist, etc.) is never touched.
 *
 * Bulk apply deliberately requires every target to be cloud-stable first. If another
 * replacement is pending, fail closed instead of racing an in-flight upload.
 */
export async function applyFloorPlanImageToMultipleFloors(
  projectId: string,
  plans: FloorPlan[],
  imageUrl: string,
): Promise<FloorPlanBulkApplyResult> {
  if (!projectId) throw new Error('FLOOR_PLAN_BULK_PROJECT_REQUIRED');
  const uniquePlans = Array.from(new Map((plans || []).filter((plan) => plan?.id).map((plan) => [plan.id, plan])).values());
  if (uniquePlans.length < 2) throw new Error('FLOOR_PLAN_BULK_REQUIRES_MULTIPLE_TARGETS');
  if (uniquePlans.length > 400) throw new Error('FLOOR_PLAN_BULK_TOO_MANY_TARGETS');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('FLOOR_PLAN_BULK_REQUIRES_ONLINE');

  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous || !user.uid) throw new Error('FLOOR_PLAN_BULK_AUTH_UNAVAILABLE');
  const roleInfo = await fetchProjectUserRoleFromCloud(projectId, user);
  if (roleInfo.verification !== 'verified') throw new Error('FLOOR_PLAN_ROLE_VERIFICATION_UNAVAILABLE');
  if (!roleInfo.allowed || roleInfo.role !== 'ADMIN') throw new Error('FLOOR_PLAN_ADMIN_REQUIRED');

  const busyTarget = uniquePlans.find((plan) => {
    const uploadState = String((plan as any).imageUploadState || '').toLowerCase();
    const imageRevision = Number(plan.imageRevision || 0);
    const cloudRevision = Number(plan.imageCloudRevision || 0);
    return uploadState === 'pending' || imageRevision > cloudRevision;
  });
  if (busyTarget) throw new Error(`FLOOR_PLAN_BULK_TARGET_PENDING:${busyTarget.floorName || busyTarget.id}`);

  const blob = await sourceToBlob(imageUrl);
  if (!blob || blob.size <= 0) throw new Error('FLOOR_PLAN_BULK_BINARY_UNREADABLE');
  let thumbnailBlob: Blob | null = null;
  try { thumbnailBlob = await compressImageToBlob(blob, 480, 0.72); } catch (_) {}

  const ownerPlan = uniquePlans[0];
  const uploaded = await uploadFloorPlanBinaryToCloud({
    projectId,
    floorPlanId: ownerPlan.id,
    blob,
    thumbnailBlob,
    createdByUid: user.uid,
    createdAt: Number((ownerPlan as any).createdAt || Date.now()),
  });
  const now = Date.now();
  const assetId = `floor-plan-asset:${uploaded.provider}:${uploaded.storagePath}`;
  const metadataByFloorId: Record<string, Partial<FloorPlan>> = {};
  const batch = writeBatch(db);

  uniquePlans.forEach((plan, index) => {
    const revision = Math.max(
      now + index,
      Number(plan.imageRevision || 0) + 1,
      Number(plan.imageCloudRevision || 0) + 1,
      Number((plan as any).updatedAt || 0) + 1,
    );
    const metadata: Partial<FloorPlan> & Record<string, any> = {
      imageUrl: `cloud-floorplan:${uploaded.provider}:${uploaded.storagePath}`,
      cloudFileId: `${uploaded.provider === 'r2' ? 'r2' : 'storage'}:${uploaded.storagePath}`,
      storageProvider: uploaded.provider,
      storagePath: uploaded.storagePath,
      thumbnailPath: uploaded.thumbnailPath || '',
      storageMd5Hash: uploaded.checksum || '',
      storageEtag: uploaded.etag || '',
      imageMimeType: uploaded.mimeType || blob.type || 'image/jpeg',
      imageFileSize: Number(uploaded.size || blob.size || 0),
      imageRevision: revision,
      imageCloudRevision: revision,
      imageCloudSyncedAt: now,
      imageAssetId: assetId,
      imageAssetOwnerFloorId: ownerPlan.id,
      imageUploadState: 'ready',
      imagePendingByUid: null,
      imageOutboxRevision: revision,
      updatedAt: revision,
      revision: Math.max(Number((plan as any).revision || 0), 0) + 1,
      updatedByUid: user.uid,
      deletedAt: null,
      deletedByUid: null,
      deletedBy: null,
    };
    metadataByFloorId[plan.id] = metadata;
    batch.set(doc(db, 'projects', projectId, 'floor_plans', plan.id), metadata, { merge: true });
  });

  await batch.commit();

  // Store one physical offline cache copy only. All other selected floors resolve the
  // same immutable storagePath through readFloorPlanCacheRecordByStoragePointer().
  const ownerMetadata = metadataByFloorId[ownerPlan.id];
  await cacheFloorPlanBlob(
    projectId,
    { ...ownerPlan, ...ownerMetadata } as FloorPlan,
    Number(ownerMetadata.imageCloudRevision || ownerMetadata.imageRevision || now),
    blob,
  ).catch((err) => console.warn('[Floor Plan Image] shared asset cache warning:', err));

  return {
    applied: uniquePlans.length,
    storagePath: uploaded.storagePath,
    assetId,
    ownerFloorPlanId: ownerPlan.id,
    bytes: Number(uploaded.size || blob.size || 0),
    metadataByFloorId,
  };
}

async function downloadFallback(projectId: string, plan: FloorPlan): Promise<Blob | null> {
  const metaSnap = await getDoc(doc(db, 'projects', projectId, 'floor_plan_images', plan.id));
  if (!metaSnap.exists() || metaSnap.data()?.deleted) return null;
  const q = query(collection(db, 'projects', projectId, 'floor_plan_images', plan.id, 'chunks'), orderBy('index', 'asc'));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const parts: Uint8Array[] = [];
  snap.forEach((chunkDoc) => {
    const value = chunkDoc.data()?.data;
    if (value && typeof value.toUint8Array === 'function') parts.push(value.toUint8Array());
  });
  if (parts.length === 0) return null;
  return new Blob(parts, { type: plan.imageMimeType || metaSnap.data()?.mimeType || 'image/jpeg' });
}

function parseDriveFileId(plan: FloorPlan): string {
  if (plan.driveFileId) return String(plan.driveFileId);
  const raw = String(plan.cloudFileId || plan.driveUrl || '');
  if (!raw.startsWith('drive:')) return '';
  const parts = raw.split(':');
  return parts.length >= 3 ? parts.slice(2).join(':') : parts[1] || '';
}

function parseStoragePointer(plan: FloorPlan): { provider: string; path: string } {
  const raw = String(plan.cloudFileId || '');
  const inferredProvider = raw.startsWith('r2:') ? 'r2' : raw.startsWith('storage:') ? 'firebase-storage' : '';
  if (plan.storagePath) return { provider: String(plan.storageProvider || inferredProvider), path: String(plan.storagePath) };
  if (raw.startsWith('r2:')) return { provider: 'r2', path: raw.slice(3) };
  if (raw.startsWith('storage:')) return { provider: 'firebase-storage', path: raw.slice('storage:'.length) };
  return { provider: '', path: '' };
}

async function downloadFloorPlanBlobFromCloud(projectId: string, plan: FloorPlan): Promise<{ blob: Blob; source: 'cloud' | 'legacy' } | null> {
  let blob: Blob | null = null;
  let source: 'cloud' | 'legacy' = 'cloud';
  const pointer = parseStoragePointer(plan);
  if (pointer.path && (pointer.provider === 'r2' || pointer.provider === 'firebase-storage')) {
    blob = await downloadBinaryBlob(pointer.provider, pointer.path);
  }

  if (!blob && LEGACY_DRIVE_READ_FALLBACK) {
    const driveFileId = parseDriveFileId(plan);
    if (driveFileId && (plan.storageProvider === 'google-drive-primary' || plan.driveFileId || String(plan.cloudFileId || '').startsWith('drive:'))) {
      try {
        blob = await downloadFloorPlanFromPrimaryDrive(projectId, plan.id, driveFileId, plan.imageMimeType || 'image/jpeg');
        if (blob) source = 'legacy';
      } catch (err) {
        console.warn('[Floor Plan Image] legacy Drive read warning:', err);
      }
    }
  }

  if (!blob) {
    try {
      blob = await downloadFallback(projectId, plan);
      if (blob) source = 'legacy';
    } catch (err) {
      console.warn('[Floor Plan Image] legacy Firestore chunk read warning:', err);
    }
  }
  if (!blob || blob.size <= 0) return null;
  return { blob, source };
}

export async function resolveFloorPlanImageForDisplay(
  projectId: string,
  plan: FloorPlan,
  options: { allowStaleCache?: boolean } = {},
): Promise<FloorPlanImageDisplayResolution | null> {
  if (!projectId || !plan?.id) return null;
  const rawImageUrl = String(plan.imageUrl || '').trim();
  const revision = resolveFloorPlanCloudRevision(plan);
  if (isLocalFloorPlanBinaryUrl(rawImageUrl) && !rawImageUrl.includes('[IMAGE_OMITTED')) {
    return { imageUrl: rawImageUrl, revision, source: 'memory', stale: false, bytes: Number(plan.imageFileSize || 0) };
  }
  if (revision > 0) {
    const exactCache = await readFloorPlanCacheRecord(projectId, plan.id, revision);
    if (exactCache) {
      return {
        imageUrl: await blobToDataUrl(exactCache.blob),
        revision: exactCache.revision,
        source: 'cache',
        stale: false,
        bytes: exactCache.blob.size,
      };
    }

    // Typical floors may intentionally share one immutable R2/Storage object. Reuse
    // any cached copy of that exact pointer instead of downloading/storing N copies.
    const sharedPointerCache = await readFloorPlanCacheRecordByStoragePointer(projectId, plan);
    if (sharedPointerCache) {
      return {
        imageUrl: await blobToDataUrl(sharedPointerCache.blob),
        revision,
        source: 'cache',
        stale: false,
        bytes: sharedPointerCache.blob.size,
      };
    }
  }

  const allowStaleCache = options.allowStaleCache === true;
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!offline && /^https?:\/\//i.test(rawImageUrl) && !rawImageUrl.includes('[IMAGE_OMITTED')) {
    return { imageUrl: rawImageUrl, revision, source: 'remote-url', stale: false, bytes: Number(plan.imageFileSize || 0) };
  }
  if (offline && allowStaleCache) {
    const staleCache = await readLatestFloorPlanCacheRecord(projectId, plan.id, revision > 0 ? revision - 1 : Number.MAX_SAFE_INTEGER);
    if (staleCache) {
      return { imageUrl: await blobToDataUrl(staleCache.blob), revision: staleCache.revision, source: 'cache', stale: true, bytes: staleCache.blob.size };
    }
  }

  if (!offline) {
    try {
      const downloaded = await downloadFloorPlanBlobFromCloud(projectId, plan);
      if (downloaded) {
        if (revision > 0) {
          await cacheFloorPlanBlob(projectId, plan, revision, downloaded.blob).catch((err) => {
            console.warn('[Floor Plan Image] cache write warning:', plan.floorName, err);
          });
        }
        return {
          imageUrl: await blobToDataUrl(downloaded.blob),
          revision,
          source: downloaded.source,
          stale: false,
          bytes: downloaded.blob.size,
        };
      }
    } catch (err) {
      console.warn('[Floor Plan Image] cloud download warning:', plan.floorName, err);
    }
  }

  if (allowStaleCache) {
    const staleCache = await readLatestFloorPlanCacheRecord(projectId, plan.id, revision > 0 ? revision - 1 : Number.MAX_SAFE_INTEGER);
    if (staleCache) {
      return { imageUrl: await blobToDataUrl(staleCache.blob), revision: staleCache.revision, source: 'cache', stale: true, bytes: staleCache.blob.size };
    }
  }
  return null;
}

export async function loadFloorPlanImageFromCloud(projectId: string, plan: FloorPlan): Promise<string | null> {
  const resolved = await resolveFloorPlanImageForDisplay(projectId, plan, { allowStaleCache: false });
  return resolved?.imageUrl || null;
}

export async function cacheFloorPlansForOffline(
  projectId: string,
  plans: FloorPlan[],
  onProgress?: (progress: { completed: number; total: number; floorPlanId: string; status: 'cached' | 'downloaded' | 'failed' | 'skipped' }) => void,
  options: FloorPlanOfflineCacheOptions = {},
): Promise<FloorPlanOfflineCacheResult> {
  const rawCandidates = (plans || []).filter((plan) => {
    if (!plan?.id) return false;
    const revision = resolveFloorPlanCloudRevision(plan);
    const pointer = parseStoragePointer(plan);
    return revision > 0 && Boolean(pointer.path || parseDriveFileId(plan) || plan.storageProvider === 'firestore-fallback');
  });
  const priorityFloorPlanId = String(options.priorityFloorPlanId || '');
  const candidates = priorityFloorPlanId
    ? [...rawCandidates].sort((a, b) => Number(b.id === priorityFloorPlanId) - Number(a.id === priorityFloorPlanId))
    : rawCandidates;
  const result: FloorPlanOfflineCacheResult = { total: candidates.length, cached: 0, downloaded: 0, skipped: 0, failed: 0, bytes: 0, paused: false };
  let completed = 0;
  for (const plan of candidates) {
    if (options.shouldContinue && !options.shouldContinue()) {
      result.paused = true;
      break;
    }
    const revision = resolveFloorPlanCloudRevision(plan);
    try {
      const existing = await readFloorPlanCacheRecord(projectId, plan.id, revision);
      const sharedPointerCache = existing ? null : await readFloorPlanCacheRecordByStoragePointer(projectId, plan);
      const reusableCache = existing || sharedPointerCache;
      if (reusableCache) {
        result.cached += 1;
        result.bytes += reusableCache.blob.size;
        completed += 1;
        onProgress?.({ completed, total: candidates.length, floorPlanId: plan.id, status: 'cached' });
        continue;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        result.failed += 1;
        completed += 1;
        onProgress?.({ completed, total: candidates.length, floorPlanId: plan.id, status: 'failed' });
        continue;
      }
      const downloaded = await downloadFloorPlanBlobFromCloud(projectId, plan);
      if (!downloaded || !(await cacheFloorPlanBlob(projectId, plan, revision, downloaded.blob))) {
        result.failed += 1;
        completed += 1;
        onProgress?.({ completed, total: candidates.length, floorPlanId: plan.id, status: 'failed' });
        continue;
      }
      result.downloaded += 1;
      result.bytes += downloaded.blob.size;
      completed += 1;
      onProgress?.({ completed, total: candidates.length, floorPlanId: plan.id, status: 'downloaded' });
    } catch (err) {
      result.failed += 1;
      completed += 1;
      onProgress?.({ completed, total: candidates.length, floorPlanId: plan.id, status: 'failed' });
      console.warn('[Floor Plan Image] offline cache warning:', plan.floorName, err);
    }
  }
  const ineligible = Math.max(0, (plans || []).length - rawCandidates.length);
  const pausedRemainder = Math.max(0, candidates.length - completed);
  result.skipped = ineligible + pausedRemainder;
  return result;
}


export function floorPlanNeedsCloudUpload(plan: FloorPlan): boolean {
  // Pure data + current uploader identity. Authorization remains in the scheduler and
  // sync function. A pending outbox marker keeps work discoverable after a cloud
  // snapshot replaces the in-memory data/blob URL.
  if (!plan?.id) return false;
  const revision = Number(plan.imageRevision || (plan as any).imageOutboxRevision || (isLocalFloorPlanBinaryUrl(plan.imageUrl) ? (plan as any).updatedAt || 0 : 0));
  if (!revision) return false;
  const cloudRevision = Number(plan.imageCloudRevision || 0);
  const cloudReady = cloudRevision >= revision && plan.storageProvider === BINARY_STORAGE_PROVIDER && Boolean(plan.storagePath);
  if (cloudReady) return false;
  if (isLocalFloorPlanBinaryUrl(plan.imageUrl)) return true;

  const userUid = getCurrentRealFirebaseUser()?.uid || '';
  const pendingOwnerUid = String((plan as any).imagePendingByUid || '');
  const pendingRevision = Number((plan as any).imageOutboxRevision || 0);
  return String((plan as any).imageUploadState || '') === 'pending'
    && Boolean(userUid)
    && pendingOwnerUid === userUid
    && pendingRevision >= revision;
}

export async function syncFloorPlanImagesToCloud(projectId: string, floorPlans: FloorPlan[]): Promise<{ uploaded: number; skipped: number; failed: number }> {
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  for (const plan of floorPlans || []) {
    if (!floorPlanNeedsCloudUpload(plan)) {
      skipped++;
      continue;
    }
    try {
      const result = await syncFloorPlanImageToCloud(projectId, plan);
      if (result) uploaded++;
      else skipped++;
    } catch (err) {
      failed++;
      console.warn('[Floor Plan Image] manual sync warning:', plan.floorName, err);
    }
  }
  return { uploaded, skipped, failed };
}


/** Remove binary floor-plan data from the active cloud provider after the business
 * floor record has been deleted. Failures are non-fatal and can be retried later. */
export async function deleteFloorPlanImageFromCloud(projectId: string, plan: FloorPlan): Promise<void> {
  if (!projectId || !plan?.id) return;
  // Firebase-only soft delete: the business floor-plan document is tombstoned by the
  // normal Firestore write path. Binary objects stay in Storage (and legacy Drive)
  // until retention purge after migration verification. Never hard-delete on UI delete.
  console.debug('[Floor Plan Image] soft-delete retains binary for recovery', projectId, plan.id);
}
