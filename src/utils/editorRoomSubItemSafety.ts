import type { RoomSubItem } from '../types';

// CLIENT DEFENSE IN DEPTH ONLY: Firestore Rules must enforce this independently.
// The EDITOR may update progress and assignment of existing sub-items, never
// their identity, order, category, geometry, quantity or weighted scope.
const FIELD_OPERATIONAL_KEYS = [
  'status', 'inspectionStatus', 'targetDate', 'assignedTeam', 'teamId',
] as const satisfies readonly (keyof RoomSubItem)[];

export function mergeEditorRoomSubItems(
  existing: RoomSubItem[] | undefined,
  incoming: RoomSubItem[] | undefined,
): RoomSubItem[] | undefined {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) return existing;
  const byId = new Map<string, RoomSubItem>();
  for (const item of incoming) {
    // Ambiguous/malformed payloads must not modify any previously saved item.
    if (!item || typeof item.id !== 'string' || !item.id || byId.has(item.id)) return existing;
    byId.set(item.id, item);
  }
  return existing.map((original) => {
    const edited = byId.get(original.id);
    if (!edited) return original;
    const safe: RoomSubItem = { ...original };
    for (const field of FIELD_OPERATIONAL_KEYS) {
      if (Object.prototype.hasOwnProperty.call(edited, field)) {
        (safe as any)[field] = edited[field];
      }
    }
    return safe;
  });
}
