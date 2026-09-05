import type { CrewRecord, FloorPlan, TeamInfo } from '../../types';
import { getCrewShiftCounts } from '../../utils/crewUtils';
import { resolveTeamReference, normalizeEntityText } from '../core/entityResolver';
import { assertAiProjectAccess, createAiPermissionScope } from '../security/aiPermissionGuard';
import type {
  AiAuditIssue,
  AiAuditSummary,
  AiEvidenceRef,
  AiFact,
  AiQueryContext,
  AiToolResult,
} from '../core/contracts';

export interface AuditCrewParams {
  context: AiQueryContext;
  crewRecords: CrewRecord[];
  teams: TeamInfo[];
  floors: FloorPlan[];
  freshness?: 'live' | 'cache' | 'fixture';
  asOf?: number;
}

function isActive(record: { deletedAt?: number | null }): boolean {
  return record.deletedAt === undefined || record.deletedAt === null;
}

function isCanonicalDate(value: string): boolean {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const parsed = new Date(y, m - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
}

function ev(id: string): string {
  return `crew_records:${id}`;
}

function validCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function countSignature(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

export function auditCrewData(params: AuditCrewParams): AiToolResult<AiAuditSummary> {
  const {
    context,
    crewRecords = [],
    teams = [],
    floors = [],
    freshness = 'live',
    asOf = Date.now(),
  } = params;

  const permissionScope = createAiPermissionScope(context.projectId, context.role, context.accessVerified);
  assertAiProjectAccess(permissionScope, context.projectId);

  const activeCrew = crewRecords.filter(isActive);
  const activeTeams = teams.filter(isActive);
  const activeFloors = floors.filter(isActive);
  const teamById = new Map(activeTeams.map((team) => [team.id, team]));
  const floorById = new Map(activeFloors.map((floor) => [floor.id, floor]));
  const issues: AiAuditIssue[] = [];
  const evidenceMap = new Map<string, AiEvidenceRef>();
  const exactDuplicateGroups = new Map<string, CrewRecord[]>();
  const teamDayShiftValues = new Map<string, { morning: Set<number>; afternoon: Set<number>; evening: Set<number>; evidenceIds: Set<string> }>();

  const addEvidence = (item: AiEvidenceRef): void => {
    if (!evidenceMap.has(item.id)) evidenceMap.set(item.id, item);
  };

  activeCrew.forEach((record) => {
    const recordEv = ev(record.id);
    addEvidence({
      id: recordEv,
      collection: 'crew_records',
      recordId: record.id,
      label: `${record.date} · ${record.teamName}`,
      fieldPaths: [
        'date', 'teamId', 'teamName', 'floorId', 'floorName', 'workerCount',
        'morningCount', 'afternoonCount', 'eveningCount', 'workersInside', 'workersOutside',
        'shift', 'taskDescription',
      ],
    });

    if (!isCanonicalDate(record.date)) {
      issues.push({
        ruleId: 'CREW_DATE_INVALID',
        severity: 'ERROR',
        entityType: 'crew',
        entityId: record.id,
        message: `Record quân số ${record.id} có ngày không hợp lệ/canonical YYYY-MM-DD.`,
        evidenceIds: [recordEv],
        details: { date: record.date },
      });
    }

    const countFields: Array<[string, unknown]> = [
      ['workerCount', record.workerCount],
      ['morningCount', record.morningCount],
      ['afternoonCount', record.afternoonCount],
      ['eveningCount', record.eveningCount],
      ['workersInside', record.workersInside],
      ['workersOutside', record.workersOutside],
    ];
    countFields.forEach(([field, value]) => {
      if (value === undefined || value === null) return;
      if (!validCount(value)) {
        issues.push({
          ruleId: 'CREW_COUNT_INVALID',
          severity: 'ERROR',
          entityType: 'crew',
          entityId: record.id,
          message: `Record quân số ${record.id} có ${field} không hợp lệ hoặc nhỏ hơn 0.`,
          evidenceIds: [recordEv],
          details: { field, value },
        });
      } else if (!Number.isInteger(value)) {
        issues.push({
          ruleId: 'CREW_COUNT_NOT_INTEGER',
          severity: 'WARNING',
          entityType: 'crew',
          entityId: record.id,
          message: `Record quân số ${record.id} có ${field} không phải số người nguyên.`,
          evidenceIds: [recordEv],
          details: { field, value },
        });
      }
    });

    let resolvedTeamId = String(record.teamId || '').trim();
    if (resolvedTeamId) {
      const team = teamById.get(resolvedTeamId);
      if (!team) {
        issues.push({
          ruleId: 'CREW_TEAM_NOT_FOUND',
          severity: 'ERROR',
          entityType: 'crew',
          entityId: record.id,
          message: `Record quân số ${record.id} tham chiếu teamId không tồn tại trong project hiện tại.`,
          evidenceIds: [recordEv],
          details: { teamId: resolvedTeamId, teamName: record.teamName },
        });
      } else {
        addEvidence({ id: `teams:${team.id}`, collection: 'teams', recordId: team.id, label: team.name });
        const byName = resolveTeamReference(record.teamName, activeTeams);
        if (byName.status === 'resolved' && byName.team && byName.team.id !== team.id) {
          addEvidence({ id: `teams:${byName.team.id}`, collection: 'teams', recordId: byName.team.id, label: byName.team.name });
          issues.push({
            ruleId: 'CREW_TEAM_ID_NAME_MISMATCH',
            severity: 'WARNING',
            entityType: 'crew',
            entityId: record.id,
            message: `Record quân số ${record.id} có teamId và teamName trỏ tới hai đội khác nhau.`,
            evidenceIds: [recordEv, `teams:${team.id}`, `teams:${byName.team.id}`],
            details: { teamId: team.id, teamName: record.teamName, nameResolvedTeamId: byName.team.id },
          });
        }
      }
    } else {
      const resolution = resolveTeamReference(record.teamName, activeTeams);
      if (resolution.status === 'resolved' && resolution.team) {
        resolvedTeamId = resolution.team.id;
        addEvidence({ id: `teams:${resolution.team.id}`, collection: 'teams', recordId: resolution.team.id, label: resolution.team.name });
        issues.push({
          ruleId: 'CREW_TEAM_ID_MISSING',
          severity: 'WARNING',
          entityType: 'crew',
          entityId: record.id,
          message: `Record quân số ${record.id} có teamName hợp lệ nhưng chưa lưu durable teamId.`,
          evidenceIds: [recordEv, `teams:${resolution.team.id}`],
          details: { teamName: record.teamName, candidateTeamId: resolution.team.id },
        });
      } else if (resolution.status === 'ambiguous') {
        resolution.candidates.forEach((team) => addEvidence({ id: `teams:${team.id}`, collection: 'teams', recordId: team.id, label: team.name }));
        issues.push({
          ruleId: 'CREW_TEAM_AMBIGUOUS',
          severity: 'REVIEW',
          entityType: 'crew',
          entityId: record.id,
          message: `Record quân số ${record.id} có teamName khớp gần nhiều đội; không được tự chọn teamId.`,
          evidenceIds: [recordEv, ...resolution.candidates.map((team) => `teams:${team.id}`)],
          details: { teamName: record.teamName, candidateTeamIds: resolution.candidates.map((team) => team.id) },
        });
      } else {
        issues.push({
          ruleId: 'CREW_TEAM_NOT_FOUND',
          severity: 'ERROR',
          entityType: 'crew',
          entityId: record.id,
          message: `Record quân số ${record.id} không resolve được đội thi công trong project hiện tại.`,
          evidenceIds: [recordEv],
          details: { teamName: record.teamName },
        });
      }
    }

    if (record.floorId) {
      const floor = floorById.get(record.floorId);
      if (!floor) {
        issues.push({
          ruleId: 'CREW_FLOOR_NOT_FOUND',
          severity: 'ERROR',
          entityType: 'crew',
          entityId: record.id,
          message: `Record quân số ${record.id} tham chiếu floorId không tồn tại trong project hiện tại.`,
          evidenceIds: [recordEv],
          details: { floorId: record.floorId },
        });
      } else {
        addEvidence({ id: `floor_plans:${floor.id}`, collection: 'floor_plans', recordId: floor.id, label: floor.floorName });
        if (record.floorName && normalizeEntityText(record.floorName) !== normalizeEntityText(floor.floorName)) {
          issues.push({
            ruleId: 'CREW_FLOOR_ID_NAME_MISMATCH',
            severity: 'WARNING',
            entityType: 'crew',
            entityId: record.id,
            message: `Record quân số ${record.id} có floorId đúng nhưng floorName không khớp tên tầng hiện tại.`,
            evidenceIds: [recordEv, `floor_plans:${floor.id}`],
            details: { floorId: floor.id, savedFloorName: record.floorName, currentFloorName: floor.floorName },
          });
        }
      }
    }

    const explicitShiftCounts = record.morningCount !== undefined || record.afternoonCount !== undefined || record.eveningCount !== undefined;
    const shiftCounts = getCrewShiftCounts(record);
    const maxShift = Math.max(shiftCounts.morning, shiftCounts.afternoon, shiftCounts.evening, 0);
    if (explicitShiftCounts && validCount(record.workerCount) && record.workerCount > 0 && maxShift > 0 && record.workerCount !== maxShift) {
      issues.push({
        ruleId: 'CREW_WORKERCOUNT_SHIFT_MISMATCH',
        severity: 'REVIEW',
        entityType: 'crew',
        entityId: record.id,
        message: `Record quân số ${record.id} có workerCount khác headcount lớn nhất của các ca.`,
        evidenceIds: [recordEv],
        details: { workerCount: record.workerCount, shiftCounts, effectiveDailyHeadcount: maxShift },
      });
    }

    if (validCount(record.workersInside) && validCount(record.workersOutside) && record.workersInside !== undefined && record.workersOutside !== undefined) {
      const splitTotal = record.workersInside + record.workersOutside;
      if (validCount(record.workerCount) && record.workerCount > 0 && splitTotal !== record.workerCount) {
        issues.push({
          ruleId: 'CREW_INSIDE_OUTSIDE_TOTAL_MISMATCH',
          severity: 'REVIEW',
          entityType: 'crew',
          entityId: record.id,
          message: `Record quân số ${record.id} có trong/ngoài công trường không khớp workerCount.`,
          evidenceIds: [recordEv],
          details: { workersInside: record.workersInside, workersOutside: record.workersOutside, splitTotal, workerCount: record.workerCount },
        });
      }
    }

    const duplicateKey = [
      resolvedTeamId || normalizeEntityText(record.teamName),
      record.date,
      record.floorId || normalizeEntityText(record.floorName || ''),
      normalizeEntityText(record.taskDescription),
      normalizeEntityText(record.shift || ''),
      countSignature(record.workerCount),
      countSignature(record.morningCount),
      countSignature(record.afternoonCount),
      countSignature(record.eveningCount),
      countSignature(record.workersInside),
      countSignature(record.workersOutside),
    ].join('|');
    const duplicateGroup = exactDuplicateGroups.get(duplicateKey) || [];
    duplicateGroup.push(record);
    exactDuplicateGroups.set(duplicateKey, duplicateGroup);

    const teamDayKey = `${resolvedTeamId || normalizeEntityText(record.teamName)}|${record.date}`;
    const shiftGroup = teamDayShiftValues.get(teamDayKey) || {
      morning: new Set<number>(), afternoon: new Set<number>(), evening: new Set<number>(), evidenceIds: new Set<string>(),
    };
    if (shiftCounts.morning > 0) shiftGroup.morning.add(shiftCounts.morning);
    if (shiftCounts.afternoon > 0) shiftGroup.afternoon.add(shiftCounts.afternoon);
    if (shiftCounts.evening > 0) shiftGroup.evening.add(shiftCounts.evening);
    shiftGroup.evidenceIds.add(recordEv);
    teamDayShiftValues.set(teamDayKey, shiftGroup);
  });

  exactDuplicateGroups.forEach((group) => {
    if (group.length <= 1) return;
    issues.push({
      ruleId: 'CREW_EXACT_DUPLICATE',
      severity: 'WARNING',
      entityType: 'crew',
      entityId: group[0].id,
      message: `Có ${group.length} record quân số trùng toàn bộ dữ liệu nghiệp vụ; có nguy cơ double counting.`,
      evidenceIds: group.map((record) => ev(record.id)),
      details: { recordIds: group.map((record) => record.id) },
    });
  });

  teamDayShiftValues.forEach((group, key) => {
    (['morning', 'afternoon', 'evening'] as const).forEach((shift) => {
      const values = Array.from(group[shift]);
      if (values.length <= 1) return;
      issues.push({
        ruleId: 'CREW_TEAM_DAY_SHIFT_CONFLICT',
        severity: 'REVIEW',
        entityType: 'crew',
        entityId: key,
        message: `Cùng đội/ngày có nhiều headcount khác nhau cho ca ${shift}; cần xác nhận đây là tách theo khu vực hay dữ liệu mâu thuẫn.`,
        evidenceIds: Array.from(group.evidenceIds),
        details: { shift, values },
      });
    });
  });

  const data: AiAuditSummary = {
    issues,
    errorCount: issues.filter((issue) => issue.severity === 'ERROR').length,
    warningCount: issues.filter((issue) => issue.severity === 'WARNING').length,
    reviewCount: issues.filter((issue) => issue.severity === 'REVIEW').length,
  };

  const facts: AiFact[] = [
    { id: 'crew-audit:records', kind: 'CALCULATED', label: 'Record quân số đã kiểm tra', value: activeCrew.length, unit: 'record' },
    { id: 'crew-audit:errors', kind: 'CALCULATED', label: 'Lỗi quân số', value: data.errorCount, unit: 'issue' },
    { id: 'crew-audit:warnings', kind: 'CALCULATED', label: 'Cảnh báo quân số', value: data.warningCount, unit: 'issue' },
    { id: 'crew-audit:review', kind: 'CALCULATED', label: 'Quân số cần rà soát', value: data.reviewCount, unit: 'issue' },
  ];

  return {
    status: 'ok',
    data,
    facts,
    evidence: Array.from(evidenceMap.values()),
    metadata: {
      projectId: context.projectId,
      tool: 'auditCrewData',
      sourceCollections: ['crew_records', 'teams', 'floor_plans'],
      recordsScanned: crewRecords.length + teams.length + floors.length,
      recordsUsed: activeCrew.length,
      asOf,
      freshness,
      permissionRole: context.role,
      dataVersion: 'hnl-ai-audit-v2',
    },
    warnings: [],
    assumptions: [
      'HEADCOUNT không được tính bằng sáng + chiều + tối; getCrewShiftCounts chỉ chuẩn hóa từng ca.',
      'Nhiều record cùng đội/ngày trên các tầng có thể hợp lệ; audit chỉ cảnh báo khi cùng ca xuất hiện các headcount xung đột hoặc bản ghi trùng toàn bộ.',
      'CREW_TEAM_DAY_SHIFT_CONFLICT là REVIEW vì có thể là tách quân theo khu vực; engine không tự cộng hoặc tự sửa.',
      'Không suy diễn unique worker khi source không lưu danh tính từng công nhân.',
    ],
  };
}
