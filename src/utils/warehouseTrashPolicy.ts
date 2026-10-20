import type { TrashSettings } from '../lib/trash';

/** Warehouse ledger tombstones stay intact; this policy controls RECOVERY only.
 * A missing expiry on legacy vouchers uses 7 days from the original deletion.
 * Never extend old recoverability when an ADMIN changes the setting later.
 */
export const LEGACY_WAREHOUSE_TRASH_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_DAYS = [3, 7, 15, 30, 60, 90] as const;

export interface WarehouseTrashMetadata {
  deleted?: boolean;
  deletedAt?: number | null;
  trashRetentionDays?: number | null;
  trashExpiresAt?: number | null;
  trashRecoverable?: boolean | null;
  trashDiscardedAt?: number | null;
}

export function createWarehouseTrashMetadata(settings: TrashSettings, deletedAt: number): WarehouseTrashMetadata {
  const requestedDays = Number(settings.retentionDays);
  const days = ALLOWED_DAYS.some(value => value === requestedDays) ? requestedDays : LEGACY_WAREHOUSE_TRASH_DAYS;
  const enabled = settings.enabled !== false;
  return {
    trashRetentionDays: days,
    trashExpiresAt: enabled ? deletedAt + days * DAY_MS : deletedAt,
    trashRecoverable: enabled,
    trashDiscardedAt: enabled ? null : deletedAt,
  };
}

export function getWarehouseTrashExpiry(row: WarehouseTrashMetadata): number {
  const deletedAt = Number(row.deletedAt || 0);
  if (!Number.isFinite(deletedAt) || deletedAt <= 0) return 0;
  if (row.trashExpiresAt !== undefined && row.trashExpiresAt !== null) {
    const explicit = Number(row.trashExpiresAt);
    return Number.isFinite(explicit) && explicit > 0 ? explicit : 0;
  }
  return deletedAt + LEGACY_WAREHOUSE_TRASH_DAYS * DAY_MS;
}

export function isWarehouseVoucherRecoverable(row: WarehouseTrashMetadata, now = Date.now()): boolean {
  return row.deleted === true
    && row.trashRecoverable !== false
    && !(Number(row.trashDiscardedAt || 0) > 0)
    && getWarehouseTrashExpiry(row) > now;
}
