import { TeamInfo, RoomProgressItem, DefectItem, CrewRecord, FloorPlan, TeamRoomDetail, RoomSubItem, WorkVolume, StructureGroupingConfig } from '../types';
import { normalizeUnit } from './unitUtils';
import { getCrewShiftCounts } from './crewUtils';
import { canonicalWorkCategoryId, getCanonicalRoomCategoryEntries, resolveAuthoritativeWorkVolumeRef, resolveWorkVolumeRef } from './linkageIntegrity';
import { normalizeStructureGrouping, structureGroupForFloor } from './structureGrouping';

/**
 * Unified helper to get effective weight or volume of a subitem across the whole system.
 * Priority: workVolume (>0) -> progressWeight (>0) -> 1
 */
export function getSubItemEffectiveWeight(s: Partial<RoomSubItem> | any): number {
  if (!s) return 1;
  if (typeof s.workVolume === 'number' && !isNaN(s.workVolume) && s.workVolume > 0) {
    return s.workVolume;
  }
  if (typeof s.progressWeight === 'number' && !isNaN(s.progressWeight) && s.progressWeight > 0) {
    return s.progressWeight;
  }
  return 1;
}

/**
 * Pick one progress-weight system for a whole sibling group. Never mix m²/m with
 * percentage weights in the same calculation.
 */
export function getSubItemGroupWeightMode(items: Array<Partial<RoomSubItem> | any>): 'workVolume' | 'progressWeight' | 'equal' {
  const list = (items || []).filter(Boolean);
  if (list.length === 0) return 'equal';
  if (list.every((s) => typeof s.workVolume === 'number' && Number.isFinite(s.workVolume) && s.workVolume > 0)) return 'workVolume';
  if (list.every((s) => typeof s.progressWeight === 'number' && Number.isFinite(s.progressWeight) && s.progressWeight > 0)) return 'progressWeight';
  return 'equal';
}

export function getSubItemGroupWeight(items: Array<Partial<RoomSubItem> | any>, item: Partial<RoomSubItem> | any): number {
  const mode = getSubItemGroupWeightMode(items);
  if (mode === 'workVolume') return Number(item?.workVolume || 0);
  if (mode === 'progressWeight') return Number(item?.progressWeight || 0);
  return 1;
}

/**
 * Unified matching for team identity.
 * Prioritizes assignedTeamId === team.id, with fallback to exact team name/leader matching.
 * Strictly avoids partial substring matching (e.g., 'Đội A' will NOT match 'Đội A1').
 */
export function getRoomCategoryUnit(room: RoomProgressItem, categoryName: string): string {
  const explicit = room.categoryVolumeUnits?.[categoryName];
  if (explicit) return normalizeUnit(explicit) || explicit;
  const categorySubs = room.subItems?.filter((s) => (s.category || room.workCategory) === categoryName) || [];
  const units = Array.from(new Set(categorySubs.map((s) => normalizeUnit(s.volumeUnit || '')).filter(Boolean)));
  if (units.length === 1) return units[0];
  return normalizeUnit(room.volumeUnit || 'm²') || 'm²';
}

export function isTeamMatch(assignedName?: string, team?: TeamInfo | null, assignedTeamId?: string): boolean {
  if (!team) return false;
  if (assignedTeamId && team.id && assignedTeamId === team.id) {
    return true;
  }
  if (!assignedName) return false;
  const a = assignedName.trim().toLowerCase();
  const b = team.name.trim().toLowerCase();
  const leader = team.leader ? team.leader.trim().toLowerCase() : '';
  
  if (a === b) return true;
  if (leader && a === leader) return true;
  return false;
}

/** Canonical category allocation for one team in one room. */
interface TeamCategoryAssignment {
  workCategoryId?: string;
  name: string;
  unit: string;
  totalVolume: number;
  allSubItems: RoomSubItem[];
  teamSubItems: RoomSubItem[];
  isMain: boolean;
}

