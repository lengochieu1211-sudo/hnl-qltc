import type { InventoryItem, MaterialNorm } from '../types';
import type { EquipmentCatalogRecord } from '../lib/equipmentCatalog';
import { normalizeMaterialNameKey, resolveNormMaterialId } from './inventoryUtils';
import { unitKey } from './unitUtils';

export type WarehouseNameRef = Pick<InventoryItem, 'itemKind' | 'materialId' | 'materialName' | 'unit'>;
export type EquipmentNameRecord = Pick<EquipmentCatalogRecord, 'id' | 'name' | 'displayName' | 'deletedAt'>;
const register = (map: Map<string, string | null>, key: string, value: string) => {
  if (!map.has(key)) map.set(key, value);
  else if (map.get(key) !== value) map.set(key, null);
};
const pair = (a: string, b: string) => JSON.stringify([a, b]);

/** Project-scoped presentation only: never feed display copies into ledger,
 * transaction, import, restore, transfer or edit payloads. */
export function createWarehouseDisplayNames(
  norms: readonly MaterialNorm[] = [],
  equipment: readonly EquipmentNameRecord[] = [],
) {
  const materialLabels = new Map<string, string | null>();
  const materialAliases = new Map<string, string | null>();
  const materialNames = new Map<string, string | null>();
  for (const norm of norms) {
    if (norm.deletedAt != null) continue;
    const id = resolveNormMaterialId(norm);
    const unit = unitKey(norm.unit);
    const label = String(norm.materialName || '').trim();
    if (!id || !unit || !label) continue;
    register(materialLabels, pair(id, unit), label);
    register(materialNames, pair(normalizeMaterialNameKey(label), unit), id);
    for (const alias of new Set([id, norm.id, 'MAT-' + norm.id])) {
      if (alias) register(materialAliases, pair(alias, unit), id);
    }
  }
  const equipmentIds = new Map<string, string | null>();
  const equipmentLabels = new Map<string, string | null>();
  for (const row of equipment) {
    if (row.deletedAt != null) continue;
    const key = normalizeMaterialNameKey(row.name);
    const label = String(row.displayName || row.name || '').trim();
    if (!key || !row.id || !label) continue;
    register(equipmentIds, key, row.id);
    register(equipmentLabels, key, label);
  }
  const materialIdFor = (item: WarehouseNameRef): string | undefined => {
    const unit = unitKey(item.unit);
    if (!unit) return undefined;
    const explicit = String(item.materialId || '').trim();
    if (explicit) {
      const key = pair(explicit, unit);
      return materialAliases.has(key) ? materialAliases.get(key) || undefined : explicit;
    }
    // No guessing a historical rename without an authoritative identity.
    return materialNames.get(pair(normalizeMaterialNameKey(item.materialName), unit)) || undefined;
  };
  const forItem = (item: WarehouseNameRef): string => {
    if (item.itemKind === 'equipment') {
      const key = normalizeMaterialNameKey(item.materialName);
      return (equipmentIds.get(key) && equipmentLabels.get(key)) || item.materialName;
    }
    const id = materialIdFor(item);
    return (id && materialLabels.get(pair(id, unitKey(item.unit)))) || item.materialName;
  };
  const sameIdentity = (a: WarehouseNameRef, b: WarehouseNameRef): boolean => {
    const aEquipment = a.itemKind === 'equipment';
    const bEquipment = b.itemKind === 'equipment';
    if (aEquipment !== bEquipment || unitKey(a.unit) !== unitKey(b.unit)) return false;
    if (aEquipment) return normalizeMaterialNameKey(a.materialName) === normalizeMaterialNameKey(b.materialName);
    const aId = materialIdFor(a), bId = materialIdFor(b);
    if (aId || bId) return Boolean(aId && bId && aId === bId);
    return !a.materialId && !b.materialId
      && normalizeMaterialNameKey(a.materialName) === normalizeMaterialNameKey(b.materialName);
  };
  const forPresentation = <T extends WarehouseNameRef>(item: T): T => {
    const materialName = forItem(item);
    return materialName === item.materialName ? item : { ...item, materialName };
  };
  return { forItem, materialIdFor, sameIdentity, forPresentation };
}
