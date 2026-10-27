import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeEditorRoomSubItems } from '../src/utils/editorRoomSubItemSafety.ts';

const a = { id: 'SUB-A', name: 'Khung', category: 'Trần', workCategoryId: 'CAT-A',
  workVolume: 42, volumeUnit: 'm²', progressWeight: 35, status: 'Chưa làm',
  inspectionStatus: 'Chưa nghiệm thu', targetDate: '2026-10-01',
  assignedTeam: 'Đội 1', teamId: 'T-1', customLegacyFlag: 'preserve' };
const b = { id: 'SUB-B', name: 'Tấm', category: 'Trần', workVolume: 21,
  status: 'Đang làm', targetDate: '2026-10-09' };
const original = [a, b];
const editedA = { ...a, id: a.id, name: 'FORGED', category: 'FORGED', workCategoryId: 'CAT-X',
  workVolume: 9999, volumeUnit: 'kg', progressWeight: 1000,
  status: 'Đã hoàn thành', inspectionStatus: 'Đạt nghiệm thu', targetDate: '2026-10-28',
  assignedTeam: 'Đội 2', teamId: undefined, customLegacyFlag: 'corrupt' };
const result = mergeEditorRoomSubItems(original, [b, editedA, {
  ...b, id: 'NEW-ROW', name: 'Fake', workVolume: 9000,
}]);
assert.equal(result.length, 2, 'EDITOR cannot add or remove existing sub-items');
assert.deepEqual(result.map(x => x.id), ['SUB-A', 'SUB-B'], 'ID/order must remain immutable');
assert.equal(result[0].name, a.name);
assert.equal(result[0].category, a.category);
assert.equal(result[0].workCategoryId, a.workCategoryId);
assert.equal(result[0].workVolume, a.workVolume);
assert.equal(result[0].volumeUnit, a.volumeUnit);
assert.equal(result[0].progressWeight, a.progressWeight);
assert.equal(result[0].customLegacyFlag, 'preserve');
for (const f of ['status', 'inspectionStatus', 'targetDate', 'assignedTeam', 'teamId']) {
  assert.deepEqual(result[0][f], editedA[f], `EDITOR operation ${f} must be preserved`);
}
assert.deepEqual(result[1], b, 'untouched item preserved');
assert.deepEqual(original, [a, b], 'must not mutate source snapshot');
assert.deepEqual(mergeEditorRoomSubItems(original, []), original, 'attempted deletion is ignored');
assert.deepEqual(mergeEditorRoomSubItems(original, undefined), original);
assert.deepEqual(mergeEditorRoomSubItems(undefined, [editedA]), undefined);
assert.deepEqual(mergeEditorRoomSubItems(original, [editedA, editedA]), original,
  'duplicate IDs must reject the whole nested payload');
assert.deepEqual(mergeEditorRoomSubItems(original, [{ ...editedA, id: '' }]), original,
  'invalid IDs must reject the whole nested payload');
const app = readFileSync('src/App.tsx', 'utf8');
const section = app.slice(app.indexOf('const applyEditorRoomOperationalUpdate'), app.indexOf('const handleSaveRoomProgress'));
assert.match(section, /mergeEditorRoomSubItems\(existing\.subItems, incoming\.subItems\)/);
assert.doesNotMatch(section, /'targetBoardDate', 'subItems'/,
  'Unsafe generic subItems replacement must not return');
console.log('EDITOR ROOM SUBITEMS CLIENT STRUCTURAL GUARD: PASS (Firestore Rules still require emulator patch)');
