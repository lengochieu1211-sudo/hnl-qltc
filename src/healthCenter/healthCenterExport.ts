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

const ISSUE_HEADER = ['STT', 'Mức', 'Module', 'Rule', 'Cách xử lý', 'Ngày', 'Đội', 'Tầng', 'Căn/phòng', 'Ca', 'Hạng mục/Công việc', 'Loại bản ghi', 'Record ID', 'Mô tả', 'Evidence IDs', 'Chi tiết kỹ thuật'];

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
  addSheet(wb, 'Tong quan', [
    ['HNL Health Center - Hệ thống · Chẩn đoán · Audit dữ liệu'],
    ['Export schema', EXPORT_SCHEMA],
    ['Công trình', input.projectName || '—'],
    ['Project ID', r.projectId],
    ['Audit Snapshot ID', r.auditSnapshotId],
    ['Thời điểm Audit', iso(r.generatedAt)],
    ['Freshness', r.freshness],
    ['Phạm vi xuất', input.scope || 'all'],
    ['Records quét', r.recordsScanned],
    ['Issues xuất', issues.length],
    ['ERROR', r.errorCount],
    ['WARNING', r.warningCount],
    ['REVIEW', r.reviewCount],
    ['SUGGESTION', r.suggestionCount],
    ['Có thể sửa an toàn', r.safeRepairCount],
    ['Cần xác nhận', r.needsConfirmationCount],
    ['Sửa thủ công', r.manualRepairCount],
    ['Lỗi kỹ thuật', r.technicalIssueCount],
    ['Lỗi/cảnh báo nghiệp vụ', r.businessIssueCount],
    ['Nguyên tắc', 'READ + ANALYZE + EXPORT; không tự xóa/sửa dữ liệu mồ côi.'],
  ]);
  addSheet(wb, 'Tat ca van de', [ISSUE_HEADER, ...issueRows(issues)]);
  const groups: Array<[string, HealthCenterIssue[]]> = [
    ['Loi nghiem trong', issues.filter((x) => x.severity === 'ERROR')],
    ['Canh bao', issues.filter((x) => x.severity === 'WARNING')],
    ['Can xac nhan', issues.filter((x) => x.severity === 'REVIEW' || x.actionClass === 'NEEDS_CONFIRMATION')],
    ['Mo coi lien ket', issues.filter((x) => /NOT_FOUND|ORPHAN/i.test(x.ruleId))],
    ['Quan so', issues.filter((x) => x.module === 'crew')],
    ['Defect', issues.filter((x) => x.module === 'defects')],
    ['Tien do Can phong', issues.filter((x) => x.module === 'rooms')],
    ['Kho Dinh muc', issues.filter((x) => x.module === 'inventory' || x.module === 'materialNorms')],
    ['Checklist', issues.filter((x) => x.module === 'checklist')],
    ['Ky thuat Sync', issues.filter((x) => ['system', 'firebase', 'r2', 'sync'].includes(x.module))],
  ];
  for (const [name, group] of groups) {
    if (group.length) addSheet(wb, name, [ISSUE_HEADER, ...issueRows(group)]);
  }
  addSheet(wb, 'AI nhan xet', [
    ['Audit Snapshot ID', r.auditSnapshotId],
    ['Ghi chú', 'Phần này chỉ chứa diễn giải AI nếu người dùng chủ động yêu cầu; kết luận HNL nằm ở các sheet Audit.'],
    ['AI nhận xét', input.aiNarrative || 'Chưa yêu cầu AI phân tích.'],
  ]);

  if (input.systemDiagnostics) {
    const d = input.systemDiagnostics as Record<string, any>;
    const systemRows: Array<Array<string | number>> = [['Trường', 'Giá trị']];
    for (const [key, value] of Object.entries(d)) {
      if (['photoDiagnostics', 'floorPlanDiagnostics', 'runtimeLog'].includes(key)) continue;
      systemRows.push([key, typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')]);
    }
    addSheet(wb, 'He thong dong bo', systemRows);

    const photos = Array.isArray(d.photoDiagnostics?.photos) ? d.photoDiagnostics.photos : [];
    const photoHeader = ['STT', 'Photo ID', 'Entity type', 'Entity ID', 'Storage', 'Cloud ready', 'Upload state', 'Deleted', 'Local binary', 'Bytes', 'Checksum', 'Storage path'];
    addSheet(wb, 'Anh R2', [photoHeader, ...photos.map((photo: any, index: number) => [
      index + 1, String(photo?.id || ''), String(photo?.entityType || ''), String(photo?.entityId || ''),
      String(photo?.storageProvider || ''), String(photo?.cloudReady ?? ''), String(photo?.binaryUploadState || ''),
      String(photo?.deleted ?? false), String(photo?.localBinary ?? false), Number(photo?.bytes || photo?.fileSize || 0),
      String(photo?.checksumPrefix || photo?.sha256 || ''), String(photo?.storagePath || ''),
    ])]);

    const floors = Array.isArray(d.floorPlanDiagnostics?.floors) ? d.floorPlanDiagnostics.floors : [];
    const floorHeader = ['STT', 'Floor ID', 'Tầng', 'Trạng thái', 'Pending', 'Revision', 'Cloud revision', 'Outbox revision', 'Storage', 'Storage path'];
    addSheet(wb, 'Anh mat bang', [floorHeader, ...floors.map((floor: any, index: number) => [
      index + 1, String(floor?.id || ''), String(floor?.floorName || ''), String(floor?.status || ''), String(floor?.pending ?? false),
      Number(floor?.effectiveImageRevision || floor?.imageRevision || 0), Number(floor?.imageCloudRevision || 0), Number(floor?.outboxRevision || 0),
      String(floor?.storageProvider || ''), String(floor?.storagePath || ''),
    ])]);

    const runtimeLog = Array.isArray(d.runtimeLog) ? d.runtimeLog : [];
    addSheet(wb, 'Runtime log', [['STT', 'Thời điểm', 'Mức', 'Khu vực', 'Mã', 'Project', 'Nội dung'], ...runtimeLog.map((row: any, index: number) => [
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
  const lines = [
    'HNL HEALTH CENTER - CHẨN ĐOÁN TỔNG HỢP',
    `Công trình: ${input.projectName || '—'}`,
    `Project ID: ${r.projectId}`,
    `Audit Snapshot ID: ${r.auditSnapshotId}`,
    `Audit: ERROR ${r.errorCount} | WARNING ${r.warningCount} | Cần xác nhận ${r.needsConfirmationCount} | Safe repair ${r.safeRepairCount}`,
    `Records quét: ${r.recordsScanned} | Issues đang xuất: ${issues.length}`,
    '',
    'HỆ THỐNG / ĐỒNG BỘ / R2',
    `Firestore: ${String(d.dataCloudPhase || '—')} | Realtime: ${String(d.snapshotReadyCount ?? '—')}/9 | Pending data: ${String(d.pendingData ?? '—')}`,
    `Ảnh R2: active ${String(photoDiagnostics.active ?? '—')} | ready ${String(photoDiagnostics.ready ?? '—')} | pending ${String(photoDiagnostics.pending ?? '—')}`,
    `Mặt bằng ảnh: total ${String(floorPlanDiagnostics.total ?? '—')} | pending ${String(floorPlanDiagnostics.pending ?? '—')} | outbox ${String(floorPlanDiagnostics.outboxCount ?? '—')}`,
    `Mạng: ${String(d.online ?? '—')} | Sync cuối: ${d.lastSyncAt ? iso(Number(d.lastSyncAt)) : '—'} | Lỗi sync: ${String(d.lastSyncError || 'Không')}`,
    '',
    'AUDIT DỮ LIỆU & LIÊN KẾT',
    ...issues.map((issue, index) => `${index + 1}. [${issue.severity}] ${issue.ruleId} | ${issue.location.floorName || ''} ${issue.location.roomName || ''} ${issue.location.workItem || ''} | ${issue.message}`),
    '',
    'Nguyên tắc: không tự xóa dữ liệu mồ côi; AI/vật tư bỏ qua liên kết đã xóa cho đến khi ADMIN xác nhận xử lý.',
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
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HNL Health Center</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,"Segoe UI",sans-serif;color:#0f172a;font-size:9px;line-height:1.4}h1{font-size:18px;margin:0}.sub{color:#64748b;margin:3px 0 12px}.summary{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.pill{border:1px solid #cbd5e1;border-radius:8px;padding:5px 8px}.meta{margin:8px 0;padding:8px;background:#f8fafc;border:1px solid #e2e8f0}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #cbd5e1;padding:4px;vertical-align:top}th{background:#f1f5f9}tr{page-break-inside:avoid}.ai{margin-top:14px;padding:8px;border-left:3px solid #6366f1;background:#eef2ff;white-space:pre-wrap}.footer{margin-top:12px;color:#64748b;border-top:1px solid #cbd5e1;padding-top:6px}</style></head><body><h1>HNL Health Center</h1><div class="sub">Hệ thống · Chẩn đoán · Audit dữ liệu</div><div class="meta"><b>Công trình:</b> ${esc(input.projectName || '—')} &nbsp; <b>Project:</b> ${esc(r.projectId)}<br><b>Audit Snapshot ID:</b> ${esc(r.auditSnapshotId)}<br><b>Thời điểm:</b> ${esc(iso(r.generatedAt))} · <b>Freshness:</b> ${esc(r.freshness)} · <b>Records quét:</b> ${r.recordsScanned} · <b>Phạm vi:</b> ${esc(input.scope || 'all')}</div><div class="summary"><span class="pill">ERROR <b>${r.errorCount}</b></span><span class="pill">WARNING <b>${r.warningCount}</b></span><span class="pill">REVIEW <b>${r.reviewCount}</b></span><span class="pill">Có thể sửa an toàn <b>${r.safeRepairCount}</b></span><span class="pill">Cần xác nhận <b>${r.needsConfirmationCount}</b></span><span class="pill">Sửa thủ công <b>${r.manualRepairCount}</b></span></div><table><thead><tr><th>#</th><th>Mức</th><th>Ngày</th><th>Đội</th><th>Tầng</th><th>Căn</th><th>Hạng mục</th><th>Rule</th><th>Mô tả</th></tr></thead><tbody>${rows || '<tr><td colspan="9">Không có vấn đề trong phạm vi đang xuất.</td></tr>'}</tbody></table>${input.aiNarrative ? `<div class="ai"><b>AI nhận xét (không thay thế kết luận HNL)</b><br>${esc(input.aiNarrative)}</div>` : ''}<div class="footer">${esc(EXPORT_SCHEMA)} · READ + ANALYZE + EXPORT ONLY · Dữ liệu mồ côi không được tự động xóa.</div></body></html>`;
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
