import { InventoryItem, MaterialNorm } from '../types';

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
  const stockMap: Record<string, {
    materialId?: string;
    materialName: string;
    unit: string;
    category: string;
    totalIn: number;
    totalOut: number;
  }> = {};

  // First seed map with material norms
  materialNorms.forEach(norm => {
    const key = norm.materialId || norm.id || norm.materialName.trim().toLowerCase();
    stockMap[key] = {
      materialId: norm.materialId || norm.id,
      materialName: norm.materialName,
      unit: norm.unit,
      category: norm.category || 'Vật tư',
      totalIn: 0,
      totalOut: 0
    };
  });

  // Accumulate inventory transactions
  inventory.forEach(item => {
    const key = item.materialId ||
      Object.keys(stockMap).find(k => stockMap[k].materialName.trim().toLowerCase() === item.materialName.trim().toLowerCase()) ||
      item.materialName.trim().toLowerCase();

    if (!stockMap[key]) {
      stockMap[key] = {
        materialId: item.materialId,
        materialName: item.materialName,
        unit: item.unit,
        category: 'Vật tư',
        totalIn: 0,
        totalOut: 0
      };
    }

    if (item.type === 'in') {
      stockMap[key].totalIn += item.quantity || 0;
    } else {
      stockMap[key].totalOut += item.quantity || 0;
    }
  });

  return Object.values(stockMap).map(m => {
    const norm = materialNorms.find(n =>
      (m.materialId && (n.materialId === m.materialId || n.id === m.materialId)) ||
      n.materialName.trim().toLowerCase() === m.materialName.trim().toLowerCase()
    );

    const normQty = norm?.quotaQuantity || 0;
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
      materialId: m.materialId || norm?.id,
      materialName: m.materialName,
      category: m.category || norm?.category || 'Vật tư',
      unit: m.unit || norm?.unit || 'Tấm',
      totalIn: m.totalIn,
      totalOut: m.totalOut,
      currentStock,
      normQuantity: normQty,
      remainingNeed,
      status,
      statusSeverity
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
    const quantity = typeof rawQty === 'number' ? Math.abs(rawQty) : Math.abs(parseFloat(String(rawQty).replace(/,/g, '')) || 0);

    const unit = String(r['Đơn Vị Tính'] || r['Đơn vị tính'] || r['ĐVT'] || r['unit'] || 'Tấm').trim();
    const location = String(r['Vị Trí Lưu Kho / Hạng Mục'] || r['Vị trí'] || r['location'] || r['Kho'] || 'Kho chính').trim();
    const handler = String(r['Người Thực Hiện'] || r['Người nhận/giao'] || r['handler'] || '-').trim();
    const dateStr = String(r['Ngày Lập Phiếu'] || r['Ngày'] || r['date'] || new Date().toISOString().split('T')[0]).trim();
    const id = r['Mã Phiếu'] || r['__recordId'] || r['id'] || `inv_${Date.now()}_${idx}`;
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
      notes: r['Ghi Chú'] || r['Ghi chú'] || r['notes'] || ''
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
    const quotaQuantity = typeof rawQuota === 'number' ? rawQuota : (parseFloat(String(rawQuota).replace(/,/g, '')) || 0);

    const rawUnitNorm = r['Định Mức Tiêu Hao (1m2)'] || r['unitNormPerM2'] || 0;
    const unitNormPerM2 = typeof rawUnitNorm === 'number' ? rawUnitNorm : (parseFloat(String(rawUnitNorm).replace(/,/g, '')) || 0);

    const category = String(r['Phân Loại'] || r['Phân loại'] || r['category'] || 'Thạch cao').trim();
    const workCatStr = String(r['Tên Hạng Mục Thi Công'] || r['Hạng mục'] || r['workCategory'] || '').trim();
    const unit = String(r['Đơn Vị Tính'] || r['ĐVT'] || r['unit'] || 'Tấm').trim();
    const notes = String(r['Ghi Chú'] || r['Ghi chú'] || r['notes'] || '').trim();
    const id = r['__normId'] || r['id'] || `norm_${Date.now()}_${idx}`;
    const materialId = r['__materialId'] || r['materialId'] || undefined;

    result.push({
      id: String(id),
      materialId: materialId ? String(materialId) : undefined,
      materialName: String(materialName).trim(),
      category,
      workCategory: workCatStr,
      unit,
      quotaQuantity,
      unitNormPerM2,
      notes
    });
  });

  return result;
}

