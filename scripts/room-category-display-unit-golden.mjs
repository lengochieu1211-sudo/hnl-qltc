import assert from 'node:assert/strict';
import { resolveRoomCategoryDisplayUnit as resolve } from '../src/utils/roomCategoryDisplayUnit.ts';

const work = [
  { id: 'a', workCategoryId: 'a', title: 'Trần', unit: 'm²', floorId: 'F1', floor: '1' },
  { id: 'b', workCategoryId: 'b', title: 'Trần', unit: 'm', floorId: 'F2', floor: '2' },
  { id: 'c', title: 'Cửa thăm', unit: 'Bộ', floor: 'Tất cả' },
  { id: 'd', title: 'Vách', unit: 'm2', floorId: 'F1', floor: '1' },
  { id: 'deleted', title: 'Cửa thăm', unit: 'cái', floor: 'Tất cả', deletedAt: 123 },
];
const get = (category, floorId, extra = {}) => resolve({ category, floorId, floorName: floorId === 'F1' ? '1' : '2', workVolumes: work, ...extra });
assert.deepEqual(get('Trần', 'F1', { storedUnit: 'm²' }), { unit: 'm²', catalogMatched: true, savedUnitDiffers: false });
assert.equal(get('Trần', 'F2').unit, 'm');
assert.equal(get('Trần', 'F1', { storedUnit: 'm' }).savedUnitDiffers, true);
assert.equal(get('Trần', 'F1', { storedUnit: 'm' }).unit, 'm²');
assert.equal(get('Cửa thăm', 'F1').unit, 'Bộ');
assert.equal(get('Vách', 'F1', { storedUnit: 'm²' }).savedUnitDiffers, false);
assert.deepEqual(get('Không có', 'F1', { storedUnit: 'cái' }), { unit: 'cái', catalogMatched: false, savedUnitDiffers: false });
assert.equal(get('Trần', 'F3', { storedUnit: 'bộ' }).unit, 'bộ');
assert.equal(get('Trần', 'F2', { workCategoryId: 'a', storedUnit: 'm' }).unit, 'm'); // cross-floor ID is not silently used
const duplicates = [...work, { id: 'a2', title: 'Trần', unit: 'bộ', floorId: 'F1', floor: '1' }];
assert.equal(resolve({ category: 'Trần', floorId: 'F1', workVolumes: duplicates, storedUnit: 'm' }).unit, 'm');
assert.equal(resolve({ category: 'Trần', workCategoryId: 'a', floorId: 'F1', workVolumes: duplicates }).unit, 'm²');
Object.freeze(work);
const snapshot = JSON.stringify(work);
resolve({ category: 'Trần', floorId: 'F1', workVolumes: work, storedUnit: 'm' });
assert.equal(JSON.stringify(work), snapshot); // pure read-only function
console.log('ROOM CATEGORY DISPLAY UNIT GOLDEN PASS: floor, ID, ambiguity, legacy, mismatch, no mutation');
