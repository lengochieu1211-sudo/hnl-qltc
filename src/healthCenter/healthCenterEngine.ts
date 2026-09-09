import type { DefectItem, CrewRecord, RoomProgressItem } from '../types';
import type { AiQueryContext, AiAuditIssue } from '../ai/core/contracts';
import type { HnlAiProjectSnapshot } from '../ai/data/projectSnapshot';
import { auditProjectIntegrity } from '../ai/audit/projectAudit';
import { normalizeEntityText } from '../ai/core/entityResolver';
import type { RuntimeDiagnosticEntry } from '../lib/runtimeDiagnostics';

export type HealthCenterModule =
  | 'system'
  | 'firebase'
  | 'r2'
  | 'sync'
  | 'rooms'
  | 'defects'
  | 'crew'
  | 'quantities'
  | 'inventory'
  | 'materialNorms'
  | 'checklist'
  | 'links';

export type HealthCenterSeverity = 'ERROR' | 'WARNING' | 'REVIEW' | 'SUGGESTION';
export type HealthCenterActionClass = 'SAFE_REPAIR_CANDIDATE' | 'NEEDS_CONFIRMATION' | 'MANUAL_REPAIR' | 'READ_ONLY';

export interface HealthCenterLocation {
  date?: string;
  teamId?: string;
  teamName?: string;
  floorId?: string;
  floorName?: string;
  roomId?: string;
  roomName?: string;
  shift?: string;
  workItem?: string;
}

export interface HealthCenterIssue {
  id: string;
  ruleId: string;
  severity: HealthCenterSeverity;
  module: HealthCenterModule;
  entityType: string;
  entityId: string;
  message: string;
  actionClass: HealthCenterActionClass;
  evidenceIds: string[];
  location: HealthCenterLocation;
  details: Record<string, unknown>;
}

export interface HealthCenterSummary {
  auditSnapshotId: string;
  projectId: string;
  generatedAt: number;
  freshness: HnlAiProjectSnapshot['freshness'];
  recordsScanned: number;
  errorCount: number;
  warningCount: number;
  reviewCount: number;
  suggestionCount: number;
  safeRepairCount: number;
  needsConfirmationCount: number;
  manualRepairCount: number;
  technicalIssueCount: number;
  businessIssueCount: number;
  issues: HealthCenterIssue[];
}

export interface BuildHealthCenterParams {
  context: AiQueryContext;
  snapshot: HnlAiProjectSnapshot;
  runtimeLog?: RuntimeDiagnosticEntry[];
}

function active<T extends { deletedAt?: number | null }>(items: readonly T[]): T[] {
  return items.filter((item) => item.deletedAt === undefined || item.deletedAt === null);
}

