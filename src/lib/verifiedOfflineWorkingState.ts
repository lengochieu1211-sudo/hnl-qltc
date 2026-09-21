import { getAsyncItem, removeAsyncItem, setAsyncItem } from '../utils/asyncStorage';
import { VERIFIED_PROJECT_ROLE_MAX_AGE_MS } from '../utils/offlineAccess';

export interface VerifiedOfflineWorkingDelta {
  version: 1;
  projectId: string;
  uid: string;
  email: string;
  baseCapturedAt: number;
  savedAt: number;
  metadata: {
    projectName: string;
    contractorName: string;
    inspectorName: string;
  };
  metadataChanged: boolean;
  upserts: Record<string, any[]>;
  deletions: Record<string, Array<{ id: string; deletedAt: number; revision: number }>>;
  tombstones: Record<string, number>;
  changeCount: number;
}

const WORKING_PREFIX = 'hnl_verified_offline_working_v1:';

const normalizeEmail = (value?: string | null): string => String(value || '').trim().toLowerCase();

const safeEncode = (value: string): string => {
  try { return encodeURIComponent(value); } catch (_) { return value.replace(/[^A-Za-z0-9_.-]/g, '_'); }
};

const workingKey = (
  projectId: string,
  identity: { uid?: string | null; email?: string | null },
): string => {
  const uid = String(identity.uid || '').trim();
  const email = normalizeEmail(identity.email);
  return `${WORKING_PREFIX}${safeEncode(uid)}__${safeEncode(email)}__${safeEncode(String(projectId || '').trim())}`;
};

const recordChanged = (before: any, after: any): boolean => {
  if (!before) return true;
  const beforeRevision = Number(before?.revision || 0);
  const afterRevision = Number(after?.revision || 0);
  const beforeUpdatedAt = Number(before?.updatedAt || 0);
  const afterUpdatedAt = Number(after?.updatedAt || 0);
  if (beforeRevision !== afterRevision || beforeUpdatedAt !== afterUpdatedAt) return true;
  if (before === after) return false;
  try { return JSON.stringify(before) !== JSON.stringify(after); } catch (_) { return true; }
};

export function buildVerifiedOfflineWorkingDelta(
  projectId: string,
  identity: { uid?: string | null; email?: string | null },
  baseCapturedAt: number,
  baseData: Record<string, any[]>,
  currentData: Record<string, any[]>,
  baseMetadata: { projectName?: string; contractorName?: string; inspectorName?: string },
  currentMetadata: { projectName?: string; contractorName?: string; inspectorName?: string },
  tombstones: Record<string, number> = {},
): VerifiedOfflineWorkingDelta | null {
  const normalizedProjectId = String(projectId || '').trim();
  const uid = String(identity.uid || '').trim();
  const email = normalizeEmail(identity.email);
  const capturedAt = Number(baseCapturedAt || 0);
  if (!normalizedProjectId || !uid || !email || !Number.isFinite(capturedAt) || capturedAt <= 0) return null;

  const upserts: Record<string, any[]> = {};
  const deletions: Record<string, Array<{ id: string; deletedAt: number; revision: number }>> = {};
  let changeCount = 0;
  const keys = new Set([...Object.keys(baseData || {}), ...Object.keys(currentData || {})]);

  for (const key of keys) {
    const baseList = Array.isArray(baseData?.[key]) ? baseData[key] : [];
    const currentList = Array.isArray(currentData?.[key]) ? currentData[key] : [];
    const baseById = new Map<string, any>();
    const currentById = new Map<string, any>();
    baseList.forEach((item) => { if (item?.id) baseById.set(String(item.id), item); });
    currentList.forEach((item) => { if (item?.id) currentById.set(String(item.id), item); });

    const changedRows: any[] = [];
    for (const [id, item] of currentById.entries()) {
      const before = baseById.get(id);
      if (!before || recordChanged(before, item)) changedRows.push(item);
    }
    if (changedRows.length > 0) {
      upserts[key] = changedRows;
      changeCount += changedRows.length;
    }

    const removed: Array<{ id: string; deletedAt: number; revision: number }> = [];
    for (const [id, item] of baseById.entries()) {
      if (currentById.has(id)) continue;
      const tombstoneKey = `${key}_${id}`;
      const deletedAt = Math.max(
        Number(tombstones[tombstoneKey] || 0),
        Number(item?.deletedAt || 0),
        Number(item?.updatedAt || 0) + 1,
        1,
      );
      removed.push({
        id,
        deletedAt,
        revision: Math.max(Number(item?.revision || 0) + 1, 1),
      });
    }
    if (removed.length > 0) {
      deletions[key] = removed;
      changeCount += removed.length;
    }
  }

  const metadata = {
    projectName: String(currentMetadata.projectName || ''),
    contractorName: String(currentMetadata.contractorName || ''),
    inspectorName: String(currentMetadata.inspectorName || ''),
  };
  const metadataChanged =
    String(baseMetadata.projectName || '') !== metadata.projectName ||
    String(baseMetadata.contractorName || '') !== metadata.contractorName ||
    String(baseMetadata.inspectorName || '') !== metadata.inspectorName;

  return {
    version: 1,
    projectId: normalizedProjectId,
    uid,
    email,
    baseCapturedAt: capturedAt,
    savedAt: Date.now(),
    metadata,
    metadataChanged,
    upserts,
    deletions,
    tombstones: { ...(tombstones || {}) },
    changeCount: changeCount + (metadataChanged ? 1 : 0),
  };
}

