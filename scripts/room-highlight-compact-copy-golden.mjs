import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const form = readFileSync(new URL('../src/components/RoomHighlightModal.tsx', import.meta.url), 'utf8');
const required = [
  'data-hnl-room-work-categories="true"', 'Chọn hạng mục thi công', 'Thêm vào phòng',
  'Hạng mục thi công ({subItems.length})',
  'Chọn tất cả ({subItems.length})',
  'presetWorkCategories.map', 'handleApplyPreset(presetSelection)',
  'setSelectedSubItemIds(subItems.map(s => s.id))',
  'applyProgressPatch', 'assignedTeam',
  "onClick={() => launchCach2(catName, 'main')}",
];
for (const marker of required) {
  assert.ok(form.includes(marker), `Lost main stage/preset/bulk behavior: ${marker}`);
}
for (const obsolete of [
  'Nạp hạng mục\n',
  'Chọn mẫu\n',
  'Nạp mẫu hạng mục thi công',
  'Nạp tự động các bộ công đoạn.',
  'Chọn bộ mẫu hạng mục thi công áp dụng:',
  'Nạp Thêm Vào Căn Này',
  'Danh sách hạng mục thi công trong Căn / Phòng',
  '💡 Mỗi hạng mục có thể phân công',
  '💡 Hãy tick chọn các hạng mục',
]) {
  assert.ok(!form.includes(obsolete), `Long/mobile-only note regressed: ${obsolete}`);
}
const categoryArea = form.slice(form.indexOf('data-hnl-room-work-categories="true"'), form.indexOf('{/* Floor-wide metric calibration lives only on the map toolbar.'));
assert.ok(categoryArea.includes('data-hnl-room-preset-inline-row="true"'), 'Presets must be inside the unified category section');
assert.ok(categoryArea.indexOf('data-hnl-room-preset-inline-row="true"') < categoryArea.indexOf('Select All & Bulk Actions Toolbar'), 'Preset controls must precede the saved list');
assert.equal((form.match(/<span>Hạng mục thi công \\(\\{subItems\\.length\\}\\)<\\/span>/g) || []).length, 1, 'Single visible section heading');
assert.ok(categoryArea.includes('{!structureReadOnly && ('), 'Preset editing must preserve read-only permission gate');
assert.ok(!form.includes('className="lg:hidden text-[11px] text-indigo-700/90 font-medium"'));
assert.ok(!form.includes('className="lg:hidden text-[10.5px] text-slate-500 font-medium mt-0.5 leading-tight"'));
assert.ok(form.includes('className="lg:hidden w-full lg:w-auto'), 'Mobile add-subitem button must remain');
console.log('PASS room highlight compact copy: consistent PC/mobile text; preset/bulk/team/map controls retained');
