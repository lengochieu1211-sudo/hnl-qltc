import type { WorkVolume } from '../types';

type CatalogWorkUnit = Pick<WorkVolume, 'id' | 'workCategoryId' | 'title' | 'unit' | 'floorId' | 'floorIds'>;

/**
 * A room category borrows its unit from the active WorkVolume catalog.
 * Prefer this floor's matching item over another floor's similarly named item.
 * Never convert an existing numeric quantity when resolving its label.
 */
export function getRoomWorkCategoryUnit(category: string, workVolumes: CatalogWorkUnit[], floorId?: string): string {
  const key = String(category || '').trim().toLocaleLowerCase('vi-VN');
  if (!key) return '';
  const matches = workVolumes.filter((item) =>
    item.id === category || item.workCategoryId === category ||
    String(item.title || '').trim().toLocaleLowerCase('vi-VN') === key);
  const sameFloor = floorId && matches.find((item) =>
    item.floorId === floorId || item.floorIds?.includes(floorId));
  const item = sameFloor || matches[0];
  return String(item?.unit || '').trim();
}
