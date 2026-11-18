/**
 * Regression: absolute UTC timestamps versus local calendar dates.
 * No Firebase credentials, data writes, or external services.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const entry = new URL('../src/utils/dateFormatter.ts', import.meta.url).href;
const script = [
  "import assert from 'node:assert/strict';",
  "import {formatDate,formatDateTime,parseLegacyTimestamp,toLocalDateInputValue,addLocalCalendarDaysToDateInput} from "+JSON.stringify(entry)+";",
  "const absolute='2026-11-17T23:56:43.000Z';",
  "const offset='2026-11-18T06:56:43.000+07:00';",
  "const expected=process.env.EXPECTED_DATE;",
  "const dateKey=expected==='18/11/2026'?'2026-11-18':'2026-11-17';",
  "assert.equal(formatDate(absolute,'DD/MM/YYYY'),expected);",
  "assert.equal(formatDateTime(absolute),expected+' '+process.env.EXPECTED_TIME);",
  "assert.equal(formatDate(offset,'DD/MM/YYYY'),expected);",
  "assert.equal(parseLegacyTimestamp(absolute),Date.parse(absolute));",
  "assert.equal(parseLegacyTimestamp(offset),Date.parse(offset));",
  "assert.equal(toLocalDateInputValue(new Date(absolute)),dateKey);",
  "assert.equal(formatDate('2026-11-18','DD/MM/YYYY'),'18/11/2026');",
  "assert.equal(formatDate('18/11/2026','DD/MM/YYYY'),'18/11/2026');",
  "assert.equal(formatDateTime(absolute).split(' ')[0],expected);",
  "assert.equal(parseLegacyTimestamp('15:22:15 11/8/2026'),new Date(2026,7,11,15,22,15).getTime());",
  "assert.equal(addLocalCalendarDaysToDateInput(new Date(2026,2,7,12),2),'2026-03-09');",
  "console.log('PASS '+process.env.TZ+' -> '+formatDateTime(absolute));",
].join('\n');
for(const [tz,date,time] of [
  ['Asia/Ho_Chi_Minh','18/11/2026','06:56'],
  ['UTC','17/11/2026','23:56'],
  ['America/Los_Angeles','17/11/2026','15:56'],
]){
 const run=spawnSync(process.execPath,['--no-warnings','--experimental-strip-types','--input-type=module','-e',script],{
  encoding:'utf8',env:{...process.env,TZ:tz,EXPECTED_DATE:date,EXPECTED_TIME:time}
 });
 assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
 process.stdout.write(run.stdout);
}
console.log('PASS date-timezone-regression-golden (33 assertions)');
