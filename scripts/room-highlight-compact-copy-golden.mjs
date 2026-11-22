import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const form = readFileSync(new URL('../src/components/RoomHighlightModal.tsx', import.meta.url), 'utf8');
const required = [
  'Nạp hạng mục', 'Chọn mẫu', 'Thêm vào phòng',
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
assert.ok(!form.includes('className="lg:hidden text-[11px] text-indigo-700/90 font-medium"'));
assert.ok(!form.includes('className="lg:hidden text-[10.5px] text-slate-500 font-medium mt-0.5 leading-tight"'));
assert.ok(form.includes('className="lg:hidden w-full lg:w-auto'), 'Mobile add-subitem button must remain');
console.log('PASS room highlight compact copy: consistent PC/mobile text; preset/bulk/team/map controls retained');
