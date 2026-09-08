import assert from 'node:assert/strict';
import { buildExternalAiProjectContext, buildExternalAiQuestionPayload } from '../src/ai/data/externalAiContext';

const manyRooms = Array.from({ length: 90 }, (_, index) => ({
  id: `r${index + 1}`,
  roomName: `A${String(index + 1).padStart(2, '0')}`,
  floorId: 'f1',
  // Deliberately omit floorName: AI read-model must resolve it from snapshot.floors.
  floorName: '',
  teamId: 'team-nguyen',
  assignedTeam: 'Đội Nguyên',
  workCategoryId: 'cat-ceiling',
  workCategory: 'Trần thạch cao',
  workVolume: 10 + index,
  volumeUnit: 'm2',
  inspectionStatus: 'Chưa nghiệm thu',
  frameStatus: 'Đang làm',
  boardStatus: 'Chưa làm',
  updatedAt: 1,
  subItems: [],
}));

const snapshot = {
  projectId: 'dev-project', projectName: 'HNL demo 0901234567 owner@example.com', asOf: 1, freshness: 'live',
  teams: [
    { id: 'team-nguyen', name: 'Đội Nguyên' },
    { id: 'team-chau', name: 'Đội Châu' },
  ],
  floors: [{ id: 'f1', floorName: 'Tầng 1' }],
  workVolumes: [{ id: 'wv1', title: 'Trần', floorId: 'f1', floor: 'Tầng 1', category: 'Trần thạch cao', unit: 'm2', planned: 9000, actual: 4000, status: 'Đang thi công' }],
  inventory: [], materialNorms: [], checklist: [], rooms: manyRooms,
  defects: [{ id: 'd1', floorId: 'f1', floorName: '', teamId: 'team-nguyen', category: 'TC', description: 'Gọi 0901234567 hoặc owner@example.com', severity: 'HIGH', status: 'OPEN', createdAt: 1 }],
  crewRecords: [
    { id: 'c1', teamName: 'Đội Nguyên', teamId: 'team-nguyen', date: '2026-09-05', workerCount: 5, floorId: 'f1', floorName: '', taskDescription: 'Liên hệ +84 901 234 567', notes: 'mail worker@example.com' },
    { id: 'c2', teamName: 'Đội Châu', teamId: 'team-chau', date: '2026-09-05', workerCount: 99, floorId: 'f1', floorName: '', taskDescription: 'Việc khác', notes: '' },
  ],
} as any;

const noOptIn = buildExternalAiProjectContext(snapshot, { progress: false, quantities: false, defects: false, crew: false, inventory: false, checklist: false });
assert.equal('defects' in noOptIn, false);
assert.equal('crew' in noOptIn, false);
assert.equal('quantityDetails' in noOptIn, false);

const allowed = buildExternalAiProjectContext(snapshot, { progress: false, quantities: true, defects: true, crew: true, inventory: false, checklist: false }) as any;
const serialized = JSON.stringify(allowed);
assert.equal(serialized.includes('0901234567'), false);
assert.equal(serialized.includes('owner@example.com'), false);
assert.equal(serialized.includes('worker@example.com'), false);
assert.match(serialized, /đã ẩn/);
assert.equal(allowed.quantitySummaryByTeamAndCategory.rows[0].teamName, 'Đội Nguyên');
assert.equal(allowed.quantitySummaryByTeamAndCategory.rows[0].unit, 'm2');
assert.ok(allowed.quantitySummaryByTeamAndCategory.rows[0].volume > 0);
assert.equal(allowed.quantityDetails.rows[0].floorName, 'Tầng 1', 'floorId must resolve to floorName in AI read-model');
assert.equal(allowed.crew.rows[0].floorName, 'Tầng 1', 'crew floorId must resolve to floorName in AI read-model');
assert.equal(allowed.defects.rows[0].floorName, 'Tầng 1', 'defect floorId must resolve to floorName in AI read-model');

// Regression: categoryVolumes can live on room while responsible team is attached to one matching sub-item.
const teamAttributionSnapshot = {
  ...snapshot,
  rooms: [{
    id: 'room-team-link',
    roomName: 'BHS-01',
    floorId: 'f1',
    floorName: '',
    teamId: '',
    assignedTeam: '',
    workCategoryId: 'cat-ceiling',
    workCategory: 'Trần thạch cao',
    categoryVolumes: { 'Trần thạch cao': 25.5 },
    categoryVolumeUnits: { 'Trần thạch cao': 'm2' },
    inspectionStatus: 'Đang làm',
    updatedAt: 2,
    subItems: [{
      id: 'sub-team-link',
      name: 'Thi công trần',
      category: 'Trần thạch cao',
      workCategoryId: 'cat-ceiling',
      teamId: 'team-nguyen',
      assignedTeam: '',
      status: 'Đang làm',
    }],
  }],
} as any;
const teamAttributed = buildExternalAiProjectContext(teamAttributionSnapshot, {
  progress: false,
  quantities: true,
  defects: false,
  crew: false,
  inventory: false,
  checklist: false,
}) as any;
const linkedQuantity = teamAttributed.quantitySummaryByTeamAndCategory.rows.find(
  (row: any) => row.teamId === 'team-nguyen' && row.workCategory === 'Trần thạch cao' && row.unit === 'm2',
);
assert.ok(linkedQuantity, 'category quantity must inherit the one unambiguous matching sub-item team');
assert.equal(linkedQuantity.teamName, 'Đội Nguyên');
assert.equal(linkedQuantity.volume, 25.5);
assert.equal(teamAttributed.quantityDetails.rows[0].floorName, 'Tầng 1');

