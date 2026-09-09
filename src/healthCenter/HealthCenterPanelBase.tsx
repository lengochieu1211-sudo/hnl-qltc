import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Download, Eraser, ExternalLink, FileJson, FileSpreadsheet, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import type { UserRole } from '../utils/securityUtils';
import { saveTextFileToDownloads } from '../utils/fileExport';
import { confirmAsync } from '../utils/confirmAsync';
import { ExpandCollapseButton } from '../components/ExpandCollapseButton';
import { createHnlAiProjectSnapshot } from '../ai/data/projectSnapshot';
import { buildHealthCenterReport, type HealthCenterIssue, type HealthCenterModule, type HealthCenterSeverity } from './healthCenterEngine';
import { buildHealthCenterCopyText, exportHealthCenterExcel, exportHealthCenterJson } from './healthCenterExport';
import { buildHealthCenterRepairPreview } from './healthCenterRepair';
import { buildHealthCenterRepairBackupPayload, type HealthCenterRepairBackupPayload } from './healthCenterRepairApply';
import { commitHealthCenterRepair } from './healthCenterRepairCommit';
import { persistHealthCenterRepairToCloud } from './healthCenterRepairCloudPersist';

interface HealthCenterPanelProps {
  projectId: string;
  projectName?: string;
  userRole: UserRole;
  accessVerified: boolean;
  fullAppData?: any;
  freshness?: 'live' | 'cache';
  onApplyRepair?: (nextData: any, context: { auditSnapshotId: string; operationCount: number; backup: HealthCenterRepairBackupPayload }) => void | Promise<void>;
  getSystemDiagnostics?: () => Promise<Record<string, unknown>>;
  onClearSystemDiagnostics?: () => void | Promise<void>;
}

type SeverityFilter = 'ALL' | HealthCenterSeverity;
type ModuleFilter = 'ALL' | HealthCenterModule;

const array = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

function severityLabel(value: HealthCenterSeverity): string {
  if (value === 'ERROR') return 'Lỗi nghiêm trọng';
  if (value === 'WARNING') return 'Cảnh báo';
  if (value === 'REVIEW') return 'Cần xác nhận';
  return 'Đề xuất';
}

function actionLabel(issue: HealthCenterIssue): string {
  if (issue.actionClass === 'SAFE_REPAIR_CANDIDATE') return 'Có thể sửa an toàn';
  if (issue.actionClass === 'NEEDS_CONFIRMATION') return 'Cần xác nhận';
  if (issue.actionClass === 'MANUAL_REPAIR') return 'Sửa thủ công';
  return 'Chỉ đọc';
}

function moduleLabel(value: HealthCenterModule): string {
  const labels: Record<HealthCenterModule, string> = {
    system: 'Hệ thống', firebase: 'Firebase', r2: 'R2/Ảnh', sync: 'Đồng bộ', rooms: 'Tầng/Căn', defects: 'Defect',
    crew: 'Quân số', quantities: 'Khối lượng', inventory: 'Kho', materialNorms: 'Định mức', checklist: 'Checklist', links: 'Liên kết ID',
  };
  return labels[value];
}

function renderRepairValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '∅';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

