import type { WarehouseOrderItem, WarehouseOrderValues } from './warehouseCatalogOrder';

/** Master weight is a fallback only; a manually saved order weight always wins.
 * Never write the fallback to the order draft or inventory ledger automatically. */
export function effectiveOrderMass(item: Pick<WarehouseOrderItem, 'kgPerUnit'>, draft?: WarehouseOrderValues): number | null {
  const manual = draft?.kgPerUnit;
  if (typeof manual === 'number' && Number.isFinite(manual) && manual > 0) return manual;
  const catalog = item.kgPerUnit;
  return typeof catalog === 'number' && Number.isFinite(catalog) && catalog > 0 ? catalog : null;
}

/** Duplicate norms may refer to the same physical product. Refuse conflicting mass. */
export function consistentCatalogMass(values: Array<number | null | undefined>): number | null {
  const distinct = new Set(values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0));
  return distinct.size === 1 ? [...distinct][0] : null;
}