function getTeamCategoryAssignments(
  room: RoomProgressItem,
  team: TeamInfo,
  workVolumes: WorkVolume[] = [],
  resolvedFloorName?: string,
): TeamCategoryAssignment[] {
  const isMain = isTeamMatch(room.assignedTeam, team, room.teamId);
  // Legacy Room records often keep only floorId while FloorPlan owns the display name.
  // Name-only legacy work-category references still need the resolved floor name so a
  // valid `Tầng 1` link is not misclassified as floor-mismatch and silently dropped
  // from team statistics/export. Durable IDs remain authoritative as before.
  const floorName = room.floorName || resolvedFloorName || '';
  const roomForResolution = room.floorName || !floorName ? room : { ...room, floorName };

  const belongsToCategory = (sub: RoomSubItem, categoryId: string | undefined, categoryName: string): boolean => {
    if (workVolumes.length > 0) {
      if (sub.workCategoryId) {
        const resolved = resolveAuthoritativeWorkVolumeRef({ workVolumes, workCategoryId: sub.workCategoryId, floorId: room.floorId, floorName });
        return resolved.state === 'resolved' && canonicalWorkCategoryId(resolved.work) === categoryId;
      }
      const legacyName = sub.category || (!sub.category && !room.workCategoryId ? room.workCategory : undefined);
      if (!legacyName) return false;
      const resolved = resolveWorkVolumeRef({ workVolumes, workCategoryName: legacyName, floorId: room.floorId, floorName });
      return resolved.state === 'resolved' && canonicalWorkCategoryId(resolved.work) === categoryId;
    }
    return (sub.category || room.workCategory) === categoryName;
  };

  const baseCategories: Array<{ id?: string; name: string; unit: string; quantity: number }> = workVolumes.length > 0
    ? getCanonicalRoomCategoryEntries(roomForResolution, workVolumes).map((entry) => ({
        id: entry.workCategoryId,
        name: entry.workCategoryName,
        unit: normalizeUnit(entry.unit) || entry.unit,
        quantity: Number(entry.quantity) || 0,
      }))
    : (() => {
        const names = new Set<string>();
        Object.keys(room.categoryVolumes || {}).forEach((name) => names.add(name));
        if (room.workCategory) names.add(room.workCategory);
        return Array.from(names).map((name) => ({
          id: room.workCategory === name ? room.workCategoryId : undefined,
          name,
          unit: getRoomCategoryUnit(room, name),
          quantity: Number(room.categoryVolumes?.[name] ?? (room.workCategory === name ? room.workVolume : 0)) || 0,
        }));
      })();

  return baseCategories.flatMap((category) => {
    const allSubItems = (room.subItems || []).filter((sub) => belongsToCategory(sub, category.id, category.name));
    const teamSubItems = allSubItems.filter((sub) =>
      isTeamMatch(sub.assignedTeam, team, sub.teamId) || (!sub.assignedTeam && !sub.teamId && isMain),
    );
    if (allSubItems.length > 0) {
      if (teamSubItems.length === 0) return [];
    } else if (!isMain) {
      return [];
    }
    return [{
      workCategoryId: category.id,
      name: category.name,
      unit: category.unit,
      totalVolume: Math.max(0, category.quantity),
      allSubItems,
      teamSubItems,
      isMain,
    }];
  });
}

/**
 * Display helper. Canonical stats use getTeamCategoryAssignments so equal names with
 * different IDs/units cannot be merged accidentally.
 */
export function getTeamCategoriesForRoom(
  room: RoomProgressItem,
  team: TeamInfo,
  workVolumes: WorkVolume[] = [],
  resolvedFloorName?: string,
): Set<string> {
  return new Set(getTeamCategoryAssignments(room, team, workVolumes, resolvedFloorName).map((item) => item.name));
}

export interface TeamCategoryBreakdown {
  categoryName: string;
  unit: string;
  assignedVol: number;
  completedVol: number;
  completedFrameVol: number;
  completedBoardVol: number;
  inspectedVol: number;
}

export interface FloorGroupDetail {
  floorName: string;
  rooms: RoomProgressItem[];
  totalVol: number;
  doneFrameVol: number;
  doneBoardVol: number;
  doneInspectedVol: number;
  doneRooms: number;
  categoryVolumes: Record<string, number>;
  categoryDetails: Record<
    string,
    {
      categoryName?: string;
      workCategoryId?: string;
      unit: string;
      totalVol: number;
      doneFrameVol: number;
      doneBoardVol: number;
      doneInspectedVol: number;
    }
  >;
}

