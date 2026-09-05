import type { TeamInfo } from '../../types';
import { calculateTeamStatistics } from '../../utils/teamUtils';
import { auditDefectLinks } from '../audit/defectAudit';
import { calculateAiTeamSummary } from '../calculations/teamSummary';
import type { AiDateRange, AiFact, AiQueryContext, AiToolResult } from '../core/contracts';
import { resolveTeamReference, type TeamResolutionResult } from '../core/entityResolver';
import {
  HNL_AI_HISTORICAL_COVERAGE,
  historicalQuantityUnavailableMessage,
  type HnlAiProjectSnapshot,
} from '../data/projectSnapshot';
import { assertAiProjectAccess, createAiPermissionScope } from '../security/aiPermissionGuard';

export const HNL_AI_TOOL_NAMES = [
  'resolveTeam',
  'getTeamSummary',
  'getCurrentTeamProgress',
  'auditDefectLinks',
] as const;

export type HnlAiToolName = (typeof HNL_AI_TOOL_NAMES)[number];

export interface HnlAiToolRuntime {
  context: AiQueryContext;
  snapshot: HnlAiProjectSnapshot;
}

export interface ResolveTeamArgs {
  query: string;
}

export interface GetTeamSummaryArgs {
  teamRef: string;
  dateRange: AiDateRange;
}

export interface GetCurrentTeamProgressArgs {
  teamRef: string;
}

export type HnlAiToolArgs =
  | { name: 'resolveTeam'; args: ResolveTeamArgs }
  | { name: 'getTeamSummary'; args: GetTeamSummaryArgs }
  | { name: 'getCurrentTeamProgress'; args: GetCurrentTeamProgressArgs }
  | { name: 'auditDefectLinks'; args: Record<string, never> };

export interface CurrentTeamProgressData {
  teamId: string;
  teamName: string;
  assignedVolumeByUnit: Record<string, number>;
  inspectedVolumeByUnit: Record<string, number>;
  categoryBreakdown: Array<{
    categoryName: string;
    unit: string;
    assignedVolume: number;
    inspectedVolume: number;
  }>;
  totalDefects: number;
  openDefects: number;
  resolvedDefects: number;
  closedDefects: number;
  completedRooms: number;
  assignedRooms: number;
  asOf: number;
  historicalQuantityAvailable: false;
}

export class HnlAiToolError extends Error {
  constructor(
    public readonly code: 'AI_TOOL_NOT_ALLOWED' | 'AI_PROJECT_SCOPE_MISMATCH' | 'AI_TEAM_NOT_FOUND' | 'AI_TEAM_AMBIGUOUS',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HnlAiToolError';
  }
}

function assertRuntime(runtime: HnlAiToolRuntime): void {
  const permission = createAiPermissionScope(runtime.context.projectId, runtime.context.role, runtime.context.accessVerified);
  assertAiProjectAccess(permission, runtime.context.projectId);
  if (runtime.snapshot.projectId !== runtime.context.projectId) {
    throw new HnlAiToolError(
      'AI_PROJECT_SCOPE_MISMATCH',
      'AI snapshot không thuộc projectId đã được xác minh.',
      { contextProjectId: runtime.context.projectId, snapshotProjectId: runtime.snapshot.projectId },
    );
  }
}

function requireResolvedTeam(teamRef: string, teams: readonly TeamInfo[]): TeamInfo {
  const resolution = resolveTeamReference(teamRef, [...teams]);
  if (resolution.status === 'resolved' && resolution.team) return resolution.team;
  if (resolution.status === 'ambiguous') {
    throw new HnlAiToolError(
      'AI_TEAM_AMBIGUOUS',
      'Tên đội chưa đủ rõ. HNL AI không tự chọn một teamId gần giống.',
      { teamRef, candidates: resolution.candidates.map((team) => ({ id: team.id, name: team.name })) },
    );
  }
  throw new HnlAiToolError('AI_TEAM_NOT_FOUND', 'Không tìm thấy đội thi công phù hợp trong dự án hiện tại.', { teamRef });
}

