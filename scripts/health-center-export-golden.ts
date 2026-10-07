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
const expectedSheets = ['Tổng quan', 'Tất cả vấn đề', 'Lỗi nghiêm trọng', 'Cảnh báo', 'Cần xác nhận', 'Mồ côi liên kết', 'Quân số', 'Defect', 'Tiến độ Căn / Phòng', 'AI nhận xét'];
for (const sheet of expectedSheets) {
  assert.ok(wb.SheetNames.includes(sheet), `Excel phải có sheet ${sheet}`);
}
const summary = XLSX.utils.sheet_to_json<Array<string | number>>(wb.Sheets['Tổng quan'], { header: 1 });
assert.ok(summary.some((row) => row[0] === 'ID bản kiểm tra' && row[1] === report.auditSnapshotId), 'Excel phải chứa auditSnapshotId');
assert.ok(summary.some((row) => row[0] === 'Độ mới dữ liệu' && row[1] === 'Trực tiếp'), 'Excel phải Việt hóa độ mới dữ liệu');
assert.ok(summary.some((row) => row[0] === 'Phạm vi xuất' && row[1] === 'Tất cả'), 'Excel phải Việt hóa phạm vi xuất');
const allIssues = XLSX.utils.sheet_to_json<Array<string | number>>(wb.Sheets['Tất cả vấn đề'], { header: 1 });
assert.ok(allIssues.some((row) => row.includes('Đội Nguyên') && row.includes('Tầng 3')), 'Excel phải xuất metadata ngày/đội/tầng');
assert.ok(allIssues.some((row) => row.includes('ROOM_FLOOR_NOT_FOUND')), 'Excel phải xuất orphan rule');
const aiRows = XLSX.utils.sheet_to_json<Array<string | number>>(wb.Sheets['AI nhận xét'], { header: 1 });
assert.ok(aiRows.some((row) => row.includes(aiNarrative)), 'AI nhận xét phải nằm ở sheet riêng');

