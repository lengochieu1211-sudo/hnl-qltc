import type { HnlAiProjectSnapshot } from './projectSnapshot';

export type ExternalAiDataScope = 'progress' | 'quantities' | 'defects' | 'crew' | 'inventory' | 'checklist';

export interface ExternalAiDataSelection {
  progress: boolean;
  quantities: boolean;
  defects: boolean;
  crew: boolean;
  inventory: boolean;
  checklist: boolean;
}

// External-provider context must stay much smaller than the in-app deterministic snapshot.
// The AI Gateway currently limits each message to 24k characters, so the final question
// payload is hard-capped below that limit with deterministic compaction.
const MAX_ROWS_PER_COLLECTION = 36;
const MAX_SUBITEMS_PER_ROOM = 12;
const MAX_EXTERNAL_MESSAGE_CHARS = 21_500;

function safeText(value: unknown): string {
  return String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email đã ẩn]')
    .replace(/(?:\+?84|0)(?:[ .-]?\d){8,10}/g, '[số điện thoại đã ẩn]')
    .slice(0, 600);
}

function active<T extends { deletedAt?: number | null }>(items: readonly T[]): T[] {
  return items.filter((item) => item.deletedAt === undefined || item.deletedAt === null);
}

function capped<T>(items: T[]) {
  return {
    rows: items.slice(0, MAX_ROWS_PER_COLLECTION),
    total: items.length,
    truncated: items.length > MAX_ROWS_PER_COLLECTION,
  };
}

type QuantityRow = {
  source: 'room-category' | 'sub-item' | 'room-total';
  floorId: string;
  floorName: string;
  roomId: string;
  roomName: string;
  teamId: string;
  teamName: string;
  workCategoryId: string;
  workCategory: string;
  item: string;
  volume: number;
  unit: string;
  status: string;
  updatedAt: number | null;
};

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildQuantityRows(snapshot: HnlAiProjectSnapshot): QuantityRow[] {
  const rows: QuantityRow[] = [];
  for (const room of active(snapshot.rooms)) {
    const base = {
      floorId: room.floorId || '',
      floorName: safeText(room.floorName || ''),
      roomId: room.id,
      roomName: safeText(room.roomName || ''),
      teamId: room.teamId || '',
      teamName: safeText(room.assignedTeam || ''),
      workCategoryId: room.workCategoryId || '',
      workCategory: safeText(room.workCategory || ''),
      updatedAt: finiteNumber(room.updatedAt),
    };

    const categoryEntries = Object.entries(room.categoryVolumes || {}).filter(([, value]) => finiteNumber(value) !== null);
    if (categoryEntries.length > 0) {
      for (const [category, value] of categoryEntries) {
        rows.push({
          source: 'room-category',
          ...base,
          workCategory: safeText(category || base.workCategory),
          item: safeText(category || base.workCategory || room.roomName),
          volume: Number(value),
          unit: safeText(room.categoryVolumeUnits?.[category] || room.volumeUnit || ''),
          status: room.inspectionStatus || '',
        });
      }
      continue;
    }

    const subRows = (room.subItems || []).filter((item) => finiteNumber(item.workVolume) !== null);
    if (subRows.length > 0) {
      for (const item of subRows) {
        rows.push({
          source: 'sub-item',
          ...base,
          teamId: item.teamId || base.teamId,
          teamName: safeText(item.assignedTeam || base.teamName),
          workCategoryId: item.workCategoryId || base.workCategoryId,
          workCategory: safeText(item.category || base.workCategory),
          item: safeText(item.name || item.category || base.workCategory),
          volume: Number(item.workVolume),
          unit: safeText(item.volumeUnit || room.volumeUnit || ''),
          status: item.status || '',
        });
      }
      continue;
    }

    const roomVolume = finiteNumber(room.workVolume);
    if (roomVolume !== null) {
      rows.push({
        source: 'room-total',
        ...base,
        item: safeText(base.workCategory || room.roomName),
        volume: roomVolume,
        unit: safeText(room.volumeUnit || ''),
        status: room.inspectionStatus || '',
      });
    }
  }
  return rows;
}

