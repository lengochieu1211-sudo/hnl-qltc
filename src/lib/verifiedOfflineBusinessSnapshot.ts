import { getAsyncItem, removeAsyncItem, setAsyncItem } from '../utils/asyncStorage';
import { VERIFIED_PROJECT_ROLE_MAX_AGE_MS } from '../utils/offlineAccess';

export interface VerifiedOfflineBusinessSnapshot {
  version: 1;
  projectId: string;
  uid: string;
  email: string;
  capturedAt: number;
  sourceUpdatedAt: number;
  metadata: {
    projectName: string;
    contractorName: string;
    inspectorName: string;
  };
  data: Record<string, any[]>;
  recordCount: number;
}

const SNAPSHOT_PREFIX = 'hnl_verified_offline_business_v1:';

const normalizeEmail = (value?: string | null): string => String(value || '').trim().toLowerCase();

const safeEncode = (value: string): string => {
  try { return encodeURIComponent(value); } catch (_) { return value.replace(/[^A-Za-z0-9_.-]/g, '_'); }
};

const snapshotKey = (
  projectId: string,
  identity: { uid?: string | null; email?: string | null },
): string => {
  const uid = String(identity.uid || '').trim();
  const email = normalizeEmail(identity.email);
  return `${SNAPSHOT_PREFIX}${safeEncode(uid)}__${safeEncode(email)}__${safeEncode(String(projectId || '').trim())}`;
};

const normalizeData = (data: Record<string, any[]> | null | undefined): Record<string, any[]> => {
  const result: Record<string, any[]> = {};
  for (const [key, value] of Object.entries(data || {})) {
    result[key] = Array.isArray(value) ? value : [];
  }
  return result;
};

/**
 * Device-local, identity-bound last-known-good business snapshot.
 *
 * This is a read-only cold-start safety net when Firestore persistent IndexedDB is
 * unavailable/empty after the EXE restarts offline. It is written only from a verified
 * Cloud baseline and is never treated as Cloud authority or auto-uploaded.
 */
export async function saveVerifiedOfflineBusinessSnapshot(
  projectId: string,
  identity: { uid?: string | null; email?: string | null },
  metadata: { projectName?: string; contractorName?: string; inspectorName?: string },
  data: Record<string, any[]>,
  sourceUpdatedAt = 0,
): Promise<VerifiedOfflineBusinessSnapshot | null> {
  const normalizedProjectId = String(projectId || '').trim();
  const uid = String(identity.uid || '').trim();
  const email = normalizeEmail(identity.email);
  if (!normalizedProjectId || !uid || !email) return null;

  const normalizedData = normalizeData(data);
  const recordCount = Object.values(normalizedData).reduce((sum, list) => sum + list.length, 0);
  const record: VerifiedOfflineBusinessSnapshot = {
    version: 1,
    projectId: normalizedProjectId,
    uid,
    email,
    capturedAt: Date.now(),
    sourceUpdatedAt: Number(sourceUpdatedAt || 0),
    metadata: {
      projectName: String(metadata.projectName || ''),
      contractorName: String(metadata.contractorName || ''),
      inspectorName: String(metadata.inspectorName || ''),
    },
    data: normalizedData,
    recordCount,
  };

  await setAsyncItem(snapshotKey(normalizedProjectId, { uid, email }), record);
  return record;
}

export async function loadVerifiedOfflineBusinessSnapshot(
  projectId: string,
  identity: { uid?: string | null; email?: string | null },
): Promise<VerifiedOfflineBusinessSnapshot | null> {
  const normalizedProjectId = String(projectId || '').trim();
  const uid = String(identity.uid || '').trim();
  const email = normalizeEmail(identity.email);
  if (!normalizedProjectId || !uid || !email) return null;

  const key = snapshotKey(normalizedProjectId, { uid, email });
  const record = await getAsyncItem<VerifiedOfflineBusinessSnapshot | null>(key, null);
  if (!record || record.version !== 1) return null;
  if (record.projectId !== normalizedProjectId || record.uid !== uid || normalizeEmail(record.email) !== email) return null;

  const capturedAt = Number(record.capturedAt || 0);
  if (!Number.isFinite(capturedAt) || capturedAt <= 0 || Date.now() - capturedAt > VERIFIED_PROJECT_ROLE_MAX_AGE_MS) {
    await removeAsyncItem(key).catch(() => {});
    return null;
  }

  const data = normalizeData(record.data);
  return {
    ...record,
    capturedAt,
    sourceUpdatedAt: Number(record.sourceUpdatedAt || 0),
    data,
    recordCount: Object.values(data).reduce((sum, list) => sum + list.length, 0),
  };
}
