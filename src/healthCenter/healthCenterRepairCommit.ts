import type { UserRole } from '../utils/securityUtils';
import type { HealthCenterSummary } from './healthCenterEngine';
import {
  assertHealthCenterRepairPreviewFresh,
  type HealthCenterRepairPreview,
} from './healthCenterRepair';
import {
  applyHealthCenterRepairPreview,
  buildHealthCenterRepairBackupPayload,
  type HealthCenterRepairApplyFailure,
  type HealthCenterRepairBackupPayload,
} from './healthCenterRepairApply';

export type HealthCenterRepairCommitStatus =
  | 'applied'
  | 'denied'
  | 'stale'
  | 'blocked'
  | 'backup-failed'
  | 'cancelled'
  | 'validation-failed'
  | 'persist-failed';

export interface HealthCenterRepairCommitResult<TData = any> {
  ok: boolean;
  status: HealthCenterRepairCommitStatus;
  data: TData;
  backup?: HealthCenterRepairBackupPayload;
  failures: HealthCenterRepairApplyFailure[];
  appliedOperationIds: string[];
  message: string;
}

export interface HealthCenterRepairCommitParams<TData extends Record<string, any>> {
  projectId: string;
  userRole: UserRole;
  accessVerified: boolean;
  currentReport: HealthCenterSummary;
  preview: HealthCenterRepairPreview;
  /** Must be the latest in-memory project snapshot at the instant the user clicks Apply. */
  fullAppData: TData;
  /** Must resolve only after the backup has been successfully handed to the platform download/export path. */
  saveBackup: (payload: HealthCenterRepairBackupPayload) => Promise<void>;
  /** Explicit ADMIN confirmation shown only after backup succeeds. */
  confirmApply: (summary: { operationCount: number; auditSnapshotId: string }) => boolean | Promise<boolean>;
  /** Canonical application persistence path. The coordinator never talks to Firestore directly. */
  persist: (nextData: TData, context: { preview: HealthCenterRepairPreview; backup: HealthCenterRepairBackupPayload }) => Promise<void>;
}

/**
 * Guarded coordinator for Health Center repair.
 *
 * Order is intentionally strict and fail-closed:
 * 1) RBAC/access -> 2) snapshot freshness -> 3) plan gate -> 4) backup -> 5) ADMIN confirm
 * -> 6) before-value validation + immutable apply -> 7) canonical persistence callback.
 *
 * No persistence callback is invoked when any earlier gate fails. Firestore-specific writes stay
 * outside this module so the app can keep one canonical mutation/persistence path.
 */
export async function commitHealthCenterRepair<TData extends Record<string, any>>(
  params: HealthCenterRepairCommitParams<TData>,
): Promise<HealthCenterRepairCommitResult<TData>> {
  const base = {
    data: params.fullAppData,
    failures: [] as HealthCenterRepairApplyFailure[],
    appliedOperationIds: [] as string[],
  };

  if (!params.accessVerified || params.userRole !== 'ADMIN') {
    return { ...base, ok: false, status: 'denied', message: 'Chỉ ADMIN đã xác minh quyền dự án mới được áp dụng Repair.' };
  }

  try {
    assertHealthCenterRepairPreviewFresh(params.preview, params.currentReport);
  } catch (error) {
    return {
      ...base,
      ok: false,
      status: 'stale',
      message: error instanceof Error ? error.message : 'Repair Preview đã cũ. Hãy quét lại.',
    };
  }

  if (!params.preview.canApply || params.preview.blocked.length > 0 || params.preview.operations.length === 0) {
    return { ...base, ok: false, status: 'blocked', message: 'Repair Preview đang bị chặn hoặc không có thao tác an toàn.' };
  }

  const backup = buildHealthCenterRepairBackupPayload({
    projectId: params.projectId,
    preview: params.preview,
    fullAppData: params.fullAppData,
  });

  try {
    await params.saveBackup(backup);
  } catch (error) {
    return {
      ...base,
      backup,
      ok: false,
      status: 'backup-failed',
      message: `Không lưu được backup trước sửa: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const confirmed = await params.confirmApply({
    operationCount: params.preview.operations.length,
    auditSnapshotId: params.preview.auditSnapshotId,
  });
  if (!confirmed) {
    return { ...base, backup, ok: false, status: 'cancelled', message: 'ADMIN đã hủy Apply. Không có dữ liệu nào bị thay đổi.' };
  }

  const applied = applyHealthCenterRepairPreview(params.fullAppData, params.preview);
  if (!applied.ok) {
    return {
      data: params.fullAppData,
      backup,
      ok: false,
      status: 'validation-failed',
      failures: applied.failures,
      appliedOperationIds: [],
      message: 'Dữ liệu đã thay đổi sau Repair Preview hoặc path không còn hợp lệ. Batch bị hủy toàn bộ.',
    };
  }

  try {
    await params.persist(applied.data, { preview: params.preview, backup });
  } catch (error) {
    return {
      data: params.fullAppData,
      backup,
      ok: false,
      status: 'persist-failed',
      failures: [],
      appliedOperationIds: [],
      message: `Không ghi được Repair qua đường lưu chuẩn của ứng dụng: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    data: applied.data,
    backup,
    ok: true,
    status: 'applied',
    failures: [],
    appliedOperationIds: applied.appliedOperationIds,
    message: `Đã áp dụng ${applied.appliedOperationIds.length} thay đổi an toàn. Cần re-audit ngay sau khi state/persistence cập nhật.`,
  };
}
