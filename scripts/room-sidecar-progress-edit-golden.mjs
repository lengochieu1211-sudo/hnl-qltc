import assert from 'node:assert/strict';
import { planMigratedRoomProgressEdits } from '../src/utils/roomSidecarProgressSafety.ts';
const base = [{ id: 'A', name: 'Khung', workVolume: 25, status: 'Chưa làm', teamId: 'OLD' },
  { id: 'B', name: 'Tấm', workVolume: 30, status: 'Đang làm' }];
assert.deepEqual(planMigratedRoomProgressEdits(base, base), []);
assert.deepEqual(planMigratedRoomProgressEdits(base, [
  {...base[0], status: 'Đã hoàn thành', teamId: 'NEW'}, base[1],
]), [{ id: 'A', changes: { status: 'Đã hoàn thành', teamId: 'NEW' } }]);
for (const mutated of [
  [base[0]],
  [{ ...base[0], id: 'EVIL' }, base[1]],
  [{ ...base[0], workVolume: 999 }, base[1]],
  [{ ...base[0], status: undefined }, base[1]],
  [{ ...base[0], status: 'INVALID' }, base[1]],
  [{ ...base[0], name: 'FORGED' }, base[1]],
]) assert.throws(() => planMigratedRoomProgressEdits(base, mutated));
console.log('ROOM_SIDECAR_PROGRESS_EDIT_GOLDEN PASS');