function buildQuantitySummary(rows: QuantityRow[]) {
  const map = new Map<string, { teamId: string; teamName: string; workCategoryId: string; workCategory: string; unit: string; volume: number; records: number }>();
  for (const row of rows) {
    const key = [row.teamId, row.teamName, row.workCategoryId, row.workCategory, row.unit].join('|');
    const current = map.get(key) || {
      teamId: row.teamId,
      teamName: row.teamName,
      workCategoryId: row.workCategoryId,
      workCategory: row.workCategory,
      unit: row.unit,
      volume: 0,
      records: 0,
    };
    current.volume += row.volume;
    current.records += 1;
    map.set(key, current);
  }
  return Array.from(map.values())
    .map((item) => ({ ...item, volume: Math.round(item.volume * 1000) / 1000 }))
    .sort((a, b) => (a.teamName || a.teamId).localeCompare(b.teamName || b.teamId, 'vi') || a.workCategory.localeCompare(b.workCategory, 'vi'));
}

/**
 * Builds a read-only, privacy-minimized context for an external AI provider.
 * Credentials, Firebase configuration, phone numbers, emails, UIDs and device/local
 * storage identifiers never enter this payload. The user must explicitly opt in in UI.
 */
export function buildExternalAiProjectContext(
  snapshot: HnlAiProjectSnapshot,
  selection: ExternalAiDataSelection,
) {
  const result: Record<string, unknown> = {
    project: {
      id: snapshot.projectId,
      name: safeText(snapshot.projectName || ''),
      asOf: snapshot.asOf,
      freshness: snapshot.freshness,
    },
    privacy: 'read-only sanitized HNL project context; credentials/contact data excluded',
  };

  if (selection.progress) {
    result.teams = active(snapshot.teams).map((team) => ({ id: team.id, name: safeText(team.name) }));
    result.floors = active(snapshot.floors).map((floor) => ({ id: floor.id, name: safeText(floor.floorName) }));
    result.rooms = capped(active(snapshot.rooms).map((room) => ({
      id: room.id,
      floorId: room.floorId,
      floorName: safeText(room.floorName || ''),
      roomName: safeText(room.roomName),
      workCategoryId: room.workCategoryId || '',
      workCategory: safeText(room.workCategory || ''),
      teamId: room.teamId || '',
      assignedTeam: safeText(room.assignedTeam || ''),
      inspectionStatus: room.inspectionStatus,
      frameStatus: room.frameStatus,
      boardStatus: room.boardStatus,
      targetFrameDate: room.targetFrameDate || '',
      targetBoardDate: room.targetBoardDate || '',
      subItems: (room.subItems || []).slice(0, MAX_SUBITEMS_PER_ROOM).map((item) => ({
        id: item.id,
        name: safeText(item.name),
        category: safeText(item.category || ''),
        workCategoryId: item.workCategoryId || '',
        teamId: item.teamId || '',
        assignedTeam: safeText(item.assignedTeam || ''),
        status: item.status,
        inspectionStatus: item.inspectionStatus || '',
        targetDate: item.targetDate || '',
      })),
    })));
  }

  if (selection.quantities) {
    const quantityRows = buildQuantityRows(snapshot);
    result.quantitySummaryByTeamAndCategory = capped(buildQuantitySummary(quantityRows));
    result.quantityDetails = capped(quantityRows);
    result.workVolumes = capped(active(snapshot.workVolumes).map((item) => ({
      id: item.id,
      workCategoryId: item.workCategoryId || '',
      title: safeText(item.title),
      floorId: item.floorId || '',
      floor: safeText(item.floor),
      category: safeText(item.category),
      unit: safeText(item.unit),
      planned: item.planned,
      actual: item.actual,
      status: item.status,
      dueDate: item.dueDate || '',
    })));
    result.quantitySemantics = 'Current project quantity snapshot. updatedAt is last modification time, not proof that quantity was executed on that date. Do not claim date-range executed quantity unless dated source records support it.';
  }

  if (selection.defects) {
    result.defects = capped(active(snapshot.defects).map((item) => ({
      id: item.id,
      floorId: item.floorId,
      floorName: safeText(item.floorName),
      roomId: item.roomId || '',
      positionDetail: safeText(item.positionDetail || ''),
      teamId: item.teamId || '',
      category: safeText(item.category),
      description: safeText(item.description),
      severity: item.severity,
      status: item.status,
      dueDate: item.dueDate || '',
      completedAt: item.completedAt || '',
      createdAt: item.createdAt,
    })));
  }

  if (selection.crew) {
    result.crew = capped(active(snapshot.crewRecords).map((item) => ({
      id: item.id,
      teamId: item.teamId || '',
      teamName: safeText(item.teamName),
      date: item.date,
      morningCount: item.morningCount ?? null,
      afternoonCount: item.afternoonCount ?? null,
      eveningCount: item.eveningCount ?? null,
      workerCount: item.workerCount,
      floorId: item.floorId || '',
      floorName: safeText(item.floorName || ''),
      floorWorks: item.floorWorks || [],
      taskDescription: safeText(item.taskDescription),
      shift: item.shift || '',
      notes: safeText(item.notes || ''),
    })));
  }

  if (selection.inventory) {
    result.inventory = capped(active(snapshot.inventory).map((item) => ({
      id: item.id,
      type: item.type,
      materialId: item.materialId || '',
      materialName: safeText(item.materialName),
      unit: safeText(item.unit),
      quantity: item.quantity,
      location: safeText(item.location),
      date: item.date,
      notes: safeText(item.notes || ''),
    })));
    result.materialNorms = capped(active(snapshot.materialNorms).map((item) => ({
      id: item.id,
      materialId: item.materialId || '',
      category: safeText(item.category),
      workCategory: safeText(item.workCategory || ''),
      workCategoryId: item.workCategoryId || '',
      materialName: safeText(item.materialName),
      unit: safeText(item.unit),
      quotaQuantity: item.quotaQuantity,
      unitNormPerM2: item.unitNormPerM2 ?? null,
      normBasisUnit: safeText(item.normBasisUnit || ''),
    })));
  }

  if (selection.checklist) {
    result.checklist = capped(active(snapshot.checklist).map((item) => ({
      id: item.id,
      floorId: item.floorId || '',
      floorName: safeText(item.floorName),
      roomId: item.roomId || '',
      teamId: item.teamId || '',
      category: safeText(item.category),
      title: safeText(item.title),
      status: item.status,
      dueDate: item.dueDate || '',
      notes: safeText(item.notes || ''),
      inspectedAt: item.inspectedAt || '',
    })));
  }

  return result;
}

