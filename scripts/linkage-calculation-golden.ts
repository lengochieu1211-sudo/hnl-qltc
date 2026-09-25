import assert from 'node:assert/strict';
import type { InventoryItem, MaterialNorm, RoomProgressItem, TeamInfo, WorkVolume } from '../src/types';
import {
  canonicalWorkCategoryId,
  getCanonicalRoomCategoryEntries,
  resolveAuthoritativeWorkVolumeRef,
  resolveUniqueMaterialIdentity,
  resolveWorkVolumeRef,
  validateInventoryOutProvenance,
  validateMaterialNormCatalog,
  validateWorkVolumeCatalog,
} from '../src/utils/linkageIntegrity';
import { resolveNormMaterialId } from '../src/utils/inventoryUtils';
import { computeDerivedWorkVolumes } from '../src/utils/workVolumeComputation';
import { computeMaterialNeeds } from '../src/utils/materialNeedEngine';
import { calculateTeamStatistics } from '../src/utils/teamUtils';
import { computeTeamMaterialReconciliation } from '../src/utils/teamMaterialReconciliation';
import { reconcileMaterialNormWorkCategoryLinks } from '../src/utils/projectReconciliation';

const work = (id: string, floorId: string, title = 'Trần tiêu chuẩn', unit = 'm²', planned = 100): WorkVolume => ({
  id, workCategoryId: id, title, floor: floorId, floorId, floorIds: [floorId], category: 'Trần', unit,
  planned, actual: 0, unitPrice: 0, status: 'Chưa thi công',
});
const room = (id: string, floorId: string, categoryVolumes: Record<string, number>, extras: Partial<RoomProgressItem> = {}): RoomProgressItem => ({
  id, floorId, floorName: floorId, roomName: id, categoryVolumes, x: 0, y: 0, width: 1, height: 1,
  frameStatus: 'Chưa làm', boardStatus: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu', updatedAt: 1, ...extras,
});
const norm = (id: string, materialId: string | undefined, categoryIds: string[], materialName = 'Tấm A', unit = 'tấm'): MaterialNorm => ({
  id, materialId, category: 'Tấm', materialName, unit, quotaQuantity: 0,
  workCategoryId: categoryIds[0], workCategoryIds: categoryIds, workCategoryNormsById: Object.fromEntries(categoryIds.map((cat) => [cat, 1])),
});

const w1 = work('CAT-F1', 'F1');
const w2 = work('CAT-F2', 'F2');
assert.equal(resolveWorkVolumeRef({ workVolumes: [w1, w2], workCategoryName: w1.title, floorId: 'F1' }).work?.id, 'CAT-F1');
assert.equal(resolveWorkVolumeRef({ workVolumes: [w1, w2], workCategoryName: w1.title }).state, 'ambiguous');
console.log('PASS linkage: floor-aware name fallback and authoritative IDs');

const scopeDriftRoom = room('R-SCOPE-DRIFT', 'F2', { [w1.title]: 20 }, {
  workCategoryId: 'CAT-F1',
  workCategory: w1.title,
  teamId: 'TEAM-A',
  assignedTeam: 'Đội A',
  inspectionStatus: 'Đạt nghiệm thu',
  subItems: [{ id: 'SD-1', name: 'Hoàn thiện', category: w1.title, workCategoryId: 'CAT-F1', teamId: 'TEAM-A', assignedTeam: 'Đội A', status: 'Đã hoàn thành', inspectionStatus: 'Đạt nghiệm thu' }],
});
assert.equal(resolveWorkVolumeRef({ workVolumes: [w1], workCategoryId: 'CAT-F1', floorId: 'F2' }).state, 'floor-mismatch', 'strict scope validator must still detect floor drift');
const authoritativeScopeDrift = resolveAuthoritativeWorkVolumeRef({ workVolumes: [w1], workCategoryId: 'CAT-F1', floorId: 'F2' });
assert.equal(authoritativeScopeDrift.state, 'resolved');
assert.equal(authoritativeScopeDrift.scopeMismatch, true);
assert.equal(getCanonicalRoomCategoryEntries(scopeDriftRoom, [w1])[0]?.workCategoryId, 'CAT-F1', 'durable ID must keep the Room category calculable when only catalog floor scope drifted');
console.log('PASS linkage: durable Room category identity survives WorkVolume floor-scope drift');

assert.equal(validateWorkVolumeCatalog([w1, w2]).length, 0, 'same title/unit on disjoint floors is valid');
const w1dup = { ...work('CAT-F1-B', 'F1'), title: w1.title };
assert.equal(validateWorkVolumeCatalog([w1, w1dup]).some((x) => x.code === 'DUPLICATE_WORK_VOLUME'), true);
console.log('PASS linkage: duplicate WorkVolume only on overlapping floor scope');

