import assert from 'node:assert/strict';
import fs from 'node:fs';
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

const memberContactService = fs.readFileSync('src/lib/memberContactService.ts', 'utf8');
assert.match(memberContactService, /updatedByEmail[,\s]/, 'member contact writes must include updatedByEmail required by Firestore Rules');

const contactUtils = fs.readFileSync('src/utils/contactUtils.ts', 'utf8');
assert.match(contactUtils, /https:\/\/chat\.zalo\.me\//, 'web Zalo fallback must use the stable web chat origin');
assert.doesNotMatch(contactUtils, /window\.open\('https:\/\/zalo\.me\//, 'web must not force the generic zalo.me root deep link');

console.log(`Contact Core Golden: PASS (${cases.length} phone normalization cases + persistence/Zalo runtime guards)`);
