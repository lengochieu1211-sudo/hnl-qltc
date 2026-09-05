import type { HnlAiProjectSnapshot } from './projectSnapshot';

export type ExternalAiDataScope = 'progress' | 'defects' | 'crew' | 'inventory' | 'checklist';

export interface ExternalAiDataSelection {
  progress: boolean;
  defects: boolean;
  crew: boolean;
  inventory: boolean;
  checklist: boolean;
}

// Keep external-provider context intentionally smaller than the in-app deterministic snapshot.
const MAX_ROWS_PER_COLLECTION = 60;
const MAX_SUBITEMS_PER_ROOM = 20;

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
    result.teams = active(snapshot.teams).map((team) => ({ id: team.id, name: team.name }));
    result.floors = active(snapshot.floors).map((floor) => ({ id: floor.id, name: floor.floorName }));
    result.rooms = capped(active(snapshot.rooms).map((room) => ({
      id: room.id,
      floorId: room.floorId,
      floorName: room.floorName || '',
      roomName: room.roomName,
      workCategoryId: room.workCategoryId || '',
      workCategory: room.workCategory || '',
      teamId: room.teamId || '',
      assignedTeam: room.assignedTeam || '',
      workVolume: Number.isFinite(Number(room.workVolume)) ? Number(room.workVolume) : null,
      volumeUnit: room.volumeUnit || '',
      inspectionStatus: room.inspectionStatus,
      frameStatus: room.frameStatus,
      boardStatus: room.boardStatus,
      subItems: (room.subItems || []).slice(0, MAX_SUBITEMS_PER_ROOM).map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category || '',
        workCategoryId: item.workCategoryId || '',
        teamId: item.teamId || '',
        assignedTeam: item.assignedTeam || '',
        workVolume: Number.isFinite(Number(item.workVolume)) ? Number(item.workVolume) : null,
        volumeUnit: item.volumeUnit || '',
        status: item.status,
        inspectionStatus: item.inspectionStatus || '',
        targetDate: item.targetDate || '',
      })),
    })));
    result.workVolumes = capped(active(snapshot.workVolumes).map((item) => ({
      id: item.id,
      workCategoryId: item.workCategoryId || '',
      title: item.title,
      floorId: item.floorId || '',
      floor: item.floor,
      category: item.category,
      unit: item.unit,
      planned: item.planned,
      actual: item.actual,
      status: item.status,
      dueDate: item.dueDate || '',
    })));
  }

  if (selection.defects) {
    result.defects = capped(active(snapshot.defects).map((item) => ({
      id: item.id,
      floorId: item.floorId,
      floorName: item.floorName,
      roomId: item.roomId || '',
      positionDetail: safeText(item.positionDetail || ''),
      teamId: item.teamId || '',
      category: item.category,
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
      teamName: item.teamName,
      date: item.date,
      morningCount: item.morningCount ?? null,
      afternoonCount: item.afternoonCount ?? null,
      eveningCount: item.eveningCount ?? null,
      workerCount: item.workerCount,
      floorId: item.floorId || '',
      floorName: item.floorName || '',
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
      materialName: item.materialName,
      unit: item.unit,
      quantity: item.quantity,
      location: item.location,
      date: item.date,
      notes: safeText(item.notes || ''),
    })));
    result.materialNorms = capped(active(snapshot.materialNorms).map((item) => ({
      id: item.id,
      materialId: item.materialId || '',
      category: item.category,
      workCategory: item.workCategory || '',
      workCategoryId: item.workCategoryId || '',
      materialName: item.materialName,
      unit: item.unit,
      quotaQuantity: item.quotaQuantity,
      unitNormPerM2: item.unitNormPerM2 ?? null,
      normBasisUnit: item.normBasisUnit || '',
    })));
  }

  if (selection.checklist) {
    result.checklist = capped(active(snapshot.checklist).map((item) => ({
      id: item.id,
      floorId: item.floorId || '',
      floorName: item.floorName,
      roomId: item.roomId || '',
      teamId: item.teamId || '',
      category: item.category,
      title: item.title,
      status: item.status,
      dueDate: item.dueDate || '',
      notes: safeText(item.notes || ''),
      inspectedAt: item.inspectedAt || '',
    })));
  }

  return result;
}