const dualKeyRoom = room('R1', 'F1', { [w1.id]: 12, [w1.title]: 99 });
const entries = getCanonicalRoomCategoryEntries(dualKeyRoom, [w1, w2]);
assert.equal(entries.length, 1);
assert.equal(entries[0].quantity, 12, 'ID-key must win over title-key');
console.log('PASS linkage: ID-key wins and prevents category double-count');

const zeroPlanned = work('CAT-ZERO', 'F1', 'Hạng mục planned zero', 'm²', 0);
const zeroRoom = room('R-ZERO', 'F1', { 'CAT-ZERO': 10 }, { workCategoryId: 'CAT-ZERO', workCategory: zeroPlanned.title, inspectionStatus: 'Đạt nghiệm thu' });
const zeroDerived = computeDerivedWorkVolumes([zeroPlanned], [zeroRoom])[0];
assert.equal(zeroDerived.planned, 0);
assert.equal(zeroDerived.actual, 10);
assert.equal(zeroDerived.status, 'Đang thi công');
console.log('PASS calculation: planned=0 remains authoritative master value');

const stageWork = work('CAT-STAGE', 'F1', 'Thi công hoàn thiện');
const unfinished = room('R-STAGE', 'F1', { 'CAT-STAGE': 20 }, {
  workCategoryId: 'CAT-STAGE', workCategory: stageWork.title, inspectionStatus: 'Đạt nghiệm thu',
  subItems: [{ id: 'S1', name: 'Công đoạn 1', category: stageWork.title, workCategoryId: 'CAT-STAGE', status: 'Chưa làm', inspectionStatus: 'Đạt nghiệm thu' }],
});
assert.equal(computeDerivedWorkVolumes([stageWork], [unfinished])[0].actual, 0);
console.log('PASS calculation: acceptance cannot convert unfinished stage into actual');

const dupA = norm('N1', 'MAT-1', ['CAT-F1']);
const dupB = norm('N2', 'MAT-1', ['CAT-F1']);
assert.equal(validateMaterialNormCatalog([dupA, dupB], [w1]).some((x) => x.code === 'AMBIGUOUS_NORM'), true);
const disjointB = norm('N2', 'MAT-1', ['CAT-F2']);
assert.equal(validateMaterialNormCatalog([dupA, disjointB], [w1, w2]).some((x) => x.code === 'AMBIGUOUS_NORM'), false);
console.log('PASS norms: duplicate material scope is rejected without blocking disjoint category scope');

const wm = work('CAT-M', 'F1', 'Len tường', 'm');
const mixed = norm('N-MIX', 'MAT-X', ['CAT-F1', 'CAT-M']);
assert.equal(validateMaterialNormCatalog([mixed], [w1, wm]).some((x) => x.code === 'MIXED_WORK_UNIT'), true);
console.log('PASS norms: shared norm across different source units fails closed');

const legacyA = norm('LEG-A', undefined, ['CAT-F1'], 'Vít 25', 'hộp');
const legacyB = norm('LEG-B', undefined, ['CAT-F2'], 'Vít 25', 'hộp');
assert.equal(resolveNormMaterialId(legacyA), resolveNormMaterialId(legacyB));
console.log('PASS material identity: legacy Name+Unit resolves to one stable material identity');

const independentMaterial = resolveUniqueMaterialIdentity({ materialName: 'Băng keo độc lập', unit: 'Cuộn', materialNorms: [] });
assert.equal(independentMaterial.state, 'resolved');
assert.ok(independentMaterial.materialId?.startsWith('MAT-LEGACY-'));
const independentMaterialAgain = resolveUniqueMaterialIdentity({ materialName: '  Băng   keo độc lập ', unit: 'cuộn', materialNorms: [] });
assert.equal(independentMaterialAgain.materialId, independentMaterial.materialId, 'standalone Name+Unit bucket must be deterministic');
console.log('PASS material identity: no-norm warehouse material remains an independent deterministic bucket');

const provNorm = norm('N-P', 'MAT-P', ['CAT-F1']);
const provRoom = room('R-P', 'F1', { 'CAT-F1': 10 }, { workCategoryId: 'CAT-F1', workCategory: w1.title });
const badFloor: InventoryItem = { id: 'X1', type: 'out', materialId: 'MAT-P', materialName: 'Tấm A', unit: 'tấm', quantity: 1, location: '', handler: '', date: '2026-09-14', sourceRoomId: 'R-P', sourceFloorId: 'F2', sourceNormId: 'N-P', sourceWorkCategoryId: 'CAT-F1' };
assert.equal(validateInventoryOutProvenance({ tx: badFloor, rooms: [provRoom], workVolumes: [w1], materialNorms: [provNorm] }).state, 'invalid');
console.log('PASS provenance: Room↔Floor conflict is invalid');

