import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import type { HealthCenterSummary } from '../src/healthCenter/healthCenterEngine';
import {
  buildHealthCenterExcelWorkbook,
  buildHealthCenterHtmlReport,
  buildHealthCenterJson,
} from '../src/healthCenter/healthCenterExport';

const report: HealthCenterSummary = {
  auditSnapshotId: 'hc-golden-project-1788684000000-12-3',
  projectId: 'golden-project',
  generatedAt: 1788684000000,
  freshness: 'live',
  recordsScanned: 12,
  errorCount: 1,
  warningCount: 1,
  reviewCount: 1,
  suggestionCount: 0,
  safeRepairCount: 0,
  needsConfirmationCount: 1,
  manualRepairCount: 1,
  technicalIssueCount: 0,
  businessIssueCount: 3,
  issues: [
    {
      id: 'issue-orphan',
      ruleId: 'ROOM_FLOOR_NOT_FOUND',
      severity: 'ERROR',
      module: 'rooms',
      entityType: 'room',
      entityId: 'room-orphan',
      message: 'Căn A101 tham chiếu tầng không còn tồn tại.',
      actionClass: 'MANUAL_REPAIR',
      evidenceIds: ['rooms:room-orphan'],
      location: { floorId: 'floor-missing', floorName: 'Tầng cũ', roomId: 'room-orphan', roomName: 'A101' },
      details: { floorId: 'floor-missing' },
    },
    {
      id: 'issue-crew',
      ruleId: 'CREW_TASK_EMPTY_DETAIL',
      severity: 'WARNING',
      module: 'crew',
      entityType: 'crew',
      entityId: 'crew-1',
      message: 'Nhật ký quân số có chi tiết công việc rỗng ().',
      actionClass: 'NEEDS_CONFIRMATION',
      evidenceIds: ['crew_records:crew-1'],
      location: { date: '2026-09-06', teamName: 'Đội Nguyên', floorName: 'Tầng 3', shift: 'Sáng', workItem: 'Thi công trần C04 ()' },
      details: { taskDescription: 'Thi công trần C04 ()' },
    },
    {
      id: 'issue-defect',
      ruleId: 'DEFECT_CLOSED_WITHOUT_COMPLETED_AT',
      severity: 'REVIEW',
      module: 'defects',
      entityType: 'defect',
      entityId: 'defect-1',
      message: 'Defect đã khắc phục nhưng thiếu ngày hoàn thành.',
      actionClass: 'NEEDS_CONFIRMATION',
      evidenceIds: ['defects:defect-1'],
      location: { date: '2026-09-05', teamName: 'Đội Nguyên', floorName: 'Tầng 2', roomName: 'B201', workItem: 'Thạch cao' },
      details: { status: 'Đã khắc phục' },
    },
  ],
};

const aiNarrative = 'Ưu tiên kiểm tra căn A101 vì liên kết tầng đã mất. Đây chỉ là nhận xét AI.';
const input = { report, projectName: 'Sân Bay LT', aiNarrative } as const;

const json = buildHealthCenterJson(input);
const parsed = JSON.parse(json);
assert.equal(parsed.auditSnapshotId, report.auditSnapshotId, 'JSON phải giữ nguyên auditSnapshotId');
assert.equal(parsed.projectId, report.projectId);
assert.equal(parsed.issues.length, 3);
assert.equal(parsed.aiNarrative, aiNarrative);

const filteredJson = JSON.parse(buildHealthCenterJson({
  ...input,
  scope: 'filtered',
  issues: [report.issues[1]],
}));
assert.equal(filteredJson.auditSnapshotId, report.auditSnapshotId, 'Filtered JSON phải dùng cùng snapshot');
assert.equal(filteredJson.exportedIssueCount, 1);
assert.equal(filteredJson.issues[0].ruleId, 'CREW_TASK_EMPTY_DETAIL');

const wb = buildHealthCenterExcelWorkbook(input);
const expectedSheets = ['Tong quan', 'Tat ca van de', 'Loi nghiem trong', 'Canh bao', 'Can xac nhan', 'Mo coi lien ket', 'Quan so', 'Defect', 'Tien do Can phong', 'AI nhan xet'];
for (const sheet of expectedSheets) {
  assert.ok(wb.SheetNames.includes(sheet), `Excel phải có sheet ${sheet}`);
}
const summary = XLSX.utils.sheet_to_json<Array<string | number>>(wb.Sheets['Tong quan'], { header: 1 });
assert.ok(summary.some((row) => row[0] === 'Audit Snapshot ID' && row[1] === report.auditSnapshotId), 'Excel phải chứa auditSnapshotId');
const allIssues = XLSX.utils.sheet_to_json<Array<string | number>>(wb.Sheets['Tat ca van de'], { header: 1 });
assert.ok(allIssues.some((row) => row.includes('Đội Nguyên') && row.includes('Tầng 3')), 'Excel phải xuất metadata ngày/đội/tầng');
assert.ok(allIssues.some((row) => row.includes('ROOM_FLOOR_NOT_FOUND')), 'Excel phải xuất orphan rule');
const aiRows = XLSX.utils.sheet_to_json<Array<string | number>>(wb.Sheets['AI nhan xet'], { header: 1 });
assert.ok(aiRows.some((row) => row.includes(aiNarrative)), 'AI nhận xét phải nằm ở sheet riêng');

const filteredWb = buildHealthCenterExcelWorkbook({ ...input, scope: 'filtered', issues: [report.issues[1]] });
const filteredRows = XLSX.utils.sheet_to_json<Array<string | number>>(filteredWb.Sheets['Tat ca van de'], { header: 1 });
assert.equal(filteredRows.length, 2, 'Filtered Excel chỉ gồm header + issue được lọc');
assert.ok(filteredRows[1].includes('CREW_TASK_EMPTY_DETAIL'));

const html = buildHealthCenterHtmlReport(input);
assert.ok(html.includes(report.auditSnapshotId), 'PDF HTML phải hiển thị auditSnapshotId');
assert.ok(html.includes('Đội Nguyên'));
assert.ok(html.includes('Tầng 3'));
assert.ok(html.includes('ROOM_FLOOR_NOT_FOUND'));
assert.ok(html.includes('AI nhận xét (không thay thế kết luận HNL)'), 'AI phải được ghi nhãn tách biệt khỏi Audit HNL');
assert.ok(html.includes('Dữ liệu mồ côi không được tự động xóa'), 'PDF phải nêu nguyên tắc bảo toàn dữ liệu mồ côi');

console.log('Health Center export golden regression PASS', {
  auditSnapshotId: report.auditSnapshotId,
  sheets: wb.SheetNames.length,
  issues: report.issues.length,
});