function canonicalDateParts(year: number, month: number, day: number): string {
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Health Center business dates follow HNL/Vietnam DMY semantics for slash/dash
 * display strings. Do not delegate ambiguous dd/mm/yyyy strings to JS Date,
 * because e.g. "15:22:15 11/8/2026" can otherwise be interpreted as Nov 8.
 */
function normalizeDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN;
    if (Number.isFinite(millis)) {
      const parsed = new Date(millis);
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
    }
  }
  if (typeof value === 'object') {
    const seconds = Number((value as { seconds?: unknown }).seconds);
    if (Number.isFinite(seconds) && seconds > 0) {
      const parsed = new Date(seconds * 1000);
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
    }
  }
  const raw = String(value).trim();
  if (!raw) return '';
  const canonical = raw.match(/(?:^|\s)(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
  if (canonical) return canonicalDateParts(Number(canonical[1]), Number(canonical[2]), Number(canonical[3]));
  const dmy = raw.match(/(?:^|\s)(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s|$)/);
  if (dmy) return canonicalDateParts(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
}

function issueModule(issue: AiAuditIssue): HealthCenterModule {
  if (issue.entityType === 'defect') return 'defects';
  if (issue.entityType === 'crew') return 'crew';
  if (issue.entityType === 'quantity') return 'quantities';
  if (issue.entityType === 'room' || issue.entityType === 'floor') return 'rooms';
  if (issue.entityType === 'team') return 'links';
  if (/INVENTORY/i.test(issue.ruleId)) return 'inventory';
  if (/MATERIAL_NORM/i.test(issue.ruleId)) return 'materialNorms';
  if (/CHECKLIST/i.test(issue.ruleId)) return 'checklist';
  return 'links';
}

function defaultActionClass(issue: AiAuditIssue): HealthCenterActionClass {
  const explicit = String(issue.details?.actionClass || '');
  if (explicit === 'SAFE_REPAIR_CANDIDATE' || explicit === 'NEEDS_CONFIRMATION' || explicit === 'MANUAL_REPAIR' || explicit === 'READ_ONLY') {
    return explicit;
  }
  if (/(_ID_MISSING|_NAME_MISMATCH)$/.test(issue.ruleId)) return 'SAFE_REPAIR_CANDIDATE';
  if (issue.severity === 'REVIEW') return 'NEEDS_CONFIRMATION';
  if (issue.severity === 'ERROR') return 'MANUAL_REPAIR';
  return 'READ_ONLY';
}

function roomFromIssue(issue: AiAuditIssue, rooms: Map<string, RoomProgressItem>): RoomProgressItem | undefined {
  const direct = rooms.get(issue.entityId);
  if (direct) return direct;
  const detailRoomId = String(issue.details?.roomId || '').trim();
  if (detailRoomId && rooms.has(detailRoomId)) return rooms.get(detailRoomId);
  for (const evidenceId of issue.evidenceIds || []) {
    if (!evidenceId.startsWith('rooms:')) continue;
    const id = evidenceId.slice('rooms:'.length);
    if (rooms.has(id)) return rooms.get(id);
  }
  const prefix = issue.entityId.split(':')[0];
  return rooms.get(prefix);
}

function buildLocation(issue: AiAuditIssue, snapshot: HnlAiProjectSnapshot): HealthCenterLocation {
  const details = issue.details || {};
  const floors = new Map(active(snapshot.floors).map((x) => [x.id, x]));
  const teams = new Map(active(snapshot.teams).map((x) => [x.id, x]));
  const rooms = new Map(active(snapshot.rooms).map((x) => [x.id, x]));
  const location: HealthCenterLocation = {
    date: String(details.date || details.completedAt || '').trim() || undefined,
    teamId: String(details.teamId || details.candidateTeamId || '').trim() || undefined,
    teamName: String(details.teamName || details.assignedTo || '').trim() || undefined,
    floorId: String(details.floorId || details.defectFloorId || '').trim() || undefined,
    floorName: String(details.floorName || details.currentFloorName || '').trim() || undefined,
    roomId: String(details.roomId || '').trim() || undefined,
    roomName: String(details.roomName || '').trim() || undefined,
    shift: String(details.shift || '').trim() || undefined,
    workItem: String(details.workItem || details.categoryName || '').trim() || undefined,
  };
  const issueRoom = roomFromIssue(issue, rooms);
  if (issueRoom) {
    location.roomId ||= issueRoom.id;
    location.roomName ||= issueRoom.roomName;
    location.floorId ||= issueRoom.floorId;
    location.floorName ||= issueRoom.floorName;
    location.teamId ||= issueRoom.teamId;
    location.teamName ||= issueRoom.assignedTeam;
  }
  if (location.floorId && !location.floorName) location.floorName = floors.get(location.floorId)?.floorName;
  if (location.teamId && !location.teamName) location.teamName = teams.get(location.teamId)?.name;
  if (location.roomId && !location.roomName) location.roomName = rooms.get(location.roomId)?.roomName;
  return location;
}

function recordHasMultiFloorSummary(record: CrewRecord, snapshot: HnlAiProjectSnapshot): boolean {
  const activeFloors = active(snapshot.floors);
  const floorWorkIds = new Set((record.floorWorks || []).map((work) => String(work.floorId || '').trim()).filter(Boolean));
  if (floorWorkIds.size > 1) return true;

  const rawNames = String(record.floorName || '')
    .split(/[,;|]/)
    .map((part) => normalizeEntityText(part))
    .filter(Boolean);
  if (rawNames.length < 2) return false;
  const knownNames = new Set(activeFloors.map((floor) => normalizeEntityText(floor.floorName)));
  return new Set(rawNames.filter((name) => knownNames.has(name))).size > 1;
}

function suppressCoreIssue(issue: AiAuditIssue, snapshot: HnlAiProjectSnapshot): boolean {
  if (issue.ruleId !== 'CREW_FLOOR_ID_NAME_MISMATCH' || issue.entityType !== 'crew') return false;
  const record = active(snapshot.crewRecords).find((item) => item.id === issue.entityId);
  if (!record || !recordHasMultiFloorSummary(record, snapshot)) return false;
  const currentFloorName = normalizeEntityText(String(issue.details?.currentFloorName || ''));
  const savedNames = String(record.floorName || '').split(/[,;|]/).map((part) => normalizeEntityText(part)).filter(Boolean);
  const floorWorkNames = (record.floorWorks || []).map((work) => normalizeEntityText(String(work.floorName || ''))).filter(Boolean);
  return Boolean(currentFloorName) && [...savedNames, ...floorWorkNames].includes(currentFloorName);
}

function wrapCoreIssue(issue: AiAuditIssue, snapshot: HnlAiProjectSnapshot, index: number): HealthCenterIssue {
  return {
    id: `core:${issue.ruleId}:${issue.entityType}:${issue.entityId}:${index}`,
    ruleId: issue.ruleId,
    severity: issue.severity,
    module: issueModule(issue),
    entityType: issue.entityType,
    entityId: issue.entityId,
    message: issue.message,
    actionClass: defaultActionClass(issue),
    evidenceIds: [...issue.evidenceIds],
    location: buildLocation(issue, snapshot),
    details: { ...(issue.details || {}), source: 'business-audit-core' },
  };
}

function makeIssue(input: Omit<HealthCenterIssue, 'id'>): HealthCenterIssue {
  return {
    ...input,
    id: `health:${input.ruleId}:${input.entityType}:${input.entityId}`,
  };
}

function defectLifecycleIssues(defects: DefectItem[]): HealthCenterIssue[] {
  const issues: HealthCenterIssue[] = [];
  active(defects).forEach((defect) => {
    const created = normalizeDate(defect.createdAt);
    const completed = normalizeDate(defect.completedAt);
    const due = normalizeDate(defect.dueDate);
    const baseLocation: HealthCenterLocation = {
      date: completed || created || undefined,
      teamId: defect.teamId,
      teamName: defect.assignedTo,
      floorId: defect.floorId,
      floorName: defect.floorName,
      roomId: defect.roomId,
      workItem: defect.category,
    };
    if ((defect.status === 'Đã khắc phục' || defect.status === 'Đã nghiệm thu') && !completed) {
      issues.push(makeIssue({
        ruleId: 'DEFECT_CLOSED_WITHOUT_COMPLETED_AT', severity: 'WARNING', module: 'defects', entityType: 'defect', entityId: defect.id,
        message: `Defect ${defect.description || defect.id} đã ở trạng thái “${defect.status}” nhưng chưa có ngày hoàn thành.`,
        actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`defects:${defect.id}`], location: baseLocation,
        details: { status: defect.status, createdAt: defect.createdAt, completedAt: defect.completedAt || null },
      }));
    }
    if (created && completed && completed < created) {
      issues.push(makeIssue({
        ruleId: 'DEFECT_COMPLETED_BEFORE_CREATED', severity: 'ERROR', module: 'defects', entityType: 'defect', entityId: defect.id,
        message: `Defect ${defect.description || defect.id} có ngày hoàn thành ${completed} trước ngày tạo ${created}.`,
        actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`defects:${defect.id}`], location: baseLocation,
        details: { createdAt: defect.createdAt, completedAt: defect.completedAt },
      }));
    }
    if (created && due && due < created) {
      issues.push(makeIssue({
        ruleId: 'DEFECT_DUE_BEFORE_CREATED', severity: 'WARNING', module: 'defects', entityType: 'defect', entityId: defect.id,
        message: `Defect ${defect.description || defect.id} có hạn xử lý ${due} trước ngày tạo ${created}.`,
        actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`defects:${defect.id}`], location: baseLocation,
        details: { createdAt: defect.createdAt, dueDate: defect.dueDate },
      }));
    }
  });
  return issues;
}

