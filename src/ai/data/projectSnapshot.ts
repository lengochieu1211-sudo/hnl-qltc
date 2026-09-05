import type {
  ChecklistItem,
  CrewRecord,
  DefectItem,
  FloorPlan,
  InventoryItem,
  MaterialNorm,
  RoomProgressItem,
  TeamInfo,
  WorkVolume,
} from '../../types';

export interface HnlAiProjectSnapshot {
  projectId: string;
  projectName?: string;
  rooms: readonly RoomProgressItem[];
  defects: readonly DefectItem[];
  crewRecords: readonly CrewRecord[];
  teams: readonly TeamInfo[];
  floors: readonly FloorPlan[];
  workVolumes: readonly WorkVolume[];
  inventory: readonly InventoryItem[];
  materialNorms: readonly MaterialNorm[];
  checklist: readonly ChecklistItem[];
  asOf: number;
  freshness: 'live' | 'cache' | 'fixture';
}

export interface HnlAiHistoricalCoverage {
  crew: 'date-indexed';
  quantity: 'snapshot-only';
  defects: 'event-current-state';
  rooms: 'snapshot-only';
  workVolumes: 'snapshot-only';
}

/**
 * Current HNL schema has date-indexed CrewRecord rows, but room/work-volume quantities
 * are current-state snapshots rather than a complete immutable quantity ledger by day.
 * Phase 1B therefore fails closed for historical quantity totals instead of assigning
 * current snapshot values to an arbitrary past date.
 */
export const HNL_AI_HISTORICAL_COVERAGE: HnlAiHistoricalCoverage = Object.freeze({
  crew: 'date-indexed',
  quantity: 'snapshot-only',
  defects: 'event-current-state',
  rooms: 'snapshot-only',
  workVolumes: 'snapshot-only',
});

export function createHnlAiProjectSnapshot(input: HnlAiProjectSnapshot): HnlAiProjectSnapshot {
  const projectId = String(input.projectId || '').trim();
  if (!projectId) throw new Error('AI_PROJECT_SNAPSHOT_INVALID: Thiếu projectId.');
  if (!Number.isFinite(input.asOf) || input.asOf <= 0) throw new Error('AI_PROJECT_SNAPSHOT_INVALID: asOf không hợp lệ.');

  // Preserve the existing business records by reference; the AI layer is read-only and
  // must never normalize/migrate/mutate source arrays behind the application state.
  return Object.freeze({
    ...input,
    projectId,
    rooms: input.rooms || [],
    defects: input.defects || [],
    crewRecords: input.crewRecords || [],
    teams: input.teams || [],
    floors: input.floors || [],
    workVolumes: input.workVolumes || [],
    inventory: input.inventory || [],
    materialNorms: input.materialNorms || [],
    checklist: input.checklist || [],
  });
}

export function historicalQuantityUnavailableMessage(): string {
  return 'Không đủ dữ liệu lịch sử khối lượng theo ngày trong schema hiện tại. HNL chỉ có snapshot khối lượng hiện tại; không được dùng snapshot để suy diễn khối lượng của một khoảng ngày quá khứ.';
}
