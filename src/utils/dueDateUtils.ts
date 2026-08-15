import { WorkVolume, ChecklistItem, DefectItem } from '../types';

export interface DueDateAlertItem {
  id: string;
  type: 'workVolume' | 'checklist' | 'defect';
  title: string;
  floor: string;
  category?: string;
  dueDate: string; // YYYY-MM-DD
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

export function formatDateVN(dateStr?: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
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
  defects: DefectItem[] = []
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
    if (!chk.dueDate) return;
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
        statusStr: chk.status === 'defect' ? 'Có Lỗi' : 'Chờ nghiệm thu',
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
  defects.forEach((def) => {
    if (!def.dueDate) return;
    const isCompleted = def.status === 'Đã khắc phục' || def.status === 'Đã nghiệm thu';
    if (isCompleted) return;

    const diffDays = calculateDiffDays(def.dueDate);
    const isOverdue = diffDays < 0;
    const isToday = diffDays === 0;
    const isDueSoon = diffDays > 0 && diffDays <= 3;

    if (isOverdue || isToday || isDueSoon) {
      alerts.push({
        id: `def_${def.id}`,
        type: 'defect',
        title: `Lỗi: ${def.category} - ${def.description}`,
        floor: def.floorName,
        category: def.category,
        dueDate: def.dueDate,
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

  // Sort by urgency: Overdue first (most negative diffDays), then Today (0), then Due Soon (1, 2, 3)
  alerts.sort((a, b) => a.diffDays - b.diffDays);

  return alerts;
}
