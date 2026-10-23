import type { HnlAiProjectSnapshot } from '../ai/data/projectSnapshot';
import type { ProjectStructureConfig } from '../utils/structureGroupUtils';
import type { HealthCenterIssue } from './healthCenterEngine';

/** Read-only project-reference scan. Never infer that an unreferenced blob is safe to delete. */
export function findAdditionalOrphanIssues(
  snapshot: HnlAiProjectSnapshot,
  photoDiagnostics?: { photos?: unknown[]; truncated?: boolean } | null,
  structureConfig?: ProjectStructureConfig,
): HealthCenterIssue[] {
  const issues: HealthCenterIssue[] = [];
  const active = <T extends { id: string; deletedAt?: number | null }>(rows: readonly T[]) =>
    new Map(rows.filter((row) => row.deletedAt == null).map((row) => [row.id, row]));
  const activeDefects = active(snapshot.defects);
  const activeCrew = active(snapshot.crewRecords);
  const activeInventory = active(snapshot.inventory);
  const allDefects = new Map(snapshot.defects.map((row) => [row.id, row]));
  const allCrew = new Map(snapshot.crewRecords.map((row) => [row.id, row]));
  const allInventory = new Map(snapshot.inventory.map((row) => [row.id, row]));

  // Missing groups are never silently reassigned to a default group.
  if (structureConfig?.enabled && Array.isArray(structureConfig.groups) && structureConfig.groups.length > 0) {
    const groups = new Set(structureConfig.groups.map((group) => group.id));
    active(snapshot.floors).forEach((floor) => {
      if (!floor.structureGroupId || groups.has(floor.structureGroupId)) return;
      issues.push({
        id: `orphan:floor-group:${floor.id}`, ruleId: 'ORPHAN_FLOOR_GROUP_NOT_FOUND',
        severity: 'WARNING', module: 'rooms', entityType: 'floor', entityId: floor.id,
        message: `Mặt bằng ${floor.floorName} thuộc Khu/Khối không còn trong danh sách.`,
        actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`floor_plans:${floor.id}`],
        location: { floorId: floor.id, floorName: floor.floorName },
        details: { structureGroupId: floor.structureGroupId },
      });
    });
  }

  // A new floor may legitimately have no image; absence alone is NOT a broken link.
  // Immutable floor-plan assets require a separate R2/Storage server-side inventory
  // to prove a binary is unreferenced; this read-only check never deletes it.

  // PhotoAttachment diagnostics can include still-pending uploads, and are
  // capped for performance. Never classify deleted photos or unknown chat/media
  // entity types as safe-to-delete orphans.
  const photoTargets: Record<string, { active: Map<string, unknown>; all: Map<string, unknown>; name: string }> = {
    defect: { active: activeDefects, all: allDefects, name: 'Defect' },
    crewRecord: { active: activeCrew, all: allCrew, name: 'Nhật ký quân số' },
    inventory: { active: activeInventory, all: allInventory, name: 'Phiếu kho' },
    // Chat media is excluded: its parent lives in a separate collection not
    // present in the project health snapshot.
  };
  if (photoDiagnostics && Array.isArray(photoDiagnostics.photos)) {
    for (const rawPhoto of photoDiagnostics.photos) {
      const photo = rawPhoto as Record<string, unknown> | null;
      if (!photo || photo.deleted || !photo.id || !photo.entityId) continue;
      const entityType = String(photo.entityType || '');
      const entityId = String(photo.entityId || '');
      const target = photoTargets[entityType];
      if (!target || target.active.has(entityId)) continue;
      // A deleted parent still exists for Trash restore. Do not mark as an orphan.
      if (target.all.has(entityId)) continue;
      issues.push({
        id: `orphan:photo:${photo.id}`, ruleId: 'ORPHAN_PHOTO_PARENT_NOT_FOUND',
        severity: 'REVIEW', module: 'r2', entityType: 'photo', entityId: String(photo.id),
        message: `Ảnh ${target.name} không tìm thấy bản ghi liên kết. Cần kiểm tra trước khi dọn.`,
        actionClass: 'READ_ONLY', evidenceIds: [`photos:${photo.id}`],
        location: { floorId: String(photo.floorId || '') || undefined, roomId: String(photo.roomId || '') || undefined },
        details: { photoId: photo.id, targetType: entityType, targetId: entityId,
          isFullCloudSnapshot: false, noAutomaticDeletion: true },
      });
    }
  }
  return issues;
}

/** Group existing checks with the additional read-only orphan checks. */
export function isOrphanRelatedIssue(issue: Pick<HealthCenterIssue, 'ruleId'>): boolean {
  if (issue.ruleId.startsWith('ORPHAN_') || issue.ruleId.includes('_ORPHAN_')) return true;
  return new Set([
    'ROOM_FLOOR_NOT_FOUND', 'ROOM_TEAM_NOT_FOUND', 'ROOM_SUBITEM_TEAM_NOT_FOUND',
    'DEFECT_FLOOR_NOT_FOUND', 'DEFECT_ROOM_NOT_FOUND', 'DEFECT_TEAM_NOT_FOUND',
    'CREW_FLOOR_NOT_FOUND', 'CREW_FLOOR_WORK_FLOOR_NOT_FOUND', 'CREW_TEAM_NOT_FOUND',
    'WORK_VOLUME_FLOOR_NOT_FOUND', 'MATERIAL_NORM_WORK_CATEGORY_NOT_FOUND',
    'CHECKLIST_FLOOR_NOT_FOUND', 'CHECKLIST_ROOM_NOT_FOUND', 'CHECKLIST_TEAM_NOT_FOUND',
    'INVENTORY_SOURCE_ROOM_NOT_FOUND', 'INVENTORY_SOURCE_FLOOR_NOT_FOUND',
    'INVENTORY_SOURCE_NORM_NOT_FOUND', 'ROOM_WORK_CATEGORY_SCOPE_MISMATCH',
  ]).has(issue.ruleId);
}
