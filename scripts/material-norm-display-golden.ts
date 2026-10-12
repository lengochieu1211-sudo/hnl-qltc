import assert from 'node:assert/strict';
import { formatAdaptiveDecimal } from '../src/utils/numberUtils';
import { isAccessoryMaterialCategory, compareMaterialAccessoryLast } from '../src/utils/materialDisplayOrder';
import { sortWorkVolumesByManualOrder, validateWorkVolumeOrder } from '../src/utils/workVolumeOrder';

assert.equal(formatAdaptiveDecimal(0), '0');
assert.equal(formatAdaptiveDecimal(0.0035), '0.0035');
assert.notEqual(formatAdaptiveDecimal(0.000035), '0');
assert.notEqual(formatAdaptiveDecimal(0.00000035), '0');
assert.equal(formatAdaptiveDecimal(0.3333333), '0.3333');
assert.equal(formatAdaptiveDecimal(12.3456), '12.35');
assert.equal(formatAdaptiveDecimal(1250), '1,250');

// Accessory categories are presentation-only: do not change quota or stock calculation.
assert.equal(isAccessoryMaterialCategory('Phụ kiện & Vít'), true);
assert.equal(isAccessoryMaterialCategory('Vật tư phụ khác'), true);
assert.equal(isAccessoryMaterialCategory('Tấm thạch cao'), false);
assert.equal(isAccessoryMaterialCategory('Khung xương'), false);
assert.deepEqual(['Phụ kiện & Vít', 'Tấm thạch cao', 'Sơn bả & Mối nối', 'Vật tư phụ khác']
  .sort(compareMaterialAccessoryLast), ['Tấm thạch cao', 'Sơn bả & Mối nối', 'Phụ kiện & Vít', 'Vật tư phụ khác']);

// Legacy order is unchanged until a deliberate ADMIN move; saved order survives
// mixed Firestore snapshot insertion ordering and puts newly added work last.
const legacy = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
assert.deepEqual(sortWorkVolumesByManualOrder(legacy).map(x => x.id), ['A', 'B', 'C']);
const shuffled = [{ id: 'B', displayOrder: 1 }, { id: 'C', displayOrder: 2 }, { id: 'A', displayOrder: 0 }];
assert.deepEqual(sortWorkVolumesByManualOrder(shuffled).map(x => x.id), ['A', 'B', 'C']);
assert.deepEqual(sortWorkVolumesByManualOrder([...shuffled, { id: 'D' }]).map(x => x.id), ['A', 'B', 'C', 'D']);
assert.equal(validateWorkVolumeOrder(['B', 'A', 'C'], legacy), true);
assert.equal(validateWorkVolumeOrder(['A', 'A', 'C'], legacy), false);
assert.equal(validateWorkVolumeOrder(['A', 'B'], legacy), false);
assert.equal(validateWorkVolumeOrder(['A', 'B', 'unknown'], legacy), false);

console.log('material-norm-display-golden: PASS');
