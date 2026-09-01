import React from 'react';
import {
  ShieldCheck,
  UsersRound,
  FolderKanban,
  Palette,
  BellRing,
  CloudCog,
  DatabaseZap,
  Stethoscope,
  ChevronRight,
} from 'lucide-react';
import { UserRole } from '../utils/securityUtils';
import { getDateFormatPreset } from '../utils/dateFormatter';

interface SuperAdminCenterProps {
  userEmail?: string;
  userRole: UserRole;
  projectName: string;
  projectId: string;
  defectCount: number;
  pendingPhotoCount?: number;
  showChecklist: boolean;
  onOpenProjectManager: () => void;
  onOpenSecurity: () => void;
  onOpenConfig: () => void;
  onOpenNotificationCenter: () => void;
}

export const SuperAdminCenter: React.FC<SuperAdminCenterProps> = ({
  userEmail,
  userRole,
  projectName,
  projectId,
  defectCount,
  pendingPhotoCount = 0,
  showChecklist,
  onOpenProjectManager,
  onOpenSecurity,
  onOpenConfig,
  onOpenNotificationCenter,
}) => {
  const actions = [
    {
      title: 'Người dùng & phân quyền',
      description: 'Mở quản lý quyền truy cập, vai trò và các kiểm soát bảo mật hiện có.',
      icon: UsersRound,
      onClick: onOpenSecurity,
    },
    {
      title: 'Dự án & dữ liệu',
      description: 'Quản lý dự án, backup/khôi phục và phạm vi đồng bộ của dự án hiện tại.',
      icon: FolderKanban,
      onClick: onOpenProjectManager,
    },
    {
      title: 'Giao diện & module',
      description: `Định dạng ngày: ${getDateFormatPreset()} · Checklist: ${showChecklist ? 'đang hiện' : 'tự ẩn khi chưa dùng'}.`,
      icon: Palette,
      onClick: onOpenConfig,
    },
    {
      title: 'Thông báo',
      description: 'Kiểm tra Trung tâm thông báo, Defect mới, hạn xử lý và hoạt động dự án.',
      icon: BellRing,
      onClick: onOpenNotificationCenter,
    },
    {
      title: 'Đồng bộ & R2',
      description: `Ảnh đang chờ: ${pendingPhotoCount}. Mở công cụ hệ thống để kiểm tra đồng bộ và chẩn đoán.`,
      icon: CloudCog,
      onClick: onOpenConfig,
    },
    {
      title: 'Chẩn đoán hệ thống',
      description: 'Mở trạng thái Firebase/R2, chẩn đoán, export diagnostic và công cụ phục hồi.',
      icon: Stethoscope,
      onClick: onOpenConfig,
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-5 pb-24 space-y-4">
      <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white p-5 shadow-xl border border-indigo-800/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-400/15 border border-amber-300/30 px-3 py-1 text-[11px] font-extrabold text-amber-200">
              <ShieldCheck className="w-4 h-4" /> CHỈ SUPER ADMIN
            </div>
            <h2 className="mt-3 text-xl font-black">Quản trị hệ thống</h2>
            <p className="mt-1 text-xs text-slate-300 max-w-2xl">
              Bảng điều khiển riêng cho các chức năng cấp hệ thống. Việc hiển thị mục này không thay thế kiểm tra quyền ở handler/Firebase Rules.
            </p>
          </div>
          <ShieldCheck className="w-11 h-11 text-amber-300 shrink-0" />
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <div className="rounded-2xl bg-white/8 border border-white/10 p-3"><div className="text-slate-400">Tài khoản</div><div className="mt-1 font-bold truncate">{userEmail || '—'}</div></div>
          <div className="rounded-2xl bg-white/8 border border-white/10 p-3"><div className="text-slate-400">Vai trò dự án</div><div className="mt-1 font-bold">{userRole}</div></div>
          <div className="rounded-2xl bg-white/8 border border-white/10 p-3"><div className="text-slate-400">Defect</div><div className="mt-1 font-bold">{defectCount}</div></div>
          <div className="rounded-2xl bg-white/8 border border-white/10 p-3"><div className="text-slate-400">Project ID</div><div className="mt-1 font-mono font-bold truncate">{projectId || '—'}</div></div>
        </div>
      </section>

      <section>
        <div className="mb-2 px-1">
          <h3 className="text-sm font-extrabold text-slate-900">{projectName || 'Dự án hiện tại'}</h3>
          <p className="text-[11px] text-slate-500">Các mục quản trị được gom về một nơi; dữ liệu và quyền hiện có vẫn giữ nguyên.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {actions.map(({ title, description, icon: Icon, onClick }) => (
            <button
              key={title}
              type="button"
              onClick={onClick}
              className="group text-left rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all"
            >
              <div className="flex gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2"><span className="font-extrabold text-sm text-slate-900">{title}</span><ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500" /></div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start gap-3">
          <DatabaseZap className="w-5 h-5 text-emerald-600 shrink-0" />
          <div><div className="text-xs font-extrabold text-slate-800">Nguyên tắc an toàn</div><p className="mt-1 text-[11px] text-slate-500">Tùy chỉnh giao diện chỉ thay đổi cách hiển thị. Phân quyền thật, xóa dữ liệu, migration và thao tác cloud vẫn phải được kiểm tra riêng ở handler và Firebase Rules.</p></div>
        </div>
      </section>
    </div>
  );
};
