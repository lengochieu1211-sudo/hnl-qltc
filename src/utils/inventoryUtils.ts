import { InventoryItem, MaterialNorm } from '../types';
import { parseExcelNumber } from './numberUtils';
import { normalizeUnit } from './unitUtils';
import { createEntityId } from './idUtils';



export function normalizeMaterialNameKey(value?: string): string {
  return String(value || '').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ');
}

/**
 * Resolve one stable material ID without confusing MaterialNorm.id (the norm row)
 * with materialId (the material identity). Legacy norms get a deterministic alias.
 */
export function resolveNormMaterialId(norm?: Partial<MaterialNorm> | null): string | undefined {
  if (!norm) return undefined;
  if (norm.materialId) return String(norm.materialId);
  if (norm.id) return `MAT-${String(norm.id)}`;
  return undefined;
}

export function getMaterialIdentityKey(materialId?: string, materialName?: string, unit?: string): string {
  if (materialId) return `id:${String(materialId)}`;
  const name = normalizeMaterialNameKey(materialName);
  const normalizedUnit = normalizeUnit(unit || '') || String(unit || '').trim().toLocaleLowerCase('vi-VN');
  return `name:${name}|unit:${normalizedUnit}`;
}

export function buildMaterialAliasMap(materialNorms: MaterialNorm[] = []): Map<string, string> {
  const aliases = new Map<string, string>();
  materialNorms.forEach((norm) => {
    const resolved = resolveNormMaterialId(norm);
    if (!resolved) return;
    aliases.set(resolved, resolved);
    if (norm.materialId) aliases.set(String(norm.materialId), resolved);
    if (norm.id) aliases.set(String(norm.id), resolved); // legacy inventory may have stored norm.id
  });
  return aliases;
}

export interface MaterialStockSummary {
  materialId?: string;
  materialName: string;
  category: string;
  unit: string;
  totalIn: number;
  totalOut: number;
  currentStock: number;
  normQuantity: number;
  remainingNeed: number;
  status: 'Dư / Đủ hàng' | 'Thiếu so với nhu cầu' | 'Vượt nhu cầu theo định mức' | 'Hết hàng';
  statusSeverity: 'normal' | 'warning' | 'danger' | 'over_norm';
}

/**
 * Single unified stock calculation function used across UI and Excel exports.
 */
export function calculateStockSummary(
  inventory: InventoryItem[] = [],
  materialNorms: MaterialNorm[] = []
): MaterialStockSummary[] {
  const aliasMap = buildMaterialAliasMap(materialNorms);
  const stockMap: Record<string, {
    materialId?: string;
    materialName: string;
    unit: string;
    category: string;
    totalIn: number;
    totalOut: number;
  }> = {};

  materialNorms.forEach((norm) => {
    const materialId = resolveNormMaterialId(norm);
    const key = getMaterialIdentityKey(materialId, norm.materialName, norm.unit);
    if (!stockMap[key]) {
      stockMap[key] = {
        materialId,
        materialName: norm.materialName,
        unit: normalizeUnit(norm.unit) || norm.unit,
        category: norm.category || 'Vật tư',
        totalIn: 0,
        totalOut: 0,
      };
    }
  });

  inventory.forEach((item) => {
    const aliasedId = item.materialId ? (aliasMap.get(String(item.materialId)) || String(item.materialId)) : undefined;
    let key = getMaterialIdentityKey(aliasedId, item.materialName, item.unit);

    // Legacy transactions without materialId are attached only when both name + unit match.
    if (!aliasedId) {
      const name = normalizeMaterialNameKey(item.materialName);
      const unit = normalizeUnit(item.unit) || item.unit;
      const matchedNorm = materialNorms.find((norm) =>
        normalizeMaterialNameKey(norm.materialName) === name &&
        (normalizeUnit(norm.unit) || norm.unit) === unit
      );
      if (matchedNorm) {
        const resolved = resolveNormMaterialId(matchedNorm);
        key = getMaterialIdentityKey(resolved, matchedNorm.materialName, matchedNorm.unit);
      }
    }

    if (!stockMap[key]) {
      stockMap[key] = {
        materialId: aliasedId,
        materialName: item.materialName,
        unit: normalizeUnit(item.unit) || item.unit,
        category: 'Vật tư',
        totalIn: 0,
        totalOut: 0,
      };
    }
    if (item.type === 'in') stockMap[key].totalIn += Number(item.quantity) || 0;
    else stockMap[key].totalOut += Number(item.quantity) || 0;
  });

  return Object.values(stockMap).map((m) => {
    const matchingNorms = materialNorms.filter((n) => {
      const resolved = resolveNormMaterialId(n);
      if (m.materialId && resolved === m.materialId) return true;
      return normalizeMaterialNameKey(n.materialName) === normalizeMaterialNameKey(m.materialName)
        && (normalizeUnit(n.unit) || n.unit) === (normalizeUnit(m.unit) || m.unit);
    });
    const norm = matchingNorms[0];

    // One physical material may legitimately have several norm rows (for example the
    // same board used by two different work categories). Warehouse demand must sum all
    // of those linked quotas instead of silently using only the first matching row.
    const normQty = matchingNorms.reduce((sum, item) => sum + (Number(item.quotaQuantity) || 0), 0);
    const currentStock = m.totalIn - m.totalOut;
    const remainingNeed = Math.max(0, normQty - m.totalOut);

    let status: MaterialStockSummary['status'] = 'Dư / Đủ hàng';
    let statusSeverity: MaterialStockSummary['statusSeverity'] = 'normal';
    if (m.totalOut > normQty && normQty > 0) {
      status = 'Vượt nhu cầu theo định mức';
      statusSeverity = 'over_norm';
    } else if (currentStock <= 0) {
      status = 'Hết hàng';
      statusSeverity = 'danger';
    } else if (currentStock < remainingNeed) {
      status = 'Thiếu so với nhu cầu';
      statusSeverity = 'warning';
    }

    return {
      materialId: m.materialId || resolveNormMaterialId(norm),
      materialName: m.materialName,
      category: m.category || norm?.category || 'Vật tư',
      unit: normalizeUnit(m.unit || norm?.unit || 'Tấm') || (m.unit || norm?.unit || 'Tấm'),
      totalIn: m.totalIn,
      totalOut: m.totalOut,
      currentStock,
      normQuantity: normQty,
      remainingNeed,
      status,
      statusSeverity,
    };
  });
}

