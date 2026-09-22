import React, { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  HardHat,
  MapPin,
  Settings2,
  ShieldCheck,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { CrewRecord } from '../types';
import { UserRole } from '../utils/securityUtils';
import { formatDateTime } from '../utils/dateFormatter';

export interface HomeProjectSummary {
  id: string;
  name: string;
  role?: UserRole;
}

interface HomeDashboardProps {
  projects: HomeProjectSummary[];
  activeProjectId: string;
  activeProjectName: string;
  currentRole: UserRole;
  defectOpenCount: number;
  dueAlertCount: number;
  crewRecords: CrewRecord[];
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

const maxByTeam = (records: CrewRecord[], field: 'workerCount' | 'morningCount' | 'afternoonCount' | 'eveningCount') => {
  const values = new Map<string, number>();
  for (const record of records) {
    const key = String(record.teamId || record.teamName || record.id || '').trim().toLocaleLowerCase('vi-VN');
    if (!key) continue;
    const value = Math.max(0, Number(record[field] || 0));
    values.set(key, Math.max(values.get(key) || 0, value));
  }
  return Array.from(values.values()).reduce((sum, value) => sum + value, 0);
};

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  projects,
  activeProjectId,
  activeProjectName,
  currentRole,
  defectOpenCount,
  dueAlertCount,
  crewRecords,
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
  const todayRecords = useMemo(
    () => crewRecords.filter((record) => String(record.date || '').slice(0, 10) === todayKey),
    [crewRecords, todayKey],
  );
  const crewStats = useMemo(() => ({
    total: maxByTeam(todayRecords, 'workerCount'),
    morning: maxByTeam(todayRecords, 'morningCount'),
    afternoon: maxByTeam(todayRecords, 'afternoonCount'),
    evening: maxByTeam(todayRecords, 'eveningCount'),
    teams: new Set(todayRecords.map((record) => record.teamId || record.teamName).filter(Boolean)).size,
  }), [todayRecords]);
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const quickOpenEnabled = startupProjectId === activeProjectId && Boolean(activeProjectId);

  const kpis = [
    { label: 'Dự án của tôi', value: projects.length, icon: Building2, tone: 'text-blue-700 bg-blue-50 border-blue-100', detail: 'Đã xác minh quyền truy cập' },
    { label: 'Defect đang mở', value: defectOpenCount, icon: AlertTriangle, tone: 'text-rose-700 bg-rose-50 border-rose-100', detail: 'Dự án đang mở' },
    { label: 'Quân số hôm nay', value: crewStats.total, icon: Users, tone: 'text-emerald-700 bg-emerald-50 border-emerald-100', detail: `${crewStats.teams} đội thi công` },
    { label: 'Cần chú ý', value: dueAlertCount, icon: Activity, tone: 'text-amber-700 bg-amber-50 border-amber-100', detail: 'Hạn / quá hạn hiện tại' },
  ];

  return (
    <div className="min-h-[calc(100vh-9rem)] bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.10),_transparent_34%),linear-gradient(180deg,#f8fafc_0%,#eef4fb_100%)] px-3 py-3 sm:px-4 sm:py-4 lg:px-5 lg:py-5">
      <div className="mx-auto max-w-[1680px] space-y-4">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-0 xl:grid-cols-[1fr_420px]">
            <div className="relative overflow-hidden p-4 sm:p-5 lg:p-6">
              <div className="absolute inset-y-0 right-0 hidden w-[46%] bg-[linear-gradient(135deg,transparent_0%,rgba(59,130,246,0.08)_46%,rgba(14,165,233,0.14)_100%)] lg:block" />
              <div className="relative z-10 max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[11px] font-extrabold text-blue-700">
                  <HardHat className="h-3.5 w-3.5" /> Trung tâm điều hành HNL QLTC
                </div>
                <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Xin chào, sẵn sàng cho công trường hôm nay.</h1>
                <p className="mt-1.5 max-w-2xl text-xs font-medium leading-5 text-slate-500 sm:text-sm">
                  Chọn dự án cần làm việc, xem nhanh quân số, defect và cảnh báo. Home chỉ hiển thị dữ liệu đã được xác minh theo quyền của tài khoản.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-600">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${isOnline ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                    {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                    {isOnline ? (isSyncing ? 'Đang đồng bộ' : 'Đã kết nối') : 'Offline · dùng dữ liệu đã xác minh'}
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
                </div>
                <span className={`rounded-full border px-2 py-1 text-[9px] font-black ${roleClass(currentRole)}`}>{roleLabel(currentRole)}</span>
              </div>
              <button type="button" onClick={onOpenFloorPlan} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-extrabold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.99]">
                Mở nhanh dự án đang làm <ArrowRight className="h-4 w-4" />
              </button>
              <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[11px] font-extrabold text-slate-800">Mở thẳng dự án này khi khởi động</span>
                  <span className="mt-0.5 block text-[9.5px] leading-4 text-slate-500">Tắt bất cứ lúc nào để luôn vào Home.</span>
                </span>
                <input
                  type="checkbox"
                  checked={quickOpenEnabled}
                  onChange={(event) => onStartupProjectChange(event.target.checked ? activeProjectId : '')}
                  className="h-5 w-5 shrink-0 accent-blue-600"
                />
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
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-black text-slate-900"><Building2 className="h-4.5 w-4.5 text-blue-600" /> Dự án của tôi</div>
              <p className="mt-0.5 text-[10px] text-slate-400">Chỉ các dự án tài khoản hiện tại đang có quyền truy cập.</p>
            </div>
            <button type="button" onClick={onManageProjects} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[10px] font-extrabold text-slate-700 hover:bg-slate-100">
              <Settings2 className="h-3.5 w-3.5" /> Quản lý dự án
            </button>
          </div>

          {projects.length > 0 ? (
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {projects.map((project) => {
                const active = project.id === activeProjectId;
                return (
                  <article key={project.id} className={`group overflow-hidden rounded-2xl border transition ${active ? 'border-blue-300 bg-blue-50/40 shadow-sm' : 'border-slate-200 bg-white hover:border-blue-200 hover:shadow-sm'}`}>
                    <div className="h-2 bg-[linear-gradient(90deg,#2563eb,#38bdf8)]" />
                    <div className="p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700"><Building2 className="h-5 w-5" /></div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-slate-900">{project.name}</div>
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className={`rounded-full border px-1.5 py-0.5 text-[8.5px] font-black ${roleClass(project.role)}`}>{roleLabel(project.role)}</span>
                              {active && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[8.5px] font-black text-white">ĐANG MỞ</span>}
                            </div>
                          </div>
                        </div>
                        <MapPin className="h-4 w-4 shrink-0 text-slate-300" />
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-1.5">
                        {active ? (
                          <>
                            <div className="rounded-lg bg-slate-50 px-2 py-2 text-center"><div className="text-sm font-black text-slate-900">{defectOpenCount}</div><div className="text-[8.5px] text-slate-400">Defect</div></div>
                            <div className="rounded-lg bg-slate-50 px-2 py-2 text-center"><div className="text-sm font-black text-slate-900">{crewStats.total}</div><div className="text-[8.5px] text-slate-400">Quân số</div></div>
                            <div className="rounded-lg bg-slate-50 px-2 py-2 text-center"><div className="text-sm font-black text-slate-900">{dueAlertCount}</div><div className="text-[8.5px] text-slate-400">Cần chú ý</div></div>
                          </>
                        ) : (
                          <div className="col-span-3 rounded-lg bg-slate-50 px-2 py-2.5 text-center text-[9.5px] font-semibold text-slate-400">Mở dự án để tải số liệu chi tiết</div>
                        )}
                      </div>

                      <button type="button" onClick={() => void onOpenProject(project.id)} className={`mt-3 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl text-[10.5px] font-extrabold transition ${active ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'}`}>
                        {active ? 'Tiếp tục dự án' : 'Vào dự án'} <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <Building2 className="mx-auto h-8 w-8 text-slate-300" />
              <div className="mt-2 text-xs font-extrabold text-slate-700">Chưa có dự án đã xác minh</div>
              <div className="mt-1 text-[10px] text-slate-400">Đăng nhập hoặc mở Quản lý dự án để đồng bộ danh sách.</div>
            </div>
          )}
        </section>

        <section className="grid gap-3 xl:grid-cols-[1.25fr_0.75fr]">
          <article className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-black text-slate-900"><Users className="h-4.5 w-4.5 text-emerald-600" /> Báo cáo quân số</div>
                <p className="mt-0.5 text-[10px] text-slate-400">Dữ liệu chi tiết của dự án đang mở · không cộng trùng người giữa các ca.</p>
              </div>
              <button type="button" onClick={onOpenCrew} className="min-h-9 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-extrabold text-emerald-700 hover:bg-emerald-100">Xem chi tiết</button>
            </div>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-[150px_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="text-[10px] font-bold text-slate-500">Tổng quân số hôm nay</div>
                <div className="mt-1 text-3xl font-black tabular-nums text-slate-950">{crewStats.total}</div>
                <div className="mt-1 text-[9.5px] font-semibold text-slate-400">{crewStats.teams} đội có ghi nhận</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['Sáng', crewStats.morning, 'bg-sky-500'],
                  ['Chiều', crewStats.afternoon, 'bg-teal-500'],
                  ['Tối', crewStats.evening, 'bg-violet-500'],
                ].map(([label, value, barClass]) => {
                  const num = Number(value || 0);
                  const width = crewStats.total > 0 ? Math.min(100, Math.round((num / crewStats.total) * 100)) : 0;
                  return (
                    <div key={String(label)} className="rounded-2xl border border-slate-200 p-3">
                      <div className="text-[9.5px] font-bold text-slate-500">{label}</div>
                      <div className="mt-1 text-xl font-black tabular-nums text-slate-900">{num}</div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${barClass}`} style={{ width: `${width}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[9.5px] leading-4 text-blue-700">
              Báo cáo nhiều dự án sẽ dùng dữ liệu tổng hợp theo quyền và tải theo yêu cầu; Home không tự tải toàn bộ Defect/ảnh/nhật ký của mọi dự án để tránh nặng máy và tránh mở rộng phạm vi dữ liệu ngoài nhu cầu.
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-black text-slate-900"><Bell className="h-4.5 w-4.5 text-amber-500" /> Cảnh báo & thao tác nhanh</div>
              <button type="button" onClick={onOpenNotifications} className="text-[10px] font-extrabold text-blue-600 hover:text-blue-700">Xem tất cả</button>
            </div>
            <div className="mt-3 space-y-2">
              <button type="button" onClick={onOpenFloorPlan} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left hover:bg-slate-50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600"><AlertTriangle className="h-4.5 w-4.5" /></span>
                <span className="min-w-0 flex-1"><span className="block text-[11px] font-extrabold text-slate-800">{defectOpenCount} defect chưa nghiệm thu</span><span className="block text-[9.5px] text-slate-400">Mở Mặt bằng / Defect</span></span>
                <ArrowRight className="h-4 w-4 text-slate-300" />
              </button>
              <button type="button" onClick={onOpenNotifications} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left hover:bg-slate-50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Clock3 className="h-4.5 w-4.5" /></span>
                <span className="min-w-0 flex-1"><span className="block text-[11px] font-extrabold text-slate-800">{dueAlertCount} mục cần theo dõi hạn</span><span className="block text-[9.5px] text-slate-400">Tiến độ / checklist / defect</span></span>
                <ArrowRight className="h-4 w-4 text-slate-300" />
              </button>
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-4.5 w-4.5" /></span>
                <span className="min-w-0 flex-1"><span className="block text-[11px] font-extrabold text-slate-800">Phân quyền dự án đang được giữ nguyên</span><span className="block text-[9.5px] text-slate-400">Vai trò hiện tại: {roleLabel(currentRole)}</span></span>
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
              </div>
            </div>
          </article>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1 text-[9px] font-semibold text-slate-400">
          <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Home dùng dữ liệu thật của dự án đang mở; không hiển thị số liệu giả cho dự án chưa tải.</span>
          <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Firebase / R2 / projectId / RBAC không thay đổi.</span>
        </div>
      </div>
    </div>
  );
};
