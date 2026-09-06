import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileJson, FileSpreadsheet, RefreshCw, ShieldCheck } from 'lucide-react';
import type { UserRole } from '../utils/securityUtils';
import { createHnlAiProjectSnapshot } from '../ai/data/projectSnapshot';
import { buildHealthCenterReport, type HealthCenterIssue, type HealthCenterModule, type HealthCenterSeverity } from './healthCenterEngine';
import { exportHealthCenterExcel, exportHealthCenterJson, exportHealthCenterPdf } from './healthCenterExport';

interface HealthCenterPanelProps {
  projectId: string;
  projectName?: string;
  userRole: UserRole;
  accessVerified: boolean;
  fullAppData?: any;
  freshness?: 'live' | 'cache';
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

export const HealthCenterPanel: React.FC<HealthCenterPanelProps> = ({
  projectId,
  projectName,
  userRole,
  accessVerified,
  fullAppData,
  freshness = 'live',
}) => {
  const [runAt, setRunAt] = useState(() => Date.now());
  const [severity, setSeverity] = useState<SeverityFilter>('ALL');
  const [module, setModule] = useState<ModuleFilter>('ALL');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const report = useMemo(() => {
    if (!projectId || !accessVerified) return null;
    const data = fullAppData || {};
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
      freshness,
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

  const openIssue = (issue: HealthCenterIssue) => {
    try {
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

  const exportReport = async (kind: 'json' | 'excel' | 'pdf') => {
    if (!report) return;
    setExporting(kind);
    setMessage('');
    try {
      const input = { report, projectName: projectName || fullAppData?.projectName || '', issues: filtered, scope: 'filtered' as const };
      if (kind === 'json') await exportHealthCenterJson(input);
      if (kind === 'excel') await exportHealthCenterExcel(input);
      if (kind === 'pdf') await exportHealthCenterPdf(input);
      setMessage(`Đã xuất ${kind.toUpperCase()} theo đúng Audit Snapshot ID ${report.auditSnapshotId}.`);
    } catch (err) {
      setMessage(`Không xuất được ${kind.toUpperCase()}: ${err instanceof Error ? err.message : String(err)}`);
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
        <div className="flex items-center gap-2 font-bold text-slate-900"><ShieldCheck className="h-4 w-4 text-emerald-600" /> HNL Health Center</div>
        <div className="mt-1 text-[10px] font-semibold text-slate-500">Hệ thống · Chẩn đoán · Audit dữ liệu · một nguồn kết quả duy nhất</div>
        <div className="mt-1 break-all text-[9px] text-slate-400">Snapshot: {report.auditSnapshotId}</div>
      </div>
      <button type="button" onClick={() => setRunAt(Date.now())} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-700"><RefreshCw className="h-3.5 w-3.5" /> Quét lại</button>
    </div>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="rounded-xl border border-red-200 bg-red-50 p-2"><div className="text-[9px] font-bold text-red-600">LỖI</div><div className="text-lg font-black text-red-700">{report.errorCount}</div></div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-2"><div className="text-[9px] font-bold text-amber-600">CẢNH BÁO</div><div className="text-lg font-black text-amber-700">{report.warningCount}</div></div>
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-2"><div className="text-[9px] font-bold text-indigo-600">CẦN XÁC NHẬN</div><div className="text-lg font-black text-indigo-700">{report.needsConfirmationCount}</div></div>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2"><div className="text-[9px] font-bold text-emerald-600">CÓ THỂ SỬA AN TOÀN</div><div className="text-lg font-black text-emerald-700">{report.safeRepairCount}</div></div>
    </div>

    <div className="grid gap-2 sm:grid-cols-3">
      <select value={severity} onChange={(e) => setSeverity(e.target.value as SeverityFilter)} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs">
        <option value="ALL">Tất cả mức độ</option><option value="ERROR">Lỗi nghiêm trọng</option><option value="WARNING">Cảnh báo</option><option value="REVIEW">Cần xác nhận</option><option value="SUGGESTION">Đề xuất</option>
      </select>
      <select value={module} onChange={(e) => setModule(e.target.value as ModuleFilter)} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs">
        <option value="ALL">Tất cả module</option>{(['system','firebase','r2','sync','rooms','defects','crew','quantities','inventory','materialNorms','checklist','links'] as HealthCenterModule[]).map((x) => <option key={x} value={x}>{moduleLabel(x)}</option>)}
      </select>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm ngày, đội, tầng, căn, hạng mục..." className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs" />
    </div>

    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={Boolean(exporting)} onClick={() => void exportReport('json')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold"><FileJson className="h-3.5 w-3.5" /> JSON</button>
      <button type="button" disabled={Boolean(exporting)} onClick={() => void exportReport('excel')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold"><FileSpreadsheet className="h-3.5 w-3.5" /> Excel</button>
      <button type="button" disabled={Boolean(exporting)} onClick={() => void exportReport('pdf')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold"><Download className="h-3.5 w-3.5" /> PDF</button>
      <span className="self-center text-[9px] font-semibold text-slate-500">Đang hiển thị/xuất {filtered.length}/{report.issues.length} vấn đề · {report.recordsScanned} record đã quét</span>
    </div>

    {report.issues.length === 0 ? <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Không phát hiện vấn đề trong snapshot hiện tại.</div> : null}

    <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
      {filtered.map((issue) => {
        const isOpen = expanded === issue.id;
        return <div key={issue.id} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${issue.severity === 'ERROR' ? 'text-red-600' : issue.severity === 'WARNING' ? 'text-amber-600' : 'text-indigo-600'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-1.5 text-[9px] font-bold"><span>{severityLabel(issue.severity)}</span><span>·</span><span>{moduleLabel(issue.module)}</span><span>·</span><span>{actionLabel(issue)}</span></div>
              <div className="mt-1 text-xs font-bold text-slate-900">{issue.message}</div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] font-semibold text-slate-600">
                {issue.location.date && <span>Ngày: {issue.location.date}</span>}{issue.location.teamName && <span>Đội: {issue.location.teamName}</span>}{issue.location.floorName && <span>Tầng: {issue.location.floorName}</span>}{issue.location.roomName && <span>Căn: {issue.location.roomName}</span>}{issue.location.shift && <span>Ca: {issue.location.shift}</span>}{issue.location.workItem && <span>Công việc: {issue.location.workItem}</span>}
              </div>
              <div className="mt-1 break-all text-[9px] text-slate-400">{issue.ruleId} · {issue.entityType}:{issue.entityId}</div>
              <div className="mt-2 flex flex-wrap gap-1.5"><button type="button" onClick={() => openIssue(issue)} className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[9px] font-bold text-indigo-700"><ExternalLink className="h-3 w-3" /> Xem bản ghi</button><button type="button" onClick={() => setExpanded(isOpen ? null : issue.id)} className="rounded-md border border-slate-200 px-2 py-1 text-[9px] font-bold text-slate-600">{isOpen ? 'Ẩn liên kết' : 'Xem liên kết'}</button></div>
              {isOpen && <div className="mt-2 rounded-lg bg-slate-50 p-2 text-[9px] text-slate-600"><div><b>Evidence:</b> {issue.evidenceIds.join(', ') || '—'}</div><div className="mt-1 break-all"><b>Chi tiết:</b> {JSON.stringify(issue.details || {})}</div></div>}
            </div>
          </div>
        </div>;
      })}
    </div>
    {message && <div className="rounded-lg border border-slate-200 bg-white p-2 text-[10px] font-semibold text-slate-600">{message}</div>}
  </div>;
};
