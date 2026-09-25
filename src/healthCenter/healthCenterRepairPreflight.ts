export interface HealthCenterRepairSyncDiagnostics {
  online?: unknown;
  dataCloudPhase?: unknown;
  pendingData?: unknown;
  cloudInitialReady?: unknown;
  snapshotReadyCount?: unknown;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getHealthCenterRepairBlockReason(input: HealthCenterRepairSyncDiagnostics | null | undefined): string | null {
  if (!input) return null;
  if (input.online === false) return 'Thiết bị đang offline.';

  const phase = String(input.dataCloudPhase || '').trim().toLowerCase();
  if (phase === 'conflict') return 'Firestore đang có xung đột revision/Rules; cần chờ realtime hòa giải và quét lại trước khi sửa.';
  if (phase === 'error') return 'Firestore đang báo lỗi đồng bộ; cần xử lý lỗi và quét lại trước khi sửa.';
  if (phase === 'syncing') return 'Firestore đang đồng bộ; cần chờ đồng bộ hoàn tất trước khi sửa.';

  const pendingData = finiteNumber(input.pendingData);
  if (pendingData !== null && pendingData > 0) return `Còn ${pendingData} thay đổi dữ liệu đang chờ Firebase xác nhận.`;
  if (input.cloudInitialReady === false) return 'Snapshot Cloud ban đầu chưa sẵn sàng.';

  const snapshotReadyCount = finiteNumber(input.snapshotReadyCount);
  if (snapshotReadyCount !== null && snapshotReadyCount < 9) return `Realtime mới sẵn sàng ${snapshotReadyCount}/9 nguồn dữ liệu.`;

  return null;
}
