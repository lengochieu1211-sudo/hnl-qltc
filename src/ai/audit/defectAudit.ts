import type { DefectItem, FloorPlan, RoomProgressItem, TeamInfo } from '../../types';
import { isPointInsideRoom } from '../../utils/defectLinkageUtils';
import { resolveTeamReference } from '../core/entityResolver';
import { assertAiProjectAccess, createAiPermissionScope } from '../security/aiPermissionGuard';
import type {
  AiAuditIssue,
  AiAuditSummary,
  AiEvidenceRef,
  AiFact,
  AiQueryContext,
  AiToolResult,
} from '../core/contracts';

function isActive(record: { deletedAt?: number | null; archivedAt?: string }): boolean {
  return (record.deletedAt === undefined || record.deletedAt === null) && !record.archivedAt;
}

function ev(collection: 'defects' | 'rooms' | 'floor_plans' | 'teams', recordId: string): string {
  return `${collection}:${recordId}`;
}

export interface AuditDefectLinksParams {
  context: AiQueryContext;
  defects: DefectItem[];
  rooms: RoomProgressItem[];
  floors: FloorPlan[];
  teams: TeamInfo[];
  includeArchived?: boolean;
  freshness?: 'live' | 'cache' | 'fixture';
  asOf?: number;
}

/**
 * Read-only deterministic audit of durable Defect -> room/floor/team links.
 * A Defect assigned to a team different from the Room is REVIEW, not ERROR, because
 * per-defect assignment may be intentional. The audit never mutates or reconciles data.
 */
