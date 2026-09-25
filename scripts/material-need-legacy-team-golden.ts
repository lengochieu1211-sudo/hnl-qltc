import assert from 'node:assert/strict';
import { computeMaterialNeeds } from '../src/utils/materialNeedEngine';
import type { InventoryItem, MaterialNorm, RoomProgressItem, TeamInfo, WorkVolume } from '../src/types';

const floorId = 'fp-floor-3';
const workCategoryId = 'HM-IW11';
const teamNguyenId = 'team-nguyen';
const teamAnId = 'team-an';

const teams: TeamInfo[] = [
  { id: teamNguyenId, name: 'Đội Nguyên', leader: 'Nguyễn Văn Nguyên', defaultCount: 2 } as TeamInfo,
  { id: teamAnId, name: 'Đội An', leader: 'Trần Thanh An', defaultCount: 2 } as TeamInfo,
];

const workVolumes: WorkVolume[] = [
  { id: workCategoryId, workCategoryId, title: 'Vách IW11', unit: 'm²' } as WorkVolume,
];

const norms: MaterialNorm[] = [
  {
    id: 'norm-u64', materialId: 'mat-u64', materialName: 'Thanh đứng Suprawall U64', category: 'Khung vách', unit: 'Thanh', quotaQuantity: 0,
    workCategoryId, workCategoryIds: [workCategoryId], workCategoryNormsById: { [workCategoryId]: 0.85 }, normBasisUnit: 'm²', unitNormPerM2: 0.85,
  } as MaterialNorm,
  {
    id: 'norm-u66', materialId: 'mat-u66', materialName: 'Thanh nằm Suprawall U66', category: 'Khung vách', unit: 'Thanh', quotaQuantity: 0,
    workCategoryId, workCategoryIds: [workCategoryId], workCategoryNormsById: { [workCategoryId]: 0.15 }, normBasisUnit: 'm²', unitNormPerM2: 0.15,
  } as MaterialNorm,
  {
    id: 'norm-screw', materialId: 'mat-screw', materialName: 'Vít đen 2.5cm', category: 'Phụ kiện', unit: 'kg', quotaQuantity: 0,
    workCategoryId, workCategoryIds: [workCategoryId], workCategoryNormsById: { [workCategoryId]: 0.002 }, normBasisUnit: 'm²', unitNormPerM2: 0.002,
  } as MaterialNorm,
];

// Regression fixture reconstructed from the Sân Bay LT backup: Vách NH/A9-13 has
// Vách IW11 = 150 m², and both sub-items carry assignedTeam='Đội Nguyên' while
// legacy rows do not have teamId/workCategoryId on the sub-items.
const legacyIw11Room: RoomProgressItem = {
  id: 'ROOM-1786436978668-pquyx',
  floorId,
  floorName: 'Tầng 3',
  roomName: 'Vách NH/A9-13',
  workCategory: 'Vách IW11',
  categoryVolumes: { 'Vách IW11': 150 },
  volumeUnit: 'm²',
  subItems: [
    { id: 'sub-frame', name: 'Thi công khung', category: 'Vách IW11', assignedTeam: 'Đội Nguyên', status: 'Đã hoàn thành', inspectionStatus: 'Đạt nghiệm thu' },
    { id: 'sub-board', name: 'Thi công Tấm', category: 'Vách IW11', assignedTeam: 'Đội Nguyên', status: 'Đã hoàn thành', inspectionStatus: 'Đạt nghiệm thu' },
  ],
  x: 15.2, y: 59, width: 11, height: 2,
  frameStatus: 'Đã hoàn thành', boardStatus: 'Đã hoàn thành', inspectionStatus: 'Đạt nghiệm thu', updatedAt: 1,
} as RoomProgressItem;

