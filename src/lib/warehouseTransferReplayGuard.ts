/**
 * Compare retries of a cross-project transfer before treating a duplicate ID
 * as idempotent. An ID collision is not a successful replay if payload differs.
 */
import type { InventoryItem } from '../types';

type Snapshot = Record<string, unknown>;
type Context = { fromProjectId: string; toProjectId: string; transferId: string };

export function isExactWarehouseTransferReplay(
  outgoing: Snapshot,
  incoming: Snapshot,
  requested: InventoryItem,
  context: Context,
  sameUnit: (a: string, b: string) => boolean,
): boolean {
  const kind = requested.itemKind === 'equipment' ? 'equipment' : 'material';
  const materialId = requested.materialId || null;
  const name = requested.materialName.trim();
  if (typeof outgoing.unit !== 'string' || typeof incoming.unit !== 'string' ||
    !Number.isFinite(requested.quantity) || requested.quantity <= 0) return false;
  return outgoing.deleted !== true && outgoing.deletedAt == null &&
    outgoing.id === requested.id && outgoing.type === 'out' &&
    outgoing.sourceType === 'project-transfer-out' &&
    outgoing.warehouseTransferId === context.transferId &&
    outgoing.transferToProjectId === context.toProjectId &&
    outgoing.quantity === requested.quantity &&
    outgoing.date === requested.date && incoming.date === requested.date &&
    (outgoing.handler || '') === (requested.handler || '') &&
    (incoming.handler || '') === (requested.handler || '') &&
    (outgoing.notes || '') === (requested.notes || '') &&
    (incoming.notes || '') === (requested.notes || '') &&
    (outgoing.itemKind || 'material') === kind &&
    outgoing.materialName === name &&
    (outgoing.materialId || null) === materialId &&
    sameUnit(outgoing.unit, requested.unit) &&
    incoming.id === context.transferId &&
    incoming.fromProjectId === context.fromProjectId &&
    incoming.toProjectId === context.toProjectId &&
    incoming.sourceTransactionId === requested.id &&
    incoming.quantity === requested.quantity &&
    incoming.itemKind === kind &&
    incoming.materialName === name &&
    (incoming.originalMaterialId || null) === materialId &&
    sameUnit(incoming.unit, requested.unit) &&
    (incoming.status === 'pending' || incoming.status === 'received');
}

export function isExactWarehouseReceiptReplay(
  receipt: Snapshot,
  incoming: Snapshot,
  mapping: { materialName: string; unit: string; materialId?: string },
  transferId: string,
  receiptId: string,
  sameUnit: (a: string, b: string) => boolean,
): boolean {
  return incoming.status === 'received' && incoming.receiptId === receiptId &&
    receipt.deleted !== true && receipt.deletedAt == null &&
    receipt.id === receiptId && receipt.type === 'in' &&
    receipt.sourceType === 'project-transfer-in' &&
    receipt.warehouseTransferId === transferId &&
    receipt.transferFromProjectId === incoming.fromProjectId &&
    receipt.quantity === incoming.quantity &&
    receipt.itemKind === incoming.itemKind &&
    receipt.materialName === mapping.materialName.trim() &&
    (receipt.materialId || null) === (mapping.materialId || null) &&
    typeof receipt.unit === 'string' && sameUnit(receipt.unit, mapping.unit);
}
