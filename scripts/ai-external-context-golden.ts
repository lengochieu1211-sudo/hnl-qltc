import assert from 'node:assert/strict';
import { buildExternalAiProjectContext, buildExternalAiQuestionPayload } from '../src/ai/data/externalAiContext';

const manyRooms = Array.from({ length: 90 }, (_, index) => ({
  id: `r${index + 1}`,
  roomName: `A${String(index + 1).padStart(2, '0')}`,
  floorId: 'f1',
  floorName: 'L1',
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
  teams: [{ id: 'team-nguyen', name: 'Đội Nguyên' }], floors: [{ id: 'f1', floorName: 'L1' }],
  workVolumes: [{ id: 'wv1', title: 'Trần', floor: 'L1', category: 'Trần thạch cao', unit: 'm2', planned: 9000, actual: 4000, status: 'Đang thi công' }],
  inventory: [], materialNorms: [], checklist: [], rooms: manyRooms,
  defects: [{ id: 'd1', floorId: 'f1', floorName: 'L1', category: 'TC', description: 'Gọi 0901234567 hoặc owner@example.com', severity: 'HIGH', status: 'OPEN', createdAt: 1 }],
  crewRecords: [{ id: 'c1', teamName: 'Đội Nguyên', teamId: 'team-nguyen', date: '2026-09-05', workerCount: 5, taskDescription: 'Liên hệ +84 901 234 567', notes: 'mail worker@example.com' }],
} as any;

const noOptIn = buildExternalAiProjectContext(snapshot, { progress: false, quantities: false, defects: false, crew: false, inventory: false, checklist: false });
assert.equal('defects' in noOptIn, false);
assert.equal('crew' in noOptIn, false);
assert.equal('quantityDetails' in noOptIn, false);

const allowed = buildExternalAiProjectContext(snapshot, { progress: false, quantities: true, defects: true, crew: true, inventory: false, checklist: false });
const serialized = JSON.stringify(allowed);
assert.equal(serialized.includes('0901234567'), false);
assert.equal(serialized.includes('owner@example.com'), false);
assert.equal(serialized.includes('worker@example.com'), false);
assert.match(serialized, /đã ẩn/);
assert.equal((allowed as any).quantitySummaryByTeamAndCategory.rows[0].teamName, 'Đội Nguyên');
assert.equal((allowed as any).quantitySummaryByTeamAndCategory.rows[0].unit, 'm2');
assert.ok((allowed as any).quantitySummaryByTeamAndCategory.rows[0].volume > 0);

const payload = buildExternalAiQuestionPayload('Báo cáo khối lượng đội Nguyên', snapshot, {
  progress: true,
  quantities: true,
  defects: true,
  crew: true,
  inventory: true,
  checklist: true,
});
assert.ok(payload.length <= 21_500, `payload too large: ${payload.length}`);
assert.match(payload, /quantitySummaryByTeamAndCategory/);
assert.match(payload, /Đội Nguyên/);
console.log('AI external context golden: PASS');
