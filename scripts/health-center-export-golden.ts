import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import type { HealthCenterSummary } from '../src/healthCenter/healthCenterEngine';
import {
  buildHealthCenterExcelWorkbook,
  buildHealthCenterHtmlReport,
  buildHealthCenterJson,
  buildHealthCenterCopyText,
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


const systemDiagnostics = {
  appVersion: '6.3.0',
  environment: 'DEV',
  platform: 'Android',
  dataSchemaVersion: 7,
  buildId: 'golden-build',
  gitCommit: 'golden-commit',
  buildTime: '2026-09-11T10:00:00.000Z',
  generatedAt: '2026-09-11T10:05:00.000Z',
  firebaseUserEmail: 'golden@example.com',
  role: 'ADMIN',
  roleResolved: true,
  roleSource: 'cloud',
  userAgent: 'HNL Golden Android',
  dataCloudPhase: 'synced',
  cloudInitialReady: true,
  snapshotReadyCount: 9,
  pendingData: 0,
  photoPhase: 'idle',
  photoPending: 1,
  pendingDriveUploads: 1,
  driveSyncStatus: 'synced',
  online: true,
  lastSyncAt: 1788684000000,
  lastSyncError: '',
  duplicateProjectIds: [],
  recordCounts: { projects: 1, floors: 3, rooms: 2, defects: 1, crewRecords: 1 },
  photoDiagnostics: {
    total: 2,
    active: 2,
    ready: 1,
    pending: 1,
    photos: [
      { id: 'photo-1', entityType: 'defect', entityId: 'defect-1', storageProvider: 'r2', cloudReady: true, binaryUploadState: 'ready', localBinary: true, bytes: 1234, checksumPrefix: 'abc123', storagePath: 'projects/golden/defect/photo-1.jpg' },
      { id: 'photo-2', entityType: 'room', entityId: 'room-orphan', storageProvider: 'r2', cloudReady: false, binaryUploadState: 'pending', localBinary: false, bytes: 222, checksumPrefix: 'def456', storagePath: 'projects/golden/room/photo-2.jpg' },
    ],
  },
  floorPlanDiagnostics: {
    total: 3,
    pending: 2,
    outboxCount: 0,
    outboxBytes: 0,
    floors: [
      { id: 'floor-1', floorName: 'Tầng 1', status: 'READY', pending: false, localBinary: false, effectiveImageRevision: 2, imageCloudRevision: 2, imageUploadState: 'ready', imagePendingByUid: '', imageCloudSyncedAt: 1788683900000, outboxRevision: 0, outboxBytes: 0, storageProvider: 'r2', storagePath: 'projects/golden/floor/floor-1.jpg' },
      { id: 'floor-2', floorName: 'Tầng 2', status: 'CLOUD_POINTER_INCONSISTENT', pending: true, localBinary: false, effectiveImageRevision: 7, imageCloudRevision: 6, imageUploadState: 'pending', imagePendingByUid: 'uid-owner', outboxRevision: 0, outboxBytes: 0, storageProvider: 'r2', storagePath: 'projects/golden/floor/floor-2.jpg' },
      { id: 'floor-3', floorName: 'Tầng 3', status: 'MISSING_BINARY', pending: true, localBinary: false, effectiveImageRevision: 4, imageCloudRevision: 0, imageUploadState: 'pending', imagePendingByUid: '', outboxRevision: 0, outboxBytes: 0, storageProvider: '', storagePath: '' },
    ],
  },
  runtimeLog: [
    { at: 1788684000000, level: 'info', area: 'photo-sync', code: 'READY', projectId: 'golden-project', message: 'R2 ready' },
    { at: 1788684010000, level: 'warn', area: 'floor-plan', code: 'MISSING_BINARY', projectId: 'golden-project', message: 'Floor binary is unavailable locally' },
  ],
};

const combinedInput = { ...input, systemDiagnostics } as const;
const combinedJson = JSON.parse(buildHealthCenterJson(combinedInput));
assert.equal(combinedJson.systemDiagnostics.photoDiagnostics.pending, 1, 'JSON tổng hợp phải chứa trạng thái ảnh R2');
assert.equal(combinedJson.systemDiagnostics.floorPlanDiagnostics.total, 3, 'JSON tổng hợp phải chứa chẩn đoán ảnh mặt bằng');

const combinedWb = buildHealthCenterExcelWorkbook(combinedInput);
for (const sheet of ['He thong dong bo', 'Anh R2', 'Anh mat bang', 'Runtime log']) {
  assert.ok(combinedWb.SheetNames.includes(sheet), `Excel tổng hợp phải có sheet ${sheet}`);
}
const r2Rows = XLSX.utils.sheet_to_json<Array<string | number>>(combinedWb.Sheets['Anh R2'], { header: 1 });
assert.ok(r2Rows.some((row) => row.includes('photo-2') && row.includes('pending')), 'Excel phải chứa ảnh R2 đang pending');
const copyText = buildHealthCenterCopyText(combinedInput);
assert.ok(copyText.includes('AUDIT DỮ LIỆU & LIÊN KẾT'));
assert.ok(copyText.includes('RUNTIME / BUILD / QUYỀN'), 'Copy phải có build/runtime/quyền');
assert.ok(copyText.includes('App: 6.3.0 | Env: DEV | Platform: Android | Schema: v7'), 'Copy phải có version/env/platform/schema');
assert.ok(copyText.includes('Build ID: golden-build | Commit: golden-commit'), 'Copy phải có build ID và commit');
assert.ok(copyText.includes('User: golden@example.com | Role: ADMIN | Role resolved: true | Role source: cloud'), 'Copy phải có quyền và nguồn quyền');
assert.ok(copyText.includes('HỆ THỐNG / ĐỒNG BỘ / R2'));
assert.ok(copyText.includes('Firestore: synced | Cloud ready: true | Realtime: 9/9 | Pending data: 0'), 'Copy phải có Firestore/realtime/pending');
assert.ok(copyText.includes('Ảnh R2: total 2 | active 2 | ready 1 | pending 1'));
assert.ok(copyText.includes('Mặt bằng ảnh: total 3 | pending 2 | outbox 0 | outbox bytes 0'), 'Copy phải giữ tổng số mặt bằng pending/outbox');
assert.ok(copyText.includes('Record counts: projects=1 | floors=3 | rooms=2 | defects=1 | crewRecords=1'), 'Copy phải có record counts');
assert.ok(copyText.includes('CHI TIẾT MẶT BẰNG ẢNH (TẤT CẢ)'), 'Copy phải có chi tiết tất cả mặt bằng, kể cả READY thiếu cache local');
assert.ok(copyText.includes('Tầng 1 [floor-1] | status READY | pending không | localBinary không'), 'READY nhưng chưa có local binary phải được copy để chẩn đoán offline/load chậm');
assert.ok(copyText.includes('Tầng 2 [floor-2] | status CLOUD_POINTER_INCONSISTENT'), 'Copy phải chỉ rõ tầng có revision/pointer không nhất quán');
assert.ok(copyText.includes('rev 7 | cloud 6 | outbox 0'), 'Copy phải xuất revision để chẩn đoán pending nhưng outbox = 0');
assert.ok(copyText.includes('Tầng 3 [floor-3] | status MISSING_BINARY'), 'Copy phải chỉ rõ mặt bằng thiếu binary');
assert.ok(copyText.includes('ẢNH R2/ẢNH ĐÍNH KÈM CẦN XỬ LÝ (1)'), 'Copy phải tách ảnh đang có vấn đề');
assert.ok(copyText.includes('room/room-orphan | photo photo-2 | cloudReady không | upload pending'), 'Copy phải chỉ rõ entity/photo R2 đang pending');
assert.ok(copyText.includes('RUNTIME LOG GẦN NHẤT (2/2)'), 'Copy phải có runtime log gần nhất');
assert.ok(copyText.includes('WARN | floor-plan | MISSING_BINARY | Floor binary is unavailable locally'), 'Copy phải giữ runtime warning đủ mã và thông điệp');
assert.ok(copyText.includes('[ERROR] ROOM_FLOOR_NOT_FOUND | rooms | MANUAL_REPAIR | room/room-orphan'), 'Audit copy phải có severity/rule/module/action/entity');
assert.ok(copyText.includes('Bảo mật: nội dung copy không xuất password/token/API key/credential'), 'Copy phải ghi rõ nguyên tắc không lộ secret');
const floorRows = XLSX.utils.sheet_to_json<Array<string | number>>(combinedWb.Sheets['Anh mat bang'], { header: 1 });
assert.ok(floorRows.some((row) => row.includes('floor-2') && row.includes('CLOUD_POINTER_INCONSISTENT')), 'Excel phải giữ trạng thái pointer/revision bất thường');
assert.ok(floorRows.some((row) => row.includes('floor-3') && row.includes('MISSING_BINARY')), 'Excel phải giữ trạng thái thiếu binary');

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
