import * as XLSX from 'xlsx';
import { saveHtmlPdf, saveWorkbookFile } from '../../utils/fileExport';
import type { AiAuditSummary, AiToolResult } from '../core/contracts';
import type { HnlAiOrchestratorResult } from '../orchestrator/aiOrchestrator';

export interface HnlAiReportExportInput {
  projectId: string;
  projectName: string;
  question: string;
  mode: string;
  result: HnlAiOrchestratorResult;
  generatedAt?: number;
}

const REPORT_VERSION = 'hnl-ai-report-v1';

function isAuditSummary(value: unknown): value is AiAuditSummary {
  const candidate = value as AiAuditSummary | null;
  return Boolean(
    candidate
    && Array.isArray(candidate.issues)
    && typeof candidate.errorCount === 'number'
    && typeof candidate.warningCount === 'number'
    && typeof candidate.reviewCount === 'number',
  );
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function displayValue(value: unknown): string | number | boolean {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
}

function isoDate(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return '—';
  try {
    return new Date(value).toISOString();
  } catch {
    return '—';
  }
}

function autoFitColumns(ws: XLSX.WorkSheet): void {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const cols: Array<{ wch: number }> = [];
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    let width = 10;
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell?.v !== undefined && cell?.v !== null) width = Math.max(width, String(cell.v).length + 2);
    }
    cols[col] = { wch: Math.min(70, Math.max(12, width)) };
  }
  ws['!cols'] = cols;
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
}

function appendSheet(wb: XLSX.WorkBook, name: string, rows: Array<Array<string | number | boolean>>): void {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, name);
}

function reportWarnings(toolResult: AiToolResult<unknown>): string[] {
  return Array.from(new Set([
    ...toolResult.warnings,
    ...toolResult.assumptions.map((item) => `Giả định: ${item}`),
  ].filter(Boolean)));
}

export function buildHnlAiReportFileStem(input: HnlAiReportExportInput): string {
  const safeProject = String(input.projectName || 'HNL_QLTC')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70) || 'HNL_QLTC';
  const stamp = new Date(input.generatedAt || Date.now()).toISOString().replace(/[:.]/g, '-');
  return `HNL_AI_${safeProject}_${stamp}`;
}

export function buildHnlAiExcelWorkbook(input: HnlAiReportExportInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const toolResult = input.result.toolResult;
  const generatedAt = input.generatedAt || Date.now();

  const summaryRows: Array<Array<string | number | boolean>> = [
    ['HNL AI Assistant - Báo cáo deterministic'],
    ['Report version', REPORT_VERSION],
    ['Công trình', input.projectName || '—'],
    ['Project ID', input.projectId || '—'],
    ['Chế độ', input.mode || '—'],
    ['Câu hỏi', input.question || '—'],
    ['Thời điểm xuất', isoDate(generatedAt)],
    ['Cloud status', input.result.cloudStatus],
    ['Provider', input.result.provider || '—'],
    ['Model', input.result.model || '—'],
  ];

  if (toolResult) {
    summaryRows.push(
      ['Tool', toolResult.metadata.tool],
      ['Trạng thái', toolResult.status],
      ['Freshness', toolResult.metadata.freshness],
      ['Records dùng', toolResult.metadata.recordsUsed],
      ['Records quét', toolResult.metadata.recordsScanned],
      ['Collections', toolResult.metadata.sourceCollections.join(', ') || '—'],
      ['Data as of', isoDate(toolResult.metadata.asOf)],
      ['Role', toolResult.metadata.permissionRole],
      ['Data version', toolResult.metadata.dataVersion || '—'],
    );
  }
  summaryRows.push(['Giới hạn', 'READ + ANALYZE + EXPORT ONLY; báo cáo không có quyền tự sửa/xóa dữ liệu HNL.']);
  appendSheet(wb, 'Tong quan', summaryRows);

  if (!toolResult) return wb;

  appendSheet(wb, 'Facts', [
    ['STT', 'Loại', 'Nội dung', 'Giá trị', 'Đơn vị', 'Phương pháp', 'Evidence IDs'],
    ...toolResult.facts.map((fact, index) => [
      index + 1,
      fact.kind,
      fact.label,
      displayValue(fact.value),
      fact.unit || '',
      fact.method || '',
      (fact.evidenceIds || []).join(', '),
    ]),
  ]);

  if (isAuditSummary(toolResult.data)) {
    appendSheet(wb, 'Audit', [
      ['STT', 'Severity', 'Rule', 'Entity type', 'Entity ID', 'Nội dung', 'Evidence IDs'],
      ...toolResult.data.issues.map((issue, index) => [
        index + 1,
        issue.severity,
        issue.ruleId,
        issue.entityType,
        issue.entityId,
        issue.message,
        issue.evidenceIds.join(', '),
      ]),
    ]);
  }

  appendSheet(wb, 'Evidence', [
    ['STT', 'Collection', 'Record ID', 'Nhãn', 'Field paths'],
    ...toolResult.evidence.map((item, index) => [
      index + 1,
      item.collection,
      item.recordId,
      item.label || '',
      (item.fieldPaths || []).join(', '),
    ]),
  ]);

  const narrativeRows = input.result.narrative?.statements?.map((statement, index) => [
    index + 1,
    statement.kind,
    statement.text,
    statement.supportingFactIds.join(', '),
    (statement.supportingIssueIds || []).join(', '),
  ]) || [];
  appendSheet(wb, 'AI nhan xet', [
    ['STT', 'Loại', 'Nội dung', 'Fact IDs', 'Issue IDs'],
    ...narrativeRows,
  ]);

  const warnings = Array.from(new Set([
    ...input.result.warnings,
    ...reportWarnings(toolResult),
  ].filter(Boolean)));
  appendSheet(wb, 'Canh bao', [
    ['STT', 'Nội dung'],
    ...warnings.map((item, index) => [index + 1, item]),
  ]);

  return wb;
}

