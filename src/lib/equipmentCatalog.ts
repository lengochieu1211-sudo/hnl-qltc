import { collection, doc, getDocsFromServer, onSnapshot, runTransaction, type Unsubscribe } from 'firebase/firestore';
import { db, getCurrentRealFirebaseUser } from './firebase';
import { normalizeMaterialNameKey } from '../utils/inventoryUtils';
import { normalizeUnit } from '../utils/unitUtils';

/** A master-data description only. Warehouse inventory is still calculated from vouchers. */
export interface EquipmentCatalogRecord {
  id: string;
  projectId: string;
  name: string;
  /** Editable user-facing label; immutable name remains the warehouse identity. */
  displayName?: string;
  unit: string;
  category: string;
  brand: string;
  model: string;
  specifications: string;
  notes: string;
  /** Optional Cloud-synchronized display rank; no relation to inventory identity. */
  order?: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
  /** Soft deletion preserves the Firestore identity and prevents accidental data loss. */
  deletedAt?: number | null;
  deletedByUid?: string | null;
}

export type EquipmentCatalogInput = Pick<EquipmentCatalogRecord,
  'name' | 'unit' | 'category' | 'brand' | 'model' | 'specifications' | 'notes' | 'displayName'>
  & { id?: string; revision?: number };

const clean = (v: unknown, max = 500) => String(v ?? '').trim().slice(0, max);
export const equipmentIdentityKey = (name: string) => normalizeMaterialNameKey(name);

/** Typed Cloud guard so the editor can offer to save metadata WITHOUT touching the unit. */
export class EquipmentUnitMigrationRequiredError extends Error {
  constructor(public readonly storedUnit: string) {
    super('Thiết bị có lịch sử kho: phải đổi ĐVT qua quy trình đồng bộ 1:1.');
    this.name = 'EquipmentUnitMigrationRequiredError';
  }
}


// Stable deterministic document ID means competing device creations for the
// same equipment NAME contend on one document instead of silently duplicating it.
export function equipmentCatalogId(name: string): string {
  const key = equipmentIdentityKey(name);
  if (!key || key.length > 180) throw new Error('Tên thiết bị phải có từ 1 đến 180 ký tự.');
  // Code-point hex is collision-free (unlike a short noncryptographic hash).
  return 'EQ-' + Array.from(key).map(ch => ch.codePointAt(0)!.toString(16).padStart(6, '0')).join('');
}

export function subscribeEquipmentCatalog(
  projectId: string,
  onData: (items: EquipmentCatalogRecord[]) => void,
  onError: (error: Error) => void,
  options: { includeDeleted?: boolean } = {},
): Unsubscribe {
  if (!projectId) { onData([]); return () => {}; }
  return onSnapshot(collection(db, 'projects', projectId, 'equipment_catalog'), (snapshot) => {
    const entries = snapshot.docs.map((snapshotDoc) =>
      ({ ...snapshotDoc.data(), id: snapshotDoc.id }) as EquipmentCatalogRecord
    ).filter(item => Boolean(item.name && item.unit) && (options.includeDeleted || item.deletedAt == null));
    onData(entries.sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true })));
  }, (error) => onError(error));
}

