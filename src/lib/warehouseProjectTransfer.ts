/**
 * Cross-project warehouse transfer. Source OUT and destination PENDING are created
 * in one Firestore transaction; target IN is posted only upon receiver acceptance.
 * A pending transfer is NOT inventory and therefore does not inflate destination stock.
 * All operations require network; no offline replay/automatic local stock mutation.
 */
import { collection, doc, onSnapshot, runTransaction, type Unsubscribe } from 'firebase/firestore';
import type { InventoryItem, InventoryItemKind } from '../types';
import { db, getCurrentRealFirebaseUser, sanitizePayloadForCloud } from './firebase';
import { getWarehouseMaterialKey } from '../utils/warehouseLedgerMath';
import { areSameUnit, normalizeUnit } from '../utils/unitUtils';
import { isExactWarehouseTransferReplay, isExactWarehouseReceiptReplay } from './warehouseTransferReplayGuard';

export type WarehouseTransferStatus = 'pending' | 'received';
export interface WarehouseIncomingTransfer {
  id: string;
  fromProjectId: string;
  toProjectId: string;
  sourceTransactionId: string;
  itemKind: InventoryItemKind;
  materialName: string;
  originalMaterialId?: string | null;
  unit: string;
  quantity: number;
  date: string;
  handler: string;
  notes: string;
  status: WarehouseTransferStatus;
  createdAt: number;
  createdByUid: string;
  receivedAt?: number;
  receivedByUid?: string;
  receiptId?: string;
}

export interface WarehouseDestinationItem {
  materialName: string;
  unit: string;
  materialId?: string;
}

const safe = <T extends Record<string, unknown>>(value: T): T => sanitizePayloadForCloud(value) as T;
const online = () => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('TRANSFER_OFFLINE_BLOCKED: Điều chuyển kho cần kết nối mạng để bảo đảm tồn kho giữa hai dự án.');
  }
  const user = getCurrentRealFirebaseUser();
  if (!user) throw new Error('TRANSFER_AUTH_REQUIRED: Cần đăng nhập Firebase.');
  return user;
};

/** Deterministic retry key; Firestore doc IDs never contain a slash. */
export function warehouseTransferId(fromProjectId: string, sourceTransactionId: string): string {
  if (!fromProjectId || !sourceTransactionId || fromProjectId.includes('/') || sourceTransactionId.includes('/')) {
    throw new Error('TRANSFER_INVALID_ID');
  }
  return `TR-${fromProjectId}-${sourceTransactionId}`;
}
export const warehouseTransferReceiptId = (transferId: string) => `NK-${transferId}`;

export function assertWarehouseTransferInput(sourceProjectId: string, toProjectId: string, item: InventoryItem): void {
  if (!sourceProjectId || !toProjectId || sourceProjectId === toProjectId || toProjectId.includes('/')) {
    throw new Error('TRANSFER_PROJECT_INVALID: Hãy chọn một dự án khác có quyền ghi.');
  }
  if (item.type !== 'out' || !item.id || !item.materialName.trim() || !item.unit.trim() ||
    !Number.isFinite(item.quantity) || item.quantity <= 0 || !['material', 'equipment'].includes(item.itemKind || 'material')) {
    throw new Error('TRANSFER_ITEM_INVALID: Vật tư, đơn vị hoặc số lượng không hợp lệ.');
  }
}

