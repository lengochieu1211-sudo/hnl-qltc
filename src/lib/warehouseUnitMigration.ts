import { collection, doc, getDocsFromServer, runTransaction } from 'firebase/firestore';
import type { InventoryItem, MaterialNorm } from '../types';
import { db, getCurrentRealFirebaseUser } from './firebase';
import { areSameUnit, normalizeUnit } from '../utils/unitUtils';
import { normalizeMaterialNameKey, resolveNormMaterialId } from '../utils/inventoryUtils';
import { getWarehouseMaterialKey, getWarehouseSignedDelta, isActiveWarehouseLedgerItem } from '../utils/warehouseLedgerMath';

/** A label correction, never a physical quantity conversion. ADMIN only (Rules + caller). */
export interface WarehouseUnitRename {
  itemKind: 'material' | 'equipment';
  materialName: string;
  oldUnit: string;
  newUnit: string;
  materialId?: string;
}

const MAX_ATOMIC_ROWS = 150;

function sameName(a: string, b: string): boolean {
  return normalizeMaterialNameKey(a) === normalizeMaterialNameKey(b);
}

function guardSignature(value: Record<string, any>): string {
  return JSON.stringify([
    value.id, value.itemKind || 'material', value.materialId || '',
    value.materialName, value.unit, value.materialKey || '', value.type,
    value.quantity, value.deleted || false, value.deletedAt ?? null,
    value.revision ?? null, value.updatedAt ?? null,
  ]);
}

/**
 * Rename units across ALL affected source vouchers/norms AND balance metadata
 * in ONE online Firestore transaction. Never write a partial series of receipts.
 * Too-large, ambiguous, stale or unbalanced ledgers fail closed.
 */
