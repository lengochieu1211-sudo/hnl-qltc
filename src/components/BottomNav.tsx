import React, { useState } from 'react';
import {
  BarChart3,
  ClipboardCheck,
  LayoutDashboard,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  PackageCheck,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export type TabType = 'home' | 'warehouse' | 'volume' | 'floorplan' | 'checklist' | 'crew' | 'chat' | 'ai' | 'config' | 'superadmin';

interface BottomNavProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  defectBadgeCount: number;
  chatBadgeCount?: number;
  showChecklist?: boolean;
  showAi?: boolean;
  showSuperAdmin?: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  setActiveTab,
  defectBadgeCount,
  chatBadgeCount = 0,
  showChecklist = true,
  showAi = false,
  showSuperAdmin = false,
}) => {
  const { t } = useLanguage();
  const [showMore, setShowMore] = useState(false);

  const desktopTabs = [
    { id: 'home' as TabType, label: 'Trang chủ', icon: LayoutDashboard },
    { id: 'floorplan' as TabType, label: t('floorplan'), icon: MapPin, badge: defectBadgeCount, badgeLabel: 'Defect chưa xử lý' },
    { id: 'crew' as TabType, label: t('crew'), icon: Users },
    { id: 'warehouse' as TabType, label: t('warehouse'), icon: PackageCheck },
    { id: 'volume' as TabType, label: t('volume'), icon: BarChart3 },
  ];

  const mobileTabs = [
    { id: 'home' as TabType, label: 'Trang chủ', icon: LayoutDashboard },
    { id: 'floorplan' as TabType, label: t('floorplan'), icon: MapPin, badge: defectBadgeCount, badgeLabel: 'Defect chưa xử lý' },
    { id: 'crew' as TabType, label: t('crew'), icon: Users },
    { id: 'warehouse' as TabType, label: t('warehouse'), icon: PackageCheck },
  ];

  const activate = (tab: TabType) => {
    setShowMore(false);
    setActiveTab(tab);
  };

  const renderBadge = (badge?: number, badgeLabel?: string) => badge !== undefined && badge > 0 ? (
    <span
      className="absolute -top-1.5 -right-2 rounded-full border border-white bg-rose-600 px-1 text-[8px] font-black leading-4 text-white min-w-4 text-center"
      title={`${badge} ${badgeLabel || 'thông báo'}`}
    >
      {badge > 99 ? '99+' : badge}
    </span>
  ) : null;

  return (
    <>
      {/* PC/Laptop: same light navigation language as the mobile bottom bar, moved to the left rail. */}
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[84px] flex-col border-r border-slate-200 bg-white text-slate-700 shadow-sm lg:flex">
        <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto px-1.5 py-2 no-scrollbar" aria-label="Điều hướng chính HNL QLTC">
          {desktopTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => activate(tab.id)}
                title={tab.badge !== undefined && tab.badge > 0 ? `${tab.label}: ${tab.badge} ${tab.badgeLabel || ''}` : tab.label}
                aria-label={tab.label}
                className={`group relative flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 transition ${active ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
              >
                <span className="relative">
                  <Icon className={`h-5 w-5 ${active ? 'scale-110' : 'group-hover:scale-105'} transition-transform`} />
                  {tab.badge !== undefined && tab.badge > 0 ? (
                    <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full border border-slate-900 bg-rose-600 px-1 text-center text-[8px] font-black leading-4 text-white" title={`${tab.badge} ${tab.badgeLabel || 'Defect chưa xử lý'}`}>D{tab.badge}</span>
                  ) : null}
                </span>
                <span className="max-w-full truncate text-[9px] font-bold leading-3">{tab.label}</span>
              </button>
            );
          })}

          {showChecklist && (
            <button type="button" onClick={() => activate('checklist')} className={`group relative flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 transition ${activeTab === 'checklist' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`} title="Checklist">
              <ClipboardCheck className="h-5 w-5" /><span className="text-[9px] font-bold">Checklist</span>
            </button>
          )}

          <button type="button" onClick={() => activate('chat')} className={`group relative flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 transition ${activeTab === 'chat' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`} title="Trao đổi">
            <span className="relative"><MessageCircle className="h-5 w-5" />{renderBadge(chatBadgeCount, 'tin chưa đọc')}</span><span className="text-[9px] font-bold">Trao đổi</span>
          </button>

          {showAi && (
            <button type="button" onClick={() => activate('ai')} className={`group relative flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 transition ${activeTab === 'ai' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`} title="HNL AI Assistant">
              <Sparkles className="h-5 w-5" /><span className="text-[9px] font-bold">HNL AI</span>
            </button>
          )}
        </nav>

        <div className="space-y-1 border-t border-slate-200 px-1.5 py-2">
          {showSuperAdmin && (
            <button type="button" onClick={() => activate('superadmin')} className={`flex min-h-[58px] w-full flex-col items-center justify-center gap-1 rounded-2xl transition ${activeTab === 'superadmin' ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-200' : 'text-amber-700 hover:bg-amber-50'}`} title="Quản trị hệ thống">
              <ShieldCheck className="h-5 w-5" /><span className="text-[8.5px] font-bold">Hệ thống</span>
            </button>
          )}
          <button type="button" onClick={() => activate('config')} className={`flex min-h-[58px] w-full flex-col items-center justify-center gap-1 rounded-2xl transition ${activeTab === 'config' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`} title={t('config')}>
            <Settings className="h-5 w-5" /><span className="text-[9px] font-bold">{t('config')}</span>
          </button>
        </div>
      </aside>

      {/* Phone/tablet: keep a thumb-friendly bottom bar. */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white shadow-2xl lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="relative mx-auto grid h-16 max-w-lg grid-cols-5 md:max-w-3xl">
          {mobileTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => activate(tab.id)}
                title={tab.badge !== undefined && tab.badge > 0 ? `${tab.badge} ${tab.badgeLabel || 'thông báo'}` : tab.label}
                aria-label={tab.badge !== undefined && tab.badge > 0 ? `${tab.label}: ${tab.badge} ${tab.badgeLabel || 'thông báo'}` : tab.label}
                className={`relative flex flex-col items-center justify-center transition-all ${isActive ? 'font-bold text-blue-600' : 'font-medium text-slate-500 hover:text-slate-800'}`}
              >
                <div className="relative"><Icon className={`h-5 w-5 ${isActive ? 'scale-110' : ''}`} />{tab.badge !== undefined && tab.badge > 0 ? <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full border border-white bg-rose-600 px-1 text-center text-[8px] font-black leading-4 text-white" title={`${tab.badge} ${tab.badgeLabel || 'Defect chưa xử lý'}`}>D{tab.badge}</span> : null}</div>
                <span className="mt-1 max-w-full truncate px-1 text-[9.5px]">{tab.label}</span>
                {isActive && <span className="absolute top-0 h-1 w-8 rounded-b-full bg-blue-600" />}
              </button>
            );
          })}

          <button
            onClick={() => setShowMore((value) => !value)}
            className={`relative flex flex-col items-center justify-center transition-all ${activeTab === 'volume' || activeTab === 'checklist' || activeTab === 'chat' || activeTab === 'ai' || activeTab === 'config' || activeTab === 'superadmin' || showMore ? 'font-bold text-blue-600' : 'font-medium text-slate-500'}`}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="mt-1 text-[9.5px]">Thêm</span>
          </button>

          {showMore && (
            <div className="absolute right-2 w-56 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl" style={{ bottom: 'calc(68px + env(safe-area-inset-bottom))' }}>
              <button onClick={() => activate('volume')} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <BarChart3 className="h-4 w-4 text-blue-600" /> {t('volume')}
              </button>
              {showChecklist && (
                <button onClick={() => activate('checklist')} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <ClipboardCheck className="h-4 w-4 text-indigo-600" /> Checklist
                </button>
              )}
              {showAi && (
                <button onClick={() => activate('ai')} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-extrabold text-indigo-700 hover:bg-indigo-50">
                  <Sparkles className="h-4 w-4 text-indigo-600" /> HNL AI Assistant
                </button>
              )}
              <button onClick={() => activate('chat')} className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-violet-600" /> Trao đổi</span>
                {chatBadgeCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-extrabold text-white">{chatBadgeCount > 9 ? '9+' : chatBadgeCount}</span>}
              </button>
              {showSuperAdmin && (
                <button onClick={() => activate('superadmin')} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-extrabold text-amber-800 hover:bg-amber-50">
                  <ShieldCheck className="h-4 w-4 text-amber-600" /> Quản trị hệ thống
                </button>
              )}
              <button onClick={() => { setShowMore(false); setActiveTab('config'); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <Settings className="h-4 w-4 text-slate-600" /> {t('config')}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