function resolutionResult(runtime: HnlAiToolRuntime, resolution: TeamResolutionResult): AiToolResult<TeamResolutionResult> {
  const evidence = resolution.candidates.map((team) => ({
    id: `teams:${team.id}`,
    collection: 'teams' as const,
    recordId: team.id,
    label: team.name,
    fieldPaths: ['id', 'name'],
  }));
  const facts: AiFact[] = resolution.status === 'resolved' && resolution.team
    ? [{
        id: 'resolve-team:team-id',
        kind: 'FACT',
        label: 'Đội đã resolve',
        value: resolution.team.name,
        evidenceIds: [`teams:${resolution.team.id}`],
      }]
    : [];

  return {
    status: resolution.status === 'resolved' ? 'ok' : resolution.status === 'ambiguous' ? 'partial' : 'insufficient-data',
    data: resolution,
    facts,
    evidence,
    metadata: {
      projectId: runtime.context.projectId,
      tool: 'resolveTeam',
      sourceCollections: ['teams'],
      recordsScanned: runtime.snapshot.teams.length,
      recordsUsed: resolution.candidates.length,
      asOf: runtime.snapshot.asOf,
      freshness: runtime.snapshot.freshness,
      permissionRole: runtime.context.role,
      dataVersion: 'hnl-ai-tools-v1',
    },
    warnings: resolution.status === 'ambiguous'
      ? ['Có nhiều đội gần giống; cần người dùng chọn đúng đội trước khi chạy tool nghiệp vụ.']
      : resolution.status === 'not-found'
        ? ['Không tìm thấy đội trong project hiện tại.']
        : [],
    assumptions: [],
  };
}

function currentTeamProgress(runtime: HnlAiToolRuntime, team: TeamInfo): AiToolResult<CurrentTeamProgressData> {
  const activeRooms = runtime.snapshot.rooms.filter((item) => item.deletedAt === undefined || item.deletedAt === null);
  const activeDefects = runtime.snapshot.defects.filter((item) => item.deletedAt === undefined || item.deletedAt === null);
  const activeFloors = runtime.snapshot.floors.filter((item) => item.deletedAt === undefined || item.deletedAt === null);
  const stats = calculateTeamStatistics({
    teams: [team],
    roomProgressList: [...activeRooms],
    defects: [...activeDefects],
    crewRecords: [],
    floorPlans: [...activeFloors],
  })[team.id];

  const data: CurrentTeamProgressData = {
    teamId: team.id,
    teamName: team.name,
    assignedVolumeByUnit: { ...(stats?.volumeByUnit || {}) },
    inspectedVolumeByUnit: { ...(stats?.completedVolumeByUnit || {}) },
    categoryBreakdown: (stats?.categoryBreakdown || []).map((item) => ({
      categoryName: item.categoryName,
      unit: item.unit,
      assignedVolume: item.assignedVol,
      inspectedVolume: item.inspectedVol,
    })),
    totalDefects: stats?.totalDefectsCount || 0,
    openDefects: stats?.openDefectsCount || 0,
    resolvedDefects: stats?.resolvedDefectsCount || 0,
    closedDefects: stats?.closedDefectsCount || 0,
    completedRooms: stats?.completedRoomsCount || 0,
    assignedRooms: stats?.totalAssignedRoomsCount || 0,
    asOf: runtime.snapshot.asOf,
    historicalQuantityAvailable: false,
  };

  const facts: AiFact[] = [
    { id: 'current-progress:assigned-rooms', kind: 'CALCULATED', label: 'Căn/phòng được giao', value: data.assignedRooms, unit: 'căn/phòng' },
    { id: 'current-progress:completed-rooms', kind: 'CALCULATED', label: 'Căn/phòng đã nghiệm thu', value: data.completedRooms, unit: 'căn/phòng' },
    { id: 'current-progress:open-defects', kind: 'CALCULATED', label: 'Defect đang mở', value: data.openDefects, unit: 'Defect' },
  ];
  Object.entries(data.inspectedVolumeByUnit).forEach(([unit, value], index) => {
    facts.push({
      id: `current-progress:inspected:${index + 1}`,
      kind: 'CALCULATED',
      label: `Khối lượng nghiệm thu hiện tại (${unit})`,
      value,
      unit,
      method: 'current RoomProgress snapshot via calculateTeamStatistics',
    });
  });

  return {
    status: 'ok',
    data,
    facts,
    evidence: [
      { id: `teams:${team.id}`, collection: 'teams', recordId: team.id, label: team.name },
    ],
    metadata: {
      projectId: runtime.context.projectId,
      tool: 'getCurrentTeamProgress',
      sourceCollections: ['teams', 'rooms', 'defects', 'floor_plans'],
      recordsScanned: runtime.snapshot.teams.length + activeRooms.length + activeDefects.length + activeFloors.length,
      recordsUsed: (stats?.teamRooms.length || 0) + (stats?.totalDefectsCount || 0),
      asOf: runtime.snapshot.asOf,
      freshness: runtime.snapshot.freshness,
      permissionRole: runtime.context.role,
      dataVersion: 'hnl-ai-tools-v1',
    },
    warnings: [historicalQuantityUnavailableMessage()],
    assumptions: [
      'Đây là snapshot tiến độ hiện tại, không phải khối lượng phát sinh theo từng ngày trong quá khứ.',
      'Không expose totalTeamVol legacy vì có thể trộn nhiều đơn vị; chỉ expose volumeByUnit.',
    ],
  };
}

