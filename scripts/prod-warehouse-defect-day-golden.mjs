/**
 * PROD hotfix regression: only voucher defaults and Defect creation dates.
 * No cloud credentials, data writes, or production service interactions.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const helper = new URL('../src/utils/vietnamBusinessDate.ts', import.meta.url).href;
const assertions = [
  "import assert from 'node:assert/strict';",
  "import {VIETNAM_BUSINESS_TIME_ZONE,vietnamBusinessDateInput,vietnamDefectCreatedAtInput} from " + JSON.stringify(helper) + ";",
  "assert.equal(VIETNAM_BUSINESS_TIME_ZONE,'Asia/Ho_Chi_Minh');",
  "assert.equal(vietnamBusinessDateInput(new Date('2026-11-17T23:56:43Z')),'2026-11-18');",
  "assert.equal(vietnamBusinessDateInput(new Date('2026-11-17T16:59:59Z')),'2026-11-17');",
  "assert.equal(vietnamBusinessDateInput(new Date('2026-11-17T17:00:00Z')),'2026-11-18');",
  "assert.equal(vietnamBusinessDateInput(new Date('2026-12-31T17:00:00Z')),'2027-01-01');",
  "assert.equal(vietnamDefectCreatedAtInput('2026-11-17T23:56:43.000Z'),'2026-11-18');",
  "assert.equal(vietnamDefectCreatedAtInput('2026-11-18T06:56:43+07:00'),'2026-11-18');",
  "assert.equal(vietnamDefectCreatedAtInput('2026-11-18'),'2026-11-18');",
  "assert.equal(vietnamDefectCreatedAtInput('18/11/2026'),'18/11/2026');",
  "assert.equal(vietnamDefectCreatedAtInput('15:22:15 11/8/2026'),'15:22:15 11/8/2026');",
  "assert.equal(vietnamDefectCreatedAtInput(''),'');",
  "assert.equal(vietnamDefectCreatedAtInput('bad input'),'bad input');",
  "console.log('PASS business day '+process.env.TZ);",
].join('\n');

for (const timezone of ['Asia/Ho_Chi_Minh','UTC','America/Los_Angeles','Pacific/Auckland']) {
  const result = spawnSync(process.execPath,
    ['--no-warnings','--experimental-strip-types','--input-type=module','-e',assertions],
    {encoding:'utf8',env:{...process.env,TZ:timezone}});
  assert.equal(result.status,0,'Timezone '+timezone+' failed: '+result.stdout+' '+result.stderr);
  process.stdout.write(result.stdout);
}
const read = (p) => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const warehouse = read('src/components/WarehouseTab.tsx');
const defects = read('src/components/FloorPlanDefectTab.tsx');
const app = read('src/App.tsx');
const inventory = read('src/utils/inventoryUtils.ts');
assert.equal((warehouse.match(/vietnamBusinessDateInput\(\)/g)||[]).length,4);
assert.equal((defects.match(/vietnamDefectCreatedAtInput\(/g)||[]).length,4);
assert.match(app,/createdAt: new Date\(\)\.toISOString\(\)/);
assert.match(app,/const todayStr = vietnamBusinessDateInput\(\)/);
assert.match(inventory,/vietnamBusinessDateInput\(\)/);
assert.equal((warehouse.match(/toISOString\(\)\.split\('T'\)\[0\]/g)||[]).length,0);
console.log('PASS PROD warehouse/Defect scoped business day regression');
