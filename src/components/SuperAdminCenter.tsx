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
  ImageIcon,
  Type,
  MonitorSmartphone,
  MousePointerClick,
} from 'lucide-react';
import { UserRole } from '../utils/securityUtils';
import { getDateFormatPreset } from '../utils/dateFormatter';

export interface SuperAdminUiSettings {
  scalePercent: number;
  checklistVisibility: 'auto' | 'always';
  theme: 'light' | 'dark' | 'system';
  primaryColor: string;
  secondaryColor: string;
  buttonSize: 'compact' | 'standard' | 'large';
  iconSize: 'small' | 'standard' | 'large';
  density: 'compact' | 'standard' | 'comfortable';
  borderRadius: 'square' | 'soft' | 'round';
  appDisplayName: string;
  logoUrl: string;
}

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
  onOpenHiddenHistory: () => void;
  onOpenNotificationCenter: () => void;
  uiSettings: SuperAdminUiSettings;
  onPreviewUiSettings: (settings: SuperAdminUiSettings) => void;
  onSaveUiSettings: (settings: SuperAdminUiSettings) => Promise<void>;
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
  onOpenHiddenHistory,
  onOpenNotificationCenter,
  uiSettings,
  onPreviewUiSettings,
  onSaveUiSettings,
  onResetUiSettings,
}) => {
  const [showUiSettings, setShowUiSettings] = useState(false);
  const [draftUi, setDraftUi] = useState<SuperAdminUiSettings>(uiSettings);
  const [savingUi, setSavingUi] = useState(false);
  const [uiMessage, setUiMessage] = useState('');

  useEffect(() => setDraftUi(uiSettings), [uiSettings]);

  const updateDraft = (patch: Partial<SuperAdminUiSettings>) => {
    const next = { ...draftUi, ...patch };
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
      description: 'Mở quản lý quyền truy cập, vai trò, reset PIN từ xa và các kiểm soát bảo mật.',
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
      title: 'Dữ liệu đã ẩn & lịch sử',
      description: 'Khôi phục hoặc dọn dữ liệu đã xóa: Căn/Phòng, Hạng mục, Định mức, Phiếu nhập/xuất kho, Mặt bằng, Defect, Checklist, Quân số và Đội thi công.',
      icon: DatabaseZap,
      onClick: onOpenHiddenHistory,
    },
    {
      title: 'Giao diện & module',
      description: `Theme: ${uiSettings.theme} · Cỡ ${uiSettings.scalePercent}% · Checklist: ${showChecklist ? 'đang hiện' : 'tự ẩn'}.`,
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
            <button key={title} type="button" onClick={onClick} className="group text-left rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all">
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
            <div><h3 className="text-sm font-black text-indigo-950">Giao diện & Module · V2</h3><p className="text-[10px] text-indigo-700 mt-0.5">Xem trước tức thời. Chỉ khi bấm “Áp dụng & Lưu” mới đồng bộ Cloud.</p></div>
            <button type="button" onClick={() => { setShowUiSettings(false); onPreviewUiSettings(uiSettings); }} className="text-[11px] font-bold text-slate-500 px-2 py-1 rounded-lg hover:bg-white">Đóng</button>
          </div>

          <div className="p-4 space-y-5">
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-slate-200 p-3 space-y-3">
                <div className="flex items-center gap-2"><ImageIcon className="w-4 h-4 text-indigo-600"/><h4 className="text-xs font-black text-slate-800">Nhận diện ứng dụng</h4></div>
                <label className="block space-y-1"><span className="text-[10px] font-bold text-slate-600">Tên hiển thị</span><input value={draftUi.appDisplayName} maxLength={40} onChange={(e) => updateDraft({ appDisplayName: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs" placeholder="HNL QLTC" /></label>
                <label className="block space-y-1"><span className="text-[10px] font-bold text-slate-600">Logo URL (HTTPS)</span><input value={draftUi.logoUrl} onChange={(e) => updateDraft({ logoUrl: e.target.value })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs" placeholder="https://.../logo.png · để trống dùng logo mặc định" /></label>
                <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 p-3"><div className="w-12 h-12 rounded-xl bg-white border border-slate-200 overflow-hidden flex items-center justify-center"><img src={draftUi.logoUrl || '/icon.png'} onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/icon.png'; }} className="w-full h-full object-contain" alt="Preview logo" /></div><div><div className="text-xs font-black text-slate-800">{draftUi.appDisplayName || 'HNL QLTC'}</div><div className="text-[10px] text-slate-500">Preview logo + tên ứng dụng</div></div></div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-3 space-y-3">
                <div className="flex items-center gap-2"><Palette className="w-4 h-4 text-indigo-600"/><h4 className="text-xs font-black text-slate-800">Theme & màu sắc</h4></div>
                <label className="block space-y-1"><span className="text-[10px] font-bold text-slate-600">Theme</span><select value={draftUi.theme} onChange={(e) => updateDraft({ theme: e.target.value as SuperAdminUiSettings['theme'] })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"><option value="system">Theo hệ thống</option><option value="light">Sáng</option><option value="dark">Tối</option></select></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1"><span className="text-[10px] font-bold text-slate-600">Màu chủ đạo</span><div className="flex gap-2"><input type="color" value={draftUi.primaryColor} onChange={(e) => updateDraft({ primaryColor: e.target.value })} className="w-11 h-10 rounded-lg border border-slate-300 p-1"/><input value={draftUi.primaryColor} onChange={(e) => updateDraft({ primaryColor: e.target.value })} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-[10px] font-mono"/></div></label>
                  <label className="space-y-1"><span className="text-[10px] font-bold text-slate-600">Màu phụ</span><div className="flex gap-2"><input type="color" value={draftUi.secondaryColor} onChange={(e) => updateDraft({ secondaryColor: e.target.value })} className="w-11 h-10 rounded-lg border border-slate-300 p-1"/><input value={draftUi.secondaryColor} onChange={(e) => updateDraft({ secondaryColor: e.target.value })} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-[10px] font-mono"/></div></label>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-3 space-y-3">
                <div className="flex items-center gap-2"><Type className="w-4 h-4 text-indigo-600"/><h4 className="text-xs font-black text-slate-800">Chữ & mật độ</h4></div>
                <label className="space-y-1 block"><span className="text-[10px] font-bold text-slate-600">Cỡ chữ / tỷ lệ giao diện</span><select value={draftUi.scalePercent} onChange={(e) => updateDraft({ scalePercent: Number(e.target.value) })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"><option value={90}>90% · Nhỏ</option><option value={100}>100% · Tiêu chuẩn</option><option value={110}>110% · Lớn</option><option value={120}>120% · Rất lớn</option></select></label>
                <label className="space-y-1 block"><span className="text-[10px] font-bold text-slate-600">Mật độ giao diện</span><select value={draftUi.density} onChange={(e) => updateDraft({ density: e.target.value as SuperAdminUiSettings['density'] })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"><option value="compact">Gọn</option><option value="standard">Tiêu chuẩn</option><option value="comfortable">Thoáng / dễ chạm</option></select></label>
                <label className="space-y-1 block"><span className="text-[10px] font-bold text-slate-600">Bo góc</span><select value={draftUi.borderRadius} onChange={(e) => updateDraft({ borderRadius: e.target.value as SuperAdminUiSettings['borderRadius'] })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"><option value="square">Vuông</option><option value="soft">Mềm</option><option value="round">Bo tròn</option></select></label>
              </div>

              <div className="rounded-2xl border border-slate-200 p-3 space-y-3">
                <div className="flex items-center gap-2"><MousePointerClick className="w-4 h-4 text-indigo-600"/><h4 className="text-xs font-black text-slate-800">Nút, icon & module</h4></div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1"><span className="text-[10px] font-bold text-slate-600">Kích thước nút</span><select value={draftUi.buttonSize} onChange={(e) => updateDraft({ buttonSize: e.target.value as SuperAdminUiSettings['buttonSize'] })} className="w-full rounded-xl border border-slate-300 px-2 py-2 text-xs"><option value="compact">Nhỏ</option><option value="standard">Chuẩn</option><option value="large">Lớn</option></select></label>
                  <label className="space-y-1"><span className="text-[10px] font-bold text-slate-600">Kích thước icon</span><select value={draftUi.iconSize} onChange={(e) => updateDraft({ iconSize: e.target.value as SuperAdminUiSettings['iconSize'] })} className="w-full rounded-xl border border-slate-300 px-2 py-2 text-xs"><option value="small">Nhỏ</option><option value="standard">Chuẩn</option><option value="large">Lớn</option></select></label>
                </div>
                <label className="space-y-1 block"><span className="text-[10px] font-bold text-slate-600">Hiển thị Checklist</span><select value={draftUi.checklistVisibility} onChange={(e) => updateDraft({ checklistVisibility: e.target.value as SuperAdminUiSettings['checklistVisibility'] })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"><option value="auto">Tự ẩn khi chưa có dữ liệu</option><option value="always">Luôn hiện module Checklist</option></select></label>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-2 mb-2"><MonitorSmartphone className="w-4 h-4 text-indigo-600"/><span className="text-[11px] font-black text-slate-700">Preview Mobile / PC</span></div>
              <div className="grid sm:grid-cols-2 gap-2">
                <div className="rounded-xl border border-slate-300 bg-white p-3"><div className="text-[9px] text-slate-400">Điện thoại</div><div className="mt-2 h-20 rounded-lg border border-slate-200 p-2" style={{ borderRadius: draftUi.borderRadius === 'square' ? 2 : draftUi.borderRadius === 'round' ? 18 : 10 }}><div className="h-3 w-2/3 rounded" style={{ backgroundColor: draftUi.primaryColor }}></div><div className="mt-2 h-2 w-full bg-slate-200 rounded"></div><div className="mt-2 h-7 w-20 text-white text-[9px] flex items-center justify-center" style={{ backgroundColor: draftUi.secondaryColor, borderRadius: 8 }}>Nút mẫu</div></div></div>
                <div className="rounded-xl border border-slate-300 bg-white p-3"><div className="text-[9px] text-slate-400">PC</div><div className="mt-2 h-20 rounded-lg border border-slate-200 p-2 flex gap-2"><div className="w-1/4 rounded bg-slate-100"></div><div className="flex-1"><div className="h-3 w-1/2 rounded" style={{ backgroundColor: draftUi.primaryColor }}></div><div className="mt-2 h-2 w-full bg-slate-200 rounded"></div><div className="mt-2 h-2 w-3/4 bg-slate-200 rounded"></div></div></div></div>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex flex-wrap gap-2 items-center justify-between">
              <div className="text-[10px] text-slate-500">Định dạng ngày vẫn dùng nguồn chuẩn Cài đặt → Cấu hình để không có hai nguồn cấu hình.</div>
              <button type="button" onClick={onOpenConfig} className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-[10px] font-extrabold text-slate-700">Mở cấu hình ngày · {getDateFormatPreset()}</button>
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
          <div><div className="text-xs font-extrabold text-slate-800">Nguyên tắc an toàn</div><p className="mt-1 text-[11px] text-slate-500">Logo chỉ chấp nhận URL HTTPS hoặc đường dẫn nội bộ; cấu hình giao diện không thay đổi RBAC, dữ liệu nghiệp vụ hay Firebase Rules.</p></div>
        </div>
      </section>
    </div>
  );
};
