import assert from 'node:assert/strict';
import { normalizePhone } from '../src/utils/contactUtils';

const cases = [
  { input: '090 123 4567', national: '0901234567', e164: '+84901234567', dial: '+84901234567', valid: true },
  { input: '090.123.4567', national: '0901234567', e164: '+84901234567', dial: '+84901234567', valid: true },
  { input: '84901234567', national: '0901234567', e164: '+84901234567', dial: '+84901234567', valid: true },
  { input: '+84 90 123 4567', national: '0901234567', e164: '+84901234567', dial: '+84901234567', valid: true },
  { input: '901234567', national: '0901234567', e164: '+84901234567', dial: '+84901234567', valid: true },
  { input: '+12025550123', national: '', e164: '', dial: '+12025550123', valid: true },
  { input: '12345', national: '', e164: '', dial: '', valid: false },
  { input: 'abc', national: '', e164: '', dial: '', valid: false },
  { input: '', national: '', e164: '', dial: '', valid: false },
] as const;

for (const testCase of cases) {
  const result = normalizePhone(testCase.input);
  assert.equal(result.original, testCase.input.trim(), `original must be preserved: ${testCase.input}`);
  assert.equal(result.national, testCase.national, `national mismatch: ${testCase.input}`);
  assert.equal(result.e164, testCase.e164, `e164 mismatch: ${testCase.input}`);
  assert.equal(result.dial, testCase.dial, `dial mismatch: ${testCase.input}`);
  assert.equal(result.valid, testCase.valid, `valid mismatch: ${testCase.input}`);
}

console.log(`Contact Core Golden: PASS (${cases.length} phone normalization cases)`);