const payload = buildExternalAiQuestionPayload(
  'Thống kê khối lượng từng tầng, hạng mục con và nhân công ngày đội Nguyên',
  snapshot,
  { progress: true, quantities: true, defects: true, crew: true, inventory: false, checklist: false },
);
assert.ok(payload.length <= 21_500, `payload too large: ${payload.length}`);
const parsed = JSON.parse(payload);
assert.match(payload, /quantityValidationTotals/);
assert.match(payload, /requestedTeams/);
assert.equal(parsed.hnlContext.requestedTeams[0].name, 'Đội Nguyên');
assert.ok(parsed.hnlContext.quantityDetails.rows.length > 0);
assert.ok(parsed.hnlContext.quantityDetails.rows.every((row: any) => row.teamName === 'Đội Nguyên'));
assert.ok(parsed.hnlContext.quantityDetails.rows.every((row: any) => row.floorName === 'Tầng 1'));
assert.equal(parsed.hnlContext.crew.rows.length, 1, 'question-focused crew must contain only requested team');
assert.equal(parsed.hnlContext.crew.rows[0].teamName, 'Đội Nguyên');
assert.equal(parsed.hnlContext.crew.rows[0].workerCount, 5);
assert.equal(parsed.hnlContext.crew.rows[0].floorName, 'Tầng 1');
assert.equal(payload.includes('99'), false, 'other team crew must not leak into focused payload');

// Material questions must use deterministic Material Need Engine output, never raw norms/inventory.
const materialSnapshot = {
  ...snapshot,
  rooms: [{
    id: 'room-mat', roomName: 'A301', floorId: 'f1', floorName: 'Tầng 1',
    teamId: 'team-nguyen', assignedTeam: 'Đội Nguyên', workCategoryId: 'cat-ceiling', workCategory: 'Trần thạch cao',
    workVolume: 100, volumeUnit: 'm2', inspectionStatus: 'Chưa nghiệm thu', frameStatus: 'Đang làm', boardStatus: 'Đang làm', updatedAt: 3, subItems: [],
  }],
  inventory: [
    { id: 'in-board', type: 'in', materialId: 'mat-board', materialName: 'Tấm thạch cao', unit: 'Tấm', quantity: 100, location: 'Kho', handler: 'Kho', date: '2026-09-05' },
    { id: 'out-board', type: 'out', materialId: 'mat-board', materialName: 'Tấm thạch cao', unit: 'Tấm', quantity: 5, location: 'Tầng 1', handler: 'Đội Nguyên', date: '2026-09-05', sourceType: 'room-auto', sourceRoomId: 'room-mat', sourceFloorId: 'f1', sourceTeamId: 'team-nguyen' },
  ],
  materialNorms: [
    { id: 'norm-board', materialId: 'mat-board', category: 'Tấm', workCategoryId: 'cat-ceiling', materialName: 'Tấm thạch cao', unit: 'Tấm', quotaQuantity: 0, unitNormPerM2: 0.35, normBasisUnit: 'm²' },
    { id: 'norm-frame', materialId: 'mat-frame', category: 'Khung', workCategoryId: 'cat-ceiling', materialName: 'Thanh xương', unit: 'Thanh', quotaQuantity: 0, unitNormPerM2: 0.5, normBasisUnit: 'm²' },
  ],
} as any;
const materialPayload = JSON.parse(buildExternalAiQuestionPayload(
  'Tầng 1 cần chuyển bao nhiêu khung, tấm và phụ kiện?',
  materialSnapshot,
  { progress: true, quantities: true, defects: false, crew: false, inventory: true, checklist: false },
));
assert.equal(materialPayload.hnlContext.deterministicMaterialNeeds.status, 'ok');
assert.equal('inventory' in materialPayload.hnlContext, false, 'raw inventory must not be sent for material calculation');
assert.equal('materialNorms' in materialPayload.hnlContext, false, 'raw norms must not be sent for material calculation');
assert.equal('rooms' in materialPayload.hnlContext, false, 'raw room m² must not be sent for material calculation');
assert.equal('workVolumes' in materialPayload.hnlContext, false, 'raw work volumes must not be sent for material calculation');
assert.equal('quantityDetails' in materialPayload.hnlContext, false, 'raw quantity details must not be sent for material calculation');
assert.equal('quantitySummaryByTeamAndCategory' in materialPayload.hnlContext, false, 'raw quantity summary must not be sent for material calculation');
const boardNeed = materialPayload.hnlContext.deterministicMaterialNeeds.lines.find((line: any) => line.materialId === 'mat-board');
assert.equal(boardNeed.totalNeed, 35);
assert.equal(boardNeed.issuedAllocated, 5);
assert.equal(boardNeed.remainingNeed, 30);
assert.match(materialPayload.hnlContext.aiContract.materialCalculation, /STRICT/);

