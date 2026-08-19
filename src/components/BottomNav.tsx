import React, { useState } from 'react';
import { 
  PackageCheck, 
  BarChart3, 
  MapPin, 
  ClipboardCheck, 
  Users,
  Settings,
  MoreHorizontal
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export type TabType = 'warehouse' | 'volume' | 'floorplan' | 'checklist' | 'crew' | 'config';

interface BottomNavProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  defectBadgeCount: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  setActiveTab,
  defectBadgeCount,
}) => {
  const { t } = useLanguage();
  
  const [showMore, setShowMore] = useState(false);

  const mainTabs = [
    { id: 'warehouse' as TabType, label: t('warehouse'), icon: PackageCheck },
    { id: 'volume' as TabType, label: t('volume'), icon: BarChart3 },
    { id: 'floorplan' as TabType, label: t('floorplan'), icon: MapPin, badge: defectBadgeCount },
    { id: 'crew' as TabType, label: t('crew'), icon: Users },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 shadow-2xl">
      <div className="relative max-w-lg md:max-w-3xl lg:max-w-5xl mx-auto grid grid-cols-5 h-16">
        {mainTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { setShowMore(false); setActiveTab(tab.id); }}
              className={`relative flex flex-col items-center justify-center transition-all ${
                isActive ? 'text-blue-600 font-bold' : 'text-slate-500 font-medium hover:text-slate-800'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 ${isActive ? 'scale-110' : ''}`} />
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="absolute -top-1 -right-2 bg-rose-600 text-white text-[9px] font-extrabold px-1 rounded-full">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[9.5px] mt-1 max-w-full truncate px-1">{tab.label}</span>
              {isActive && <span className="absolute top-0 w-8 h-1 bg-blue-600 rounded-b-full" />}
            </button>
          );
        })}

        <button
          onClick={() => setShowMore(v => !v)}
          className={`relative flex flex-col items-center justify-center transition-all ${
            activeTab === 'checklist' || activeTab === 'config' || showMore
              ? 'text-blue-600 font-bold'
              : 'text-slate-500 font-medium'
          }`}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="text-[9.5px] mt-1">Thêm</span>
        </button>

        {showMore && (
          <div className="absolute right-2 bottom-[68px] w-44 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl">
            <button
              onClick={() => { setShowMore(false); setActiveTab('checklist'); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ClipboardCheck className="w-4 h-4 text-indigo-600" />
              Checklist
            </button>
            <button
              onClick={() => { setShowMore(false); setActiveTab('config'); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Settings className="w-4 h-4 text-slate-600" />
              Cấu hình
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
