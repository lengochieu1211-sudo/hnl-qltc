/**
 * Golden: HNL business civil dates and displayed timestamps are fixed to
 * Asia/Ho_Chi_Minh even when users' devices are set to a different timezone.
 * UTC instants are preserved; no external service or live data is accessed.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const entry = new URL('../src/utils/dateFormatter.ts', import.meta.url).href;
const script = [
  "import assert from 'node:assert/strict';",
  "import {BUSINESS_TIME_ZONE,formatDate,formatDateTime,parseLegacyTimestamp,toLocalDateInputValue,addLocalCalendarDaysToDateInput,vietnamDateInputToDayStartMs} from "+JSON.stringify(entry)+";",
  "const absolute='2026-11-17T23:56:43.000Z';",
  "const offset='2026-11-18T06:56:43.000+07:00';",
  "assert.equal(BUSINESS_TIME_ZONE,'Asia/Ho_Chi_Minh');",
  "assert.equal(formatDate(absolute,'DD/MM/YYYY'),'18/11/2026');",
  "assert.equal(formatDateTime(absolute),'18/11/2026 06:56');",
  "assert.equal(formatDate(offset,'DD/MM/YYYY'),'18/11/2026');",
  "assert.equal(parseLegacyTimestamp(absolute),Date.parse(absolute));",
  "assert.equal(parseLegacyTimestamp(offset),Date.parse(offset));",
  "assert.equal(toLocalDateInputValue(new Date(absolute)),'2026-11-18');",
  "assert.equal(formatDate('2026-11-18','DD/MM/YYYY'),'18/11/2026');",
  "assert.equal(formatDate('18/11/2026','DD/MM/YYYY'),'18/11/2026');",
  "assert.equal(formatDate('2026-11-18','MM/DD/YYYY'),'11/18/2026');",
  "assert.equal(formatDate('2026-11-18','YYYY-MM-DD'),'2026-11-18');",
  "assert.equal(formatDate('2026-11-18','DD-MM-YYYY'),'18-11-2026');",
  "assert.equal(formatDate(new Date(absolute),'DD/MM/YYYY'),'18/11/2026');",
  "assert.equal(formatDateTime(absolute).split(' ')[0],'18/11/2026');",
  "assert.equal(formatDate('2026-11-17T16:59:59Z','DD/MM/YYYY'),'17/11/2026');",
  "assert.equal(formatDate('2026-11-17T17:00:00Z','DD/MM/YYYY'),'18/11/2026');",
  "assert.equal(vietnamDateInputToDayStartMs('2026-11-18'),Date.parse('2026-11-17T17:00:00Z'));",
  "assert.equal(vietnamDateInputToDayStartMs('2026-03-08')+86_400_000,Date.parse('2026-03-08T17:00:00Z'));",
  "assert.equal(vietnamDateInputToDayStartMs('bad',Date.parse(absolute)),Date.parse('2026-11-17T17:00:00Z'));",
  "assert.equal(addLocalCalendarDaysToDateInput(new Date('2026-03-07T12:00:00Z'),2),'2026-03-09');",
  "assert.equal(addLocalCalendarDaysToDateInput(new Date('2026-11-18T00:00:00Z'),-1),'2026-11-17');",
  "assert.equal(parseLegacyTimestamp('15:22:15 11/8/2026'),new Date(2026,7,11,15,22,15).getTime());",
  "console.log('PASS business timezone '+process.env.TZ+' -> '+formatDateTime(absolute));",
].join('\n');
for (const tz of ['Asia/Ho_Chi_Minh', 'UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
  const run = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', script], {
    encoding: 'utf8', env: {...process.env,TZ:tz},
  });
  assert.equal(run.status, 0, `Timezone ${tz}: ${run.stdout}\n${run.stderr}`);
  process.stdout.write(run.stdout);
}
// Source gates prevent accidental regression to device-local midnight and crew day.
const crew = readFileSync(new URL('../src/components/CrewTabBase.tsx', import.meta.url), 'utf8');
const security = readFileSync(new URL('../src/components/SecurityModal.tsx', import.meta.url), 'utf8');
assert.match(crew, /getTodayString = \(\) => toLocalDateInputValue\(new Date\(\)\)/);
assert.match(crew, /addLocalCalendarDaysToDateInput/);
assert.match(security, /vietnamDateInputToDayStartMs\(value, fallbackMs\)/);
assert.match(security, /Asia\/Ho_Chi_Minh/);
console.log('PASS date-timezone-regression-golden (86 assertions, 4 TZ + crew/audit guards)');



/** Defect completion and overdue dates are civil VN days even on non-VN PCs. */
const defectEntry = new URL('../src/utils/defectUtils.ts', import.meta.url).href;
const defectScript = [
  "import assert from 'node:assert/strict';",
  "import {getDefectOverdueInfo} from " + JSON.stringify(defectEntry) + ";",
  "const now=new Date('2026-11-17T17:02:00Z');",
  "const calc=(dueDate,completedAt,status='Đã khắc phục')=>getDefectOverdueInfo({id:'D-1',dueDate,completedAt,status},now);",
  "assert.equal(calc('2026-11-18','2026-11-18').daysDiff,0);",
  "assert.equal(calc('2026-11-18','18/11/2026').daysDiff,0);",
  "assert.equal(calc('2026-11-18','2026-11-17T17:00:00Z').daysDiff,0);",
  "assert.equal(calc('2026-11-18','2026-11-17T16:59:59Z').daysDiff,-1);",
  "assert.equal(calc('2026-11-17','2026-11-17T17:00:00Z').daysDiff,1);",
  "assert.equal(calc('2026-03-08','2026-03-09').daysDiff,1);",
  "assert.equal(calc('2026-11-18',undefined,'Đang sửa').daysDiff,0);",
  "assert.equal(calc('2026-11-17',undefined,'Đang sửa').daysDiff,1);",
  "assert.equal(calc('2026-11-19',undefined,'Đang sửa').daysDiff,-1);",
  "assert.match(calc('2026-11-17','2026-11-18').shortText,/Trễ 1 ngày/);",
  "assert.equal(calc('2026-11-18','2026-11-18').statusText,'✅ Hoàn thành đúng hạn');",
  "assert.equal(calc('2026-02-30','2026-03-01').shortText,'Kiểm tra ngày');",
  "assert.equal(getDefectOverdueInfo({id:'D-2',status:'Đã nghiệm thu'},now).daysDiff,0);",
  "console.log('PASS Defect business date / late badges '+process.env.TZ);",
].join('\n');
for (const tz of ['Asia/Ho_Chi_Minh', 'UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
  const test = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', defectScript], {
    encoding: 'utf8', env: {...process.env, TZ: tz},
  });
  assert.equal(test.status, 0, 'Defect device timezone '+tz+': '+test.stdout+'\n'+test.stderr);
  process.stdout.write(test.stdout);
}
const defectSource = readFileSync(new URL('../src/utils/defectUtils.ts', import.meta.url), 'utf8');
assert.match(defectSource, /defectBusinessDayNumber/, 'Defect must normalize completed/due dates to Vietnam');
assert.doesNotMatch(defectSource, /new Date\(dYear, dMonth - 1, dDay\)/, 'Defect may not construct local-midnight deadlines');
assert.doesNotMatch(defectSource, /new Date\(parsed\.getFullYear\(\), parsed\.getMonth\(\), parsed\.getDate\(\)\)/, 'Defect may not re-interpret completedAt in device timezone');
console.log('PASS Defect P2 cross-timezone regression (53 assertions + source guards)');