function factsTable(toolResult: AiToolResult<unknown>): string {
  if (toolResult.facts.length === 0) return '<p class="muted">Không có fact deterministic.</p>';
  return `<table><thead><tr><th>#</th><th>Loại</th><th>Nội dung</th><th>Giá trị</th><th>Đơn vị</th></tr></thead><tbody>${toolResult.facts.map((fact, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(fact.kind)}</td><td>${escapeHtml(fact.label)}</td><td>${escapeHtml(displayValue(fact.value))}</td><td>${escapeHtml(fact.unit || '')}</td></tr>`).join('')}</tbody></table>`;
}

function auditTable(toolResult: AiToolResult<unknown>): string {
  if (!isAuditSummary(toolResult.data) || toolResult.data.issues.length === 0) return '';
  return `<h2>Vấn đề Audit</h2><div class="summary">ERROR ${toolResult.data.errorCount} · WARNING ${toolResult.data.warningCount} · REVIEW ${toolResult.data.reviewCount}</div><table><thead><tr><th>#</th><th>Mức</th><th>Rule</th><th>Đối tượng</th><th>Nội dung</th></tr></thead><tbody>${toolResult.data.issues.map((issue, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(issue.severity)}</td><td>${escapeHtml(issue.ruleId)}</td><td>${escapeHtml(`${issue.entityType}:${issue.entityId}`)}</td><td>${escapeHtml(issue.message)}</td></tr>`).join('')}</tbody></table>`;
}

function narrativeSection(input: HnlAiReportExportInput): string {
  const statements = input.result.narrative?.statements || [];
  if (statements.length === 0) return '';
  return `<h2>AI nhận xét</h2>${statements.map((statement) => `<div class="note"><strong>${escapeHtml(statement.kind)}</strong><div>${escapeHtml(statement.text)}</div><small>Fact: ${escapeHtml(statement.supportingFactIds.join(', ') || '—')} · Issue: ${escapeHtml((statement.supportingIssueIds || []).join(', ') || '—')}</small></div>`).join('')}`;
}

