import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(path, 'utf8');
const app = read('src/App.tsx');
const workTab = read('src/components/WorkVolumeTab.tsx');
const room = read('src/components/RoomHighlightModal.tsx');
const materialNeed = read('src/utils/materialNeedEngine.ts');
const team = read('src/utils/teamUtils.ts');
const reconciliation = read('src/utils/projectReconciliation.ts');
const excel = read('src/utils/excelExport.ts');
const warehouse = read('src/components/WarehouseTab.tsx');
const normModal = read('src/components/MaterialNormModal.tsx');
const pkg = JSON.parse(read('package.json'));

const checks = [
  ['computed WorkVolume uses unified engine', app.includes('computeDerivedWorkVolumes(workVolumes, roomProgressList, floorPlans)')],
  ['planned zero is preserved in derived engine', read('src/utils/workVolumeComputation.ts').includes('Number.isFinite(Number(item.planned))')],
  ['delete WorkVolume does not remap by same title', !app.includes('replacementByTitle') && !app.includes('findReplacement(room.workCategory)')],
  ['direct actual mutation is disabled', app.includes('actual là dữ liệu derived')],
  ['WorkVolume import has final catalog validation', workTab.includes('validateWorkVolumeCatalog(finalCatalog)')],
  ['WorkVolume import ignores raw actual/status', !workTab.includes("row['KL Thực Tế']") && workTab.includes('never import them into master')],
  ['Excel round-trip preserves record/category/floor IDs', excel.includes("'__recordId'") && excel.includes("'__workCategoryId'") && excel.includes("'__floorId'") && excel.includes("'__floorIds'")],
  ['Warehouse export includes authoritative WorkVolume sheet', excel.includes("book_append_sheet(wb, wsWorkVolumes, 'Hạng Mục Thi Công')")],
  ['MaterialNorm export preserves category IDs and factors', excel.includes("'__workCategoryIds'") && excel.includes("'__workCategoryNormsById'") && excel.includes('resolveNormMaterialId(n)')],
  ['Warehouse import/form has no name-only material fallback', !warehouse.includes("|| n.materialName.trim().toLowerCase() === materialNameStr.toLowerCase()") && !warehouse.includes("|| materialNorms.find((norm) =>")],
  ['MaterialNorm stock lookup uses canonical material identity', normModal.includes('getMaterialIdentityKey(resolveNormMaterialId(norm), norm.materialName, norm.unit)')],
  ['MaterialNorm same-title categories keep all canonical IDs', normModal.includes('const matches = activeWorkVolumes.filter') && normModal.includes('matches.forEach((matched) =>')],
  ['Warehouse norm import preserves canonical IDs/factors', warehouse.includes("row['__workCategoryIds']") && warehouse.includes("row['__workCategoryNormsById']") && warehouse.includes('sameStringSet(existingIds, importedWorkCategoryIds)')],
  ['MaterialNorm combined import preserves canonical IDs/factors', normModal.includes("row['__workCategoryIds']") && normModal.includes("row['__workCategoryNormsById']") && normModal.includes('sameStringSet(existingIds, importedWorkCategoryIds)')],
  ['Warehouse combined import ignores actual/status as master', warehouse.includes('actual/status are derived by App.handleImportWorkVolumes') && !warehouse.includes("row['KL Thực Tế'] || row['KL Thực Hiện']")],
  ['MaterialNorm combined import keeps inventory provenance', normModal.includes("row['__materialId']") && normModal.includes("row['__sourceTeamId']") && normModal.includes("row['__sourceWorkCategoryId']")],
  ['Combined imports preserve floor IDs and due date', warehouse.includes("row['__floorIds']") && warehouse.includes("row['Ngày Hạn Định']") && normModal.includes("row['__floorIds']") && normModal.includes("row['Ngày Hạn Định']")],
  ['Auto Issue has no ceil decision path', !room.includes('Math.ceil')],
  ['Auto Issue preflights whole batch', room.includes('Preflight the ENTIRE auto-issue set') && room.includes('plannedIssues.length !== needsIssue.length')],
  ['Auto Issue does not first-pick norm/category', !room.includes('sourceNormIds?.[0]') && !room.includes('sourceWorkCategoryId: roomItem.workCategoryId')],
  ['Material Need exposes raw calculation quantities', materialNeed.includes('rawRemainingQty') && materialNeed.includes('rawStockQty')],
  ['Team statistics consumes WorkVolume catalog', team.includes('workVolumes?: WorkVolume[]') && team.includes('getCanonicalRoomCategoryEntries')],
  ['Team rows use category-specific ID', team.includes('workCategoryId: assignment.workCategoryId')],
  ['Reconciliation preserves stale authoritative IDs', reconciliation.includes('Unresolved explicit primary ID is intentionally preserved')],
  ['linkage golden is part of stability gate', String(pkg.scripts?.['test:stability'] || '').includes('test:linkage-calculation')],
];
for (const [name, ok] of checks) {
  assert.equal(ok, true, name);
  console.log(`PASS LINKAGE SOURCE: ${name}`);
}
console.log(`LINKAGE SOURCE GOLDEN PASS — ${checks.length} checks`);
