import assert from 'node:assert/strict';
import { buildDefectShareText, resolveDefectTeam } from '../src/utils/defectContactUtils';
import type { DefectItem, TeamInfo } from '../src/types';

const teams: TeamInfo[] = [
  { id: 'team-a', name: 'Đội Trần A', leader: 'Anh A', defaultCount: 8, phone: '0901234567' },
  { id: 'team-b', name: 'Đội Tấm B', leader: 'Anh B', defaultCount: 6, phone: '0912345678' },
];

assert.equal(resolveDefectTeam({ teamId: 'team-b', assignedTo: 'Tên cũ' }, teams)?.id, 'team-b');
assert.equal(resolveDefectTeam({ assignedTo: '  đội trần a ' }, teams)?.id, 'team-a');
assert.equal(resolveDefectTeam({ assignedTo: 'Không có' }, teams), undefined);

const defect: DefectItem = {
  id: 'defect-abc123',
  floorId: 'f1',
  floorName: 'Tầng 5',
  category: 'Tấm thạch cao',
  x: 10,
  y: 20,
  description: 'Thiếu vít',
  severity: 'Nghiêm trọng',
  assignedTo: 'Đội Tấm B',
  dueDate: '2026-09-05',
  status: 'Đang sửa',
  createdAt: '2026-09-03T00:00:00.000Z',
};
const text = buildDefectShareText(defect);
for (const expected of ['HNL QLTC – Defect', 'Tầng: Tầng 5', 'Loại lỗi: Tấm thạch cao', 'Mô tả: Thiếu vít', 'Phụ trách: Đội Tấm B', '05/09/2026', 'Trạng thái: Đang sửa']) {
  assert.ok(text.includes(expected), `Missing share text segment: ${expected}`);
}

console.log('Defect Contact Golden: PASS');