export function auditDefectLinks(params: AuditDefectLinksParams): AiToolResult<AiAuditSummary> {
  const {
    context,
    defects = [],
    rooms = [],
    floors = [],
    teams = [],
    includeArchived = false,
    freshness = 'live',
    asOf = Date.now(),
  } = params;

  const permissionScope = createAiPermissionScope(context.projectId, context.role, context.accessVerified);
  assertAiProjectAccess(permissionScope, context.projectId);

  const activeRooms = rooms.filter((room) => room.deletedAt === undefined || room.deletedAt === null);
  const activeFloors = floors.filter((floor) => floor.deletedAt === undefined || floor.deletedAt === null);
  const activeTeams = teams.filter((team) => team.deletedAt === undefined || team.deletedAt === null);
  const floorById = new Map(activeFloors.map((floor) => [floor.id, floor]));
  const roomById = new Map(activeRooms.map((room) => [room.id, room]));
  const teamById = new Map(activeTeams.map((team) => [team.id, team]));

  const auditedDefects = defects.filter((defect) => includeArchived || isActive(defect));
  const issues: AiAuditIssue[] = [];
  const evidenceMap = new Map<string, AiEvidenceRef>();

  const addEvidence = (item: AiEvidenceRef): void => {
    if (!evidenceMap.has(item.id)) evidenceMap.set(item.id, item);
  };

  auditedDefects.forEach((defect) => {
    const defectEv = ev('defects', defect.id);
    addEvidence({
      id: defectEv,
      collection: 'defects',
      recordId: defect.id,
      label: defect.description || defect.id,
      fieldPaths: ['floorId', 'roomId', 'teamId', 'assignedTo', 'x', 'y', 'status'],
    });

    const floor = floorById.get(defect.floorId);
    if (!floor) {
      issues.push({
        ruleId: 'DEFECT_FLOOR_NOT_FOUND',
        severity: 'ERROR',
        entityType: 'defect',
        entityId: defect.id,
        message: `Defect ${defect.id} tham chiếu floorId không tồn tại trong project hiện tại.`,
        evidenceIds: [defectEv],
        details: { floorId: defect.floorId },
      });
    } else {
      addEvidence({ id: ev('floor_plans', floor.id), collection: 'floor_plans', recordId: floor.id, label: floor.floorName });
    }

    const sameFloorRooms = activeRooms.filter((room) => room.floorId === defect.floorId);
    const pointCandidates = sameFloorRooms.filter((room) => isPointInsideRoom(defect.x, defect.y, room));

    if (!defect.roomId) {
      if (pointCandidates.length === 1) {
        const candidate = pointCandidates[0];
        addEvidence({ id: ev('rooms', candidate.id), collection: 'rooms', recordId: candidate.id, label: candidate.roomName });
        issues.push({
          ruleId: 'DEFECT_ROOM_ID_MISSING',
          severity: 'WARNING',
          entityType: 'defect',
          entityId: defect.id,
          message: `Defect ${defect.id} chưa có roomId nhưng tọa độ nằm trong ${candidate.roomName}.`,
          evidenceIds: [defectEv, ev('rooms', candidate.id)],
          details: { candidateRoomId: candidate.id },
        });
      } else if (pointCandidates.length > 1) {
        pointCandidates.forEach((candidate) => addEvidence({ id: ev('rooms', candidate.id), collection: 'rooms', recordId: candidate.id, label: candidate.roomName }));
        issues.push({
          ruleId: 'DEFECT_ROOM_AMBIGUOUS',
          severity: 'REVIEW',
          entityType: 'defect',
          entityId: defect.id,
          message: `Defect ${defect.id} nằm trong nhiều vùng căn/phòng; không được tự chọn roomId.`,
          evidenceIds: [defectEv, ...pointCandidates.map((candidate) => ev('rooms', candidate.id))],
          details: { candidateRoomIds: pointCandidates.map((candidate) => candidate.id) },
        });
      }
    } else {
      const linkedRoom = roomById.get(defect.roomId);
      if (!linkedRoom) {
        issues.push({
          ruleId: 'DEFECT_ROOM_NOT_FOUND',
          severity: 'ERROR',
          entityType: 'defect',
          entityId: defect.id,
          message: `Defect ${defect.id} tham chiếu roomId không tồn tại trong project hiện tại.`,
          evidenceIds: [defectEv],
          details: { roomId: defect.roomId },
        });
      } else {
        const roomEv = ev('rooms', linkedRoom.id);
        addEvidence({ id: roomEv, collection: 'rooms', recordId: linkedRoom.id, label: linkedRoom.roomName, fieldPaths: ['floorId', 'teamId', 'assignedTeam', 'x', 'y', 'width', 'height', 'points'] });

        if (linkedRoom.floorId !== defect.floorId) {
          issues.push({
            ruleId: 'DEFECT_ROOM_FLOOR_MISMATCH',
            severity: 'ERROR',
            entityType: 'defect',
            entityId: defect.id,
            message: `Defect ${defect.id} có floorId khác floorId của room được liên kết.`,
            evidenceIds: [defectEv, roomEv],
            details: { defectFloorId: defect.floorId, roomFloorId: linkedRoom.floorId, roomId: linkedRoom.id },
          });
        }

        if (!isPointInsideRoom(defect.x, defect.y, linkedRoom)) {
          pointCandidates.forEach((candidate) => addEvidence({ id: ev('rooms', candidate.id), collection: 'rooms', recordId: candidate.id, label: candidate.roomName }));
          issues.push({
            ruleId: 'DEFECT_PIN_OUTSIDE_LINKED_ROOM',
            severity: 'WARNING',
            entityType: 'defect',
            entityId: defect.id,
            message: `Tọa độ ghim của Defect ${defect.id} không nằm trong roomId đang lưu.`,
            evidenceIds: [defectEv, roomEv, ...pointCandidates.map((candidate) => ev('rooms', candidate.id))],
            details: { linkedRoomId: linkedRoom.id, candidateRoomIds: pointCandidates.map((candidate) => candidate.id) },
          });
        }
      }
    }

    if (defect.teamId) {
      const linkedTeam = teamById.get(defect.teamId);
      if (!linkedTeam) {
        issues.push({
          ruleId: 'DEFECT_TEAM_NOT_FOUND',
          severity: 'ERROR',
          entityType: 'defect',
          entityId: defect.id,
          message: `Defect ${defect.id} tham chiếu teamId không tồn tại trong project hiện tại.`,
          evidenceIds: [defectEv],
          details: { teamId: defect.teamId },
        });
      } else {
        const teamEv = ev('teams', linkedTeam.id);
        addEvidence({ id: teamEv, collection: 'teams', recordId: linkedTeam.id, label: linkedTeam.name });

        const assignedResolution = resolveTeamReference(defect.assignedTo, activeTeams);
        if (assignedResolution.status === 'resolved' && assignedResolution.team && assignedResolution.team.id !== linkedTeam.id) {
          const assignedEv = ev('teams', assignedResolution.team.id);
          addEvidence({ id: assignedEv, collection: 'teams', recordId: assignedResolution.team.id, label: assignedResolution.team.name });
          issues.push({
            ruleId: 'DEFECT_TEAM_ID_NAME_MISMATCH',
            severity: 'WARNING',
            entityType: 'defect',
            entityId: defect.id,
            message: `Defect ${defect.id} có teamId và assignedTo trỏ tới hai đội khác nhau.`,
            evidenceIds: [defectEv, teamEv, assignedEv],
            details: { teamId: linkedTeam.id, teamName: linkedTeam.name, assignedTo: defect.assignedTo, assignedToTeamId: assignedResolution.team.id },
          });
        }

        const linkedRoom = defect.roomId ? roomById.get(defect.roomId) : undefined;
        if (linkedRoom?.teamId && linkedRoom.teamId !== linkedTeam.id && teamById.has(linkedRoom.teamId)) {
          const roomTeam = teamById.get(linkedRoom.teamId)!;
          addEvidence({ id: ev('rooms', linkedRoom.id), collection: 'rooms', recordId: linkedRoom.id, label: linkedRoom.roomName });
          addEvidence({ id: ev('teams', roomTeam.id), collection: 'teams', recordId: roomTeam.id, label: roomTeam.name });
          issues.push({
            ruleId: 'DEFECT_TEAM_DIFFERS_FROM_ROOM_TEAM',
            severity: 'REVIEW',
            entityType: 'defect',
            entityId: defect.id,
            message: `Đội xử lý Defect ${defect.id} khác đội mặc định của căn/phòng; cần xác nhận đây là phân công có chủ ý.`,
            evidenceIds: [defectEv, ev('rooms', linkedRoom.id), teamEv, ev('teams', roomTeam.id)],
            details: { defectTeamId: linkedTeam.id, roomTeamId: roomTeam.id, roomId: linkedRoom.id },
          });
        }
      }
    } else if (String(defect.assignedTo || '').trim()) {
      const resolution = resolveTeamReference(defect.assignedTo, activeTeams);
      if (resolution.status === 'resolved' && resolution.team) {
        addEvidence({ id: ev('teams', resolution.team.id), collection: 'teams', recordId: resolution.team.id, label: resolution.team.name });
        issues.push({
          ruleId: 'DEFECT_TEAM_ID_MISSING',
          severity: 'WARNING',
          entityType: 'defect',
          entityId: defect.id,
          message: `Defect ${defect.id} có assignedTo hợp lệ nhưng chưa lưu durable teamId.`,
          evidenceIds: [defectEv, ev('teams', resolution.team.id)],
          details: { assignedTo: defect.assignedTo, candidateTeamId: resolution.team.id },
        });
      } else if (resolution.status === 'ambiguous') {
        resolution.candidates.forEach((candidate) => addEvidence({ id: ev('teams', candidate.id), collection: 'teams', recordId: candidate.id, label: candidate.name }));
        issues.push({
          ruleId: 'DEFECT_TEAM_AMBIGUOUS',
          severity: 'REVIEW',
          entityType: 'defect',
          entityId: defect.id,
          message: `assignedTo của Defect ${defect.id} khớp gần nhiều đội; không được tự chọn teamId.`,
          evidenceIds: [defectEv, ...resolution.candidates.map((candidate) => ev('teams', candidate.id))],
          details: { assignedTo: defect.assignedTo, candidateTeamIds: resolution.candidates.map((candidate) => candidate.id) },
        });
      }
    }
  });

  const data: AiAuditSummary = {
    issues,
    errorCount: issues.filter((issue) => issue.severity === 'ERROR').length,
    warningCount: issues.filter((issue) => issue.severity === 'WARNING').length,
    reviewCount: issues.filter((issue) => issue.severity === 'REVIEW').length,
  };

  const facts: AiFact[] = [
    { id: 'defect-audit:scanned', kind: 'CALCULATED', label: 'Defect đã kiểm tra', value: auditedDefects.length, unit: 'record' },
    { id: 'defect-audit:errors', kind: 'CALCULATED', label: 'Lỗi liên kết', value: data.errorCount, unit: 'issue' },
    { id: 'defect-audit:warnings', kind: 'CALCULATED', label: 'Cảnh báo', value: data.warningCount, unit: 'issue' },
    { id: 'defect-audit:review', kind: 'CALCULATED', label: 'Cần rà soát', value: data.reviewCount, unit: 'issue' },
  ];

  return {
    status: 'ok',
    data,
    facts,
    evidence: Array.from(evidenceMap.values()),
    metadata: {
      projectId: context.projectId,
      tool: 'auditDefectLinks',
      sourceCollections: ['defects', 'rooms', 'floor_plans', 'teams'],
      recordsScanned: defects.length + rooms.length + floors.length + teams.length,
      recordsUsed: auditedDefects.length,
      asOf,
      freshness,
      permissionRole: context.role,
      dataVersion: 'hnl-ai-core-v1',
    },
    warnings: [],
    assumptions: [
      'Các collection truyền vào audit phải đã được adapter giới hạn trong đúng projectId hiện tại.',
      'Defect.teamId khác Room.teamId là REVIEW, không tự kết luận sai vì Defect có thể được giao riêng cho đội khác.',
      'Audit chỉ đọc và phát hiện; không tự sửa roomId/teamId/floorId.',
    ],
  };
}
