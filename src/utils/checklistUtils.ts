import { ChecklistItem } from '../types';

export const normalizeChecklistLookupKey = (value?: string | null): string =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('vi-VN');

export const isSameChecklistFloor = (left?: string | null, right?: string | null): boolean =>
  normalizeChecklistLookupKey(left) === normalizeChecklistLookupKey(right);

export const isSameChecklistCategory = (left?: string | null, right?: string | null): boolean =>
  normalizeChecklistLookupKey(left) === normalizeChecklistLookupKey(right);

export const filterChecklistForFloor = (
  items: ChecklistItem[],
  selectedFloor: string,
  selectedCategory: string = 'all',
): ChecklistItem[] => {
  const activeItems = items.filter((item) => !item.archivedAt);
  return activeItems.filter((item) => {
    if (!isSameChecklistFloor(item.floorName, selectedFloor)) return false;
    if (selectedCategory === 'all') return true;
    return isSameChecklistCategory(item.category, selectedCategory);
  });
};
