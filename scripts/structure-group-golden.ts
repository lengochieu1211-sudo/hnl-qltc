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

console.log('structure-group-golden: PASS');
