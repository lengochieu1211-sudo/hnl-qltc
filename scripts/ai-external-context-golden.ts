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

console.log('AI external context golden: PASS');
