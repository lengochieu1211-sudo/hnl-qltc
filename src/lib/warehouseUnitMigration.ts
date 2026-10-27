import { collection, doc, getDocFromServer, getDocsFromServer, runTransaction } from 'firebase/firestore';
import type { InventoryItem, MaterialNorm } from '../types';
import { normalizeMaterialNameKey, resolveNormMaterialId } from '../utils/inventoryUtils';
import { getWarehouseMaterialKey, getWarehouseSignedDelta } from '../utils/warehouseLedgerMath';
import { normalizeUnit, areSameUnit } from '../utils/unitUtils';
import { db, getCurrentRealFirebaseUser, sanitizePayloadForCloud } from './firebase';
import { WAREHOUSE_TRUSTED_WRITER_ENABLED, callTrustedMaterialUnitRename, callTrustedEquipmentUnitRename } from './warehouseTrustedClient';
import { equipmentCatalogId, equipmentIdentityKey, type EquipmentCatalogRecord } from './equipmentCatalog';

/**
 * One-to-one unit-label rename. Never silently convert a package into its contents.
 * Every affected Firestore row, the associated norm rows, and derived balance(s)
 * are changed in ONE transaction. Oversized/ambiguous/legacy-inconsistent sets
 * are rejected before the first write; there is no chunked partial migration.
 */
export interface WarehouseUnitRenameInput {
  projectId: string;
  kind: 'material' | 'equipment';
  materialId?: string;
  materialName: string;
  fromUnit: string;
  toUnit: string;
  /** Optional ADMIN master-data update included in the same atomic equipment unit correction. */
  equipmentMetadata?: {
    displayName: string; category: string; brand: string;
    model: string; specifications: string; notes: string;
    expectedRevision?: number;
  };
}

type WarehouseCloudRow = InventoryItem & {
  materialKey?: string;
  deleted?: boolean;
};

const MAX_TRANSACTION_DOCUMENTS = 150;
const EPSILON = 0.000001;
const active = (row: { deleted?: boolean; deletedAt?: number | null }) =>
  row.deleted !== true && row.deletedAt == null;
const equalName = (a: string, b: string) => normalizeMaterialNameKey(a) === normalizeMaterialNameKey(b);
const round = (n: number) => Math.round(n * 1e9) / 1e9;