export async function createWarehouseProjectTransferAtomic(
  fromProjectId: string, toProjectId: string, item: InventoryItem,
): Promise<{ transferId: string; duplicate: boolean }> {
  assertWarehouseTransferInput(fromProjectId, toProjectId, item);
  const user = online();
  const transferId = warehouseTransferId(fromProjectId, item.id);
  const balanceKey = getWarehouseMaterialKey(item);
  const outRef = doc(db, 'projects', fromProjectId, 'inventory', item.id);
  const balanceRef = doc(db, 'projects', fromProjectId, 'inventory_balances', balanceKey);
  const inboxRef = doc(db, 'projects', toProjectId, 'warehouse_incoming', transferId);
  const destinationProjectRef = doc(db, 'projects', toProjectId);
  return runTransaction(db, async (tx) => {
    const [existingOut, balanceSnap, existingInbox, destProject] = await Promise.all([
      tx.get(outRef), tx.get(balanceRef), tx.get(inboxRef), tx.get(destinationProjectRef),
    ]);
    if (!destProject.exists() || destProject.data().deleted === true) {
      throw new Error('TRANSFER_TARGET_INACTIVE: Dự án nhận không tồn tại hoặc đã đóng.');
    }
    if (existingOut.exists() || existingInbox.exists()) {
      if (existingOut.exists() && existingInbox.exists()) {
        if (isExactWarehouseTransferReplay(existingOut.data(), existingInbox.data(), item,
          { fromProjectId, toProjectId, transferId }, areSameUnit)) {
          return { transferId, duplicate: true };
        }
        throw new Error('TRANSFER_RETRY_CONFLICT: Trùng mã phiếu nhưng dữ liệu khác; cần đối soát, không được ghi thêm.');
      }
      throw new Error('TRANSFER_ID_COLLISION: Thiếu chứng từ ở một đầu điều chuyển; cần đối soát.');
    }
    const current = Number(balanceSnap.data()?.onHand || 0);
    if (!Number.isFinite(current) || current < item.quantity - 1e-9) {
      throw new Error(`INSUFFICIENT_STOCK: Tồn nguồn ${current}, cần chuyển ${item.quantity}.`);
    }
    if (balanceSnap.data()?.renamedTo ||
      (item.itemKind !== 'equipment' && balanceSnap.data()?.unit && !areSameUnit(String(balanceSnap.data()?.unit), item.unit))) {
      throw new Error('TRANSFER_UNIT_STALE: Đơn vị đã được đổi. Hãy đồng bộ danh mục rồi thử lại.');
    }
    const now = Date.now();
    tx.set(outRef, safe({
      ...item, id: item.id, type: 'out', itemKind: item.itemKind === 'equipment' ? 'equipment' : 'material',
      issuePurpose: 'external-project', sourceType: 'project-transfer-out',
      warehouseTransferId: transferId, transferToProjectId: toProjectId,
      materialKey: balanceKey, revision: 1, createdAt: now, createdByUid: user.uid,
      updatedAt: now, updatedByUid: user.uid, deleted: false, deletedAt: null,
      deletedByUid: null, deletedBy: null,
    }));
    tx.set(balanceRef, safe({
      id: balanceKey, projectId: fromProjectId,
      itemKind: item.itemKind === 'equipment' ? 'equipment' : 'material',
      materialId: item.materialId || null, materialName: item.materialName, unit: item.unit,
      onHand: Math.max(0, current - item.quantity),
      revision: Math.max(Number(balanceSnap.data()?.revision || 0) + 1, 1),
      updatedAt: now, updatedByUid: user.uid,
    }), { merge: true });
    tx.set(inboxRef, safe({
      id: transferId, fromProjectId, toProjectId, sourceTransactionId: item.id,
      itemKind: item.itemKind === 'equipment' ? 'equipment' : 'material',
      materialName: item.materialName, originalMaterialId: item.materialId || null,
      unit: item.unit, quantity: item.quantity,
      date: item.date, handler: item.handler || '', notes: item.notes || '',
      status: 'pending', createdAt: now, createdByUid: user.uid,
    }));
    return { transferId, duplicate: false };
  });
}

