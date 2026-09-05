import type { RoomProgressItem, WorkVolume } from '../../types';
import { normalizeEntityText } from '../core/entityResolver';
import { normalizeUnit, unitKey } from '../../utils/unitUtils';
import { assertAiProjectAccess, createAiPermissionScope } from '../security/aiPermissionGuard';
import type {
  AiAuditIssue,
  AiAuditSummary,
  AiEvidenceRef,
  AiFact,
  AiQueryContext,
  AiToolResult,
} from '../core/contracts';

export interface AuditQuantityParams {
  context: AiQueryContext;
  workVolumes: WorkVolume[];
  rooms: RoomProgressItem[];
  freshness?: 'live' | 'cache' | 'fixture';
  asOf?: number;
}

function isActive(record: { deletedAt?: number | null }): boolean {
  return record.deletedAt === undefined || record.deletedAt === null;
}

function quantityKey(value: unknown): string {
  return normalizeEntityText(value).replace(/\s+/g, '-');
}

function categoryKey(item: { workCategoryId?: string; title?: string; workCategory?: string }): string {
  return String(item.workCategoryId || '').trim() || quantityKey(item.title || item.workCategory || 'unknown');
}

function evidenceId(collection: 'work_volumes' | 'rooms', id: string): string {
  return `${collection}:${id}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nearlyEqual(a: number, b: number): boolean {
  const tolerance = Math.max(0.01, Math.max(Math.abs(a), Math.abs(b)) * 1e-6);
  return Math.abs(a - b) <= tolerance;
}

export function auditQuantityData(params: AuditQuantityParams): AiToolResult<AiAuditSummary> {
  const {
    context,
    workVolumes = [],
    rooms = [],
    freshness = 'live',
    asOf = Date.now(),
  } = params;

  const permissionScope = createAiPermissionScope(context.projectId, context.role, context.accessVerified);
  assertAiProjectAccess(permissionScope, context.projectId);

  const activeWorkVolumes = workVolumes.filter(isActive);
  const activeRooms = rooms.filter(isActive);
  const issues: AiAuditIssue[] = [];
  const evidenceMap = new Map<string, AiEvidenceRef>();

  const addEvidence = (item: AiEvidenceRef): void => {
    if (!evidenceMap.has(item.id)) evidenceMap.set(item.id, item);
  };

  const addIssue = (issue: AiAuditIssue): void => {
    issues.push(issue);
  };

  const semanticWorkVolumeGroups = new Map<string, WorkVolume[]>();

  activeWorkVolumes.forEach((item) => {
    const ev = evidenceId('work_volumes', item.id);
    addEvidence({
      id: ev,
      collection: 'work_volumes',
      recordId: item.id,
      label: item.title,
      fieldPaths: ['workCategoryId', 'floorId', 'floorIds', 'unit', 'planned', 'actual', 'status'],
    });

    const planned = item.planned;
    const actual = item.actual;

    if (!isFiniteNumber(planned)) {
      addIssue({
        ruleId: 'QUANTITY_PLANNED_INVALID',
        severity: 'ERROR',
        entityType: 'quantity',
        entityId: item.id,
        message: `Khối lượng hợp đồng/kế hoạch của ${item.title} không phải số hợp lệ.`,
        evidenceIds: [ev],
        details: { planned },
      });
    } else if (planned < 0) {
      addIssue({
        ruleId: 'QUANTITY_PLANNED_NEGATIVE',
        severity: 'ERROR',
        entityType: 'quantity',
        entityId: item.id,
        message: `Khối lượng hợp đồng/kế hoạch của ${item.title} nhỏ hơn 0.`,
        evidenceIds: [ev],
        details: { planned },
      });
    }

    if (!isFiniteNumber(actual)) {
      addIssue({
        ruleId: 'QUANTITY_ACTUAL_INVALID',
        severity: 'ERROR',
        entityType: 'quantity',
        entityId: item.id,
        message: `Khối lượng thực hiện của ${item.title} không phải số hợp lệ.`,
        evidenceIds: [ev],
        details: { actual },
      });
    } else if (actual < 0) {
      addIssue({
        ruleId: 'QUANTITY_ACTUAL_NEGATIVE',
        severity: 'ERROR',
        entityType: 'quantity',
        entityId: item.id,
        message: `Khối lượng thực hiện của ${item.title} nhỏ hơn 0.`,
        evidenceIds: [ev],
        details: { actual },
      });
    }

    if (isFiniteNumber(planned) && isFiniteNumber(actual) && planned >= 0 && actual >= 0) {
      if (planned === 0 && actual > 0) {
        addIssue({
          ruleId: 'QUANTITY_ACTUAL_WITH_ZERO_PLAN',
          severity: 'REVIEW',
          entityType: 'quantity',
          entityId: item.id,
          message: `${item.title} có khối lượng thực hiện nhưng khối lượng kế hoạch/hợp đồng bằng 0.`,
          evidenceIds: [ev],
          details: { planned, actual, unit: normalizeUnit(item.unit) || item.unit },
        });
      }
      if (planned > 0 && actual > planned && !nearlyEqual(actual, planned)) {
        addIssue({
          ruleId: 'ACTUAL_GT_CONTRACT',
          severity: 'WARNING',
          entityType: 'quantity',
          entityId: item.id,
          message: `${item.title} có khối lượng thực hiện vượt khối lượng kế hoạch/hợp đồng.`,
          evidenceIds: [ev],
          details: { planned, actual, unit: normalizeUnit(item.unit) || item.unit },
        });
        addIssue({
          ruleId: 'PROGRESS_GT_100',
          severity: 'ERROR',
          entityType: 'quantity',
          entityId: item.id,
          message: `${item.title} có tỷ lệ actual/planned vượt 100%.`,
          evidenceIds: [ev],
          details: { progressPercent: Math.round((actual / planned) * 10000) / 100 },
        });
      }
    }

    const floorScope = Array.from(new Set([item.floorId, ...(item.floorIds || [])].filter(Boolean))).sort().join(',') || quantityKey(item.floor || 'all');
    const semanticKey = [floorScope, categoryKey(item), unitKey(item.unit)].join('|');
    const group = semanticWorkVolumeGroups.get(semanticKey) || [];
    group.push(item);
    semanticWorkVolumeGroups.set(semanticKey, group);
  });

  semanticWorkVolumeGroups.forEach((group) => {
    if (group.length <= 1) return;
    group.forEach((item) => addEvidence({
      id: evidenceId('work_volumes', item.id),
      collection: 'work_volumes',
      recordId: item.id,
      label: item.title,
    }));
    addIssue({
      ruleId: 'DUPLICATE_WORK_VOLUME_SCOPE',
      severity: 'REVIEW',
      entityType: 'quantity',
      entityId: group[0].id,
      message: `Có ${group.length} record khối lượng cùng phạm vi tầng + hạng mục + đơn vị; cần kiểm tra double counting.`,
      evidenceIds: group.map((item) => evidenceId('work_volumes', item.id)),
      details: { recordIds: group.map((item) => item.id) },
    });
  });

  const categoryUnits = new Map<string, Map<string, Set<string>>>();
  const roomAssignedGroups = new Map<string, { floorId: string; categoryId: string; categoryName: string; unit: string; quantity: number; evidenceIds: string[] }>();

  activeRooms.forEach((room) => {
    const roomEv = evidenceId('rooms', room.id);
    addEvidence({
      id: roomEv,
      collection: 'rooms',
      recordId: room.id,
      label: room.roomName,
      fieldPaths: ['floorId', 'workCategoryId', 'workCategory', 'workVolume', 'volumeUnit', 'categoryVolumes', 'categoryVolumeUnits', 'subItems', 'inspectionStatus'],
    });

    if (room.workVolume !== undefined) {
      if (!isFiniteNumber(room.workVolume)) {
        addIssue({
          ruleId: 'ROOM_QUANTITY_INVALID',
          severity: 'ERROR',
          entityType: 'room',
          entityId: room.id,
          message: `${room.roomName} có workVolume không phải số hợp lệ.`,
          evidenceIds: [roomEv],
          details: { workVolume: room.workVolume },
        });
      } else if (room.workVolume < 0) {
        addIssue({
          ruleId: 'ROOM_QUANTITY_NEGATIVE',
          severity: 'ERROR',
          entityType: 'room',
          entityId: room.id,
          message: `${room.roomName} có khối lượng nhỏ hơn 0.`,
          evidenceIds: [roomEv],
          details: { workVolume: room.workVolume },
        });
      }
    }

    Object.entries(room.categoryVolumes || {}).forEach(([name, value]) => {
      if (!isFiniteNumber(value) || value < 0) {
        addIssue({
          ruleId: !isFiniteNumber(value) ? 'ROOM_CATEGORY_QUANTITY_INVALID' : 'ROOM_CATEGORY_QUANTITY_NEGATIVE',
          severity: 'ERROR',
          entityType: 'room',
          entityId: room.id,
          message: `${room.roomName} có khối lượng hạng mục ${name} không hợp lệ.`,
          evidenceIds: [roomEv],
          details: { category: name, quantity: value },
        });
      }
    });

    const unfinishedSubItems = (room.subItems || []).filter((sub) => sub.status !== 'Đã hoàn thành');
    const invalidInspectionSubItems = (room.subItems || []).filter((sub) => sub.inspectionStatus === 'Đạt nghiệm thu' && sub.status !== 'Đã hoàn thành');
    invalidInspectionSubItems.forEach((sub) => {
      addIssue({
        ruleId: 'INSPECTED_WITH_UNFINISHED_WORK',
        severity: 'ERROR',
        entityType: 'room',
        entityId: room.id,
        message: `${room.roomName} / ${sub.name} đã Đạt nghiệm thu nhưng thi công chưa hoàn thành.`,
        evidenceIds: [roomEv],
        details: { subItemId: sub.id, status: sub.status, inspectionStatus: sub.inspectionStatus },
      });
    });

    if (room.inspectionStatus === 'Đạt nghiệm thu' && unfinishedSubItems.length > 0) {
      addIssue({
        ruleId: 'ROOM_DONE_WITH_UNFINISHED_SUBITEM',
        severity: 'WARNING',
        entityType: 'room',
        entityId: room.id,
        message: `${room.roomName} đã nghiệm thu tổng nhưng còn hạng mục con chưa hoàn thành.`,
        evidenceIds: [roomEv],
        details: { unfinishedSubItemIds: unfinishedSubItems.map((sub) => sub.id) },
      });
    }

    (room.subItems || []).forEach((sub) => {
      if (sub.workVolume !== undefined && (!isFiniteNumber(sub.workVolume) || sub.workVolume < 0)) {
        addIssue({
          ruleId: !isFiniteNumber(sub.workVolume) ? 'SUBITEM_QUANTITY_INVALID' : 'SUBITEM_QUANTITY_NEGATIVE',
          severity: 'ERROR',
          entityType: 'room',
          entityId: room.id,
          message: `${room.roomName} / ${sub.name} có workVolume không hợp lệ.`,
          evidenceIds: [roomEv],
          details: { subItemId: sub.id, workVolume: sub.workVolume },
        });
      }
    });

    const categories: Array<{ id: string; name: string; unit: string; quantity: number }> = [];
    const categoryEntries = Object.entries(room.categoryVolumes || {});
    if (categoryEntries.length > 0) {
      categoryEntries.forEach(([name, quantity]) => {
        if (!isFiniteNumber(quantity) || quantity < 0) return;
        categories.push({
          id: room.workCategoryId || quantityKey(name),
          name,
          unit: normalizeUnit(room.categoryVolumeUnits?.[name] || room.volumeUnit || ''),
          quantity,
        });
      });
    } else if (room.workCategory && isFiniteNumber(room.workVolume) && room.workVolume >= 0) {
      categories.push({
        id: room.workCategoryId || quantityKey(room.workCategory),
        name: room.workCategory,
        unit: normalizeUnit(room.volumeUnit || ''),
        quantity: room.workVolume,
      });
    }

    categories.forEach((category) => {
      const normalizedUnit = category.unit || '';
      const byCategory = categoryUnits.get(category.id) || new Map<string, Set<string>>();
      const unitSet = byCategory.get(category.name) || new Set<string>();
      if (normalizedUnit) unitSet.add(normalizedUnit);
      byCategory.set(category.name, unitSet);
      categoryUnits.set(category.id, byCategory);

      const groupKey = [room.floorId, category.id, unitKey(normalizedUnit)].join('|');
      const current = roomAssignedGroups.get(groupKey) || {
        floorId: room.floorId,
        categoryId: category.id,
        categoryName: category.name,
        unit: normalizedUnit,
        quantity: 0,
        evidenceIds: [],
      };
      current.quantity += category.quantity;
      current.evidenceIds.push(roomEv);
      roomAssignedGroups.set(groupKey, current);
    });
  });

  categoryUnits.forEach((byName, id) => {
    const mergedUnits = new Set<string>();
    const names = new Set<string>();
    byName.forEach((units, name) => {
      names.add(name);
      units.forEach((unit) => mergedUnits.add(unit));
    });
    if (mergedUnits.size > 1) {
      addIssue({
        ruleId: 'MIXED_UNIT_SAME_WORK_ITEM',
        severity: 'WARNING',
        entityType: 'quantity',
        entityId: id,
        message: `Cùng một hạng mục đang dùng nhiều đơn vị: ${Array.from(mergedUnits).join(', ')}. Không được cộng chung các đơn vị này.`,
        evidenceIds: [],
        details: { workItemNames: Array.from(names), units: Array.from(mergedUnits) },
      });
    }
  });

  const workVolumeMatchMap = new Map<string, WorkVolume[]>();
  activeWorkVolumes.forEach((item) => {
    const floors = Array.from(new Set([item.floorId, ...(item.floorIds || [])].filter(Boolean))) as string[];
    floors.forEach((floorId) => {
      const key = [floorId, categoryKey(item), unitKey(item.unit)].join('|');
      const group = workVolumeMatchMap.get(key) || [];
      group.push(item);
      workVolumeMatchMap.set(key, group);
    });
  });

  roomAssignedGroups.forEach((group, key) => {
    const candidates = workVolumeMatchMap.get(key) || [];
    if (candidates.length !== 1) return;
    const contract = candidates[0];
    if (!isFiniteNumber(contract.planned) || contract.planned < 0) return;
    const contractEv = evidenceId('work_volumes', contract.id);
    addEvidence({ id: contractEv, collection: 'work_volumes', recordId: contract.id, label: contract.title });
    if (!nearlyEqual(group.quantity, contract.planned)) {
      addIssue({
        ruleId: 'FLOOR_ROOM_SUM_MISMATCH',
        severity: 'REVIEW',
        entityType: 'quantity',
        entityId: `${group.floorId}:${group.categoryId}`,
        message: `Tổng khối lượng Căn/Phòng của ${group.categoryName} trên tầng không bằng khối lượng kế hoạch/hợp đồng cùng phạm vi.`,
        evidenceIds: [contractEv, ...group.evidenceIds],
        details: { floorId: group.floorId, roomSum: Math.round(group.quantity * 10000) / 10000, planned: contract.planned, unit: group.unit },
      });
    }
    if (group.quantity > contract.planned && !nearlyEqual(group.quantity, contract.planned)) {
      addIssue({
        ruleId: 'ROOM_ASSIGNED_GT_CONTRACT',
        severity: 'WARNING',
        entityType: 'quantity',
        entityId: `${group.floorId}:${group.categoryId}`,
        message: `Tổng khối lượng đã gán cho Căn/Phòng vượt khối lượng kế hoạch/hợp đồng cùng tầng/hạng mục/đơn vị.`,
        evidenceIds: [contractEv, ...group.evidenceIds],
        details: { floorId: group.floorId, roomSum: group.quantity, planned: contract.planned, unit: group.unit },
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
    { id: 'quantity-audit:work-volumes', kind: 'CALCULATED', label: 'Record khối lượng đã kiểm tra', value: activeWorkVolumes.length, unit: 'record' },
    { id: 'quantity-audit:rooms', kind: 'CALCULATED', label: 'Căn/Phòng đã kiểm tra', value: activeRooms.length, unit: 'record' },
    { id: 'quantity-audit:errors', kind: 'CALCULATED', label: 'Lỗi khối lượng', value: data.errorCount, unit: 'issue' },
    { id: 'quantity-audit:warnings', kind: 'CALCULATED', label: 'Cảnh báo khối lượng', value: data.warningCount, unit: 'issue' },
    { id: 'quantity-audit:review', kind: 'CALCULATED', label: 'Khối lượng cần rà soát', value: data.reviewCount, unit: 'issue' },
  ];

  return {
    status: 'ok',
    data,
    facts,
    evidence: Array.from(evidenceMap.values()),
    metadata: {
      projectId: context.projectId,
      tool: 'auditQuantityData',
      sourceCollections: ['work_volumes', 'rooms'],
      recordsScanned: workVolumes.length + rooms.length,
      recordsUsed: activeWorkVolumes.length + activeRooms.length,
      asOf,
      freshness,
      permissionRole: context.role,
      dataVersion: 'hnl-ai-audit-v2',
    },
    warnings: [],
    assumptions: [
      'WorkVolume.planned được xem là khối lượng kế hoạch/hợp đồng của đúng phạm vi record; audit không tự đổi planned/actual.',
      'So sánh tổng Căn/Phòng với WorkVolume chỉ chạy khi có đúng một record cùng floorId + hạng mục + đơn vị.',
      'RoomSubItem.workVolume không bị cộng để suy diễn tổng hạng mục vì các công đoạn tuần tự có thể dùng cùng một diện tích và cộng trực tiếp sẽ double count.',
      'Đơn vị chỉ được chuẩn hóa ký hiệu; không có phép quy đổi m², m, kg, bộ... giữa nhau.',
    ],
  };
}
