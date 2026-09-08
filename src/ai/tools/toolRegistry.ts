import type { TeamInfo } from '../../types';
import { calculateTeamStatistics } from '../../utils/teamUtils';
import { computeMaterialNeeds } from '../../utils/materialNeedEngine';
import { auditCrewData } from '../audit/crewAudit';
import { auditDefectLinks } from '../audit/defectAudit';
import { auditProjectViaHealthCenter } from '../audit/healthCenterAiAudit';
import { auditQuantityData } from '../audit/quantityAudit';
import { calculateCurrentTeamDetail } from '../calculations/currentTeamDetail';
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
  'getCurrentTeamProgressDetail',
  'auditDefectLinks',
  'auditQuantityData',
  'auditCrewData',
  'auditProjectIntegrity',
  'getMaterialNeeds',
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

export interface GetMaterialNeedsArgs {
  floorId?: string;
  floorIds?: string[];
  teamRef?: string;
}

export type HnlAiToolArgs =
  | { name: 'resolveTeam'; args: ResolveTeamArgs }
  | { name: 'getTeamSummary'; args: GetTeamSummaryArgs }
  | { name: 'getCurrentTeamProgress'; args: GetCurrentTeamProgressArgs }
  | { name: 'getCurrentTeamProgressDetail'; args: GetCurrentTeamProgressArgs }
  | { name: 'getMaterialNeeds'; args: GetMaterialNeedsArgs }
  | { name: 'auditDefectLinks'; args: Record<string, never> }
  | { name: 'auditQuantityData'; args: Record<string, never> }
  | { name: 'auditCrewData'; args: Record<string, never> }
  | { name: 'auditProjectIntegrity'; args: Record<string, never> };

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
    warnings: [],
    assumptions: [
      'Đây là snapshot tiến độ hiện tại, không phải khối lượng phát sinh theo từng ngày trong quá khứ.',
      'Không expose totalTeamVol legacy vì có thể trộn nhiều đơn vị; chỉ expose volumeByUnit.',
    ],
  };
}