const floor3Nguyen = computeMaterialNeeds({
  rooms: [legacyIw11Room], materialNorms: norms, inventory: [], workVolumes, teams,
  scope: { floorId, teamId: teamNguyenId },
});
assert.equal(floor3Nguyen.failClosed, false, 'Unique active team name must resolve deterministically');
assert.equal(floor3Nguyen.lines.length, 3, 'Tầng 3 + Đội Nguyên must include IW11 material need from legacy assignedTeam rows');
assert.equal(floor3Nguyen.lines.find((line) => line.materialId === 'mat-u64')?.estimatedQty, 127.5);
assert.equal(floor3Nguyen.lines.find((line) => line.materialId === 'mat-u66')?.estimatedQty, 22.5);
assert.equal(floor3Nguyen.lines.find((line) => line.materialId === 'mat-screw')?.estimatedQty, 0.3);

const floor3An = computeMaterialNeeds({
  rooms: [legacyIw11Room], materialNorms: norms, inventory: [], workVolumes, teams,
  scope: { floorId, teamId: teamAnId },
});
assert.equal(floor3An.lines.length, 0, 'Legacy Đội Nguyên text must never leak demand into Đội An');

const explicitIdWins = {
  ...legacyIw11Room,
  id: 'room-explicit-team-id',
  subItems: legacyIw11Room.subItems?.map((sub) => ({ ...sub, teamId: teamAnId, assignedTeam: 'Đội Nguyên' })),
} as RoomProgressItem;
const explicitForNguyen = computeMaterialNeeds({
  rooms: [explicitIdWins], materialNorms: norms, inventory: [], workVolumes, teams,
  scope: { floorId, teamId: teamNguyenId },
});
assert.equal(explicitForNguyen.lines.length, 0, 'Durable teamId must remain authoritative over stale assignedTeam text');
const explicitForAn = computeMaterialNeeds({
  rooms: [explicitIdWins], materialNorms: norms, inventory: [], workVolumes, teams,
  scope: { floorId, teamId: teamAnId },
});
assert.equal(explicitForAn.lines.length, 3, 'Explicit teamId must own the category when present');

const duplicateNameTeams: TeamInfo[] = [
  ...teams,
  { id: 'team-nguyen-duplicate', name: 'Đội Nguyên', leader: 'Khác', defaultCount: 1 } as TeamInfo,
];
const ambiguousLegacyName = computeMaterialNeeds({
  rooms: [legacyIw11Room], materialNorms: norms, inventory: [], workVolumes, teams: duplicateNameTeams,
  scope: { floorId, teamId: teamNguyenId },
});
assert.equal(ambiguousLegacyName.lines.length, 0, 'Duplicate active team names must fail closed instead of guessing a teamId');
assert.equal(ambiguousLegacyName.failClosed, true);
assert.ok(ambiguousLegacyName.warnings.some((warning) => warning.code === 'AMBIGUOUS_TEAM'));

const inventory: InventoryItem[] = [
  { id: 'in-u64', type: 'in', materialId: 'mat-u64', materialName: 'Thanh đứng Suprawall U64', unit: 'Thanh', quantity: 500, location: 'Kho', handler: 'Thủ kho', date: '2026-09-10' } as InventoryItem,
  { id: 'out-u64-legacy', type: 'out', materialId: 'mat-u64', materialName: 'Thanh đứng Suprawall U64', unit: 'Thanh', quantity: 10, location: 'Tầng 3', handler: 'Đội Nguyên', date: '2026-09-10', sourceRoomId: legacyIw11Room.id, sourceFloorId: floorId } as InventoryItem,
];
const legacyIssue = computeMaterialNeeds({
  rooms: [legacyIw11Room], materialNorms: norms, inventory, workVolumes, teams,
  scope: { floorId, teamId: teamNguyenId },
});
const u64 = legacyIssue.lines.find((line) => line.materialId === 'mat-u64');
assert.equal(u64?.alreadyIssued, 10, 'A legacy issue may be allocated when the room is provably owned by one uniquely resolved team');
assert.equal(u64?.remainingQty, 117.5);

console.log('Material Need legacy-team golden: PASS');
console.log('Verified Tầng 3 / Đội Nguyên assignedTeam-only linkage, explicit-ID authority, duplicate-name fail-closed, and legacy issue allocation.');
