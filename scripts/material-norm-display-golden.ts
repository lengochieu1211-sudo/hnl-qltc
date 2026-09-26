import assert from 'node:assert/strict';
import { formatAdaptiveDecimal } from '../src/utils/numberUtils';

assert.equal(formatAdaptiveDecimal(0), '0');
assert.equal(formatAdaptiveDecimal(0.0035), '0.0035');
assert.notEqual(formatAdaptiveDecimal(0.000035), '0');
assert.notEqual(formatAdaptiveDecimal(0.00000035), '0');
assert.equal(formatAdaptiveDecimal(0.3333333), '0.3333');
assert.equal(formatAdaptiveDecimal(12.3456), '12.35');
assert.equal(formatAdaptiveDecimal(1250), '1,250');

console.log('material-norm-display-golden: PASS');