export function buildHnlAiHtmlReport(input: HnlAiReportExportInput): string {
  const toolResult = input.result.toolResult;
  const generatedAt = input.generatedAt || Date.now();
  const warnings = toolResult
    ? Array.from(new Set([...input.result.warnings, ...reportWarnings(toolResult)].filter(Boolean)))
    : [...input.result.warnings];

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HNL AI - ${escapeHtml(input.projectName)}</title><style>
  @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,"Segoe UI",sans-serif;color:#0f172a;font-size:11px;line-height:1.45;margin:0}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 7px}.brand{border-bottom:3px solid #4f46e5;padding-bottom:10px;margin-bottom:12px}.muted{color:#64748b}.meta{display:grid;grid-template-columns:150px 1fr;gap:4px 12px;margin:8px 0}.meta b{color:#334155}.summary{padding:8px 10px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;margin:6px 0 10px}table{width:100%;border-collapse:collapse;margin-top:6px;page-break-inside:auto}tr{page-break-inside:avoid}th,td{border:1px solid #cbd5e1;padding:5px 6px;text-align:left;vertical-align:top}th{background:#f1f5f9}.note{border-left:3px solid #6366f1;background:#eef2ff;padding:8px 10px;margin:6px 0}.note small{display:block;color:#64748b;margin-top:4px}.warning{border-left:3px solid #f59e0b;background:#fffbeb;padding:7px 9px;margin:5px 0}.footer{margin-top:18px;border-top:1px solid #cbd5e1;padding-top:8px;color:#64748b;font-size:9px}
  </style></head><body><div class="brand"><h1>HNL AI Assistant</h1><div class="muted">Báo cáo deterministic · ${REPORT_VERSION}</div></div>
  <div class="meta"><b>Công trình</b><span>${escapeHtml(input.projectName || '—')}</span><b>Project ID</b><span>${escapeHtml(input.projectId || '—')}</span><b>Chế độ</b><span>${escapeHtml(input.mode || '—')}</span><b>Câu hỏi</b><span>${escapeHtml(input.question || '—')}</span><b>Thời điểm xuất</b><span>${escapeHtml(isoDate(generatedAt))}</span><b>Cloud</b><span>${escapeHtml(input.result.cloudStatus)}</span>${toolResult ? `<b>Tool</b><span>${escapeHtml(toolResult.metadata.tool)}</span><b>Freshness</b><span>${escapeHtml(toolResult.metadata.freshness)}</span><b>Records</b><span>${toolResult.metadata.recordsUsed}/${toolResult.metadata.recordsScanned}</span><b>Data as of</b><span>${escapeHtml(isoDate(toolResult.metadata.asOf))}</span>` : ''}</div>
  ${toolResult ? `<h2>Kết quả HNL</h2>${factsTable(toolResult)}${auditTable(toolResult)}` : '<div class="summary">Không có tool result deterministic để xuất.</div>'}
  ${narrativeSection(input)}
  ${warnings.length ? `<h2>Cảnh báo / giả định</h2>${warnings.map((item) => `<div class="warning">${escapeHtml(item)}</div>`).join('')}` : ''}
  ${toolResult ? `<h2>Nguồn dữ liệu</h2><div class="meta"><b>Collections</b><span>${escapeHtml(toolResult.metadata.sourceCollections.join(', ') || '—')}</span><b>Evidence</b><span>${toolResult.evidence.length} record</span><b>Role</b><span>${escapeHtml(toolResult.metadata.permissionRole)}</span><b>Data version</b><span>${escapeHtml(toolResult.metadata.dataVersion || '—')}</span></div>` : ''}
  <div class="footer">HNL AI READ + ANALYZE + EXPORT ONLY · Báo cáo này không cấp quyền tự sửa, xóa hoặc ghi dữ liệu dự án.</div></body></html>`;
}

export async function exportHnlAiExcel(input: HnlAiReportExportInput): Promise<void> {
  const workbook = buildHnlAiExcelWorkbook(input);
  await saveWorkbookFile(workbook, `${buildHnlAiReportFileStem(input)}.xlsx`);
}

export async function exportHnlAiPdf(input: HnlAiReportExportInput): Promise<'android' | 'browser-print'> {
  const html = buildHnlAiHtmlReport(input);
  const fileName = `${buildHnlAiReportFileStem(input)}.pdf`;
  if (saveHtmlPdf(html, fileName)) return 'android';
  if (typeof window === 'undefined') throw new Error('PDF_BROWSER_UNAVAILABLE');

  const printWindow = window.open('', '_blank', 'width=1100,height=850');
  if (!printWindow) throw new Error('Trình duyệt đang chặn cửa sổ xuất PDF. Hãy cho phép pop-up rồi thử lại.');
  try { printWindow.opener = null; } catch { /* ignore */ }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
  return 'browser-print';
}
