import type { FloorPlan } from '../types';
import { fetchProjectFromCloud, getCurrentRealFirebaseUser } from './firebase';
import { cacheFloorPlansForOffline, getFloorPlanImageCacheSnapshot } from './floorPlanImageSync';
import { downloadPhotoBlobFromCloud, refreshProjectPhotoMetadataFromCloud } from './photoCloudSync';
import { getPhotoBlob, getProjectPhotos } from '../utils/photoStorage';
import { setProjectOfflineMirrorLastSyncAt } from './offlineMirrorSettings';

export type ProjectOfflineMirrorPhase = 'business-data' | 'photos' | 'floor-plans' | 'complete';

export interface ProjectOfflineMirrorProgress {
  phase: ProjectOfflineMirrorPhase;
  completed: number;
  total: number;
  message: string;
}

export interface ProjectOfflineMirrorSnapshot {
  projectId: string;
  photoTotal: number;
  photoReady: number;
  photoBytes: number;
  floorPlanTotal: number;
  floorPlanReady: number;
  floorPlanBytes: number;
  lastSyncAt: number;
}

export interface ProjectOfflineMirrorResult extends ProjectOfflineMirrorSnapshot {
  businessDataReady: boolean;
  photoCached: number;
  photoDownloaded: number;
  photoFailed: number;
  floorPlanCached: number;
  floorPlanDownloaded: number;
  floorPlanFailed: number;
}

const PHOTO_DOWNLOAD_CONCURRENCY = 3;

async function mapWithConcurrency<T>(
  rows: T[],
  concurrency: number,
  worker: (row: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, rows.length)) }, async () => {
    while (true) {
      const index = next++;
      if (index >= rows.length) return;
      await worker(rows[index], index);
    }
  });
  await Promise.all(runners);
}

export async function inspectProjectOfflineMirror(projectId: string, floorPlans: FloorPlan[]): Promise<ProjectOfflineMirrorSnapshot> {
  if (!projectId) return { projectId: '', photoTotal: 0, photoReady: 0, photoBytes: 0, floorPlanTotal: 0, floorPlanReady: 0, floorPlanBytes: 0, lastSyncAt: 0 };

  const photos = (await getProjectPhotos(projectId, false)).filter((photo) => !photo.deleted && !photo.deletedAt);
  let photoReady = 0;
  let photoBytes = 0;
  for (const photo of photos) {
    const blob = await getPhotoBlob(photo.id, false).catch(() => null);
    if (blob && blob.size > 0) {
      photoReady += 1;
      photoBytes += blob.size;
    }
  }

  const floorRows = await getFloorPlanImageCacheSnapshot(projectId).catch(() => []);
  const cacheByFloor = new Map<string, any>();
  const cacheByStoragePath = new Map<string, any>();
  for (const row of floorRows) {
    const floorId = String(row?.floorPlanId || '');
    if (floorId) {
      const previous = cacheByFloor.get(floorId);
      if (!previous || Number(row?.revision || 0) > Number(previous?.revision || 0)) cacheByFloor.set(floorId, row);
    }
    const storagePath = String(row?.storagePath || '').trim();
    if (storagePath && !cacheByStoragePath.has(storagePath)) cacheByStoragePath.set(storagePath, row);
  }

  const eligibleFloorPlans = (floorPlans || []).filter((plan) => {
    const revision = Number(plan?.imageCloudRevision || plan?.imageRevision || 0);
    const hasPointer = Boolean(plan?.storagePath || plan?.driveFileId || plan?.cloudFileId || plan?.storageProvider);
    return Boolean(plan?.id) && revision > 0 && hasPointer;
  });
  let floorPlanReady = 0;
  const uniqueFloorCache = new Map<string, number>();
  for (const plan of eligibleFloorPlans) {
    const storagePath = String(plan.storagePath || '').trim();
    const exact = cacheByFloor.get(String(plan.id || ''));
    const shared = storagePath ? cacheByStoragePath.get(storagePath) : null;
    const cached = exact || shared;
    if (!cached || Number(cached?.bytes || 0) <= 0) continue;
    const revision = Number(plan.imageCloudRevision || plan.imageRevision || 0);
    if (shared || Number(cached?.revision || 0) >= revision) floorPlanReady += 1;
    const key = String(cached?.storagePath || '').trim() || `${cached?.floorPlanId || plan.id}:${cached?.revision || revision}`;
    if (key && !uniqueFloorCache.has(key)) uniqueFloorCache.set(key, Number(cached?.bytes || 0));
  }

  return {
    projectId,
    photoTotal: photos.length,
    photoReady,
    photoBytes,
    floorPlanTotal: eligibleFloorPlans.length,
    floorPlanReady,
    floorPlanBytes: Array.from(uniqueFloorCache.values()).reduce((sum, value) => sum + value, 0),
    lastSyncAt: 0,
  };
}

