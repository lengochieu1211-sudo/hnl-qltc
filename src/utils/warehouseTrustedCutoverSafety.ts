/** Pure DEV-only trusted warehouse cutover guards.
 * These run before ANY mutation, rather than allowing sequential partial
 * imports or a room-auto write to fail halfway through a batch.
 * They deliberately do not discard or silently rewrite imported records.
 */
export interface WarehouseImportCandidate {
  id?: string;
  sourceType?: string;
  revision?: number;
}
export function assertTrustedWarehouseAutoIssueSupported(trustedMode: boolean): void {
  if (trustedMode) {
    throw new Error('WAREHOUSE_TRUSTED_ROOM_AUTO_NOT_READY: Xuất kho tự động chưa chuyển sang giao dịch máy chủ; chưa tạo phiếu nào.');
  }
}
export function assertTrustedWarehouseImportSupported(
  trustedMode: boolean,
  incoming: readonly WarehouseImportCandidate[],
  existing: ReadonlyMap<string, WarehouseImportCandidate>,
): void {
  if (!trustedMode) return;
  if (incoming.length > 30) {
    // Firestore's one-transaction DEV import is explicitly capped. Never silently
    // split an oversized batch into partial independent commits.
    throw new Error('WAREHOUSE_TRUSTED_BATCH_IMPORT_TOO_LARGE: Tối đa 30 phiếu mỗi lần; chưa nhập phiếu nào.');
  }
  if (new Set(incoming.map(item => item?.id)).size !== incoming.length) {
    throw new Error('WAREHOUSE_TRUSTED_BATCH_DUPLICATE_ID');
  }
  for (const item of incoming) {
    if (!item || !item.id || typeof item.id !== 'string') {
      throw new Error('WAREHOUSE_TRUSTED_IMPORT_INVALID_ID');
    }
    if (item.sourceType && item.sourceType !== 'manual') {
      throw new Error('WAREHOUSE_TRUSTED_IMPORT_SYSTEM_VOUCHER_BLOCKED');
    }
    const prior = existing.get(item.id);
    if (prior && prior.sourceType && prior.sourceType !== 'manual') {
      throw new Error('WAREHOUSE_TRUSTED_IMPORT_EXISTING_SYSTEM_VOUCHER_BLOCKED');
    }
    // Never accept an offline/stale update that supplies a different revision
    // from the verified local snapshot, even before server-side CAS check.
    if (prior && item.revision !== prior.revision) {
      throw new Error('WAREHOUSE_TRUSTED_IMPORT_REVISION_CONFLICT');
    }
  }
}
