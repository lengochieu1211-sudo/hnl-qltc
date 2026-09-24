import assert from 'node:assert/strict';
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
console.log('structure-group-golden: PASS');
