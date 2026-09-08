import type { HnlAiProjectSnapshot } from './projectSnapshot';
import { computeMaterialNeeds } from '../../utils/materialNeedEngine';

export type ExternalAiDataScope = 'progress' | 'quantities' | 'defects' | 'crew' | 'inventory' | 'checklist';

export interface ExternalAiDataSelection {
  progress: boolean;
  quantities: boolean;
  defects: boolean;
  crew: boolean;
  inventory: boolean;
  checklist: boolean;
}

export interface ExternalAiQuestionOptions {
  /** Send a broader sanitized/capped project snapshot for one general-analysis question. */
  fullProjectRaw?: boolean;
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

function lookupText(value: unknown): string {
  return safeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('vi');
}

function active<T extends { deletedAt?: number | null }>(items: readonly T[]): T[] {
  return items.filter((item) => item.deletedAt === undefined || item.deletedAt === null);
}

function capped<T>(items: T[], limit = MAX_ROWS_PER_COLLECTION) {
  return { rows: items.slice(0, limit), total: items.length, truncated: items.length > limit };
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

function buildFloorResolver(snapshot: HnlAiProjectSnapshot) {
  const byId = new Map<string, string>();
  for (const floor of active(snapshot.floors)) {
    const id = String(floor.id || '').trim();
    const name = safeText(floor.floorName || '').trim();
    if (id && name) byId.set(id, name);
  }
  return (floorId?: string, floorName?: string) => {
    const explicit = safeText(floorName || '').trim();
    if (explicit) return explicit;
    return byId.get(String(floorId || '').trim()) || '';
  };
}

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
    const byId = id ? teamNameById.get(id) : '';
    if (byId) return { teamId: id, teamName: byId };
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
  const result: QuantityRow[] = [];
  const resolveTeam = buildTeamResolver(snapshot);
  const resolveFloor = buildFloorResolver(snapshot);

  for (const room of active(snapshot.rooms)) {
    const roomTeam = resolveTeam(room.teamId, room.assignedTeam);
    const base = {
      floorId: room.floorId || '',
      floorName: resolveFloor(room.floorId, room.floorName),
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
        result.push({
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
        result.push({
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
      result.push({
        source: 'room-total',
        ...base,
        item: safeText(base.workCategory || room.roomName),
        volume: roomVolume,
        unit: safeText(room.volumeUnit || ''),
        status: room.inspectionStatus || '',
      });
    }
  }
  return result;
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
    material: /vật tư|vat tu|khung|tấm|tam|ty treo|phụ kiện|phu kien|vít|vit/.test(q),
  };
}

function rawRoomRows(snapshot: HnlAiProjectSnapshot, targets: Array<{ id: string; name: string }>) {
  const resolveFloor = buildFloorResolver(snapshot);
  return active(snapshot.rooms)
    .map((room) => ({
      id: room.id,
      floorId: room.floorId || '',
      floorName: resolveFloor(room.floorId, room.floorName),
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
  const resolveFloor = buildFloorResolver(snapshot);
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
      floorName: resolveFloor(item.floorId, item.floorName),
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
    const quantityRows = buildQuantityRows(snapshot);
    result.quantityDetails = capped(quantityRows);
    result.quantitySummaryByTeamAndCategory = capped(buildQuantitySummary(quantityRows));
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
    const resolveFloor = buildFloorResolver(snapshot);
    result.defects = capped(active(snapshot.defects).map((item) => ({
      id: item.id,
      floorId: item.floorId,
      floorName: resolveFloor(item.floorId, item.floorName),
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
    const resolveFloor = buildFloorResolver(snapshot);
    result.checklist = capped(active(snapshot.checklist).map((item) => ({
      id: item.id,
      floorId: item.floorId || '',
      floorName: resolveFloor(item.floorId, item.floorName),
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

function resolveMaterialScopes(question: string, snapshot: HnlAiProjectSnapshot) {
  const q = lookupText(question);
  const targets = detectMentionedTeams(question, snapshot);
  const activeFloors = active(snapshot.floors)
    .map((floor) => ({
      id: String(floor.id || '').trim(),
      name: safeText(floor.floorName || '').trim(),
      lookup: lookupText(floor.floorName || ''),
    }))
    .filter((floor) => floor.id && floor.name);

  const resolved = new Map<string, { id: string; name: string }>();
  const unresolvedTokens = new Set<string>();

  // First prefer exact floor names present in the question (handles "Tầng Trệt", "Tầng 1 (SOL)", etc).
  for (const floor of activeFloors) {
    if (floor.lookup && q.includes(floor.lookup)) resolved.set(floor.id, { id: floor.id, name: floor.name });
  }

  // Also parse compact multi-floor language such as "tầng 1 và 3", "tầng 1, 2, 3".
  const floorPhrase = q.match(/\btang\s+([a-z0-9_-]+(?:\s*(?:,|\/|&|va|và)\s*[a-z0-9_-]+)*)/i)?.[1] || '';
  const tokens = floorPhrase
    ? floorPhrase.split(/\s*(?:,|\/|&|\bva\b|\bvà\b)\s*/i).map((token) => token.trim()).filter(Boolean)
    : [];

  for (const token of tokens) {
    const floor = activeFloors.find((item) => {
      const name = item.lookup;
      return name === `tang ${token}` || name.endsWith(` ${token}`) || name === token || name.startsWith(`tang ${token} `);
    });
    if (floor) resolved.set(floor.id, { id: floor.id, name: floor.name });
    else unresolvedTokens.add(token);
  }

  return {
    floors: Array.from(resolved.values()),
    floorMentioned: /\btang\b/.test(q),
    unresolvedFloorTokens: Array.from(unresolvedTokens),
    teamId: targets.length === 1 ? targets[0].id : undefined,
    teamName: targets.length === 1 ? targets[0].name : '',
    teamAmbiguous: targets.length > 1,
  };
}

function serializeMaterialResult(result: ReturnType<typeof computeMaterialNeeds>) {
  return {
    status: result.lines.length === 0 ? 'insufficient-data' : result.failClosed ? 'partial' : 'ok',
    lines: result.lines.map((line) => ({
      materialId: line.materialId || '',
      materialName: line.materialName,
      category: line.category,
      unit: line.unit,
      totalNeed: line.estimatedQty,
      issuedAllocated: line.alreadyIssued,
      issuedUnallocated: line.unallocatedIssued,
      remainingNeed: line.remainingQty,
      projectStock: line.stockQty,
      deficit: line.deficitQty,
    })),
    warnings: result.warnings.map((warning) => warning.message),
    failClosed: result.failClosed,
  };
}

function buildQuestionFocusedContext(
  question: string,
  snapshot: HnlAiProjectSnapshot,
  selection: ExternalAiDataSelection,
  options: ExternalAiQuestionOptions = {},
) {
  const targets = detectMentionedTeams(question, snapshot);
  const needs = questionNeeds(question);
  const context = buildExternalAiProjectContext(snapshot, selection) as Record<string, any>;

  context.aiContract = {
    role: 'HNL supplies factual raw records; AI filters, groups, calculates and presents.',
    calculation: 'AI may calculate sums/counts/ratios only from supplied raw rows. Never invent missing rows or sample quantities.',
    grounding: 'Every numeric conclusion must be traceable to supplied rows and preserve team/floor/category/item/date/unit scope.',
    historicalQuantity: 'Quantity is a current snapshot unless a dated immutable quantity ledger exists. Do not assign snapshot quantity to a past date range.',
  };
  if (options.fullProjectRaw) {
    context.analysisScope = 'full-project-raw';
    context.aiContract.fullProjectRaw = 'This is a sanitized, bounded, read-only whole-project snapshot. Analyze only supplied rows; never infer omitted/truncated rows.';
  }
  if (targets.length > 0) context.requestedTeams = targets;

  if (needs.material) {
    const scope = resolveMaterialScopes(question, snapshot);
    // Material questions are fail-closed. Raw m²/progress/norm/inventory rows are stripped so
    // an external model cannot ignore the deterministic result and recompute material quantities.
    delete context.inventory;
    delete context.materialNorms;
    delete context.rooms;
    delete context.workVolumes;
    delete context.quantityDetails;
    delete context.quantitySummaryByTeamAndCategory;
    delete context.quantityValidationTotals;

    context.aiContract.materialCalculation = 'STRICT: Use deterministicMaterialNeeds exactly. Do not calculate material quantities from m²/raw norms/raw rooms.';
    if (!selection.inventory) {
      context.deterministicMaterialNeeds = {
        status: 'permission-required',
        message: 'Chưa cho phép nhóm dữ liệu Vật tư trong câu hỏi này. Không được suy đoán.',
      };
    } else if (scope.teamAmbiguous || scope.unresolvedFloorTokens.length > 0 || (scope.floorMentioned && scope.floors.length === 0) || (scope.floors.length === 0 && !scope.teamId)) {
      context.deterministicMaterialNeeds = {
        status: 'insufficient-scope',
        message: scope.teamAmbiguous
          ? 'Có nhiều đội được nhắc tới; cần một teamId duy nhất.'
          : scope.unresolvedFloorTokens.length > 0
            ? `Không resolve được tầng: ${scope.unresolvedFloorTokens.join(', ')}.`
            : scope.floorMentioned && scope.floors.length === 0
              ? 'Không resolve được floorId từ tầng được hỏi.'
              : 'Cần nêu rõ Tầng hoặc Đội để tổng hợp vật tư.',
      };
    } else if (scope.floors.length > 1) {
      const scopes = scope.floors.map((floor) => {
        const result = computeMaterialNeeds({
          rooms: [...snapshot.rooms],
          materialNorms: [...snapshot.materialNorms],
          inventory: [...snapshot.inventory],
          workVolumes: [...snapshot.workVolumes],
          teams: [...snapshot.teams],
          scope: { floorId: floor.id, teamId: scope.teamId },
        });
        return {
          scope: { floorId: floor.id, floorName: floor.name, teamId: scope.teamId || '', teamName: scope.teamName },
          ...serializeMaterialResult(result),
        };
      });
      const statuses = scopes.map((item) => item.status);
      context.deterministicMaterialNeeds = {
        status: statuses.every((status) => status === 'ok') ? 'ok' : statuses.every((status) => status === 'insufficient-data') ? 'insufficient-data' : 'partial',
        multiFloor: true,
        scopes,
        instruction: 'Present each floor separately. Do not merge floors unless the user explicitly asks for a grand total.',
      };
    } else {
      const floor = scope.floors[0];
      const result = computeMaterialNeeds({
        rooms: [...snapshot.rooms],
        materialNorms: [...snapshot.materialNorms],
        inventory: [...snapshot.inventory],
        workVolumes: [...snapshot.workVolumes],
        teams: [...snapshot.teams],
        scope: { floorId: floor?.id, teamId: scope.teamId },
      });
      context.deterministicMaterialNeeds = {
        ...serializeMaterialResult(result),
        scope: { floorId: floor?.id || '', floorName: floor?.name || '', teamId: scope.teamId || '', teamName: scope.teamName },
      };
    }
  }

  // For material questions, never re-add raw m²/progress data after deterministic calculation.
  if (!needs.material && selection.quantities && (options.fullProjectRaw || needs.quantity || targets.length > 0)) {
    const allRows = buildQuantityRows(snapshot);
    const filtered = !options.fullProjectRaw && targets.length > 0 ? allRows.filter((row) => isTeamMatch(row, targets)) : allRows;
    context.quantityDetails = capped(filtered, options.fullProjectRaw ? MAX_ROWS_PER_COLLECTION : 72);
    context.quantityValidationTotals = capped(buildQuantitySummary(filtered), 48);
  }
  if (selection.crew && (options.fullProjectRaw || needs.crew || targets.length > 0)) {
    context.crew = capped(rawCrewRows(snapshot, options.fullProjectRaw ? [] : targets), options.fullProjectRaw ? MAX_ROWS_PER_COLLECTION : 72);
  }
  if (!needs.material && selection.progress && (options.fullProjectRaw || needs.progress || targets.length > 0)) {
    context.rooms = capped(rawRoomRows(snapshot, options.fullProjectRaw ? [] : targets), options.fullProjectRaw ? MAX_ROWS_PER_COLLECTION : 48);
  }
  if (selection.defects && (options.fullProjectRaw || needs.defects || targets.length > 0)) {
    const resolveFloor = buildFloorResolver(snapshot);
    const defects = active(snapshot.defects).map((item) => ({
      id: item.id,
      floorId: item.floorId,
      floorName: resolveFloor(item.floorId, item.floorName),
      roomId: item.roomId || '',
      teamId: item.teamId || '',
      category: safeText(item.category),
      description: safeText(item.description),
      severity: item.severity,
      status: item.status,
      dueDate: item.dueDate || '',
      completedAt: item.completedAt || '',
    }));
    context.defects = capped(!options.fullProjectRaw && targets.length > 0 ? defects.filter((row) => isTeamMatch(row, targets)) : defects, options.fullProjectRaw ? MAX_ROWS_PER_COLLECTION : 48);
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

export function buildExternalAiQuestionPayload(
  question: string,
  snapshot: HnlAiProjectSnapshot,
  selection: ExternalAiDataSelection,
  options: ExternalAiQuestionOptions = {},
): string {
  const context = buildQuestionFocusedContext(question, snapshot, selection, options) as Record<string, any>;
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