export interface StructureGroupDetail {
  structureGroupId: string;
  structureGroupName: string;
  floorNames: string[];
  roomCount: number;
  totalVol: number;
  doneFrameVol: number;
  doneBoardVol: number;
  doneInspectedVol: number;
}

export interface TeamStatistics {
  team: TeamInfo;
  teamRooms: RoomProgressItem[];
  totalTeamVol: number;
  volumeByUnit: Record<string, number>;
  completedVolumeByUnit: Record<string, number>;
  completedFrameVol: number;
  completedBoardVol: number;
  inspectedVol: number;
  totalMandays: number;
  daysWorked: number;
  avgWorkers: number;
  maxWorkers: number;
  minWorkers: number;
  totalDefectsCount: number;
  openDefectsCount: number;
  resolvedDefectsCount: number;
  closedDefectsCount: number;
  completedRoomsCount: number;
  totalAssignedRoomsCount: number;
  categoryBreakdown: TeamCategoryBreakdown[];
  floorGroupMap: Record<string, FloorGroupDetail>;
  structureGroupMap: Record<string, StructureGroupDetail>;
  teamRoomDetails: TeamRoomDetail[];
}

export function isTeamWorkCompletedInRoom(
  room: RoomProgressItem,
  team: TeamInfo,
  workVolumes: WorkVolume[] = [],
  resolvedFloorName?: string,
): boolean {
  const assignments = getTeamCategoryAssignments(room, team, workVolumes, resolvedFloorName);
  if (assignments.length === 0) return false;
  return assignments.every((assignment) => {
    if (assignment.allSubItems.length > 0) {
      return assignment.teamSubItems.length > 0 && assignment.teamSubItems.every(
        (sub) => sub.status === 'Đã hoàn thành' && sub.inspectionStatus === 'Đạt nghiệm thu',
      );
    }
    return assignment.isMain && room.inspectionStatus === 'Đạt nghiệm thu';
  });
}

