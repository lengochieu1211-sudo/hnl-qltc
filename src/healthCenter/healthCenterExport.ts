import * as XLSX from 'xlsx';
import { saveHtmlPdf, saveTextFileToDownloads, saveWorkbookFile } from '../utils/fileExport';
import type { HealthCenterIssue, HealthCenterSummary } from './healthCenterEngine';
import { serializeHealthCenterReportJson } from './healthCenterEngine';

export type HealthCenterExportScope = 'all' | 'filtered';

export interface HealthCenterExportInput {
  report: HealthCenterSummary;
  projectName?: string;
  issues?: HealthCenterIssue[];
  scope?: HealthCenterExportScope;
  aiNarrative?: string;
  systemDiagnostics?: Record<string, unknown> | null;
}

const EXPORT_SCHEMA = 'HNL-QLTC-HEALTH-CENTER-EXPORT-V1';

function safeStem(value: string): string {
  return String(value || 'HNL_QLTC')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70) || 'HNL_QLTC';
}

function iso(value: number): string {
  return Number.isFinite(value) ? new Date(value).toISOString() : '—';
}

function selectedIssues(input: HealthCenterExportInput): HealthCenterIssue[] {
  return input.scope === 'filtered' && Array.isArray(input.issues) ? input.issues : input.report.issues;
}

function exportScopeLabel(scope?: HealthCenterExportScope): string {
  return scope === 'filtered' ? 'Theo bộ lọc' : 'Tất cả';
}

function freshnessLabel(value: HealthCenterSummary['freshness']): string {
  if (value === 'live') return 'Trực tiếp';
  if (value === 'cache') return 'Bộ nhớ đệm';
  if (value === 'fixture') return 'Dữ liệu kiểm thử';
  return String(value || '—');
}

const SYSTEM_DIAGNOSTIC_LABELS: Record<string, string> = {
  appVersion: 'Phiên bản ứng dụng',
  environment: 'Môi trường',
  platform: 'Nền tảng',
  dataSchemaVersion: 'Phiên bản lược đồ dữ liệu',
  buildId: 'ID bản dựng',
  gitCommit: 'Mã commit',
  buildTime: 'Thời điểm bản dựng',
  generatedAt: 'Thời điểm tạo chẩn đoán',
  firebaseUserEmail: 'Người dùng Firebase',
  role: 'Vai trò',
  roleResolved: 'Đã xác định vai trò',
  roleSource: 'Nguồn vai trò',
  userAgent: 'Nhận diện thiết bị/trình duyệt',
  dataCloudPhase: 'Trạng thái dữ liệu Cloud',
  cloudInitialReady: 'Cloud sẵn sàng ban đầu',
  snapshotReadyCount: 'Số luồng realtime sẵn sàng',
  pendingData: 'Dữ liệu đang chờ',
  photoPhase: 'Trạng thái đồng bộ ảnh',
  photoPending: 'Ảnh đang chờ',
  pendingDriveUploads: 'Lượt tải lên Drive đang chờ',
  driveSyncStatus: 'Trạng thái đồng bộ Drive',
  online: 'Trực tuyến',
  lastSyncAt: 'Lần đồng bộ cuối',
  lastSyncError: 'Lỗi đồng bộ gần nhất',
  duplicateProjectIds: 'ID dự án trùng tên khác ID',
  recordCounts: 'Số bản ghi',
};

function systemDiagnosticLabel(key: string): string {
  return SYSTEM_DIAGNOSTIC_LABELS[key] || key;
}

function autoFit(ws: XLSX.WorkSheet): void {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  ws['!cols'] = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    let width = 10;
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell?.v !== undefined && cell?.v !== null) width = Math.max(width, String(cell.v).length + 2);
    }
    ws['!cols'][c] = { wch: Math.min(70, Math.max(12, width)) };
  }
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  ws['!autofilter'] = { ref: ws['!ref'] };
}

