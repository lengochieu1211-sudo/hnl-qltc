/**
 * Import payloads are UPSERT DELTAS, never snapshots of the entire catalog.
 * A stale Quick Edit/Excel/Template view must not delete unrelated material IDs.
 */
export interface MaterialNormRowIdentity { id: string }

export function collectMaterialNormUpserts<T extends MaterialNormRowIdentity>(
  snapshot: readonly T[], proposed: readonly T[],
): T[] {
  const original = new Map(snapshot.map((row) => [row.id, row] as const));
  return proposed.filter((row) => !original.has(row.id)
    || JSON.stringify(original.get(row.id)) !== JSON.stringify(row));
}

export function mergeMaterialNormUpserts<T extends MaterialNormRowIdentity>(
  current: readonly T[], upserts: readonly T[],
): T[] {
  const ids = new Set<string>();
  for (const item of upserts) {
    if (!item.id || ids.has(item.id)) throw new Error('Import Định mức trùng hoặc thiếu normId. Không ghi dữ liệu.');
    ids.add(item.id);
  }
  const changes = new Map(upserts.map((item) => [item.id, item] as const));
  const existing = new Set(current.map((item) => item.id));
  return [...current.map((item) => changes.get(item.id) ?? item),
    ...upserts.filter((item) => !existing.has(item.id))];
}
