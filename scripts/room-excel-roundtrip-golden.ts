import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');

assert.match(source, /XLSX\.utils\.book_append_sheet\(wb, roomSheet, 'Can_Phong'\)/, 'Room sheet must be exported');
assert.match(source, /XLSX\.utils\.book_append_sheet\(wb, subItemSheet, 'Hang_Muc_Thi_Cong'\)/, 'Work-item sheet must be exported');
assert.match(source, /XLSX\.utils\.book_append_sheet\(wb, teamSheet, 'Danh_Muc_Doi'\)/, 'Team catalog sheet must be exported');
assert.match(source, /'Hạng Mục Thi Công': subItem\.category \|\| room\.workCategory/, 'Work category must be exported per room sub-item');
assert.match(source, /'Công Đoạn \/ Nội Dung': subItem\.name/, 'Sub-item name must be exported');
assert.match(source, /'Đội Thi Công': resolveExcelTeamName\(subItem\.teamId, subItem\.assignedTeam\)/, 'Sub-item team must be exported with durable team linkage');
assert.match(source, /resolveExcelTeamId/, 'Excel export must recover durable team IDs from exact catalog names');
assert.match(source, /resolveExcelCategoryId/, 'Excel export must recover durable work-category IDs from exact catalog names');
assert.match(source, /roomSheet\['!cols'\]/, 'Room sheet must set readable column widths and hide technical IDs');
assert.match(source, /roomSheet\['!autofilter'\]/, 'Room sheet must enable AutoFilter');
assert.match(source, /subItemSheet\['!cols'\]/, 'Work-item sheet must set readable column widths and hide technical IDs');
assert.match(source, /subItemSheet\['!autofilter'\]/, 'Work-item sheet must enable AutoFilter');
assert.match(source, /teamSheet\['!cols'\]/, 'Team catalog must hide the technical team ID by default');
assert.match(source, /detailJsonData/, 'Detailed work-item sheet must be parsed on import');
assert.match(source, /const importedSubItems: RoomSubItem\[\] \| undefined/, 'Import must rebuild detailed room sub-items');
assert.match(source, /resolveExcelTeamLink/, 'Import must resolve teamId by ID or exact team name');
assert.match(source, /resolveExcelCategory/, 'Import must resolve workCategoryId by ID or exact active category name');
assert.match(source, /subItems: importedSubItems/, 'Imported sub-items must be persisted on the room record');
assert.match(source, /assignedTeam: roomTeamLink\.assignedTeam/, 'Room-level assigned team must be imported');
assert.match(source, /workCategory: roomCategoryLink\.name/, 'Room-level work category must be imported');
assert.match(source, /\|\| workbook\.SheetNames\[0\]/, 'Legacy room-only Excel files must remain importable');

console.log('Room Excel Round-trip Golden: PASS');
