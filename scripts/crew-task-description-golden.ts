import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatCrewTaskDescription, sanitizeCrewTaskDescriptionText } from '../src/utils/crewTaskDescription.ts';

assert.equal(
  formatCrewTaskDescription({ categoryName: 'Đóng vách', subItems: [] }),
  'Đóng vách',
  'Không được sinh ngoặc rỗng khi công việc không có công đoạn con',
);

assert.equal(
  formatCrewTaskDescription({ categoryName: 'Đóng vách', subItems: ['Bắn khung'] }),
  'Đóng vách (Bắn khung)',
  'Phải giữ công đoạn con khi có dữ liệu',
);

assert.equal(
  formatCrewTaskDescription({ categoryName: 'Đóng vách', subItems: [' Bắn khung ', '', '  ', 'Bắn tấm'] }),
  'Đóng vách (Bắn khung, Bắn tấm)',
  'Phải bỏ công đoạn con rỗng và chuẩn hóa khoảng trắng',
);

assert.equal(
  formatCrewTaskDescription({ categoryName: '  Đóng vách  ', subItems: null }),
  'Đóng vách',
  'Tên công việc phải được trim mà không thêm ngoặc rỗng',
);

assert.equal(
  sanitizeCrewTaskDescriptionText('[Tầng 1]: Đóng vách (); Bả matit (Lớp 1) | [Tầng 2]: Vệ sinh ()'),
  '[Tầng 1]: Đóng vách; Bả matit (Lớp 1) | [Tầng 2]: Vệ sinh',
  'Persistence boundary phải xóa ngoặc rỗng legacy nhưng giữ ngoặc có nội dung',
);

assert.equal(
  sanitizeCrewTaskDescriptionText('  Thi công thạch cao ()  '),
  'Thi công thạch cao',
  'Persistence boundary phải trim và bỏ ngoặc rỗng ở cuối chuỗi',
);

console.log('Crew task description golden: PASS');

// Regression for the custom main-category/sub-item picker inside the crew form.
// A nested <form> or submit button sends the entire crew record and closes it.
const crewTabSource = readFileSync(new URL('../src/components/CrewTabBase.tsx', import.meta.url), 'utf8');
const customEntryStart = crewTabSource.indexOf('{crewCustomEntry ? (');
const customEntryEnd = crewTabSource.indexOf(') : (', customEntryStart);
assert(customEntryStart !== -1 && customEntryEnd > customEntryStart, 'Crew custom name entry must exist');
const customEntry = crewTabSource.slice(customEntryStart, customEntryEnd);
assert(!/<form\b/i.test(customEntry), 'Custom name entry must not nest a form inside crew log form');
assert(!/<button[^>]+type="submit"/i.test(customEntry), 'Custom name confirm must not submit crew log');
assert(customEntry.includes('<button type="button" onClick={confirmCustomName}'), 'Custom name must confirm without submitting crew log');
assert(customEntry.includes("e.key !== 'Enter'") && customEntry.includes('e.preventDefault()') && customEntry.includes('e.stopPropagation()') && customEntry.includes('!e.nativeEvent.isComposing'), 'Enter must not submit crew log, including during Vietnamese IME composition');
assert(crewTabSource.includes('const duplicate = fw.categories.some('), 'Avoid duplicate category names on the same floor');
assert(crewTabSource.includes('selected.subItems.some(existing => normalizeLinkText(existing) === normalizeLinkText(normalizedName))'), 'Do not add duplicate sub-items');
console.log('Crew custom category/sub-item picker submit regression: PASS');
