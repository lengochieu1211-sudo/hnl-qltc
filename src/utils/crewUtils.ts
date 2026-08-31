import type { CrewRecord } from '../types';

export interface CrewShiftCounts {
  morning: number;
  afternoon: number;
  evening: number;
}

const safeCount = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Resolve per-shift headcount while preserving legacy CrewRecord behavior.
 * New records store morningCount/afternoonCount/eveningCount explicitly.
 * Legacy records only have workerCount + shift, so we derive equivalent counts.
 */
export function getCrewShiftCounts(record: Pick<CrewRecord, 'workerCount' | 'workersInside' | 'workersOutside' | 'shift' | 'morningCount' | 'afternoonCount' | 'eveningCount'>): CrewShiftCounts {
  const hasExplicitShiftCounts = record.morningCount !== undefined
    || record.afternoonCount !== undefined
    || record.eveningCount !== undefined;

  if (hasExplicitShiftCounts) {
    return {
      morning: safeCount(record.morningCount),
      afternoon: safeCount(record.afternoonCount),
      evening: safeCount(record.eveningCount),
    };
  }

  const legacyCount = safeCount(record.workerCount)
    || (safeCount(record.workersInside) + safeCount(record.workersOutside));
  const raw = String(record.shift || '').trim().toLowerCase();

  if (!raw || raw === 'default' || raw.includes('hành chính')) {
    return { morning: legacyCount, afternoon: legacyCount, evening: 0 };
  }
  if (raw.includes('nghỉ')) {
    return { morning: 0, afternoon: 0, evening: 0 };
  }

  const morning = raw.includes('sáng') ? legacyCount : 0;
  const afternoon = raw.includes('chiều') ? legacyCount : 0;
  const evening = (raw.includes('tối') || raw.includes('tăng ca')) ? legacyCount : 0;

  // Unknown legacy free text historically counted as one standard day.
  if (morning === 0 && afternoon === 0 && evening === 0) {
    return { morning: legacyCount, afternoon: legacyCount, evening: 0 };
  }
  return { morning, afternoon, evening };
}

export function getCrewDailyHeadcount(record: Pick<CrewRecord, 'workerCount' | 'workersInside' | 'workersOutside' | 'shift' | 'morningCount' | 'afternoonCount' | 'eveningCount'>): number {
  const counts = getCrewShiftCounts(record);
  return Math.max(counts.morning, counts.afternoon, counts.evening, 0);
}

/** Half-day accounting used by existing productivity statistics. */
export function getCrewMandays(record: Pick<CrewRecord, 'workerCount' | 'workersInside' | 'workersOutside' | 'shift' | 'morningCount' | 'afternoonCount' | 'eveningCount'>): number {
  const counts = getCrewShiftCounts(record);
  return counts.morning * 0.5 + counts.afternoon * 0.5 + counts.evening * 0.5;
}

/**
 * Converts a saved shift label into an equivalent work-day factor.
 * Kept for legacy callers. Morning = 0.5, afternoon = 0.5, evening/overtime = 0.5.
 */
export function getShiftDayFactor(shift?: string): number {
  const raw = String(shift || '').trim().toLowerCase();
  if (!raw || raw === 'default' || raw.includes('hành chính')) return 1;
  if (raw.includes('nghỉ')) return 0;

  let factor = 0;
  if (raw.includes('sáng')) factor += 0.5;
  if (raw.includes('chiều')) factor += 0.5;
  if (raw.includes('tối') || raw.includes('tăng ca')) factor += 0.5;
  return factor > 0 ? factor : 1;
}
