import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// Source-level UI regression guards: sharing must stay on one image per project matrix,
// the total row must use the same X-origin as header/body, and the duplicated overview
// must remain hidden on mobile/tablet while staying available on desktop/EXE.
const shareModalSource = readFileSync(new URL('../src/components/CrewReportShareModal.tsx', import.meta.url), 'utf8');
assert.equal(shareModalSource.includes('TEAM_CHUNK'), false, 'crew share must not split one project every four teams');
assert.ok(
  shareModalSource.includes('const x = teamStartX + teamIndex * teamWidth + metricIndex * metricWidth;'),
  'crew share total row must align from teamStartX',
);
const crewTabSource = readFileSync(new URL('../src/components/CrewTabBase.tsx', import.meta.url), 'utf8');
assert.ok(
  crewTabSource.includes('className="hidden lg:grid lg:grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50/70 p-3"'),
  'team detail duplicate overview must be hidden below desktop breakpoint',
);

console.log('crew-report-structure-golden: PASS');
