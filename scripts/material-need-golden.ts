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