/** ADMIN-only transaction; no voucher, balance or historical ID changes. */
export async function saveEquipmentCatalogBatch(projectId: string, entries: EquipmentCatalogInput[]): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Chỉnh danh mục thiết bị cần có mạng.');
  if (!getCurrentRealFirebaseUser()) throw new Error('Vui lòng đăng nhập Firebase.');
  if (!projectId) throw new Error('Chưa chọn dự án.');
  if (!entries.length) return;
  if (entries.length > 50) throw new Error('Mỗi lần chỉ lưu tối đa 50 thiết bị.');

  const payload = entries.map(entry => {
    const name = clean(entry.name, 180);
    const unit = normalizeUnit(clean(entry.unit, 60)) || clean(entry.unit, 60);
    if (!name || !unit) throw new Error('Tên và ĐVT thiết bị không được trống.');
    const displayName = clean(entry.displayName || name, 180);
    if (!displayName) throw new Error('Tên hiển thị thiết bị không được để trống.');
    const id = equipmentCatalogId(name);
    if (entry.id && entry.id !== id) throw new Error('Không được sửa mã hoặc tên thiết bị cũ qua bảng. Tạo thiết bị mới nếu là mặt hàng khác.');
    return {
      id, projectId, name, displayName, unit,
      category: clean(entry.category, 120) || 'Thiết bị',
      brand: clean(entry.brand, 120),
      model: clean(entry.model, 120),
      specifications: clean(entry.specifications, 1200),
      notes: clean(entry.notes, 1200),
      expectedRevision: entry.revision,
    };
  });
  if (new Set(payload.map(p => p.id)).size !== payload.length) throw new Error('Danh sách có tên thiết bị trùng nhau.');
  // Historical equipment had no independent catalog. Verify its canonical unit
  // from the server before creating metadata, including restorable deleted rows.
  // A client-only inventory cache can be stale or incomplete across devices.
  const [ledger, balanceSnapshot] = await Promise.all([
    getDocsFromServer(collection(db, 'projects', projectId, 'inventory')),
    getDocsFromServer(collection(db, 'projects', projectId, 'inventory_balances')),
  ]);
  const historicalNames = new Set<string>();
  const historicalUnits = new Map<string, Set<string>>();
  const trackUnit = (name: string, unit: string) => {
    const key = equipmentIdentityKey(name);
    if (!key) return;
    historicalNames.add(key);
    const set = historicalUnits.get(key) || new Set<string>();
    set.add(normalizeUnit(unit) || unit);
    historicalUnits.set(key, set);
  };
  balanceSnapshot.docs.forEach(row => {
    const balance = row.data();
    if (balance.itemKind === 'equipment') trackUnit(String(balance.materialName || ''), String(balance.unit || ''));
  });
  for (const record of ledger.docs) {
    const voucher = record.data();
    if (voucher.itemKind !== 'equipment') continue;
    trackUnit(String(voucher.materialName || ''), String(voucher.unit || ''));
  }
  // Preflight display-label duplicates with server-authoritative catalog data.
  // Names used by vouchers remain immutable, so a changed displayName can never
  // silently merge or redirect an inventory identity.
  const catalogSnapshot = await getDocsFromServer(collection(db, 'projects', projectId, 'equipment_catalog'));
  const usedLabels = new Map<string, string>();
  catalogSnapshot.docs.forEach(row => {
    const value = row.data() as EquipmentCatalogRecord;
    if (value.deletedAt != null) return;
    for (const label of [value.name, value.displayName || value.name]) {
      const key = equipmentIdentityKey(label);
      if (!usedLabels.has(key)) usedLabels.set(key, row.id);
    }
  });
  const stagedLabels = new Map<string, string>();
  for (const next of payload) {
    for (const label of [next.name, next.displayName]) {
      const labelKey = equipmentIdentityKey(label);
      const otherDraft = stagedLabels.get(labelKey);
      if (otherDraft && otherDraft !== next.id) throw new Error(`Tên thiết bị “${label}” trùng với thiết bị khác trong lần lưu này.`);
      stagedLabels.set(labelKey, next.id);
      if (historicalNames.has(labelKey) && labelKey !== equipmentIdentityKey(next.name)) {
        throw new Error(`Tên hiển thị “${label}” trùng với tên thiết bị trên phiếu kho khác. Hãy chọn tên khác.`);
      }
      const holder = usedLabels.get(equipmentIdentityKey(label));
      if (holder && holder !== next.id) {
        throw new Error(`Tên thiết bị “${label}” đã được sử dụng. Hãy chọn tên khác để tránh nhầm phiếu kho.`);
      }
    }
  }
  for (const next of payload) {
    const key = equipmentIdentityKey(next.name);
    const units = historicalUnits.get(key);
    // Existing catalog record may have old inconsistent vouchers: editing its
    // notes/brand/displayName MUST NOT be blocked by that unrelated mismatch.
    const existsOnServer = catalogSnapshot.docs.some(row => row.id === next.id && row.data().deletedAt == null);
    if (!existsOnServer && units && !units.has(next.unit)) {
      throw new Error(`Thiết bị “${next.name}” có lịch sử kho với ĐVT ${[...units].join(', ')}. Hãy chọn đúng một ĐVT đang có trên phiếu trước khi bổ sung thông tin, không tự quy đổi số lượng.`);
    }
    // Old vouchers may legitimately contain multiple different unit keys for
    // one legacy equipment name. Recording metadata against one EXISTING unit
    // does not merge those warehouse keys or rewrite historical quantities.
    // Subsequent unit migration remains forbidden until the ledger is audited.
  }
  await runTransaction(db, async tx => {
    const refs = payload.map(p => doc(db, 'projects', projectId, 'equipment_catalog', p.id));
    const snaps = [];
    for (const ref of refs) snaps.push(await tx.get(ref));
    const timestamp = Date.now();
    snaps.forEach((snapshot, index) => {
      const next = payload[index];
      const existing = snapshot.exists() ? snapshot.data() as EquipmentCatalogRecord : null;
      if (existing) {
        if (existing.deletedAt != null) throw new Error('Thiết bị đã ở thùng rác. Hãy khôi phục trước khi sửa hoặc thêm lại.');
        if (next.expectedRevision === undefined || existing.revision !== next.expectedRevision) {
          throw new Error('Danh mục thiết bị đã thay đổi trên thiết bị khác. Hãy tải lại trước khi lưu.');
        }
        if (equipmentIdentityKey(existing.name) !== equipmentIdentityKey(next.name)) {
          throw new Error('Không được đổi tên hoặc mã thiết bị đã có.');
        }
        if ((normalizeUnit(existing.unit) || existing.unit) !== next.unit && historicalNames.has(equipmentIdentityKey(next.name))) {
          throw new EquipmentUnitMigrationRequiredError(existing.unit);
        }
      } else if (next.expectedRevision !== undefined) {
        throw new Error('Thiết bị không còn trong danh mục Cloud. Hãy tải lại.');
      }
      const { expectedRevision: _ignored, ...data } = next;
      if (existing) {
        // Update just metadata fields. Never drop soft-delete / order / immutable
        // identity fields of a previously created catalog row.
        const { id: _id, projectId: _pid, name: _name, ...metadata } = data;
        tx.update(refs[index], {
          ...metadata,
          revision: existing.revision + 1,
          updatedAt: Math.max(timestamp, existing.updatedAt + 1),
        });
      } else {
        tx.set(refs[index], {
          ...data,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    });
  }, { maxAttempts: 3 });
}


/** Admin-only soft delete: a voucher of any age (including restorable trash) blocks deletion. */
export async function softDeleteEquipmentCatalogBatch(
  projectId: string, targets: Pick<EquipmentCatalogRecord, 'id' | 'name' | 'revision'>[],
): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Xóa thiết bị cần có mạng.');
  const user = getCurrentRealFirebaseUser();
  if (!user) throw new Error('Vui lòng đăng nhập Firebase.');
  if (!projectId) throw new Error('Chưa chọn dự án.');
  if (!targets.length) return;
  if (targets.length > 50) throw new Error('Chỉ xóa tối đa 50 thiết bị mỗi lần.');
  if (new Set(targets.map(item => item.id)).size !== targets.length) throw new Error('Danh sách thiết bị trùng mã.');
  for (const item of targets) {
    if (equipmentCatalogId(item.name) !== item.id) throw new Error('Mã thiết bị không khớp tên. Hủy xóa.');
  }

  // Never remove an equipment identity that can still be referenced by an
  // inventory voucher, even a voucher presently in the trash.
  const [ledger, balances] = await Promise.all([
    getDocsFromServer(collection(db, 'projects', projectId, 'inventory')),
    getDocsFromServer(collection(db, 'projects', projectId, 'inventory_balances')),
  ]);
  const occupied = new Set(ledger.docs.filter(row => row.data().itemKind === 'equipment')
    .map(row => equipmentIdentityKey(String(row.data().materialName || ''))));
  // Even a stale/renamed balance tombstone is an identity dependency.
  balances.docs.forEach(row => {
    const balance = row.data();
    if (balance.itemKind === 'equipment') occupied.add(equipmentIdentityKey(String(balance.materialName || '')));
  });
  const referenced = targets.filter(item => occupied.has(equipmentIdentityKey(item.name)));
  if (referenced.length) {
    throw new Error('Không thể xóa thiết bị đã có lịch sử nhập/xuất (kể cả phiếu trong thùng rác): '
      + referenced.map(item => item.name).join(', ') + '. Hãy giữ danh mục để không mất liên kết dữ liệu.');
  }

  await runTransaction(db, async tx => {
    const refs = targets.map(item => doc(db, 'projects', projectId, 'equipment_catalog', item.id));
    const snaps = [];
    for (const ref of refs) snaps.push(await tx.get(ref));
    targets.forEach((item, index) => {
      const snap = snaps[index];
      if (!snap.exists()) throw new Error('Thiết bị không còn trên Cloud. Hãy tải lại.');
      const current = snap.data() as EquipmentCatalogRecord;
      if (equipmentIdentityKey(current.name) !== equipmentIdentityKey(item.name)
        || current.revision !== item.revision || current.deletedAt != null) {
        throw new Error('Thiết bị đã thay đổi trên thiết bị khác. Hãy tải lại trước khi xóa.');
      }
    });
    const now = Date.now();
    targets.forEach((item, index) => {
      const current = snaps[index].data() as EquipmentCatalogRecord;
      tx.update(refs[index], {
        deletedAt: now, deletedByUid: user.uid,
        revision: current.revision + 1,
        updatedAt: Math.max(now, current.updatedAt + 1),
      });
    });
  }, { maxAttempts: 3 });
}

/** Restore exactly the same catalog ID; no voucher/balance/quantity mutation. */
export async function restoreEquipmentCatalog(
  projectId: string, item: Pick<EquipmentCatalogRecord, 'id' | 'name' | 'unit' | 'revision'>,
): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Khôi phục thiết bị cần có mạng.');
  const user = getCurrentRealFirebaseUser();
  if (!user) throw new Error('Vui lòng đăng nhập Firebase.');
  if (!projectId || equipmentCatalogId(item.name) !== item.id) throw new Error('Thiếu dữ liệu khôi phục thiết bị.');
  const ledger = await getDocsFromServer(collection(db, 'projects', projectId, 'inventory'));
  for (const voucherDoc of ledger.docs) {
    const voucher = voucherDoc.data();
    if (voucher.itemKind !== 'equipment'
      || equipmentIdentityKey(String(voucher.materialName || '')) !== equipmentIdentityKey(item.name)) continue;
    if ((normalizeUnit(String(voucher.unit || '')) || voucher.unit) !== (normalizeUnit(item.unit) || item.unit)) {
      throw new Error('ĐVT thiết bị trong lịch sử kho đã thay đổi; không thể khôi phục khi chưa đối chiếu.');
    }
  }
  const ref = doc(db, 'projects', projectId, 'equipment_catalog', item.id);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Không tìm thấy thiết bị trong thùng rác Cloud.');
    const current = snap.data() as EquipmentCatalogRecord;
    if (current.deletedAt == null || current.revision !== item.revision
      || equipmentIdentityKey(current.name) !== equipmentIdentityKey(item.name)) {
      throw new Error('Thiết bị đã được thay đổi hoặc khôi phục ở thiết bị khác; hãy tải lại.');
    }
    const now = Date.now();
    tx.update(ref, {
      deletedAt: null, deletedByUid: null,
      revision: current.revision + 1,
      updatedAt: Math.max(now, current.updatedAt + 1),
    });
  }, { maxAttempts: 3 });
}


