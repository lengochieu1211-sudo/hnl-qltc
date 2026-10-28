import assert from 'node:assert/strict';
import { computeTeamMaterialReconciliation } from '../src/utils/teamMaterialReconciliation';
import { buildCrewReportRows } from '../src/utils/crewReportUtils';

const team = { id: 'TEAM-1', name: 'Đội An' } as any;
const stats = { categoryBreakdown: [{ workCategoryId: 'CAT-1', categoryName: 'Trần', unit: 'm²', assignedVol: 10, constructedVol: 8 }] } as any;
const workVolumes = [{ id: 'CAT-1', workCategoryId: 'CAT-1', title: 'Trần', unit: 'm²', floorId: 'F1', floorIds: ['F1'], floor: 'F1' }] as any;
const norm = { id: 'N1', materialId: 'MAT-1', materialName: 'Vít', category: 'Phụ kiện', unit: 'hộp', workCategoryId: 'CAT-1', workCategoryIds: ['CAT-1'], workCategoryNormsById: { 'CAT-1': 0.2 }, unitNormPerM2: 0.2, normBasisUnit: 'm²' } as any;
const inventory = [{ id: 'OUT', type: 'out', materialId: 'MAT-1', materialName: 'Vít', unit: 'hộp', quantity: 4, sourceTeamId: 'TEAM-1', issuePurpose: 'project-work' }] as any;
const unique = computeTeamMaterialReconciliation({ team, stats, workVolumes, materialNorms: [norm], inventory });
assert.equal(unique[0].expectedAssignedQty, 2);
assert.equal(unique[0].expectedConstructedQty, 1.6);
assert.equal(unique[0].issuedQty, 4);
assert.equal(unique[0].integrityWarning, undefined);
const duplicate = computeTeamMaterialReconciliation({ team, stats, workVolumes, materialNorms: [norm, { ...norm, id: 'N2' }], inventory });
assert.equal(duplicate.length, 1, 'duplicate material is reported only once');
assert.ok(duplicate[0].integrityWarning?.includes('trùng hạng mục'));
assert.equal(duplicate[0].expectedConstructedQty, 0, 'P0 blocks duplicate norm demand');
assert.equal(duplicate[0].issuedQty, 4, 'P0 does not delete actual inventory');
assert.equal(duplicate[0].issuedVsConstructedPercent, undefined);
const orphan = computeTeamMaterialReconciliation({ team, stats, workVolumes, materialNorms: [{ ...norm, id: 'N3', workCategoryId: 'MISSING', workCategoryIds: ['MISSING'] }], inventory: [] });
assert.ok(orphan[0]?.integrityWarning, 'P0 surfaces invalid linked category');

const rows = buildCrewReportRows([{
  projectId: 'P', projectName: 'Test',
  teams: [{ id: 'TEAM-1', name: 'Đội An' }, { id: 'TEAM-2', name: ' đội an ' }],
  records: [
    { id: 'R-OLD', teamName: 'Đội An', date: '2026-09-24', workerCount: 7, morningCount: 7 },
    { id: 'R-ID', teamId: 'TEAM-2', teamName: 'Đội An', date: '2026-09-24', workerCount: 3, morningCount: 3 },
  ],
} as any], '2026-09-24', '2026-09-24');
assert.equal(rows.find((row) => row.reported && !row.teamId)?.dailyHeadcount, 7);
assert.equal(rows.find((row) => row.teamId === 'TEAM-1')?.reported, false);
assert.equal(rows.find((row) => row.teamId === 'TEAM-2')?.dailyHeadcount, 3);
assert.equal(rows.filter((row) => row.reported).reduce((sum, row) => sum + (row.dailyHeadcount || 0), 0), 10);
console.log('P0/P1 GOLDEN PASS');
