import type { WorkVolume } from '../types';

/** Stable order on every device. Legacy records without rank preserve their
 * incoming sequence until an ADMIN explicitly orders the entire catalog. */
export function sortWorkVolumesByManualOrder<T extends Pick<WorkVolume, 'id' | 'displayOrder'>>(items: readonly T[]): T[] {
  const maxRank = items.reduce((max, item) =>
    typeof item.displayOrder === 'number' && Number.isFinite(item.displayOrder)
      ? Math.max(max, item.displayOrder) : max, -1);
  return items.map((item, index) => ({
    item, index,
    rank: typeof item.displayOrder === 'number' && Number.isFinite(item.displayOrder)
      ? item.displayOrder : maxRank + index + 1,
  })).sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ item }) => item);
}

/** Only a full-set permutation can become a new canonical sequence. */
export function validateWorkVolumeOrder(ids: readonly string[], current: readonly Pick<WorkVolume,'id'>[]): boolean {
  if (ids.length !== current.length || new Set(ids).size !== current.length) return false;
  const expected = new Set(current.map(item => item.id));
  return ids.every(id => expected.has(id));
}