function crewQualityIssues(crewRecords: CrewRecord[], snapshot: HnlAiProjectSnapshot): HealthCenterIssue[] {
  const issues: HealthCenterIssue[] = [];
  const floors = new Map(active(snapshot.floors).map((x) => [x.id, x]));
  active(crewRecords).forEach((record) => {
    const location: HealthCenterLocation = {
      date: record.date,
      teamId: record.teamId,
      teamName: record.teamName,
      floorId: record.floorId,
      floorName: record.floorName,
      shift: record.shift,
      workItem: record.taskDescription,
    };
    const task = String(record.taskDescription || '').trim();
    if (!task) {
      issues.push(makeIssue({
        ruleId: 'CREW_TASK_EMPTY', severity: 'WARNING', module: 'crew', entityType: 'crew', entityId: record.id,
        message: `Nhật ký quân số ${record.date} · ${record.teamName} chưa có mô tả công việc.`,
        actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`crew_records:${record.id}`], location,
        details: { date: record.date, teamId: record.teamId, teamName: record.teamName, floorId: record.floorId, floorName: record.floorName },
      }));
    } else if (/\(\s*\)/.test(task)) {
      issues.push(makeIssue({
        ruleId: 'CREW_TASK_EMPTY_DETAIL', severity: 'WARNING', module: 'crew', entityType: 'crew', entityId: record.id,
        message: `Nhật ký quân số ${record.date} · ${record.teamName} có chi tiết công việc rỗng “()”.`,
        actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`crew_records:${record.id}`], location,
        details: { date: record.date, teamId: record.teamId, teamName: record.teamName, taskDescription: record.taskDescription },
      }));
    }
    const seenFloorIds = new Set<string>();
    (record.floorWorks || []).forEach((floorWork, floorIndex) => {
      if (!floorWork.floorId || !floors.has(floorWork.floorId)) {
        issues.push(makeIssue({
          ruleId: 'CREW_FLOOR_WORK_FLOOR_NOT_FOUND', severity: 'ERROR', module: 'crew', entityType: 'crew', entityId: `${record.id}:${floorIndex}`,
          message: `Nhật ký ${record.date} · ${record.teamName} có floorWorks tham chiếu tầng không tồn tại.`,
          actionClass: 'MANUAL_REPAIR', evidenceIds: [`crew_records:${record.id}`],
          location: { ...location, floorId: floorWork.floorId, floorName: floorWork.floorName },
          details: { recordId: record.id, floorWorkIndex: floorIndex, floorId: floorWork.floorId, floorName: floorWork.floorName },
        }));
      } else {
        const floor = floors.get(floorWork.floorId)!;
        if (floorWork.floorName && floorWork.floorName.trim() !== floor.floorName.trim()) {
          issues.push(makeIssue({
            ruleId: 'CREW_FLOOR_WORK_NAME_MISMATCH', severity: 'WARNING', module: 'crew', entityType: 'crew', entityId: `${record.id}:${floorIndex}`,
            message: `Nhật ký ${record.date} · ${record.teamName} có tên tầng trong floorWorks không khớp floorId.`,
            actionClass: 'SAFE_REPAIR_CANDIDATE', evidenceIds: [`crew_records:${record.id}`, `floor_plans:${floor.id}`],
            location: { ...location, floorId: floor.id, floorName: floor.floorName },
            details: { recordId: record.id, savedFloorName: floorWork.floorName, currentFloorName: floor.floorName, floorId: floor.id },
          }));
        }
      }
      if (floorWork.floorId && seenFloorIds.has(floorWork.floorId)) {
        issues.push(makeIssue({
          ruleId: 'CREW_FLOOR_WORK_DUPLICATE_FLOOR', severity: 'REVIEW', module: 'crew', entityType: 'crew', entityId: `${record.id}:${floorIndex}:duplicate`,
          message: `Nhật ký ${record.date} · ${record.teamName} lặp cùng một tầng nhiều lần trong floorWorks; cần kiểm tra có phải tách công việc hợp lệ hay trùng dữ liệu.`,
          actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`crew_records:${record.id}`], location,
          details: { recordId: record.id, floorId: floorWork.floorId },
        }));
      }
      if (floorWork.floorId) seenFloorIds.add(floorWork.floorId);
      (floorWork.categories || []).forEach((category, categoryIndex) => {
        if (!String(category.categoryName || '').trim()) {
          issues.push(makeIssue({
            ruleId: 'CREW_FLOOR_WORK_CATEGORY_EMPTY', severity: 'WARNING', module: 'crew', entityType: 'crew', entityId: `${record.id}:${floorIndex}:${categoryIndex}`,
            message: `Nhật ký ${record.date} · ${record.teamName} có hạng mục floorWorks chưa có tên.`,
            actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`crew_records:${record.id}`], location,
            details: { recordId: record.id, floorWorkIndex: floorIndex, categoryIndex },
          }));
        }
      });
    });
  });
  return issues;
}

