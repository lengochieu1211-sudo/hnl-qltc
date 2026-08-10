import React from 'react';
import { 
  PackageCheck, 
  BarChart3, 
  MapPin, 
  ClipboardCheck, 
  Users,
  Settings
} from 'lucide-react';

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
  const tabs = [
    { id: 'warehouse' as TabType, label: 'Kho Vật Tư', icon: PackageCheck },
    { id: 'volume' as TabType, label: 'Khối Lượng', icon: BarChart3 },
    { id: 'floorplan' as TabType, label: 'Mặt Bằng', icon: MapPin, badge: defectBadgeCount },
    { id: 'checklist' as TabType, label: 'Checklist', icon: ClipboardCheck },
    { id: 'crew' as TabType, label: 'Quân Số', icon: Users },
    { id: 'config' as TabType, label: 'Cấu Hình', icon: Settings },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 shadow-2xl">
      <div className="max-w-lg md:max-w-3xl lg:max-w-5xl mx-auto grid grid-cols-6 h-16">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex flex-col items-center justify-center transition-all ${
                isActive ? 'text-blue-600 font-bold' : 'text-slate-500 font-medium hover:text-slate-800'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 ${isActive ? 'scale-110' : ''}`} />
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="absolute -top-1 -right-2 bg-rose-600 text-white text-[9px] font-extrabold px-1 rounded-full animate-pulse">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] mt-1">{tab.label}</span>
              {isActive && (
                <span className="absolute top-0 w-8 h-1 bg-blue-600 rounded-b-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
