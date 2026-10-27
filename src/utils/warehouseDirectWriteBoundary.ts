/**
 * DEV trusted-warehouse cutover boundary. The legacy full-project restore and
 * generic realtime/offline diff writers MUST NOT issue inventory writes when
 * the voucher/balance pair is owned by the server. These helpers run before any
 * batch is enqueued, so an invalid request cannot partially write a project.
 * A blocked record stays in its original state; never silently drop it.
 */
export function assertNoLegacyInventoryDiffs(
  trustedWriter: boolean,
  diffs: {
    addedOrModified?: Record<string, readonly unknown[]>;
    deletedIds?: Record<string, readonly unknown[]>;
  },
  operation: 'realtime-diff' | 'offline-queue',
): void {
  if (!trustedWriter) return;
  const upserts = diffs.addedOrModified?.inventory;
  const removals = diffs.deletedIds?.inventory;
  if ((Array.isArray(upserts) && upserts.length > 0) ||
      (Array.isArray(removals) && removals.length > 0)) {
    throw new Error(`WAREHOUSE_TRUSTED_DIRECT_LEDGER_WRITE_BLOCKED:${operation}`);
  }
}

export function assertNoLegacyInventoryRestore(
  trustedWriter: boolean,
  inventory: unknown,
): void {
  if (trustedWriter && Array.isArray(inventory) && inventory.length > 0) {
    throw new Error('WAREHOUSE_TRUSTED_DIRECT_LEDGER_WRITE_BLOCKED:project-restore');
  }
}