function roomQualityIssues(rooms: RoomProgressItem[]): HealthCenterIssue[] {
  const issues: HealthCenterIssue[] = [];
  active(rooms).forEach((room) => {
    const seenSubIds = new Set<string>();
    (room.subItems || []).forEach((sub, index) => {
      if (!String(sub.name || '').trim()) {
        issues.push(makeIssue({
          ruleId: 'ROOM_SUBITEM_NAME_EMPTY', severity: 'WARNING', module: 'rooms', entityType: 'room', entityId: `${room.id}:${index}`,
          message: `${room.roomName} có hạng mục con chưa có tên.`, actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`rooms:${room.id}`],
          location: { floorId: room.floorId, floorName: room.floorName, roomId: room.id, roomName: room.roomName, teamId: sub.teamId || room.teamId, teamName: sub.assignedTeam || room.assignedTeam },
          details: { roomId: room.id, subItemIndex: index, subItemId: sub.id },
        }));
      }
      if (sub.id && seenSubIds.has(sub.id)) {
        issues.push(makeIssue({
          ruleId: 'ROOM_SUBITEM_DUPLICATE_ID', severity: 'ERROR', module: 'rooms', entityType: 'room', entityId: `${room.id}:${sub.id}`,
          message: `${room.roomName} có nhiều hạng mục con trùng id ${sub.id}.`, actionClass: 'MANUAL_REPAIR', evidenceIds: [`rooms:${room.id}`],
          location: { floorId: room.floorId, floorName: room.floorName, roomId: room.id, roomName: room.roomName },
          details: { roomId: room.id, subItemId: sub.id },
        }));
      }
      if (sub.id) seenSubIds.add(sub.id);
    });
  });
  return issues;
}

