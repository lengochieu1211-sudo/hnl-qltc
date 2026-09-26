import type { InventoryItem } from '../types';

export type WarehouseLedgerItem = InventoryItem & {
  materialKey?: string;
  deleted?: boolean;
};

function normalizeWarehouseKeyPart(value: unknown): string {
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
 * Stable material key for the derived warehouse balance collection.
 * Legacy rows intentionally remain keyed by name + unit so historical
 * transactions keep aggregating exactly as they did before materialId existed.
 */
export function getWarehouseMaterialKey(
  item: Pick<InventoryItem, 'itemKind' | 'materialId' | 'materialName' | 'unit'>,
): string {
  const itemKind = item.itemKind === 'equipment' ? 'equipment' : 'material';
  if (itemKind === 'equipment') {
    return `equipment-${normalizeWarehouseKeyPart(item.materialName) || 'unknown'}--${normalizeWarehouseKeyPart(item.unit) || 'unit'}`;
  }
  const materialId = normalizeWarehouseKeyPart(item.materialId);
  if (materialId) return `id-${materialId}`;
  return `legacy-${normalizeWarehouseKeyPart(item.materialName) || 'unknown'}--${normalizeWarehouseKeyPart(item.unit) || 'unit'}`;
}

export function isActiveWarehouseLedgerItem(item: WarehouseLedgerItem): boolean {
  return item.deleted !== true && (item.deletedAt === undefined || item.deletedAt === null);
}

export function getWarehouseSignedDelta(item: Pick<InventoryItem, 'type' | 'quantity'>): number {
  const quantity = Number(item.quantity || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`INVENTORY_LEDGER_INVALID_QUANTITY: ${String(item.quantity)}`);
  }
  return item.type === 'in' ? quantity : -quantity;
}

/**
 * Rebuild one derived balance from the immutable inventory ledger.
 * This is intentionally pure so it can be golden-tested without Firebase.
 */
export function calculateWarehouseLedgerOnHand(
  items: readonly WarehouseLedgerItem[],
  materialKey: string,
): number {
  const total = items.reduce((sum, item) => {
    if (!isActiveWarehouseLedgerItem(item)) return sum;
    const key = item.materialKey || getWarehouseMaterialKey(item);
    if (key !== materialKey) return sum;
    return sum + getWarehouseSignedDelta(item);
  }, 0);
  return Math.abs(total) < 1e-9 ? 0 : total;
}
