import { DefectItem, RoomProgressItem, TeamInfo } from '../types';
import { normalizeTeamDirectoryName } from './teamDirectoryIntegrity';

export function isPointInsideRoom(px: number, py: number, room: RoomProgressItem): boolean {
  if (room.points && room.points.length >= 3) {
    let inside = false;
    for (let i = 0, j = room.points.length - 1; i < room.points.length; j = i++) {
      const xi = room.points[i].x;
      const yi = room.points[i].y;
      const xj = room.points[j].x;
      const yj = room.points[j].y;
      const intersects = ((yi > py) !== (yj > py)) &&
        (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
      if (intersects) inside = !inside;
    }
    if (inside) return true;
  }

  const width = Number(room.width || 0);
  const height = Number(room.height || 0);
  return width > 0 && height > 0 &&
    px >= room.x && px <= room.x + width &&
    py >= room.y && py <= room.y + height;
}

export function findRoomForDefectPoint(
  pin: Pick<DefectItem, 'x' | 'y'>,
  rooms: RoomProgressItem[]
): RoomProgressItem | undefined {
  return rooms.find((room) => isPointInsideRoom(pin.x, pin.y, room));
}

function findTeamById(teamId: string | undefined, teams: TeamInfo[]): TeamInfo | undefined {
  if (!teamId) return undefined;
  return teams.find((team) => team.id === teamId);
}

function findTeamsByName(name: string | undefined, teams: TeamInfo[]): TeamInfo[] {
  const normalized = normalizeTeamDirectoryName(name);
  if (!normalized) return [];
  return teams.filter((team) => normalizeTeamDirectoryName(team.name) === normalized);
}

function findUniqueTeamByName(name: string | undefined, teams: TeamInfo[]): TeamInfo | undefined {
  const matches = findTeamsByName(name, teams);
  return matches.length === 1 ? matches[0] : undefined;
}

function hasAmbiguousTeamName(name: string | undefined, teams: TeamInfo[]): boolean {
  return findTeamsByName(name, teams).length > 1;
}

function resolveRoomTeam(room: RoomProgressItem | undefined, teams: TeamInfo[]): TeamInfo | undefined {
  if (!room) return undefined;
  return findTeamById(room.teamId, teams) || findUniqueTeamByName(room.assignedTeam, teams);
}

/**
 * Produces durable Defect -> roomId -> teamId links.
 * Existing valid teamId wins (preserves an intentional per-defect assignment), then a
 * uniquely resolvable assignedTo name, then the room's linked team. A duplicated legacy
 * team name is fail-closed: it must never silently bind the Defect to the first matching
 * directory entry (or to a different room-default team).
 */
export function reconcileDefectLinkage(
  defect: DefectItem,
  rooms: RoomProgressItem[],
  teams: TeamInfo[]
): DefectItem {
  const room = findRoomForDefectPoint(defect, rooms);
  const explicitTeam = findTeamById(defect.teamId, teams);
  const assignedTeam = findUniqueTeamByName(defect.assignedTo, teams);
  const ambiguousAssignedTo = hasAmbiguousTeamName(defect.assignedTo, teams);
  const team = explicitTeam || assignedTeam || (ambiguousAssignedTo ? undefined : resolveRoomTeam(room, teams));

  // Never erase durable IDs merely because realtime room/team collections have not
  // hydrated yet. Once those collections are present, geometry/name/ID reconciliation
  // becomes authoritative. Ambiguous legacy display names deliberately remain unbound.
  const roomId = room?.id ?? (rooms.length === 0 ? defect.roomId : undefined);
  const teamId = team?.id ?? (teams.length === 0 ? defect.teamId : undefined);
  const assignedTo = team?.name || String(defect.assignedTo || '').trim() || String(room?.assignedTeam || '').trim() || 'Đội thi công';

  if (
    defect.roomId === roomId &&
    defect.teamId === teamId &&
    defect.assignedTo === assignedTo
  ) {
    return defect;
  }

  return {
    ...defect,
    roomId,
    teamId,
    assignedTo,
  };
}

/** Create/update helper where the user just chose an assignedTo value. */
export function resolveDefectLinkageFromSelection(
  pin: Pick<DefectItem, 'x' | 'y'>,
  assignedTo: string,
  rooms: RoomProgressItem[],
  teams: TeamInfo[]
): Pick<DefectItem, 'roomId' | 'teamId' | 'assignedTo'> {
  const room = findRoomForDefectPoint(pin, rooms);
  const selectedTeam = findUniqueTeamByName(assignedTo, teams);
  const ambiguousSelection = hasAmbiguousTeamName(assignedTo, teams);
  const roomTeam = ambiguousSelection ? undefined : resolveRoomTeam(room, teams);
  const team = selectedTeam || roomTeam;

  return {
    roomId: room?.id,
    teamId: team?.id || (!ambiguousSelection ? room?.teamId : undefined),
    assignedTo: team?.name || String(assignedTo || '').trim() || String(room?.assignedTeam || '').trim() || 'Đội thi công',
  };
}
