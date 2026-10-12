/** Presentation-only category ordering. Never changes material IDs, norms, or stock math. */
export function isAccessoryMaterialCategory(category: unknown): boolean {
  const value = String(category || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLocaleLowerCase('vi-VN').trim();
  return /(?:^|[^a-z])(?:phu kien|vat tu phu|vit|phu tung)(?:$|[^a-z])/.test(value);
}

/** Keep accessories and small consumables after primary materials in DEFAULT views. */
export function compareMaterialAccessoryLast(a: unknown, b: unknown): number {
  return Number(isAccessoryMaterialCategory(a)) - Number(isAccessoryMaterialCategory(b));
}
