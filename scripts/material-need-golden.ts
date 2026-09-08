import assert from 'node:assert/strict';
import { computeMaterialNeeds } from '../src/utils/materialNeedEngine';
import type { InventoryItem, MaterialNorm, RoomProgressItem, TeamInfo, WorkVolume } from '../src/types';

const workVolumes: WorkVolume[] = [
  { id: 'wc-ceiling', title: 'Trần thạch cao', unit: 'm²' } as WorkVolume,
];
const teams: TeamInfo[] = [
  { id: 'team-a', name: 'Đội A' } as TeamInfo,
  { id: 'team-b', name: 'Đội B' } as TeamInfo,
];
const norm: MaterialNorm = {
  id: 'norm-board',
  materialId: 'mat-board',
  materialName: 'Tấm thạch cao',
  category: 'Tấm',
  unit: 'tấm',
  quotaQuantity: 0,
  workCategoryId: 'wc-ceiling',
  workCategoryIds: ['wc-ceiling'],
  workCategoryNormsById: { 'wc-ceiling': 0.35 },
  normBasisUnit: 'm²',
  unitNormPerM2: 0.35,
} as MaterialNorm;

const multiTeamRoom: RoomProgressItem = {
  id: 'room-301',
  roomName: '301',
  floorId: 'floor-3',
  workCategoryId: 'wc-ceiling',
  workCategory: 'Trần thạch cao',
  workVolume: 100,
  volumeUnit: 'm²',
  subItems: [
    { id: 'sub-a', category: 'Trần thạch cao', workCategoryId: 'wc-ceiling', teamId: 'team-a', workVolume: 50, volumeUnit: 'm²' },
    { id: 'sub-b', category: 'Trần thạch cao', workCategoryId: 'wc-ceiling', teamId: 'team-b', workVolume: 50, volumeUnit: 'm²' },
  ],
} as RoomProgressItem;

const inventory: InventoryItem[] = [
  { id: 'in-1', type: 'in', materialId: 'mat-board', materialName: 'Tấm thạch cao', unit: 'tấm', quantity: 100 } as InventoryItem,
  { id: 'out-a', type: 'out', materialId: 'mat-board', materialName: 'Tấm thạch cao', unit: 'tấm', quantity: 10, sourceRoomId: 'room-301', sourceFloorId: 'floor-3', sourceTeamId: 'team-a' } as InventoryItem,
  { id: 'out-legacy', type: 'out', materialId: 'mat-board', materialName: 'Tấm thạch cao', unit: 'tấm', quantity: 6, sourceRoomId: 'room-301', sourceFloorId: 'floor-3' } as InventoryItem,
];

const floor = computeMaterialNeeds({ rooms: [multiTeamRoom], materialNorms: [norm], inventory, workVolumes, teams, scope: { floorId: 'floor-3' } });
assert.equal(floor.lines.length, 1);
assert.equal(floor.lines[0].estimatedQty, 35, 'Floor demand must count the room/category exactly once');
assert.equal(floor.lines[0].alreadyIssued, 16, 'Floor may subtract both allocated and legacy issues proven to belong to the floor');
assert.equal(floor.lines[0].remainingQty, 19);

const teamA = computeMaterialNeeds({ rooms: [multiTeamRoom], materialNorms: [norm], inventory, workVolumes, teams, scope: { floorId: 'floor-3', teamId: 'team-a' } });
assert.equal(teamA.lines[0].estimatedQty, 17.5, 'Team demand must use explicit sub-item work volume');
assert.equal(teamA.lines[0].alreadyIssued, 10, 'Team may subtract only the explicitly allocated issue');
assert.equal(teamA.lines[0].unallocatedIssued, 6, 'Ambiguous legacy issue must remain unallocated');
assert.equal(teamA.lines[0].remainingQty, 7.5, 'Unallocated legacy issue must not reduce team need');
assert.ok(teamA.warnings.some((w) => w.code === 'UNALLOCATED_ISSUE'));

const teamB = computeMaterialNeeds({ rooms: [multiTeamRoom], materialNorms: [norm], inventory, workVolumes, teams, scope: { floorId: 'floor-3', teamId: 'team-b' } });
assert.equal(teamB.lines[0].estimatedQty, 17.5);
assert.equal(teamB.lines[0].alreadyIssued, 0, 'Issue allocated to team A must never be double-counted for team B');
assert.equal(teamB.lines[0].unallocatedIssued, 6);

