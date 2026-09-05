import type { CrewRecord, TeamInfo } from '../../types';
import { getCrewShiftCounts } from '../../utils/crewUtils';
import { isTeamMatch } from '../../utils/teamUtils';
import { normalizeUnit, unitKey } from '../../utils/unitUtils';
import { assertAiProjectAccess, createAiPermissionScope } from '../security/aiPermissionGuard';
import { assertCanonicalDateRange, isDateWithinRange } from '../core/dateRange';
import type {
  AiDateRange,
  AiEvidenceRef,
  AiFact,
  AiProductivityMetric,
  AiQuantityBasis,
  AiQuantityGroup,
  AiQuantityObservation,
  AiQueryContext,
  AiTeamSummaryData,
  AiToolResult,
} from '../core/contracts';

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isActiveRecord(record: { deletedAt?: number | null }): boolean {
  return record.deletedAt === undefined || record.deletedAt === null;
}

function evidenceId(prefix: string, recordId: string): string {
  return `${prefix}:${recordId}`;
}

export interface CalculateTeamSummaryParams {
  context: AiQueryContext;
  team: TeamInfo;
  dateRange: AiDateRange;
  crewRecords: CrewRecord[];
  quantityObservations: AiQuantityObservation[];
  quantityBasis?: AiQuantityBasis;
  freshness?: 'live' | 'cache' | 'fixture';
  asOf?: number;
}

/**
 * Deterministic team summary. It never asks a model to add quantities or man-days.
 * Quantities are grouped by work item + normalized unit, and productivity is grouped
 * by unit so incompatible dimensions are never added together.
 */