/** Receive is idempotent, atomic and project-local; sender ledger is never replayed. */
export async function receiveWarehouseProjectTransferAtomic(
  toProjectId: string, transferId: string, mapped: WarehouseDestinationItem, handler: string,
): Promise<{ receiptId: string; duplicate: boolean }> {
  const user = online();
  if (!toProjectId || !transferId || transferId.includes('/')) throw new Error('TRANSFER_INVALID_ID');
  if (!mapped.materialName.trim() || !mapped.unit.trim()) throw new Error('TRANSFER_DESTINATION_REQUIRED');
  const inboxRef = doc(db, 'projects', toProjectId, 'warehouse_incoming', transferId);
  const receiptId = warehouseTransferReceiptId(transferId);
  const receiptRef = doc(db, 'projects', toProjectId, 'inventory', receiptId);
  return runTransaction(db, async (tx) => {
    const incomingSnap = await tx.get(inboxRef);
    if (!incomingSnap.exists()) throw new Error('TRANSFER_NOT_FOUND');
    const incoming = incomingSnap.data() as WarehouseIncomingTransfer;
    if (incoming.toProjectId !== toProjectId || !Number.isFinite(incoming.quantity) || incoming.quantity <= 0) {
      throw new Error('TRANSFER_INBOX_INVALID');
    }
    if (!areSameUnit(incoming.unit, mapped.unit)) {
      throw new Error('TRANSFER_UNIT_MISMATCH: Đơn vị nhận không khớp. Không tự quy đổi.');
    }
    const existingReceipt = await tx.get(receiptRef);
    if (incoming.status === 'received') {
      if (incoming.receiptId === receiptId && existingReceipt.exists() &&
        isExactWarehouseReceiptReplay(existingReceipt.data(), incoming, mapped,
          transferId, receiptId, areSameUnit)) {
        return { receiptId, duplicate: true };
      }
      throw new Error('TRANSFER_ALREADY_RECEIVED_CONFLICT');
    }
    if (incoming.status !== 'pending' || existingReceipt.exists()) throw new Error('TRANSFER_RECEIPT_CONFLICT');
    const received: InventoryItem = {
      id: receiptId, type: 'in', itemKind: incoming.itemKind,
      ...(incoming.itemKind === 'material' && mapped.materialId ? { materialId: mapped.materialId } : {}),
      materialName: mapped.materialName.trim(), unit: normalizeUnit(mapped.unit) || mapped.unit,
      quantity: incoming.quantity, date: new Date().toISOString().slice(0, 10),
      handler: handler.trim(), location: 'Kho dự án nhận',
      notes: `Nhập điều chuyển từ dự án ${incoming.fromProjectId}, phiếu ${incoming.sourceTransactionId}. ${incoming.notes}`.trim(),
      sourceType: 'project-transfer-in', warehouseTransferId: transferId,
      transferFromProjectId: incoming.fromProjectId,
    };
    const balanceKey = getWarehouseMaterialKey(received);
    const balanceRef = doc(db, 'projects', toProjectId, 'inventory_balances', balanceKey);
    const balanceSnap = await tx.get(balanceRef);
    if (balanceSnap.data()?.renamedTo ||
      (incoming.itemKind !== 'equipment' && balanceSnap.data()?.unit && !areSameUnit(String(balanceSnap.data()?.unit), mapped.unit))) {
      throw new Error('TRANSFER_DESTINATION_UNIT_STALE');
    }
    // Preserve an existing destination balance's exact unit spelling. Changing
    // 'tấm' to 'Tấm' (or m2 to m²) during an operational receipt would rewrite
    // catalog identity and correctly be rejected by EDITOR Firestore Rules.
    // A unit migration remains ADMIN-owned; no conversion is performed here.
    const existingUnit = balanceSnap.data()?.unit;
    if (typeof existingUnit === 'string' && existingUnit.length > 0) {
      received.unit = existingUnit;
    }
    // Existing destination balance owns its unit label. A spelling-only
    // normalization (e.g. "tấm" -> "Tấm") must not rewrite EDITOR-locked
    // identity fields and must not cause a permission-denied on receipt.
    const storedUnit = balanceSnap.data()?.unit;
    const destinationUnit = typeof storedUnit === 'string' && storedUnit.trim()
      ? storedUnit : received.unit;
    const now = Date.now();
    const nextOnHand = Number(balanceSnap.data()?.onHand || 0) + incoming.quantity;
    if (!Number.isFinite(nextOnHand)) throw new Error('TRANSFER_BALANCE_INVALID');
    tx.set(receiptRef, safe({ ...received, unit: destinationUnit, materialKey: balanceKey, revision: 1,
      createdAt: now, createdByUid: user.uid, updatedAt: now, updatedByUid: user.uid,
      deleted: false, deletedAt: null, deletedByUid: null, deletedBy: null,
    }));
    tx.set(balanceRef, safe({
      id: balanceKey, projectId: toProjectId, itemKind: incoming.itemKind,
      materialId: received.materialId || null, materialName: received.materialName, unit: destinationUnit,
      onHand: nextOnHand, revision: Math.max(Number(balanceSnap.data()?.revision || 0) + 1, 1),
      updatedAt: now, updatedByUid: user.uid,
    }), { merge: true });
    tx.update(inboxRef, { status: 'received', receiptId, receivedAt: now, receivedByUid: user.uid });
    return { receiptId, duplicate: false };
  });
}

export function subscribeIncomingWarehouseTransfers(
  projectId: string, onData: (items: WarehouseIncomingTransfer[]) => void, onError: (error: Error) => void,
): Unsubscribe {
  if (!projectId) { onData([]); return () => {}; }
  return onSnapshot(collection(db, 'projects', projectId, 'warehouse_incoming'), (snapshot) => {
    const rows = snapshot.docs.map((snap) => ({ ...snap.data(), id: snap.id } as WarehouseIncomingTransfer))
      .filter((row) => row.toProjectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt);
    onData(rows);
  }, (error) => onError(error));
}
