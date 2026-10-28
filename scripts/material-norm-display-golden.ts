import fs from 'node:fs';
import assert from 'node:assert/strict';
import { formatAdaptiveDecimal } from '../src/utils/numberUtils';

assert.equal(formatAdaptiveDecimal(0), '0');
assert.equal(formatAdaptiveDecimal(0.0035), '0.0035');
assert.notEqual(formatAdaptiveDecimal(0.000035), '0');
assert.notEqual(formatAdaptiveDecimal(0.00000035), '0');
assert.equal(formatAdaptiveDecimal(0.3333333), '0.3333');
assert.equal(formatAdaptiveDecimal(12.3456), '12.35');
assert.equal(formatAdaptiveDecimal(1250), '1,250');

const modalSource = fs.readFileSync('src/components/MaterialNormModal.tsx', 'utf8');
assert(modalSource.includes('data-hnl-norm-editor="true" className="mx-auto w-full max-w-3xl lg:max-w-none'),
  'Norm editor must fill available dialog width on desktop while retaining narrow-screen cap');
assert(modalSource.includes('grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start'),
  'Norm core fields must use one column on phone and paired columns on desktop');
assert(modalSource.includes('Lưu & thêm tiếp') && modalSource.includes('Lưu & đóng')
  && modalSource.includes('Lưu thay đổi'), 'Norm editor save flows must remain intact');
console.log('material-norm-display-golden: PASS');