/**
 * ADMIN-only atomic ordering of existing ACTIVE equipment master records.
 * Never updates voucher, stock, display name, stable ID or business quantities.
 * The revisions are verified inside the transaction, so a concurrent editor
 * cannot silently overwrite another account's metadata/ordering.
 */
export async function reorderEquipmentCatalog(
  projectId: string,
  current: Pick<EquipmentCatalogRecord, 'id' | 'revision'>[],
  orderedIds: string[],
): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Sắp xếp thiết bị cần có mạng.');
  }
  if (!getCurrentRealFirebaseUser()) throw new Error('Vui lòng đăng nhập Firebase.');
  if (!projectId) throw new Error('Chưa chọn dự án.');
  if (current.length < 2 || current.length > 100) {
    throw new Error('Chỉ sắp xếp đồng bộ tối đa 100 thiết bị trong một lần để bảo đảm ghi nguyên tử.');
  }
  const revisions = new Map(current.map(item => [item.id, item.revision] as const));
  if (new Set(current.map(item => item.id)).size !== current.length
    || new Set(orderedIds).size !== orderedIds.length
    || orderedIds.length !== current.length
    || orderedIds.some(id => !revisions.has(id))) {
    throw new Error('Danh sách thiết bị thay đổi; vui lòng tải lại trước khi sắp xếp.');
  }

  await runTransaction(db, async tx => {
    const refs = orderedIds.map(id => doc(db, 'projects', projectId, 'equipment_catalog', id));
    const snaps = await Promise.all(refs.map(ref => tx.get(ref)));
    snaps.forEach((snapshot, index) => {
      if (!snapshot.exists()) throw new Error('Thiết bị không còn trên Cloud. Hãy tải lại.');
      const record = snapshot.data() as EquipmentCatalogRecord;
      if (record.deletedAt != null || record.revision !== revisions.get(orderedIds[index])) {
        throw new Error('Danh mục thiết bị đã thay đổi trên máy khác. Hãy tải lại trước khi sắp xếp.');
      }
    });
    const now = Date.now();
    snaps.forEach((snapshot, index) => {
      const record = snapshot.data() as EquipmentCatalogRecord;
      const order = index + 1;
      if (record.order === order) return;
      tx.update(refs[index], {
        order,
        revision: record.revision + 1,
        updatedAt: Math.max(now, record.updatedAt + 1),
      });
    });
  }, { maxAttempts: 3 });
}