const materialMultiFloorSnapshot = {
  ...materialSnapshot,
  floors: [
    { id: 'f1', floorName: 'Tầng 1' },
    { id: 'f3', floorName: 'Tầng 3' },
  ],
  rooms: [
    ...materialSnapshot.rooms,
    {
      id: 'room-mat-3', roomName: 'A303', floorId: 'f3', floorName: 'Tầng 3',
      teamId: 'team-nguyen', assignedTeam: 'Đội Nguyên', workCategoryId: 'cat-ceiling', workCategory: 'Trần thạch cao',
      workVolume: 50, volumeUnit: 'm2', inspectionStatus: 'Chưa nghiệm thu', frameStatus: 'Đang làm', boardStatus: 'Đang làm', updatedAt: 4, subItems: [],
    },
  ],
} as any;
const materialMultiFloorPayload = JSON.parse(buildExternalAiQuestionPayload(
  'Chi tiết các loại vật tư của tầng 1 và 3',
  materialMultiFloorSnapshot,
  { progress: true, quantities: true, defects: false, crew: false, inventory: true, checklist: false },
));
assert.equal(materialMultiFloorPayload.hnlContext.deterministicMaterialNeeds.status, 'ok');
assert.equal(materialMultiFloorPayload.hnlContext.deterministicMaterialNeeds.multiFloor, true);
assert.deepEqual(
  materialMultiFloorPayload.hnlContext.deterministicMaterialNeeds.scopes.map((scope: any) => scope.scope.floorName),
  ['Tầng 1', 'Tầng 3'],
);
const floor1Board = materialMultiFloorPayload.hnlContext.deterministicMaterialNeeds.scopes[0].lines.find((line: any) => line.materialId === 'mat-board');
const floor3Board = materialMultiFloorPayload.hnlContext.deterministicMaterialNeeds.scopes[1].lines.find((line: any) => line.materialId === 'mat-board');
assert.equal(floor1Board.totalNeed, 35);
assert.equal(floor1Board.issuedAllocated, 5);
assert.equal(floor3Board.totalNeed, 17.5);
assert.equal(floor3Board.issuedAllocated, 0);
for (const rawKey of ['rooms', 'workVolumes', 'quantityDetails', 'quantitySummaryByTeamAndCategory', 'inventory', 'materialNorms']) {
  assert.equal(rawKey in materialMultiFloorPayload.hnlContext, false, `${rawKey} must stay out of multi-floor material payload`);
}

// Whole-project raw analysis is explicit, sanitized, capped and read-only for non-material questions.
const fullProjectPayload = JSON.parse(buildExternalAiQuestionPayload(
  'Phân tích tổng thể dự án và nêu các rủi ro chính',
  snapshot,
  { progress: true, quantities: true, defects: true, crew: true, inventory: true, checklist: true },
  { fullProjectRaw: true },
));
assert.equal(fullProjectPayload.hnlContext.analysisScope, 'full-project-raw');
assert.match(fullProjectPayload.hnlContext.aiContract.fullProjectRaw, /sanitized/i);
assert.ok(fullProjectPayload.hnlContext.rooms.rows.length > 0);
assert.ok(fullProjectPayload.hnlContext.quantityDetails.rows.length > 0);
assert.ok(fullProjectPayload.hnlContext.defects.rows.length > 0);
assert.ok(fullProjectPayload.hnlContext.crew.rows.length > 0);
assert.equal(JSON.stringify(fullProjectPayload).includes('owner@example.com'), false);
assert.equal(JSON.stringify(fullProjectPayload).includes('0901234567'), false);

const materialNoPermission = JSON.parse(buildExternalAiQuestionPayload(
  'Tầng 1 cần vật tư gì?',
  materialSnapshot,
  { progress: true, quantities: true, defects: false, crew: false, inventory: false, checklist: false },
));
assert.equal(materialNoPermission.hnlContext.deterministicMaterialNeeds.status, 'permission-required');
assert.equal('inventory' in materialNoPermission.hnlContext, false);
assert.equal('materialNorms' in materialNoPermission.hnlContext, false);

console.log('AI external context golden: PASS');