const ambiguousRoom = {
  ...multiTeamRoom,
  id: 'room-302',
  roomName: '302',
  subItems: [
    { id: 'sub-a2', category: 'Trần thạch cao', workCategoryId: 'wc-ceiling', teamId: 'team-a', volumeUnit: 'm²' },
    { id: 'sub-b2', category: 'Trần thạch cao', workCategoryId: 'wc-ceiling', teamId: 'team-b', volumeUnit: 'm²' },
  ],
} as RoomProgressItem;
const ambiguous = computeMaterialNeeds({ rooms: [ambiguousRoom], materialNorms: [norm], inventory: [], workVolumes, teams, scope: { floorId: 'floor-3', teamId: 'team-a' } });
assert.equal(ambiguous.lines.length, 0, 'Ambiguous multi-team room must fail closed instead of assigning all demand to one team');
assert.equal(ambiguous.failClosed, true);
assert.ok(ambiguous.warnings.some((w) => w.code === 'AMBIGUOUS_TEAM'));

// Regression from live DEV: a room can contain different teams for different work categories.
// Sub-steps carry deterministic team ownership, while workVolume remains only at category level.
const categoryWorkVolumes: WorkVolume[] = [
  { id: 'wc-w12', title: 'Vách W12', unit: 'm²' } as WorkVolume,
  { id: 'wc-c04', title: 'Trần C04', unit: 'm²' } as WorkVolume,
  { id: 'wc-iw11', title: 'Vách IW11', unit: 'm²' } as WorkVolume,
];
const categoryNorms: MaterialNorm[] = [
  {
    id: 'norm-w12', materialId: 'mat-w12-frame', materialName: 'Thanh đứng W12', category: 'Khung vách', unit: 'Thanh', quotaQuantity: 0,
    workCategoryId: 'wc-w12', workCategoryIds: ['wc-w12'], workCategoryNormsById: { 'wc-w12': 0.85 }, normBasisUnit: 'm²', unitNormPerM2: 0.85,
  } as MaterialNorm,
  {
    id: 'norm-c04', materialId: 'mat-c04-frame', materialName: 'Xương C04', category: 'Khung trần', unit: 'Thanh', quotaQuantity: 0,
    workCategoryId: 'wc-c04', workCategoryIds: ['wc-c04'], workCategoryNormsById: { 'wc-c04': 0.4 }, normBasisUnit: 'm²', unitNormPerM2: 0.4,
  } as MaterialNorm,
  {
    id: 'norm-iw11', materialId: 'mat-iw11-frame', materialName: 'Thanh đứng IW11', category: 'Khung vách', unit: 'Thanh', quotaQuantity: 0,
    workCategoryId: 'wc-iw11', workCategoryIds: ['wc-iw11'], workCategoryNormsById: { 'wc-iw11': 0.85 }, normBasisUnit: 'm²', unitNormPerM2: 0.85,
  } as MaterialNorm,
];
const roomBhs = {
  id: 'room-bhs', roomName: 'Phòng BHS', floorId: 'floor-ground',
  categoryVolumes: { 'wc-w12': 178.27, 'wc-c04': 50 },
  categoryVolumeUnits: { 'wc-w12': 'm²', 'wc-c04': 'm²' },
  frameStatus: 'Đang làm', boardStatus: 'Đang làm', inspectionStatus: 'Chưa nghiệm thu', updatedAt: 1,
  x: 0, y: 0, width: 1, height: 1,
  subItems: [
    { id: 'w12-1', name: 'Thi công khung', category: 'Vách W12', workCategoryId: 'wc-w12', teamId: 'team-a', status: 'Đã hoàn thành' },
    { id: 'w12-2', name: 'Thi công tấm mặt 1', category: 'Vách W12', workCategoryId: 'wc-w12', teamId: 'team-a', status: 'Đã hoàn thành' },
    { id: 'w12-3', name: 'Thi công tấm mặt 2', category: 'Vách W12', workCategoryId: 'wc-w12', teamId: 'team-a', status: 'Đã hoàn thành' },
    { id: 'c04-1', name: 'Thi công khung', category: 'Trần C04', workCategoryId: 'wc-c04', teamId: 'team-b', status: 'Đang làm' },
    { id: 'c04-2', name: 'Thi công tấm', category: 'Trần C04', workCategoryId: 'wc-c04', teamId: 'team-b', status: 'Chưa làm' },
  ],
} as RoomProgressItem;

