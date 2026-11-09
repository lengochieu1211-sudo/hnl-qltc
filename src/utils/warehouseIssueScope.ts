import type { InventoryItem, InventoryItemKind, InventoryIssuePurpose } from '../types';

type WarehouseIssueLinks = Pick<InventoryItem,
  'sourceStructureGroupId' | 'sourceFloorId' | 'sourceRoomId' | 'sourceTeamId' | 'sourceWorkCategoryId'>;

/**
 * New warehouse OUT vouchers remain project-level. Equipment may have an
 * optional receiving team, but is not allocated to the room/floor hierarchy.
 * This helper only builds links for NEW payloads: the App update path merges
 * existing voucher metadata to preserve historical room links on old vouchers.
 */
export function buildWarehouseIssueScope(
  itemKind: InventoryItemKind,
  issuePurpose: InventoryIssuePurpose,
  links: WarehouseIssueLinks,
): WarehouseIssueLinks {
  if (issuePurpose !== 'project-work') return {};
  const team = links.sourceTeamId ? { sourceTeamId: links.sourceTeamId } : {};
  if (itemKind === 'equipment') return team;
  return {
    ...(links.sourceStructureGroupId ? { sourceStructureGroupId: links.sourceStructureGroupId } : {}),
    ...(links.sourceFloorId ? { sourceFloorId: links.sourceFloorId } : {}),
    ...(links.sourceRoomId ? { sourceRoomId: links.sourceRoomId } : {}),
    ...team,
    ...(links.sourceWorkCategoryId ? { sourceWorkCategoryId: links.sourceWorkCategoryId } : {}),
  };
}