import type { AiDateRange } from './contracts';

const CANONICAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCanonicalDate(value: string): boolean {
  const match = String(value || '').trim().match(CANONICAL_DATE_RE);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function assertCanonicalDateRange(range: AiDateRange): AiDateRange {
  if (!isCanonicalDate(range.from) || !isCanonicalDate(range.to)) {
    throw new Error('AI_DATE_RANGE_INVALID: Khoảng ngày phải dùng YYYY-MM-DD.');
  }
  if (range.from > range.to) {
    throw new Error('AI_DATE_RANGE_INVALID: Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.');
  }
  return range;
}

export function isDateWithinRange(date: string, range: AiDateRange): boolean {
  assertCanonicalDateRange(range);
  if (!isCanonicalDate(date)) return false;
  return date >= range.from && date <= range.to;
}

export function canonicalDayCount(range: AiDateRange): number {
  assertCanonicalDateRange(range);
  const [fy, fm, fd] = range.from.split('-').map(Number);
  const [ty, tm, td] = range.to.split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.floor((to - from) / 86_400_000) + 1;
}