/**
 * Strict whitelist executor. Model/provider layers may only request one of the typed tool
 * names below. No JavaScript, Firestore path, collection name, or arbitrary query string
 * from a model is ever executed here.
 */
export function executeHnlAiTool(request: HnlAiToolArgs, runtime: HnlAiToolRuntime): AiToolResult<unknown> {
  assertRuntime(runtime);

  switch (request.name) {
    case 'resolveTeam': {
      return resolutionResult(runtime, resolveTeamReference(request.args.query, [...runtime.snapshot.teams]));
    }
    case 'getTeamSummary': {
      const team = requireResolvedTeam(request.args.teamRef, runtime.snapshot.teams);
      const result = calculateAiTeamSummary({
        context: runtime.context,
        team,
        dateRange: request.args.dateRange,
        crewRecords: [...runtime.snapshot.crewRecords],
        quantityObservations: [],
        quantityBasis: 'inspected',
        freshness: runtime.snapshot.freshness,
        asOf: runtime.snapshot.asOf,
      });
      result.warnings.push(historicalQuantityUnavailableMessage());
      result.assumptions.push(`Historical coverage: crew=${HNL_AI_HISTORICAL_COVERAGE.crew}, quantity=${HNL_AI_HISTORICAL_COVERAGE.quantity}.`);
      return result;
    }
    case 'getCurrentTeamProgress': {
      const team = requireResolvedTeam(request.args.teamRef, runtime.snapshot.teams);
      return currentTeamProgress(runtime, team);
    }
    case 'auditDefectLinks': {
      return auditDefectLinks({
        context: runtime.context,
        defects: [...runtime.snapshot.defects],
        rooms: [...runtime.snapshot.rooms],
        floors: [...runtime.snapshot.floors],
        teams: [...runtime.snapshot.teams],
        freshness: runtime.snapshot.freshness,
        asOf: runtime.snapshot.asOf,
      });
    }
    default: {
      const neverRequest: never = request;
      throw new HnlAiToolError('AI_TOOL_NOT_ALLOWED', 'Tool không nằm trong HNL AI whitelist.', { request: neverRequest });
    }
  }
}

export function isAllowedHnlAiToolName(value: string): value is HnlAiToolName {
  return (HNL_AI_TOOL_NAMES as readonly string[]).includes(value);
}
