import type { RoomProgressItem, TeamInfo } from '../../types';
import { isTeamMatch } from '../../utils/teamUtils';
import { normalizeUnit, unitKey } from '../../utils/unitUtils';
import type { AiFact, AiQueryContext, AiToolResult } from '../core/contracts';
import { assertAiProjectAccess, createAiPermissionScope } from '../security/aiPermissionGuard';

export interface CurrentTeamRoomQuantityDetail {
  roomId: string;
  roomName: string;
  floorId: string;
  floorName: string;
  workCategoryId?: string;
  workCategory: string;
  unit: string;
  assignedQuantity: number | null;
  inspectedQuantity: number | null;
  inspectionStatus: string;
  subItems: Array<{
    id: string;
    name: string;
    status: string;
    inspectionStatus: string;
    targetDate?: string;
  }>;
}

export interface CurrentTeamCategoryFloorDetail {
  workCategory: string;
  unit: string;
  assignedQuantity: number;
  inspectedQuantity: number;
  floors: Array<{
    floorId: string;
    floorName: string;
    assignedQuantity: number;
    inspectedQuantity: number;
    rooms: CurrentTeamRoomQuantityDetail[];
  }>;
}

export interface CurrentTeamDetailData {
  teamId: string;
  teamName: string;
  categories: CurrentTeamCategoryFloorDetail[];
  roomCount: number;
  inspectedRoomCategoryCount: number;
  unknownQuantityCount: number;
  asOf: number;
  basis: 'current-room-snapshot';
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function activeRoom(room: RoomProgressItem): boolean {
  return room.deletedAt === undefined || room.deletedAt === null;
}

function categoryKey(value: string): string {
  return String(value || '').trim().toLocaleLowerCase('vi-VN');
}

function teamOwnsRoomCategory(room: RoomProgressItem, team: TeamInfo, category: string): boolean {
  const direct = isTeamMatch(room.assignedTeam || '', team, room.teamId);
  const subMatches = (room.subItems || []).some((item) =>
    categoryKey(item.category || room.workCategory || '') === categoryKey(category)
    && isTeamMatch(item.assignedTeam || '', team, item.teamId),
  );
  return direct || subMatches;
}

function roomCategories(room: RoomProgressItem): Array<{ id?: string; name: string; unit: string }> {
  const byKey = new Map<string, { id?: string; name: string; unit: string }>();
  const put = (nameRaw: string, id?: string, unitRaw?: string) => {
    const name = String(nameRaw || '').trim();
    if (!name) return;
    const key = categoryKey(name);
    const unit = normalizeUnit(unitRaw || room.categoryVolumeUnits?.[name] || room.volumeUnit || '') || String(unitRaw || room.categoryVolumeUnits?.[name] || room.volumeUnit || '').trim();
    if (!byKey.has(key)) byKey.set(key, { id, name, unit });
  };

  if (room.workCategory) put(room.workCategory, room.workCategoryId, room.volumeUnit);
  Object.keys(room.categoryVolumes || {}).forEach((name) => put(name, undefined, room.categoryVolumeUnits?.[name] || room.volumeUnit));
  (room.subItems || []).forEach((item) => put(item.category || room.workCategory || item.name, item.workCategoryId || room.workCategoryId, item.volumeUnit || room.volumeUnit));
  return Array.from(byKey.values());
}

function categoryQuantity(room: RoomProgressItem, category: string, unit: string): number | null {
  const categoryVolumes = room.categoryVolumes || {};
  const exactKey = Object.keys(categoryVolumes).find((key) => categoryKey(key) === categoryKey(category));
  if (exactKey && Number.isFinite(Number(categoryVolumes[exactKey]))) return round(Number(categoryVolumes[exactKey]));

  const matchingSubItemVolumes = (room.subItems || [])
    .filter((item) => categoryKey(item.category || room.workCategory || item.name) === categoryKey(category))
    .map((item) => Number(item.workVolume))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (matchingSubItemVolumes.length > 0) {
    // Multiple construction stages can repeat the same room/category area. Taking the
    // maximum avoids multiplying area by the number of stages.
    return round(Math.max(...matchingSubItemVolumes));
  }

  if (categoryKey(room.workCategory || '') === categoryKey(category) && Number.isFinite(Number(room.workVolume))) {
    return round(Number(room.workVolume));
  }
  void unit;
  return null;
}

function categoryInspection(room: RoomProgressItem, team: TeamInfo, category: string) {
  const matching = (room.subItems || []).filter((item) =>
    categoryKey(item.category || room.workCategory || item.name) === categoryKey(category)
    && isTeamMatch(item.assignedTeam || '', team, item.teamId),
  );
  if (matching.length === 0) {
    const passed = room.inspectionStatus === 'Đạt nghiệm thu';
    return { passed, label: room.inspectionStatus || 'Chưa nghiệm thu', subItems: [] as CurrentTeamRoomQuantityDetail['subItems'] };
  }
  const passed = matching.every((item) => item.inspectionStatus === 'Đạt nghiệm thu');
  return {
    passed,
    label: passed ? 'Đạt nghiệm thu' : matching.some((item) => item.inspectionStatus === 'Chưa đạt (Cần sửa)') ? 'Chưa đạt (Cần sửa)' : 'Chưa nghiệm thu',
    subItems: matching.map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      inspectionStatus: item.inspectionStatus || 'Chưa nghiệm thu',
      targetDate: item.targetDate,
    })),
  };
}

