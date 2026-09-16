import type { RoomProgressItem, WorkVolume } from '../../types';
import { normalizeEntityText } from '../core/entityResolver';
import { normalizeUnit, unitKey } from '../../utils/unitUtils';
import { canonicalWorkCategoryId, getCanonicalRoomCategoryEntries, resolveWorkVolumeRef, validateWorkVolumeCatalog, workVolumeAppliesToFloor } from '../../utils/linkageIntegrity';
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
      addIssue({ ruleId: 'QUANTITY_PLANNED_INVALID', severity: 'ERROR', entityType: 'quantity', entityId: item.id, message: `Khối lượng hợp đồng/kế hoạch của ${item.title} không phải số hợp lệ.`, evidenceIds: [ev], details: { planned } });
    } else if (planned < 0) {
      addIssue({ ruleId: 'QUANTITY_PLANNED_NEGATIVE', severity: 'ERROR', entityType: 'quantity', entityId: item.id, message: `Khối lượng hợp đồng/kế hoạch của ${item.title} nhỏ hơn 0.`, evidenceIds: [ev], details: { planned } });
    }

    if (!isFiniteNumber(actual)) {
      addIssue({ ruleId: 'QUANTITY_ACTUAL_INVALID', severity: 'ERROR', entityType: 'quantity', entityId: item.id, message: `Khối lượng thực hiện của ${item.title} không phải số hợp lệ.`, evidenceIds: [ev], details: { actual } });
    } else if (actual < 0) {
      addIssue({ ruleId: 'QUANTITY_ACTUAL_NEGATIVE', severity: 'ERROR', entityType: 'quantity', entityId: item.id, message: `Khối lượng thực hiện của ${item.title} nhỏ hơn 0.`, evidenceIds: [ev], details: { actual } });
    }

    if (isFiniteNumber(planned) && isFiniteNumber(actual) && planned >= 0 && actual >= 0) {
      if (planned === 0 && actual > 0) {
        addIssue({ ruleId: 'QUANTITY_ACTUAL_WITH_ZERO_PLAN', severity: 'REVIEW', entityType: 'quantity', entityId: item.id, message: `${item.title} có khối lượng thực hiện nhưng khối lượng kế hoạch/hợp đồng bằng 0.`, evidenceIds: [ev], details: { planned, actual, unit: normalizeUnit(item.unit) || item.unit } });
      }
      if (planned > 0 && actual > planned && !nearlyEqual(actual, planned)) {
        addIssue({ ruleId: 'ACTUAL_GT_CONTRACT', severity: 'WARNING', entityType: 'quantity', entityId: item.id, message: `${item.title} có khối lượng thực hiện vượt khối lượng kế hoạch/hợp đồng.`, evidenceIds: [ev], details: { planned, actual, unit: normalizeUnit(item.unit) || item.unit } });
        addIssue({ ruleId: 'PROGRESS_GT_100', severity: 'ERROR', entityType: 'quantity', entityId: item.id, message: `${item.title} có tỷ lệ actual/planned vượt 100%.`, evidenceIds: [ev], details: { progressPercent: Math.round((actual / planned) * 10000) / 100 } });
      }
    }
  });

  // Catalog-level duplicate detection is floor-scope aware: disjoint floors are valid,
  // overlapping scopes with the same name + unit are not.
  validateWorkVolumeCatalog(activeWorkVolumes).forEach((issue) => {
    issue.workVolumeIds.forEach((id) => {
      const item = activeWorkVolumes.find((entry) => entry.id === id);
      if (item) addEvidence({ id: evidenceId('work_volumes', item.id), collection: 'work_volumes', recordId: item.id, label: item.title });
    });
    addIssue({
      ruleId: 'DUPLICATE_WORK_VOLUME_SCOPE',
      severity: 'REVIEW',
      entityType: 'quantity',
      entityId: issue.workVolumeIds[0],
      message: issue.message,
      evidenceIds: issue.workVolumeIds.map((id) => evidenceId('work_volumes', id)),
      details: { recordIds: issue.workVolumeIds },
    });
  });

  const categoryUnits = new Map<string, { names: Set<string>; units: Set<string> }>();
  const addCategoryUnit = (workCategoryId: string, name: string | undefined, unitValue: unknown): void => {
    const id = String(workCategoryId || '').trim();
    if (!id) return;
    const bucket = categoryUnits.get(id) || { names: new Set<string>(), units: new Set<string>() };
    if (name) bucket.names.add(name);
    const rawUnit = String(unitValue || '').trim();
    const unit = normalizeUnit(rawUnit) || rawUnit;
    if (unit) bucket.units.add(unit);
    categoryUnits.set(id, bucket);
  };

  // Seed the unit catalog from the authoritative WorkVolume records. This lets the
  // audit flag a Room that keeps the correct category ID but drifts to another unit
  // even when that Room is also out of the WorkVolume floor scope. Floor mismatch and
  // unit mismatch are independent integrity errors and neither should mask the other.
  activeWorkVolumes.forEach((work) => {
    const id = canonicalWorkCategoryId(work);
    if (id) addCategoryUnit(id, work.title, work.unit);
  });

  const roomCanonicalEntries = new Map<string, ReturnType<typeof getCanonicalRoomCategoryEntries>>();

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
        addIssue({ ruleId: 'ROOM_QUANTITY_INVALID', severity: 'ERROR', entityType: 'room', entityId: room.id, message: `${room.roomName} có workVolume không phải số hợp lệ.`, evidenceIds: [roomEv], details: { workVolume: room.workVolume } });
      } else if (room.workVolume < 0) {
        addIssue({ ruleId: 'ROOM_QUANTITY_NEGATIVE', severity: 'ERROR', entityType: 'room', entityId: room.id, message: `${room.roomName} có khối lượng nhỏ hơn 0.`, evidenceIds: [roomEv], details: { workVolume: room.workVolume } });
      }
    }

    // Canonical entries use durable Room/SubItem IDs as the calculation identity.
    // A WorkVolume floor-scope drift is reported separately below; it must not make
    // an otherwise valid durable ID look like a deleted/orphan work category.
    const entries = getCanonicalRoomCategoryEntries(room, activeWorkVolumes);
    const canonicalSourceKeys = new Set(entries.map((entry) => entry.sourceKey));

    Object.entries(room.categoryVolumes || {}).forEach(([rawKey, value]) => {
      if (!isFiniteNumber(value) || value < 0) {
        addIssue({ ruleId: !isFiniteNumber(value) ? 'ROOM_CATEGORY_QUANTITY_INVALID' : 'ROOM_CATEGORY_QUANTITY_NEGATIVE', severity: 'ERROR', entityType: 'room', entityId: room.id, message: `${room.roomName} có khối lượng hạng mục ${rawKey} không hợp lệ.`, evidenceIds: [roomEv], details: { category: rawKey, quantity: value } });
        return;
      }
      const explicitId = activeWorkVolumes.some((work) => rawKey === work.id || rawKey === work.workCategoryId) ? rawKey : undefined;
      const resolution = resolveWorkVolumeRef({
        workVolumes: activeWorkVolumes,
        workCategoryId: explicitId,
        workCategoryName: explicitId ? undefined : rawKey,
        floorId: room.floorId,
        floorName: room.floorName,
      });
      if (resolution.state !== 'resolved' && !canonicalSourceKeys.has(rawKey)) {
        addIssue({
          ruleId: resolution.state === 'ambiguous' ? 'ROOM_CATEGORY_REFERENCE_AMBIGUOUS' : 'ROOM_CATEGORY_REFERENCE_INVALID',
          severity: resolution.state === 'ambiguous' ? 'WARNING' : 'ERROR',
          entityType: 'room', entityId: room.id,
          message: `${room.roomName} có categoryVolumes[${rawKey}] không resolve duy nhất theo ID+tầng.`,
          evidenceIds: [roomEv], details: { category: rawKey, resolution: resolution.state, floorId: room.floorId },
        });
      }
    });

    const unfinishedSubItems = (room.subItems || []).filter((sub) => sub.status !== 'Đã hoàn thành');
    (room.subItems || []).filter((sub) => sub.inspectionStatus === 'Đạt nghiệm thu' && sub.status !== 'Đã hoàn thành').forEach((sub) => {
      addIssue({ ruleId: 'INSPECTED_WITH_UNFINISHED_WORK', severity: 'ERROR', entityType: 'room', entityId: room.id, message: `${room.roomName} / ${sub.name} đã Đạt nghiệm thu nhưng thi công chưa hoàn thành.`, evidenceIds: [roomEv], details: { subItemId: sub.id, status: sub.status, inspectionStatus: sub.inspectionStatus } });
    });
    if (room.inspectionStatus === 'Đạt nghiệm thu' && unfinishedSubItems.length > 0) {
      addIssue({ ruleId: 'ROOM_DONE_WITH_UNFINISHED_SUBITEM', severity: 'WARNING', entityType: 'room', entityId: room.id, message: `${room.roomName} đã nghiệm thu tổng nhưng còn hạng mục con chưa hoàn thành.`, evidenceIds: [roomEv], details: { unfinishedSubItemIds: unfinishedSubItems.map((sub) => sub.id) } });
    }
    (room.subItems || []).forEach((sub) => {
      if (sub.workVolume !== undefined && (!isFiniteNumber(sub.workVolume) || sub.workVolume < 0)) {
        addIssue({ ruleId: !isFiniteNumber(sub.workVolume) ? 'SUBITEM_QUANTITY_INVALID' : 'SUBITEM_QUANTITY_NEGATIVE', severity: 'ERROR', entityType: 'room', entityId: room.id, message: `${room.roomName} / ${sub.name} có workVolume không hợp lệ.`, evidenceIds: [roomEv], details: { subItemId: sub.id, workVolume: sub.workVolume } });
      }
    });

    // Unit drift must be visible even when an authoritative ID later fails the
    // floor-aware catalog scope. Never use this raw observation for quantity aggregation.
    if (room.workCategoryId) addCategoryUnit(room.workCategoryId, room.workCategory, room.volumeUnit);

    roomCanonicalEntries.set(room.id, entries);
    entries.forEach((entry) => {
      addCategoryUnit(entry.workCategoryId, entry.workCategoryName, entry.unit);
      if (!workVolumeAppliesToFloor(entry.work, room.floorId, room.floorName)) {
        addIssue({
          ruleId: 'ROOM_WORK_CATEGORY_SCOPE_MISMATCH',
          severity: 'REVIEW',
          entityType: 'room',
          entityId: room.id,
          message: `${room.roomName} đang liên kết hạng mục ${entry.workCategoryName} bằng ID hợp lệ nhưng phạm vi tầng của hạng mục chưa chứa tầng hiện tại. Dữ liệu vẫn được tính theo ID; cần rà lại phạm vi tầng của hạng mục.`,
          evidenceIds: [roomEv, evidenceId('work_volumes', entry.work.id)],
          details: {
            workCategoryId: entry.workCategoryId,
            workVolumeId: entry.work.id,
            roomFloorId: room.floorId,
            roomFloorName: room.floorName || null,
            declaredFloorId: entry.work.floorId || null,
            declaredFloorIds: entry.work.floorIds || [],
            declaredFloorLabel: entry.work.floor || null,
          },
        });
      }
    });
  });

  categoryUnits.forEach((bucket, id) => {
    if (bucket.units.size > 1) {
      addIssue({ ruleId: 'MIXED_UNIT_SAME_WORK_ITEM', severity: 'WARNING', entityType: 'quantity', entityId: id, message: `Cùng một hạng mục đang dùng nhiều đơn vị: ${Array.from(bucket.units).join(', ')}. Không được cộng chung các đơn vị này.`, evidenceIds: [], details: { workItemNames: Array.from(bucket.names), units: Array.from(bucket.units) } });
    }
  });

  // Compare each WorkVolume exactly once across its whole floor scope. A multi-floor
  // planned quantity is not compared independently against every floor.
  activeWorkVolumes.forEach((contract) => {
    if (!isFiniteNumber(contract.planned) || contract.planned < 0) return;
    const categoryId = canonicalWorkCategoryId(contract);
    if (!categoryId) return;
    const contractUnit = normalizeUnit(contract.unit || '') || contract.unit || '';
    let roomSum = 0;
    const roomEvidenceIds: string[] = [];
    activeRooms.forEach((room) => {
      const entry = (roomCanonicalEntries.get(room.id) || []).find((item) => item.workCategoryId === categoryId && unitKey(item.unit) === unitKey(contractUnit));
      if (!entry) return;
      roomSum += Number(entry.quantity) || 0;
      roomEvidenceIds.push(evidenceId('rooms', room.id));
    });
    const contractEv = evidenceId('work_volumes', contract.id);
    if (!nearlyEqual(roomSum, contract.planned)) {
      addIssue({
        ruleId: 'FLOOR_ROOM_SUM_MISMATCH', severity: 'REVIEW', entityType: 'quantity', entityId: contract.id,
        message: `Tổng khối lượng Căn/Phòng của ${contract.title} trên toàn phạm vi tầng không bằng khối lượng planned.`,
        evidenceIds: [contractEv, ...roomEvidenceIds],
        details: { floorIds: [contract.floorId, ...(contract.floorIds || [])].filter(Boolean), roomSum: Math.round(roomSum * 10000) / 10000, planned: contract.planned, unit: contractUnit },
      });
    }
    if (roomSum > contract.planned && !nearlyEqual(roomSum, contract.planned)) {
      addIssue({
        ruleId: 'ROOM_ASSIGNED_GT_CONTRACT', severity: 'WARNING', entityType: 'quantity', entityId: contract.id,
        message: `Tổng khối lượng đã gán cho Căn/Phòng vượt planned của ${contract.title} trên toàn phạm vi tầng.`,
        evidenceIds: [contractEv, ...roomEvidenceIds],
        details: { roomSum, planned: contract.planned, unit: contractUnit },
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
      'Mỗi WorkVolume được so với tổng Căn/Phòng canonical trên toàn floorIds/floorId của chính record; record nhiều tầng chỉ được so một lần sau khi cộng toàn scope.',
      'RoomSubItem.workVolume không bị cộng để suy diễn tổng hạng mục vì các công đoạn tuần tự có thể dùng cùng một diện tích và cộng trực tiếp sẽ double count.',
      'Đơn vị chỉ được chuẩn hóa ký hiệu; không có phép quy đổi m², m, kg, bộ... giữa nhau.',
    ],
  };
}