export function calculateAiTeamSummary(params: CalculateTeamSummaryParams): AiToolResult<AiTeamSummaryData> {
  const {
    context,
    team,
    dateRange,
    crewRecords = [],
    quantityObservations = [],
    quantityBasis = 'inspected',
    freshness = 'live',
    asOf = Date.now(),
  } = params;

  assertCanonicalDateRange(dateRange);
  const permissionScope = createAiPermissionScope(context.projectId, context.role, context.accessVerified);
  assertAiProjectAccess(permissionScope, context.projectId);

  const teamCrew = crewRecords.filter((record) =>
    isActiveRecord(record)
    && isDateWithinRange(record.date, dateRange)
    && isTeamMatch(record.teamName, team, record.teamId)
  );

  // A team can have multiple floor rows on the same day. Preserve the maximum headcount
  // per date/shift so floor detail cannot multiply the workforce total.
  const dateShiftMax = new Map<string, { date: string; count: number }>();
  teamCrew.forEach((record) => {
    const counts = getCrewShiftCounts(record);
    ([
      ['morning', counts.morning],
      ['afternoon', counts.afternoon],
      ['evening', counts.evening],
    ] as const).forEach(([shift, count]) => {
      if (count <= 0) return;
      const key = `${record.date}:${shift}`;
      const previous = dateShiftMax.get(key);
      if (!previous || count > previous.count) dateShiftMax.set(key, { date: record.date, count });
    });
  });

  const dailyMandays = new Map<string, number>();
  dateShiftMax.forEach(({ date, count }) => {
    dailyMandays.set(date, (dailyMandays.get(date) || 0) + count * 0.5);
  });
  const totalManDays = round(Array.from(dailyMandays.values()).reduce((sum, value) => sum + value, 0));
  const workDays = Array.from(dailyMandays.values()).filter((value) => value > 0).length;

  const teamQuantities = quantityObservations.filter((observation) =>
    observation.teamId === team.id
    && observation.basis === quantityBasis
    && isDateWithinRange(observation.date, dateRange)
    && Number.isFinite(observation.quantity)
    && observation.quantity >= 0
  );

  const groupMap = new Map<string, AiQuantityGroup>();
  teamQuantities.forEach((observation) => {
    const unit = normalizeUnit(observation.unit) || String(observation.unit || '').trim();
    const key = `${observation.workItemId || observation.workItem.trim().toLocaleLowerCase('vi-VN')}|${unitKey(unit)}`;
    const evId = evidenceId('quantity', observation.recordId);
    const existing = groupMap.get(key);
    if (existing) {
      existing.quantity = round(existing.quantity + observation.quantity);
      existing.recordCount += 1;
      existing.evidenceIds.push(evId);
    } else {
      groupMap.set(key, {
        workItemId: observation.workItemId,
        workItem: observation.workItem,
        unit,
        quantity: round(observation.quantity),
        recordCount: 1,
        evidenceIds: [evId],
      });
    }
  });
  const quantities = Array.from(groupMap.values()).sort((a, b) =>
    a.unit.localeCompare(b.unit, 'vi') || a.workItem.localeCompare(b.workItem, 'vi')
  );

  const quantityByUnit = new Map<string, { unit: string; quantity: number }>();
  quantities.forEach((group) => {
    const key = unitKey(group.unit);
    const existing = quantityByUnit.get(key);
    if (existing) existing.quantity = round(existing.quantity + group.quantity);
    else quantityByUnit.set(key, { unit: group.unit, quantity: group.quantity });
  });

  const productivityByUnit: AiProductivityMetric[] = Array.from(quantityByUnit.values())
    .map(({ unit, quantity }) => ({
      unit,
      quantity: round(quantity),
      manDays: totalManDays,
      quantityPerManDay: totalManDays > 0 ? round(quantity / totalManDays, 4) : null,
      method: 'same-unit quantity / team-period man-day' as const,
    }))
    .sort((a, b) => a.unit.localeCompare(b.unit, 'vi'));

  const evidence: AiEvidenceRef[] = [
    ...teamCrew.map((record) => ({
      id: evidenceId('crew', record.id),
      collection: 'crew_records' as const,
      recordId: record.id,
      label: `${record.teamName} · ${record.date}`,
      fieldPaths: ['teamId', 'teamName', 'date', 'morningCount', 'afternoonCount', 'eveningCount', 'workerCount', 'shift'],
    })),
    ...teamQuantities.map((record) => ({
      id: evidenceId('quantity', record.recordId),
      collection: 'work_volumes' as const,
      recordId: record.recordId,
      label: `${record.workItem} · ${record.date}`,
      fieldPaths: ['teamId', 'date', 'workItem', 'unit', 'quantity', 'basis'],
    })),
  ];

  const facts: AiFact[] = [
    {
      id: 'team-summary:mandays',
      kind: 'CALCULATED',
      label: 'Tổng công quy đổi',
      value: totalManDays,
      unit: 'công',
      method: 'max headcount per team/date/shift × 0.5 công/ca; sum by day',
      evidenceIds: teamCrew.map((record) => evidenceId('crew', record.id)),
    },
    {
      id: 'team-summary:work-days',
      kind: 'CALCULATED',
      label: 'Số ngày có quân số',
      value: workDays,
      unit: 'ngày',
      method: 'count dates with man-day > 0',
      evidenceIds: teamCrew.map((record) => evidenceId('crew', record.id)),
    },
    ...quantities.map((group, index) => ({
      id: `team-summary:quantity:${index + 1}`,
      kind: 'CALCULATED' as const,
      label: group.workItem,
      value: group.quantity,
      unit: group.unit,
      method: `${quantityBasis} quantity grouped by workItem + unit`,
      evidenceIds: group.evidenceIds,
    })),
  ];

  const warnings: string[] = [];
  if (teamCrew.length === 0) warnings.push(`Không tìm thấy record quân số của ${team.name} trong ${dateRange.from}–${dateRange.to}.`);
  if (teamQuantities.length === 0) warnings.push(`Không tìm thấy record khối lượng ${quantityBasis} của ${team.name} trong ${dateRange.from}–${dateRange.to}.`);
  if (totalManDays <= 0 && teamQuantities.length > 0) warnings.push('Có khối lượng nhưng không có đủ dữ liệu công để tính năng suất.');

  const status = teamCrew.length === 0 && teamQuantities.length === 0
    ? 'insufficient-data'
    : teamCrew.length === 0 || teamQuantities.length === 0
      ? 'partial'
      : 'ok';

  const data: AiTeamSummaryData = {
    teamId: team.id,
    teamName: team.name,
    dateRange,
    workDays,
    totalManDays,
    quantityBasis,
    quantities,
    productivityByUnit,
    crewRecordCount: teamCrew.length,
    quantityRecordCount: teamQuantities.length,
  };

  return {
    status,
    data,
    facts,
    evidence,
    metadata: {
      projectId: context.projectId,
      tool: 'getTeamSummary',
      timeRange: dateRange,
      sourceCollections: ['crew_records', 'work_volumes'],
      recordsScanned: crewRecords.length + quantityObservations.length,
      recordsUsed: teamCrew.length + teamQuantities.length,
      asOf,
      freshness,
      permissionRole: context.role,
      dataVersion: 'hnl-ai-core-v1',
    },
    warnings,
    assumptions: [
      'Quân số theo ca dùng business rule hiện tại của HNL QLTC: sáng/chiều/tối mỗi ca = 0,5 công.',
      'Năng suất chỉ cộng khối lượng cùng đơn vị; không cộng m² với m, kg, bộ hoặc đơn vị khác.',
      `Khối lượng trong kết quả này dùng basis=${quantityBasis}; engine không tự đổi sang contract/assigned/completed.`,
    ],
  };
}