/**
 * Standardized parser for Inventory Transactions from Excel rows.
 */
export function parseInventoryExcel(rows: any[]): Partial<InventoryItem>[] {
  const result: Partial<InventoryItem>[] = [];
  if (!Array.isArray(rows)) return result;

  rows.forEach((r, idx) => {
    if (!r || typeof r !== 'object') return;
    const materialName = r['Tên Vật Tư'] || r['Tên vật tư'] || r['Vật tư'] || r['materialName'] || r['Material Name'] || '';
    if (!materialName || String(materialName).trim() === '' || String(materialName).trim().startsWith('---')) return;

    const rawType = String(r['Loại Phiếu'] || r['Loại phiếu'] || r['type'] || r['Loại'] || '').toLowerCase();
    const type: 'in' | 'out' = rawType.includes('xuất') || rawType.includes('out') ? 'out' : 'in';

    const rawQty = r['Số Lượng'] || r['Số lượng'] || r['quantity'] || r['SL'] || 0;
    const quantity = Math.abs(parseExcelNumber(rawQty));

    const unit = String(r['Đơn Vị Tính'] || r['Đơn vị tính'] || r['ĐVT'] || r['unit'] || 'Tấm').trim();
    const location = String(r['Vị Trí Lưu Kho / Hạng Mục'] || r['Vị trí'] || r['location'] || r['Kho'] || 'Kho chính').trim();
    const handler = String(r['Người Thực Hiện'] || r['Người nhận/giao'] || r['handler'] || '-').trim();
    const dateStr = String(r['Ngày Lập Phiếu'] || r['Ngày'] || r['date'] || new Date().toISOString().split('T')[0]).trim();
    const id = r['Mã Phiếu'] || r['__recordId'] || r['id'] || createEntityId('INV');
    const materialId = r['__materialId'] || r['materialId'] || undefined;

    result.push({
      id: String(id),
      materialId: materialId ? String(materialId) : undefined,
      materialName: String(materialName).trim(),
      type,
      quantity,
      unit,
      location,
      handler,
      date: dateStr,
      notes: r['Ghi Chú'] || r['Ghi chú'] || r['notes'] || '',
      sourceType: r['__sourceType'] || r['sourceType'] || undefined,
      sourceRoomId: r['__sourceRoomId'] || r['sourceRoomId'] || undefined,
      sourceFloorId: r['__sourceFloorId'] || r['sourceFloorId'] || undefined,
      sourceNormId: r['__sourceNormId'] || r['sourceNormId'] || undefined,
      sourceIssueKey: r['__sourceIssueKey'] || r['sourceIssueKey'] || undefined
    });
  });

  return result;
}

/**
 * Standardized parser for Material Norms from Excel rows.
 */
export function parseMaterialNormExcel(rows: any[]): Partial<MaterialNorm>[] {
  const result: Partial<MaterialNorm>[] = [];
  if (!Array.isArray(rows)) return result;

  rows.forEach((r, idx) => {
    if (!r || typeof r !== 'object') return;
    const materialName = r['Tên Vật Tư'] || r['Tên vật tư'] || r['materialName'] || '';
    if (!materialName || String(materialName).trim() === '' || String(materialName).trim().startsWith('---')) return;

    const rawQuota = r['Số Lượng Định Mức'] || r['Số lượng định mức'] || r['quotaQuantity'] || 0;
    const quotaQuantity = parseExcelNumber(rawQuota);

    const rawUnitNorm = r['Định Mức Tiêu Hao (1m2)'] || r['unitNormPerM2'] || 0;
    const unitNormPerM2 = parseExcelNumber(rawUnitNorm);

    const category = String(r['Phân Loại'] || r['Phân loại'] || r['category'] || 'Thạch cao').trim();
    const workCatStr = String(r['Tên Hạng Mục Thi Công'] || r['Hạng mục'] || r['workCategory'] || '').trim();
    const unit = String(r['Đơn Vị Tính'] || r['ĐVT'] || r['unit'] || 'Tấm').trim();
    const notes = String(r['Ghi Chú'] || r['Ghi chú'] || r['notes'] || '').trim();
    const id = r['__normId'] || r['id'] || createEntityId('NORM');
    const materialId = r['__materialId'] || r['materialId'] || undefined;

    result.push({
      id: String(id),
      materialId: materialId ? String(materialId) : `MAT-${String(id)}`,
      materialName: String(materialName).trim(),
      category,
      workCategory: workCatStr,
      unit,
      quotaQuantity,
      unitNormPerM2,
      normBasisUnit: r['ĐVT Khối Lượng Nguồn'] || r['Đơn Vị Khối Lượng Nguồn'] || r['normBasisUnit'] || undefined,
      notes
    });
  });

  return result;
}

