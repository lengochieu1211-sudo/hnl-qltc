import React from 'react';
import { Bell, Building2, ChevronRight, FileBarChart2, LayoutDashboard, LockKeyhole, MonitorCog, Wifi, WifiOff } from 'lucide-react';
import { UndoRedoControls } from './UndoRedoControls';
import type { TabType } from './BottomNav';

/**
 * PC presentation only. All business actions are delegated to App's existing handlers.
 * Never read/write Firestore here or replicate application permissions.
 */
export type DesktopWorkspaceMode = 'modern' | 'classic';

const PAGES: Record<TabType, { name: string; hint: string; group: string }> = {
  home: { name: 'Trang chủ', hint: 'Tổng quan công trường', group: 'Tổng quan' },
  floorplan: { name: 'Mặt bằng & Defect', hint: 'Theo dõi tầng, căn, tiến độ và các tồn tại', group: 'Thi công' },
  crew: { name: 'Quân số & Nhật ký', hint: 'Nhân sự, đội thi công và nhật ký hiện trường', group: 'Thi công' },
  warehouse: { name: 'Kho vật tư', hint: 'Danh mục, nhập xuất, tồn kho và chứng từ', group: 'Vật tư & khối lượng' },
  volume: { name: 'Khối lượng', hint: 'Khối lượng thi công và theo dõi thực hiện', group: 'Vật tư & khối lượng' },
  checklist: { name: 'Checklist', hint: 'Danh sách kiểm tra và nghiệm thu', group: 'Thi công' },
  chat: { name: 'Trao đổi', hint: 'Thông tin, tài liệu và liên lạc trong dự án', group: 'Cộng tác' },
  ai: { name: 'HNL AI', hint: 'Hỗ trợ tra cứu, phân tích và công cụ AI', group: 'Công cụ' },
  superadmin: { name: 'Hệ thống', hint: 'Quản trị và cấu hình hệ thống', group: 'Quản trị' },
  config: { name: 'Cài đặt', hint: 'Thiết lập vận hành và dữ liệu dự án', group: 'Quản trị' },
};

export interface DesktopWorkspaceHeaderProps {
  activeTab: TabType;
  mode: DesktopWorkspaceMode;
  onChangeMode: (mode: DesktopWorkspaceMode) => void;
  projectName: string;
  online: boolean;
  userRole: string;
  onOpenProjects: () => void;
  onOpenReports: () => void;
  onOpenNotifications: () => void;
  onOpenSecurity: () => void;
  onNavigate: (tab: TabType) => void;
  showChecklist: boolean;
  showAI: boolean;
  showSuperAdmin: boolean;
  notificationCount: number;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export const DesktopWorkspaceHeader: React.FC<DesktopWorkspaceHeaderProps> = ({
  activeTab, mode, onChangeMode, projectName, online, userRole,
  onOpenProjects, onOpenReports, onOpenNotifications, onOpenSecurity,
  notificationCount, onUndo, onRedo, canUndo, canRedo,
}) => {
  if (activeTab === 'home') return null;
  if (mode === 'classic') return (
    <div className="hnl-pc-classic-return" data-hnl-pc-mode-toggle="classic">
      <MonitorCog size={16} aria-hidden="true" />
      <span>Đang dùng bố cục PC cũ</span>
      <button type="button" onClick={() => onChangeMode('modern')}>Thử giao diện PC mới</button>
    </div>
  );

  const page = PAGES[activeTab];
  const roleLabel = userRole === 'ADMIN' ? 'Quản trị' : userRole === 'EDITOR' ? 'Biên tập' : 'Chỉ xem';
  return (
    <section className="hnl-pc-workspace-heading" data-hnl-pc-workspace-title={activeTab} aria-label={`Không gian làm việc ${page.name}`}>
      <div className="hnl-pc-heading-top">
        <div className="hnl-pc-heading-main">
          <div className="hnl-pc-breadcrumb"><LayoutDashboard size={14} aria-hidden="true" /> HNL QLTC <ChevronRight size={13} aria-hidden="true" /> {page.group} <ChevronRight size={13} aria-hidden="true" /> <strong>{page.name}</strong></div>
          <h1>{page.name}</h1>
          <p>{page.hint}</p>
          <div className="hnl-pc-context-row">
            <span className="hnl-pc-project-tag" title={projectName}><Building2 size={15} aria-hidden="true" /> {projectName || 'Chưa chọn dự án'}</span>
            <span className={`hnl-pc-status ${online ? 'is-online' : 'is-offline'}`}>{online ? <Wifi size={14} aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}{online ? 'Đã kết nối' : 'Ngoại tuyến'}</span>
            <span className="hnl-pc-role">{roleLabel}</span>
          </div>
        </div>
        <div className="hnl-pc-heading-actions" aria-label="Công cụ truy cập nhanh">
          <UndoRedoControls onUndo={onUndo} onRedo={onRedo} canUndo={canUndo} canRedo={canRedo} variant="light" />
          <button type="button" onClick={onOpenProjects}><Building2 size={17} aria-hidden="true" /> Dự án</button>
          <button type="button" onClick={onOpenReports}><FileBarChart2 size={17} aria-hidden="true" /> Báo cáo</button>
          <button type="button" onClick={onOpenNotifications}><Bell size={17} aria-hidden="true" /> Thông báo{notificationCount > 0 && <span className="hnl-pc-alert-count">{notificationCount > 99 ? '99+' : notificationCount}</span>}</button>
          <button type="button" onClick={onOpenSecurity}><LockKeyhole size={17} aria-hidden="true" /> Bảo mật</button>
          <button type="button" className="hnl-pc-mode-switch" onClick={() => onChangeMode('classic')} title="Chỉ khôi phục bố cục PC, không thay đổi dữ liệu"><MonitorCog size={17} aria-hidden="true" /> PC cũ</button>
        </div>
      </div>
    </section>
  );
};
