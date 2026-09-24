import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CheckCircle2,
  Clock3,
  FileText,
  MapPin,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { CrewRecord, FloorPlan, TeamInfo } from '../types';
import { UserRole } from '../utils/securityUtils';
import { formatDateDDMMYYYY, formatDateTime } from '../utils/dateFormatter';
import { fetchProjectCrewReportData } from '../lib/firebase';
import {
  buildCrewReportMatrices,
  buildCrewReportRows,
  filterCrewReportRows,
  summarizeCrewReportRows,
  type CrewReportProjectInput,
} from '../utils/crewReportUtils';
import { CrewReportShareModal } from './CrewReportShareModal';
import type { ProjectStructureConfig } from '../utils/structureGroupUtils';

export interface HomeProjectSummary {
  id: string;
  name: string;
  role?: UserRole;
}

interface HomeDashboardProps {
  projects: HomeProjectSummary[];
  activeProjectId: string;
  activeProjectName: string;
  activeProjectLocation: string;
  currentRole: UserRole;
  defectOpenCount: number;
  dueAlertCount: number;
  crewRecords: CrewRecord[];
  teams: TeamInfo[];
  floorPlans: FloorPlan[];
  structureConfig: ProjectStructureConfig;
  lastUpdatedAt?: number;
  isOnline: boolean;
  isSyncing: boolean;
  startupProjectId: string;
  onStartupProjectChange: (projectId: string) => void;
  onOpenProject: (projectId: string) => void | Promise<void>;
  onManageProjects: () => void;
  onOpenNotifications: () => void;
  onOpenCrew: () => void;
  onOpenFloorPlan: () => void;
}

const roleLabel = (role?: UserRole) => role === 'ADMIN' ? 'ADMIN' : role === 'EDITOR' ? 'EDITOR' : 'VIEWER';
const roleClass = (role?: UserRole) => role === 'ADMIN'
  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
  : role === 'EDITOR'
    ? 'border-blue-200 bg-blue-50 text-blue-700'
    : 'border-slate-200 bg-slate-100 text-slate-600';

const toLocalDateKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const shiftDate = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return toLocalDateKey(next);
};

