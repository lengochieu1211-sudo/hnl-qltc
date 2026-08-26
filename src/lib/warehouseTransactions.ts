import { doc, runTransaction } from 'firebase/firestore';
import type { InventoryItem } from '../types';
import { db, getCurrentRealFirebaseUser } from './firebase';

export interface WarehouseBalanceRecord {
  id: string;
  projectId: string;
  materialId?: string;
  materialName: string;
  unit: string;
  onHand: number;
  revision: number;
  updatedAt: number;
  updatedByUid: string;
}

export interface WarehouseCommitResult {
  transactionId: string;
  materialKey: string;
  onHand: number;
  duplicate: boolean;
}

function normalizePart(value: unknown): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/**
 * Inventory rows are the immutable ledger/source of truth. This key is only for the
 * derived balance document used by online stock validation. Prefer immutable materialId.
 */
export function getWarehouseMaterialKey(item: Pick<InventoryItem, 'materialId' | 'materialName' | 'unit'>): string {
  const materialId = normalizePart(item.materialId);
  if (materialId) return `id-${materialId}`;
  return `legacy-${normalizePart(item.materialName) || 'unknown'}--${normalizePart(item.unit) || 'unit'}`;
}

function assertOnlineForStrictStock(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('STRICT_STOCK_OFFLINE_BLOCKED: Xuất/chỉnh/xóa giao dịch kho cần online để khóa tồn kho an toàn giữa nhiều thiết bị.');
  }
}

