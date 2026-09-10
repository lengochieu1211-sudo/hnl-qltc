import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findRoomForDefectPoint, reconcileDefectLinkage, resolveDefectLinkageFromSelection } from '../src/utils/defectLinkageUtils';
import type { DefectItem, RoomProgressItem, TeamInfo } from '../src/types';

const teams: TeamInfo[] = [
  { id: 'team-a', name: 'Đội A Mới', leader: 'A', defaultCount: 5 },
  { id: 'team-b', name: 'Đội B', leader: 'B', defaultCount: 5 },
];

const rooms: RoomProgressItem[] = [
  {
    id: 'room-101', floorId: 'f1', floorName: 'Tầng 1', roomName: 'Căn 101',
    x: 10, y: 10, width: 20, height: 20,
    frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu',
    assignedTeam: 'Tên đội A cũ', teamId: 'team-a', updatedAt: 1,
  },
  {
    id: 'room-poly', floorId: 'f1', floorName: 'Tầng 1', roomName: 'Căn Polygon',
    x: 40, y: 10, width: 20, height: 20,
    points: [{ x: 40, y: 10 }, { x: 60, y: 10 }, { x: 50, y: 30 }],
    frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu',
    assignedTeam: 'Đội B', teamId: 'team-b', updatedAt: 1,
  },
];

assert.equal(findRoomForDefectPoint({ x: 15, y: 15 }, rooms)?.id, 'room-101', 'rectangle highlight must resolve roomId');
assert.equal(findRoomForDefectPoint({ x: 50, y: 20 }, rooms)?.id, 'room-poly', 'polygon highlight must resolve roomId');

const base: DefectItem = {
  id: 'd1', floorId: 'f1', floorName: 'Tầng 1', x: 15, y: 15,
  category: 'Tấm thạch cao', description: 'test', severity: 'Thấp', assignedTo: 'Tên đội A cũ',
  status: 'Mới phát hiện', createdAt: '2026-09-04T00:00:00.000Z',
};

const repaired = reconcileDefectLinkage(base, rooms, teams);
assert.equal(repaired.roomId, 'room-101', 'legacy defect must persist roomId from pin geometry');
assert.equal(repaired.teamId, 'team-a', 'room teamId must backfill when assignedTo is stale');
assert.equal(repaired.assignedTo, 'Đội A Mới', 'team rename must refresh display text from durable teamId');

const explicit = reconcileDefectLinkage({ ...base, teamId: 'team-b', assignedTo: 'Tên B cũ' }, rooms, teams);
assert.equal(explicit.teamId, 'team-b', 'valid explicit per-defect teamId must win over room default');
assert.equal(explicit.assignedTo, 'Đội B', 'explicit teamId must survive team rename');

const selected = resolveDefectLinkageFromSelection({ x: 15, y: 15 }, 'Đội B', rooms, teams);
assert.deepEqual(selected, { roomId: 'room-101', teamId: 'team-b', assignedTo: 'Đội B' }, 'manual team selection must keep roomId and selected teamId');

const loading = reconcileDefectLinkage({ ...base, roomId: 'room-101', teamId: 'team-a' }, [], []);
assert.equal(loading.roomId, 'room-101', 'empty realtime rooms must not erase roomId');
assert.equal(loading.teamId, 'team-a', 'empty realtime teams must not erase teamId');

// Duplicate legacy names must fail closed. Never bind to the first matching team.
const duplicateTeams: TeamInfo[] = [
  { id: 'dup-1', name: 'Đội Trùng', leader: 'Một', defaultCount: 4 },
  { id: 'dup-2', name: '  ĐỘI TRÙNG  ', leader: 'Hai', defaultCount: 6 },
  { id: 'room-default', name: 'Đội Phòng', leader: 'Phòng', defaultCount: 5 },
];
const duplicateRoom: RoomProgressItem = {
  id: 'room-dup', floorId: 'f1', floorName: 'Tầng 1', roomName: 'Căn Trùng',
  x: 70, y: 10, width: 20, height: 20,
  frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu',
  assignedTeam: 'Đội Phòng', teamId: 'room-default', updatedAt: 1,
};
const ambiguousDefect: DefectItem = {
  ...base,
  id: 'd-ambiguous', x: 75, y: 15, assignedTo: 'đội trùng', teamId: undefined,
};
const ambiguousReconciled = reconcileDefectLinkage(ambiguousDefect, [duplicateRoom], duplicateTeams);
assert.equal(ambiguousReconciled.roomId, 'room-dup', 'ambiguous Defect name must still keep geometry roomId');
assert.equal(ambiguousReconciled.teamId, undefined, 'ambiguous Defect name must not choose first duplicate or silently fall back to room default');
assert.equal(ambiguousReconciled.assignedTo, 'đội trùng', 'ambiguous legacy display text must remain visible for manual repair');

const ambiguousSelection = resolveDefectLinkageFromSelection({ x: 75, y: 15 }, 'Đội Trùng', [duplicateRoom], duplicateTeams);
assert.deepEqual(
  ambiguousSelection,
  { roomId: 'room-dup', teamId: undefined, assignedTo: 'Đội Trùng' },
  'manual ambiguous name selection must fail closed instead of choosing first duplicate or room team',
);

const explicitDuplicate = reconcileDefectLinkage(
  { ...ambiguousDefect, teamId: 'dup-2', assignedTo: 'Đội Trùng' },
  [duplicateRoom],
  duplicateTeams,
);
assert.equal(explicitDuplicate.teamId, 'dup-2', 'explicit Defect teamId must remain authoritative even when display names are duplicated');
assert.equal(explicitDuplicate.assignedTo, '  ĐỘI TRÙNG  ', 'explicit teamId must canonicalize to that exact team entry');

const duplicateRoomWithoutId: RoomProgressItem = {
  ...duplicateRoom,
  id: 'room-dup-no-id', x: 100,
  assignedTeam: 'Đội Trùng', teamId: undefined,
};
const roomAmbiguous = reconcileDefectLinkage(
  { ...base, id: 'd-room-ambiguous', x: 105, y: 15, assignedTo: '' },
  [duplicateRoomWithoutId],
  duplicateTeams,
);
assert.equal(roomAmbiguous.teamId, undefined, 'duplicate room assignedTeam without durable teamId must fail closed');

const floorPlanSource = fs.readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');
assert.match(floorPlanSource, /teamNameById = new Map/, 'Defect team picker must resolve durable room/sub-item teamId to the current team name');
assert.match(floorPlanSource, /roomAtPosTeamNames/, 'Defect team picker must collect room-specific teams');
assert.match(floorPlanSource, /roomAtPos\.subItems/, 'Defect team picker must include teams assigned on current-room sub-items');
assert.match(floorPlanSource, /Đội đang làm Căn \/ Phòng hiện tại/, 'Defect picker must prioritize current-room teams before floor-wide teams');
assert.match(floorPlanSource, /Đội Defect đang chọn:/, 'Defect form must visibly confirm the team selected for the Defect');
assert.doesNotMatch(floorPlanSource, />Căn này chưa có đội</, 'ambiguous legacy room-team warning must not hide a valid Defect team selection');

console.log('Defect Linkage Golden: PASS');