const filteredWb = buildHealthCenterExcelWorkbook({ ...input, scope: 'filtered', issues: [report.issues[1]] });
const filteredRows = XLSX.utils.sheet_to_json<Array<string | number>>(filteredWb.Sheets['Tất cả vấn đề'], { header: 1 });
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
for (const sheet of ['Hệ thống đồng bộ', 'Ảnh R2', 'Ảnh mặt bằng', 'Nhật ký Runtime']) {
  assert.ok(combinedWb.SheetNames.includes(sheet), `Excel tổng hợp phải có sheet ${sheet}`);
}
const systemRows = XLSX.utils.sheet_to_json<Array<string | number>>(combinedWb.Sheets['Hệ thống đồng bộ'], { header: 1 });
assert.ok(systemRows.some((row) => row[0] === 'ID bản dựng' && row[1] === 'golden-build'), 'Excel Health Center phải Việt hóa nhãn buildId');
assert.ok(systemRows.some((row) => row[0] === 'Vai trò' && row[1] === 'ADMIN'), 'Excel Health Center phải Việt hóa nhãn role');
assert.ok(!systemRows.some((row) => row[0] === 'buildId' || row[0] === 'role' || row[0] === 'recordCounts'), 'Excel Health Center không được lộ raw diagnostic key đã có nhãn Việt hóa');
const r2Rows = XLSX.utils.sheet_to_json<Array<string | number>>(combinedWb.Sheets['Ảnh R2'], { header: 1 });
assert.ok(r2Rows.some((row) => row.includes('photo-2') && row.includes('pending')), 'Excel phải chứa ảnh R2 đang pending');
const copyText = buildHealthCenterCopyText(combinedInput);
assert.ok(copyText.includes('KIỂM TRA DỮ LIỆU & LIÊN KẾT'));
assert.ok(copyText.includes('PHIÊN CHẠY / BẢN DỰNG / PHÂN QUYỀN'), 'Copy phải có bản dựng/runtime/quyền');
assert.ok(copyText.includes('Ứng dụng: 6.3.0 | Môi trường: DEV | Nền tảng: Android | Lược đồ: v7'), 'Copy phải có phiên bản/môi trường/nền tảng/lược đồ');
assert.ok(copyText.includes('ID bản dựng: golden-build | Mã commit: golden-commit'), 'Copy phải có ID bản dựng và commit');
assert.ok(copyText.includes('Người dùng: golden@example.com | Vai trò: ADMIN | Đã xác định vai trò: true | Nguồn vai trò: cloud'), 'Copy phải có quyền và nguồn quyền');
assert.ok(copyText.includes('HỆ THỐNG / ĐỒNG BỘ / R2'));
assert.ok(copyText.includes('Firestore: synced | Cloud sẵn sàng: true | Realtime: 9/9 | Dữ liệu chờ: 0'), 'Copy phải có Firestore/realtime/pending');
assert.ok(copyText.includes('Ảnh R2: tổng 2 | đang dùng 2 | sẵn sàng 1 | đang chờ 1'));
assert.ok(copyText.includes('Ảnh mặt bằng: tổng 3 | đang chờ 2 | hàng đợi 0 | byte hàng đợi 0'), 'Copy phải giữ tổng số ảnh mặt bằng đang chờ/hàng đợi');
assert.ok(copyText.includes('Số bản ghi: projects=1 | floors=3 | rooms=2 | defects=1 | crewRecords=1'), 'Copy phải có số bản ghi');
assert.ok(copyText.includes('CHI TIẾT MẶT BẰNG ẢNH (TẤT CẢ)'), 'Copy phải có chi tiết tất cả mặt bằng, kể cả READY thiếu cache local');
assert.ok(copyText.includes('Tầng 1 [floor-1] | trạng thái READY | đang chờ không | dữ liệu ảnh cục bộ không'), 'READY nhưng chưa có dữ liệu ảnh cục bộ phải được copy để chẩn đoán ngoại tuyến/tải chậm');
assert.ok(copyText.includes('Tầng 2 [floor-2] | trạng thái CLOUD_POINTER_INCONSISTENT'), 'Copy phải chỉ rõ tầng có phiên bản/pointer không nhất quán');
assert.ok(copyText.includes('phiên bản 7 | Cloud 6 | hàng đợi 0'), 'Copy phải xuất phiên bản để chẩn đoán đang chờ nhưng hàng đợi = 0');
assert.ok(copyText.includes('Tầng 3 [floor-3] | trạng thái MISSING_BINARY'), 'Copy phải chỉ rõ mặt bằng thiếu binary');
assert.ok(copyText.includes('ẢNH R2/ẢNH ĐÍNH KÈM CẦN XỬ LÝ (1)'), 'Copy phải tách ảnh đang có vấn đề');
assert.ok(copyText.includes('đối tượng room/room-orphan | ảnh photo-2 | Cloud sẵn sàng không | tải lên pending'), 'Copy phải chỉ rõ đối tượng/ảnh R2 đang chờ');
assert.ok(copyText.includes('NHẬT KÝ RUNTIME (THỜI GIAN CHẠY) GẦN NHẤT (2/2)'), 'Copy phải có nhật ký runtime gần nhất');
assert.ok(copyText.includes('WARN | floor-plan | MISSING_BINARY | Floor binary is unavailable locally'), 'Copy phải giữ runtime warning đủ mã và thông điệp');
assert.ok(copyText.includes('[ERROR] ROOM_FLOOR_NOT_FOUND | rooms | MANUAL_REPAIR | room/room-orphan'), 'Audit copy phải có severity/rule/module/action/entity');
assert.ok(copyText.includes('Bảo mật: nội dung sao chép không xuất mật khẩu/token/API key/thông tin xác thực và không chứa dữ liệu ảnh nhị phân thực tế.'), 'Copy phải ghi rõ nguyên tắc không lộ secret');
const oldCopyLabels = [
  'RUNTIME / BUILD / QUYỀN',
  'App:',
  'Env:',
  'Platform:',
  'Schema:',
  'Build ID:',
  'Diagnostic generated:',
  'User:',
  'Role:',
  'Role resolved:',
  'Role source:',
  'Record counts:',
  'Mặt bằng ảnh: total',
  '| status ',
  '| pending ',
  'localBinary',
  'offlineReady',
  'cachedRev',
  'cachedBytes',
  'outboxBytes',
  'uploadState',
  'pendingOwner',
  'cloudSynced',
  'cloudReady',
  'AUDIT DỮ LIỆU & LIÊN KẾT',
  ' | evidence ',
];
for (const oldLabel of oldCopyLabels) {
  assert.equal(copyText.includes(oldLabel), false, `Copy Text không được còn wording cũ: ${oldLabel}`);
}
const floorRows = XLSX.utils.sheet_to_json<Array<string | number>>(combinedWb.Sheets['Ảnh mặt bằng'], { header: 1 });
assert.ok(floorRows.some((row) => row.includes('floor-2') && row.includes('CLOUD_POINTER_INCONSISTENT')), 'Excel phải giữ trạng thái pointer/revision bất thường');
assert.ok(floorRows.some((row) => row.includes('floor-3') && row.includes('MISSING_BINARY')), 'Excel phải giữ trạng thái thiếu binary');

const html = buildHealthCenterHtmlReport(input);
assert.ok(html.includes(report.auditSnapshotId), 'PDF HTML phải hiển thị ID bản kiểm tra');
assert.ok(html.includes('Đội Nguyên'));
assert.ok(html.includes('Tầng 3'));
assert.ok(html.includes('ROOM_FLOOR_NOT_FOUND'));
assert.ok(html.includes('AI nhận xét (không thay thế kết luận HNL)'), 'AI phải được ghi nhãn tách biệt khỏi kiểm tra HNL');
assert.ok(html.includes('<b>Độ mới dữ liệu:</b> Trực tiếp'), 'PDF HTML phải Việt hóa độ mới dữ liệu');
assert.ok(html.includes('<b>Phạm vi:</b> Tất cả'), 'PDF HTML phải Việt hóa phạm vi xuất');
assert.ok(html.includes('<th>Căn / Phòng</th>'), 'PDF HTML phải dùng thuật ngữ Căn / Phòng thống nhất');
assert.ok(html.includes('Dữ liệu mồ côi không được tự động xóa'), 'PDF phải nêu nguyên tắc bảo toàn dữ liệu mồ côi');

console.log('Health Center export golden regression PASS', {
  auditSnapshotId: report.auditSnapshotId,
  sheets: wb.SheetNames.length,
  issues: report.issues.length,
});
