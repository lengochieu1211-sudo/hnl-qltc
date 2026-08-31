import { TeamInfo, RoomProgressItem, DefectItem, CrewRecord, FloorPlan, TeamRoomDetail, RoomSubItem } from '../types';
import { normalizeUnit } from './unitUtils';
import { getCrewShiftCounts } from './crewUtils';

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

/**
 * Helper to get categories of a room that a specific team actually worked on (subitems or main).
 */
export function getTeamCategoriesForRoom(room: RoomProgressItem, team: TeamInfo): Set<string> {
  const isMain = isTeamMatch(room.assignedTeam, team, room.teamId);
  const potentialCats = new Set<string>();
  if (isMain) {
    if (room.workCategory) potentialCats.add(room.workCategory);
    if (room.categoryVolumes) {
      Object.keys(room.categoryVolumes).forEach(c => potentialCats.add(c));
    }
  }
  if (room.subItems) {
    room.subItems.forEach(sub => {
      if (isTeamMatch(sub.assignedTeam, team, sub.teamId)) {
        const c = sub.category || room.workCategory;
        if (c) potentialCats.add(c);
      }
    });
  }

  const teamCats = new Set<string>();
  potentialCats.forEach(cat => {
    const subItemsInCat = room.subItems?.filter(s => (s.category || room.workCategory) === cat) || [];
    if (subItemsInCat.length > 0) {
      const hasMatchingSubItem = subItemsInCat.some(s => 
        isTeamMatch(s.assignedTeam, team, s.teamId) || (!s.assignedTeam && !s.teamId && isMain)
      );
      if (hasMatchingSubItem) {
        teamCats.add(cat);
      }
    } else {
      if (isMain) {
        teamCats.add(cat);
      }
    }
  });
  return teamCats;
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
      unit: string;
      totalVol: number;
      doneFrameVol: number;
      doneBoardVol: number;
      doneInspectedVol: number;
    }
  >;
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
  teamRoomDetails: TeamRoomDetail[];
}

export function isTeamWorkCompletedInRoom(room: RoomProgressItem, team: TeamInfo): boolean {
  const teamCats = getTeamCategoriesForRoom(room, team);
  if (teamCats.size === 0) return false;
  
  const isMain = isTeamMatch(room.assignedTeam, team, room.teamId);
  
  for (const cat of teamCats) {
    const allSubItemsInCat = room.subItems?.filter(s => (s.category || room.workCategory) === cat) || [];
    const teamSubItemsInCat = allSubItemsInCat.filter(s => 
      isTeamMatch(s.assignedTeam, team, s.teamId) || (!s.assignedTeam && !s.teamId && isMain)
    );
    
    if (teamSubItemsInCat.length > 0) {
      // “Thi công xong” và “Đạt nghiệm thu” là hai trạng thái khác nhau.
      // Chỉ tính Căn / Phòng đã nghiệm thu cho đội khi toàn bộ phần việc của đội đã Đạt NT.
      const allInspected = teamSubItemsInCat.every((s) => s.inspectionStatus === 'Đạt nghiệm thu');
      if (!allInspected) return false;
    } else {
      if (!isMain || room.inspectionStatus !== 'Đạt nghiệm thu') return false;
    }
  }
  return true;
}

/**
 * Single unified team statistics calculation function used across CrewTab UI and Excel exports.
 */
