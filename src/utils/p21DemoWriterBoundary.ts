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