function addSheet(wb: XLSX.WorkBook, name: string, rows: Array<Array<string | number>>): void {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  autoFit(ws);
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

function issueRows(issues: HealthCenterIssue[]): Array<Array<string | number>> {
  return issues.map((issue, index) => [
    index + 1,
    issue.severity,
    issue.module,
    issue.ruleId,
    issue.actionClass,
    issue.location.date || '',
    issue.location.teamName || '',
    issue.location.floorName || '',
    issue.location.roomName || '',
    issue.location.shift || '',
    issue.location.workItem || '',
    issue.entityType,
    issue.entityId,
    issue.message,
    issue.evidenceIds.join(', '),
    JSON.stringify(issue.details || {}),
  ]);
}

const ISSUE_HEADER = ['STT', 'Mức', 'Phân hệ', 'Quy tắc', 'Cách xử lý', 'Ngày', 'Đội', 'Tầng', 'Căn / Phòng', 'Ca', 'Hạng mục / Công việc', 'Loại bản ghi', 'ID bản ghi', 'Mô tả', 'ID bằng chứng', 'Chi tiết kỹ thuật'];

export function buildHealthCenterFileStem(input: HealthCenterExportInput): string {
  const stamp = new Date(input.report.generatedAt || Date.now()).toISOString().replace(/[:.]/g, '-');
  return `HNL_HEALTH_CENTER_${safeStem(input.projectName || input.report.projectId)}_${stamp}`;
}

export function buildHealthCenterJson(input: HealthCenterExportInput): string {
  const issues = selectedIssues(input);
  if ((input.scope || 'all') === 'all' && !input.aiNarrative && !input.systemDiagnostics) return serializeHealthCenterReportJson(input.report);
  return JSON.stringify({
    format: 'HNL-QLTC-HEALTH-CENTER',
    schemaVersion: 1,
    exportSchema: EXPORT_SCHEMA,
    exportScope: input.scope || 'all',
    auditSnapshotId: input.report.auditSnapshotId,
    projectId: input.report.projectId,
    projectName: input.projectName || '',
    generatedAt: input.report.generatedAt,
    freshness: input.report.freshness,
    recordsScanned: input.report.recordsScanned,
    exportedIssueCount: issues.length,
    issues,
    aiNarrative: input.aiNarrative || '',
    systemDiagnostics: input.systemDiagnostics || null,
  }, null, 2);
}

export function buildHealthCenterExcelWorkbook(input: HealthCenterExportInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const issues = selectedIssues(input);
  const r = input.report;
  addSheet(wb, 'Tổng quan', [
    ['HNL - Trung tâm kiểm tra dữ liệu (Health Center) · Hệ thống · Chẩn đoán · Kiểm tra dữ liệu'],
    ['Phiên bản xuất', EXPORT_SCHEMA],
    ['Công trình', input.projectName || '—'],
    ['ID dự án', r.projectId],
    ['ID bản kiểm tra', r.auditSnapshotId],
    ['Thời điểm kiểm tra', iso(r.generatedAt)],
    ['Độ mới dữ liệu', freshnessLabel(r.freshness)],
    ['Phạm vi xuất', exportScopeLabel(input.scope)],
    ['Bản ghi quét', r.recordsScanned],
    ['Vấn đề xuất', issues.length],
    ['LỖI', r.errorCount],
    ['CẢNH BÁO', r.warningCount],
    ['CẦN XEM', r.reviewCount],
    ['ĐỀ XUẤT', r.suggestionCount],
    ['Có thể sửa an toàn', r.safeRepairCount],
    ['Cần xác nhận', r.needsConfirmationCount],
    ['Sửa thủ công', r.manualRepairCount],
    ['Lỗi kỹ thuật', r.technicalIssueCount],
    ['Lỗi/cảnh báo nghiệp vụ', r.businessIssueCount],
    ['Nguyên tắc', 'Chỉ đọc, phân tích và xuất báo cáo; không tự xóa/sửa dữ liệu mồ côi.'],
  ]);
  addSheet(wb, 'Tất cả vấn đề', [ISSUE_HEADER, ...issueRows(issues)]);
  const groups: Array<[string, HealthCenterIssue[]]> = [
    ['Lỗi nghiêm trọng', issues.filter((x) => x.severity === 'ERROR')],
    ['Cảnh báo', issues.filter((x) => x.severity === 'WARNING')],
    ['Cần xác nhận', issues.filter((x) => x.severity === 'REVIEW' || x.actionClass === 'NEEDS_CONFIRMATION')],
    ['Mồ côi liên kết', issues.filter((x) => /NOT_FOUND|ORPHAN/i.test(x.ruleId))],
    ['Quân số', issues.filter((x) => x.module === 'crew')],
    ['Defect', issues.filter((x) => x.module === 'defects')],
    ['Tiến độ Căn / Phòng', issues.filter((x) => x.module === 'rooms')],
    ['Kho / Định mức', issues.filter((x) => x.module === 'inventory' || x.module === 'materialNorms')],
    ['Checklist', issues.filter((x) => x.module === 'checklist')],
    ['Kỹ thuật đồng bộ', issues.filter((x) => ['system', 'firebase', 'r2', 'sync'].includes(x.module))],
  ];
  for (const [name, group] of groups) {
    if (group.length) addSheet(wb, name, [ISSUE_HEADER, ...issueRows(group)]);
  }
  addSheet(wb, 'AI nhận xét', [
    ['ID bản kiểm tra', r.auditSnapshotId],
    ['Ghi chú', 'Phần này chỉ chứa diễn giải AI nếu người dùng chủ động yêu cầu; kết luận HNL nằm ở các sheet kiểm tra.'],
    ['AI nhận xét', input.aiNarrative || 'Chưa yêu cầu AI phân tích.'],
  ]);

  if (input.systemDiagnostics) {
    const d = input.systemDiagnostics as Record<string, any>;
    const systemRows: Array<Array<string | number>> = [['Trường', 'Giá trị']];
    for (const [key, value] of Object.entries(d)) {
      if (['photoDiagnostics', 'floorPlanDiagnostics', 'runtimeLog'].includes(key)) continue;
      systemRows.push([systemDiagnosticLabel(key), typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')]);
    }
    addSheet(wb, 'Hệ thống đồng bộ', systemRows);

    const photos = Array.isArray(d.photoDiagnostics?.photos) ? d.photoDiagnostics.photos : [];
    const photoHeader = ['STT', 'ID ảnh', 'Loại đối tượng', 'ID đối tượng', 'Lưu trữ', 'Cloud sẵn sàng', 'Trạng thái tải lên', 'Đã xóa', 'Dữ liệu ảnh trên máy', 'Dung lượng (byte)', 'Checksum', 'Đường dẫn lưu trữ'];
    addSheet(wb, 'Ảnh R2', [photoHeader, ...photos.map((photo: any, index: number) => [
      index + 1, String(photo?.id || ''), String(photo?.entityType || ''), String(photo?.entityId || ''),
      String(photo?.storageProvider || ''), String(photo?.cloudReady ?? ''), String(photo?.binaryUploadState || ''),
      String(photo?.deleted ?? false), String(photo?.localBinary ?? false), Number(photo?.bytes || photo?.fileSize || 0),
      String(photo?.checksumPrefix || photo?.sha256 || ''), String(photo?.storagePath || ''),
    ])]);

    const floors = Array.isArray(d.floorPlanDiagnostics?.floors) ? d.floorPlanDiagnostics.floors : [];
    const floorHeader = ['STT', 'ID tầng', 'Tầng', 'Trạng thái', 'Đang chờ', 'Phiên bản', 'Phiên bản Cloud', 'Phiên bản hàng đợi', 'Lưu trữ', 'Đường dẫn lưu trữ'];
    addSheet(wb, 'Ảnh mặt bằng', [floorHeader, ...floors.map((floor: any, index: number) => [
      index + 1, String(floor?.id || ''), String(floor?.floorName || ''), String(floor?.status || ''), String(floor?.pending ?? false),
      Number(floor?.effectiveImageRevision || floor?.imageRevision || 0), Number(floor?.imageCloudRevision || 0), Number(floor?.outboxRevision || 0),
      String(floor?.storageProvider || ''), String(floor?.storagePath || ''),
    ])]);

    const runtimeLog = Array.isArray(d.runtimeLog) ? d.runtimeLog : [];
    addSheet(wb, 'Nhật ký chạy', [['STT', 'Thời điểm', 'Mức', 'Khu vực', 'Mã', 'Dự án', 'Nội dung'], ...runtimeLog.map((row: any, index: number) => [
      index + 1, row?.at ? iso(Number(row.at)) : '', String(row?.level || ''), String(row?.area || ''), String(row?.code || ''), String(row?.projectId || ''), String(row?.message || ''),
    ])]);
  }
  return wb;
}

export function buildHealthCenterCopyText(input: HealthCenterExportInput): string {
  const issues = selectedIssues(input);
  const r = input.report;
  const d = (input.systemDiagnostics || {}) as Record<string, any>;
  const photoDiagnostics = d.photoDiagnostics || {};
  const floorPlanDiagnostics = d.floorPlanDiagnostics || {};
  const floorPlanRows = Array.isArray(floorPlanDiagnostics.floors) ? floorPlanDiagnostics.floors : [];
  const photoRows = Array.isArray(photoDiagnostics.photos) ? photoDiagnostics.photos : [];
  const runtimeRows = Array.isArray(d.runtimeLog) ? d.runtimeLog : [];
  const recordCounts = d.recordCounts && typeof d.recordCounts === 'object' ? d.recordCounts as Record<string, unknown> : {};
  const duplicateProjectIds = Array.isArray(d.duplicateProjectIds) ? d.duplicateProjectIds : [];

  const floorPlanDetailLines = floorPlanRows.map((floor: any) => {
    const storageProvider = String(floor?.storageProvider || '').trim();
    const storagePath = String(floor?.storagePath || '').trim();
    const storage = storageProvider || storagePath ? `${storageProvider || 'storage'}${storagePath ? `:${storagePath}` : ''}` : '—';
    return `- ${String(floor?.floorName || 'Không rõ tầng')} [${String(floor?.id || 'no-id')}] | trạng thái ${String(floor?.status || 'UNKNOWN')} | đang chờ ${floor?.pending ? 'có' : 'không'} | dữ liệu ảnh cục bộ ${floor?.localBinary ? 'có' : 'không'} | sẵn sàng ngoại tuyến ${floor?.offlineReady ? 'có' : 'không'} | phiên bản bộ nhớ đệm ${Number(floor?.cachedRevision || 0)} | byte bộ nhớ đệm ${Number(floor?.cachedBytes || 0)} | phiên bản ${Number(floor?.effectiveImageRevision || floor?.imageRevision || 0)} | Cloud ${Number(floor?.imageCloudRevision || 0)} | hàng đợi ${Number(floor?.outboxRevision || 0)} | byte hàng đợi ${Number(floor?.outboxBytes || 0)} | trạng thái tải lên ${String(floor?.imageUploadState || '—')} | có chủ nhân chờ ${String(floor?.imagePendingByUid || '').trim() ? 'có' : 'không'} | đã đồng bộ Cloud ${floor?.imageCloudSyncedAt ? iso(Number(floor.imageCloudSyncedAt)) : '—'} | lưu trữ ${storage}`;
  });

  const photoIssueRows = photoRows.filter((photo: any) => !photo?.deleted && (
    photo?.cloudReady !== true ||
    String(photo?.binaryUploadState || '').toLowerCase() !== 'ready' ||
    (String(photo?.storageProvider || '') === 'firestore-fallback' && !photo?.localBinary)
  ));
  const photoIssueLines = photoIssueRows.slice(0, 50).map((photo: any) => {
    const storageProvider = String(photo?.storageProvider || '').trim();
    const storagePath = String(photo?.storagePath || '').trim();
    const storage = storageProvider || storagePath ? `${storageProvider || 'storage'}${storagePath ? `:${storagePath}` : ''}` : '—';
    return `- đối tượng ${String(photo?.entityType || 'unknown')}/${String(photo?.entityId || 'unknown')} | ảnh ${String(photo?.id || 'no-id')} | Cloud sẵn sàng ${photo?.cloudReady === true ? 'có' : 'không'} | tải lên ${String(photo?.binaryUploadState || 'unknown')} | dữ liệu ảnh cục bộ ${photo?.localBinary ? 'có' : 'không'} | byte ${Number(photo?.bytes || photo?.fileSize || 0)} | lưu trữ ${storage}`;
  });

  const runtimeLines = runtimeRows.slice(-30).map((row: any) =>
    `- ${row?.at ? iso(Number(row.at)) : '—'} | ${String(row?.level || 'info').toUpperCase()} | ${String(row?.area || 'runtime')} | ${String(row?.code || '—')} | ${String(row?.message || '')}`
  );
  const recordCountLine = Object.entries(recordCounts).map(([key, value]) => `${key}=${String(value ?? 0)}`).join(' | ') || '—';

  const lines = [
    'HNL HEALTH CENTER - CHẨN ĐOÁN TỔNG HỢP',
    `Công trình: ${input.projectName || '—'}`,
    `ID dự án: ${r.projectId}`,
    `ID bản kiểm tra: ${r.auditSnapshotId}`,
    `Kiểm tra lúc: ${iso(r.generatedAt)} | Độ mới dữ liệu: ${freshnessLabel(r.freshness)}`,
    `Kiểm tra: LỖI ${r.errorCount} | CẢNH BÁO ${r.warningCount} | CẦN XEM ${r.reviewCount} | Cần xác nhận ${r.needsConfirmationCount} | Có thể sửa an toàn ${r.safeRepairCount} | Sửa thủ công ${r.manualRepairCount}`,
    `Bản ghi quét: ${r.recordsScanned} | Vấn đề đang xuất: ${issues.length}`,
    '',
    'PHIÊN CHẠY / BẢN DỰNG / PHÂN QUYỀN',
    `Ứng dụng: ${String(d.appVersion || '—')} | Môi trường: ${String(d.environment || '—')} | Nền tảng: ${String(d.platform || '—')} | Lược đồ: v${String(d.dataSchemaVersion ?? '—')}`,
    `ID bản dựng: ${String(d.buildId || '—')} | Mã commit: ${String(d.gitCommit || '—')} | Thời điểm bản dựng: ${String(d.buildTime || '—')}`,
    `Chẩn đoán tạo lúc: ${String(d.generatedAt || '—')}`,
    `Người dùng: ${String(d.firebaseUserEmail || '—')} | Vai trò: ${String(d.role || '—')} | Đã xác định vai trò: ${String(d.roleResolved ?? '—')} | Nguồn vai trò: ${String(d.roleSource || '—')}`,
    `Nhận diện thiết bị/trình duyệt: ${String(d.userAgent || '—')}`,
    '',
    'HỆ THỐNG / ĐỒNG BỘ / R2',
    `Firestore: ${String(d.dataCloudPhase || '—')} | Cloud sẵn sàng: ${String(d.cloudInitialReady ?? '—')} | Realtime: ${String(d.snapshotReadyCount ?? '—')}/9 | Dữ liệu chờ: ${String(d.pendingData ?? '—')}`,
    `Đồng bộ ảnh: trạng thái ${String(d.photoPhase || '—')} | đang chờ ${String(d.photoPending ?? '—')} | tổng lượt tải lên chờ ${String(d.pendingDriveUploads ?? '—')}`,
    `Ảnh R2: tổng ${String(photoDiagnostics.total ?? '—')} | đang dùng ${String(photoDiagnostics.active ?? '—')} | sẵn sàng ${String(photoDiagnostics.ready ?? '—')} | đang chờ ${String(photoDiagnostics.pending ?? '—')}`,
    `Ảnh mặt bằng: tổng ${String(floorPlanDiagnostics.total ?? '—')} | đang chờ ${String(floorPlanDiagnostics.pending ?? '—')} | hàng đợi ${String(floorPlanDiagnostics.outboxCount ?? '—')} | byte hàng đợi ${String(floorPlanDiagnostics.outboxBytes ?? '—')} | sẵn sàng ngoại tuyến ${String(floorPlanDiagnostics.offlineReady ?? '—')}/${String(floorPlanDiagnostics.offlineEligible ?? '—')} | bộ nhớ đệm ${String(floorPlanDiagnostics.cacheCount ?? '—')} phiên bản / ${String(floorPlanDiagnostics.cacheBytes ?? '—')} byte`,
    `Đồng bộ Drive: ${String(d.driveSyncStatus || '—')} | Trạng thái mạng: ${String(d.online ?? '—')} | Đồng bộ cuối: ${d.lastSyncAt ? iso(Number(d.lastSyncAt)) : '—'}`,
    `Lỗi đồng bộ gần nhất: ${String(d.lastSyncError || 'Không')}`,
    `ID dự án trùng tên nhưng khác ID: ${duplicateProjectIds.length ? duplicateProjectIds.join(', ') : 'Không'}`,
    `Số bản ghi: ${recordCountLine}`,
    ...(floorPlanDetailLines.length > 0 ? ['', 'CHI TIẾT MẶT BẰNG ẢNH (TẤT CẢ)', ...floorPlanDetailLines] : []),
    ...(photoIssueLines.length > 0 ? ['', `ẢNH R2/ẢNH ĐÍNH KÈM CẦN XỬ LÝ (${photoIssueRows.length})`, ...photoIssueLines, ...(photoIssueRows.length > photoIssueLines.length ? [`- ... còn ${photoIssueRows.length - photoIssueLines.length} ảnh chưa liệt kê`] : [])] : ['', 'ẢNH R2/ẢNH ĐÍNH KÈM CẦN XỬ LÝ: Không']),
    ...(runtimeLines.length > 0 ? ['', `NHẬT KÝ RUNTIME (THỜI GIAN CHẠY) GẦN NHẤT (${Math.min(runtimeRows.length, 30)}/${runtimeRows.length})`, ...runtimeLines] : ['', 'NHẬT KÝ RUNTIME (THỜI GIAN CHẠY) GẦN NHẤT: Không có']),
    '',
    'KIỂM TRA DỮ LIỆU & LIÊN KẾT',
    ...issues.map((issue, index) => {
      const location = [issue.location.date, issue.location.teamName, issue.location.floorName, issue.location.roomName, issue.location.shift, issue.location.workItem].filter(Boolean).join(' · ');
      const evidence = issue.evidenceIds?.length ? issue.evidenceIds.join(',') : '—';
      return `${index + 1}. [${issue.severity}] ${issue.ruleId} | ${issue.module} | ${issue.actionClass} | ${issue.entityType}/${issue.entityId} | ${location || '—'} | ${issue.message} | bằng chứng ${evidence}`;
    }),
    '',
    'Nguyên tắc: không tự xóa dữ liệu mồ côi; AI/vật tư bỏ qua liên kết đã xóa cho đến khi ADMIN xác nhận xử lý.',
    'Bảo mật: nội dung sao chép không xuất mật khẩu/token/API key/thông tin xác thực và không chứa dữ liệu ảnh nhị phân thực tế.',
  ];
  return lines.join('\n');
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function buildHealthCenterHtmlReport(input: HealthCenterExportInput): string {
  const r = input.report;
  const issues = selectedIssues(input);
  const rows = issues.map((issue, index) => `<tr><td>${index + 1}</td><td>${esc(issue.severity)}</td><td>${esc(issue.location.date || '')}</td><td>${esc(issue.location.teamName || '')}</td><td>${esc(issue.location.floorName || '')}</td><td>${esc(issue.location.roomName || '')}</td><td>${esc(issue.location.workItem || '')}</td><td>${esc(issue.ruleId)}</td><td>${esc(issue.message)}</td></tr>`).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HNL - Trung tâm kiểm tra dữ liệu (Health Center)</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,"Segoe UI",sans-serif;color:#0f172a;font-size:9px;line-height:1.4}h1{font-size:18px;margin:0}.sub{color:#64748b;margin:3px 0 12px}.summary{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.pill{border:1px solid #cbd5e1;border-radius:8px;padding:5px 8px}.meta{margin:8px 0;padding:8px;background:#f8fafc;border:1px solid #e2e8f0}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #cbd5e1;padding:4px;vertical-align:top}th{background:#f1f5f9}tr{page-break-inside:avoid}.ai{margin-top:14px;padding:8px;border-left:3px solid #3b82f6;background:#eff6ff;white-space:pre-wrap}.footer{margin-top:12px;color:#64748b;border-top:1px solid #cbd5e1;padding-top:6px}</style></head><body><h1>HNL - Trung tâm kiểm tra dữ liệu (Health Center)</h1><div class="sub">Hệ thống · Chẩn đoán · Kiểm tra dữ liệu</div><div class="meta"><b>Công trình:</b> ${esc(input.projectName || '—')} &nbsp; <b>ID dự án:</b> ${esc(r.projectId)}<br><b>ID bản kiểm tra:</b> ${esc(r.auditSnapshotId)}<br><b>Thời điểm:</b> ${esc(iso(r.generatedAt))} · <b>Độ mới dữ liệu:</b> ${esc(freshnessLabel(r.freshness))} · <b>Bản ghi quét:</b> ${r.recordsScanned} · <b>Phạm vi:</b> ${esc(exportScopeLabel(input.scope))}</div><div class="summary"><span class="pill">LỖI <b>${r.errorCount}</b></span><span class="pill">CẢNH BÁO <b>${r.warningCount}</b></span><span class="pill">CẦN XEM <b>${r.reviewCount}</b></span><span class="pill">Có thể sửa an toàn <b>${r.safeRepairCount}</b></span><span class="pill">Cần xác nhận <b>${r.needsConfirmationCount}</b></span><span class="pill">Sửa thủ công <b>${r.manualRepairCount}</b></span></div><table><thead><tr><th>#</th><th>Mức</th><th>Ngày</th><th>Đội</th><th>Tầng</th><th>Căn / Phòng</th><th>Hạng mục</th><th>Quy tắc</th><th>Mô tả</th></tr></thead><tbody>${rows || '<tr><td colspan="9">Không có vấn đề trong phạm vi đang xuất.</td></tr>'}</tbody></table>${input.aiNarrative ? `<div class="ai"><b>AI nhận xét (không thay thế kết luận HNL)</b><br>${esc(input.aiNarrative)}</div>` : ''}<div class="footer">${esc(EXPORT_SCHEMA)} · Chỉ đọc, phân tích và xuất báo cáo · Dữ liệu mồ côi không được tự động xóa.</div></body></html>`;
}

export async function exportHealthCenterJson(input: HealthCenterExportInput): Promise<void> {
  await saveTextFileToDownloads(buildHealthCenterJson(input), `${buildHealthCenterFileStem(input)}.json`, 'application/json;charset=utf-8');
}

export async function exportHealthCenterExcel(input: HealthCenterExportInput): Promise<void> {
  await saveWorkbookFile(buildHealthCenterExcelWorkbook(input), `${buildHealthCenterFileStem(input)}.xlsx`);
}

export async function exportHealthCenterPdf(input: HealthCenterExportInput): Promise<'android' | 'browser-print'> {
  const html = buildHealthCenterHtmlReport(input);
  const fileName = `${buildHealthCenterFileStem(input)}.pdf`;
  if (saveHtmlPdf(html, fileName)) return 'android';
  if (typeof window === 'undefined') throw new Error('PDF_BROWSER_UNAVAILABLE');
  const printWindow = window.open('', '_blank', 'width=1200,height=850');
  if (!printWindow) throw new Error('Trình duyệt đang chặn cửa sổ xuất PDF. Hãy cho phép pop-up rồi thử lại.');
  try { printWindow.opener = null; } catch { /* ignore */ }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 300);
  return 'browser-print';
}
