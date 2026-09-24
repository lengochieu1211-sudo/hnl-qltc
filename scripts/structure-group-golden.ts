import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeStructureGroupConfig, resolveFloorStructureGroupId } from '../src/utils/structureGroupUtils';

const config = normalizeStructureGroupConfig({
  enabled: true,
  label: 'Khu / Khối',
  groups: [
    { id: 'tower-1', name: 'Tháp 1', order: 0 },
    { id: 'tower-2', name: 'Tháp 2', order: 1 },
  ],
  defaultGroupId: 'tower-1',
});

assert.equal(resolveFloorStructureGroupId({ structureGroupId: 'tower-2' } as any, config), 'tower-2');
assert.equal(resolveFloorStructureGroupId({} as any, config), 'tower-1', 'legacy floor must remain readable via default group');
assert.equal(normalizeStructureGroupConfig({ ...config, groups: [{ id: 'tower-1', name: 'Tháp 1' }], defaultGroupId: 'tower-2' }).defaultGroupId, 'tower-1');
assert.equal(normalizeStructureGroupConfig({ ...config, groups: [{ id: 'tower-1', name: 'Tháp 1' }, { id: 'tower-1', name: 'Duplicate' }] }).groups.length, 1);

const exportSource = readFileSync(new URL('../src/components/ExportPdfModal.tsx', import.meta.url), 'utf8');
assert.ok(exportSource.includes('const roomScopeOptions = baseRoomScopeOptions.slice().sort'), 'report room options must cascade from floor scope, not selected team');
assert.equal(exportSource.includes('baseRoomScopeOptions.filter(roomMatchesTeamScope).slice().sort'), false, 'team filter must not cyclically remove room options');
assert.ok(exportSource.includes('const groupScopedFloorIdsKey = groupScopedFloorPlans.map((floor) => floor.id).sort().join'), 'report cascade must track actual floor IDs after a floor moves Khu/Khối');

const warehouseSource = readFileSync(new URL('../src/components/WarehouseTab.tsx', import.meta.url), 'utf8');
assert.ok(warehouseSource.includes('linkedRoom?.floorId || item.sourceFloorId ||'), 'warehouse edit must resolve Room -> Floor before Khu/Khối');
assert.ok(warehouseSource.includes('const finalIssueStructureGroupId = finalIssueFloor && normalizedStructureConfig.enabled'), 'warehouse submit must derive Khu/Khối from the authoritative floor');
assert.ok(warehouseSource.includes('materialNeedGroupFloorIdSet && materialNeedGroupFloorIdSet.size === 0'), 'empty Khu/Khối material scope must not fail open to all floors');

assert.ok(warehouseSource.includes('absolute left-0 right-0 z-40 mt-1 max-h-52'), 'material-need pickers must open as compact floating dropdowns');
assert.ok(warehouseSource.includes('setShowMaterialFloorPicker(false); setShowMaterialRoomPicker(false);'), 'material-need picker must close sibling dropdowns');

assert.ok(exportSource.includes('showReportStructureGroupPicker'), 'report scope must use compact dropdown picker state');
assert.ok(exportSource.includes('reportFloorSummary'), 'report scope must render compact summaries instead of always-open checkbox columns');
assert.ok(exportSource.includes('absolute left-0 right-0 z-40 mt-1 max-h-52'), 'report scope pickers must open as floating dropdowns');

const floorPlanSource = readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx', import.meta.url), 'utf8');
assert.ok(floorPlanSource.includes("const [editingStructureGroupId"), 'Khu/Khối rename must use explicit edit state');
assert.ok(floorPlanSource.includes("title=\"Lưu tên Khu/Khối\""), 'Khu/Khối rename must require an explicit save action');
assert.equal(floorPlanSource.includes("defaultValue={group.name}"), false, 'Khu/Khối must not auto-save rename through blur/defaultValue');
assert.ok(floorPlanSource.includes('applyGroupQuickSort'), 'Khu/Khối quick sort must persist group order');
assert.ok(floorPlanSource.includes('applyFloorQuickSortWithinGroups'), 'floor quick sort must persist order inside each Khu/Khối');
assert.ok(floorPlanSource.includes("moveFloorWithinGroup"), 'manual floor reorder must stay inside its Khu/Khối');
assert.ok(floorPlanSource.includes("visibleFloorPlans.map((fp)"), 'project floor list must honor Khu/Khối filter');
assert.ok(floorPlanSource.includes("getFloorStructureGroupName(activeFloor, normalizedStructureConfig)"), 'active floor breadcrumb must show its Khu/Khối');
assert.ok(floorPlanSource.includes("getFloorStructureGroupName(fp, normalizedStructureConfig)} → ${fp.floorName}"), 'floor chips must disambiguate duplicate floor names by Khu/Khối');

console.log('structure-group-golden: PASS');
