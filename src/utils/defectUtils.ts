import { DefectItem } from '../types';

export interface DefectOverdueInfo {
  isOverdue: boolean;
  daysDiff: number; // Positive if overdue, negative/zero if remaining or on-time
  statusText: string; // e.g. "🔴 Quá hạn 3 ngày", "🟢 Còn 2 ngày", "✅ Hoàn thành đúng hạn", "🔴 Trễ 2 ngày"
  shortText: string; // e.g. "Quá hạn 3 ngày"
  badgeClass: string; // Tailwind classes for styling
  badgeColor: 'rose' | 'amber' | 'emerald' | 'blue' | 'slate';
}

export function getDefectOverdueInfo(defect: DefectItem): DefectOverdueInfo {
  const isFinished = defect.status === 'Đã khắc phục' || defect.status === 'Đã nghiệm thu';

  if (!defect.dueDate) {
    if (isFinished) {
      return {
        isOverdue: false,
        daysDiff: 0,
        statusText: '✅ Đã hoàn thành',
        shortText: 'Đã xong',
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
        badgeColor: 'emerald',
      };
    }
    return {
      isOverdue: false,
      daysDiff: 0,
      statusText: '📅 Chưa đặt deadline',
      shortText: 'Chưa có hạn',
      badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
      badgeColor: 'slate',
    };
  }

  // Calculate day difference between due date and target date
  const dueDateStr = defect.dueDate.split('T')[0];
  const [dYear, dMonth, dDay] = dueDateStr.split('-').map(Number);
  const dueDayObj = new Date(dYear, dMonth - 1, dDay);

  if (isFinished) {
    // If finished, compare completedAt with dueDate
    let compDayObj = new Date();
    if (defect.completedAt) {
      const compDateStr = defect.completedAt.split(' ')[0].split('T')[0];
      const [cYear, cMonth, cDay] = compDateStr.split('-').map(Number);
      if (!isNaN(cYear) && !isNaN(cMonth) && !isNaN(cDay)) {
        compDayObj = new Date(cYear, cMonth - 1, cDay);
      }
    }

    const diffMs = compDayObj.getTime() - dueDayObj.getTime();
    const daysLate = Math.round(diffMs / (1000 * 3600 * 24));

    if (daysLate > 0) {
      return {
        isOverdue: true,
        daysDiff: daysLate,
        statusText: `🔴 Đã xong (Trễ ${daysLate} ngày)`,
        shortText: `Trễ ${daysLate} ngày`,
        badgeClass: 'bg-amber-100 text-amber-900 border-amber-300 font-bold',
        badgeColor: 'amber',
      };
    } else {
      return {
        isOverdue: false,
        daysDiff: daysLate,
        statusText: '✅ Hoàn thành đúng hạn',
        shortText: 'Đúng hạn',
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold',
        badgeColor: 'emerald',
      };
    }
  }

  // Active defect (Mới phát hiện / Đang sửa)
  const now = new Date();
  const todayObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffMs = todayObj.getTime() - dueDayObj.getTime();
  const daysOverdue = Math.round(diffMs / (1000 * 3600 * 24));

  if (daysOverdue > 0) {
    return {
      isOverdue: true,
      daysDiff: daysOverdue,
      statusText: `🔴 Quá hạn ${daysOverdue} ngày`,
      shortText: `Quá hạn ${daysOverdue} ngày`,
      badgeClass: 'bg-rose-100 text-rose-800 border-rose-300 font-extrabold animate-pulse',
      badgeColor: 'rose',
    };
  } else if (daysOverdue === 0) {
    return {
      isOverdue: false,
      daysDiff: 0,
      statusText: `⚠️ Hạn chót hôm nay`,
      shortText: `Hạn hôm nay`,
      badgeClass: 'bg-amber-100 text-amber-900 border-amber-300 font-bold',
      badgeColor: 'amber',
    };
  } else {
    const daysRemaining = Math.abs(daysOverdue);
    return {
      isOverdue: false,
      daysDiff: daysOverdue,
      statusText: `⏱️ Còn ${daysRemaining} ngày (Hạn: ${defect.dueDate})`,
      shortText: `Còn ${daysRemaining} ngày`,
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 font-semibold',
      badgeColor: 'blue',
    };
  }
}
