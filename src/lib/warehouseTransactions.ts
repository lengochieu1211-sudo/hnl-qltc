import { collection, doc, getDocFromServer, getDocsFromServer, runTransaction } from 'firebase/firestore';
import type { InventoryItem } from '../types';
import { db, getCurrentRealFirebaseUser, sanitizePayloadForCloud } from './firebase';
import { calculateWarehouseLedgerOnHand, getWarehouseMaterialKey, getWarehouseSignedDelta, type WarehouseLedgerItem } from '../utils/warehouseLedgerMath';

export { getWarehouseMaterialKey } from '../utils/warehouseLedgerMath';

export interface WarehouseBalanceRecord {
  id: string;
  projectId: string;
  itemKind?: 'material' | 'equipment';
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

function assertOnlineForStrictStock(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('STRICT_STOCK_OFFLINE_BLOCKED: Xuất/chỉnh/xóa giao dịch kho cần online để khóa tồn kho an toàn giữa nhiều thiết bị.');
  }
}

function sanitizeWarehouseWritePayload<T extends Record<string, unknown>>(payload: T): T {
  // Warehouse atomic transactions bypass the generic project-diff writer, so they must
  // apply the same Cloud payload sanitation themselves. Firestore rejects any undefined
  // field (for example blank Excel notes/source metadata) inside Transaction.set().
  // RC2.2.26.6 keeps optional Excel/import metadata Firestore-safe across Web/EXE/APK; exact-head CI certifies all wrappers.
  return sanitizePayloadForCloud(payload) as T;
}

function signedDelta(item: Pick<InventoryItem, 'type' | 'quantity'>): number {
  try {
    return getWarehouseSignedDelta(item);
  } catch {
    throw new Error('Số lượng kho phải lớn hơn 0.');
  }
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
    tx.set(transactionRef, sanitizeWarehouseWritePayload({
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
    }), { merge: true });

    tx.set(balanceRef, sanitizeWarehouseWritePayload({
      id: materialKey,
      projectId,
      itemKind: item.itemKind === 'equipment' ? 'equipment' : 'material',
      materialId: item.materialId || null,
      materialName: item.materialName,
      unit: item.unit,
      onHand: Math.max(0, nextOnHand),
      revision: Math.max(Number(balanceSnap.data()?.revision || 0) + 1, 1),
      updatedAt: now,
      updatedByUid: user.uid,
    }), { merge: true });

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
      tx.set(oldBalanceRef, sanitizeWarehouseWritePayload({
        ...oldBalanceSnap.data(), id: oldKey, projectId, onHand: Math.max(0, sameKeyFinal),
        revision: Math.max(Number(oldBalanceSnap.data()?.revision || 0) + 1, 1), updatedAt: now, updatedByUid: user.uid,
      }), { merge: true });
    } else {
      tx.set(oldBalanceRef, sanitizeWarehouseWritePayload({
        ...oldBalanceSnap.data(), id: oldKey, projectId, onHand: Math.max(0, reversedOld),
        revision: Math.max(Number(oldBalanceSnap.data()?.revision || 0) + 1, 1), updatedAt: now, updatedByUid: user.uid,
      }), { merge: true });
      tx.set(newBalanceRef, sanitizeWarehouseWritePayload({
        id: newKey, projectId, itemKind: nextItem.itemKind === 'equipment' ? 'equipment' : 'material', materialId: nextItem.materialId || null, materialName: nextItem.materialName, unit: nextItem.unit,
        onHand: Math.max(0, newKeyFinal), revision: Math.max(Number(newBalanceSnap.data()?.revision || 0) + 1, 1),
        updatedAt: now, updatedByUid: user.uid,
      }), { merge: true });
    }

    tx.set(transactionRef, sanitizeWarehouseWritePayload({
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
    }), { merge: true });

    return {
      transactionId,
      materialKey: newKey,
      onHand: Math.max(0, oldKey === newKey ? sameKeyFinal : newKeyFinal),
      duplicate: false,
    };
  });
}

const BALANCE_EPSILON = 1e-9;

function balanceSnapshotFingerprint(snap: { exists(): boolean; data(): any }): string {
  if (!snap.exists()) return 'missing';
  const data = snap.data() || {};
  return [
    Number(data.onHand || 0),
    Number(data.revision || 0),
    Number(data.updatedAt || 0),
  ].join('|');
}

/**
 * Rebuild exactly one derived inventory_balances row from the server ledger.
 * This is a compatibility repair for legacy inventory rows created before
 * inventory_balances existed or before those rows were backfilled.
 *
 * The ledger remains authoritative. Reconciliation never edits inventory rows,
 * never invents stock and never clamps a genuinely negative ledger to zero.
 */
