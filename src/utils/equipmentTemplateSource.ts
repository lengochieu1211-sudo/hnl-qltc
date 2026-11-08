import type { InventoryItem } from '../types';
import type { EquipmentCatalogRecord } from '../lib/equipmentCatalog';
import { normalizeUnit, unitKey } from './unitUtils';

/** Read-only picker rows. IDs on legacy rows are UI selection keys, NEVER Firestore document IDs. */
export interface EquipmentTemplateSourceItem {
  id: string;
  name: string;
  displayName: string;
  unit: string;
  category: string;
  brand: string;
  model: string;
  specifications: string;
  notes: string;
  sourceOrigin: 'catalog' | 'voucher';
  hasLegacyVoucher: boolean;
  unitConflict: boolean;
}

const nameKey = (name: string): string => String(name || '').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ');
const active = (row: { deletedAt?: number | null; deleted?: boolean }): boolean => row.deletedAt == null && row.deleted !== true;

/**
 * Build the same full list as EquipmentCatalogPanel: active Cloud master rows PLUS
 * legacy equipment in warehouse vouchers. Never aggregate across different units.
 * No side effects, no stock writes, no ID or unit migration.
 */
export function buildEquipmentTemplateSourceItems(
  catalog: Array<Partial<EquipmentCatalogRecord> & { deleted?: boolean }>,
  vouchers: Array<Partial<InventoryItem> & { deleted?: boolean }>,
): EquipmentTemplateSourceItem[] {
  const byIdentity = new Map<string, EquipmentTemplateSourceItem>();
  // Never revive a soft-deleted Cloud identity through an old voucher.
  const deletedCatalogNames = new Set(catalog.filter(row => !active(row)).map(row => nameKey(String(row.name || ''))));
  const pairKey = (name: string, unit: string): string => `${nameKey(name)}\u0000${unitKey(unit)}`;

  for (const row of catalog) {
    if (!active(row)) continue;
    const name = String(row.name || '').trim();
    const unit = normalizeUnit(row.unit) || String(row.unit || '').trim();
    if (!name || !unit) continue;
    const key = pairKey(name, unit);
    if (byIdentity.has(key)) continue;
    byIdentity.set(key, {
      id: String(row.id || `master:${encodeURIComponent(key)}`),
      name, displayName: String(row.displayName || name).trim(), unit,
      category: String(row.category || 'Thiết bị'), brand: String(row.brand || ''),
      model: String(row.model || ''), specifications: String(row.specifications || ''),
      notes: String(row.notes || ''), sourceOrigin: 'catalog', hasLegacyVoucher: false, unitConflict: false,
    });
  }

  for (const row of vouchers) {
    if (!active(row) || row.itemKind !== 'equipment') continue;
    const name = String(row.materialName || '').trim();
    const unit = normalizeUnit(row.unit) || String(row.unit || '').trim();
    if (!name || !unit || deletedCatalogNames.has(nameKey(name))) continue;
    const key = pairKey(name, unit);
    const existing = byIdentity.get(key);
    if (existing) {
      existing.hasLegacyVoucher = true;
      continue;
    }
    byIdentity.set(key, {
      // Only local picker identity. saveEquipmentCatalogBatch creates the canonical ID.
      id: `legacy:${encodeURIComponent(nameKey(name))}:${encodeURIComponent(unitKey(unit))}`,
      name, displayName: name, unit, category: 'Thiết bị', brand: '', model: '',
      specifications: '', notes: '', sourceOrigin: 'voucher', hasLegacyVoucher: true, unitConflict: false,
    });
  }

  const variants = new Map<string, Set<string>>();
  for (const row of byIdentity.values()) {
    const key = nameKey(row.name);
    const units = variants.get(key) || new Set<string>();
    units.add(unitKey(row.unit));
    variants.set(key, units);
  }
  return Array.from(byIdentity.values())
    .map(row => ({ ...row, unitConflict: (variants.get(nameKey(row.name))?.size || 0) > 1 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' })
      || a.unit.localeCompare(b.unit, 'vi', { numeric: true }));
}
