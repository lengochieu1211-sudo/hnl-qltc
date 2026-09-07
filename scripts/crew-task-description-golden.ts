import assert from 'node:assert/strict';
import { formatCrewTaskDescription } from '../src/utils/crewTaskDescription.ts';

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

console.log('Crew task description golden: PASS');
