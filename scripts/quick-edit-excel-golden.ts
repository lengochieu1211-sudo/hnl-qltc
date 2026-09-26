import assert from 'node:assert/strict';
import fs from 'node:fs';

const quick = fs.readFileSync('src/components/QuickEditGridModal.tsx', 'utf8');
const excel = fs.readFileSync('src/components/ExcelActionMenu.tsx', 'utf8');
const floor = fs.readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');
const crew = fs.readFileSync('src/components/CrewTabBase.tsx', 'utf8');
const warehouse = fs.readFileSync('src/components/WarehouseTab.tsx', 'utf8');
const volume = fs.readFileSync('src/components/WorkVolumeTab.tsx', 'utf8');
const dxf = fs.readFileSync('src/utils/dxfRoomDetection.ts', 'utf8');

assert.match(quick, /Ctrl\+C \/ Ctrl\+V vùng ô từ Excel/, 'Quick grid must advertise spreadsheet paste');
assert.match(quick, /handlePaste/, 'Quick grid must support multi-cell paste');
assert.match(quick, /dirtyCellKeys/, 'Quick grid edits must remain staged until save');
assert.match(quick, /dirtyCellKeys\.size > 0/, 'Quick grid must preserve local draft across realtime/parent refreshes');
assert.match(quick, /const result = await onSave/, 'Quick grid must wait for the module batch-save result');
assert.match(quick, /result === false/, 'Quick grid must keep the draft dirty when module confirmation is cancelled');
assert.match(quick, /Có thay đổi chưa lưu trong Bảng chỉnh nhanh/, 'Quick grid close must guard unsaved local draft');
assert.match(quick, /Có thay đổi chưa lưu trong bảng hiện tại/, 'Quick grid tab switch must guard unsaved local draft');
assert.match(quick, /Bỏ thay đổi/, 'Quick grid must support discard');
assert.match(quick, /Hoàn tác/, 'Quick grid must support undo');
assert.match(quick, /tabs && tabs\.length/, 'Quick grid must support module-specific table tabs');

assert.match(excel, /Xuất Excel để chỉnh sửa/, 'Excel menu must be editing-oriented');
assert.match(excel, /Nhập Excel đã chỉnh sửa/, 'Excel menu must contain round-trip import');
assert.match(excel, /Tải Excel mẫu/, 'Excel menu must contain template action');
assert.doesNotMatch(excel, /Xuất báo cáo Excel/, 'Excel edit menu must not duplicate reporting');

assert.match(floor, /Căn & Hạng mục/, 'Floor quick edit must separate room/work rows');
assert.match(floor, /Deadline defect/, 'Defect quick edit must expose deadline');
assert.match(floor, /Ngày hoàn thành thực tế defect/, 'Defect quick edit must expose actual completion date');
assert.match(floor, /__floorId/, 'Multi-floor Excel must keep durable floor ID');
assert.match(floor, /multiFloorImport/, 'Room Excel import must support multi-floor input');
assert.match(floor, /không được tự đổi floorId qua Excel/, 'Excel import must fail closed on cross-floor identity mismatch');
assert.match(floor, /Nhận diện CAD\/DXF/, 'Floor UI must expose CAD/DXF recognition');
assert.match(floor, /Tạo Căn \/ Phòng từ DXF/, 'DXF import must have explicit review/apply step');
assert.match(floor, /Không ghi đè Căn \/ Phòng đã tồn tại/, 'DXF import must protect existing room highlights');

assert.match(crew, /Xuất Nhật ký để chỉnh sửa/, 'Crew must export journal for editing');
assert.match(crew, /Nhập Nhật ký đã chỉnh sửa/, 'Crew must import edited journal');
assert.match(crew, /chi tiet cong viec/i, 'Crew import must understand detailed work sheet');
assert.match(crew, /Thống kê tất cả đội/, 'All-team report button must be distinguishable from global report');
assert.match(crew, /Xuất Excel Đội Này/, 'Single-team report export must remain available');

assert.match(warehouse, /Danh mục & Định mức/, 'Warehouse quick edit must have material/norm table');
assert.match(warehouse, /Nhập kho/, 'Warehouse quick edit must have inbound ledger table');
assert.match(warehouse, /Xuất kho/, 'Warehouse quick edit must have outbound ledger table');
assert.match(warehouse, /Tồn kho 🔒/, 'Warehouse stock must be visibly read-only');
assert.match(warehouse, /quickEditMode === 'stock' \? false/, 'Stock quick table must reject edits');

assert.match(volume, /Khối lượng đã làm/, 'WorkVolume quick table must show actual volume');
assert.match(volume, /key: 'actual'.*editable: false/, 'Actual volume must be read-only');
assert.match(volume, /Khu\/Khối tự đồng bộ từ các tầng đã gán/, 'WorkVolume structure scope must derive from floor assignments');

assert.match(dxf, /HATCH/, 'DXF detector must support HATCH');
assert.match(dxf, /LWPOLYLINE/, 'DXF detector must support closed polylines');
assert.match(dxf, /MTEXT/, 'DXF detector must support MTEXT');
assert.match(dxf, /areaM2/, 'DXF detector must calculate metric area');
assert.match(dxf, /\$EXTMIN/, 'DXF detector must prefer drawing extents for alignment');

console.log('Quick Edit + Excel + DXF Golden: PASS');
