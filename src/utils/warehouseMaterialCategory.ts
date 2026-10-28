/** Same built-in category labels as the material-norm editor. */
export const COMMON_CATEGORIES = [
  'Tấm thạch cao',
  'Khung xương',
  'Phụ kiện & Vít',
  'Sơn bả & Mối nối',
  'Vật tư phụ khác',
];

const categoryKey = (value: string): string => value.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLocaleLowerCase('vi-VN').trim().replace(/\s+/g, ' ');

/** Reuse category labels from the project's material catalog; no parallel category collection. */
export const listWarehouseMaterialCategories = (norms: readonly { category?: string | null }[]): string[] => {
  const unique = new Map<string, string>();
  [...COMMON_CATEGORIES.map((category) => ({ category })), ...norms].forEach((norm) => {
    const label = String(norm.category || '').trim().replace(/\s+/g, ' ');
    const key = categoryKey(label);
    if (key && !unique.has(key)) unique.set(key, label);
  });
  return Array.from(unique.values()).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' }));
};

/** New labels are free-form catalog metadata, but matching existing labels reuse their spelling. */
export const resolveWarehouseMaterialCategory = (
  selected: string,
  custom: string,
  existing: readonly string[],
): string | null => {
  const creatingNew = selected === '__new__';
  const label = (creatingNew ? custom : selected).trim().replace(/\s+/g, ' ');
  if (!label) return null;
  const matched = existing.find((item) => categoryKey(item) === categoryKey(label));
  return matched || (creatingNew ? label : null);
};