const catB = work('CAT-B', 'F1', 'Vách', 'm²');
const multiRoom = room('R-MULTI', 'F1', { 'CAT-F1': 5, 'CAT-B': 5 });
const partialOut: InventoryItem = { id: 'X2', type: 'out', materialId: 'MAT-P', materialName: 'Tấm A', unit: 'tấm', quantity: 1, location: '', handler: '', date: '2026-09-14', issuePurpose: 'project-work', sourceRoomId: 'R-MULTI', sourceFloorId: 'F1' };
const partialOutResult = validateInventoryOutProvenance({ tx: partialOut, rooms: [multiRoom], workVolumes: [w1, catB], materialNorms: [provNorm] });
assert.equal(partialOutResult.state, 'resolved');
assert.equal(partialOutResult.workCategoryId, undefined, 'partial manual OUT must remain category-unallocated instead of guessing one');
console.log('PASS provenance: partial manual OUT may omit category without guessing');

const externalOut: InventoryItem = { id: 'X-EXT', type: 'out', materialId: 'MAT-P', materialName: 'Tấm A', unit: 'tấm', quantity: 2, location: '', handler: '', date: '2026-09-14', issuePurpose: 'external-project' };
assert.equal(validateInventoryOutProvenance({ tx: externalOut, rooms: [multiRoom], workVolumes: [w1, catB], materialNorms: [provNorm] }).state, 'resolved');
console.log('PASS provenance: external-project OUT is valid warehouse movement without project allocation');

const tinyNorm: MaterialNorm = { ...norm('N-TINY', 'MAT-TINY', ['CAT-F1'], 'Keo', 'kg'), workCategoryNormsById: { 'CAT-F1': 0.004 } };
const tinyRoom = room('R-TINY', 'F1', { 'CAT-F1': 1 }, { workCategoryId: 'CAT-F1', workCategory: w1.title });
const tinyInventory: InventoryItem[] = [{ id: 'IN-TINY', type: 'in', materialId: 'MAT-TINY', materialName: 'Keo', unit: 'kg', quantity: 0.003, location: 'Kho', handler: '', date: '2026-09-14' }];
const tinyNeed = computeMaterialNeeds({ rooms: [tinyRoom], materialNorms: [tinyNorm], inventory: tinyInventory, workVolumes: [w1], scope: { roomId: 'R-TINY' } });
assert.equal(tinyNeed.lines[0].rawRemainingQty, 0.004);
assert.equal(tinyNeed.lines[0].sufficient, false, 'raw 0.003 stock must not satisfy raw 0.004 need even when display rounds');
console.log('PASS material need: sufficiency uses raw quantities, rounding is display-only');

const externalNeedNorm: MaterialNorm = { ...norm('N-EXT', 'MAT-EXT', ['CAT-F1'], 'Vít ngoài', 'hộp'), workCategoryNormsById: { 'CAT-F1': 1 } };
const externalNeedRoom = room('R-EXT', 'F1', { 'CAT-F1': 10 }, { workCategoryId: 'CAT-F1', workCategory: w1.title });
const externalNeed = computeMaterialNeeds({
  rooms: [externalNeedRoom],
  materialNorms: [externalNeedNorm],
  inventory: [
    { id: 'IN-EXT', type: 'in', materialId: 'MAT-EXT', materialName: 'Vít ngoài', unit: 'hộp', quantity: 20, location: 'Kho', handler: '', date: '2026-09-14' },
    { id: 'OUT-EXT', type: 'out', materialId: 'MAT-EXT', materialName: 'Vít ngoài', unit: 'hộp', quantity: 3, location: '', handler: '', date: '2026-09-14', issuePurpose: 'external-project' },
  ],
  workVolumes: [w1],
  scope: { roomId: 'R-EXT' },
});
assert.equal(externalNeed.lines[0].estimatedQty, 10);
assert.equal(externalNeed.lines[0].alreadyIssued, 0, 'external-project OUT must not count as issued to project demand');
assert.equal(externalNeed.lines[0].stockQty, 17, 'external-project OUT must still reduce physical warehouse stock');
console.log('PASS material need: external/other OUT affects stock but not project consumption');