function compactCappedRows(context: Record<string, any>, rowLimit: number) {
  for (const value of Object.values(context)) {
    if (value && typeof value === 'object' && Array.isArray((value as any).rows)) {
      const original = (value as any).rows as unknown[];
      if (original.length > rowLimit) {
        (value as any).rows = original.slice(0, rowLimit);
        (value as any).truncated = true;
      }
    }
  }
}

/** Serialize one external-AI question under the gateway's per-message limit. */
export function buildExternalAiQuestionPayload(
  question: string,
  snapshot: HnlAiProjectSnapshot,
  selection: ExternalAiDataSelection,
): string {
  const context = buildExternalAiProjectContext(snapshot, selection) as Record<string, any>;
  const payload = { question: safeText(question), hnlContext: context };
  let serialized = JSON.stringify(payload);
  if (serialized.length <= MAX_EXTERNAL_MESSAGE_CHARS) return serialized;

  compactCappedRows(context, 12);
  if (Array.isArray(context.teams)) context.teams = context.teams.slice(0, 30);
  if (Array.isArray(context.floors)) context.floors = context.floors.slice(0, 30);
  serialized = JSON.stringify(payload);
  if (serialized.length <= MAX_EXTERNAL_MESSAGE_CHARS) return serialized;

  compactCappedRows(context, 6);
  serialized = JSON.stringify(payload);
  if (serialized.length <= MAX_EXTERNAL_MESSAGE_CHARS) return serialized;

  // Final safety mode preserves aggregate quantities and top rows but drops verbose room details.
  if (context.rooms) delete context.rooms;
  if (context.quantityDetails) {
    context.quantityDetails.rows = (context.quantityDetails.rows || []).slice(0, 4);
    context.quantityDetails.truncated = true;
  }
  serialized = JSON.stringify(payload);
  if (serialized.length <= MAX_EXTERNAL_MESSAGE_CHARS) return serialized;

  throw new Error('HNL_AI_CONTEXT_TOO_LARGE');
}
