import React, { useState, useEffect, useMemo } from 'react';
import { 
  Bell, 
  AlertTriangle, 
  Clock, 
  ChevronRight, 
  ChevronLeft, 
  X, 
  ExternalLink,
  Calendar
} from 'lucide-react';
import { WorkVolume, ChecklistItem, DefectItem } from '../types';
import { collectDueDateAlerts, DueDateAlertItem, formatDateVN } from '../utils/dueDateUtils';

interface DueDateToastNotifierProps {
  workVolumes?: WorkVolume[];
  checklist?: ChecklistItem[];
  defects?: DefectItem[];
  onNavigateToItem?: (alert: DueDateAlertItem) => void;
  onOpenNotificationCenter?: () => void;
}

export const DueDateToastNotifier: React.FC<DueDateToastNotifierProps> = ({
  workVolumes = [],
  checklist = [],
  defects = [],
  onNavigateToItem,
  onOpenNotificationCenter,
}) => {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMinimized, setIsMinimized] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
  );

  // Collect active alerts
  const allAlerts = useMemo(() => {
    return collectDueDateAlerts(workVolumes, checklist, defects);
  }, [workVolumes, checklist, defects]);

  // Filter out dismissed alerts
  const visibleAlerts = useMemo(() => {
    return allAlerts.filter(alert => !dismissedIds.has(alert.id));
  }, [allAlerts, dismissedIds]);

  // Reset index if visibleAlerts changes
  useEffect(() => {
    if (currentIndex >= visibleAlerts.length && visibleAlerts.length > 0) {
      setCurrentIndex(0);
    }
  }, [visibleAlerts.length, currentIndex]);

  const currentAlert = visibleAlerts[currentIndex] || null;

  if (visibleAlerts.length === 0) return null;

  const handleDismissCurrent = () => {
    if (!currentAlert) return;
    setDismissedIds(prev => {
      const next = new Set(prev);
      next.add(currentAlert.id);
      return next;
    });
  };

  const handleNavigateCurrent = () => {
    if (!currentAlert) return;
    if (onNavigateToItem) {
      onNavigateToItem(currentAlert);
    }
  };

  // Minimized Floating Badge Widget
  if (isMinimized) {
    return (
      <div className="fixed bottom-20 sm:bottom-6 right-2 sm:right-6 z-40 animate-in fade-in slide-in-from-bottom-3 duration-200">
        <button
          onClick={() => setIsMinimized(false)}
          className="bg-slate-900/95 hover:bg-slate-800 text-white px-3.5 py-2 rounded-2xl shadow-2xl border border-slate-700/80 flex items-center gap-2 text-xs font-bold transition-all active:scale-95 cursor-pointer backdrop-blur-md group"
        >
          <div className="relative">
            <Bell className="w-4 h-4 text-amber-400" />
            <span className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white text-[9px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center border border-slate-900">
              {visibleAlerts.length}
            </span>
          </div>
          <span>Thông báo tiến độ/defect ({visibleAlerts.length})</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>
    );
  }

  if (!currentAlert) return null;

  // Determine colors and labels by urgency
  let cardBg = 'bg-slate-900/95 text-white border-amber-500/50';
  let badgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
  let icon = <Bell className="w-4 h-4 text-amber-400 animate-pulse" />;
  let urgencyText = `Sắp tới hạn (${currentAlert.diffDays === 1 ? 'Còn 1 ngày' : `Còn ${currentAlert.diffDays} ngày`})`;

  if (currentAlert.isOverdue) {
    cardBg = 'bg-rose-950/95 text-white border-rose-500/60 shadow-rose-950/50';
    badgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    icon = <AlertTriangle className="w-4 h-4 text-rose-400 animate-bounce" />;
    urgencyText = `Đã Quá Hạn ${Math.abs(currentAlert.diffDays)} Ngày`;
  } else if (currentAlert.isToday) {
    cardBg = 'bg-amber-950/95 text-white border-amber-500/60 shadow-amber-950/50';
    badgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    icon = <Clock className="w-4 h-4 text-amber-400 animate-pulse" />;
    urgencyText = 'Đến Hạn Hôm Nay!';
  }

  const typeLabel = currentAlert.type === 'workVolume' ? 'Khối lượng' :
                    currentAlert.type === 'checklist' ? 'Checklist' : 'Defect';

  return (
    <div className="fixed bottom-20 sm:bottom-6 right-2 sm:right-6 z-40 w-[calc(100vw-1rem)] max-w-[25rem] animate-in fade-in slide-in-from-bottom-5 duration-300">
      <div className={`rounded-2xl p-3.5 sm:p-4 shadow-2xl border backdrop-blur-md transition-all space-y-3 max-h-[46vh] overflow-y-auto ${cardBg}`}>
        {/* Header Row */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex items-center gap-2">
            {icon}
            <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full border ${badgeColor}`}>
              {urgencyText}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {visibleAlerts.length > 1 && (
              <span className="text-[10px] text-slate-400 font-bold mr-1">
                {currentIndex + 1}/{visibleAlerts.length}
              </span>
            )}
            <button
              onClick={() => setIsMinimized(true)}
              className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer text-[10px] font-bold px-1.5"
              title="Thu nhỏ thông báo"
            >
              Thu nhỏ
            </button>
            <button
              onClick={handleDismissCurrent}
              className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
              title="Đóng thông báo này"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="space-y-1.5 cursor-pointer" onClick={handleNavigateCurrent}>
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-slate-300">
            <span className="bg-white/15 px-1.5 py-0.5 rounded text-white">{typeLabel}</span>
            <span>•</span>
            <span className="text-amber-300 font-bold">{currentAlert.floor}</span>
            {currentAlert.category && (
              <>
                <span>•</span>
                <span className="truncate max-w-[140px] text-slate-400">{currentAlert.category}</span>
              </>
            )}
          </div>

          <h4 className="text-xs font-bold text-white leading-snug line-clamp-2 hover:text-amber-200 transition-colors">
            {currentAlert.title}
          </h4>

          <div className="flex items-center gap-2 text-[11px] text-slate-300 pt-0.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>Hạn định: <strong className="text-white font-extrabold">{formatDateVN(currentAlert.dueDate)}</strong></span>
            <span className="text-[10px] opacity-75">({currentAlert.statusStr})</span>
          </div>
        </div>

        {/* Actions Row */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/10">
          <div className="flex items-center gap-1">
            {visibleAlerts.length > 1 && (
              <>
                <button
                  onClick={() => setCurrentIndex((prev) => (prev > 0 ? prev - 1 : visibleAlerts.length - 1))}
                  className="p-1 bg-white/10 hover:bg-white/20 rounded-lg text-slate-300 hover:text-white cursor-pointer"
                  title="Trước"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setCurrentIndex((prev) => (prev < visibleAlerts.length - 1 ? prev + 1 : 0))}
                  className="p-1 bg-white/10 hover:bg-white/20 rounded-lg text-slate-300 hover:text-white cursor-pointer"
                  title="Sau"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {onOpenNotificationCenter && (
              <button
                onClick={onOpenNotificationCenter}
                className="text-[10px] font-bold text-slate-300 hover:text-white underline px-1.5 py-1 cursor-pointer"
              >
                Tất cả ({visibleAlerts.length})
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleNavigateCurrent}
              className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 shadow-sm active:scale-95 transition-all cursor-pointer"
              title="Mở đúng mục để xử lý, không đổi trạng thái trực tiếp từ thông báo"
            >
              <span>Xem ngay</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