export async function prepareProjectOfflineMirror(
  projectId: string,
  floorPlans: FloorPlan[],
  onProgress?: (progress: ProjectOfflineMirrorProgress) => void,
): Promise<ProjectOfflineMirrorResult> {
  if (!projectId) throw new Error('Chưa chọn dự án.');
  const user = getCurrentRealFirebaseUser();
  if (!user || user.isAnonymous) throw new Error('Cần đăng nhập Firebase trước khi tải dữ liệu offline.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Cần có mạng để tải/cập nhật dữ liệu offline.');
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    await navigator.storage.persist().catch(() => false);
  }

  onProgress?.({ phase: 'business-data', completed: 0, total: 1, message: 'Đang cập nhật dữ liệu dự án từ Cloud…' });
  const cloudProject = await fetchProjectFromCloud(projectId, { serverOnly: true });
  if (!cloudProject) throw new Error('Không tải được dữ liệu dự án từ Cloud hoặc tài khoản không còn quyền truy cập.');
  onProgress?.({ phase: 'business-data', completed: 1, total: 1, message: 'Dữ liệu dự án đã có trong Firestore offline cache.' });

  const photoMeta = await refreshProjectPhotoMetadataFromCloud(projectId);
  if (!photoMeta.verified) throw new Error('Không xác minh được metadata ảnh từ Cloud; dừng để tránh báo offline-ready sai.');
  const photos = (await getProjectPhotos(projectId, false)).filter((photo) => !photo.deleted && !photo.deletedAt);
  let photoCached = 0;
  let photoDownloaded = 0;
  let photoFailed = 0;
  let photoBytes = 0;
  let photoCompleted = 0;

  onProgress?.({ phase: 'photos', completed: 0, total: photos.length, message: photos.length ? `Đang chuẩn bị ${photos.length} ảnh dùng offline…` : 'Dự án không có ảnh cần tải.' });
  await mapWithConcurrency(photos, PHOTO_DOWNLOAD_CONCURRENCY, async (photo) => {
    try {
      let blob = await getPhotoBlob(photo.id, false).catch(() => null);
      if (blob && blob.size > 0) {
        photoCached += 1;
      } else {
        blob = await downloadPhotoBlobFromCloud(projectId, photo.id, photo.mimeType || 'image/jpeg');
        if (blob && blob.size > 0) photoDownloaded += 1;
        else photoFailed += 1;
      }
      if (blob && blob.size > 0) photoBytes += blob.size;
    } catch (_) {
      photoFailed += 1;
    } finally {
      photoCompleted += 1;
      onProgress?.({ phase: 'photos', completed: photoCompleted, total: photos.length, message: `Ảnh offline ${photoCompleted}/${photos.length}` });
    }
  });

  onProgress?.({ phase: 'floor-plans', completed: 0, total: floorPlans.length, message: 'Đang chuẩn bị mặt bằng dùng offline…' });
  const floorResult = await cacheFloorPlansForOffline(projectId, floorPlans, (progress) => {
    onProgress?.({ phase: 'floor-plans', completed: progress.completed, total: progress.total, message: `Mặt bằng offline ${progress.completed}/${progress.total}` });
  });

  const completedAt = Date.now();
  if (photoFailed === 0 && floorResult.failed === 0) setProjectOfflineMirrorLastSyncAt(projectId, completedAt);
  const snapshot = await inspectProjectOfflineMirror(projectId, floorPlans);
  const result: ProjectOfflineMirrorResult = {
    ...snapshot,
    lastSyncAt: completedAt,
    businessDataReady: true,
    photoCached,
    photoDownloaded,
    photoFailed,
    floorPlanCached: floorResult.cached,
    floorPlanDownloaded: floorResult.downloaded,
    floorPlanFailed: floorResult.failed,
  };

  onProgress?.({
    phase: 'complete',
    completed: snapshot.photoReady + snapshot.floorPlanReady,
    total: snapshot.photoTotal + snapshot.floorPlanTotal,
    message: photoFailed || floorResult.failed
      ? `Offline đã cập nhật; còn ${photoFailed + floorResult.failed} mục chưa tải được.`
      : 'Dự án đã sẵn sàng dùng offline trên thiết bị này.',
  });
  return result;
}
