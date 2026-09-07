import { sanitizeCrewTaskDescriptionText } from './crewTaskDescription';

type CategoryLike = { categoryName?: string; subItems?: string[]; [key: string]: any };
type FloorWorkLike = { floorName?: string; categories?: CategoryLike[]; [key: string]: any };

export interface CrewPersistenceResult<T> {
  ok: boolean;
  record?: T;
  error?: string;
}

export function prepareCrewRecordForPersistence<T extends { taskDescription?: string; floorWorks?: FloorWorkLike[] }>(record: T): CrewPersistenceResult<T> {
  const originalFloorWorks = Array.isArray(record.floorWorks) ? record.floorWorks : [];
  if (originalFloorWorks.length === 0) {
    const taskDescription = sanitizeCrewTaskDescriptionText(String(record.taskDescription || '')).trim();
    return { ok: true, record: { ...record, taskDescription } };
  }

  const normalizedFloorWorks: FloorWorkLike[] = [];
  for (const floorWork of originalFloorWorks) {
    const normalizedCategories: CategoryLike[] = [];
    for (const category of Array.isArray(floorWork.categories) ? floorWork.categories : []) {
      const categoryName = String(category.categoryName || '').trim();
      const subItems = (Array.isArray(category.subItems) ? category.subItems : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      if (!categoryName) {
        if (subItems.length > 0) {
          return { ok: false, error: `Tầng “${String(floorWork.floorName || '').trim() || 'chưa xác định'}” có chi tiết công việc nhưng chưa có tên hạng mục.` };
        }
        continue;
      }
      normalizedCategories.push({ ...category, categoryName, subItems });
    }
    if (normalizedCategories.length > 0) normalizedFloorWorks.push({ ...floorWork, categories: normalizedCategories });
  }

  if (normalizedFloorWorks.length === 0) {
    return { ok: false, error: 'Chưa có hạng mục công việc hợp lệ. Vui lòng nhập tên hạng mục trước khi lưu nhật ký quân số.' };
  }

  const taskDescription = normalizedFloorWorks.map((floorWork) => {
    const detail = (floorWork.categories || []).map((category) => {
      const subItems = Array.isArray(category.subItems) ? category.subItems : [];
      return `${category.categoryName}${subItems.length > 0 ? ` (${subItems.join(', ')})` : ''}`;
    }).join('; ');
    return `[${String(floorWork.floorName || '').trim() || 'Tầng'}]: ${detail}`;
  }).join(' | ');

  return { ok: true, record: { ...record, floorWorks: normalizedFloorWorks, taskDescription } as T };
}
