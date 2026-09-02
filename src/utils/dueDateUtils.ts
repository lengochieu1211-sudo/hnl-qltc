import { WorkVolume, ChecklistItem, DefectItem } from '../types';
import { formatDate, parseLegacyTimestamp } from './dateFormatter';

export interface DueDateAlertItem {
  id: string;
  type: 'workVolume' | 'checklist' | 'defect';
  title: string;
  floor: string;
  category?: string;
  dueDate: string; // YYYY-MM-DD; empty when this is an activity notification without a deadline
  createdAt?: string | number;
  createdAtTs?: number;
  creatorLabel?: string;
  statusStr: string;
  isCompleted: boolean;
  diffDays: number; // <0 overdue, 0 today, >0 upcoming
  isOverdue: boolean;
  isToday: boolean;
  isDueSoon: boolean; // 1..3 days
  originalItem: WorkVolume | ChecklistItem | DefectItem;
}

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToDateString(baseDateStr: string, days: number): string {
  const d = new Date(baseDateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats due dates using the single app-level date-format preference from
 * Cài đặt → Cấu hình. The legacy function name is kept to avoid breaking
 * existing imports while removing the old hard-coded DD/MM/YYYY output.
 */
export function formatDateVN(dateStr?: string): string {
  return dateStr ? formatDate(dateStr) : '';
}

export function calculateDiffDays(dueDateStr: string): number {
  const todayStr = getTodayDateString();
  const todayDate = new Date(todayStr + 'T00:00:00');
  const dueDate = new Date(dueDateStr + 'T00:00:00');
  if (isNaN(dueDate.getTime())) return 999;
  
  const diffTime = dueDate.getTime() - todayDate.getTime();
  return Math.round(diffTime / (1000 * 3600 * 24));
}

export function collectDueDateAlerts(
  workVolumes: WorkVolume[] = [],
  checklist: ChecklistItem[] = [],
  defects: DefectItem[] = [],
  options: { includeActiveDefects?: boolean } = {}
): DueDateAlertItem[] {
  const alerts: DueDateAlertItem[] = [];

  // 1. WorkVolumes
  workVolumes.forEach((wv) => {
    if (!wv.dueDate) return;
    const isCompleted = wv.status === 'Đã hoàn thành';
    if (isCompleted) return; // Only notify active/pending tasks

    const diffDays = calculateDiffDays(wv.dueDate);
    const isOverdue = diffDays < 0;
    const isToday = diffDays === 0;
    const isDueSoon = diffDays > 0 && diffDays <= 3;

    if (isOverdue || isToday || isDueSoon) {
      alerts.push({
        id: `wv_${wv.id}`,
        type: 'workVolume',
        title: wv.title,
        floor: wv.floor,
        category: wv.category,
        dueDate: wv.dueDate,
        createdAt: wv.createdAt,
        createdAtTs: parseLegacyTimestamp(wv.createdAt, 0),
        statusStr: wv.status,
        isCompleted: false,
        diffDays,
        isOverdue,
        isToday,
        isDueSoon,
        originalItem: wv,
      });
    }
  });

  // 2. Checklist items
  checklist.forEach((chk) => {
    if (chk.archivedAt || !chk.dueDate) return;
    const isCompleted = chk.status === 'passed';
    if (isCompleted) return;

    const diffDays = calculateDiffDays(chk.dueDate);
    const isOverdue = diffDays < 0;
    const isToday = diffDays === 0;
    const isDueSoon = diffDays > 0 && diffDays <= 3;

    if (isOverdue || isToday || isDueSoon) {
      alerts.push({
        id: `chk_${chk.id}`,
        type: 'checklist',
        title: chk.title,
        floor: chk.floorName,
        category: chk.category,
        dueDate: chk.dueDate,
        createdAt: chk.createdAt,
        createdAtTs: parseLegacyTimestamp(chk.createdAt, 0),
        statusStr: chk.status === 'defect' ? 'Có lỗi' : 'Chờ nghiệm thu',
        isCompleted: false,
        diffDays,
        isOverdue,
        isToday,
        isDueSoon,
        originalItem: chk,
      });
    }
  });

  // 3. Defect items
  // Notification Center is also the activity feed for Defect creation. Therefore every
  // active/open Defect belongs in the "Tất cả" view even when it has no deadline yet.
  // Deadline-specific filters still work because the deadline flags remain false.
  defects.forEach((def) => {
    if (def.archivedAt) return;
    const isCompleted = def.status === 'Đã khắc phục' || def.status === 'Đã nghiệm thu';
    if (isCompleted) return;

    const hasDueDate = Boolean(def.dueDate);
    const diffDays = hasDueDate ? calculateDiffDays(String(def.dueDate)) : 999;
    const isOverdue = hasDueDate && diffDays < 0;
    const isToday = hasDueDate && diffDays === 0;
    const isDueSoon = hasDueDate && diffDays > 0 && diffDays <= 3;
    const createdAtTs = parseLegacyTimestamp(def.createdAt, 0);

    if (options.includeActiveDefects || isOverdue || isToday || isDueSoon) {
      alerts.push({
        id: `def_${def.id}`,
        type: 'defect',
        title: `Lỗi: ${def.category} - ${def.description}`,
        floor: def.floorName,
        category: def.category,
        dueDate: def.dueDate || '',
        createdAt: def.createdAt,
        createdAtTs,
        creatorLabel: String(def.createdBy || '').trim() || undefined,
        statusStr: def.status,
        isCompleted: false,
        diffDays,
        isOverdue,
        isToday,
        isDueSoon,
        originalItem: def,
      });
    }
  });

  // Default collection order is newest activity first. NotificationCenter may apply
  // another explicit sort (deadline, floor, title...) without mutating source data.
  alerts.sort((a, b) => Number(b.createdAtTs || 0) - Number(a.createdAtTs || 0));

  return alerts;
}