export function applyVerifiedOfflineWorkingDelta(
  baseData: Record<string, any[]>,
  delta: VerifiedOfflineWorkingDelta | null,
): Record<string, any[]> {
  const result: Record<string, any[]> = {};
  const keys = new Set([
    ...Object.keys(baseData || {}),
    ...Object.keys(delta?.upserts || {}),
    ...Object.keys(delta?.deletions || {}),
  ]);

  for (const key of keys) {
    const byId = new Map<string, any>();
    const baseList = Array.isArray(baseData?.[key]) ? baseData[key] : [];
    baseList.forEach((item) => { if (item?.id) byId.set(String(item.id), item); });

    for (const deleted of delta?.deletions?.[key] || []) {
      if (deleted?.id) byId.delete(String(deleted.id));
    }
    for (const item of delta?.upserts?.[key] || []) {
      if (item?.id) byId.set(String(item.id), item);
    }
    result[key] = Array.from(byId.values());
  }

  return result;
}

export async function saveVerifiedOfflineWorkingDelta(
  delta: VerifiedOfflineWorkingDelta | null,
): Promise<void> {
  if (!delta) return;
  const key = workingKey(delta.projectId, delta);
  if (delta.changeCount <= 0) {
    await removeAsyncItem(key).catch(() => {});
    return;
  }
  await setAsyncItem(key, delta);
}

export async function loadVerifiedOfflineWorkingDelta(
  projectId: string,
  identity: { uid?: string | null; email?: string | null },
  baseCapturedAt: number,
): Promise<VerifiedOfflineWorkingDelta | null> {
  const normalizedProjectId = String(projectId || '').trim();
  const uid = String(identity.uid || '').trim();
  const email = normalizeEmail(identity.email);
  const capturedAt = Number(baseCapturedAt || 0);
  if (!normalizedProjectId || !uid || !email || !capturedAt) return null;

  const key = workingKey(normalizedProjectId, { uid, email });
  const record = await getAsyncItem<VerifiedOfflineWorkingDelta | null>(key, null);
  if (!record || record.version !== 1) return null;
  if (record.projectId !== normalizedProjectId || record.uid !== uid || normalizeEmail(record.email) !== email) return null;
  if (Number(record.baseCapturedAt || 0) !== capturedAt) {
    await removeAsyncItem(key).catch(() => {});
    return null;
  }
  const savedAt = Number(record.savedAt || 0);
  if (!savedAt || Date.now() - savedAt > VERIFIED_PROJECT_ROLE_MAX_AGE_MS) {
    await removeAsyncItem(key).catch(() => {});
    return null;
  }
  return {
    ...record,
    savedAt,
    baseCapturedAt: capturedAt,
    metadataChanged: record.metadataChanged === true,
    upserts: record.upserts || {},
    deletions: record.deletions || {},
    tombstones: record.tombstones || {},
    changeCount: Number(record.changeCount || 0),
  };
}

export async function clearVerifiedOfflineWorkingDelta(
  projectId: string,
  identity: { uid?: string | null; email?: string | null },
): Promise<void> {
  const normalizedProjectId = String(projectId || '').trim();
  const uid = String(identity.uid || '').trim();
  const email = normalizeEmail(identity.email);
  if (!normalizedProjectId || !uid || !email) return;
  await removeAsyncItem(workingKey(normalizedProjectId, { uid, email })).catch(() => {});
}
