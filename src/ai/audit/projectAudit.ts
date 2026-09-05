import type {
  ChecklistItem,
  FloorPlan,
  InventoryItem,
  MaterialNorm,
  RoomProgressItem,
  TeamInfo,
  WorkVolume,
} from '../../types';
import { auditCrewData } from './crewAudit';
import { auditDefectLinks } from './defectAudit';
import { auditQuantityData } from './quantityAudit';
import type {
  AiAuditIssue,
  AiAuditSummary,
  AiEvidenceRef,
  AiFact,
  AiQueryContext,
  AiSourceCollection,
  AiToolResult,
} from '../core/contracts';
import type { HnlAiProjectSnapshot } from '../data/projectSnapshot';
import { assertAiProjectAccess, createAiPermissionScope } from '../security/aiPermissionGuard';

function isActive(record: { deletedAt?: number | null }): boolean {
  return record.deletedAt === undefined || record.deletedAt === null;
}

function mergeEvidence(target: Map<string, AiEvidenceRef>, items: AiEvidenceRef[]): void {
  items.forEach((item) => {
    if (!target.has(item.id)) target.set(item.id, item);
  });
}

function duplicateIdIssues<T extends { id: string; deletedAt?: number | null }>(
  collection: AiSourceCollection,
  entityType: AiAuditIssue['entityType'],
  records: readonly T[],
): { issues: AiAuditIssue[]; evidence: AiEvidenceRef[] } {
  const byId = new Map<string, T[]>();
  records.filter(isActive).forEach((record) => {
    const group = byId.get(record.id) || [];
    group.push(record);
    byId.set(record.id, group);
  });
  const issues: AiAuditIssue[] = [];
  const evidence: AiEvidenceRef[] = [];
  byId.forEach((group, id) => {
    if (group.length <= 1) return;
    const evidenceId = `${collection}:${id}`;
    evidence.push({ id: evidenceId, collection, recordId: id, label: id });
    issues.push({
      ruleId: 'DUPLICATE_ID',
      severity: 'ERROR',
      entityType,
      entityId: id,
      message: `Collection ${collection} có ${group.length} record active trùng id ${id}.`,
      evidenceIds: [evidenceId],
      details: { collection, duplicateCount: group.length },
    });
  });
  return { issues, evidence };
}

function collectionEvidence(collection: AiSourceCollection, recordId: string, label?: string, fieldPaths?: string[]): AiEvidenceRef {
  return { id: `${collection}:${recordId}`, collection, recordId, label, fieldPaths };
}

function activeMap<T extends { id: string; deletedAt?: number | null }>(records: readonly T[]): Map<string, T> {
  return new Map(records.filter(isActive).map((item) => [item.id, item]));
}

export interface AuditProjectIntegrityParams {
  context: AiQueryContext;
  snapshot: HnlAiProjectSnapshot;
}

/**
 * Composite, read-only project audit. It combines dedicated defect/quantity/crew rules
 * with cross-collection reference checks that do not belong to a single business module.
 * The function never mutates source records and never queries outside the supplied project snapshot.
 */