function lightweightBusinessQualityIssues(snapshot: HnlAiProjectSnapshot): HealthCenterIssue[] {
  const issues: HealthCenterIssue[] = [];
  const activeWorkVolumes = active(snapshot.workVolumes);
  const activeWorkVolumeIds = new Set(activeWorkVolumes.flatMap((item) => [item.id, item.workCategoryId].filter(Boolean) as string[]));
  const activeWorkVolumeNames = new Set(activeWorkVolumes.map((item) => normalizeEntityText(item.title)).filter(Boolean));
  const isKnownWorkCategory = (workCategoryId?: string, workCategoryName?: string): boolean => {
    const id = String(workCategoryId || '').trim();
    if (id) return activeWorkVolumeIds.has(id);
    const name = normalizeEntityText(String(workCategoryName || ''));
    return !name || activeWorkVolumeNames.has(name);
  };

  active(snapshot.rooms).forEach((room) => {
    const orphanRefs = new Map<string, { source: string; workCategoryId?: string; workCategoryName?: string }>();
    const addOrphan = (source: string, workCategoryId?: string, workCategoryName?: string) => {
      const id = String(workCategoryId || '').trim();
      const name = String(workCategoryName || '').trim();
      if ((!id && !name) || isKnownWorkCategory(id, name)) return;
      const key = id ? `id:${id}` : `name:${normalizeEntityText(name)}`;
      if (!orphanRefs.has(key)) orphanRefs.set(key, { source, workCategoryId: id || undefined, workCategoryName: name || undefined });
    };

    if ((Number(room.workVolume) || 0) > 0) addOrphan('room', room.workCategoryId, room.workCategory);
    Object.entries(room.categoryVolumes || {}).forEach(([raw, volume]) => {
      if ((Number(volume) || 0) <= 0) return;
      const rawId = activeWorkVolumeIds.has(raw) ? raw : '';
      addOrphan('categoryVolumes', rawId, rawId ? '' : raw);
    });
    (room.subItems || []).forEach((sub) => {
      if (sub.workCategoryId) addOrphan('subItem', sub.workCategoryId, sub.category);
      else if ((Number(sub.workVolume) || 0) > 0) addOrphan('subItem', undefined, sub.category);
    });

    if (orphanRefs.size > 0) {
      const refs = Array.from(orphanRefs.values());
      const labels = refs.map((ref) => ref.workCategoryName || ref.workCategoryId || 'Hạng mục không xác định');
      issues.push(makeIssue({
        ruleId: 'ROOM_ORPHAN_WORK_CATEGORY_REFERENCE', severity: 'WARNING', module: 'links', entityType: 'room', entityId: room.id,
        message: `${room.roomName} còn tham chiếu hạng mục đã xoá/không còn tồn tại: ${labels.join(', ')}. Không dùng tham chiếu này để tính vật tư.`,
        actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`rooms:${room.id}`],
        location: { floorId: room.floorId, floorName: room.floorName, roomId: room.id, roomName: room.roomName, workItem: labels[0] },
        details: { roomId: room.id, orphanWorkCategoryRefs: refs },
      }));
    }
  });
  active(snapshot.inventory).forEach((item) => {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      issues.push(makeIssue({
        ruleId: 'INVENTORY_QUANTITY_NON_POSITIVE', severity: 'ERROR', module: 'inventory', entityType: 'inventory', entityId: item.id,
        message: `Giao dịch kho ${item.id} có số lượng không hợp lệ (${item.quantity}).`, actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`inventory:${item.id}`],
        location: { date: item.date, workItem: item.materialName }, details: { type: item.type, quantity: item.quantity, unit: item.unit, date: item.date },
      }));
    }
  });
  active(snapshot.materialNorms).forEach((norm) => {
    const linkedWorkCategoryIds = Array.from(new Set([...(norm.workCategoryIds || []), ...(norm.workCategoryId ? [norm.workCategoryId] : [])].filter(Boolean)));
    const orphanWorkCategoryIds = linkedWorkCategoryIds.filter((id) => !activeWorkVolumeIds.has(id));
    if (orphanWorkCategoryIds.length > 0) {
      issues.push(makeIssue({
        ruleId: 'MATERIAL_NORM_ORPHAN_WORK_CATEGORY', severity: 'WARNING', module: 'materialNorms', entityType: 'materialNorm', entityId: norm.id,
        message: `Định mức ${norm.materialName || norm.id} còn liên kết tới hạng mục đã xoá/không còn tồn tại.`, actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`material_norms:${norm.id}`], location: { workItem: norm.materialName },
        details: { workCategoryId: norm.workCategoryId || null, workCategoryIds: norm.workCategoryIds || [], orphanWorkCategoryIds },
      }));
    }
    if (!String(norm.materialName || '').trim() || !String(norm.unit || '').trim()) {
      issues.push(makeIssue({
        ruleId: 'MATERIAL_NORM_REQUIRED_FIELD_MISSING', severity: 'ERROR', module: 'materialNorms', entityType: 'materialNorm', entityId: norm.id,
        message: `Định mức ${norm.id} thiếu tên vật tư hoặc đơn vị.`, actionClass: 'MANUAL_REPAIR', evidenceIds: [`material_norms:${norm.id}`], location: { workItem: norm.materialName },
        details: { materialName: norm.materialName, unit: norm.unit },
      }));
    }
    if (!Number.isFinite(norm.quotaQuantity) || norm.quotaQuantity < 0 || (norm.unitNormPerM2 !== undefined && (!Number.isFinite(norm.unitNormPerM2) || norm.unitNormPerM2 < 0))) {
      issues.push(makeIssue({
        ruleId: 'MATERIAL_NORM_NEGATIVE_OR_INVALID', severity: 'ERROR', module: 'materialNorms', entityType: 'materialNorm', entityId: norm.id,
        message: `Định mức ${norm.materialName || norm.id} có giá trị số âm hoặc không hợp lệ.`, actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`material_norms:${norm.id}`], location: { workItem: norm.materialName },
        details: { quotaQuantity: norm.quotaQuantity, unitNormPerM2: norm.unitNormPerM2 },
      }));
    }
  });
  active(snapshot.checklist).forEach((item) => {
    if (item.status === 'passed' && !String(item.inspectedAt || '').trim()) {
      issues.push(makeIssue({
        ruleId: 'CHECKLIST_PASSED_WITHOUT_INSPECTED_AT', severity: 'REVIEW', module: 'checklist', entityType: 'checklist', entityId: item.id,
        message: `Checklist ${item.title} đã đạt nhưng chưa có thời điểm nghiệm thu/kiểm tra.`, actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`checklist:${item.id}`],
        location: { floorId: item.floorId, floorName: item.floorName, roomId: item.roomId, teamId: item.teamId, workItem: item.title }, details: { status: item.status, inspectedAt: item.inspectedAt || null },
      }));
    }
    if (item.status === 'pending' && String(item.inspectedAt || '').trim()) {
      issues.push(makeIssue({
        ruleId: 'CHECKLIST_PENDING_WITH_INSPECTED_AT', severity: 'REVIEW', module: 'checklist', entityType: 'checklist', entityId: item.id,
        message: `Checklist ${item.title} còn pending nhưng đã có thời điểm kiểm tra ${item.inspectedAt}.`, actionClass: 'NEEDS_CONFIRMATION', evidenceIds: [`checklist:${item.id}`],
        location: { floorId: item.floorId, floorName: item.floorName, roomId: item.roomId, teamId: item.teamId, workItem: item.title }, details: { status: item.status, inspectedAt: item.inspectedAt },
      }));
    }
  });
  return issues;
}