function materialNeedsResult(runtime: HnlAiToolRuntime, args: GetMaterialNeedsArgs): AiToolResult<unknown> {
  const team = args.teamRef ? requireResolvedTeam(args.teamRef, runtime.snapshot.teams) : undefined;
  const requestedFloorIds = Array.from(new Set([
    ...(args.floorIds || []),
    ...(args.floorId ? [args.floorId] : []),
  ].map((value) => String(value || '').trim()).filter(Boolean)));
  const floorNameById = new Map(
    runtime.snapshot.floors
      .filter((floor) => floor.deletedAt === undefined || floor.deletedAt === null)
      .map((floor) => [String(floor.id), String(floor.floorName || floor.id)]),
  );

  const computeForFloor = (floorId?: string) => computeMaterialNeeds({
    rooms: [...runtime.snapshot.rooms],
    materialNorms: [...runtime.snapshot.materialNorms],
    inventory: [...runtime.snapshot.inventory],
    workVolumes: [...runtime.snapshot.workVolumes],
    teams: [...runtime.snapshot.teams],
    scope: { floorId, teamId: team?.id },
  });

  if (requestedFloorIds.length > 1) {
    const floors = requestedFloorIds.map((floorId) => {
      const result = computeForFloor(floorId);
      return {
        floorId,
        floorName: floorNameById.get(floorId) || floorId,
        result,
      };
    });
    const facts: AiFact[] = floors.flatMap((floor, floorIndex) => floor.result.lines.flatMap((line, lineIndex) => [
      {
        id: `material:${floorIndex}:${lineIndex}:need`,
        kind: 'CALCULATED' as const,
        label: `${floor.floorName} · ${line.materialName} - tổng cần`,
        value: line.estimatedQty,
        unit: line.unit,
        method: 'Material Need Engine deterministic',
      },
      {
        id: `material:${floorIndex}:${lineIndex}:remaining`,
        kind: 'CALCULATED' as const,
        label: `${floor.floorName} · ${line.materialName} - còn cần`,
        value: line.remainingQty,
        unit: line.unit,
        method: 'Nhu cầu định mức trừ phiếu xuất có provenance xác định',
      },
    ]));
    const allEmpty = floors.every((floor) => floor.result.lines.length === 0);
    const anyFailClosed = floors.some((floor) => floor.result.failClosed);
    return {
      status: allEmpty ? 'insufficient-data' : anyFailClosed || floors.some((floor) => floor.result.lines.length === 0) ? 'partial' : 'ok',
      data: {
        multiFloor: true,
        teamId: team?.id || '',
        teamName: team?.name || '',
        floors,
      },
      facts,
      evidence: [],
      metadata: {
        projectId: runtime.context.projectId,
        tool: 'getMaterialNeeds',
        sourceCollections: ['rooms', 'work_volumes', 'material_norms', 'inventory', 'teams', 'floor_plans'],
        recordsScanned: runtime.snapshot.rooms.length + runtime.snapshot.workVolumes.length + runtime.snapshot.materialNorms.length + runtime.snapshot.inventory.length + runtime.snapshot.teams.length + runtime.snapshot.floors.length,
        recordsUsed: floors.reduce((sum, floor) => sum + floor.result.lines.length, 0),
        asOf: runtime.snapshot.asOf,
        freshness: runtime.snapshot.freshness,
        permissionRole: runtime.context.role,
        dataVersion: 'hnl-material-need-v2',
      },
      warnings: floors.flatMap((floor) => floor.result.warnings.map((warning) => `${floor.floorName}: ${warning.message}`)),
      assumptions: [
        'Mỗi tầng được tính độc lập bằng cùng Material Need Engine; không gộp m² giữa tầng trước khi áp định mức.',
        'Không tự suy m² thành vật tư: mọi số lượng đi qua Material Need Engine và định mức đã cấu hình.',
        'Phiếu xuất thiếu team provenance chỉ trừ khi teamId có thể chứng minh duy nhất; nếu mơ hồ thì giữ chưa phân bổ.',
      ],
    };
  }

  const result = computeForFloor(requestedFloorIds[0]);
  const facts: AiFact[] = result.lines.flatMap((line, index) => [
    { id: `material:${index}:need`, kind: 'CALCULATED' as const, label: `${line.materialName} - tổng cần`, value: line.estimatedQty, unit: line.unit, method: 'Material Need Engine deterministic' },
    { id: `material:${index}:remaining`, kind: 'CALCULATED' as const, label: `${line.materialName} - còn cần`, value: line.remainingQty, unit: line.unit, method: 'Nhu cầu định mức trừ phiếu xuất có provenance xác định' },
  ]);
  return {
    status: result.lines.length === 0 ? 'insufficient-data' : result.failClosed ? 'partial' : 'ok',
    data: result,
    facts,
    evidence: [],
    metadata: {
      projectId: runtime.context.projectId,
      tool: 'getMaterialNeeds',
      sourceCollections: ['rooms', 'work_volumes', 'material_norms', 'inventory', 'teams'],
      recordsScanned: runtime.snapshot.rooms.length + runtime.snapshot.workVolumes.length + runtime.snapshot.materialNorms.length + runtime.snapshot.inventory.length + runtime.snapshot.teams.length,
      recordsUsed: result.lines.length,
      asOf: runtime.snapshot.asOf,
      freshness: runtime.snapshot.freshness,
      permissionRole: runtime.context.role,
      dataVersion: 'hnl-material-need-v2',
    },
    warnings: result.warnings.map((warning) => warning.message),
    assumptions: [
      'Không tự suy m² thành vật tư: mọi số lượng đi qua Material Need Engine và định mức đã cấu hình.',
      'Phiếu xuất thiếu team provenance chỉ trừ khi teamId có thể chứng minh duy nhất; nếu mơ hồ thì giữ chưa phân bổ.',
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
    case 'getCurrentTeamProgressDetail': {
      const team = requireResolvedTeam(request.args.teamRef, runtime.snapshot.teams);
      return calculateCurrentTeamDetail({
        context: runtime.context,
        team,
        rooms: [...runtime.snapshot.rooms],
        freshness: runtime.snapshot.freshness,
        asOf: runtime.snapshot.asOf,
      });
    }
    case 'getMaterialNeeds': {
      return materialNeedsResult(runtime, request.args);
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
    case 'auditQuantityData': {
      return auditQuantityData({
        context: runtime.context,
        workVolumes: [...runtime.snapshot.workVolumes],
        rooms: [...runtime.snapshot.rooms],
        freshness: runtime.snapshot.freshness,
        asOf: runtime.snapshot.asOf,
      });
    }
    case 'auditCrewData': {
      return auditCrewData({
        context: runtime.context,
        crewRecords: [...runtime.snapshot.crewRecords],
        teams: [...runtime.snapshot.teams],
        floors: [...runtime.snapshot.floors],
        freshness: runtime.snapshot.freshness,
        asOf: runtime.snapshot.asOf,
      });
    }
    case 'auditProjectIntegrity': {
      return auditProjectViaHealthCenter({ context: runtime.context, snapshot: runtime.snapshot });
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