/** Single source for Crew UI, Excel and deterministic AI team statistics. */
export function calculateTeamStatistics(params: {
  teams: TeamInfo[];
  roomProgressList: RoomProgressItem[];
  defects: DefectItem[];
  crewRecords: CrewRecord[];
  floorPlans?: FloorPlan[];
  workVolumes?: WorkVolume[];
  structureGrouping?: StructureGroupingConfig;
}): Record<string, TeamStatistics> {
  const { teams, roomProgressList = [], defects = [], crewRecords = [], floorPlans = [], workVolumes = [], structureGrouping } = params;
  const normalizedStructureGrouping = normalizeStructureGrouping(structureGrouping);
  const statsMap: Record<string, TeamStatistics> = {};
  const floorNameById = new Map(
    floorPlans
      .filter((floor) => floor.deletedAt === undefined || floor.deletedAt === null)
      .map((floor) => [floor.id, floor.floorName] as const),
  );
  const resolvedRoomFloorName = (room: RoomProgressItem): string =>
    room.floorName || floorNameById.get(room.floorId) || '';

  teams.forEach((team) => {
    const activeRooms = roomProgressList.filter((room) => room.deletedAt === undefined || room.deletedAt === null);
    const assignmentsByRoom = new Map<string, TeamCategoryAssignment[]>();
    activeRooms.forEach((room) => {
      const assignments = getTeamCategoryAssignments(room, team, workVolumes, resolvedRoomFloorName(room));
      if (assignments.length > 0) assignmentsByRoom.set(room.id, assignments);
    });
    const teamRooms = activeRooms.filter((room) => assignmentsByRoom.has(room.id));
    const teamDefects = defects.filter((defect) => !defect.archivedAt && isTeamMatch(defect.assignedTo, team, defect.teamId));
    const teamLogs = crewRecords.filter((log) => isTeamMatch(log.teamName, team, log.teamId));

    let totalTeamVol = 0;
    let completedFrameVol = 0;
    let completedBoardVol = 0;
    let inspectedVol = 0;
    const volumeByUnit: Record<string, number> = {};
    const completedVolumeByUnit: Record<string, number> = {};
    const floorGroupMap: Record<string, FloorGroupDetail> = {};
    const teamRoomDetails: TeamRoomDetail[] = [];

    teamRooms.forEach((room) => {
      const fp = floorPlans.find((floor) => floor.id === room.floorId);
      const floorName = room.floorName || fp?.floorName || 'Mặt bằng';
      const structureGroup = structureGroupForFloor(fp, normalizedStructureGrouping);
      if (!floorGroupMap[floorName]) {
        floorGroupMap[floorName] = {
          floorName,
          rooms: [],
          totalVol: 0,
          doneFrameVol: 0,
          doneBoardVol: 0,
          doneInspectedVol: 0,
          doneRooms: 0,
          categoryVolumes: {},
          categoryDetails: {},
        };
      }
      floorGroupMap[floorName].rooms.push(room);

      let roomAssigned = 0;
      let roomFrame = 0;
      let roomBoard = 0;
      let roomInspected = 0;
      const assignments = assignmentsByRoom.get(room.id) || [];

      assignments.forEach((assignment) => {
        const { allSubItems, teamSubItems } = assignment;
        const catTotal = Math.max(0, Number(assignment.totalVolume) || 0);
        const unit = normalizeUnit(assignment.unit || '') || assignment.unit || 'm²';
        let assigned = assignment.isMain ? catTotal : 0;
        if (allSubItems.length > 0) {
          const totalWeight = allSubItems.reduce((sum, sub) => sum + getSubItemGroupWeight(allSubItems, sub), 0);
          const teamWeight = teamSubItems.reduce((sum, sub) => sum + getSubItemGroupWeight(allSubItems, sub), 0);
          assigned = totalWeight > 0 ? catTotal * (teamWeight / totalWeight) : 0;
        }

        let frame = 0;
        let board = 0;
        let inspected = 0;
        if (allSubItems.length > 0 && teamSubItems.length > 0) {
          const totalWeight = allSubItems.reduce((sum, sub) => sum + getSubItemGroupWeight(allSubItems, sub), 0);
          const doneWeight = (predicate: (sub: RoomSubItem) => boolean) => teamSubItems
            .filter(predicate)
            .reduce((sum, sub) => sum + getSubItemGroupWeight(allSubItems, sub), 0);
          inspected = totalWeight > 0 ? catTotal * (doneWeight((sub) => sub.status === 'Đã hoàn thành' && sub.inspectionStatus === 'Đạt nghiệm thu') / totalWeight) : 0;
          frame = totalWeight > 0 ? catTotal * (doneWeight((sub) => sub.name.toLocaleLowerCase('vi-VN').includes('khung') && sub.status === 'Đã hoàn thành') / totalWeight) : 0;
          board = totalWeight > 0 ? catTotal * (doneWeight((sub) => (sub.name.toLocaleLowerCase('vi-VN').includes('tấm') || sub.name.toLocaleLowerCase('vi-VN').includes('bắn')) && sub.status === 'Đã hoàn thành') / totalWeight) : 0;
        } else if (assignment.isMain) {
          inspected = room.inspectionStatus === 'Đạt nghiệm thu' ? assigned : 0;
          frame = room.frameStatus === 'Đã hoàn thành' ? assigned : 0;
          board = room.boardStatus === 'Đã hoàn thành' ? assigned : 0;
        }
        // Never let progress exceed the exact team allocation for this category.
        inspected = Math.min(assigned, inspected);
        frame = Math.min(assigned, frame);
        board = Math.min(assigned, board);

        roomAssigned += assigned;
        roomFrame += frame;
        roomBoard += board;
        roomInspected += inspected;
        volumeByUnit[unit] = (volumeByUnit[unit] || 0) + assigned;
        completedVolumeByUnit[unit] = (completedVolumeByUnit[unit] || 0) + inspected;

        const categoryKey = `${assignment.name.toLocaleLowerCase('vi-VN')}|${unit.toLocaleLowerCase('vi-VN')}`;
        floorGroupMap[floorName].categoryVolumes[categoryKey] = (floorGroupMap[floorName].categoryVolumes[categoryKey] || 0) + assigned;
        if (!floorGroupMap[floorName].categoryDetails[categoryKey]) {
          floorGroupMap[floorName].categoryDetails[categoryKey] = {
            categoryName: assignment.name,
            workCategoryId: assignment.workCategoryId,
            unit,
            totalVol: 0,
            doneFrameVol: 0,
            doneBoardVol: 0,
            doneInspectedVol: 0,
          };
        }
        const detail = floorGroupMap[floorName].categoryDetails[categoryKey];
        detail.totalVol += assigned;
        detail.doneFrameVol += frame;
        detail.doneBoardVol += board;
        detail.doneInspectedVol += inspected;

        const aggregateWorkStatus = (items: RoomSubItem[], fallback: any) => {
          if (items.length === 0) return fallback;
          if (items.every((sub) => sub.status === 'Đã hoàn thành')) return 'Đã hoàn thành';
          if (items.some((sub) => sub.status === 'Đang làm' || sub.status === 'Đã hoàn thành')) return 'Đang làm';
          return 'Chưa làm';
        };
        const aggregateInspectionStatus = (items: RoomSubItem[], fallback: any) => {
          if (items.length === 0) return fallback;
          if (items.some((sub) => sub.inspectionStatus === 'Chưa đạt (Cần sửa)')) return 'Chưa đạt (Cần sửa)';
          if (items.every((sub) => sub.status === 'Đã hoàn thành' && sub.inspectionStatus === 'Đạt nghiệm thu')) return 'Đạt nghiệm thu';
          return 'Chưa nghiệm thu';
        };
        const teamFrameSubs = teamSubItems.filter((sub) => sub.name.toLocaleLowerCase('vi-VN').includes('khung'));
        const teamBoardSubs = teamSubItems.filter((sub) => sub.name.toLocaleLowerCase('vi-VN').includes('tấm') || sub.name.toLocaleLowerCase('vi-VN').includes('bắn'));
        teamRoomDetails.push({
          roomId: room.id,
          roomName: room.roomName,
          floorId: room.floorId || fp?.id || '',
          floorName,
          structureGroupId: structureGroup.id || undefined,
          structureGroupName: structureGroup.name || undefined,
          workCategoryId: assignment.workCategoryId,
          workCategoryName: assignment.name,
          unit,
          teamId: team.id,
          teamName: team.name,
          assignedVolume: assigned,
          frameVolume: frame,
          boardVolume: board,
          inspectedVolume: inspected,
          progress: assigned > 0 ? Math.min(100, Math.round((inspected / assigned) * 100)) : 0,
          frameStatus: aggregateWorkStatus(teamFrameSubs, room.frameStatus),
          boardStatus: aggregateWorkStatus(teamBoardSubs, room.boardStatus),
          inspectionStatus: aggregateInspectionStatus(teamSubItems, room.inspectionStatus),
          targetDate: room.targetBoardDate || room.targetFrameDate || '',
          notes: room.notes,
        });
      });

      floorGroupMap[floorName].totalVol += roomAssigned;
      floorGroupMap[floorName].doneFrameVol += roomFrame;
      floorGroupMap[floorName].doneBoardVol += roomBoard;
      floorGroupMap[floorName].doneInspectedVol += roomInspected;
      if (isTeamWorkCompletedInRoom(room, team, workVolumes, floorName)) floorGroupMap[floorName].doneRooms += 1;
      totalTeamVol += roomAssigned;
      completedFrameVol += roomFrame;
      completedBoardVol += roomBoard;
      inspectedVol += roomInspected;
    });

    const categoryBreakdownMap = new Map<string, TeamCategoryBreakdown>();
    Object.values(floorGroupMap).forEach((floor) => {
      Object.entries(floor.categoryDetails).forEach(([key, detail]) => {
        const existing = categoryBreakdownMap.get(key) || {
          categoryName: detail.categoryName || key,
          unit: detail.unit || 'm²',
          assignedVol: 0,
          completedVol: 0,
          completedFrameVol: 0,
          completedBoardVol: 0,
          inspectedVol: 0,
        };
        existing.assignedVol += detail.totalVol;
        existing.completedVol += detail.doneInspectedVol;
        existing.completedFrameVol += detail.doneFrameVol;
        existing.completedBoardVol += detail.doneBoardVol;
        existing.inspectedVol += detail.doneInspectedVol;
        categoryBreakdownMap.set(key, existing);
      });
    });
    const categoryBreakdown = Array.from(categoryBreakdownMap.values());

    const structureGroupMap: Record<string, StructureGroupDetail> = {};
    if (normalizedStructureGrouping.enabled) {
      Object.values(floorGroupMap).forEach((floorDetail) => {
        const floorId = floorDetail.rooms[0]?.floorId || '';
        const floor = floorPlans.find((item) => item.id === floorId);
        const group = structureGroupForFloor(floor, normalizedStructureGrouping);
        const key = group.id || '__ungrouped__';
        const current = structureGroupMap[key] || {
          structureGroupId: key,
          structureGroupName: group.name || 'Chưa phân khu/khối',
          floorNames: [],
          roomCount: 0,
          totalVol: 0,
          doneFrameVol: 0,
          doneBoardVol: 0,
          doneInspectedVol: 0,
        };
        if (!current.floorNames.includes(floorDetail.floorName)) current.floorNames.push(floorDetail.floorName);
        current.roomCount += floorDetail.rooms.length;
        current.totalVol += floorDetail.totalVol;
        current.doneFrameVol += floorDetail.doneFrameVol;
        current.doneBoardVol += floorDetail.doneBoardVol;
        current.doneInspectedVol += floorDetail.doneInspectedVol;
        structureGroupMap[key] = current;
      });
    }

    const totalDefectsCount = teamDefects.length;
    const openDefectsCount = teamDefects.filter((defect) => defect.status === 'Mới phát hiện' || defect.status === 'Đang sửa').length;
    const resolvedDefectsCount = teamDefects.filter((defect) => defect.status === 'Đã khắc phục').length;
    const closedDefectsCount = teamDefects.filter((defect) => defect.status === 'Đã nghiệm thu').length;

    const dateShiftMaxMap: Record<string, { workerCount: number; factor: number; date: string }> = {};
    teamLogs.forEach((log) => {
      const counts = getCrewShiftCounts(log);
      ([['morning', counts.morning], ['afternoon', counts.afternoon], ['evening', counts.evening]] as const).forEach(([shift, count]) => {
        if (count <= 0) return;
        const key = `${log.date}_${shift}`;
        const existing = dateShiftMaxMap[key];
        if (!existing || count > existing.workerCount) dateShiftMaxMap[key] = { workerCount: count, factor: 0.5, date: log.date };
      });
    });
    const dailyMandayMap: Record<string, number> = {};
    const dailyHeadcountMap: Record<string, number> = {};
    Object.values(dateShiftMaxMap).forEach(({ workerCount, factor, date }) => {
      dailyMandayMap[date] = (dailyMandayMap[date] || 0) + workerCount * factor;
      dailyHeadcountMap[date] = Math.max(dailyHeadcountMap[date] || 0, workerCount);
    });
    const totalMandays = Math.round(Object.values(dailyMandayMap).reduce((sum, value) => sum + value, 0) * 100) / 100;
    const dailyCounts = Object.values(dailyHeadcountMap).filter((value) => value > 0);
    const daysWorked = Object.keys(dailyMandayMap).length;
    const avgWorkers = dailyCounts.length ? Math.round((dailyCounts.reduce((sum, value) => sum + value, 0) / dailyCounts.length) * 10) / 10 : 0;
    const maxWorkers = dailyCounts.length ? Math.max(...dailyCounts) : 0;
    const minWorkers = dailyCounts.length ? Math.min(...dailyCounts) : 0;
    const completedRoomsCount = teamRooms.filter((room) =>
      isTeamWorkCompletedInRoom(room, team, workVolumes, resolvedRoomFloorName(room)),
    ).length;

    statsMap[team.id] = {
      team,
      teamRooms,
      totalTeamVol,
      volumeByUnit,
      completedVolumeByUnit,
      completedFrameVol,
      completedBoardVol,
      inspectedVol,
      totalMandays,
      daysWorked,
      avgWorkers,
      maxWorkers,
      minWorkers,
      totalDefectsCount,
      openDefectsCount,
      resolvedDefectsCount,
      closedDefectsCount,
      completedRoomsCount,
      totalAssignedRoomsCount: teamRooms.length,
      categoryBreakdown,
      floorGroupMap,
      structureGroupMap,
      teamRoomDetails,
    };
  });

  return statsMap;
}