function runtimeIssues(runtimeLog: RuntimeDiagnosticEntry[]): HealthCenterIssue[] {
  return runtimeLog.slice(-80).filter((entry) => entry.level !== 'info').map((entry, index) => {
    const area = String(entry.area || '').toLowerCase();
    const module: HealthCenterModule = area.includes('r2') || area.includes('photo') ? 'r2'
      : area.includes('firebase') || area.includes('firestore') || area.includes('auth') ? 'firebase'
      : area.includes('sync') || area.includes('offline') ? 'sync' : 'system';
    return {
      id: `runtime:${entry.at}:${index}`,
      ruleId: entry.code || `RUNTIME_${entry.level.toUpperCase()}`,
      severity: entry.level === 'error' ? 'ERROR' : 'WARNING',
      module,
      entityType: 'runtime',
      entityId: String(entry.at),
      message: entry.message,
      actionClass: 'READ_ONLY',
      evidenceIds: [],
      location: {},
      details: { at: entry.at, area: entry.area, projectId: entry.projectId || null },
    };
  });
}

function dedupeIssues(items: HealthCenterIssue[]): HealthCenterIssue[] {
  const seen = new Set<string>();
  const out: HealthCenterIssue[] = [];
  items.forEach((item) => {
    const key = `${item.ruleId}|${item.entityType}|${item.entityId}|${item.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

export function buildHealthCenterReport(params: BuildHealthCenterParams): HealthCenterSummary {
  const { context, snapshot, runtimeLog = [] } = params;
  const core = auditProjectIntegrity({ context, snapshot });
  const coreIssues = (core.data?.issues || [])
    .filter((issue) => !suppressCoreIssue(issue, snapshot))
    .map((issue, index) => wrapCoreIssue(issue, snapshot, index));
  const issues = dedupeIssues([
    ...coreIssues,
    ...defectLifecycleIssues([...snapshot.defects]),
    ...crewQualityIssues([...snapshot.crewRecords], snapshot),
    ...roomQualityIssues([...snapshot.rooms]),
    ...lightweightBusinessQualityIssues(snapshot),
    ...runtimeIssues(runtimeLog),
    ...(snapshot.freshness === 'cache' ? [makeIssue({
      ruleId: 'HEALTH_CENTER_USING_CACHED_SNAPSHOT', severity: 'WARNING', module: 'sync', entityType: 'project', entityId: snapshot.projectId,
      message: 'Health Center đang kiểm tra snapshot cache; nên đồng bộ lại trước khi dùng kết quả làm báo cáo cuối.', actionClass: 'READ_ONLY', evidenceIds: [], location: {},
      details: { freshness: snapshot.freshness, asOf: snapshot.asOf },
    })] : []),
  ]);
  const recordsScanned = snapshot.rooms.length + snapshot.defects.length + snapshot.crewRecords.length + snapshot.teams.length
    + snapshot.floors.length + snapshot.workVolumes.length + snapshot.inventory.length + snapshot.materialNorms.length + snapshot.checklist.length;
  const auditSnapshotId = `hc-${snapshot.projectId}-${snapshot.asOf}-${recordsScanned}-${issues.length}`;
  return {
    auditSnapshotId,
    projectId: snapshot.projectId,
    generatedAt: Date.now(),
    freshness: snapshot.freshness,
    recordsScanned,
    errorCount: issues.filter((x) => x.severity === 'ERROR').length,
    warningCount: issues.filter((x) => x.severity === 'WARNING').length,
    reviewCount: issues.filter((x) => x.severity === 'REVIEW').length,
    suggestionCount: issues.filter((x) => x.severity === 'SUGGESTION').length,
    safeRepairCount: issues.filter((x) => x.actionClass === 'SAFE_REPAIR_CANDIDATE').length,
    needsConfirmationCount: issues.filter((x) => x.actionClass === 'NEEDS_CONFIRMATION').length,
    manualRepairCount: issues.filter((x) => x.actionClass === 'MANUAL_REPAIR').length,
    technicalIssueCount: issues.filter((x) => ['system', 'firebase', 'r2', 'sync'].includes(x.module)).length,
    businessIssueCount: issues.filter((x) => !['system', 'firebase', 'r2', 'sync'].includes(x.module)).length,
    issues,
  };
}

export function serializeHealthCenterReportJson(report: HealthCenterSummary): string {
  return JSON.stringify({
    format: 'HNL-QLTC-HEALTH-CENTER',
    schemaVersion: 1,
    ...report,
  }, null, 2);
}
