import type { InventoryItem } from '../types';

/** Equipment is project-wide. Team allocation is proved only by sourceTeamId, never a room or name guess. */
export interface TeamEquipmentVoucher {
  id: string;
  date: string;
  quantity: number;
  handler: string;
  location: string;
  notes: string;
}

export interface TeamEquipmentIssueLine {
  equipmentKey: string;
  materialId?: string;
  equipmentName: string;
  unit: string;
  issuedQty: number;
  voucherCount: number;
  vouchers: TeamEquipmentVoucher[];
}

const normalize = (value: unknown): string => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi-VN');

/** Do not count reversed/deleted, IN, cross-project, external or ambiguous legacy transactions as issued to a team. */
export function eligibleTeamEquipmentVoucher(item: InventoryItem): boolean {
  const legacy = item as InventoryItem & { deleted?: boolean; warehouseTransferId?: string };
  const qty = Number(item.quantity);
  return item.itemKind === 'equipment'
    && item.type === 'out'
    && (item.deletedAt === undefined || item.deletedAt === null)
    && legacy.deleted !== true
    && !legacy.warehouseTransferId
    && (item.issuePurpose === undefined || item.issuePurpose === 'project-work')
    && Number.isFinite(qty) && qty > 0
    && Boolean(normalize(item.materialName)) && Boolean(normalize(item.unit));
}

function summarize(items: readonly InventoryItem[]): TeamEquipmentIssueLine[] {
  const groups = new Map<string, TeamEquipmentIssueLine>();
  for (const item of items) {
    const key = `equipment:${normalize(item.materialName)}|unit:${normalize(item.unit)}`;
    let line = groups.get(key);
    if (!line) {
      line = { equipmentKey: key, materialId: item.materialId,
        equipmentName: item.materialName.trim(), unit: item.unit.trim(),
        issuedQty: 0, voucherCount: 0, vouchers: [] };
      groups.set(key, line);
    }
    line.issuedQty += Number(item.quantity);
    line.voucherCount += 1;
    line.vouchers.push({ id: item.id, date: item.date || '', quantity: Number(item.quantity),
      handler: item.handler || '', location: item.location || '', notes: item.notes || '' });
  }
  return [...groups.values()].map((line) => ({
    ...line,
    issuedQty: Math.round((line.issuedQty + Number.EPSILON) * 1e6) / 1e6,
    vouchers: line.vouchers.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
  })).sort((a, b) => a.equipmentName.localeCompare(b.equipmentName, 'vi-VN') || a.unit.localeCompare(b.unit, 'vi-VN'));
}

/** Project-wide equipment receipts assigned to this team's *exact* durable ID. */
export function computeTeamEquipmentIssues(teamId: string, inventory: readonly InventoryItem[]): TeamEquipmentIssueLine[] {
  if (!teamId) return [];
  return summarize(inventory.filter((item) => eligibleTeamEquipmentVoucher(item) && item.sourceTeamId === teamId));
}

/** Separate reporting bucket: never silently assign an unmapped or unassigned voucher to a team. */
export function computeUnassignedTeamEquipmentIssues(
  inventory: readonly InventoryItem[], knownTeamIds: readonly string[],
): TeamEquipmentIssueLine[] {
  const ids = new Set(knownTeamIds);
  return summarize(inventory.filter((item) => eligibleTeamEquipmentVoucher(item)
    && (!item.sourceTeamId || !ids.has(item.sourceTeamId))));
}