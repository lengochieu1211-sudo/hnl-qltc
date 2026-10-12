import { collection, doc, getDocsFromServer, onSnapshot, runTransaction, type Unsubscribe } from 'firebase/firestore';
import { db, getCurrentRealFirebaseUser } from './firebase';
import { normalizeMaterialNameKey } from '../utils/inventoryUtils';
import { normalizeUnit } from '../utils/unitUtils';

/** A master-data description only. Warehouse inventory is still calculated from vouchers. */
export interface EquipmentCatalogRecord {
  id: string;
  projectId: string;
  name: string;
  unit: string;
  category: string;
  brand: string;
  model: string;
  specifications: string;
  notes: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export type EquipmentCatalogInput = Pick<EquipmentCatalogRecord,
  'name' | 'unit' | 'category' | 'brand' | 'model' | 'specifications' | 'notes'>
  & { id?: string; revision?: number };

const clean = (v: unknown, max = 500) => String(v ?? '').trim().slice(0, max);
export const equipmentIdentityKey = (name: string) => normalizeMaterialNameKey(name);

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
): Unsubscribe {
  if (!projectId) { onData([]); return () => {}; }
  return onSnapshot(collection(db, 'projects', projectId, 'equipment_catalog'), (snapshot) => {
    const entries = snapshot.docs.map((snapshotDoc) =>
      ({ ...snapshotDoc.data(), id: snapshotDoc.id }) as EquipmentCatalogRecord
    ).filter(item => Boolean(item.name && item.unit));
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
    const id = equipmentCatalogId(name);
    if (entry.id && entry.id !== id) throw new Error('Không được sửa mã hoặc tên thiết bị cũ qua bảng. Tạo thiết bị mới nếu là mặt hàng khác.');
    return {
      id, projectId, name, unit,
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
  const ledger = await getDocsFromServer(collection(db, 'projects', projectId, 'inventory'));
  for (const record of ledger.docs) {
    const voucher = record.data();
    if (voucher.itemKind !== 'equipment') continue;
    const existing = payload.find(p => equipmentIdentityKey(p.name) === equipmentIdentityKey(String(voucher.materialName || '')));
    if (existing && (normalizeUnit(String(voucher.unit || '')) || String(voucher.unit || '')) !== existing.unit) {
      throw new Error(`Thiết bị “${existing.name}” có lịch sử phiếu với ĐVT khác trên Cloud. Phải đối chiếu kho, không thể tạo danh mục trùng tên.`);
    }
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
        if (next.expectedRevision === undefined || existing.revision !== next.expectedRevision) {
          throw new Error('Danh mục thiết bị đã thay đổi trên thiết bị khác. Hãy tải lại trước khi lưu.');
        }
        if (equipmentIdentityKey(existing.name) !== equipmentIdentityKey(next.name) ||
          (normalizeUnit(existing.unit) || existing.unit) !== next.unit) {
          throw new Error('Tên/ĐVT của thiết bị đã có không được sửa trực tiếp. Đổi ĐVT phải qua quy trình đồng bộ kho.');
        }
      } else if (next.expectedRevision !== undefined) {
        throw new Error('Thiết bị không còn trong danh mục Cloud. Hãy tải lại.');
      }
      const { expectedRevision: _ignored, ...data } = next;
      tx.set(refs[index], {
        ...data,
        revision: existing ? existing.revision + 1 : 1,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
      });
    });
  }, { maxAttempts: 3 });
}
