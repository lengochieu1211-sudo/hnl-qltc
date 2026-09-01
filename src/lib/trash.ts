import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, getCurrentRealFirebaseUser, onAuthUserChanged } from './firebase';

export type TrashRetentionDays = 3 | 7 | 15 | 30 | 60 | 90;

export interface TrashSettings {
  enabled: boolean;
  retentionDays: TrashRetentionDays;
}

export const DEFAULT_TRASH_SETTINGS: TrashSettings = {
  enabled: true,
  retentionDays: 7,
};

export type TrashCollectionKey =
  | 'materialNorms'
  | 'inventory'
  | 'workVolumes'
  | 'floorPlans'
  | 'defects'
  | 'roomProgressList'
  | 'checklist'
  | 'crewRecords'
  | 'teams';

export interface TrashDeletedItem {
  collection: TrashCollectionKey;
  entityId: string;
  label: string;
  snapshot: any;
}

export interface TrashOperation {
  id: string;
  projectId: string;
  deletedAt: number;
  expiresAt: number;
  retentionDays: number;
  deletedByUid?: string;
  deletedByEmail?: string;
  deletedByName?: string;
  deletedItems: TrashDeletedItem[];
  /** Records changed as a side effect of the delete (for example a Defect detached
   * from a deleted room). They are restored only if they have not been edited since. */
  relatedBefore?: Partial<Record<TrashCollectionKey, any[]>>;
  approxBytes?: number;
}

const collectionLabels: Record<TrashCollectionKey, string> = {
  materialNorms: 'Định mức vật tư',
  inventory: 'Phiếu nhập / xuất kho',
  workVolumes: 'Khối lượng',
  floorPlans: 'Mặt bằng tầng',
  defects: 'Defect',
  roomProgressList: 'Căn / Phòng',
  checklist: 'Checklist',
  crewRecords: 'Quân số / nhật ký',
  teams: 'Đội thi công',
};

export function getTrashCollectionLabel(key: TrashCollectionKey): string {
  return collectionLabels[key] || key;
}

function stripBinaryLike(value: any, keyHint = ''): any {
  if (value === undefined || typeof value === 'function') return undefined;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Never duplicate image/blob payloads into trash. Cloud identifiers/normal URLs stay.
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return undefined;
    if (/base64/i.test(keyHint) && trimmed.length > 512) return undefined;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripBinaryLike(item, keyHint)).filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, child] of Object.entries(value)) {
      const cleaned = stripBinaryLike(child, key);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return undefined;
}

export function sanitizeTrashSnapshot<T>(value: T): T {
  return stripBinaryLike(value) as T;
}

export function estimateTrashBytes(operation: Omit<TrashOperation, 'approxBytes'> | TrashOperation): number {
  try {
    return new Blob([JSON.stringify(operation)]).size;
  } catch (_) {
    try { return JSON.stringify(operation).length * 2; } catch (_) { return 0; }
  }
}

export function normalizeTrashSettings(input: any): TrashSettings {
  const allowed: TrashRetentionDays[] = [3, 7, 15, 30, 60, 90];
  const retention = Number(input?.retentionDays);
  return {
    enabled: input?.enabled !== false,
    retentionDays: (allowed.includes(retention as TrashRetentionDays) ? retention : 7) as TrashRetentionDays,
  };
}

export async function saveTrashOperationToCloud(operation: TrashOperation): Promise<void> {
  if (!operation.projectId || !operation.id) return;
  const user = getCurrentRealFirebaseUser();
  if (!user) return; // Local trash remains available while offline/not signed in.
  const sanitized = sanitizeTrashSnapshot(operation);
  await setDoc(doc(db, 'projects', operation.projectId, 'trash', operation.id), sanitized, { merge: false });
}

export async function deleteTrashOperationFromCloud(projectId: string, operationId: string): Promise<void> {
  if (!projectId || !operationId) return;
  const user = getCurrentRealFirebaseUser();
  if (!user) return;
  await deleteDoc(doc(db, 'projects', projectId, 'trash', operationId));
}

export function subscribeProjectTrash(projectId: string, onUpdate: (items: TrashOperation[]) => void): () => void {
  if (!projectId) return () => {};
  let disposed = false;
  let snapshotUnsub: (() => void) | null = null;

  const attach = () => {
    snapshotUnsub?.();
    snapshotUnsub = null;
    if (disposed || !getCurrentRealFirebaseUser()) return;
    snapshotUnsub = onSnapshot(collection(db, 'projects', projectId, 'trash'), (snap) => {
      const rows: TrashOperation[] = [];
      snap.forEach((entry) => {
        const raw = entry.data() as TrashOperation;
        if (!raw || !raw.id) return;
        rows.push({ ...raw, id: entry.id, projectId });
      });
      rows.sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0));
      if (!disposed) onUpdate(rows);
    }, (err) => console.warn('Trash realtime subscription warning:', err));
  };

  attach();
  const authUnsub = onAuthUserChanged(() => attach());
  return () => {
    disposed = true;
    snapshotUnsub?.();
    authUnsub();
  };
}