export async function renameWarehouseUnitAtomic(input: WarehouseUnitRenameInput): Promise<{ norms: number; vouchers: number }> {
  if (WAREHOUSE_TRUSTED_WRITER_ENABLED) {
    // Unit-label-only, canonical material IDs: DEV trusted server now updates
    // norms + all vouchers + balance together with ADMIN role revalidation.
    // Equipment metadata/legacy aliases stay fail-closed until independently proven.
    if (input.kind === 'equipment') {
      const result = await callTrustedEquipmentUnitRename({
        projectId:input.projectId,kind:'equipment',materialName:input.materialName,
        fromUnit:normalizeUnit(input.fromUnit)||input.fromUnit,
        toUnit:normalizeUnit(input.toUnit)||input.toUnit,
        ...(input.equipmentMetadata ? {equipmentMetadata:input.equipmentMetadata} : {}),
      });
      return {norms:result.norms,vouchers:result.vouchers};
    }
    if (input.kind !== 'material' || !input.materialId || input.equipmentMetadata)
      throw new Error('WAREHOUSE_TRUSTED_LEGACY_UNIT_RENAME_NOT_READY');
    const result = await callTrustedMaterialUnitRename({
      projectId:input.projectId,kind:'material',materialId:input.materialId,
      materialName:input.materialName,fromUnit:normalizeUnit(input.fromUnit)||input.fromUnit,
      toUnit:normalizeUnit(input.toUnit)||input.toUnit,
    });
    return {norms:result.norms,vouchers:result.vouchers};
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Đổi ĐVT cần kết nối mạng để khóa tồn kho trên tất cả thiết bị.');
  }
  const user = getCurrentRealFirebaseUser();
  if (!user) throw new Error('Bạn cần đăng nhập Firebase.');
  const projectId = String(input.projectId || '').trim();
  const fromUnit = normalizeUnit(input.fromUnit) || String(input.fromUnit || '').trim();
  const toUnit = normalizeUnit(input.toUnit) || String(input.toUnit || '').trim();
  if (!projectId || !fromUnit || !toUnit || !input.materialName.trim()) throw new Error('Thiếu dữ liệu đổi đơn vị.');
  if (areSameUnit(fromUnit, toUnit)) return { norms: 0, vouchers: 0 };
  if (input.kind === 'material' && !input.materialId) throw new Error('Vật tư thiếu materialId. Không thể đồng bộ an toàn.');
  if (input.kind !== 'equipment' && input.equipmentMetadata) throw new Error('Chỉ được đính kèm thông tin thiết bị khi sửa ĐVT thiết bị.');
  const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
  const equipmentMetadata = input.equipmentMetadata ? {
    displayName: clean(input.equipmentMetadata.displayName, 180),
    category: clean(input.equipmentMetadata.category, 120) || 'Thiết bị',
    brand: clean(input.equipmentMetadata.brand, 120),
    model: clean(input.equipmentMetadata.model, 120),
    specifications: clean(input.equipmentMetadata.specifications, 1200),
    notes: clean(input.equipmentMetadata.notes, 1200),
  } : null;
  if (equipmentMetadata && !equipmentMetadata.displayName) throw new Error('Tên hiển thị thiết bị không được để trống.');

  // A catalog record, when present, participates in the SAME atomic unit rename
  // as every affected voucher and inventory balance. Never leave stale master data.
  const catalogRef = input.kind === 'equipment'
    ? doc(db, 'projects', projectId, 'equipment_catalog', equipmentCatalogId(input.materialName))
    : null;
  const catalogBeforeSnap = catalogRef ? await getDocFromServer(catalogRef) : null;
  const catalogBefore = catalogBeforeSnap?.exists()
    ? catalogBeforeSnap.data() as EquipmentCatalogRecord : null;
  if (catalogBefore && !areSameUnit(catalogBefore.unit, fromUnit)) {
    throw new Error('ĐVT danh mục thiết bị đã thay đổi hoặc không khớp phiếu kho; hủy đổi.');
  }
  if (catalogBefore?.deletedAt != null) throw new Error('Thiết bị đang ở thùng rác, không được đổi ĐVT.');
  if (input.equipmentMetadata?.expectedRevision !== undefined
    && (catalogBefore?.revision !== input.equipmentMetadata.expectedRevision)) {
    throw new Error('Thiết bị đã thay đổi trên tài khoản khác. Vui lòng tải lại trước khi sửa ĐVT.');
  }

  const [rawNormSnap, rawInventorySnap] = await Promise.all([
    getDocsFromServer(collection(db, 'projects', projectId, 'material_norms')),
    getDocsFromServer(collection(db, 'projects', projectId, 'inventory')),
  ]);
  const norms = rawNormSnap.docs
    .map((row) => ({ ref: row.ref, value: { ...row.data(), id: row.id } as MaterialNorm & { deleted?: boolean } }))
    .filter((row) => active(row.value));
  const allLedgerRows = rawInventorySnap.docs
    .map((row) => ({ ref: row.ref, value: { ...row.data(), id: row.id } as WarehouseCloudRow }));
  const ledger = allLedgerRows.filter((row) => active(row.value));

  // The unit migration also writes display metadata when invoked by the editor.
  // Protect its user-facing label against the same canonical-name collisions as
  // saveEquipmentCatalogBatch; do not bypass that invariant inside migration.
  if (equipmentMetadata) {
    const requestedNameKey = equipmentIdentityKey(input.materialName);
    const requestedLabelKey = equipmentIdentityKey(equipmentMetadata.displayName);
    if (requestedLabelKey !== requestedNameKey && allLedgerRows.some(({ value }) =>
      value.itemKind === 'equipment'
      && equipmentIdentityKey(String(value.materialName || '')) === requestedLabelKey
    )) throw new Error('Tên hiển thị trùng với thiết bị khác có phiếu kho. Hãy đặt tên khác.');
    const catalogSnapshot = await getDocsFromServer(collection(db, 'projects', projectId, 'equipment_catalog'));
    if (catalogSnapshot.docs.some((row) => {
      if (row.id === equipmentCatalogId(input.materialName)) return false;
      const candidate = row.data();
      return [candidate.name, candidate.displayName].some((label) =>
        Boolean(label) && equipmentIdentityKey(String(label)) === requestedLabelKey);
    })) throw new Error('Tên hiển thị trùng với thiết bị khác trong danh mục Cloud.');
  }


  const relatedNorms = input.kind === 'material'
    ? norms.filter((row) => resolveNormMaterialId(row.value) === input.materialId)
    : [];
  if (input.kind === 'material' && relatedNorms.length === 0) {
    throw new Error('Không thấy Định mức vật tư tương ứng trên Cloud; chưa thay đổi dữ liệu.');
  }
  if (relatedNorms.some((row) => !areSameUnit(row.value.unit, fromUnit))) {
    throw new Error('Các Định mức chung materialId đang dùng ĐVT khác nhau. Cần đối chiếu trước.');
  }
  if (input.kind === 'material' && relatedNorms.some((row) => !equalName(row.value.materialName, input.materialName))) {
    throw new Error('Các Định mức có chung materialId nhưng tên vật tư không thống nhất.');
  }
  if (input.kind === 'material' && norms.some((row) =>
    resolveNormMaterialId(row.value) !== input.materialId
    && equalName(row.value.materialName, input.materialName)
    && areSameUnit(row.value.unit, toUnit)
  )) {
    throw new Error('ĐVT mới đã thuộc vật tư khác cùng tên. Không được gộp materialId.');
  }
  const aliases = new Set<string>([String(input.materialId || '')]);
  relatedNorms.forEach(({ value }) => {
    aliases.add(value.id);
    aliases.add(`MAT-${value.id}`);
    if (value.materialId) aliases.add(value.materialId);
  });

  const matchesIdentity = (item: WarehouseCloudRow): boolean => {
    if (input.kind === 'equipment') {
      return item.itemKind === 'equipment' && equalName(item.materialName, input.materialName);
    }
    if (item.itemKind === 'equipment') return false;
    if (item.materialId) return aliases.has(item.materialId);
    return equalName(item.materialName, input.materialName) && areSameUnit(item.unit, fromUnit);
  };
  if (ledger.some(({ value }) => matchesIdentity(value) && !areSameUnit(value.unit, fromUnit))) {
    throw new Error('Vật tư/thiết bị đang có phiếu với nhiều ĐVT. Cần audit trước khi đổi hàng loạt.');
  }
  if (input.kind === 'equipment' && ledger.some(({ value }) =>
    value.itemKind === 'equipment'
    && equalName(value.materialName, input.materialName)
    && areSameUnit(value.unit, toUnit)
  )) {
    throw new Error('Thiết bị cùng tên đã tồn tại với ĐVT đích. Không được gộp hai lịch sử.');
  }
  // Deleted vouchers can be restored; do not leave hidden old-unit receipts
  // behind that would re-enter the ledger under an obsolete denomination.
  if (allLedgerRows.some(({ value }) =>
    !active(value) && matchesIdentity(value) && areSameUnit(value.unit, fromUnit)
  )) {
    throw new Error('Có phiếu liên quan trong thùng rác. Chưa thể đổi ĐVT an toàn vì khi khôi phục sẽ phát sinh đơn vị cũ; cần xử lý lịch sử khôi phục trước.');
  }
  const vouchers = ledger.filter(({ value }) => matchesIdentity(value) && areSameUnit(value.unit, fromUnit));
  // Legacy ledger rows without canonical materialId are keyed by name + unit.
  // Renaming just their unit while preserving an absent/alias materialId would
  // split old stock from new id-keyed vouchers. Require a dedicated alias
  // reconciliation first; never silently change a business identity.
  if (input.kind === 'material' && vouchers.some(({ value }) => value.materialId !== input.materialId)) {
    throw new Error('Giao dịch vật tư cũ còn thiếu materialId chuẩn hoặc dùng mã alias. Đã hủy đổi ĐVT để tránh tách tồn kho; cần đối chiếu/migration ID legacy trước.');
  }
  if (input.kind === 'equipment' && vouchers.length === 0) throw new Error('Không tìm thấy lịch sử thiết bị trên Cloud.');

  const keyGroups = new Map<string, {
    oldKey: string; newKey: string; signed: number;
    sample: WarehouseCloudRow;
  }>();
  for (const { value } of vouchers) {
    const oldKey = value.materialKey || getWarehouseMaterialKey(value);
    const nextValue = { ...value, unit: toUnit };
    const newKey = getWarehouseMaterialKey(nextValue);
    const group = keyGroups.get(oldKey) || { oldKey, newKey, signed: 0, sample: value };
    if (group.newKey !== newKey) throw new Error('Một balance đang ánh xạ nhiều đơn vị đích; đã hủy.');
    group.signed = round(group.signed + getWarehouseSignedDelta(value));
    keyGroups.set(oldKey, group);
  }
  const allKeys = Array.from(new Set(Array.from(keyGroups.values()).flatMap((group) => [group.oldKey, group.newKey])));
  if (relatedNorms.length + vouchers.length + allKeys.length + (catalogRef ? 1 : 0) > MAX_TRANSACTION_DOCUMENTS) {
    throw new Error(`Có ${vouchers.length} phiếu liên quan, vượt giới hạn cập nhật nguyên tử (${MAX_TRANSACTION_DOCUMENTS} bản ghi). Chưa thay đổi dữ liệu; cần xử lý qua công cụ migration chuyên dụng.`);
  }
  // A group can share the destination only if it is the same logical item.
  const destinationSources = new Map<string, string>();
  for (const group of keyGroups.values()) {
    const prev = destinationSources.get(group.newKey);
    if (prev && prev !== group.oldKey) throw new Error('Nhiều nguồn cùng nhập một balance đích; không được gộp.');
    destinationSources.set(group.newKey, group.oldKey);
    const activeWithKey = ledger.filter(({ value }) =>
      (value.materialKey || getWarehouseMaterialKey(value)) === group.oldKey
    );
    if (activeWithKey.some(({ value }) => !vouchers.some((row) => row.value.id === value.id))) {
      throw new Error(`Balance ${group.oldKey} đang có giao dịch khác không thuộc vật tư cần đổi.`);
    }
  }
  const balancePreflight = new Map<string, {
    ref: ReturnType<typeof doc>;
    exists: boolean;
    revision: number;
    onHand: number;
    updatedAt: number;
  }>();
  await Promise.all(allKeys.map(async (key) => {
    const ref = doc(db, 'projects', projectId, 'inventory_balances', key);
    const snap = await getDocFromServer(ref);
    balancePreflight.set(key, {
      ref, exists: snap.exists(), revision: Number(snap.data()?.revision || 0),
      onHand: Number(snap.data()?.onHand || 0), updatedAt: Number(snap.data()?.updatedAt || 0),
    });
  }));
  for (const group of keyGroups.values()) {
    const previous = balancePreflight.get(group.oldKey)!;
    if (!previous.exists || Math.abs(previous.onHand - group.signed) > EPSILON) {
      throw new Error('Số dư tồn kho khác sổ giao dịch tại ' + group.oldKey + '. Cần đối chiếu ledger trước khi đổi ĐVT.');
    }
    if (group.oldKey !== group.newKey) {
      const target = balancePreflight.get(group.newKey)!;
      // A previously renamed-away balance is a tombstone for stale devices.
      // Never reuse it: merge:true would retain renamedTo and brick the new unit.
      const targetLedgerRows = ledger.filter(({ value }) =>
        (value.materialKey || getWarehouseMaterialKey(value)) === group.newKey
      );
      if (target.exists || targetLedgerRows.length > 0) {
        throw new Error('Đơn vị đích đã có bản ghi số dư/lịch sử (kể cả đã đổi ĐVT trước đây). Không gộp hoặc dùng lại balance cũ.');
      }
    }
  }
  const time = Date.now();
  await runTransaction(db, async (tx) => {
    // Firestore requires all reads before the first write.
    const [normCurrent, voucherCurrent, balanceCurrent, catalogCurrent] = await Promise.all([

      Promise.all(relatedNorms.map(({ ref }) => tx.get(ref))),
      Promise.all(vouchers.map(({ ref }) => tx.get(ref))),
      Promise.all(allKeys.map((key) => tx.get(balancePreflight.get(key)!.ref))),
      catalogRef ? tx.get(catalogRef) : Promise.resolve(null),
    ]);
    const assertUnchanged = (before: any, now: any, label: string) => {
      if (!now.exists() || now.data()?.deleted === true
        || Number(before.revision || 0) !== Number(now.data()?.revision || 0)
        || Number(before.updatedAt || 0) !== Number(now.data()?.updatedAt || 0)) {
        throw new Error(`Đã có thay đổi đồng thời tại ${label}. Hủy đổi ĐVT, vui lòng tải lại.`);
      }
    };
    relatedNorms.forEach((item, index) => assertUnchanged(item.value, normCurrent[index], item.value.id));
    vouchers.forEach((item, index) => assertUnchanged(item.value, voucherCurrent[index], item.value.id));
    allKeys.forEach((key, index) => {
      const before = balancePreflight.get(key)!;
      const snap = balanceCurrent[index];
      if (snap.exists() !== before.exists
        || Number(snap.data()?.revision || 0) !== before.revision
        || Number(snap.data()?.updatedAt || 0) !== before.updatedAt
        || Math.abs(Number(snap.data()?.onHand || 0) - before.onHand) > EPSILON) {
        throw new Error('Tồn kho vừa thay đổi trên thiết bị khác; hủy đổi ĐVT.');
      }
    });
    if (catalogRef && catalogCurrent) {
      if (catalogCurrent.exists() !== Boolean(catalogBefore)
        || (catalogBefore && (Number(catalogCurrent.data()?.revision || 0) !== Number(catalogBefore.revision || 0)
          || !areSameUnit(String(catalogCurrent.data()?.unit || ''), fromUnit)))) {
        throw new Error('Danh mục thiết bị thay đổi đồng thời; hủy đổi ĐVT.');
      }
    }
    relatedNorms.forEach(({ ref, value }) => {
      tx.set(ref, sanitizePayloadForCloud({
        unit: toUnit, materialId: resolveNormMaterialId(value),
        revision: Math.max(Number(value.revision || 0) + 1, 1),
        updatedAt: Math.max(time, Number(value.updatedAt || 0) + 1),
        updatedByUid: user.uid,
      }), { merge: true });
    });
    if (catalogRef && catalogBefore) {
      // A unit correction and the edited display metadata become visible together.
      // Preserve stable ID/name, order, tombstone and createdAt.
      tx.set(catalogRef, sanitizePayloadForCloud({
        ...(equipmentMetadata || {}), unit: toUnit,
        revision: Math.max(Number(catalogBefore.revision || 0) + 1, 1),
        updatedAt: Math.max(time, Number(catalogBefore.updatedAt || 0) + 1),
      }), { merge: true });
    } else if (catalogRef && equipmentMetadata) {
      // Voucher-only legacy equipment has no master record yet. Create one
      // atomically rather than migrating vouchers but losing the edited metadata.
      tx.set(catalogRef, sanitizePayloadForCloud({
        id: equipmentCatalogId(input.materialName), projectId,
        name: String(input.materialName).trim(), unit: toUnit,
        ...equipmentMetadata, revision: 1, createdAt: time, updatedAt: time,
      }));
    }
    vouchers.forEach(({ ref, value }) => {
      const newKey = getWarehouseMaterialKey({ ...value, unit: toUnit });
      tx.set(ref, sanitizePayloadForCloud({
        unit: toUnit, materialKey: newKey,
        revision: Math.max(Number(value.revision || 0) + 1, 1),
        updatedAt: Math.max(time, Number(value.updatedAt || 0) + 1),
        updatedByUid: user.uid,
      }), { merge: true });
    });
    for (const group of keyGroups.values()) {
      const old = balancePreflight.get(group.oldKey)!;
      if (group.oldKey === group.newKey) {
        tx.set(old.ref, {
          unit: toUnit, materialName: group.sample.materialName,
          revision: old.revision + 1, updatedAt: Math.max(time, old.updatedAt + 1),
          updatedByUid: user.uid,
        }, { merge: true });
      } else {
        const target = balancePreflight.get(group.newKey)!;
        tx.set(old.ref, {
          onHand: 0, renamedTo: group.newKey, renamedToUnit: toUnit,
          revision: old.revision + 1, updatedAt: Math.max(time, old.updatedAt + 1),
          updatedByUid: user.uid,
        }, { merge: true });
        tx.set(target.ref, sanitizePayloadForCloud({
          id: group.newKey, projectId, itemKind: input.kind,
          materialId: group.sample.materialId || null, materialName: group.sample.materialName,
          unit: toUnit, onHand: round(group.signed + target.onHand),
          revision: target.revision + 1, updatedAt: Math.max(time, target.updatedAt + 1),
          updatedByUid: user.uid,
        }), { merge: true });
      }
    }
  });
  return { norms: relatedNorms.length, vouchers: vouchers.length };
}
