/** P21.84 isolated audit safety: never replace current objects with stale UI snapshots. */
export function reorderExistingByIds<T extends { id: string }>(
  current: readonly T[], requested: readonly { id: string }[],
): T[] {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const ordered: T[] = [];
  for (const item of requested) {
    if (seen.has(item.id)) continue;
    const latest = currentById.get(item.id);
    if (!latest) continue; // deleted remotely; never resurrect a stale UI item
    seen.add(item.id);
    ordered.push(latest);
  }
  for (const latest of current) {
    if (!seen.has(latest.id)) ordered.push(latest); // concurrent additions retained
  }
  return ordered;
}
