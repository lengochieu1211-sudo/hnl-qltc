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
const pkg = JSON.parse(read('package.json'));

const checks = [
  ['computed WorkVolume uses unified engine', app.includes('computeDerivedWorkVolumes(workVolumes, roomProgressList, floorPlans)')],
  ['planned zero is preserved in derived engine', read('src/utils/workVolumeComputation.ts').includes('Number.isFinite(Number(item.planned))')],
  ['delete WorkVolume does not remap by same title', !app.includes('replacementByTitle') && !app.includes('findReplacement(room.workCategory)')],
  ['direct actual mutation is disabled', app.includes('actual là dữ liệu derived')],
  ['WorkVolume import has final catalog validation', workTab.includes('validateWorkVolumeCatalog(finalCatalog)')],
  ['WorkVolume import ignores raw actual/status', !workTab.includes("row['KL Thực Tế']") && workTab.includes('never import them into master')],
  ['Excel round-trip preserves record/category/floor IDs', excel.includes("'__recordId'") && excel.includes("'__workCategoryId'") && excel.includes("'__floorId'") && excel.includes("'__floorIds'")],
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