export function auditProjectIntegrity(params: AuditProjectIntegrityParams): AiToolResult<AiAuditSummary> {
  const { context, snapshot } = params;
  const permissionScope = createAiPermissionScope(context.projectId, context.role, context.accessVerified);
  assertAiProjectAccess(permissionScope, context.projectId);
  if (snapshot.projectId !== context.projectId) {
    throw new Error('AI_PROJECT_SCOPE_MISMATCH: Snapshot không thuộc projectId đã xác minh.');
  }

  const defectAudit = auditDefectLinks({
    context,
    defects: [...snapshot.defects],
    rooms: [...snapshot.rooms],
    floors: [...snapshot.floors],
    teams: [...snapshot.teams],
    freshness: snapshot.freshness,
    asOf: snapshot.asOf,
  });
  const quantityAudit = auditQuantityData({
    context,
    workVolumes: [...snapshot.workVolumes],
    rooms: [...snapshot.rooms],
    freshness: snapshot.freshness,
    asOf: snapshot.asOf,
  });
  const crewAudit = auditCrewData({
    context,
    crewRecords: [...snapshot.crewRecords],
    teams: [...snapshot.teams],
    floors: [...snapshot.floors],
    freshness: snapshot.freshness,
    asOf: snapshot.asOf,
  });

  const issues: AiAuditIssue[] = [
    ...(defectAudit.data?.issues || []),
    ...(quantityAudit.data?.issues || []),
    ...(crewAudit.data?.issues || []),
  ];
  const evidenceMap = new Map<string, AiEvidenceRef>();
  mergeEvidence(evidenceMap, defectAudit.evidence);
  mergeEvidence(evidenceMap, quantityAudit.evidence);
  mergeEvidence(evidenceMap, crewAudit.evidence);

  const floors = activeMap(snapshot.floors);
  const teams = activeMap(snapshot.teams);
  const rooms = activeMap(snapshot.rooms);
  const workVolumes = activeMap(snapshot.workVolumes);
  const materialNorms = activeMap(snapshot.materialNorms);

  const duplicateChecks: Array<{ collection: AiSourceCollection; entityType: AiAuditIssue['entityType']; records: readonly any[] }> = [
    { collection: 'rooms', entityType: 'room', records: snapshot.rooms },
    { collection: 'defects', entityType: 'defect', records: snapshot.defects },
    { collection: 'crew_records', entityType: 'crew', records: snapshot.crewRecords },
    { collection: 'teams', entityType: 'team', records: snapshot.teams },
    { collection: 'floor_plans', entityType: 'floor', records: snapshot.floors },
    { collection: 'work_volumes', entityType: 'quantity', records: snapshot.workVolumes },
    { collection: 'inventory', entityType: 'project', records: snapshot.inventory },
    { collection: 'material_norms', entityType: 'project', records: snapshot.materialNorms },
    { collection: 'checklist', entityType: 'project', records: snapshot.checklist },
  ];
  duplicateChecks.forEach((entry) => {
    const result = duplicateIdIssues(entry.collection, entry.entityType, entry.records);
    issues.push(...result.issues);
    mergeEvidence(evidenceMap, result.evidence);
  });

  snapshot.rooms.filter(isActive).forEach((room: RoomProgressItem) => {
    const roomEv = collectionEvidence('rooms', room.id, room.roomName, ['floorId', 'teamId', 'subItems']);
    evidenceMap.set(roomEv.id, roomEv);
    if (!floors.has(room.floorId)) {
      issues.push({
        ruleId: 'ROOM_FLOOR_NOT_FOUND',
        severity: 'ERROR',
        entityType: 'room',
        entityId: room.id,
        message: `${room.roomName} tham chiếu floorId không tồn tại trong project hiện tại.`,
        evidenceIds: [roomEv.id],
        details: { floorId: room.floorId },
      });
    }
    if (room.teamId && !teams.has(room.teamId)) {
      issues.push({
        ruleId: 'ROOM_TEAM_NOT_FOUND',
        severity: 'ERROR',
        entityType: 'room',
        entityId: room.id,
        message: `${room.roomName} tham chiếu teamId không tồn tại trong project hiện tại.`,
        evidenceIds: [roomEv.id],
        details: { teamId: room.teamId },
      });
    }
    (room.subItems || []).forEach((sub) => {
      if (sub.teamId && !teams.has(sub.teamId)) {
        issues.push({
          ruleId: 'ROOM_SUBITEM_TEAM_NOT_FOUND',
          severity: 'ERROR',
          entityType: 'room',
          entityId: room.id,
          message: `${room.roomName} / ${sub.name} tham chiếu teamId không tồn tại.`,
          evidenceIds: [roomEv.id],
          details: { subItemId: sub.id, teamId: sub.teamId },
        });
      }
    });
  });

  snapshot.workVolumes.filter(isActive).forEach((item: WorkVolume) => {
    const itemEv = collectionEvidence('work_volumes', item.id, item.title, ['floorId', 'floorIds', 'workCategoryId']);
    evidenceMap.set(itemEv.id, itemEv);
    const floorIds = Array.from(new Set([item.floorId, ...(item.floorIds || [])].filter(Boolean))) as string[];
    floorIds.forEach((floorId) => {
      if (!floors.has(floorId)) {
        issues.push({
          ruleId: 'WORK_VOLUME_FLOOR_NOT_FOUND',
          severity: 'ERROR',
          entityType: 'quantity',
          entityId: item.id,
          message: `${item.title} tham chiếu floorId không tồn tại trong project hiện tại.`,
          evidenceIds: [itemEv.id],
          details: { floorId },
        });
      }
    });
  });

  const validWorkCategoryIds = new Set<string>();
  snapshot.workVolumes.filter(isActive).forEach((item) => {
    if (item.id) validWorkCategoryIds.add(item.id);
    if (item.workCategoryId) validWorkCategoryIds.add(item.workCategoryId);
  });

  snapshot.materialNorms.filter(isActive).forEach((norm: MaterialNorm) => {
    const normEv = collectionEvidence('material_norms', norm.id, norm.materialName, ['workCategoryId', 'workCategoryIds']);
    evidenceMap.set(normEv.id, normEv);
    const refs = Array.from(new Set([norm.workCategoryId, ...(norm.workCategoryIds || [])].filter(Boolean))) as string[];
    refs.forEach((workCategoryId) => {
      if (!validWorkCategoryIds.has(workCategoryId)) {
        issues.push({
          ruleId: 'MATERIAL_NORM_WORK_CATEGORY_NOT_FOUND',
          severity: 'ERROR',
          entityType: 'project',
          entityId: norm.id,
          message: `Định mức ${norm.materialName} tham chiếu workCategoryId không tồn tại.`,
          evidenceIds: [normEv.id],
          details: { workCategoryId },
        });
      }
    });
  });

  snapshot.checklist.filter(isActive).forEach((item: ChecklistItem) => {
    const itemEv = collectionEvidence('checklist', item.id, item.title, ['floorId', 'roomId', 'teamId']);
    evidenceMap.set(itemEv.id, itemEv);
    if (item.floorId && !floors.has(item.floorId)) {
      issues.push({
        ruleId: 'CHECKLIST_FLOOR_NOT_FOUND',
        severity: 'ERROR',
        entityType: 'project',
        entityId: item.id,
        message: `Checklist ${item.title} tham chiếu floorId không tồn tại.`,
        evidenceIds: [itemEv.id],
        details: { floorId: item.floorId },
      });
    }
    if (item.roomId) {
      const room = rooms.get(item.roomId);
      if (!room) {
        issues.push({
          ruleId: 'CHECKLIST_ROOM_NOT_FOUND',
          severity: 'ERROR',
          entityType: 'project',
          entityId: item.id,
          message: `Checklist ${item.title} tham chiếu roomId không tồn tại.`,
          evidenceIds: [itemEv.id],
          details: { roomId: item.roomId },
        });
      } else if (item.floorId && room.floorId !== item.floorId) {
        evidenceMap.set(`rooms:${room.id}`, collectionEvidence('rooms', room.id, room.roomName));
        issues.push({
          ruleId: 'CHECKLIST_ROOM_FLOOR_MISMATCH',
          severity: 'ERROR',
          entityType: 'project',
          entityId: item.id,
          message: `Checklist ${item.title} có floorId khác floorId của room được liên kết.`,
          evidenceIds: [itemEv.id, `rooms:${room.id}`],
          details: { checklistFloorId: item.floorId, roomFloorId: room.floorId, roomId: room.id },
        });
      }
    }
    if (item.teamId && !teams.has(item.teamId)) {
      issues.push({
        ruleId: 'CHECKLIST_TEAM_NOT_FOUND',
        severity: 'ERROR',
        entityType: 'project',
        entityId: item.id,
        message: `Checklist ${item.title} tham chiếu teamId không tồn tại.`,
        evidenceIds: [itemEv.id],
        details: { teamId: item.teamId },
      });
    }
  });

  snapshot.inventory.filter(isActive).forEach((item: InventoryItem) => {
    const itemEv = collectionEvidence('inventory', item.id, item.materialName, ['sourceRoomId', 'sourceFloorId', 'sourceNormId', 'materialId']);
    evidenceMap.set(itemEv.id, itemEv);
    if (item.sourceRoomId && !rooms.has(item.sourceRoomId)) {
      issues.push({
        ruleId: 'INVENTORY_SOURCE_ROOM_NOT_FOUND',
        severity: 'ERROR',
        entityType: 'project',
        entityId: item.id,
        message: `Giao dịch kho ${item.id} tham chiếu sourceRoomId không tồn tại.`,
        evidenceIds: [itemEv.id],
        details: { sourceRoomId: item.sourceRoomId },
      });
    }
    if (item.sourceFloorId && !floors.has(item.sourceFloorId)) {
      issues.push({
        ruleId: 'INVENTORY_SOURCE_FLOOR_NOT_FOUND',
        severity: 'ERROR',
        entityType: 'project',
        entityId: item.id,
        message: `Giao dịch kho ${item.id} tham chiếu sourceFloorId không tồn tại.`,
        evidenceIds: [itemEv.id],
        details: { sourceFloorId: item.sourceFloorId },
      });
    }
    if (item.sourceNormId && !materialNorms.has(item.sourceNormId)) {
      issues.push({
        ruleId: 'INVENTORY_SOURCE_NORM_NOT_FOUND',
        severity: 'ERROR',
        entityType: 'project',
        entityId: item.id,
        message: `Giao dịch kho ${item.id} tham chiếu sourceNormId không tồn tại.`,
        evidenceIds: [itemEv.id],
        details: { sourceNormId: item.sourceNormId },
      });
    }
  });

  const data: AiAuditSummary = {
    issues,
    errorCount: issues.filter((issue) => issue.severity === 'ERROR').length,
    warningCount: issues.filter((issue) => issue.severity === 'WARNING').length,
    reviewCount: issues.filter((issue) => issue.severity === 'REVIEW').length,
  };

  const facts: AiFact[] = [
    { id: 'project-audit:errors', kind: 'CALCULATED', label: 'Lỗi toàn dự án', value: data.errorCount, unit: 'issue' },
    { id: 'project-audit:warnings', kind: 'CALCULATED', label: 'Cảnh báo toàn dự án', value: data.warningCount, unit: 'issue' },
    { id: 'project-audit:review', kind: 'CALCULATED', label: 'Mục cần rà soát', value: data.reviewCount, unit: 'issue' },
  ];

  const sourceCollections: AiSourceCollection[] = [
    'rooms', 'defects', 'crew_records', 'teams', 'floor_plans', 'work_volumes',
    'inventory', 'material_norms', 'checklist',
  ];

  const recordsScanned = snapshot.rooms.length + snapshot.defects.length + snapshot.crewRecords.length
    + snapshot.teams.length + snapshot.floors.length + snapshot.workVolumes.length
    + snapshot.inventory.length + snapshot.materialNorms.length + snapshot.checklist.length;

  return {
    status: 'ok',
    data,
    facts,
    evidence: Array.from(evidenceMap.values()),
    metadata: {
      projectId: context.projectId,
      tool: 'auditProjectIntegrity',
      sourceCollections,
      recordsScanned,
      recordsUsed: recordsScanned,
      asOf: snapshot.asOf,
      freshness: snapshot.freshness,
      permissionRole: context.role,
      dataVersion: 'hnl-ai-audit-v2',
    },
    warnings: [],
    assumptions: [
      'Snapshot đầu vào đã được giới hạn trong đúng projectId; project root/path là nguồn project scope, không yêu cầu thêm projectId vào từng business record.',
      'Audit tổng hợp kết quả từ Defect, Quantity, Crew và các kiểm tra cross-reference; không tự sửa hoặc xóa record.',
      'Tham chiếu tới record soft-deleted được xem như không còn active và sẽ bị phát hiện như missing reference.',
    ],
  };
}
