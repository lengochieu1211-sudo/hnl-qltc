export type SortOrder = 'asc' | 'desc';

export interface FloorSortValue {
  floorId?: string | null;
  floorName?: string | null;
}

export const normalizeSortText = (value?: string | null): string =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export const naturalCompare = (a?: string | null, b?: string | null): number => {
  const safeA = a || '';
  const safeB = b || '';
  const normalizedComparison = normalizeSortText(safeA).localeCompare(
    normalizeSortText(safeB),
    'vi',
    { numeric: true, sensitivity: 'base' }
  );
  if (normalizedComparison !== 0) return normalizedComparison;
  return safeA.localeCompare(safeB, 'vi', { numeric: true, sensitivity: 'base' });
};

export const applySortOrder = (comparison: number, order: SortOrder): number =>
  order === 'asc' ? comparison : -comparison;

export const getFloorSortRank = (floorName?: string | null): number => {
  const text = normalizeSortText(floorName);

  const basementMatch = text.match(/(?:ham|basement|b)\s*(-?\d+)/);
  if (basementMatch) {
    return -Math.abs(Number(basementMatch[1]));
  }

  if (/(tret|ground|san-tret|san tret)/.test(text)) {
    return 0;
  }

  const floorMatch = text.match(/(?:tang|floor|lau)\s*(\d+)/) || text.match(/(\d+)/);
  if (floorMatch) {
    return Number(floorMatch[1]);
  }

  if (/(mai|tum|thuong)/.test(text)) {
    return 10000;
  }

  return 5000;
};

export const compareFloorValues = (a: FloorSortValue, b: FloorSortValue): number => {
  const labelA = a.floorName || a.floorId || '';
  const labelB = b.floorName || b.floorId || '';
  const rankA = getFloorSortRank(labelA);
  const rankB = getFloorSortRank(labelB);
  if (rankA !== rankB) return rankA - rankB;

  const labelComparison = naturalCompare(labelA, labelB);
  if (labelComparison !== 0) return labelComparison;
  return naturalCompare(a.floorId, b.floorId);
};

export const dateToTimestamp = (value?: string | number | Date | null): number => {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = String(value || '').trim();
  if (!raw) return 0;

  const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    const [, year, month, day] = ymd;
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  }

  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const compareDateValues = (
  a?: string | number | Date | null,
  b?: string | number | Date | null
): number => dateToTimestamp(a) - dateToTimestamp(b);
