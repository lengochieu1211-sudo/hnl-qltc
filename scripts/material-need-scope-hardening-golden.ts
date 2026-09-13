import assert from 'node:assert/strict';
import { computeMaterialNeeds } from '../src/utils/materialNeedEngine';
import type { InventoryItem, MaterialNorm, RoomProgressItem, TeamInfo, WorkVolume } from '../src/types';

const teams: TeamInfo[] = [{ id: 'team-a', name: 'Đội A' } as TeamInfo];
const canonicalWork: WorkVolume = { id: 'wv-record-1', workCategoryId: 'wc-ceiling', title: 'Trần thạch cao', unit: 'm²' } as WorkVolume;
const room: RoomProgressItem = {
  id: 'room-301', roomName: '301', floorId: 'floor-3', workCategoryId: 'wc-ceiling', workCategory: 'Trần thạch cao',
  workVolume: 100, volumeUnit: 'm²', subItems: [{ id: 'sub-a', category: 'Trần thạch cao', workCategoryId: 'wc-ceiling', teamId: 'team-a', workVolume: 100, volumeUnit: 'm²' }],
} as RoomProgressItem;
const legacyRecordNorm = {
  id: 'norm-board', materialId: 'mat-board', materialName: 'Tấm thạch cao', category: 'Tấm', unit: 'tấm',
  workCategoryId: 'wv-record-1', workCategoryIds: ['wv-record-1'], workCategoryNormsById: { 'wv-record-1': 0.35 }, normBasisUnit: 'm²', unitNormPerM2: 0.35,
} as MaterialNorm;

const canonicalized = computeMaterialNeeds({ rooms: [room], materialNorms: [legacyRecordNorm], inventory: [], workVolumes: [canonicalWork], teams, scope: { roomIds: ['room-301'], workCategoryIds: ['wc-ceiling'] } });
assert.equal(canonicalized.lines[0]?.estimatedQty, 35, 'Legacy WorkVolume record-id norm link must canonicalize to workCategoryId');
assert.equal(canonicalized.failClosed, false);

const deletedLink = computeMaterialNeeds({ rooms: [room], materialNorms: [legacyRecordNorm], inventory: [], workVolumes: [{ ...canonicalWork, deletedAt: Date.now() } as WorkVolume], teams });
assert.equal(deletedLink.lines.length, 0, 'Deleted work category must not generate live demand');
assert.ok(deletedLink.warnings.some((warning) => warning.code === 'MISSING_LINK'));
assert.equal(deletedLink.failClosed, true);

const duplicateWorkVolumes: WorkVolume[] = [
  { id: 'wv-a', workCategoryId: 'wc-a', title: 'Trần trùng tên', unit: 'm²' } as WorkVolume,
  { id: 'wv-b', workCategoryId: 'wc-b', title: 'Trần trùng tên', unit: 'm²' } as WorkVolume,
];
const legacyTitleRoom = { ...room, id: 'room-dup', workCategoryId: undefined, workCategory: '', workVolume: 0, categoryVolumes: { 'Trần trùng tên': 50 }, categoryVolumeUnits: { 'Trần trùng tên': 'm²' }, subItems: [] } as RoomProgressItem;
const duplicateTitle = computeMaterialNeeds({ rooms: [legacyTitleRoom], materialNorms: [legacyRecordNorm], inventory: [], workVolumes: duplicateWorkVolumes, teams });
assert.equal(duplicateTitle.lines.length, 0, 'Duplicate active titles must not be guessed for legacy title-only links');
assert.ok(duplicateTitle.warnings.some((warning) => warning.code === 'AMBIGUOUS_LINK'));
assert.equal(duplicateTitle.failClosed, true);

const staleRoom = computeMaterialNeeds({ rooms: [room], materialNorms: [legacyRecordNorm], inventory: [], workVolumes: [canonicalWork], teams, scope: { roomIds: ['missing-room'] } });
assert.ok(staleRoom.warnings.some((warning) => warning.code === 'MISSING_LINK' && warning.roomId === 'missing-room'));
assert.equal(staleRoom.failClosed, true);

const staleCategory = computeMaterialNeeds({ rooms: [room], materialNorms: [legacyRecordNorm], inventory: [], workVolumes: [canonicalWork], teams, scope: { workCategoryIds: ['missing-category'] } });
assert.ok(staleCategory.warnings.some((warning) => warning.code === 'MISSING_LINK' && warning.workCategoryId === 'missing-category'));
assert.equal(staleCategory.failClosed, true);

const inventory: InventoryItem[] = [
  { id: 'in-1', type: 'in', materialId: 'mat-board', materialName: 'Tấm thạch cao', unit: 'tấm', quantity: 100 } as InventoryItem,
  { id: 'out-missing-room', type: 'out', materialId: 'mat-board', materialName: 'Tấm thạch cao', unit: 'tấm', quantity: 7, sourceFloorId: 'floor-3', sourceWorkCategoryId: 'wc-ceiling' } as InventoryItem,
];
const missingProvenance = computeMaterialNeeds({ rooms: [room], materialNorms: [legacyRecordNorm], inventory, workVolumes: [canonicalWork], teams, scope: { roomIds: ['room-301'], workCategoryIds: ['wc-ceiling'] } });
assert.equal(missingProvenance.lines[0]?.alreadyIssued, 0, 'Issue without sourceRoomId must not reduce a room-scoped need');
assert.equal(missingProvenance.lines[0]?.unallocatedIssued, 7, 'Issue without sourceRoomId must remain explicitly unallocated');
assert.ok(missingProvenance.warnings.some((warning) => warning.code === 'UNALLOCATED_ISSUE'));
assert.equal(missingProvenance.failClosed, true, 'Unallocated issued provenance must make scoped result fail-closed');

console.log('MATERIAL NEED SCOPE HARDENING GOLDEN PASS');
