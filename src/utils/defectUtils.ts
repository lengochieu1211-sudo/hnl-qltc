import { DefectItem } from '../types';
import { parseLegacyTimestamp, toLocalDateInputValue } from './dateFormatter';

export interface DefectOverdueInfo {
  isOverdue: boolean;
  daysDiff: number; // Positive if overdue, negative/zero if remaining or on-time
  statusText: string; // e.g. "🔴 Quá hạn 3 ngày", "🟢 Còn 2 ngày", "✅ Hoàn thành đúng hạn", "🔴 Trễ 2 ngày"
  shortText: string; // e.g. "Quá hạn 3 ngày"
  badgeClass: string; // Tailwind classes for styling
  badgeColor: 'rose' | 'amber' | 'emerald' | 'blue' | 'slate';
}

/**
 * Stable short code derived from the Defect ID. It does not change when the list
 * is sorted/filtered, and keeps a short UUID suffix when two devices happen to
 * allocate the same sequential number concurrently.
 */
export function getDefectShortCode(id?: string): string {
  const raw = String(id || '').trim();
  const numericMatch = raw.match(/^DEF-(\d+)/i);
  if (numericMatch) {
    const numericPart = numericMatch[1];
    // Display code only: keep the stored ID untouched, but never paint a long
    // timestamp/suffix over the floor plan on mobile.
    return numericPart.length <= 6 ? `DF-${numericPart}` : `DF-${numericPart.slice(-5)}`;
  }
  const compact = raw.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
  return compact ? `DF-${compact}` : 'DF';
}


/** Defect date-only fields are Vietnam calendar days, never device-local instants. */
const DEFECT_DAY_MS = 86_400_000;
const defectBusinessDayNumber = (value: string): number | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let civil = raw;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    // A zoned timestamp is an instant: convert to Vietnam civil day.
    const instant = new Date(raw);
    if (!Number.isFinite(instant.getTime())) return null;
    civil = toLocalDateInputValue(instant);
  } else {
    const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]|$)/.exec(raw);
    const dmy = /(?:^|\s)(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s|$)/.exec(raw);
    if (ymd) civil = [ymd[1], ymd[2].padStart(2, '0'), ymd[3].padStart(2, '0')].join('-');
    else if (dmy) civil = [dmy[3], dmy[2].padStart(2, '0'), dmy[1].padStart(2, '0')].join('-');
    else {
      const timestamp = parseLegacyTimestamp(raw, Number.NaN);
      if (!Number.isFinite(timestamp)) return null;
      civil = toLocalDateInputValue(new Date(timestamp));
    }
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const checked = new Date(utc);
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) return null;
  return Math.floor(utc / DEFECT_DAY_MS);
};

export function getDefectOverdueInfo(defect: DefectItem, now: Date = new Date()): DefectOverdueInfo {
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

  // Compare integer Vietnam civil day indices, independent of device TZ and DST.
  const dueDay = defectBusinessDayNumber(defect.dueDate);
  const todayDay = defectBusinessDayNumber(toLocalDateInputValue(now));
  if (dueDay === null || todayDay === null) return {
    isOverdue: false, daysDiff: 0, statusText: '📅 Ngày deadline không hợp lệ', shortText: 'Kiểm tra ngày',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200', badgeColor: 'slate',
  };

  if (isFinished) {
    // Date-only completedAt retains its business date; zoned instants use VN day.
    const completedDay = defect.completedAt ? defectBusinessDayNumber(defect.completedAt) : null;
    const daysLate = (completedDay ?? todayDay) - dueDay;

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
  const daysOverdue = todayDay - dueDay;

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