function assertQuantity(item: Pick<InventoryItem, 'quantity'>): number {
  const quantity = Number(item.quantity || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Số lượng kho phải lớn hơn 0.');
  return quantity;
}

function signedDelta(item: Pick<InventoryItem, 'type' | 'quantity'>): number {
  const quantity = assertQuantity(item);
  return item.type === 'in' ? quantity : -quantity;
}

/**
 * Online atomic create. A duplicate transaction ID is idempotent. OUT is rejected if
 * the derived balance would become negative. Firestore transaction retry resolves races
 * between PC/phone. Offline OUT is deliberately blocked because client-side offline
 * transactions cannot guarantee a global non-negative invariant.
 */
export async function commitWarehouseTransactionAtomic(
  projectId: string,
  item: InventoryItem,
): Promise<WarehouseCommitResult> {
  if (!projectId || !item.id) throw new Error('Thiếu projectId/transactionId.');
  if (item.type === 'out') assertOnlineForStrictStock();
  const user = getCurrentRealFirebaseUser();
  if (!user) throw new Error('Cần đăng nhập Firebase để ghi giao dịch kho.');

  const materialKey = getWarehouseMaterialKey(item);
  const transactionRef = doc(db, 'projects', projectId, 'inventory', item.id);
  const balanceRef = doc(db, 'projects', projectId, 'inventory_balances', materialKey);

  return runTransaction(db, async (tx) => {
    const existing = await tx.get(transactionRef);
    const balanceSnap = await tx.get(balanceRef);
    const currentOnHand = Number(balanceSnap.data()?.onHand || 0);

    if (existing.exists() && !existing.data()?.deleted) {
      return { transactionId: item.id, materialKey, onHand: currentOnHand, duplicate: true };
    }

    const nextOnHand = currentOnHand + signedDelta(item);
    if (nextOnHand < -1e-9) {
      throw new Error(`INSUFFICIENT_STOCK: Tồn khả dụng ${currentOnHand}, không đủ để xuất ${Number(item.quantity || 0)}.`);
    }

    const now = Date.now();
    tx.set(transactionRef, {
      ...item,
      id: item.id,
      materialKey,
      revision: Math.max(Number(item.revision || 0), 1),
      createdAt: Number(item.createdAt || now),
      createdByUid: item.createdByUid || user.uid,
      updatedAt: now,
      updatedByUid: user.uid,
      deleted: false,
      deletedAt: null,
      deletedByUid: null,
      deletedBy: null,
    }, { merge: true });

    tx.set(balanceRef, {
      id: materialKey,
      projectId,
      materialId: item.materialId || null,
      materialName: item.materialName,
      unit: item.unit,
      onHand: Math.max(0, nextOnHand),
      revision: Math.max(Number(balanceSnap.data()?.revision || 0) + 1, 1),
      updatedAt: now,
      updatedByUid: user.uid,
    }, { merge: true });

    return { transactionId: item.id, materialKey, onHand: Math.max(0, nextOnHand), duplicate: false };
  });
}

/**
 * Online atomic edit. Material identity/type/quantity changes are applied as a reversal
 * of the old ledger row plus the new row in the same Firestore transaction.
 */
export async function updateWarehouseTransactionAtomic(
  projectId: string,
  transactionId: string,
  nextItem: InventoryItem,
): Promise<WarehouseCommitResult> {
  assertOnlineForStrictStock();
  const user = getCurrentRealFirebaseUser();
  if (!user) throw new Error('Cần đăng nhập Firebase để sửa giao dịch kho.');
  if (!projectId || !transactionId) throw new Error('Thiếu projectId/transactionId.');

  const transactionRef = doc(db, 'projects', projectId, 'inventory', transactionId);
  return runTransaction(db, async (tx) => {
    const currentSnap = await tx.get(transactionRef);
    if (!currentSnap.exists() || currentSnap.data()?.deleted) throw new Error('Giao dịch kho không còn tồn tại trên Cloud.');
    const current = currentSnap.data() as InventoryItem & { materialKey?: string };
    const oldKey = current.materialKey || getWarehouseMaterialKey(current);
    const newKey = getWarehouseMaterialKey(nextItem);
    const oldBalanceRef = doc(db, 'projects', projectId, 'inventory_balances', oldKey);
    const newBalanceRef = doc(db, 'projects', projectId, 'inventory_balances', newKey);
    const oldBalanceSnap = await tx.get(oldBalanceRef);
    const newBalanceSnap = oldKey === newKey ? oldBalanceSnap : await tx.get(newBalanceRef);

    const oldOnHand = Number(oldBalanceSnap.data()?.onHand || 0);
    const newOnHandBase = oldKey === newKey ? oldOnHand : Number(newBalanceSnap.data()?.onHand || 0);
    const reversedOld = oldOnHand - signedDelta(current);
    const sameKeyFinal = reversedOld + signedDelta(nextItem);
    const newKeyFinal = newOnHandBase + signedDelta(nextItem);
    if ((oldKey === newKey ? sameKeyFinal : reversedOld) < -1e-9 || (oldKey !== newKey && newKeyFinal < -1e-9)) {
      throw new Error('INSUFFICIENT_STOCK: Sửa giao dịch sẽ làm tồn kho âm.');
    }

    const now = Date.now();
    if (oldKey === newKey) {
      tx.set(oldBalanceRef, {
        ...oldBalanceSnap.data(), id: oldKey, projectId, onHand: Math.max(0, sameKeyFinal),
        revision: Math.max(Number(oldBalanceSnap.data()?.revision || 0) + 1, 1), updatedAt: now, updatedByUid: user.uid,
      }, { merge: true });
    } else {
      tx.set(oldBalanceRef, {
        ...oldBalanceSnap.data(), id: oldKey, projectId, onHand: Math.max(0, reversedOld),
        revision: Math.max(Number(oldBalanceSnap.data()?.revision || 0) + 1, 1), updatedAt: now, updatedByUid: user.uid,
      }, { merge: true });
      tx.set(newBalanceRef, {
        id: newKey, projectId, materialId: nextItem.materialId || null, materialName: nextItem.materialName, unit: nextItem.unit,
        onHand: Math.max(0, newKeyFinal), revision: Math.max(Number(newBalanceSnap.data()?.revision || 0) + 1, 1),
        updatedAt: now, updatedByUid: user.uid,
      }, { merge: true });
    }

    tx.set(transactionRef, {
      ...nextItem,
      id: transactionId,
      materialKey: newKey,
      createdAt: current.createdAt || now,
      createdByUid: current.createdByUid || user.uid,
      revision: Math.max(Number(current.revision || 0) + 1, Number(nextItem.revision || 0) + 1, 1),
      updatedAt: now,
      updatedByUid: user.uid,
      deleted: false,
      deletedAt: null,
      deletedByUid: null,
      deletedBy: null,
    }, { merge: true });

    return {
      transactionId,
      materialKey: newKey,
      onHand: Math.max(0, oldKey === newKey ? sameKeyFinal : newKeyFinal),
      duplicate: false,
    };
  });
}

/** Soft delete only. Reverses the ledger effect and keeps a tombstone for stale devices. */
export async function softDeleteWarehouseTransactionAtomic(projectId: string, transactionId: string): Promise<void> {
  assertOnlineForStrictStock();
  const user = getCurrentRealFirebaseUser();
  if (!user) throw new Error('Cần đăng nhập Firebase để xóa giao dịch kho.');
  const transactionRef = doc(db, 'projects', projectId, 'inventory', transactionId);

  await runTransaction(db, async (tx) => {
    const currentSnap = await tx.get(transactionRef);
    if (!currentSnap.exists() || currentSnap.data()?.deleted) return;
    const current = currentSnap.data() as InventoryItem & { materialKey?: string };
    const materialKey = current.materialKey || getWarehouseMaterialKey(current);
    const balanceRef = doc(db, 'projects', projectId, 'inventory_balances', materialKey);
    const balanceSnap = await tx.get(balanceRef);
    const currentOnHand = Number(balanceSnap.data()?.onHand || 0);
    const nextOnHand = currentOnHand - signedDelta(current);
    if (nextOnHand < -1e-9) throw new Error('INVENTORY_LEDGER_INCONSISTENT: Không thể đảo giao dịch mà làm tồn kho âm.');
    const now = Date.now();

    tx.set(balanceRef, {
      ...balanceSnap.data(), id: materialKey, projectId, onHand: Math.max(0, nextOnHand),
      revision: Math.max(Number(balanceSnap.data()?.revision || 0) + 1, 1), updatedAt: now, updatedByUid: user.uid,
    }, { merge: true });
    tx.set(transactionRef, {
      deleted: true,
      deletedAt: now,
      deletedByUid: user.uid,
      deletedBy: user.email || user.uid,
      revision: Math.max(Number(current.revision || 0) + 1, 1),
      updatedAt: now,
      updatedByUid: user.uid,
    }, { merge: true });
  });
}
