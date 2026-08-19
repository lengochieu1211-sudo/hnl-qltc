import React, { useState, useMemo } from 'react';
import { 
  Bell, 
  AlertTriangle, 
  Clock, 
  CheckCircle2, 
  X, 
  Search, 
  ExternalLink, 
  Filter,
  Calendar,
  ChevronRight
} from 'lucide-react';
import { WorkVolume, ChecklistItem, DefectItem } from '../types';
import { collectDueDateAlerts, DueDateAlertItem, formatDateVN } from '../utils/dueDateUtils';

interface NotificationCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  workVolumes?: WorkVolume[];
  checklist?: ChecklistItem[];
  defects?: DefectItem[];
  onNavigateToItem?: (alert: DueDateAlertItem) => void;
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  isOpen,
  onClose,
  workVolumes = [],
  checklist = [],
  defects = [],
  onNavigateToItem,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'overdue' | 'today' | 'soon'>('all');
  const [contentType, setContentType] = useState<'all' | 'workVolume' | 'checklist' | 'defect'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const allAlerts = useMemo(() => {
    return collectDueDateAlerts(workVolumes, checklist, defects);
  }, [workVolumes, checklist, defects]);

  const activeAlerts = allAlerts;

  const filteredAlerts = useMemo(() => {
    return activeAlerts.filter(alert => {
      // Deadline filter
      if (filterType === 'overdue' && !alert.isOverdue) return false;
      if (filterType === 'today' && !alert.isToday) return false;
      if (filterType === 'soon' && !alert.isDueSoon) return false;
      // Business-area filter
      if (contentType !== 'all' && alert.type !== contentType) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = alert.title.toLowerCase().includes(q);
        const matchFloor = alert.floor.toLowerCase().includes(q);
        const matchCat = (alert.category || '').toLowerCase().includes(q);
        return matchTitle || matchFloor || matchCat;
      }
      return true;
    });
  }, [activeAlerts, filterType, contentType, searchQuery]);

  const counts = useMemo(() => {
    const overdue = activeAlerts.filter(a => a.isOverdue).length;
    const today = activeAlerts.filter(a => a.isToday).length;
    const soon = activeAlerts.filter(a => a.isDueSoon).length;
    return { all: activeAlerts.length, overdue, today, soon };
  }, [activeAlerts]);

  const contentCounts = useMemo(() => ({
    workVolume: activeAlerts.filter(a => a.type === 'workVolume').length,
    checklist: activeAlerts.filter(a => a.type === 'checklist').length,
    defect: activeAlerts.filter(a => a.type === 'defect').length,
  }), [activeAlerts]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-100">
        
        {/* Modal Header */}
        <div className="p-4 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-amber-500/20 border border-amber-500/40 rounded-2xl flex items-center justify-center">
              <Bell className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-base font-extrabold flex items-center gap-2">
                Trung Tâm Thông Báo Tiến Độ & Defect
                {counts.all > 0 && (
                  <span className="text-xs bg-rose-600 text-white px-2 py-0.5 rounded-full font-bold">
                    {counts.all}
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-300">
                Theo dõi tiến độ, checklist &amp; defect đến hạn theo đúng dự án đang mở
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center font-bold cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Filters & Search Toolbar */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 space-y-2 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Tìm kiếm công việc, tầng, hạng mục..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar text-[10.5px]">
            {[
              ['all', `Tất cả nội dung (${counts.all})`],
              ['workVolume', `Tiến độ (${contentCounts.workVolume})`],
              ['checklist', `Checklist (${contentCounts.checklist})`],
              ['defect', `Defect (${contentCounts.defect})`],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setContentType(value as typeof contentType)}
                className={`shrink-0 px-2.5 py-1 rounded-lg border font-bold transition-all cursor-pointer ${
                  contentType === value
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Quick Deadline Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1 transition-all cursor-pointer ${
                filterType === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Tất Cả ({counts.all})
            </button>
            <button
              onClick={() => setFilterType('overdue')}
              className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1 transition-all cursor-pointer ${
                filterType === 'overdue'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-white text-rose-700 border border-rose-200 hover:bg-rose-50'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" /> Quá Hạn ({counts.overdue})
            </button>
            <button
              onClick={() => setFilterType('today')}
              className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1 transition-all cursor-pointer ${
                filterType === 'today'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-white text-amber-700 border border-amber-200 hover:bg-amber-50'
              }`}
            >
              <Clock className="w-3.5 h-3.5" /> Đến Hạn Hôm Nay ({counts.today})
            </button>
            <button
              onClick={() => setFilterType('soon')}
              className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1 transition-all cursor-pointer ${
                filterType === 'soon'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white text-blue-700 border border-blue-200 hover:bg-blue-50'
              }`}
            >
              <Bell className="w-3.5 h-3.5" /> Sắp Tới (3 ngày) ({counts.soon})
            </button>
          </div>
        </div>

        {/* Notifications List Body */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {filteredAlerts.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-2 text-slate-400">
              <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-400 opacity-60" />
              <p className="text-sm font-bold text-slate-700">Không có thông báo nào trong danh mục này</p>
              <p className="text-xs">Không có tiến độ, checklist hoặc defect nào thuộc bộ lọc hiện tại cần cảnh báo.</p>
            </div>
          ) : (
            filteredAlerts.map((alert) => {
              const typeLabel = alert.type === 'workVolume' ? 'Khối Lượng' :
                                alert.type === 'checklist' ? 'Checklist' : 'Defect';

              let borderStyle = 'border-slate-200 bg-white hover:border-indigo-300';
              let badgeBg = 'bg-amber-100 text-amber-800 border-amber-200';
              let statusTag = `Còn ${alert.diffDays} ngày`;

              if (alert.isOverdue) {
                borderStyle = 'border-rose-200 bg-rose-50/20 hover:border-rose-400';
                badgeBg = 'bg-rose-100 text-rose-800 border-rose-300';
                statusTag = `Quá hạn ${Math.abs(alert.diffDays)} ngày`;
              } else if (alert.isToday) {
                borderStyle = 'border-amber-200 bg-amber-50/20 hover:border-amber-400';
                badgeBg = 'bg-amber-100 text-amber-900 border-amber-300';
                statusTag = 'Hạn hôm nay';
              }

              return (
                <div
                  key={alert.id}
                  className={`p-3.5 rounded-2xl border shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${borderStyle}`}
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="bg-slate-100 text-slate-700 font-extrabold text-[10px] px-2 py-0.5 rounded border border-slate-200">
                        {typeLabel}
                      </span>
                      <span className="bg-indigo-50 text-indigo-700 font-bold text-[10px] px-2 py-0.5 rounded border border-indigo-100">
                        {alert.floor}
                      </span>
                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded border ${badgeBg}`}>
                        {statusTag}
                      </span>
                    </div>

                    <h4 className="text-xs font-bold text-slate-900 leading-snug">
                      {alert.title}
                    </h4>

                    <div className="flex items-center gap-3 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1 font-medium">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        Hạn: <strong className="text-slate-800">{formatDateVN(alert.dueDate)}</strong>
                      </span>
                      {alert.category && (
                        <span className="truncate max-w-[150px] text-slate-400">
                          NH: {alert.category}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions: notification center never changes construction/QC status directly.
                      Users must open the actual record so quantity, inspection and defect workflow remain auditable. */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        if (onNavigateToItem) {
                          onNavigateToItem(alert);
                          onClose();
                        }
                      }}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all shadow-xs active:scale-95 cursor-pointer"
                    >
                      <span>Xem chi tiết</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>Đang hiển thị: <strong className="text-slate-800">{filteredAlerts.length}</strong> / {counts.all}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-slate-300 rounded-xl font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>

      </div>
    </div>
  );
};