export async function reconcileWarehouseBalanceFromLedger(
  projectId: string,
  materialKey: string,
  seedItem: InventoryItem,
): Promise<number> {
  assertOnlineForStrictStock();
  const user = getCurrentRealFirebaseUser();
  if (!user) throw new Error('Cần đăng nhập Firebase để đối chiếu tồn kho.');
  if (!projectId || !materialKey) throw new Error('Thiếu projectId/materialKey để đối chiếu tồn kho.');

  const balanceRef = doc(db, 'projects', projectId, 'inventory_balances', materialKey);
  const inventoryRef = collection(db, 'projects', projectId, 'inventory');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [ledgerSnap, observedBalanceSnap] = await Promise.all([
      getDocsFromServer(inventoryRef),
      getDocFromServer(balanceRef),
    ]);
    const ledgerRows = ledgerSnap.docs.map((row) => ({ id: row.id, ...row.data() })) as WarehouseLedgerItem[];
    const ledgerOnHand = calculateWarehouseLedgerOnHand(ledgerRows, materialKey);
    if (ledgerOnHand < -BALANCE_EPSILON) {
      throw new Error(`INVENTORY_LEDGER_NEGATIVE: Ledger nguồn của ${seedItem.materialName} đang âm (${ledgerOnHand}). Cần audit dữ liệu trước khi sửa/xóa.`);
    }

    const observedFingerprint = balanceSnapshotFingerprint(observedBalanceSnap);
    try {
      await runTransaction(db, async (tx) => {
        const currentBalanceSnap = await tx.get(balanceRef);
        if (balanceSnapshotFingerprint(currentBalanceSnap) !== observedFingerprint) {
          throw new Error('INVENTORY_RECONCILE_RETRY: Tồn kho vừa thay đổi trên thiết bị khác.');
        }
        const current = currentBalanceSnap.data() || {};
        const now = Date.now();
        tx.set(balanceRef, sanitizeWarehouseWritePayload({
          ...current,
          id: materialKey,
          projectId,
          itemKind: seedItem.itemKind === 'equipment' ? 'equipment' : 'material',
          materialId: seedItem.materialId || null,
          materialName: seedItem.materialName,
          unit: seedItem.unit,
          onHand: Math.max(0, ledgerOnHand),
          revision: Math.max(Number(current.revision || 0) + 1, 1),
          updatedAt: now,
          updatedByUid: user.uid,
        }), { merge: true });
      });
      return Math.max(0, ledgerOnHand);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      if (message.includes('INVENTORY_RECONCILE_RETRY') && attempt < 2) continue;
      throw error;
    }
  }

  throw new Error('INVENTORY_RECONCILE_BUSY: Tồn kho thay đổi liên tục. Hãy chờ đồng bộ rồi thử lại.');
}

async function softDeleteWarehouseTransactionAtomicOnce(projectId: string, transactionId: string): Promise<void> {
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
    if (nextOnHand < -BALANCE_EPSILON) {
      throw new Error('INVENTORY_LEDGER_INCONSISTENT: Derived balance không khớp ledger; cần đối chiếu legacy balance trước khi xóa.');
    }
    const now = Date.now();

    tx.set(balanceRef, sanitizeWarehouseWritePayload({
      ...balanceSnap.data(),
      id: materialKey,
      projectId,
      itemKind: current.itemKind === 'equipment' ? 'equipment' : 'material',
      materialId: current.materialId || null,
      materialName: current.materialName,
      unit: current.unit,
      onHand: Math.max(0, nextOnHand),
      revision: Math.max(Number(balanceSnap.data()?.revision || 0) + 1, 1),
      updatedAt: now,
      updatedByUid: user.uid,
    }), { merge: true });
    tx.set(transactionRef, sanitizeWarehouseWritePayload({
      deleted: true,
      deletedAt: now,
      deletedByUid: user.uid,
      deletedBy: user.email || user.uid,
      revision: Math.max(Number(current.revision || 0) + 1, 1),
      updatedAt: now,
      updatedByUid: user.uid,
    }), { merge: true });
  });
}

/**
 * Soft delete only. Normal balances use one atomic reversal. If a legacy row is
 * still present while its derived balance was never backfilled, do one guarded
 * server-ledger reconciliation and retry. Genuine negative ledgers remain blocked.
 */
export async function softDeleteWarehouseTransactionAtomic(projectId: string, transactionId: string): Promise<void> {
  assertOnlineForStrictStock();
  try {
    await softDeleteWarehouseTransactionAtomicOnce(projectId, transactionId);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (!message.includes('INVENTORY_LEDGER_INCONSISTENT')) throw error;
  }

  const transactionRef = doc(db, 'projects', projectId, 'inventory', transactionId);
  const currentSnap = await getDocFromServer(transactionRef);
  if (!currentSnap.exists() || currentSnap.data()?.deleted) return;
  const current = currentSnap.data() as InventoryItem & { materialKey?: string };
  const materialKey = current.materialKey || getWarehouseMaterialKey(current);
  const reconciledOnHand = await reconcileWarehouseBalanceFromLedger(projectId, materialKey, current);

  // An IN reversal can only be valid if the authoritative ledger contains at
  // least that quantity. OUT deletion increases stock and is always non-negative.
  if (current.type === 'in' && reconciledOnHand + BALANCE_EPSILON < Number(current.quantity || 0)) {
    throw new Error(`INVENTORY_LEDGER_NEGATIVE: Ledger nguồn chỉ còn ${reconciledOnHand} ${current.unit}, không đủ đảo phiếu nhập ${current.id} (${current.quantity}).`);
  }

  await softDeleteWarehouseTransactionAtomicOnce(projectId, transactionId);
}
