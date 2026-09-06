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

const MAX_ROWS_PER_COLLECTION = 36;
const MAX_SUBITEMS_PER_ROOM = 12;
const MAX_EXTERNAL_MESSAGE_CHARS = 21_500;

function safeText(value: unknown): string {
  return String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email đã ẩn]')
    .replace(/(?:\+?84|0)(?:[ .-]?\d){8,10}/g, '[số điện thoại đã ẩn]')
    .slice(0, 600);
}

function normalizedText(value: unknown): string {
  return safeText(value).trim().toLocaleLowerCase('vi');
}

function active<T extends { deletedAt?: number | null }>(items: readonly T[]): T[] {
  return items.filter((item) => item.deletedAt === undefined || item.deletedAt === null);
}

function capped<T>(items: T[], limit = MAX_ROWS_PER_COLLECTION) {
  return {
    rows: items.slice(0, limit),
    total: items.length,
    truncated: items.length > limit,
  };
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function buildTeamResolver(snapshot: HnlAiProjectSnapshot) {
  const teamNameById = new Map<string, string>();
  const teamByName = new Map<string, { id: string; name: string }>();
  for (const team of active(snapshot.teams)) {
    const id = String(team.id || '').trim();
    const name = safeText(team.name).trim();
    if (id && name) teamNameById.set(id, name);
    if (name) teamByName.set(normalizedText(name), { id, name });
  }
  return (teamId?: string, teamName?: string) => {
    const id = String(teamId || '').trim();
    const declaredName = id ? teamNameById.get(id) : '';
    if (declaredName) return { teamId: id, teamName: declaredName };
    const name = safeText(teamName || '').trim();
    const declared = name ? teamByName.get(normalizedText(name)) : undefined;
    if (declared) return { teamId: declared.id || id, teamName: declared.name };
    return { teamId: id, teamName: name };
  };
}

function sameCategory(categoryName: string, categoryId: string, subItem: { category?: string; workCategoryId?: string }): boolean {
  if (categoryId && subItem.workCategoryId && categoryId === subItem.workCategoryId) return true;
  const left = normalizedText(categoryName);
  const right = normalizedText(subItem.category || '');
  return Boolean(left && right && left === right);
}

function buildQuantityRows(snapshot: HnlAiProjectSnapshot): QuantityRow[] {
  const rows: QuantityRow[] = [];
  const resolveTeam = buildTeamResolver(snapshot);

  for (const room of active(snapshot.rooms)) {
    const roomTeam = resolveTeam(room.teamId, room.assignedTeam);
    const base = {
      floorId: room.floorId || '',
      floorName: safeText(room.floorName || ''),
      roomId: room.id,
      roomName: safeText(room.roomName || ''),
      teamId: roomTeam.teamId,
      teamName: roomTeam.teamName,
      workCategoryId: room.workCategoryId || '',
      workCategory: safeText(room.workCategory || ''),
      updatedAt: finiteNumber(room.updatedAt),
    };

    const categoryEntries = Object.entries(room.categoryVolumes || {}).filter(([, value]) => finiteNumber(value) !== null);
    if (categoryEntries.length > 0) {
      for (const [category, value] of categoryEntries) {
        const categoryName = safeText(category || base.workCategory);
        const relatedSubItems = (room.subItems || []).filter((item) => sameCategory(categoryName, base.workCategoryId, item));
        const relatedTeams = Array.from(new Map(
          relatedSubItems
            .map((item) => resolveTeam(item.teamId, item.assignedTeam))
            .filter((team) => team.teamId || team.teamName)
            .map((team) => [`${team.teamId}|${normalizedText(team.teamName)}`, team] as const),
        ).values());
        const categoryTeam = relatedTeams.length === 1 ? relatedTeams[0] : roomTeam;
        rows.push({
          source: 'room-category',
          ...base,
          teamId: categoryTeam.teamId,
          teamName: categoryTeam.teamName,
          workCategory: categoryName,
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
        const itemTeam = resolveTeam(item.teamId || base.teamId, item.assignedTeam || base.teamName);
        rows.push({
          source: 'sub-item',
          ...base,
          teamId: itemTeam.teamId,
          teamName: itemTeam.teamName,
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

function detectMentionedTeams(question: string, snapshot: HnlAiProjectSnapshot) {
  const q = normalizedText(question);
  return active(snapshot.teams)
    .map((team) => ({ id: String(team.id || ''), name: safeText(team.name).trim() }))
    .filter((team) => team.name && q.includes(normalizedText(team.name)));
}

function isTeamMatch(row: { teamId?: string; teamName?: string; assignedTeam?: string }, targets: Array<{ id: string; name: string }>): boolean {
  if (targets.length === 0) return true;
  const rowId = String(row.teamId || '');
  const rowName = normalizedText(row.teamName || row.assignedTeam || '');
  return targets.some((target) => (target.id && rowId === target.id) || (target.name && rowName === normalizedText(target.name)));
}

function questionNeeds(question: string) {
  const q = normalizedText(question);
  return {
    quantity: /khối lượng|khoi luong|m2|m²|m3|m³|sản lượng|san luong/.test(q),
    crew: /quân số|quan so|nhân công|nhan cong|công nhật|cong nhat|ngày công|ngay cong/.test(q),
    progress: /tầng|tang|căn|can|phòng|phong|hạng mục|hang muc|tiến độ|tien do/.test(q),
    defects: /defect|lỗi|loi|tồn tại|ton tai/.test(q),
  };
}

function rawRoomRows(snapshot: HnlAiProjectSnapshot, targets: Array<{ id: string; name: string }>) {
  return active(snapshot.rooms)
    .map((room) => ({
      id: room.id,
      floorId: room.floorId || '',
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
        workVolume: finiteNumber(item.workVolume),
        volumeUnit: safeText(item.volumeUnit || ''),
        status: item.status,
        inspectionStatus: item.inspectionStatus || '',
        targetDate: item.targetDate || '',
      })),
    }))
    .filter((room) => targets.length === 0 || isTeamMatch(room, targets) || room.subItems.some((item) => isTeamMatch(item, targets)));
}

function rawCrewRows(snapshot: HnlAiProjectSnapshot, targets: Array<{ id: string; name: string }>) {
  return active(snapshot.crewRecords)
    .map((item) => ({
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
    }))
    .filter((row) => isTeamMatch(row, targets));
}

export function buildExternalAiProjectContext(snapshot: HnlAiProjectSnapshot, selection: ExternalAiDataSelection) {
  const result: Record<string, unknown> = {
    project: { id: snapshot.projectId, name: safeText(snapshot.projectName || ''), asOf: snapshot.asOf, freshness: snapshot.freshness },
    privacy: 'read-only sanitized HNL project context; credentials/contact data excluded',
  };

  if (selection.progress) {
    result.teams = active(snapshot.teams).map((team) => ({ id: team.id, name: safeText(team.name) }));
    result.floors = active(snapshot.floors).map((floor) => ({ id: floor.id, name: safeText(floor.floorName) }));
    result.rooms = capped(rawRoomRows(snapshot, []));
  }
  if (selection.quantities) {
    const rows = buildQuantityRows(snapshot);
    result.quantityDetails = capped(rows);
    result.quantitySummaryByTeamAndCategory = capped(buildQuantitySummary(rows));
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
  if (selection.crew) result.crew = capped(rawCrewRows(snapshot, []));
  if (selection.inventory) {
    result.inventory = capped(active(snapshot.inventory).map((item) => ({
      id: item.id, type: item.type, materialId: item.materialId || '', materialName: safeText(item.materialName), unit: safeText(item.unit), quantity: item.quantity, location: safeText(item.location), date: item.date, notes: safeText(item.notes || ''),
    })));
    result.materialNorms = capped(active(snapshot.materialNorms).map((item) => ({
      id: item.id, materialId: item.materialId || '', category: safeText(item.category), workCategory: safeText(item.workCategory || ''), workCategoryId: item.workCategoryId || '', materialName: safeText(item.materialName), unit: safeText(item.unit), quotaQuantity: item.quotaQuantity, unitNormPerM2: item.unitNormPerM2 ?? null, normBasisUnit: safeText(item.normBasisUnit || ''),
    })));
  }
  if (selection.checklist) {
    result.checklist = capped(active(snapshot.checklist).map((item) => ({
      id: item.id, floorId: item.floorId || '', floorName: safeText(item.floorName), roomId: item.roomId || '', teamId: item.teamId || '', category: safeText(item.category), title: safeText(item.title), status: item.status, dueDate: item.dueDate || '', notes: safeText(item.notes || ''), inspectedAt: item.inspectedAt || '',
    })));
  }
  return result;
}

function buildQuestionFocusedContext(question: string, snapshot: HnlAiProjectSnapshot, selection: ExternalAiDataSelection) {
  const targets = detectMentionedTeams(question, snapshot);
  const needs = questionNeeds(question);
  const context = buildExternalAiProjectContext(snapshot, selection) as Record<string, any>;

  context.aiContract = {
    role: 'HNL supplies factual raw records; AI filters, groups, calculates and presents.',
    calculation: 'AI may calculate sums/counts/ratios only from supplied raw rows. Never invent missing rows or sample quantities.',
    grounding: 'Every numeric conclusion must be traceable to one or more supplied rows. Preserve unit and entity scope (team/floor/category/item/date).',
    historicalQuantity: 'Quantity is a current snapshot unless a dated immutable quantity ledger exists. Do not assign snapshot quantity to a past date range.',
  };

  if (targets.length > 0) context.requestedTeams = targets;

  if (selection.quantities && (needs.quantity || targets.length > 0)) {
    const allQuantityRows = buildQuantityRows(snapshot);
    const rows = targets.length > 0 ? allQuantityRows.filter((row) => isTeamMatch(row, targets)) : allQuantityRows;
    context.quantityDetails = capped(rows, 72);
    context.quantityValidationTotals = capped(buildQuantitySummary(rows), 48);
  }

  if (selection.crew && (needs.crew || targets.length > 0)) {
    context.crew = capped(rawCrewRows(snapshot, targets), 72);
  }

  if (selection.progress && (needs.progress || targets.length > 0)) {
    context.rooms = capped(rawRoomRows(snapshot, targets), 48);
  }

  if (selection.defects && (needs.defects || targets.length > 0)) {
    const defects = active(snapshot.defects).map((item) => ({
      id: item.id,
      floorId: item.floorId,
      floorName: safeText(item.floorName),
      roomId: item.roomId || '',
      teamId: item.teamId || '',
      category: safeText(item.category),
      description: safeText(item.description),
      severity: item.severity,
      status: item.status,
      dueDate: item.dueDate || '',
      completedAt: item.completedAt || '',
    }));
    context.defects = capped(targets.length > 0 ? defects.filter((row) => isTeamMatch(row, targets)) : defects, 48);
  }

  return context;
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

export function buildExternalAiQuestionPayload(question: string, snapshot: HnlAiProjectSnapshot, selection: ExternalAiDataSelection): string {
  const context = buildQuestionFocusedContext(question, snapshot, selection) as Record<string, any>;
  const payload = { question: safeText(question), hnlContext: context };
  let serialized = JSON.stringify(payload);
  if (serialized.length <= MAX_EXTERNAL_MESSAGE_CHARS) return serialized;

  compactCappedRows(context, 24);
  if (Array.isArray(context.teams)) context.teams = context.teams.slice(0, 30);
  if (Array.isArray(context.floors)) context.floors = context.floors.slice(0, 30);
  serialized = JSON.stringify(payload);
  if (serialized.length <= MAX_EXTERNAL_MESSAGE_CHARS) return serialized;

  compactCappedRows(context, 12);
  serialized = JSON.stringify(payload);
  if (serialized.length <= MAX_EXTERNAL_MESSAGE_CHARS) return serialized;

  if (context.rooms) delete context.rooms;
  if (context.workVolumes) delete context.workVolumes;
  compactCappedRows(context, 8);
  serialized = JSON.stringify(payload);
  if (serialized.length <= MAX_EXTERNAL_MESSAGE_CHARS) return serialized;

  throw new Error('HNL_AI_CONTEXT_TOO_LARGE');
}
