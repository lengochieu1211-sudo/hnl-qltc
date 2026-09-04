import { DefectItem, RoomProgressItem, TeamInfo } from '../types';

const normalizeName = (value: unknown): string => String(value || '').trim().toLocaleLowerCase('vi-VN');

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

function findTeamByName(name: string | undefined, teams: TeamInfo[]): TeamInfo | undefined {
  const normalized = normalizeName(name);
  if (!normalized) return undefined;
  return teams.find((team) => normalizeName(team.name) === normalized);
}

function resolveRoomTeam(room: RoomProgressItem | undefined, teams: TeamInfo[]): TeamInfo | undefined {
  if (!room) return undefined;
  return findTeamById(room.teamId, teams) || findTeamByName(room.assignedTeam, teams);
}

/**
 * Produces durable Defect -> roomId -> teamId links.
 * Existing valid teamId wins (preserves an intentional per-defect assignment), then the
 * visible assignedTo name, then the room's linked team. Whenever a declared team resolves,
 * assignedTo is canonicalized to the current team name so renames do not leave stale text.
 */
export function reconcileDefectLinkage(
  defect: DefectItem,
  rooms: RoomProgressItem[],
  teams: TeamInfo[]
): DefectItem {
  const room = findRoomForDefectPoint(defect, rooms);
  const team =
    findTeamById(defect.teamId, teams) ||
    findTeamByName(defect.assignedTo, teams) ||
    resolveRoomTeam(room, teams);

  // Never erase durable IDs merely because realtime room/team collections have not
  // hydrated yet. Once those collections are present, geometry/name/ID reconciliation
  // becomes authoritative.
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
  const selectedTeam = findTeamByName(assignedTo, teams);
  const roomTeam = resolveRoomTeam(room, teams);
  const team = selectedTeam || roomTeam;

  return {
    roomId: room?.id,
    teamId: team?.id || room?.teamId,
    assignedTo: team?.name || String(assignedTo || '').trim() || String(room?.assignedTeam || '').trim() || 'Đội thi công',
  };
}
