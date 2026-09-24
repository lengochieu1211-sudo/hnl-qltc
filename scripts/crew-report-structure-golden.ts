import assert from 'node:assert/strict';
import { buildCrewReportMatrices, buildCrewReportRows } from '../src/utils/crewReportUtils';

const projects = [{
  projectId: 'p1',
  projectName: 'Dự án test',
  teams: [{ id: 'team-a', name: 'Đội An', leader: 'An', defaultCount: 0 }],
  floorPlans: [
    { id: 'f1', floorName: 'Tầng 1', structureGroupId: 'g1', imageUrl: '', uploadedAt: '' },
    { id: 'f2', floorName: 'Tầng 1', structureGroupId: 'g2', imageUrl: '', uploadedAt: '' },
  ],
  structureConfig: {
    enabled: true,
    label: 'Tháp',
    groups: [
      { id: 'g1', name: 'Tháp 1', order: 0 },
      { id: 'g2', name: 'Tháp 2', order: 1 },
    ],
    defaultGroupId: 'g1',
  },
  records: [
    { id: 'r1', date: '2026-09-24', teamId: 'team-a', teamName: 'Đội An', leaderName: 'An', workerCount: 8, morningCount: 8, afternoonCount: 6, eveningCount: 0, floorId: 'f1', floorName: 'Tầng 1', structureGroupId: 'g2', taskDescription: 'Thi công' },
    { id: 'r2', date: '2026-09-24', teamId: 'team-a', teamName: 'Đội An', leaderName: 'An', workerCount: 5, morningCount: 5, afternoonCount: 5, eveningCount: 0, floorId: 'f2', floorName: 'Tầng 1', taskDescription: 'Thi công' },
  ],
}] as any;

const rows = buildCrewReportRows(projects, '2026-09-24', '2026-09-24');
const reported = rows.filter((row) => row.reported);
assert.equal(reported.length, 2, 'same team in two Khu/Khối must remain two report columns');
assert.deepEqual(reported.map((row) => row.structureGroupName), ['Tháp 1', 'Tháp 2']);
assert.equal(reported.find((row) => row.structureGroupId === 'g1')?.dailyHeadcount, 8, 'floor linkage must override stale record.structureGroupId');
assert.equal(reported.find((row) => row.structureGroupId === 'g2')?.dailyHeadcount, 5);

const matrix = buildCrewReportMatrices(rows)[0];
assert.equal(matrix.groups.length, 2);
assert.equal(matrix.groups[0].structureGroupName, 'Tháp 1');
assert.equal(matrix.groups[1].structureGroupName, 'Tháp 2');
assert.equal(matrix.dates[0].totalDailyHeadcount, 13, 'daily total must sum group-scoped team headcounts once');

console.log('crew-report-structure-golden: PASS');