export function calculateTeamStatistics(params: {
  teams: TeamInfo[];
  roomProgressList: RoomProgressItem[];
  defects: DefectItem[];
  crewRecords: CrewRecord[];
  floorPlans?: FloorPlan[];
}): Record<string, TeamStatistics> {
  const { teams, roomProgressList = [], defects = [], crewRecords = [], floorPlans = [] } = params;
  const statsMap: Record<string, TeamStatistics> = {};

  teams.forEach(team => {
    const teamRooms = roomProgressList.filter(r => {
      const cats = getTeamCategoriesForRoom(r, team);
      return cats.size > 0;
    });
    const teamDefects = defects.filter(d => !d.archivedAt && isTeamMatch(d.assignedTo, team, d.teamId));
    const teamLogs = crewRecords.filter(l => isTeamMatch(l.teamName, team, l.teamId));

    let totalTeamVol = 0;
    let completedFrameVol = 0;
    let completedBoardVol = 0;
    let inspectedVol = 0;

    const volumeByUnit: Record<string, number> = {};
    const completedVolumeByUnit: Record<string, number> = {};
    const floorGroupMap: Record<string, FloorGroupDetail> = {};
    const teamRoomDetails: TeamRoomDetail[] = [];

    teamRooms.forEach(room => {
      const fp = floorPlans.find(f => f.id === room.floorId);
      const fName = room.floorName || fp?.floorName || 'Mặt bằng';
      if (!floorGroupMap[fName]) {
        floorGroupMap[fName] = {
          floorName: fName,
          rooms: [],
          totalVol: 0,
          doneFrameVol: 0,
          doneBoardVol: 0,
          doneInspectedVol: 0,
          doneRooms: 0,
          categoryVolumes: {},
          categoryDetails: {}
        };
      }
      floorGroupMap[fName].rooms.push(room);

      const isMain = isTeamMatch(room.assignedTeam, team, room.teamId);
      const teamCats = getTeamCategoriesForRoom(room, team);

      let roomTeamVol = 0;
      let roomInspectedVol = 0;
      let roomFrameVol = 0;
      let roomBoardVol = 0;

      if (teamCats.size > 0) {
        teamCats.forEach(cat => {
          const catTotalVol = room.categoryVolumes?.[cat] ?? ((room.workCategory === cat || teamCats.size === 1) ? (room.workVolume || 0) : 0);
          
          let unit = getRoomCategoryUnit(room, cat);
          const allSubItemsInCat = room.subItems?.filter(s => (s.category || room.workCategory) === cat) || [];
          const subWithUnit = allSubItemsInCat.find(s => s.volumeUnit);
          if (subWithUnit?.volumeUnit) {
            unit = normalizeUnit(subWithUnit.volumeUnit) || subWithUnit.volumeUnit;
          }

          const subItemsInCat = allSubItemsInCat.filter(s => 
            isTeamMatch(s.assignedTeam, team, s.teamId) || (!s.assignedTeam && !s.teamId && isMain)
          );

          // Calculate effective assigned category volume for this team (Fix P0-10)
          let catAssignedVol = catTotalVol;
          if (allSubItemsInCat.length > 0) {
            const totalCatWeight = allSubItemsInCat.reduce((sum, s) => sum + getSubItemGroupWeight(allSubItemsInCat, s), 0);
            const teamCatWeight = subItemsInCat.reduce((sum, s) => sum + getSubItemGroupWeight(allSubItemsInCat, s), 0);
            catAssignedVol = totalCatWeight > 0 ? (catTotalVol * (teamCatWeight / totalCatWeight)) : 0;
          } else {
            catAssignedVol = isMain ? catTotalVol : 0;
          }

          roomTeamVol += catAssignedVol;
          floorGroupMap[fName].categoryVolumes[cat] = (floorGroupMap[fName].categoryVolumes[cat] || 0) + catAssignedVol;
          volumeByUnit[unit] = (volumeByUnit[unit] || 0) + catAssignedVol;

          let catFrameVol = 0;
          let catBoardVol = 0;
          let catInspectedVol = 0;

          if (allSubItemsInCat.length > 0) {
            if (subItemsInCat.length > 0) {
              const frameSubs = subItemsInCat.filter(s => s.name.toLowerCase().includes('khung'));
              const boardSubs = subItemsInCat.filter(s => s.name.toLowerCase().includes('tấm') || s.name.toLowerCase().includes('bắn'));

              const allFrameSubs = allSubItemsInCat.filter(s => s.name.toLowerCase().includes('khung'));
              const allBoardSubs = allSubItemsInCat.filter(s => s.name.toLowerCase().includes('tấm') || s.name.toLowerCase().includes('bắn'));

              const totalCatWeight = allSubItemsInCat.reduce((sum, s) => sum + getSubItemGroupWeight(allSubItemsInCat, s), 0);
              // Every progress/inspection volume is measured against the SAME category
              // denominator. This guarantees a team's completed volume can never exceed
              // the volume actually assigned to that team.
              const inspectedCatWeight = subItemsInCat
                .filter((s) => s.status === 'Đã hoàn thành' && s.inspectionStatus === 'Đạt nghiệm thu')
                .reduce((sum, s) => sum + getSubItemGroupWeight(allSubItemsInCat, s), 0);
              const doneFrameWeight = frameSubs
                .filter(s => s.status === 'Đã hoàn thành')
                .reduce((sum, s) => sum + getSubItemGroupWeight(allSubItemsInCat, s), 0);
              const doneBoardWeight = boardSubs
                .filter(s => s.status === 'Đã hoàn thành')
                .reduce((sum, s) => sum + getSubItemGroupWeight(allSubItemsInCat, s), 0);

              catInspectedVol = catTotalVol * (totalCatWeight > 0 ? inspectedCatWeight / totalCatWeight : 0);
              catFrameVol = catTotalVol * (totalCatWeight > 0 ? doneFrameWeight / totalCatWeight : 0);
              catBoardVol = catTotalVol * (totalCatWeight > 0 ? doneBoardWeight / totalCatWeight : 0);
            }
          } else {
            if (isMain) {
              catInspectedVol = room.inspectionStatus === 'Đạt nghiệm thu' ? catAssignedVol : 0;
              catFrameVol = room.frameStatus === 'Đã hoàn thành' ? catAssignedVol : (room.frameStatus === 'Đang làm' ? catAssignedVol * 0.5 : 0);
              catBoardVol = room.boardStatus === 'Đã hoàn thành' ? catAssignedVol : (room.boardStatus === 'Đang làm' ? catAssignedVol * 0.5 : 0);
            }
          }

          roomInspectedVol += catInspectedVol;
          roomFrameVol += catFrameVol;
          roomBoardVol += catBoardVol;
          completedVolumeByUnit[unit] = (completedVolumeByUnit[unit] || 0) + catInspectedVol;

          if (!floorGroupMap[fName].categoryDetails[cat]) {
            floorGroupMap[fName].categoryDetails[cat] = { unit, totalVol: 0, doneFrameVol: 0, doneBoardVol: 0, doneInspectedVol: 0 };
          }
          floorGroupMap[fName].categoryDetails[cat].totalVol += catAssignedVol;
          floorGroupMap[fName].categoryDetails[cat].doneFrameVol += catFrameVol;
          floorGroupMap[fName].categoryDetails[cat].doneBoardVol += catBoardVol;
          floorGroupMap[fName].categoryDetails[cat].doneInspectedVol += catInspectedVol;

          // Derive the row statuses from the exact sub-items assigned to this team,
          // not from the room-wide legacy status. This keeps UI/Excel consistent when
          // different teams handle Khung and Tấm in the same Căn / Phòng.
          const aggregateWorkStatus = (items: RoomSubItem[], fallback: any) => {
            if (items.length === 0) return fallback;
            if (items.every(s => s.status === 'Đã hoàn thành')) return 'Đã hoàn thành';
            if (items.some(s => s.status === 'Đang làm' || s.status === 'Đã hoàn thành')) return 'Đang làm';
            return 'Chưa làm';
          };
          const aggregateInspectionStatus = (items: RoomSubItem[], fallback: any) => {
            if (items.length === 0) return fallback;
            if (items.some(s => s.inspectionStatus === 'Chưa đạt (Cần sửa)')) return 'Chưa đạt (Cần sửa)';
            if (items.every(s => s.status === 'Đã hoàn thành' && s.inspectionStatus === 'Đạt nghiệm thu')) return 'Đạt nghiệm thu';
            return 'Chưa nghiệm thu';
          };
          const teamFrameSubs = subItemsInCat.filter(s => s.name.toLowerCase().includes('khung'));
          const teamBoardSubs = subItemsInCat.filter(s => s.name.toLowerCase().includes('tấm') || s.name.toLowerCase().includes('bắn'));
          const derivedFrameStatus = aggregateWorkStatus(teamFrameSubs, room.frameStatus);
          const derivedBoardStatus = aggregateWorkStatus(teamBoardSubs, room.boardStatus);
          const derivedInspectionStatus = aggregateInspectionStatus(subItemsInCat, room.inspectionStatus);

          // Add to teamRoomDetails for individual room detail sheet (Fix P0-12)
          teamRoomDetails.push({
            roomId: room.id,
            roomName: room.roomName,
            floorId: room.floorId || fp?.id || '',
            floorName: fName,
            workCategoryId: room.workCategoryId,
            workCategoryName: cat,
            unit,
            teamId: team.id,
            teamName: team.name,
            assignedVolume: Math.round(catAssignedVol * 100) / 100,
            frameVolume: Math.round(catFrameVol * 100) / 100,
            boardVolume: Math.round(catBoardVol * 100) / 100,
            inspectedVolume: Math.round(catInspectedVol * 100) / 100,
            progress: catAssignedVol > 0 ? Math.min(100, Math.round((catInspectedVol / catAssignedVol) * 100)) : (room.inspectionStatus === 'Đạt nghiệm thu' ? 100 : 0),
            frameStatus: derivedFrameStatus,
            boardStatus: derivedBoardStatus,
            inspectionStatus: derivedInspectionStatus,
            targetDate: room.targetBoardDate || room.targetFrameDate || '',
            notes: room.notes
          });
        });
      }

      floorGroupMap[fName].totalVol += roomTeamVol;
      floorGroupMap[fName].doneFrameVol += roomFrameVol;
      floorGroupMap[fName].doneBoardVol += roomBoardVol;
      floorGroupMap[fName].doneInspectedVol += roomInspectedVol;
      if (isTeamWorkCompletedInRoom(room, team)) {
        floorGroupMap[fName].doneRooms += 1;
      }

      totalTeamVol += roomTeamVol;
      inspectedVol += roomInspectedVol;
      completedFrameVol += roomFrameVol;
      completedBoardVol += roomBoardVol;
    });

    // Category breakdown accumulation
    const catBreakdownMap: Record<string, { unit: string; assignedVol: number; completedVol: number; completedFrameVol: number; completedBoardVol: number; inspectedVol: number }> = {};
    Object.values(floorGroupMap).forEach(fg => {
      Object.entries(fg.categoryDetails).forEach(([catName, det]) => {
        if (!catBreakdownMap[catName]) {
          catBreakdownMap[catName] = { unit: det.unit || 'm²', assignedVol: 0, completedVol: 0, completedFrameVol: 0, completedBoardVol: 0, inspectedVol: 0 };
        }
        catBreakdownMap[catName].assignedVol += det.totalVol;
        catBreakdownMap[catName].completedFrameVol += det.doneFrameVol;
        catBreakdownMap[catName].completedBoardVol += det.doneBoardVol;
        catBreakdownMap[catName].inspectedVol += det.doneInspectedVol;
        catBreakdownMap[catName].completedVol += det.doneInspectedVol;
      });
    });

    const categoryBreakdown: TeamCategoryBreakdown[] = Object.entries(catBreakdownMap).map(([catName, v]) => ({
      categoryName: catName,
      unit: v.unit,
      assignedVol: Math.round(v.assignedVol * 100) / 100,
      completedVol: Math.round(v.completedVol * 100) / 100,
      completedFrameVol: Math.round(v.completedFrameVol * 100) / 100,
      completedBoardVol: Math.round(v.completedBoardVol * 100) / 100,
      inspectedVol: Math.round(v.inspectedVol * 100) / 100,
    }));

    // Defects statistics
    const totalDefectsCount = teamDefects.length;
    const openDefectsCount = teamDefects.filter(d => d.status === 'Mới phát hiện' || d.status === 'Đang sửa').length;
    const resolvedDefectsCount = teamDefects.filter(d => d.status === 'Đã khắc phục').length;
    const closedDefectsCount = teamDefects.filter(d => d.status === 'Đã nghiệm thu').length;

    // Mandays & Crew statistics. New records may have different headcount in
    // morning/afternoon/evening. Group each shift independently so changing
    // headcount across the day is reflected without double-counting floor rows.
    const dateShiftMaxMap: Record<string, { workerCount: number; factor: number; date: string }> = {};
    teamLogs.forEach(l => {
      const counts = getCrewShiftCounts(l);
      ([
        ['morning', counts.morning],
        ['afternoon', counts.afternoon],
        ['evening', counts.evening],
      ] as const).forEach(([shiftKeyPart, workerCount]) => {
        if (workerCount <= 0) return;
        const shiftKey = `${l.date}_${shiftKeyPart}`;
        const existing = dateShiftMaxMap[shiftKey];
        if (!existing || workerCount > existing.workerCount) {
          dateShiftMaxMap[shiftKey] = { workerCount, factor: 0.5, date: l.date };
        }
      });
    });

    const dailyMandayMap: Record<string, number> = {};
    const dailyHeadcountMap: Record<string, number> = {};
    Object.values(dateShiftMaxMap).forEach(({ workerCount, factor, date }) => {
      const mandays = workerCount * factor;
      if (mandays > 0) {
        dailyMandayMap[date] = (dailyMandayMap[date] || 0) + mandays;
        dailyHeadcountMap[date] = Math.max(dailyHeadcountMap[date] || 0, workerCount);
      }
    });

    const totalMandays = Math.round(Object.values(dailyMandayMap).reduce((sum, c) => sum + c, 0) * 100) / 100;
    const dailyCounts = Object.values(dailyHeadcountMap).filter(c => c > 0);
    const daysWorked = Object.values(dailyMandayMap).filter((mandays) => mandays > 0).length;
    const avgWorkers = dailyCounts.length > 0 ? Math.round((dailyCounts.reduce((sum, c) => sum + c, 0) / dailyCounts.length) * 10) / 10 : 0;
    const maxWorkers = dailyCounts.length > 0 ? Math.max(...dailyCounts) : 0;
    const minWorkers = dailyCounts.length > 0 ? Math.min(...dailyCounts) : 0;

    const completedRoomsCount = teamRooms.filter(r => isTeamWorkCompletedInRoom(r, team)).length;

    statsMap[team.id] = {
      team,
      teamRooms,
      totalTeamVol: Math.round(totalTeamVol * 100) / 100,
      volumeByUnit,
      completedVolumeByUnit,
      completedFrameVol: Math.round(completedFrameVol * 100) / 100,
      completedBoardVol: Math.round(completedBoardVol * 100) / 100,
      inspectedVol: Math.round(inspectedVol * 100) / 100,
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
      teamRoomDetails
    };
  });

  return statsMap;
}


