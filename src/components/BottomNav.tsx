import React, { useEffect, useState } from 'react';
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
  forceDesktopRail?: boolean;
  setActiveTab: (tab: TabType) => void;
  onPreloadTab?: (tab: TabType) => void;
  defectBadgeCount: number;
  chatBadgeCount?: number;
  showChecklist?: boolean;
  showAi?: boolean;
  showSuperAdmin?: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  forceDesktopRail = false,
  setActiveTab,
  onPreloadTab,
  defectBadgeCount,
  chatBadgeCount = 0,
  showChecklist = true,
  showAi = false,
  showSuperAdmin = false,
}) => {
  const { t } = useLanguage();
  const [showMore, setShowMore] = useState(false);
  const [pressedTab, setPressedTab] = useState<TabType | null>(null);

  useEffect(() => {
    if (pressedTab === activeTab) setPressedTab(null);
  }, [activeTab, pressedTab]);

  const desktopTabs = [
    { id: 'home' as TabType, label: 'Trang chủ', icon: LayoutDashboard },
    { id: 'floorplan' as TabType, label: t('floorplan'), icon: MapPin, badge: defectBadgeCount, badgeLabel: 'Defect chưa nghiệm thu' },
    { id: 'crew' as TabType, label: t('crew'), icon: Users },
    { id: 'warehouse' as TabType, label: t('warehouse'), icon: PackageCheck },
    { id: 'volume' as TabType, label: t('volume'), icon: BarChart3 },
  ];

  const mobileTabs = [
    { id: 'home' as TabType, label: 'Trang chủ', icon: LayoutDashboard },
    { id: 'floorplan' as TabType, label: t('floorplan'), icon: MapPin, badge: defectBadgeCount, badgeLabel: 'Defect chưa nghiệm thu' },
    { id: 'crew' as TabType, label: t('crew'), icon: Users },
    { id: 'warehouse' as TabType, label: t('warehouse'), icon: PackageCheck },
  ];

  const previewTab = (tab: TabType) => {
    // Touch/pointer-down is feedback only. Starting a heavy lazy import here can block
    // Android's main thread before the pressed state has painted.
    setPressedTab(tab);
  };

  const activate = (tab: TabType) => {
    setShowMore(false);
    setPressedTab(tab);
    // Always delegate to App's authoritative activeTabRef check. The activeTab prop can
    // be one React render behind during very rapid tab switches; short-circuiting here
    // can otherwise drop the next click (for example Home -> Mặt bằng).
    setActiveTab(tab);
  };

  const navButtonStyle: React.CSSProperties = { touchAction: 'manipulation' };

  const isOverflowTabActive = (tab: TabType) => activeTab === tab || pressedTab === tab;
  const overflowNavItemClass = (tab: TabType, justifyBetween = false) =>
    `flex w-full items-center ${justifyBetween ? 'justify-between' : ''} gap-2 rounded-xl px-3 py-2.5 text-xs transition active:scale-[0.99] active:bg-slate-100 ${
      isOverflowTabActive(tab)
        ? 'bg-blue-50 font-bold text-blue-700 ring-1 ring-blue-100'
        : 'font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900'
    }`;
  const overflowNavIconClass = (tab: TabType) =>
    `h-4 w-4 shrink-0 ${isOverflowTabActive(tab) ? 'text-blue-600' : 'text-slate-500'}`;

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
      <aside data-hnl-nav-surface="desktop" className={`fixed inset-y-0 left-0 z-50 w-[84px] flex-col border-r border-slate-200 bg-white text-slate-700 shadow-sm ${forceDesktopRail ? 'flex' : 'hidden lg:flex'}`}>
        <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto px-1.5 py-2 no-scrollbar" aria-label="Điều hướng chính HNL QLTC">
          {desktopTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id || pressedTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-hnl-nav-tab={tab.id}
                onPointerEnter={() => onPreloadTab?.(tab.id)}
                onPointerDown={() => previewTab(tab.id)}
                onPointerCancel={() => setPressedTab((current) => current === tab.id ? null : current)}
                onClick={() => activate(tab.id)}
                style={navButtonStyle}
                title={tab.badge !== undefined && tab.badge > 0 ? `${tab.label}: ${tab.badge} ${tab.badgeLabel || ''}` : tab.label}
                aria-label={tab.label}
                className={`group relative flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 transition active:scale-[0.97] active:opacity-80 ${active ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
              >
                <span className="relative">
                  <Icon className={`h-5 w-5 ${active ? 'scale-110' : 'group-hover:scale-105'} transition-transform`} />
                  {tab.badge !== undefined && tab.badge > 0 ? (
                    <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full border border-slate-900 bg-rose-600 px-1 text-center text-[8px] font-black leading-4 text-white" title={`${tab.badge} ${tab.badgeLabel || 'Defect chưa nghiệm thu'}`}>D{tab.badge}</span>
                  ) : null}
                </span>
                <span className="max-w-full truncate text-[9px] font-bold leading-3">{tab.label}</span>
              </button>
            );
          })}

          {showChecklist && (
            <button type="button" data-hnl-nav-tab="checklist" onPointerEnter={() => onPreloadTab?.('checklist')} onPointerDown={() => previewTab('checklist')} onClick={() => activate('checklist')} style={navButtonStyle} className={`group relative flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 transition active:scale-[0.97] active:opacity-80 ${activeTab === 'checklist' || pressedTab === 'checklist' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`} title="Checklist">
              <ClipboardCheck className="h-5 w-5" /><span className="text-[9px] font-bold">Checklist</span>
            </button>
          )}

          <button type="button" data-hnl-nav-tab="chat" onPointerEnter={() => onPreloadTab?.('chat')} onPointerDown={() => previewTab('chat')} onClick={() => activate('chat')} style={navButtonStyle} className={`group relative flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 transition active:scale-[0.97] active:opacity-80 ${activeTab === 'chat' || pressedTab === 'chat' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`} title="Trao đổi">
            <span className="relative"><MessageCircle className="h-5 w-5" />{renderBadge(chatBadgeCount, 'tin chưa đọc')}</span><span className="text-[9px] font-bold">Trao đổi</span>
          </button>

          {showAi && (
            <button type="button" data-hnl-nav-tab="ai" onPointerEnter={() => onPreloadTab?.('ai')} onPointerDown={() => previewTab('ai')} onClick={() => activate('ai')} style={navButtonStyle} className={`group relative flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 transition active:scale-[0.97] active:opacity-80 ${activeTab === 'ai' || pressedTab === 'ai' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`} title="Trợ lý HNL AI">
              <Sparkles className="h-5 w-5" /><span className="text-[9px] font-bold">HNL AI</span>
            </button>
          )}
        </nav>

        <div className="space-y-1 border-t border-slate-200 px-1.5 py-2">
          {showSuperAdmin && (
            <button type="button" data-hnl-nav-tab="superadmin" onPointerEnter={() => onPreloadTab?.('superadmin')} onPointerDown={() => previewTab('superadmin')} onClick={() => activate('superadmin')} style={navButtonStyle} className={`flex min-h-[58px] w-full flex-col items-center justify-center gap-1 rounded-2xl transition active:scale-[0.97] active:opacity-80 ${activeTab === 'superadmin' || pressedTab === 'superadmin' ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-200' : 'text-amber-700 hover:bg-amber-50'}`} title="Quản trị hệ thống">
              <ShieldCheck className="h-5 w-5" /><span className="text-[8.5px] font-bold">Hệ thống</span>
            </button>
          )}
          <button type="button" data-hnl-nav-tab="config" onPointerEnter={() => onPreloadTab?.('config')} onPointerDown={() => previewTab('config')} onClick={() => activate('config')} style={navButtonStyle} className={`flex min-h-[58px] w-full flex-col items-center justify-center gap-1 rounded-2xl transition active:scale-[0.97] active:opacity-80 ${activeTab === 'config' || pressedTab === 'config' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`} title={t('config')}>
            <Settings className="h-5 w-5" /><span className="text-[9px] font-bold">{t('config')}</span>
          </button>
        </div>
      </aside>

      {/* Phone/tablet: keep a thumb-friendly bottom bar. */}
      <div
        data-hnl-nav-surface="mobile"
        className={`fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white shadow-2xl ${forceDesktopRail ? 'hidden' : 'lg:hidden'}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="relative mx-auto grid h-16 max-w-lg grid-cols-5 md:max-w-3xl">
          {mobileTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id || pressedTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-hnl-nav-tab={tab.id}
                onPointerDown={() => previewTab(tab.id)}
                onPointerCancel={() => setPressedTab((current) => current === tab.id ? null : current)}
                onClick={() => activate(tab.id)}
                style={navButtonStyle}
                title={tab.badge !== undefined && tab.badge > 0 ? `${tab.badge} ${tab.badgeLabel || 'thông báo'}` : tab.label}
                aria-label={tab.badge !== undefined && tab.badge > 0 ? `${tab.label}: ${tab.badge} ${tab.badgeLabel || 'thông báo'}` : tab.label}
                className={`relative flex flex-col items-center justify-center transition-all active:scale-[0.96] active:opacity-75 ${isActive ? 'font-bold text-blue-600' : 'font-medium text-slate-500 hover:text-slate-800'}`}
              >
                <div className="relative"><Icon className={`h-5 w-5 ${isActive ? 'scale-110' : ''}`} />{tab.badge !== undefined && tab.badge > 0 ? <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full border border-white bg-rose-600 px-1 text-center text-[8px] font-black leading-4 text-white" title={`${tab.badge} ${tab.badgeLabel || 'Defect chưa nghiệm thu'}`}>D{tab.badge}</span> : null}</div>
                <span className="mt-1 max-w-full truncate px-1 text-[10px]">{tab.label}</span>
                {isActive && <span className="absolute top-0 h-1 w-8 rounded-b-full bg-blue-600" />}
              </button>
            );
          })}

          <button
            type="button"
            data-hnl-nav-tab="more"
            onClick={() => setShowMore((value) => !value)}
            style={navButtonStyle}
            className={`relative flex flex-col items-center justify-center transition-all active:scale-[0.96] active:opacity-75 ${activeTab === 'volume' || activeTab === 'checklist' || activeTab === 'chat' || activeTab === 'ai' || activeTab === 'config' || activeTab === 'superadmin' || showMore ? 'font-bold text-blue-600' : 'font-medium text-slate-500'}`}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="mt-1 text-[10px]">Thêm</span>
          </button>

          {showMore && (
            <div className="absolute right-2 max-h-[min(70dvh,26rem)] w-56 overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl" style={{ bottom: 'calc(68px + env(safe-area-inset-bottom))' }}>
              <button type="button" data-hnl-nav-tab="volume" onPointerEnter={() => onPreloadTab?.('volume')} onPointerDown={() => previewTab('volume')} onClick={() => activate('volume')} style={navButtonStyle} className={overflowNavItemClass('volume')}>
                <BarChart3 className={overflowNavIconClass('volume')} /> {t('volume')}
              </button>
              {showChecklist && (
                <button type="button" data-hnl-nav-tab="checklist" onPointerEnter={() => onPreloadTab?.('checklist')} onPointerDown={() => previewTab('checklist')} onClick={() => activate('checklist')} style={navButtonStyle} className={overflowNavItemClass('checklist')}>
                  <ClipboardCheck className={overflowNavIconClass('checklist')} /> Checklist
                </button>
              )}
              {showAi && (
                <button type="button" data-hnl-nav-tab="ai" onPointerEnter={() => onPreloadTab?.('ai')} onPointerDown={() => previewTab('ai')} onClick={() => activate('ai')} style={navButtonStyle} className={overflowNavItemClass('ai')}>
                  <Sparkles className={overflowNavIconClass('ai')} /> Trợ lý HNL AI
                </button>
              )}
              <button type="button" data-hnl-nav-tab="chat" onPointerEnter={() => onPreloadTab?.('chat')} onPointerDown={() => previewTab('chat')} onClick={() => activate('chat')} style={navButtonStyle} className={overflowNavItemClass('chat', true)}>
                <span className="flex items-center gap-2"><MessageCircle className={overflowNavIconClass('chat')} /> Trao đổi</span>
                {chatBadgeCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-extrabold text-white">{chatBadgeCount > 9 ? '9+' : chatBadgeCount}</span>}
              </button>
              {showSuperAdmin && (
                <button type="button" data-hnl-nav-tab="superadmin" onPointerEnter={() => onPreloadTab?.('superadmin')} onPointerDown={() => previewTab('superadmin')} onClick={() => activate('superadmin')} style={navButtonStyle} className="flex w-full items-center gap-2 active:scale-[0.99] active:bg-slate-100 rounded-xl px-3 py-2.5 text-xs font-extrabold text-amber-800 hover:bg-amber-50">
                  <ShieldCheck className="h-4 w-4 text-amber-600" /> Quản trị hệ thống
                </button>
              )}
              <button type="button" data-hnl-nav-tab="config" onPointerEnter={() => onPreloadTab?.('config')} onPointerDown={() => previewTab('config')} onClick={() => activate('config')} style={navButtonStyle} className={overflowNavItemClass('config')}>
                <Settings className={overflowNavIconClass('config')} /> {t('config')}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