const groundTeamA = computeMaterialNeeds({
  rooms: [roomBhs], materialNorms: categoryNorms, inventory: [], workVolumes: categoryWorkVolumes, teams,
  scope: { floorId: 'floor-ground', teamId: 'team-a' },
});
assert.equal(groundTeamA.lines.length, 1, 'W12 must belong to Team A from category-level sub-step linkage');
assert.equal(groundTeamA.lines[0].materialId, 'mat-w12-frame');
assert.equal(groundTeamA.lines[0].estimatedQty, 151.53);
assert.equal(groundTeamA.warnings.some((w) => w.code === 'AMBIGUOUS_TEAM'), false);

const groundTeamB = computeMaterialNeeds({
  rooms: [roomBhs], materialNorms: categoryNorms, inventory: [], workVolumes: categoryWorkVolumes, teams,
  scope: { floorId: 'floor-ground', teamId: 'team-b' },
});
assert.equal(groundTeamB.lines.length, 1, 'C04 must belong to Team B from category-level sub-step linkage');
assert.equal(groundTeamB.lines[0].materialId, 'mat-c04-frame');
assert.equal(groundTeamB.lines[0].estimatedQty, 20);
assert.equal(groundTeamB.warnings.some((w) => w.code === 'AMBIGUOUS_TEAM'), false);

const roomIw11 = {
  id: 'room-a9-13', roomName: 'Vách NH/A9-13', floorId: 'floor-3',
  workCategoryId: 'wc-iw11', workCategory: 'Vách IW11', workVolume: 150, volumeUnit: 'm²',
  frameStatus: 'Đang làm', boardStatus: 'Đang làm', inspectionStatus: 'Chưa nghiệm thu', updatedAt: 2,
  x: 0, y: 0, width: 1, height: 1,
  subItems: [
    { id: 'iw11-1', name: 'Thi công khung', category: 'Vách IW11', workCategoryId: 'wc-iw11', teamId: 'team-a', status: 'Đã hoàn thành' },
    { id: 'iw11-2', name: 'Thi công tấm', category: 'Vách IW11', workCategoryId: 'wc-iw11', teamId: 'team-a', status: 'Đang làm' },
  ],
} as RoomProgressItem;
const floor3TeamA = computeMaterialNeeds({
  rooms: [roomIw11], materialNorms: categoryNorms, inventory: [], workVolumes: categoryWorkVolumes, teams,
  scope: { floorId: 'floor-3', teamId: 'team-a' },
});
assert.equal(floor3TeamA.lines.length, 1, 'Tầng 3 IW11 must remain visible for Team A without per-step workVolume');
assert.equal(floor3TeamA.lines[0].materialId, 'mat-iw11-frame');
assert.equal(floor3TeamA.lines[0].estimatedQty, 127.5);

const missingNorm = computeMaterialNeeds({ rooms: [multiTeamRoom], materialNorms: [], inventory: [], workVolumes, teams, scope: { floorId: 'floor-3' } });
assert.equal(missingNorm.lines.length, 0);
assert.equal(missingNorm.failClosed, true);
assert.ok(missingNorm.warnings.some((w) => w.code === 'MISSING_NORM'));

const mismatchedNorm = { ...norm, id: 'norm-bad-unit', workCategoryNormsById: undefined, unitNormPerM2: 0.35, normBasisUnit: 'm' } as MaterialNorm;
const unitMismatch = computeMaterialNeeds({ rooms: [multiTeamRoom], materialNorms: [mismatchedNorm], inventory: [], workVolumes, teams, scope: { floorId: 'floor-3' } });
assert.equal(unitMismatch.lines.length, 0);
assert.equal(unitMismatch.failClosed, true);
assert.ok(unitMismatch.warnings.some((w) => w.code === 'UNIT_MISMATCH'));

console.log('MATERIAL NEED GOLDEN PASS');