const currentMonthStart = () => {
  const now = new Date();
  return toLocalDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
};

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  projects,
  activeProjectId,
  activeProjectName,
  activeProjectLocation,
  currentRole,
  defectOpenCount,
  dueAlertCount,
  crewRecords,
  teams,
  floorPlans,
  structureConfig,
  lastUpdatedAt,
  isOnline,
  isSyncing,
  startupProjectId,
  onStartupProjectChange,
  onOpenProject,
  onManageProjects,
  onOpenNotifications,
  onOpenCrew,
  onOpenFloorPlan,
}) => {
  const todayKey = toLocalDateKey();
  const [reportStartDate, setReportStartDate] = useState(todayKey);
  const [reportEndDate, setReportEndDate] = useState(todayKey);
  const [reportPreset, setReportPreset] = useState<'today' | 'yesterday' | '7days' | 'month' | 'custom'>('today');
  const [reportProjects, setReportProjects] = useState<CrewReportProjectInput[]>([]);
  const [reportFailedProjects, setReportFailedProjects] = useState<string[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reportProjectFilter, setReportProjectFilter] = useState('all');
  const [reportTeamFilter, setReportTeamFilter] = useState('all');
  const [showReportShare, setShowReportShare] = useState(false);

  const activeProject = projects.find((project) => project.id === activeProjectId);
  const quickOpenEnabled = startupProjectId === activeProjectId && Boolean(activeProjectId);

  useEffect(() => {
    let cancelled = false;
    const activeFallback: CrewReportProjectInput = {
      projectId: activeProjectId,
      projectName: activeProjectName || activeProject?.name || 'Dự án đang mở',
      projectLocation: activeProjectLocation,
      records: crewRecords,
      teams,
      floorPlans,
      structureConfig,
    };

    if (!isOnline) {
      setReportLoading(false);
      setReportError(projects.length > 1 ? 'Đang offline: Trang chủ chỉ dùng quân số đã xác minh của dự án đang mở. Kết nối mạng để tải báo cáo nhiều dự án.' : '');
      setReportFailedProjects(projects.filter((project) => project.id !== activeProjectId).map((project) => project.name));
      setReportProjects(activeProjectId ? [activeFallback] : []);
      return () => { cancelled = true; };
    }
    if (projects.length === 0) {
      setReportProjects([]);
      setReportFailedProjects([]);
      setReportError('');
      return () => { cancelled = true; };
    }

    setReportLoading(true);
    setReportError('');
    const load = async () => {
      const results = await Promise.allSettled(projects.map(async (project) => {
        if (project.id === activeProjectId) {
          // The active project is already live-subscribed in App; use that authoritative in-memory state.
          return activeFallback;
        }
        const snapshot = await fetchProjectCrewReportData(project.id, reportStartDate, reportEndDate, { serverOnly: true });
        return {
          projectId: project.id,
          projectName: snapshot.projectName || project.name,
          projectLocation: snapshot.projectLocation,
          records: snapshot.records,
          teams: snapshot.teams,
          floorPlans: snapshot.floorPlans,
          structureConfig: snapshot.structureConfig,
        } satisfies CrewReportProjectInput;
      }));
      if (cancelled) return;
      const loaded: CrewReportProjectInput[] = [];
      const failed: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') loaded.push(result.value);
        else failed.push(projects[index]?.name || projects[index]?.id || 'Dự án');
      });
      setReportProjects(loaded);
      setReportFailedProjects(failed);
      setReportError(failed.length > 0 ? `Không tải được quân số của ${failed.length} dự án. Các dự án còn lại vẫn hiển thị dữ liệu thật; không thay bằng số 0.` : '');
      setReportLoading(false);
    };
    void load().catch((error) => {
      if (cancelled) return;
      console.warn('Multi-project crew report warning:', error);
      setReportProjects(activeProjectId ? [activeFallback] : []);
      setReportFailedProjects(projects.filter((project) => project.id !== activeProjectId).map((project) => project.name));
      setReportError('Không tải được báo cáo quân số nhiều dự án. Dữ liệu dự án đang mở vẫn được giữ nguyên.');
      setReportLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeProjectId, activeProjectName, activeProjectLocation, activeProject?.name, crewRecords, teams, floorPlans, structureConfig, isOnline, projects, reportStartDate, reportEndDate]);

  const reportRows = useMemo(
    () => buildCrewReportRows(reportProjects, reportStartDate, reportEndDate),
    [reportProjects, reportStartDate, reportEndDate],
  );
  const reportTeamOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of reportRows) {
      if (reportProjectFilter !== 'all' && row.projectId !== reportProjectFilter) continue;
      map.set(row.teamKey, `${row.structureGroupName ? `${row.structureGroupName} · ` : ''}${row.teamName}`);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'vi-VN', { numeric: true, sensitivity: 'base' }));
  }, [reportRows, reportProjectFilter]);
  const filteredReportRows = useMemo(
    () => filterCrewReportRows(reportRows, reportProjectFilter, reportTeamFilter),
    [reportRows, reportProjectFilter, reportTeamFilter],
  );
  const dailySummaries = useMemo(() => summarizeCrewReportRows(filteredReportRows), [filteredReportRows]);
  const reportMatrices = useMemo(() => buildCrewReportMatrices(filteredReportRows), [filteredReportRows]);
  const endDateSummary = dailySummaries.find((item) => item.date === reportEndDate);

  const setPreset = (preset: 'today' | 'yesterday' | '7days' | 'month') => {
    const now = new Date();
    if (preset === 'today') {
      setReportStartDate(todayKey);
      setReportEndDate(todayKey);
    } else if (preset === 'yesterday') {
      const key = shiftDate(now, -1);
      setReportStartDate(key);
      setReportEndDate(key);
    } else if (preset === '7days') {
      setReportStartDate(shiftDate(now, -6));
      setReportEndDate(todayKey);
    } else {
      setReportStartDate(currentMonthStart());
      setReportEndDate(todayKey);
    }
    setReportPreset(preset);
    setReportProjectFilter('all');
    setReportTeamFilter('all');
  };

  const kpis = [
    { label: 'Dự án của tôi', value: projects.length, icon: Building2, tone: 'text-blue-700 bg-blue-50 border-blue-100', detail: 'Đã xác minh quyền truy cập' },
    { label: 'Defect đang mở', value: defectOpenCount, icon: AlertTriangle, tone: 'text-rose-700 bg-rose-50 border-rose-100', detail: 'Dự án đang mở' },
    { label: reportEndDate === todayKey ? 'Quân số hôm nay' : `Quân số ${formatDateDDMMYYYY(reportEndDate)}`, value: endDateSummary?.dailyHeadcount ?? '—', icon: Users, tone: 'text-emerald-700 bg-emerald-50 border-emerald-100', detail: endDateSummary ? `${endDateSummary.reportedTeams} đội đã báo${endDateSummary.missingTeams ? ` · ${endDateSummary.missingTeams} chưa báo` : ''}` : (reportLoading ? 'Đang tải nhiều dự án' : 'Chưa có dữ liệu đã tải') },
    { label: 'Cần chú ý', value: dueAlertCount, icon: Activity, tone: 'text-amber-700 bg-amber-50 border-amber-100', detail: 'Hạn / quá hạn dự án đang mở' },
  ];

  return (
    <div className="min-h-[calc(100vh-9rem)] bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.10),_transparent_34%),linear-gradient(180deg,#f8fafc_0%,#eef4fb_100%)] px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-5">
      <div className="mx-auto max-w-[1680px] space-y-4">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-0 xl:grid-cols-[1fr_420px]">
            <div className="relative overflow-hidden p-4 sm:p-5 lg:p-6">
              <div className="absolute inset-y-0 right-0 hidden w-[46%] bg-[linear-gradient(135deg,transparent_0%,rgba(59,130,246,0.08)_46%,rgba(14,165,233,0.14)_100%)] lg:block" />
              <div className="relative z-10 max-w-3xl">
                <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Tổng quan công trường</h1>
                <p className="mt-1.5 max-w-2xl text-xs font-medium leading-5 text-slate-500 sm:text-sm">
                  Chọn dự án, theo dõi quân số, Defect và các việc cần chú ý.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-600">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${isOnline ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                    {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                    {isOnline ? (isSyncing ? 'Đang đồng bộ' : 'Đã kết nối') : 'Ngoại tuyến · dùng dữ liệu đã xác minh'}
                  </span>
                  {lastUpdatedAt ? <span>Cập nhật {formatDateTime(lastUpdatedAt)}</span> : <span>Chưa có mốc cập nhật dữ liệu</span>}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50/90 p-4 xl:border-l xl:border-t-0">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Dự án đang làm</div>
                  <div className="mt-1 max-w-[270px] truncate text-base font-black text-slate-900">{activeProjectName || activeProject?.name || 'Chưa chọn dự án'}</div>
                  {activeProjectLocation && <div className="mt-0.5 flex max-w-[300px] items-center gap-1 truncate text-[9.5px] font-semibold text-slate-500"><MapPin className="h-3 w-3 shrink-0" /> {activeProjectLocation}</div>}
                </div>
                <span className={`rounded-full border px-2 py-1 text-[9px] font-black ${roleClass(currentRole)}`}>{roleLabel(currentRole)}</span>
              </div>
              <button type="button" onClick={onOpenFloorPlan} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-extrabold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.99]">
                Mở nhanh dự án đang làm <ArrowRight className="h-4 w-4" />
              </button>
              <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[11px] font-extrabold text-slate-800">Mở thẳng dự án này khi khởi động</span>
                  <span className="mt-0.5 block text-[9.5px] leading-4 text-slate-500">Tắt bất cứ lúc nào để luôn vào Trang chủ.</span>
                </span>
                <input type="checkbox" checked={quickOpenEnabled} onChange={(event) => onStartupProjectChange(event.target.checked ? activeProjectId : '')} className="h-5 w-5 shrink-0 accent-blue-600" />
              </label>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {kpis.map(({ label, value, icon: Icon, tone, detail }) => (
            <article key={label} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${tone}`}><Icon className="h-5 w-5" /></div>
                <div className="text-right text-2xl font-black tabular-nums text-slate-950">{value}</div>
              </div>
              <div className="mt-2 text-xs font-extrabold text-slate-800">{label}</div>
              <div className="mt-0.5 text-[9.5px] font-medium text-slate-400">{detail}</div>
            </article>
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-black text-slate-900"><Building2 className="h-4.5 w-4.5 text-blue-600" /> Dự án của tôi</div>
              <p className="mt-0.5 text-[10px] text-slate-400">Chỉ các dự án tài khoản hiện tại đang có quyền truy cập.</p>
            </div>
            <button type="button" onClick={onManageProjects} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[10px] font-extrabold text-slate-700 hover:bg-slate-100"><Settings2 className="h-3.5 w-3.5" /> Quản lý dự án</button>
          </div>

          {projects.length > 0 ? (
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {projects.map((project) => {
                const active = project.id === activeProjectId;
                const projectRows = reportRows.filter((row) => row.projectId === project.id && row.date === reportEndDate);
                const projectSummary = summarizeCrewReportRows(projectRows)[0];
                const projectFailed = reportFailedProjects.includes(project.name);
                return (
                  <article key={project.id} className={`group overflow-hidden rounded-2xl border transition ${active ? 'border-blue-300 bg-blue-50/40 shadow-sm' : 'border-slate-200 bg-white hover:border-blue-200 hover:shadow-sm'}`}>
                    <div className="h-2 bg-[linear-gradient(90deg,#2563eb,#38bdf8)]" />
                    <div className="p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700"><Building2 className="h-5 w-5" /></div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-slate-900">{project.name}</div>
                            {reportProjects.find((item) => item.projectId === project.id)?.projectLocation && <div className="mt-0.5 truncate text-[9px] font-semibold text-slate-400">{reportProjects.find((item) => item.projectId === project.id)?.projectLocation}</div>}
                            <div className="mt-1 flex items-center gap-1.5"><span className={`rounded-full border px-1.5 py-0.5 text-[8.5px] font-black ${roleClass(project.role)}`}>{roleLabel(project.role)}</span>{active && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[8.5px] font-black text-white">ĐANG MỞ</span>}</div>
                          </div>
                        </div>
                        <MapPin className="h-4 w-4 shrink-0 text-slate-300" />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-1.5">
                        {projectFailed ? (
                          <div className="col-span-3 rounded-lg bg-amber-50 px-2 py-2.5 text-center text-[9.5px] font-semibold text-amber-700">Chưa tải được dữ liệu quân số</div>
                        ) : projectSummary ? (
                          <>
                            <div className="rounded-lg bg-slate-50 px-2 py-2 text-center"><div className="text-sm font-black text-slate-900">{projectSummary.dailyHeadcount}</div><div className="text-[8.5px] text-slate-400">QS ngày</div></div>
                            <div className="rounded-lg bg-slate-50 px-2 py-2 text-center"><div className="text-sm font-black text-emerald-700">{projectSummary.reportedTeams}</div><div className="text-[8.5px] text-slate-400">Đã báo</div></div>
                            <div className="rounded-lg bg-slate-50 px-2 py-2 text-center"><div className="text-sm font-black text-amber-700">{projectSummary.missingTeams}</div><div className="text-[8.5px] text-slate-400">Chưa báo</div></div>
                          </>
                        ) : (
                          <div className="col-span-3 rounded-lg bg-slate-50 px-2 py-2.5 text-center text-[9.5px] font-semibold text-slate-400">{reportLoading ? 'Đang tải quân số...' : 'Chưa có đội / dữ liệu trong ngày'}</div>
                        )}
                      </div>
                      <button type="button" onClick={() => void onOpenProject(project.id)} className={`mt-3 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl text-[10.5px] font-extrabold transition ${active ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'}`}>{active ? 'Tiếp tục dự án' : 'Vào dự án'} <ArrowRight className="h-3.5 w-3.5" /></button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><Building2 className="mx-auto h-8 w-8 text-slate-300" /><div className="mt-2 text-xs font-extrabold text-slate-700">Chưa có dự án đã xác minh</div><div className="mt-1 text-[10px] text-slate-400">Đăng nhập hoặc mở Quản lý dự án để đồng bộ danh sách.</div></div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-black text-slate-900"><Users className="h-4.5 w-4.5 text-emerald-600" /> Báo cáo quân số nhiều dự án</div>
              <p className="mt-0.5 text-[10px] text-slate-400">Tổng hợp quân số theo ngày và theo đội.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setShowReportShare(true)} disabled={filteredReportRows.length === 0 || reportLoading} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-extrabold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"><FileText className="h-3.5 w-3.5" /> Chia sẻ báo cáo quân số</button>
              <button type="button" onClick={onOpenCrew} className="min-h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[10px] font-extrabold text-slate-700 hover:bg-slate-100">Mở mục Quân số</button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ['today', 'Hôm nay'],
              ['yesterday', 'Hôm qua'],
              ['7days', '7 ngày'],
              ['month', 'Tháng này'],
            ].map(([key, label]) => (
              <button key={key} type="button" onClick={() => setPreset(key as 'today' | 'yesterday' | '7days' | 'month')} className={`rounded-xl px-3 py-2 text-[10px] font-extrabold ${reportPreset === key ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{label}</button>
            ))}
            <button type="button" onClick={() => setReportPreset('custom')} className={`rounded-xl px-3 py-2 text-[10px] font-extrabold ${reportPreset === 'custom' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>Khoảng ngày</button>
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[9.5px] font-bold text-slate-500"><span className="block">Từ ngày</span><input type="date" max={todayKey} value={reportStartDate} onChange={(event) => { setReportPreset('custom'); setReportStartDate(event.target.value); if (event.target.value > reportEndDate) setReportEndDate(event.target.value); }} className="mt-1 w-full bg-transparent text-xs font-extrabold text-slate-800 outline-none" /></label>
            <label className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[9.5px] font-bold text-slate-500"><span className="block">Đến ngày</span><input type="date" min={reportStartDate} max={todayKey} value={reportEndDate} onChange={(event) => { setReportPreset('custom'); setReportEndDate(event.target.value); }} className="mt-1 w-full bg-transparent text-xs font-extrabold text-slate-800 outline-none" /></label>
            <label className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[9.5px] font-bold text-slate-500"><span className="block">Dự án</span><select value={reportProjectFilter} onChange={(event) => { setReportProjectFilter(event.target.value); setReportTeamFilter('all'); }} className="mt-1 w-full bg-transparent text-xs font-extrabold text-slate-800 outline-none"><option value="all">Tất cả dự án</option>{reportProjects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}</select></label>
            <label className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[9.5px] font-bold text-slate-500"><span className="block">Đội thi công</span><select value={reportTeamFilter} onChange={(event) => setReportTeamFilter(event.target.value)} className="mt-1 w-full bg-transparent text-xs font-extrabold text-slate-800 outline-none"><option value="all">Tất cả đội</option>{reportTeamOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
          </div>

          {reportLoading && <div className="mt-3 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[10.5px] font-bold text-blue-700"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Đang tải quân số nhiều dự án theo đúng quyền...</div>}
          {reportError && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] font-semibold text-amber-800">{reportError}</div>}

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-[9px] font-bold text-slate-500">Dự án đã tải</div><div className="mt-1 text-xl font-black text-slate-900">{reportProjects.length}</div></div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div className="text-[9px] font-bold text-emerald-700">Đội/ngày đã báo</div><div className="mt-1 text-xl font-black text-emerald-800">{dailySummaries.reduce((sum, item) => sum + item.reportedTeams, 0)}</div></div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="text-[9px] font-bold text-amber-700">Đội/ngày chưa báo</div><div className="mt-1 text-xl font-black text-amber-800">{dailySummaries.reduce((sum, item) => sum + item.missingTeams, 0)}</div></div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3"><div className="text-[9px] font-bold text-blue-700">Dòng báo cáo</div><div className="mt-1 text-xl font-black text-blue-800">{filteredReportRows.length}</div></div>
          </div>

          <div className="mt-3 space-y-3">
            {reportMatrices.map((matrix) => (
              <section key={matrix.projectId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <button type="button" onClick={() => void onOpenProject(matrix.projectId)} className="truncate text-xs font-black text-blue-700 hover:underline">{matrix.projectName}</button>
                    {matrix.projectLocation && <div className="mt-0.5 flex items-center gap-1 truncate text-[9px] font-semibold text-slate-400"><MapPin className="h-3 w-3 shrink-0" /> {matrix.projectLocation}</div>}
                  </div>
                  <div className="text-[9px] font-bold text-slate-400">{matrix.teams.length} đội · {matrix.dates.length} ngày</div>
                </div>
                <div className="relative isolate max-h-[440px] overflow-auto overscroll-contain">
                  <table className="w-full text-left text-xs" style={{ minWidth: `${Math.max(570, 230 + matrix.teams.length * 248)}px` }}>
                    <thead className="bg-slate-100 text-[9px] font-black text-slate-500">
                      <tr className="h-8">
                        <th rowSpan={2} className="sticky left-0 top-0 z-[4] min-w-[118px] border-r border-slate-200 bg-slate-100 px-3 py-2 align-middle">Ngày</th>
                        {matrix.teams.map((team) => <th key={team.teamKey} colSpan={4} className="sticky top-0 z-[3] h-8 border-r border-slate-200 bg-slate-100 px-2 py-0 text-center text-slate-700">{team.teamName}</th>)}
                        <th rowSpan={2} className="sticky top-0 z-[3] min-w-[110px] border-r border-slate-200 bg-blue-50 px-2 py-2 text-center align-middle text-blue-800">Tổng QS/ngày</th>
                      </tr>
                      <tr>
                        {matrix.teams.flatMap((team) => ['Sáng', 'Chiều', 'Tối', 'QS ngày'].map((label) => <th key={`${team.teamKey}-${label}`} className="sticky top-[31px] z-[3] min-w-[62px] border-r border-slate-200 bg-slate-100 px-2 py-1.5 text-center">{label}</th>))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {matrix.dates.map((dateRow) => (
                        <tr key={`${matrix.projectId}-${dateRow.date}`} className="bg-white hover:bg-slate-50">
                          <td className="sticky left-0 z-[1] border-r border-slate-100 bg-white px-3 py-2 font-bold text-slate-700">{formatDateDDMMYYYY(dateRow.date)}</td>
                          {matrix.teams.flatMap((team) => {
                            const row = dateRow.cells[team.teamKey];
                            const values = row?.reported ? [row.morning ?? 0, row.afternoon ?? 0, row.evening ?? 0, row.dailyHeadcount ?? 0] : ['—', '—', '—', '—'];
                            return values.map((value, index) => <td key={`${team.teamKey}-${index}`} className={`border-r border-slate-100 px-2 py-2 text-center tabular-nums ${index === 3 ? 'font-black text-slate-900' : ''}`}>{value}</td>);
                          })}
                          <td className="border-r border-blue-100 bg-blue-50/60 px-2 py-2 text-center font-black tabular-nums text-blue-900">{dateRow.totalDailyHeadcount}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-blue-200 bg-blue-50 font-black text-blue-950">
                        <td className="sticky left-0 z-[1] border-r border-blue-200 bg-blue-50 px-3 py-2">TỔNG</td>
                        {matrix.teams.flatMap((team) => {
                          const total = matrix.teamTotals[team.teamKey] || { morning: 0, afternoon: 0, evening: 0, dailyHeadcount: 0 };
                          return [total.morning, total.afternoon, total.evening, total.dailyHeadcount].map((value, index) => (
                            <td key={`${team.teamKey}-total-${index}`} className="border-r border-blue-100 px-2 py-2 text-center tabular-nums">{value}</td>
                          ));
                        })}
                        <td className="border-r border-blue-200 bg-blue-100 px-2 py-2 text-center tabular-nums">{matrix.grandDailyHeadcount}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            ))}
            {!reportLoading && filteredReportRows.length === 0 && <div className="rounded-2xl border border-slate-200 px-4 py-8 text-center text-xs text-slate-400">Chưa có đội hoặc dữ liệu phù hợp phạm vi đã chọn.</div>}
          </div>
          <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[9.5px] leading-4 text-blue-700">0 = đã báo bằng 0. — = chưa báo. Tổng QS/ngày = tổng QS ngày của các đội trong ngày. Dòng TỔNG cộng theo cột; ô cuối là tổng lượt người-ngày của cả khoảng, không phải số người duy nhất.</div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
          <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-black text-slate-900"><Bell className="h-4.5 w-4.5 text-amber-500" /> Cảnh báo & thao tác nhanh</div><button type="button" onClick={onOpenNotifications} className="text-[10px] font-extrabold text-blue-600 hover:text-blue-700">Xem tất cả</button></div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <button type="button" onClick={onOpenFloorPlan} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left hover:bg-slate-50"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600"><AlertTriangle className="h-4.5 w-4.5" /></span><span className="min-w-0 flex-1"><span className="block text-[11px] font-extrabold text-slate-800">{defectOpenCount} defect chưa nghiệm thu</span><span className="block text-[9.5px] text-slate-400">Mở Mặt bằng / Defect</span></span><ArrowRight className="h-4 w-4 text-slate-300" /></button>
            <button type="button" onClick={onOpenNotifications} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left hover:bg-slate-50"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Clock3 className="h-4.5 w-4.5" /></span><span className="min-w-0 flex-1"><span className="block text-[11px] font-extrabold text-slate-800">{dueAlertCount} mục cần theo dõi hạn</span><span className="block text-[9.5px] text-slate-400">Tiến độ / checklist / defect</span></span><ArrowRight className="h-4 w-4 text-slate-300" /></button>
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-4.5 w-4.5" /></span><span className="min-w-0 flex-1"><span className="block text-[11px] font-extrabold text-slate-800">Phân quyền dự án đang được giữ nguyên</span><span className="block text-[9.5px] text-slate-400">Vai trò hiện tại: {roleLabel(currentRole)}</span></span><ShieldCheck className="h-4 w-4 text-emerald-500" /></div>
          </div>
        </section>

      </div>

      <CrewReportShareModal
        isOpen={showReportShare}
        onClose={() => setShowReportShare(false)}
        projects={reportProjects}
        initialStartDate={reportStartDate}
        initialEndDate={reportEndDate}
        maxDate={todayKey}
        rangeLocked
        title="Báo cáo quân số"
      />
    </div>
  );
};
