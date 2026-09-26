import assert from 'node:assert/strict';
import fs from 'node:fs';

const quick = fs.readFileSync('src/components/QuickEditGridModal.tsx', 'utf8');
const excel = fs.readFileSync('src/components/ExcelActionMenu.tsx', 'utf8');
const floor = fs.readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');
const crew = fs.readFileSync('src/components/CrewTabBase.tsx', 'utf8');
const warehouse = fs.readFileSync('src/components/WarehouseTab.tsx', 'utf8');
const volume = fs.readFileSync('src/components/WorkVolumeTab.tsx', 'utf8');
const dxf = fs.readFileSync('src/utils/dxfRoomDetection.ts', 'utf8');
const pdfRoomDetection = fs.readFileSync('src/utils/pdfRoomDetection.ts', 'utf8');

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
assert.match(fs.readFileSync('src/utils/excelExport.ts', 'utf8'), /XLSX\.utils\.aoa_to_sheet\(\[workVolumeHeaders\]\)/, 'WorkVolume blank template must retain editable headers');
assert.match(fs.readFileSync('src/utils/excelExport.ts', 'utf8'), /XLSX\.utils\.aoa_to_sheet\(\[mainHeaders\]\)/, 'Crew blank template must retain journal headers');
assert.match(fs.readFileSync('src/utils/excelExport.ts', 'utf8'), /'__itemKind': item\.itemKind === 'equipment'/, 'Warehouse inbound round-trip must preserve material-vs-equipment identity');
assert.match(fs.readFileSync('src/utils/excelExport.ts', 'utf8'), /XLSX\.utils\.aoa_to_sheet\(\[inHeaders\]\)/, 'Warehouse blank inbound template must retain headers');
assert.doesNotMatch(excel, /Xuất báo cáo Excel/, 'Excel edit menu must not duplicate reporting');
assert.match(excel, /className="relative shrink-0"/, 'Excel action trigger must not be squeezed/cropped in mobile flex rows');
assert.match(excel, /whitespace-nowrap/, 'Excel action trigger must keep its compact label intact on mobile');
assert.match(excel, /FileSpreadsheet/, 'Excel action trigger must use the standard spreadsheet icon instead of a text glyph');

