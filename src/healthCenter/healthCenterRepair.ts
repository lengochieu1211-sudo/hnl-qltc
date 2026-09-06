import type { HealthCenterIssue, HealthCenterSummary } from './healthCenterEngine';

export type HealthCenterRepairTarget = 'defects' | 'crewRecords';
export type HealthCenterRepairKind = 'SET_FIELD' | 'SET_NESTED_FIELD';

export interface HealthCenterRepairOperation {
  id: string;
  issueId: string;
  ruleId: string;
  target: HealthCenterRepairTarget;
  entityId: string;
  kind: HealthCenterRepairKind;
  path: string;
  before: unknown;
  after: unknown;
  reason: string;
  confidence: 'deterministic-unique';
  requiresBackup: true;
}

export interface HealthCenterRepairBlockedItem {
  issueId: string;
  ruleId: string;
  entityId: string;
  reason: string;
}

export interface HealthCenterRepairPreview {
  auditSnapshotId: string;
  generatedAt: number;
  sourceIssueCount: number;
  operations: HealthCenterRepairOperation[];
  blocked: HealthCenterRepairBlockedItem[];
  requiresBackup: boolean;
  requiresConfirmation: boolean;
  canApply: boolean;
}

const text = (value: unknown): string => String(value ?? '').trim();

function setFieldOperation(
  issue: HealthCenterIssue,
  target: HealthCenterRepairTarget,
  path: string,
  before: unknown,
  after: unknown,
  reason: string,
): HealthCenterRepairOperation | null {
  if (!text(after)) return null;
  if (before === after) return null;
  return {
    id: `repair:${issue.id}:${path}`,
    issueId: issue.id,
    ruleId: issue.ruleId,
    target,
    entityId: issue.entityId.split(':')[0],
    kind: path.includes('.') ? 'SET_NESTED_FIELD' : 'SET_FIELD',
    path,
    before,
    after,
    reason,
    confidence: 'deterministic-unique',
    requiresBackup: true,
  };
}

function operationForSafeIssue(issue: HealthCenterIssue): HealthCenterRepairOperation | null {
  if (issue.actionClass !== 'SAFE_REPAIR_CANDIDATE') return null;
  const d = issue.details || {};

  if (issue.ruleId === 'DEFECT_ROOM_ID_MISSING') {
    return setFieldOperation(
      issue,
      'defects',
      'roomId',
      d.roomId ?? '',
      d.candidateRoomId,
      'Tọa độ Defect chỉ nằm trong đúng một căn/phòng; audit đã xác định candidateRoomId duy nhất.',
    );
  }

  if (issue.ruleId === 'DEFECT_TEAM_ID_MISSING') {
    return setFieldOperation(
      issue,
      'defects',
      'teamId',
      d.teamId ?? '',
      d.candidateTeamId,
      'assignedTo resolve chính xác tới đúng một đội; bổ sung durable teamId, không đổi tên đội.',
    );
  }

  if (issue.ruleId === 'CREW_TEAM_ID_MISSING') {
    return setFieldOperation(
      issue,
      'crewRecords',
      'teamId',
      d.teamId ?? '',
      d.candidateTeamId,
      'teamName resolve chính xác tới đúng một đội; bổ sung durable teamId.',
    );
  }

  if (issue.ruleId === 'CREW_FLOOR_ID_NAME_MISMATCH') {
    return setFieldOperation(
      issue,
      'crewRecords',
      'floorName',
      d.savedFloorName,
      d.currentFloorName,
      'floorId vẫn hợp lệ và duy nhất; chỉ đồng bộ tên tầng hiển thị theo floorId hiện tại.',
    );
  }

  if (issue.ruleId === 'CREW_FLOOR_WORK_NAME_MISMATCH') {
    const floorWorkIndex = Number(d.floorWorkIndex);
    if (!Number.isInteger(floorWorkIndex) || floorWorkIndex < 0) return null;
    return setFieldOperation(
      issue,
      'crewRecords',
      `floorWorks.${floorWorkIndex}.floorName`,
      d.savedFloorName,
      d.currentFloorName,
      'floorWorks.floorId vẫn hợp lệ và duy nhất; chỉ đồng bộ tên tầng hiển thị.',
    );
  }

  return null;
}

function blockedReason(issue: HealthCenterIssue): string {
  if (issue.actionClass === 'MANUAL_REPAIR') return 'Lỗi cần sửa thủ công; Health Center không được tự đoán dữ liệu thay thế.';
  if (issue.actionClass === 'NEEDS_CONFIRMATION') return 'Dữ liệu có nhiều khả năng hợp lệ hoặc mâu thuẫn nghiệp vụ; cần người dùng xác nhận.';
  if (issue.actionClass === 'READ_ONLY') return 'Issue chỉ dùng để chẩn đoán; không có thao tác ghi dữ liệu an toàn.';
  return 'Rule chưa có repair strategy deterministic được chứng nhận.';
}

export function buildHealthCenterRepairPreview(
  report: HealthCenterSummary,
  selectedIssueIds?: readonly string[],
): HealthCenterRepairPreview {
  const selected = selectedIssueIds?.length
    ? report.issues.filter((issue) => selectedIssueIds.includes(issue.id))
    : report.issues;

  const operations: HealthCenterRepairOperation[] = [];
  const blocked: HealthCenterRepairBlockedItem[] = [];
  const seenTargets = new Set<string>();

  selected.forEach((issue) => {
    const op = operationForSafeIssue(issue);
    if (!op) {
      if (issue.actionClass === 'SAFE_REPAIR_CANDIDATE' || issue.actionClass === 'NEEDS_CONFIRMATION' || issue.actionClass === 'MANUAL_REPAIR') {
        blocked.push({ issueId: issue.id, ruleId: issue.ruleId, entityId: issue.entityId, reason: blockedReason(issue) });
      }
      return;
    }

    const key = `${op.target}:${op.entityId}:${op.path}`;
    if (seenTargets.has(key)) {
      blocked.push({
        issueId: issue.id,
        ruleId: issue.ruleId,
        entityId: issue.entityId,
        reason: 'Có nhiều issue cùng muốn sửa một field; chặn auto-repair để tránh thứ tự ghi không xác định.',
      });
      return;
    }
    seenTargets.add(key);
    operations.push(op);
  });

  return {
    auditSnapshotId: report.auditSnapshotId,
    generatedAt: Date.now(),
    sourceIssueCount: selected.length,
    operations,
    blocked,
    requiresBackup: operations.length > 0,
    requiresConfirmation: operations.length > 0,
    canApply: operations.length > 0 && blocked.length === 0,
  };
}

export function assertHealthCenterRepairPreviewFresh(
  preview: HealthCenterRepairPreview,
  currentReport: HealthCenterSummary,
): void {
  if (preview.auditSnapshotId !== currentReport.auditSnapshotId) {
    throw new Error('HEALTH_CENTER_REPAIR_STALE: Audit snapshot đã thay đổi. Hãy quét lại và tạo Repair Preview mới trước khi áp dụng.');
  }
}
