import React, { useEffect, useState } from 'react';
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
  uiSettings: { scalePercent: number; checklistVisibility: 'auto' | 'always'; };
  onPreviewUiSettings: (settings: { scalePercent: number; checklistVisibility: 'auto' | 'always' }) => void;
  onSaveUiSettings: (settings: { scalePercent: number; checklistVisibility: 'auto' | 'always' }) => Promise<void>;
  onResetUiSettings: () => Promise<void>;
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
  uiSettings,
  onPreviewUiSettings,
  onSaveUiSettings,
  onResetUiSettings,
}) => {
  const [showUiSettings, setShowUiSettings] = useState(false);
  const [draftUi, setDraftUi] = useState(uiSettings);
  const [savingUi, setSavingUi] = useState(false);
  const [uiMessage, setUiMessage] = useState('');

  useEffect(() => setDraftUi(uiSettings), [uiSettings.scalePercent, uiSettings.checklistVisibility]);

  const updateDraft = (next: typeof draftUi) => {
    setDraftUi(next);
    onPreviewUiSettings(next);
    setUiMessage('Đang xem trước — chưa lưu lên Cloud.');
  };

  const saveDraft = async () => {
    setSavingUi(true);
    setUiMessage('');
    try {
      await onSaveUiSettings(draftUi);
      setUiMessage('Đã lưu giao diện cho dự án.');
    } catch (err: any) {
      setUiMessage(`Không lưu được: ${err?.message || err}`);
    } finally { setSavingUi(false); }
  };

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
      onClick: () => setShowUiSettings(true),
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

      {showUiSettings && (
        <section className="rounded-3xl border border-indigo-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between gap-3">
            <div><h3 className="text-sm font-black text-indigo-950">Giao diện & Module</h3><p className="text-[10px] text-indigo-700 mt-0.5">Chỉ thay đổi cách hiển thị, không thay đổi quyền hay dữ liệu.</p></div>
            <button type="button" onClick={() => { setShowUiSettings(false); onPreviewUiSettings(uiSettings); }} className="text-[11px] font-bold text-slate-500 px-2 py-1 rounded-lg hover:bg-white">Đóng</button>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-[11px] font-extrabold text-slate-700">Tỷ lệ giao diện toàn ứng dụng</span>
                <select value={draftUi.scalePercent} onChange={(e) => updateDraft({ ...draftUi, scalePercent: Number(e.target.value) })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold">
                  <option value={90}>90% · Gọn</option><option value={100}>100% · Tiêu chuẩn</option><option value={110}>110% · Dễ đọc</option><option value={120}>120% · Chữ/nút lớn</option>
                </select>
                <p className="text-[10px] text-slate-400">Xem trước áp dụng ngay trên thiết bị hiện tại.</p>
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-extrabold text-slate-700">Hiển thị Checklist</span>
                <select value={draftUi.checklistVisibility} onChange={(e) => updateDraft({ ...draftUi, checklistVisibility: e.target.value as 'auto' | 'always' })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold">
                  <option value="auto">Tự ẩn khi chưa có dữ liệu</option><option value="always">Luôn hiện module Checklist</option>
                </select>
                <p className="text-[10px] text-slate-400">Không xóa Checklist; chỉ điều khiển menu hiển thị.</p>
              </label>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex flex-wrap gap-2 items-center justify-between">
              <div className="text-[10px] text-slate-500">Định dạng ngày vẫn dùng nguồn chuẩn trong Cài đặt → Cấu hình để tránh tạo hai cấu hình khác nhau.</div>
              <button type="button" onClick={onOpenConfig} className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-[10px] font-extrabold text-slate-700">Mở cấu hình ngày</button>
            </div>
            {uiMessage && <div className="text-[10px] font-semibold text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{uiMessage}</div>}
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" disabled={savingUi} onClick={async () => { setSavingUi(true); try { await onResetUiSettings(); setUiMessage('Đã khôi phục mặc định.'); } finally { setSavingUi(false); } }} className="px-3 py-2 rounded-xl border border-slate-300 text-[11px] font-bold text-slate-600 disabled:opacity-50">Khôi phục mặc định</button>
              <button type="button" disabled={savingUi} onClick={() => void saveDraft()} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-[11px] font-extrabold shadow-sm disabled:opacity-50">{savingUi ? 'Đang lưu…' : 'Áp dụng & Lưu'}</button>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start gap-3">
          <DatabaseZap className="w-5 h-5 text-emerald-600 shrink-0" />
          <div><div className="text-xs font-extrabold text-slate-800">Nguyên tắc an toàn</div><p className="mt-1 text-[11px] text-slate-500">Tùy chỉnh giao diện chỉ thay đổi cách hiển thị. Phân quyền thật, xóa dữ liệu, migration và thao tác cloud vẫn phải được kiểm tra riêng ở handler và Firebase Rules.</p></div>
        </div>
      </section>
    </div>
  );
};