assert.match(floor, /Căn & Hạng mục/, 'Floor quick edit must separate room/work rows');
assert.match(floor, /Deadline defect/, 'Defect quick edit must expose deadline');
assert.match(floor, /Ngày hoàn thành thực tế defect/, 'Defect quick edit must expose actual completion date');
assert.match(floor, /__floorId/, 'Multi-floor Excel must keep durable floor ID');
assert.match(floor, /multiFloorImport/, 'Room Excel import must support multi-floor input');
assert.match(floor, /không được tự đổi floorId qua Excel/, 'Excel import must fail closed on cross-floor identity mismatch');
assert.match(floor, /__recordId không tồn tại trong dự án hiện tại/, 'Room Excel import must reject stale technical room IDs instead of falling back to names');
assert.match(floor, /onApplyRoomExcelImport\(preparedRooms, obsoleteRoomIds\)/, 'Room Excel import must preflight every row then apply one atomic App-state transaction');
assert.match(floor, /__subItemId không tồn tại/, 'Room detail Excel import must reject stale technical sub-item IDs');
assert.match(floor, /PDF\/JPG\/PNG\/WebP\/DXF/, 'Add-floor drawing picker must include DXF beside PDF/images');
assert.match(floor, /createFloor: true/, 'DXF selected from add-floor flow must create the requested new floor only after review');
assert.doesNotMatch(floor, /<FileType[^>]*\/> Nhận diện CAD\/DXF/, 'Room toolbar must not expose a separate CAD/DXF button');
assert.match(floor, /Chỉ tạo tầng/, 'DXF review must let the user create the floor without auto-creating rooms');
assert.match(floor, /Tạo tầng \+ Căn \/ Phòng/, 'DXF review must support creating the floor and detected rooms together');
assert.match(floor, /isPolyline: candidate\.points\.length >= 3/, 'DXF polygon geometry must remain polygonal instead of degrading to a rectangle');
assert.match(floor, /Khôi phục mặc định/, 'Advanced PDF name regex must provide a safe reset action');
assert.match(floor, /aria-invalid=\{!isSmartPdfNamePatternValid\}/, 'Advanced PDF name regex must surface invalid syntax before detection');
assert.doesNotMatch(pdfRoomDetection, /\(\?=\.\*/, 'Default room-name regex should avoid the hard-to-read lookahead form reported on mobile');
assert.match(floor, /Tạo Căn \/ Phòng từ DXF/, 'DXF import must retain an explicit review/apply path');
assert.match(floor, /Không ghi đè Căn \/ Phòng đã tồn tại/, 'DXF import must protect existing room highlights');

assert.match(crew, /Xuất Nhật ký để chỉnh sửa/, 'Crew must export journal for editing');
assert.match(crew, /Nhập Nhật ký đã chỉnh sửa/, 'Crew must import edited journal');
assert.match(crew, /chi tiet cong viec/i, 'Crew import must understand detailed work sheet');
assert.match(crew, /__teamId không tồn tại trong dự án hiện tại/, 'Crew Excel import must reject stale technical team IDs');
assert.match(crew, /__recordId không tồn tại trong dự án hiện tại/, 'Crew Excel import must reject stale journal IDs');
assert.match(crew, /Thống kê tất cả đội/, 'All-team report button must be distinguishable from global report');
assert.match(crew, /Xuất Excel Đội Này/, 'Single-team report export must remain available');

assert.match(warehouse, /Danh mục & Định mức/, 'Warehouse quick edit must have material/norm table');
assert.match(warehouse, /Nhập kho/, 'Warehouse quick edit must have inbound ledger table');
assert.match(warehouse, /Xuất kho/, 'Warehouse quick edit must have outbound ledger table');
assert.match(warehouse, /Tồn kho 🔒/, 'Warehouse stock must be visibly read-only');
assert.match(warehouse, /quickEditMode === 'stock' \? false/, 'Stock quick table must reject edits');
assert.match(warehouse, /Mã Phiếu không tồn tại trong dự án hiện tại/, 'Warehouse Excel import must reject stale transaction IDs');
assert.match(warehouse, /assertKnownReference/, 'Warehouse Excel import must validate technical linkage IDs before writing');

assert.match(volume, /Khối lượng đã làm/, 'WorkVolume quick table must show actual volume');
assert.match(volume, /key: 'actual'.*editable: false/, 'Actual volume must be read-only');
assert.match(volume, /Khu\/Khối tự đồng bộ từ các tầng đã gán/, 'WorkVolume structure scope must derive from floor assignments');
assert.match(volume, /__recordId không tồn tại trong dự án hiện tại/, 'WorkVolume Excel import must reject stale record IDs');
assert.match(volume, /__floorId\/__floorIds không tồn tại/, 'WorkVolume Excel import must reject stale floor IDs');

assert.match(dxf, /HATCH/, 'DXF detector must support HATCH');
assert.match(dxf, /LWPOLYLINE/, 'DXF detector must support closed polylines');
assert.match(dxf, /MTEXT/, 'DXF detector must support MTEXT');
assert.match(dxf, /areaM2/, 'DXF detector must calculate metric area');
assert.match(dxf, /\$EXTMIN/, 'DXF detector must prefer drawing extents for alignment');
assert.match(dxf, /readHatchBoundaryShapes/, 'DXF detector must parse all HATCH boundary paths, not only the first loop');
assert.match(dxf, /alignedX/, 'DXF TEXT reader must honor justified alignment point 11\/21');
assert.match(dxf, /measurement/, 'DXF room-name selection must de-prioritize area/measurement labels');

console.log('Quick Edit + Excel + DXF Golden: PASS');
