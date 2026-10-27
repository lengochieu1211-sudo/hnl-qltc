/**
 * P21.7 safety interlock for disposable Firebase Emulator cutover tests.
 *
 * Migrated rooms must use sidecar CAS, never generic room autosave.
 * Trusted inventory must use Cloud Functions, never the legacy batch writer.
 * A whole diff is refused BEFORE its first SDK write to avoid partial commits.
 * Without explicit demo flags, the existing DEV/PROD behavior is unchanged.
 */
export interface P21WriterDiffs {
  addedOrModified?: Record<string, readonly unknown[]>;
  deletedIds?: Record<string, readonly unknown[]>;
}

export function assertP21DemoWriterBoundary(
  diffs: P21WriterDiffs,
  gates: Readonly<{ roomSidecarDemo: boolean; trustedWarehouseDemo: boolean }>,
): void {
  const hasMutation = (collection: string): boolean =>
    (diffs.addedOrModified?.[collection]?.length ?? 0) > 0 ||
    (diffs.deletedIds?.[collection]?.length ?? 0) > 0;

  if (gates.roomSidecarDemo && hasMutation('rooms')) {
    throw new Error('P21_ROOM_DIRECT_WRITE_BLOCKED_USE_SIDECAR_CAS');
  }
  if (gates.trustedWarehouseDemo && hasMutation('inventory')) {
    throw new Error('P21_WAREHOUSE_DIRECT_WRITE_BLOCKED_USE_TRUSTED_CALLABLE');
  }
}

/** A rejected remote write must never be presented as a successful local edit.
 * Inspect state-array identity before creating tombstones or undo-history entries.
 * This intentionally blocks all legacy local room/inventory changes in the demo;
 * migrated sidecar writes go straight to their verified CAS transaction instead.
 */
export function p21DemoLocalMutationError(
  before: Readonly<{roomProgressList?: unknown; inventory?: unknown}>,
  after: Readonly<{roomProgressList?: unknown; inventory?: unknown}>,
  gates: Readonly<{roomSidecarDemo: boolean; trustedWarehouseDemo: boolean}>,
): string | null {
  if (gates.roomSidecarDemo && before.roomProgressList !== after.roomProgressList) {
    return 'P21_ROOM_LEGACY_LOCAL_EDIT_REFUSED_USE_SIDECAR_CAS';
  }
  if (gates.trustedWarehouseDemo && before.inventory !== after.inventory) {
    return 'P21_WAREHOUSE_LEGACY_LOCAL_EDIT_REFUSED_USE_TRUSTED_CALLABLE';
  }
  return null;
}

/** Undo/redo must not replay migrated room or trusted ledger snapshots. */
export function p21DemoHistoryMutationError(
  step: Readonly<{changes: readonly {collection: string}[]; orders: readonly {collection: string}[]}>,
  gates: Readonly<{roomSidecarDemo: boolean; trustedWarehouseDemo: boolean}>,
): string | null {
  const touches = (name: string) => step.changes.some(x => x.collection === name) || step.orders.some(x => x.collection === name);
  if (gates.roomSidecarDemo && touches('roomProgressList')) return 'P21_ROOM_UNDO_REDO_REQUIRES_SIDECAR_CAS';
  if (gates.trustedWarehouseDemo && touches('inventory')) return 'P21_WAREHOUSE_UNDO_REDO_REQUIRES_TRUSTED_CALLABLE';
  return null;
}

/** Full-project saves use a separate writer, not saveProjectDiffsToCloud. */
export function assertP21DemoFullProjectSaveBoundary(
  gates: Readonly<{roomSidecarDemo: boolean; trustedWarehouseDemo: boolean}>,
): void {
  // The full writer may contain business records even with a missing/old payload.
  // Refuse the whole operation before project metadata or business records are written.
  if (gates.roomSidecarDemo || gates.trustedWarehouseDemo) {
    throw new Error('P21_GENERIC_FULL_PROJECT_SAVE_BLOCKED_USE_VERIFIED_MIGRATION');
  }
}