/** Current snapshot breakdown by work category -> floor -> room. Numeric totals are
 * deterministic and never created by an LLM. Historical date allocation is intentionally
 * out of scope because current room quantities do not form an immutable daily ledger. */
export function calculateCurrentTeamDetail(params: {
  context: AiQueryContext;
  team: TeamInfo;
  rooms: RoomProgressItem[];
  freshness?: 'live' | 'cache' | 'fixture';
  asOf?: number;
}): AiToolResult<CurrentTeamDetailData> {
  const { context, team, rooms, freshness = 'live', asOf = Date.now() } = params;
  const permission = createAiPermissionScope(context.projectId, context.role, context.accessVerified);
  assertAiProjectAccess(permission, context.projectId);

  const detailRows: CurrentTeamRoomQuantityDetail[] = [];
  rooms.filter(activeRoom).forEach((room) => {
    roomCategories(room).forEach((category) => {
      if (!teamOwnsRoomCategory(room, team, category.name)) return;
      const quantity = categoryQuantity(room, category.name, category.unit);
      const inspection = categoryInspection(room, team, category.name);
      detailRows.push({
        roomId: room.id,
        roomName: room.roomName,
        floorId: room.floorId,
        floorName: room.floorName || room.floorId,
        workCategoryId: category.id,
        workCategory: category.name,
        unit: category.unit,
        assignedQuantity: quantity,
        inspectedQuantity: inspection.passed ? quantity : 0,
        inspectionStatus: inspection.label,
        subItems: inspection.subItems,
      });
    });
  });

  const categoryMap = new Map<string, CurrentTeamCategoryFloorDetail>();
  detailRows.forEach((row) => {
    const key = `${categoryKey(row.workCategory)}|${unitKey(row.unit)}`;
    let category = categoryMap.get(key);
    if (!category) {
      category = { workCategory: row.workCategory, unit: row.unit, assignedQuantity: 0, inspectedQuantity: 0, floors: [] };
      categoryMap.set(key, category);
    }
    const floorKey = row.floorId || row.floorName;
    let floor = category.floors.find((item) => (item.floorId || item.floorName) === floorKey);
    if (!floor) {
      floor = { floorId: row.floorId, floorName: row.floorName, assignedQuantity: 0, inspectedQuantity: 0, rooms: [] };
      category.floors.push(floor);
    }
    if (row.assignedQuantity !== null) {
      category.assignedQuantity = round(category.assignedQuantity + row.assignedQuantity);
      floor.assignedQuantity = round(floor.assignedQuantity + row.assignedQuantity);
    }
    if (row.inspectedQuantity !== null) {
      category.inspectedQuantity = round(category.inspectedQuantity + row.inspectedQuantity);
      floor.inspectedQuantity = round(floor.inspectedQuantity + row.inspectedQuantity);
    }
    floor.rooms.push(row);
  });

  const categories = Array.from(categoryMap.values())
    .map((category) => ({
      ...category,
      floors: category.floors
        .map((floor) => ({ ...floor, rooms: floor.rooms.sort((a, b) => a.roomName.localeCompare(b.roomName, 'vi')) }))
        .sort((a, b) => a.floorName.localeCompare(b.floorName, 'vi')),
    }))
    .sort((a, b) => a.workCategory.localeCompare(b.workCategory, 'vi') || a.unit.localeCompare(b.unit, 'vi'));

  const facts: AiFact[] = [];
  categories.forEach((category, index) => {
    facts.push({
      id: `current-team-detail:inspected:${index + 1}`,
      kind: 'CALCULATED',
      label: `${category.workCategory} · đã nghiệm thu`,
      value: category.inspectedQuantity,
      unit: category.unit,
      method: 'current room/category quantity counted only when matching team category is accepted',
    });
    facts.push({
      id: `current-team-detail:assigned:${index + 1}`,
      kind: 'CALCULATED',
      label: `${category.workCategory} · được giao`,
      value: category.assignedQuantity,
      unit: category.unit,
      method: 'current room/category quantity snapshot',
    });
  });

  const roomIds = new Set(detailRows.map((row) => row.roomId));
  const unknownQuantityCount = detailRows.filter((row) => row.assignedQuantity === null).length;
  const warnings: string[] = [];
  if (detailRows.length === 0) warnings.push(`Không tìm thấy căn/phòng hoặc hạng mục đang gán cho ${team.name}.`);
  if (unknownQuantityCount > 0) warnings.push(`${unknownQuantityCount} dòng hạng mục/căn chưa có khối lượng xác định nên không được cộng vào tổng.`);

  return {
    status: detailRows.length === 0 ? 'insufficient-data' : unknownQuantityCount > 0 ? 'partial' : 'ok',
    data: {
      teamId: team.id,
      teamName: team.name,
      categories,
      roomCount: roomIds.size,
      inspectedRoomCategoryCount: detailRows.filter((row) => row.inspectedQuantity !== null && row.inspectedQuantity > 0).length,
      unknownQuantityCount,
      asOf,
      basis: 'current-room-snapshot',
    },
    facts,
    evidence: detailRows.map((row) => ({
      id: `rooms:${row.roomId}:${categoryKey(row.workCategory)}`,
      collection: 'rooms' as const,
      recordId: row.roomId,
      label: `${row.floorName} · ${row.roomName} · ${row.workCategory}`,
      fieldPaths: ['floorId', 'floorName', 'roomName', 'workCategory', 'workCategoryId', 'categoryVolumes', 'categoryVolumeUnits', 'subItems', 'teamId', 'assignedTeam', 'inspectionStatus'],
    })),
    metadata: {
      projectId: context.projectId,
      tool: 'getCurrentTeamProgressDetail',
      sourceCollections: ['teams', 'rooms', 'floor_plans'],
      recordsScanned: rooms.length,
      recordsUsed: roomIds.size,
      asOf,
      freshness,
      permissionRole: context.role,
      dataVersion: 'hnl-ai-tools-v2',
    },
    warnings,
    assumptions: [
      'Đây là snapshot hiện tại, không phải sổ lịch sử khối lượng theo ngày.',
      'Khối lượng “đã làm” trong báo cáo được trình bày rõ là khối lượng đã nghiệm thu; khối lượng được giao hiển thị riêng.',
      'Nếu nhiều công đoạn trong cùng căn/hạng mục lặp cùng một diện tích, engine lấy diện tích đại diện một lần thay vì nhân theo số công đoạn.',
      'Không cộng các đơn vị khác nhau vào cùng một tổng.',
    ],
  };
}
