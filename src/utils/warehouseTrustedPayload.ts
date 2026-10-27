/** Pure transport projection for P21.4 disposable DEV Functions emulator only.
 * Administrative fields are exclusively computed in trusted server code.
 */
import type { InventoryItem } from '../types';
const FIELDS = [
  'id','type','itemKind','materialId','materialName','unit','quantity','inputExpressions',
  'location','handler','date','notes','sourceType','issuePurpose','sourceStructureGroupId',
  'sourceRoomId','sourceFloorId','sourceTeamId','sourceWorkCategoryId','sourceNormId',
] as const;
export function strictManualVoucherPayload(item: InventoryItem): Record<string, unknown> {
  if (!item || typeof item !== 'object' || !item.id ||
    (item.sourceType && item.sourceType !== 'manual') || item.sourceIssueKey || item.id.startsWith('AUTO-XK-')) {
    throw new Error('P21_TRUSTED_SYSTEM_VOUCHER_REQUIRES_SERVER_FLOW');
  }
  const result: Record<string, unknown> = {};
  for (const field of FIELDS) {
    const value = item[field];
    if (value !== undefined && value !== null) result[field] = value;
  }
  return result;
}