const teamA: TeamInfo = { id: 'TEAM-A', name: 'Đội A', leader: 'A', defaultCount: 1 };
const teamB: TeamInfo = { id: 'TEAM-B', name: 'Đội B', leader: 'B', defaultCount: 1 };
const teamRoom = room('R-TEAM', 'F1', { 'CAT-F1': 100 }, {
  workCategoryId: 'CAT-F1', workCategory: w1.title,
  subItems: [
    { id: 'A', name: 'Thi công khung', category: w1.title, workCategoryId: 'CAT-F1', teamId: 'TEAM-A', assignedTeam: 'Đội A', status: 'Đã hoàn thành', inspectionStatus: 'Đạt nghiệm thu' },
    { id: 'B', name: 'Thi công tấm', category: w1.title, workCategoryId: 'CAT-F1', teamId: 'TEAM-B', assignedTeam: 'Đội B', status: 'Đã hoàn thành', inspectionStatus: 'Đạt nghiệm thu' },
  ],
});
const stats = calculateTeamStatistics({ teams: [teamA, teamB], roomProgressList: [teamRoom], defects: [], crewRecords: [], workVolumes: [w1] });
assert.equal(stats['TEAM-A'].volumeByUnit['m²'], 50);
assert.equal(stats['TEAM-B'].volumeByUnit['m²'], 50);
assert.equal(stats['TEAM-A'].volumeByUnit['m²'] + stats['TEAM-B'].volumeByUnit['m²'], 100);
assert.equal(stats['TEAM-A'].teamRoomDetails[0].workCategoryId, 'CAT-F1');
console.log('PASS teams: denominator keeps team allocations <= canonical category total');

const teamMaterialNorm: MaterialNorm = {
  ...norm('N-TEAM', 'MAT-TEAM', ['CAT-F1'], 'Vít đội', 'hộp'),
  workCategoryNormsById: { 'CAT-F1': 0.2 },
};
const teamMaterial = computeTeamMaterialReconciliation({
  team: teamA,
  stats: stats['TEAM-A'],
  inventory: [
    { id: 'OUT-TEAM', type: 'out', materialId: 'MAT-TEAM', materialName: 'Vít đội', unit: 'hộp', quantity: 8, location: '', handler: '', date: '2026-09-14', issuePurpose: 'project-work', sourceTeamId: 'TEAM-A', sourceWorkCategoryId: 'CAT-F1' },
    { id: 'OUT-OTHER', type: 'out', materialId: 'MAT-TEAM', materialName: 'Vít đội', unit: 'hộp', quantity: 2, location: '', handler: '', date: '2026-09-14', issuePurpose: 'other', sourceTeamId: 'TEAM-A' },
  ],
  materialNorms: [teamMaterialNorm],
  workVolumes: [w1],
});
const teamMaterialLine = teamMaterial.find((line) => line.materialId === 'MAT-TEAM' && line.materialName === 'Vít đội');
assert.ok(teamMaterialLine, 'team material reconciliation must produce the norm-backed material line');
assert.equal(teamMaterialLine.expectedAssignedQty, 10);
assert.equal(teamMaterialLine.expectedConstructedQty, 10);
assert.equal(teamMaterialLine.issuedQty, 8);
assert.equal(teamMaterialLine.varianceQty, -2);
console.log('PASS teams: material reconciliation compares issued project stock against constructed volume × norm');

const zeroQuantityAssignedRoom = room('R-TEAM-ZERO', 'F1', {}, {
  workCategoryId: 'CAT-F1', workCategory: w1.title, workVolume: 0,
  teamId: 'TEAM-A', assignedTeam: 'Đội A',
});
const zeroQuantityEntries = getCanonicalRoomCategoryEntries(zeroQuantityAssignedRoom, [w1]);
assert.equal(zeroQuantityEntries.length, 1, 'valid room/category identity must survive even when quantity is 0');
assert.equal(zeroQuantityEntries[0].quantity, 0);
const zeroQuantityStats = calculateTeamStatistics({ teams: [teamA], roomProgressList: [zeroQuantityAssignedRoom], defects: [], crewRecords: [], workVolumes: [w1] });
assert.equal(zeroQuantityStats['TEAM-A'].teamRooms.length, 1, 'team room count must include assigned room before quantity/acceptance is entered');
assert.equal(zeroQuantityStats['TEAM-A'].volumeByUnit['m²'] || 0, 0, 'zero source quantity must not fabricate team volume');
const zeroQuantityNeed = computeMaterialNeeds({ rooms: [zeroQuantityAssignedRoom], materialNorms: [tinyNorm], inventory: [], workVolumes: [w1], teams: [teamA], scope: { teamId: 'TEAM-A' } });
assert.equal(zeroQuantityNeed.lines.length, 0, 'zero source quantity must not fabricate material demand');
console.log('PASS teams/materials: assigned zero-quantity room stays visible without inventing demand');

