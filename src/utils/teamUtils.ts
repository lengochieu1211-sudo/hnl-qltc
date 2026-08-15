import { TeamInfo, RoomProgressItem, DefectItem, CrewRecord, FloorPlan, TeamRoomDetail, RoomSubItem } from '../types';

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
 * Unified matching for team identity.
 * Prioritizes assignedTeamId === team.id, with fallback to exact team name/leader matching.
 * Strictly avoids partial substring matching (e.g., 'Đội A' will NOT match 'Đội A1').
 */
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
      const allDone = teamSubItemsInCat.every(s => s.status === 'Đã hoàn thành' || s.inspectionStatus === 'Đạt nghiệm thu');
      if (!allDone) return false;
    } else {
      if (isMain) {
        const frameDone = room.frameStatus === 'Đã hoàn thành';
        const boardDone = room.boardStatus === 'Đã hoàn thành';
        const inspected = room.inspectionStatus === 'Đạt nghiệm thu';
        if (!inspected && !(frameDone && boardDone)) {
          return false;
        }
      } else {
        return false;
      }
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
    const teamDefects = defects.filter(d => isTeamMatch(d.assignedTo, team, d.teamId));
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
          
          let unit = room.volumeUnit || 'm²';
          const allSubItemsInCat = room.subItems?.filter(s => (s.category || room.workCategory) === cat) || [];
          const subWithUnit = allSubItemsInCat.find(s => s.volumeUnit);
          if (subWithUnit?.volumeUnit) {
            unit = subWithUnit.volumeUnit;
          }

          const subItemsInCat = allSubItemsInCat.filter(s => 
            isTeamMatch(s.assignedTeam, team, s.teamId) || (!s.assignedTeam && !s.teamId && isMain)
          );

          // Calculate effective assigned category volume for this team (Fix P0-10)
          let catAssignedVol = catTotalVol;
          if (allSubItemsInCat.length > 0) {
            const totalCatWeight = allSubItemsInCat.reduce((sum, s) => sum + getSubItemEffectiveWeight(s), 0);
            const teamCatWeight = subItemsInCat.reduce((sum, s) => sum + getSubItemEffectiveWeight(s), 0);
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

              const totalCatWeight = allSubItemsInCat.reduce((sum, s) => sum + getSubItemEffectiveWeight(s), 0);
              const doneCatWeight = subItemsInCat.filter(s => s.status === 'Đã hoàn thành' || s.inspectionStatus === 'Đạt nghiệm thu')
                .reduce((sum, s) => sum + getSubItemEffectiveWeight(s), 0);

              const totalFrameWeight = allFrameSubs.reduce((sum, s) => sum + getSubItemEffectiveWeight(s), 0);
              const doneFrameWeight = frameSubs.filter(s => s.status === 'Đã hoàn thành' || s.inspectionStatus === 'Đạt nghiệm thu')
                .reduce((sum, s) => sum + getSubItemEffectiveWeight(s), 0);

              const totalBoardWeight = allBoardSubs.reduce((sum, s) => sum + getSubItemEffectiveWeight(s), 0);
              const doneBoardWeight = boardSubs.filter(s => s.status === 'Đã hoàn thành' || s.inspectionStatus === 'Đạt nghiệm thu')
                .reduce((sum, s) => sum + getSubItemEffectiveWeight(s), 0);

              catInspectedVol = catTotalVol * (totalCatWeight > 0 ? doneCatWeight / totalCatWeight : 0);
              catFrameVol = catTotalVol * (allFrameSubs.length > 0 ? (totalFrameWeight > 0 ? doneFrameWeight / totalFrameWeight : 0) : (isMain && room.frameStatus === 'Đã hoàn thành' ? 1 : 0));
              catBoardVol = catTotalVol * (allBoardSubs.length > 0 ? (totalBoardWeight > 0 ? doneBoardWeight / totalBoardWeight : 0) : (isMain && room.boardStatus === 'Đã hoàn thành' ? 1 : 0));
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
            frameStatus: room.frameStatus,
            boardStatus: room.boardStatus,
            inspectionStatus: room.inspectionStatus,
            targetDate: room.targetBoardDate || room.targetFrameDate || '',
            notes: room.notes
          });
        });
      }

      floorGroupMap[fName].totalVol += roomTeamVol;
      floorGroupMap[fName].doneFrameVol += roomFrameVol;
      floorGroupMap[fName].doneBoardVol += roomBoardVol;
      floorGroupMap[fName].doneInspectedVol += roomInspectedVol;
      if (room.inspectionStatus === 'Đạt nghiệm thu' || (roomTeamVol > 0 && roomInspectedVol >= roomTeamVol)) {
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

    // Mandays & Crew statistics (Unified single worker count avoiding double-counting across multiple floor records for same shift)
    const getWorkerCount = (r: CrewRecord) => r.workerCount || ((r.workersInside || 0) + (r.workersOutside || 0)) || 0;

    // Group logs by date and shift to prevent double-counting team members on multiple floors in same shift
    const dateShiftMaxMap: Record<string, number> = {};
    const dailyWorkerSumMap: Record<string, number> = {};

    teamLogs.forEach(l => {
      const shiftKey = `${l.date}_${l.shift || 'default'}`;
      const wc = getWorkerCount(l);
      dateShiftMaxMap[shiftKey] = Math.max(dateShiftMaxMap[shiftKey] || 0, wc);
    });

    Object.entries(dateShiftMaxMap).forEach(([key, maxWc]) => {
      const date = key.split('_')[0];
      dailyWorkerSumMap[date] = (dailyWorkerSumMap[date] || 0) + maxWc;
    });

    const totalMandays = Object.values(dailyWorkerSumMap).reduce((sum, c) => sum + c, 0);
    const dailyCounts = Object.values(dailyWorkerSumMap).filter(c => c > 0);
    const daysWorked = Object.keys(dailyWorkerSumMap).length;
    const avgWorkers = dailyCounts.length > 0 ? Math.round((totalMandays / dailyCounts.length) * 10) / 10 : 0;
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


