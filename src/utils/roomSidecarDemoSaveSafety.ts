import type { RoomProgressItem } from '../types';
import type { RoomSidecarDefinition, RoomSidecarProgress } from './roomSidecarProgressSafety.ts';
import { planMigratedRoomProgressEdits } from './roomSidecarProgressSafety.ts';

/** Fail closed rather than silently losing edits to top-level room metadata or geometry.
 * The legacy room stays untouched; only confirmed operational subItem fields are written.
 */
export function planDemoRoomSidecarSave(
  source: RoomProgressItem,
  edited: Partial<RoomProgressItem>,
  progress: readonly RoomSidecarProgress[],
  definitions: readonly RoomSidecarDefinition[],
) {
  if (!source.subItemProgressMigrated || !Array.isArray(source.subItems) || !Array.isArray(edited.subItems))
    throw new Error('ROOM_SIDECAR_NOT_VERIFIED_MIGRATED');
  if (source.id !== edited.id) throw new Error('ROOM_SIDECAR_IDENTITY_CHANGED');
  const ignoredDerived = new Set(['subItems','frameStatus','boardStatus','frameInspectionStatus',
    'boardInspectionStatus','inspectionStatus','targetFrameDate','targetBoardDate']);
  const stable = (value: unknown) => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
  for (const [key, value] of Object.entries(edited)) {
    if (ignoredDerived.has(key) || key === 'updatedAt' || key === 'id') continue;
    if (stable(value) !== stable((source as unknown as Record<string, unknown>)[key]))
      throw new Error('ROOM_SIDECAR_TOP_LEVEL_EDIT_REQUIRES_SEPARATE_VERIFIED_WRITE');
  }
  const byProgressId = new Map(progress.map(item => [item.id,item]));
  const byDefinitionId = new Map(definitions.map(item => [item.id,item]));
  return planMigratedRoomProgressEdits(source.subItems, edited.subItems).map(entry => {
    const current = byProgressId.get(entry.id);
    const definition = byDefinitionId.get(entry.id);
    if (!current || !definition || !Number.isSafeInteger(current.revision) || (current.revision ?? -1) < 1)
      throw new Error('ROOM_SIDECAR_UNVERIFIED_REVISION_OR_DEFINITION');
    return { ...entry, expectedRevision:current.revision!, expectedDefinition:definition };
  });
}