export const HealthCenterPanel: React.FC<HealthCenterPanelProps> = ({
  projectId,
  projectName,
  userRole,
  accessVerified,
  fullAppData,
  freshness = 'live',
  onApplyRepair,
  getSystemDiagnostics,
  onClearSystemDiagnostics,
}) => {
  const [runAt, setRunAt] = useState(() => Date.now());
  const [severity, setSeverity] = useState<SeverityFilter>('ALL');
  const [module, setModule] = useState<ModuleFilter>('ALL');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [showRepairPreview, setShowRepairPreview] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('qlct_health_center_return_state');
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state?.projectId && state.projectId !== projectId) return;
      if (state?.severity) setSeverity(state.severity as SeverityFilter);
      if (state?.module) setModule(state.module as ModuleFilter);
      if (typeof state?.query === 'string') setQuery(state.query);
      if (state?.issueId) setExpanded(state.issueId);
      sessionStorage.removeItem('qlct_health_center_return_state');
      window.setTimeout(() => {
        const node = state?.issueId ? document.getElementById(`health-issue-${state.issueId}`) : null;
        node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 160);
    } catch { /* best effort */ }
  }, [projectId]);

  const report = useMemo(() => {
    if (!projectId || !accessVerified) return null;
    const data = fullAppData || {};
    const snapshotFreshness: 'live' | 'cache' = freshness === 'cache' ? 'cache' : 'live';
    const snapshot = createHnlAiProjectSnapshot({
      projectId,
      projectName: projectName || data.projectName || '',
      rooms: array(data.roomProgressList),
      defects: array(data.defects),
      crewRecords: array(data.crewRecords),
      teams: array(data.teams),
      floors: array(data.floorPlans),
      workVolumes: array(data.workVolumes),
      inventory: array(data.inventory),
      materialNorms: array(data.materialNorms),
      checklist: array(data.checklist),
      asOf: runAt,
      freshness: snapshotFreshness,
    });
    return buildHealthCenterReport({
      context: { projectId, role: userRole, accessVerified, screen: 'health-center', timeZone: 'Asia/Ho_Chi_Minh' },
      snapshot,
    });
  }, [accessVerified, freshness, fullAppData, projectId, projectName, runAt, userRole]);

  const filtered = useMemo(() => {
    if (!report) return [];
    const needle = query.trim().toLocaleLowerCase('vi');
    return report.issues.filter((issue) => {
      if (severity !== 'ALL' && issue.severity !== severity) return false;
      if (module !== 'ALL' && issue.module !== module) return false;
      if (!needle) return true;
      return [issue.ruleId, issue.message, issue.location.date, issue.location.teamName, issue.location.floorName, issue.location.roomName, issue.location.workItem, issue.entityId]
        .some((value) => String(value || '').toLocaleLowerCase('vi').includes(needle));
    });
  }, [module, query, report, severity]);

  const repairPreview = useMemo(() => {
    if (!report || userRole !== 'ADMIN') return null;
    const safeIds = filtered.filter((issue) => issue.actionClass === 'SAFE_REPAIR_CANDIDATE').map((issue) => issue.id);
    if (safeIds.length === 0) return null;
    return buildHealthCenterRepairPreview(report, safeIds);
  }, [filtered, report, userRole]);

  const saveRepairBackupPayload = async (payload: HealthCenterRepairBackupPayload) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await saveTextFileToDownloads(
      JSON.stringify(payload, null, 2),
      `HNL-QLTC-HEALTH-CENTER-REPAIR-BACKUP-${stamp}.json`,
      'application/json;charset=utf-8',
    );
  };

  const openIssue = (issue: HealthCenterIssue) => {
    try {
      sessionStorage.setItem('qlct_health_center_return_state', JSON.stringify({
        projectId, severity, module, query, issueId: issue.id, createdAt: Date.now(),
      }));
      sessionStorage.setItem('qlct_diagnostic_navigation_request', JSON.stringify({
        projectId,
        entityType: issue.entityType,
        entityId: issue.entityId,
        floorId: issue.location.floorId || '',
        roomId: issue.location.roomId || '',
        teamId: issue.location.teamId || '',
        ruleId: issue.ruleId,
        createdAt: Date.now(),
      }));
    } catch { /* best effort */ }
    window.dispatchEvent(new CustomEvent('qlct-diagnostic-open-entity', { detail: {
      entityType: issue.entityType,
      entityId: issue.entityId,
      floorId: issue.location.floorId,
      roomId: issue.location.roomId,
      teamId: issue.location.teamId,
      ruleId: issue.ruleId,
    } }));
    setMessage('Đã gửi yêu cầu mở đúng bản ghi liên quan. Nếu module chưa hỗ trợ deep-link chi tiết, HNL sẽ mở module gần nhất.');
  };

  const buildCombinedExportInput = async () => ({
    report,
    projectName: projectName || fullAppData?.projectName || '',
    issues: filtered,
    scope: 'filtered' as const,
    systemDiagnostics: getSystemDiagnostics ? await getSystemDiagnostics() : null,
  });

  const exportReport = async (kind: 'json' | 'excel') => {
    if (!report) return;
    setExporting(kind);
    setMessage('');
    try {
      const input = await buildCombinedExportInput();
      if (kind === 'json') await exportHealthCenterJson(input);
      if (kind === 'excel') await exportHealthCenterExcel(input);
      setMessage(`Đã xuất ${kind.toUpperCase()} tổng hợp Audit dữ liệu + hệ thống/đồng bộ + ảnh R2 theo Snapshot ${report.auditSnapshotId}.`);
    } catch (err) {
      setMessage(`Không xuất được ${kind.toUpperCase()}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  };

  const copyCombinedDiagnostics = async () => {
    if (!report) return;
    setExporting('copy');
    setMessage('');
    try {
      const input = await buildCombinedExportInput();
      await navigator.clipboard.writeText(buildHealthCenterCopyText(input));
      setMessage('Đã copy chẩn đoán tổng hợp: Audit dữ liệu/liên kết + hệ thống/đồng bộ + ảnh R2.');
    } catch (err) {
      setMessage(`Không copy được chẩn đoán tổng hợp: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  };

  const exportRepairBackup = async () => {
    if (!repairPreview || repairPreview.operations.length === 0 || userRole !== 'ADMIN') return;
    setExporting('repair-backup');
    setMessage('');
    try {
      const payload = buildHealthCenterRepairBackupPayload({ projectId, preview: repairPreview, fullAppData });
      await saveRepairBackupPayload(payload);
      setMessage(`Đã xuất backup trước sửa cho Audit Snapshot ID ${repairPreview.auditSnapshotId}. Chưa có dữ liệu nào bị thay đổi.`);
    } catch (err) {
      setMessage(`Không xuất được backup trước sửa: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  };

  const applySafeRepair = async () => {
    if (!report || !repairPreview || userRole !== 'ADMIN' || !accessVerified || freshness !== 'live') return;
    setExporting('repair-apply');
    setMessage('');
    try {
      const result = await commitHealthCenterRepair({
        projectId,
        userRole,
        accessVerified,
        currentReport: report,
        preview: repairPreview,
        fullAppData: fullAppData || {},
        saveBackup: saveRepairBackupPayload,
        confirmApply: async ({ operationCount, auditSnapshotId }) => await confirmAsync(
          `Health Center đã lưu backup trước sửa.\n\nÁp dụng ${operationCount} thay đổi deterministic-unique của Audit Snapshot ${auditSnapshotId}?\n\nChỉ các field hiển thị trong Repair Preview được phép thay đổi.`
        ),
        persist: async (nextData, context) => {
          if (onApplyRepair) {
            await onApplyRepair(nextData, {
              auditSnapshotId: context.preview.auditSnapshotId,
              operationCount: context.preview.operations.length,
              backup: context.backup,
            });
            return;
          }
          await persistHealthCenterRepairToCloud({
            projectId,
            projectName,
            beforeData: fullAppData || {},
            appliedData: nextData,
            preview: context.preview,
          });
        },
      });
      setMessage(result.message);
      if (result.ok) {
        setShowRepairPreview(false);
        window.setTimeout(() => setRunAt(Date.now()), 500);
      }
    } catch (err) {
      setMessage(`Không áp dụng được Repair: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  };

  if (!accessVerified) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">Health Center chỉ chạy sau khi quyền dự án đã được xác minh.</div>;
  }
  if (!report) return null;

  return <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 font-bold text-slate-900"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Audit dữ liệu & liên kết</div>
        <div className="mt-1 text-[10px] font-semibold text-slate-500">Phát hiện orphan · mở đúng bản ghi · sửa có xác nhận · không tự xóa lịch sử</div>
        <div className="mt-1 break-all text-[9px] text-slate-400">Snapshot: {report.auditSnapshotId}</div>
      </div>
      <button type="button" onClick={() => { setRunAt(Date.now()); setShowRepairPreview(false); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-700"><RefreshCw className="h-3.5 w-3.5" /> Quét lại</button>
    </div>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="rounded-xl border border-red-200 bg-red-50 p-2"><div className="text-[9px] font-bold text-red-600">LỖI</div><div className="text-lg font-black text-red-700">{report.errorCount}</div></div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-2"><div className="text-[9px] font-bold text-amber-600">CẢNH BÁO</div><div className="text-lg font-black text-amber-700">{report.warningCount}</div></div>
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-2"><div className="text-[9px] font-bold text-indigo-600">CẦN XÁC NHẬN</div><div className="text-lg font-black text-indigo-700">{report.needsConfirmationCount}</div></div>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2"><div className="text-[9px] font-bold text-emerald-600">CÓ THỂ SỬA AN TOÀN</div><div className="text-lg font-black text-emerald-700">{report.safeRepairCount}</div></div>
    </div>

    <div className="grid gap-2 sm:grid-cols-3">
      <select value={severity} onChange={(e) => { setSeverity(e.target.value as SeverityFilter); setShowRepairPreview(false); }} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs">
        <option value="ALL">Tất cả mức độ</option><option value="ERROR">Lỗi nghiêm trọng</option><option value="WARNING">Cảnh báo</option><option value="REVIEW">Cần xác nhận</option><option value="SUGGESTION">Đề xuất</option>
      </select>
      <select value={module} onChange={(e) => { setModule(e.target.value as ModuleFilter); setShowRepairPreview(false); }} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs">
        <option value="ALL">Tất cả module</option>{(['system','firebase','r2','sync','rooms','defects','crew','quantities','inventory','materialNorms','checklist','links'] as HealthCenterModule[]).map((x) => <option key={x} value={x}>{moduleLabel(x)}</option>)}
      </select>
      <input value={query} onChange={(e) => { setQuery(e.target.value); setShowRepairPreview(false); }} placeholder="Tìm ngày, đội, tầng, căn, hạng mục..." className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs" />
    </div>


    {userRole === 'ADMIN' && repairPreview && repairPreview.operations.length > 0 && <div className="flex justify-end">
      <button type="button" onClick={() => setShowRepairPreview((value) => !value)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700"><Wrench className="h-3.5 w-3.5" /> {showRepairPreview ? 'Ẩn sửa an toàn' : `Xem sửa an toàn (${repairPreview.operations.length})`}</button>
    </div>}

    {showRepairPreview && repairPreview && <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><div className="text-xs font-black text-emerald-800">Repair Preview · chưa ghi dữ liệu</div><div className="mt-0.5 text-[9px] font-semibold text-emerald-700">Chỉ liệt kê repair deterministic-unique. Orphan thật, ambiguous và lỗi nghiệp vụ không được tự sửa.</div></div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={Boolean(exporting)} onClick={() => void exportRepairBackup()} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-[10px] font-bold text-emerald-800"><Download className="h-3.5 w-3.5" /> Backup trước sửa</button>
          <button type="button" disabled={Boolean(exporting) || !repairPreview.canApply || freshness !== 'live'} onClick={() => void applySafeRepair()} className="inline-flex items-center gap-1 rounded-lg border border-emerald-700 bg-emerald-700 px-2.5 py-1.5 text-[10px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"><Wrench className="h-3.5 w-3.5" /> {exporting === 'repair-apply' ? 'Đang kiểm tra...' : 'Backup & Áp dụng sửa an toàn'}</button>
        </div>
      </div>
      <div className="space-y-1.5">
        {repairPreview.operations.map((op) => <div key={op.id} className="rounded-lg border border-emerald-200 bg-white p-2 text-[10px]">
          <div className="font-bold text-slate-800">{op.target}:{op.entityId} · {op.path}</div>
          <div className="mt-1 break-all text-slate-600"><span className="line-through">{renderRepairValue(op.before)}</span> <span className="px-1 font-black text-emerald-700">→</span> <span className="font-bold text-emerald-800">{renderRepairValue(op.after)}</span></div>
          <div className="mt-1 text-[9px] text-slate-500">{op.ruleId} · {op.reason}</div>
        </div>)}
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[9px] font-semibold text-amber-800">Apply chỉ chạy khi snapshot Cloud đang live. Luồng bắt buộc: snapshot còn mới → backup thành công → ADMIN xác nhận → kiểm tra before-value → chỉ ghi Defect/Quân số qua cloud diff chuẩn có revision → realtime re-audit.</div>
    </div>}

    {report.issues.length === 0 ? <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Không phát hiện vấn đề trong snapshot hiện tại.</div> : null}

    <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
      {filtered.map((issue) => {
        const isOpen = expanded === issue.id;
        return <div id={`health-issue-${issue.id}`} key={issue.id} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${issue.severity === 'ERROR' ? 'text-red-600' : issue.severity === 'WARNING' ? 'text-amber-600' : 'text-indigo-600'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-1.5 text-[9px] font-bold"><span>{severityLabel(issue.severity)}</span><span>·</span><span>{moduleLabel(issue.module)}</span><span>·</span><span>{actionLabel(issue)}</span></div>
              <div className="mt-1 text-xs font-bold text-slate-900">{issue.message}</div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] font-semibold text-slate-600">
                {issue.location.date && <span>Ngày: {issue.location.date}</span>}{issue.location.teamName && <span>Đội: {issue.location.teamName}</span>}{issue.location.floorName && <span>Tầng: {issue.location.floorName}</span>}{issue.location.roomName && <span>Căn: {issue.location.roomName}</span>}{issue.location.shift && <span>Ca: {issue.location.shift}</span>}{issue.location.workItem && <span>Công việc: {issue.location.workItem}</span>}
              </div>
              <div className="mt-1 break-all text-[9px] text-slate-400">{issue.ruleId} · {issue.entityType}:{issue.entityId}</div>
              <div className="mt-2 flex flex-wrap gap-1.5"><button type="button" onClick={() => openIssue(issue)} className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[9px] font-bold text-indigo-700"><ExternalLink className="h-3 w-3" /> {issue.ruleId === 'ROOM_ORPHAN_WORK_CATEGORY_REFERENCE' && userRole === 'ADMIN' ? 'Xử lý hạng mục' : 'Xem bản ghi'}</button><ExpandCollapseButton expanded={isOpen} onToggle={() => setExpanded(isOpen ? null : issue.id)} expandLabel="Xem liên kết" collapseLabel="Ẩn liên kết" className="min-h-7 rounded-md border-slate-200 px-2 py-1 text-[9px] text-slate-600" /></div>
              {isOpen && <div className="mt-2 rounded-lg bg-slate-50 p-2 text-[9px] text-slate-600"><div><b>Evidence:</b> {issue.evidenceIds.join(', ') || '—'}</div><div className="mt-1 break-all"><b>Chi tiết:</b> {JSON.stringify(issue.details || {})}</div></div>}
            </div>
          </div>
        </div>;
      })}
    </div>
    {message && <div className="rounded-lg border border-slate-200 bg-white p-2 text-[10px] font-semibold text-slate-600">{message}</div>}

    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 space-y-2">
      <div>
        <div className="text-[10px] font-extrabold text-slate-700">Xuất &amp; chia sẻ chẩn đoán</div>
        <div className="mt-0.5 text-[9px] font-semibold text-slate-500">Một file chứa chung Audit dữ liệu/liên kết + trạng thái hệ thống/đồng bộ + ảnh R2. PDF đã bỏ để tránh trùng.</div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button type="button" disabled={Boolean(exporting)} onClick={() => void exportReport('json')} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-bold disabled:opacity-50"><FileJson className="h-3.5 w-3.5" /> Xuất JSON</button>
        <button type="button" disabled={Boolean(exporting)} onClick={() => void exportReport('excel')} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[10px] font-bold text-indigo-700 disabled:opacity-50"><FileSpreadsheet className="h-3.5 w-3.5" /> Xuất Excel</button>
        <button type="button" disabled={Boolean(exporting)} onClick={() => void copyCombinedDiagnostics()} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50"><Copy className="h-3.5 w-3.5" /> Copy chẩn đoán</button>
      </div>
      <div className="text-[9px] font-semibold text-slate-500">Đang hiển thị/xuất {filtered.length}/{report.issues.length} vấn đề · {report.recordsScanned} record đã quét</div>
      {onClearSystemDiagnostics && <div className="border-t border-slate-100 pt-2">
        <button type="button" disabled={Boolean(exporting)} onClick={() => void onClearSystemDiagnostics()} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[9px] font-bold text-slate-500 hover:bg-slate-50 hover:text-rose-600 disabled:opacity-50"><Eraser className="h-3.5 w-3.5" /> Xóa log chẩn đoán cũ</button>
      </div>}
    </div>
  </div>;
};