export async function renameWarehouseUnitAtomic(
  projectId: string,
  input: WarehouseUnitRename,
): Promise<{ vouchers: number; norms: number }> {
  const user = getCurrentRealFirebaseUser();
  if (!user) throw new Error('Cần đăng nhập Firebase.');
  if (!projectId) throw new Error('Thiếu projectId.');
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Đổi ĐVT đồng bộ yêu cầu online; không thể sửa từng phiếu khi offline.');
  }
  const oldUnit = normalizeUnit(input.oldUnit) || String(input.oldUnit || '').trim();
  const newUnit = normalizeUnit(input.newUnit) || String(input.newUnit || '').trim();
  if (!oldUnit || !newUnit || !input.materialName.trim()) throw new Error('Tên và ĐVT không được rỗng.');
  if (areSameUnit(oldUnit, newUnit)) return { vouchers: 0, norms: 0 };
  const isEquipment = input.itemKind === 'equipment';
  const inventoryCollection = collection(db, 'projects', projectId, 'inventory');
  const normCollection = collection(db, 'projects', projectId, 'material_norms');

  // Server snapshots, not an offline/local cache. All docs are checked again inside
  // the transaction before any write; a competing stock operation must change balance.
  // Read the balance generation BEFORE inventory. Any concurrent voucher write,
  // even an IN+OUT pair with net zero, increments balance revision and is rejected.
  const balanceBefore = await getDocsFromServer(collection(db, 'projects', projectId, 'inventory_balances'));
  const initialBalances = new Map(balanceBefore.docs.map((snap) => [snap.id, {
    revision: Number(snap.data().revision || 0),
    onHand: Number(snap.data().onHand || 0),
  }]));
  const [ledgerSnapshot, normsSnapshot] = await Promise.all([
    getDocsFromServer(inventoryCollection), getDocsFromServer(normCollection),
  ]);
  const catalog = normsSnapshot.docs.map((snap) => ({
    ref: snap.ref, data: snap.data() as MaterialNorm,
  }));
  const materialId = isEquipment ? '' : String(input.materialId || '').trim();
  if (!isEquipment && !materialId) throw new Error('Không xác định được materialId ổn định.');
  const linkedNorms = isEquipment ? [] : catalog.filter(({ data }) =>
    resolveNormMaterialId(data) === materialId && (data.deletedAt == null)
  );
  if (!isEquipment && linkedNorms.length === 0) throw new Error('Định mức vật tư không tồn tại trên Firestore.');
  if (linkedNorms.some(({ data }) => !areSameUnit(data.unit, oldUnit))) {
    throw new Error('Một số định mức cùng materialId đang dùng ĐVT khác. Cần audit thủ công.');
  }
  if (!isEquipment && catalog.some(({ data }) =>
    data.deletedAt == null && resolveNormMaterialId(data) !== materialId &&
    sameName(data.materialName, input.materialName) &&
    (areSameUnit(data.unit, newUnit) || areSameUnit(data.unit, oldUnit))
  )) throw new Error('Tên vật tư và ĐVT liên quan đến nhiều materialId. Phải làm rõ định danh trước, không được gộp.');

  const aliases = new Set<string>([materialId]);
  linkedNorms.forEach(({ data }) => {
    aliases.add(String(data.id));
    aliases.add('MAT-' + String(data.id));
  });
  const ledger = ledgerSnapshot.docs.map((snap) => ({
    ref: snap.ref, data: snap.data() as InventoryItem & { materialKey?: string; deleted?: boolean; revision?: number; updatedAt?: number },
  }));
  const affected = ledger.filter(({ data }) => {
    const equipment = data.itemKind === 'equipment';
    if (equipment !== isEquipment) return false;
    if (isEquipment) return sameName(data.materialName, input.materialName) && areSameUnit(data.unit, oldUnit);
    return (Boolean(data.materialId) && aliases.has(String(data.materialId)))
      || (!data.materialId && sameName(data.materialName, input.materialName) && areSameUnit(data.unit, oldUnit));
  });

  if (affected.length > MAX_ATOMIC_ROWS || affected.length + linkedNorms.length > 180) {
    throw new Error('Số phiếu liên quan vượt giới hạn cập nhật một lần (' + MAX_ATOMIC_ROWS + '). Không ghi dữ liệu; cần xử lý di chuyển dữ liệu theo quy trình riêng.');
  }
  if (isEquipment && affected.length === 0) throw new Error('Không tìm thấy phiếu thiết bị cần đổi đơn vị.');
  if (affected.some(({ data }) => !areSameUnit(data.unit, oldUnit))) {
    throw new Error('Đã phát hiện phiếu cùng materialId có ĐVT không thống nhất. Không sửa.');
  }
  if (ledger.some(({ data }) =>
    (data.itemKind === 'equipment') === isEquipment &&
    sameName(data.materialName, input.materialName) &&
    areSameUnit(data.unit, newUnit) &&
    isActiveWarehouseLedgerItem(data)
  )) throw new Error('Đã có giao dịch cùng tên và ĐVT đích. Không gộp kho tự động.');

  const affectedRefs = new Set(affected.map(({ ref }) => ref.path));
  if (!isEquipment && ledger.some(({ ref, data }) =>
    !affectedRefs.has(ref.path) && data.itemKind !== 'equipment' &&
    sameName(data.materialName, input.materialName) && areSameUnit(data.unit, oldUnit) &&
    Boolean(data.materialId) && !aliases.has(String(data.materialId))
  )) throw new Error('Có hai materialId cùng tên/ĐVT cũ, cần phân biệt trước khi đổi.');

  const targetMaterialKey = getWarehouseMaterialKey({
    itemKind: input.itemKind,
    materialName: input.materialName,
    unit: newUnit,
    materialId: materialId || undefined,
  });
  const oldTotals = new Map<string, number>();
  let nextOnHand = 0;
  affected.forEach(({ data }) => {
    if (!isActiveWarehouseLedgerItem(data)) return;
    const key = data.materialKey || getWarehouseMaterialKey(data);
    const delta = getWarehouseSignedDelta(data);
    oldTotals.set(key, (oldTotals.get(key) || 0) + delta);
    nextOnHand += delta;
  });
  if (nextOnHand < -1e-9) throw new Error('Ledger nguồn đang âm; từ chối đổi ĐVT.');

  // No hidden transactions can share an affected balance key.
  const allKeys = new Set([...oldTotals.keys(), targetMaterialKey]);
  for (const { ref, data } of ledger) {
    if (affectedRefs.has(ref.path) || !isActiveWarehouseLedgerItem(data)) continue;
    const key = data.materialKey || getWarehouseMaterialKey(data);
    if (allKeys.has(key)) throw new Error('Số dư kho có phiếu khác ngoài phạm vi đổi ĐVT.');
  }
  const balanceRefs = [...allKeys].map((key) => ({
    key, ref: doc(db, 'projects', projectId, 'inventory_balances', key),
  }));

  await runTransaction(db, async (tx) => {
    const [currentLedger, currentNorms, balances] = await Promise.all([
      Promise.all(affected.map(({ ref }) => tx.get(ref))),
      Promise.all(linkedNorms.map(({ ref }) => tx.get(ref))),
      Promise.all(balanceRefs.map(({ ref }) => tx.get(ref))),
    ]);
    currentLedger.forEach((snap, i) => {
      if (!snap.exists() || guardSignature(snap.data() || {}) !== guardSignature(affected[i].data)) {
        throw new Error('Phiếu kho vừa thay đổi trên thiết bị khác. Hãy đồng bộ và thử lại.');
      }
    });
    currentNorms.forEach((snap, i) => {
      if (!snap.exists()) throw new Error('Định mức bị xóa khi đang đổi ĐVT.');
      const data = snap.data();
      if (!areSameUnit(String(data.unit || ''), oldUnit) || resolveNormMaterialId(data as MaterialNorm) !== materialId
        || Number(data.revision || 0) !== Number((linkedNorms[i].data as any).revision || 0)) {
        throw new Error('Định mức vừa thay đổi; không ghi bản cũ đè lên Cloud.');
      }
    });
    balances.forEach((snap, i) => {
      const key = balanceRefs[i].key;
      const observed = Number(snap.data()?.onHand || 0);
      const before = initialBalances.get(key);
      if (Number(snap.data()?.revision || 0) !== (before?.revision || 0)
          || Math.abs(observed - (before?.onHand || 0)) > 1e-7) {
        throw new Error('Số dư kho vừa bị cập nhật bởi thiết bị khác. Tải lại và thử lại.');
      }
      const expected = oldTotals.get(key) || 0;
      if (Math.abs(observed - expected) > 1e-7) {
        throw new Error('Số dư Firestore không khớp sổ phiếu tại ' + key + '. Không sửa khi chưa đối chiếu.');
      }
    });

    const now = Date.now();
    affected.forEach(({ ref }, i) => {
      const current = currentLedger[i].data()!;
      tx.update(ref, {
        unit: newUnit,
        ...(isEquipment ? {} : { materialId }),
        materialKey: targetMaterialKey,
        revision: Math.max(Number(current.revision || 0) + 1, 1),
        updatedAt: Math.max(now, Number(current.updatedAt || 0) + 1),
        updatedByUid: user.uid,
      });
    });
    linkedNorms.forEach(({ ref }, i) => {
      const current = currentNorms[i].data()!;
      tx.update(ref, {
        unit: newUnit,
        materialId,
        revision: Math.max(Number(current.revision || 0) + 1, 1),
        updatedAt: Math.max(now, Number(current.updatedAt || 0) + 1),
        updatedByUid: user.uid,
      });
    });
    balanceRefs.forEach(({ key, ref }, i) => {
      const current = balances[i].data() || {};
      const isTarget = key === targetMaterialKey;
      tx.set(ref, {
        ...current,
        id: key,
        projectId,
        itemKind: input.itemKind,
        materialId: materialId || null,
        materialName: input.materialName,
        unit: isTarget ? newUnit : oldUnit,
        retiredTo: isTarget ? null : targetMaterialKey,
        onHand: isTarget ? nextOnHand : 0,
        revision: Math.max(Number(current.revision || 0) + 1, 1),
        updatedAt: Math.max(now, Number(current.updatedAt || 0) + 1),
        updatedByUid: user.uid,
      }, { merge: true });
    });
  });
  return { vouchers: affected.length, norms: linkedNorms.length };
}