const stageOnlyAssignedRoom = room('R-TEAM-STAGE-ONLY', 'F1', {}, {
  subItems: [
    { id: 'SO-1', name: 'Thi công', category: w1.title, workCategoryId: 'CAT-F1', teamId: 'TEAM-A', assignedTeam: 'Đội A', status: 'Chưa làm' },
  ],
});
const stageOnlyEntries = getCanonicalRoomCategoryEntries(stageOnlyAssignedRoom, [w1]);
assert.equal(stageOnlyEntries.length, 1, 'sub-item-only durable category link must remain visible');
assert.equal(stageOnlyEntries[0].quantity, 0);
const stageOnlyStats = calculateTeamStatistics({ teams: [teamA], roomProgressList: [stageOnlyAssignedRoom], defects: [], crewRecords: [], workVolumes: [w1] });
assert.equal(stageOnlyStats['TEAM-A'].teamRooms.length, 1, 'sub-item-only team assignment must count the room');
console.log('PASS teams: sub-item-only assignment keeps room membership visible');

const scopeDriftDerived = computeDerivedWorkVolumes([w1], [scopeDriftRoom])[0];
assert.equal(scopeDriftDerived.actual, 20, 'derived WorkVolume actual must use the durable category ID even if catalog floor scope drifted');
const scopeDriftStats = calculateTeamStatistics({ teams: [teamA], roomProgressList: [scopeDriftRoom], defects: [], crewRecords: [], workVolumes: [w1] });
assert.equal(scopeDriftStats['TEAM-A'].teamRooms.length, 1, 'team statistics must not drop a Room that still has a valid category ID');
assert.equal(scopeDriftStats['TEAM-A'].volumeByUnit['m²'], 20);
const scopeDriftNorm: MaterialNorm = { ...norm('N-SCOPE-DRIFT', 'MAT-SCOPE-DRIFT', ['CAT-F1'], 'Tấm scope drift', 'tấm'), workCategoryNormsById: { 'CAT-F1': 0.5 } };
const scopeDriftIssue: InventoryItem = {
  id: 'OUT-SCOPE-DRIFT', type: 'out', materialId: 'MAT-SCOPE-DRIFT', materialName: 'Tấm scope drift', unit: 'tấm', quantity: 2,
  location: 'Kho', handler: 'A', date: '2026-09-16', sourceType: 'room-auto', sourceRoomId: scopeDriftRoom.id,
  sourceFloorId: scopeDriftRoom.floorId, sourceWorkCategoryId: 'CAT-F1', sourceTeamId: 'TEAM-A', sourceNormId: scopeDriftNorm.id,
};
assert.equal(validateInventoryOutProvenance({ tx: scopeDriftIssue, rooms: [scopeDriftRoom], workVolumes: [w1], materialNorms: [scopeDriftNorm], teams: [teamA] }).state, 'resolved', 'issued material provenance must keep the valid durable category ID under floor-scope drift');
const scopeDriftNeed = computeMaterialNeeds({ rooms: [scopeDriftRoom], materialNorms: [scopeDriftNorm], inventory: [scopeDriftIssue], workVolumes: [w1], teams: [teamA], scope: { teamId: 'TEAM-A' } });
assert.equal(scopeDriftNeed.lines[0]?.estimatedQty, 10, 'Material Need must remain linked through the durable category ID');
assert.equal(scopeDriftNeed.lines[0]?.alreadyIssued, 2, 'issued material must remain allocated to the same durable room/category/team link');
assert.equal(scopeDriftNeed.lines[0]?.remainingQty, 8, 'remaining material need must deduct the linked issued quantity');
console.log('PASS cross-module linkage: WorkVolume actual + team stats + material need + issue provenance stay connected under scope drift');

const staleNorm = norm('N-STALE', 'MAT-S', ['DELETED-CATEGORY']);
const reconciled = reconcileMaterialNormWorkCategoryLinks([staleNorm], [w1]).materialNorms[0];
assert.deepEqual(reconciled.workCategoryIds, ['DELETED-CATEGORY']);
assert.equal(reconciled.workCategoryId, 'DELETED-CATEGORY');
console.log('PASS lifecycle: reconciliation preserves stale authoritative IDs for Health repair');

console.log('LINKAGE CALCULATION GOLDEN PASS');