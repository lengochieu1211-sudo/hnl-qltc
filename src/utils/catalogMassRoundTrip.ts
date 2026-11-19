import type { MaterialNorm } from '../types';
import { normalizeUnit } from './unitUtils';
import { normalizeLinkText } from './linkageIntegrity';
import { parseOrderWeight } from './warehouseCatalogOrder';

/** Legacy Excel files without the new column must never clear existing mass. */
export function readCatalogMassFromExcel(raw: unknown, previous: number | null | undefined, line: number): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') return previous ?? null;
  const value = parseOrderWeight(String(raw).trim());
  if (value === null || value <= 0 || value > 1e12) {
    throw new Error(`Dòng ${line}: KL/đơn vị (kg) phải là số dương hợp lệ (ví dụ 0,65).`);
  }
  return value;
}

/** Conflicting nonblank masses for one material+unit cannot be silently used in orders. */
export function assertConsistentMaterialCatalogMass(norms: ReadonlyArray<Pick<MaterialNorm, 'materialName' | 'unit' | 'kgPerUnit' | 'deletedAt'>>): void {
  const byKey = new Map<string, { label: string; weights: Set<number> }>();
  for (const norm of norms) {
    if (norm.deletedAt != null || !norm.materialName || !norm.unit || norm.kgPerUnit == null) continue;
    const key = `${normalizeLinkText(norm.materialName)}|${normalizeLinkText(normalizeUnit(norm.unit) || norm.unit)}`;
    const entry = byKey.get(key) || { label: `${norm.materialName} (${norm.unit})`, weights: new Set<number>() };
    entry.weights.add(norm.kgPerUnit);
    byKey.set(key, entry);
    if (entry.weights.size > 1) throw new Error(`KL/đơn vị của “${entry.label}” không thống nhất giữa các định mức. Hãy kiểm tra trước khi lưu.`);
  }
}
