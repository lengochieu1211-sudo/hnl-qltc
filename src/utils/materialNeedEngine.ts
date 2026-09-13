import { InventoryItem, MaterialNorm, RoomProgressItem, TeamInfo, WorkVolume } from '../types';
import { areSameUnit, normalizeUnit } from './unitUtils';
import { buildMaterialAliasMap, getMaterialIdentityKey, normalizeMaterialNameKey, resolveNormMaterialId } from './inventoryUtils';
import { naturalCompare } from './sortUtils';

export interface MaterialNeedWarning {
  code: 'MISSING_NORM' | 'UNIT_MISMATCH' | 'AMBIGUOUS_TEAM' | 'UNALLOCATED_ISSUE' | 'MISSING_LINK' | 'AMBIGUOUS_LINK';
  message: string;
  roomId?: string;
  floorId?: string;
  teamId?: string;
  workCategoryId?: string;
}

export interface MaterialNeedLine {
  materialKey: string;
  materialId?: string;
  materialName: string;
  category: string;
  unit: string;
  estimatedQty: number;
  estQty: number; // backwards-compatible alias for RoomHighlightModal
  alreadyIssued: number;
  unallocatedIssued: number;
  remainingQty: number;
  stockQty: number;
  deficitQty: number;
  sufficient: boolean;
  sourceNormIds: string[];
  /** Exact norm contributors; UI may show a single factor only when unambiguous. */
  normDetails: Array<{ normId: string; workCategory: string; workCategoryId?: string; factor: number; basisUnit: string }>;
  workCategory?: string;
  unitNormPerM2?: number;
  normBasisUnit?: string;
}

export interface MaterialNeedResult {
  lines: MaterialNeedLine[];
  warnings: MaterialNeedWarning[];
  failClosed: boolean;
}

export interface MaterialNeedScope {
  floorId?: string;
  floorIds?: string[];
  teamId?: string;
  teamIds?: string[];
  roomId?: string;
  roomIds?: string[];
  workCategoryId?: string;
  workCategoryIds?: string[];
}

interface NeedContribution {
  roomId: string;
  floorId: string;
  teamId?: string;
  workCategoryId?: string;
  workCategoryName: string;
  sourceUnit: string;
  volume: number;
}

interface TeamResolver {
  uniqueIdByName: Map<string, string>;
  ambiguousNames: Set<string>;
}

const round2 = (value: number) => Math.ceil((Number(value) || 0) * 100) / 100;
const textKey = (value?: string) => String(value || '').trim().toLocaleLowerCase('vi-VN');
const isActiveLifecycle = <T extends { deletedAt?: number | null }>(item: T): boolean => item.deletedAt === undefined || item.deletedAt === null;
const scopeIds = (single?: string, multiple?: string[]): string[] => Array.from(new Set([...(multiple || []), ...(single ? [single] : [])].map((value) => String(value || '').trim()).filter(Boolean)));
const scopeIncludes = (ids: string[], value?: string): boolean => ids.length === 0 || Boolean(value && ids.includes(value));

function buildTeamResolver(teams: TeamInfo[]): TeamResolver {
  const idsByName = new Map<string, Set<string>>();
  teams.filter(isActiveLifecycle).forEach((team) => {
    const key = textKey(team.name);
    const id = String(team.id || '').trim();
    if (!key || !id) return;
    const ids = idsByName.get(key) || new Set<string>();
    ids.add(id);
    idsByName.set(key, ids);
  });

  const uniqueIdByName = new Map<string, string>();
  const ambiguousNames = new Set<string>();
  idsByName.forEach((ids, key) => {
    if (ids.size === 1) uniqueIdByName.set(key, Array.from(ids)[0]);
    else ambiguousNames.add(key);
  });
  return { uniqueIdByName, ambiguousNames };
}

function resolveTeamId(teamId: string | undefined, assignedTeam: string | undefined, resolver: TeamResolver): string | undefined {
  const explicitId = String(teamId || '').trim();
  if (explicitId) return explicitId;
  const nameKey = textKey(assignedTeam);
  return nameKey ? resolver.uniqueIdByName.get(nameKey) : undefined;
}

type WorkVolumeResolution = { work?: WorkVolume; state: 'resolved' | 'missing' | 'ambiguous' };

const canonicalWorkCategoryId = (work?: WorkVolume): string => String(work?.workCategoryId || work?.id || '').trim();

function resolveWorkVolumeStrict(categoryIdOrName: string | undefined, workVolumes: WorkVolume[]): WorkVolumeResolution {
  const raw = String(categoryIdOrName || '').trim();
  if (!raw) return { state: 'missing' };

  const exactRecord = workVolumes.find((item) => String(item.id || '').trim() === raw);
  if (exactRecord) return { work: exactRecord, state: 'resolved' };

  const canonicalMatches = workVolumes.filter((item) => String(item.workCategoryId || '').trim() === raw);
  if (canonicalMatches.length > 0) {
    const canonicalIds = new Set(canonicalMatches.map((item) => canonicalWorkCategoryId(item)).filter(Boolean));
    return canonicalIds.size === 1 ? { work: canonicalMatches[0], state: 'resolved' } : { state: 'ambiguous' };
  }

  const titleMatches = workVolumes.filter((item) => textKey(item.title) === textKey(raw));
  if (titleMatches.length === 0) return { state: 'missing' };
  const canonicalIds = new Set(titleMatches.map((item) => canonicalWorkCategoryId(item)).filter(Boolean));
  return canonicalIds.size === 1 ? { work: titleMatches[0], state: 'resolved' } : { state: 'ambiguous' };
}

function resolveWorkVolume(categoryIdOrName: string | undefined, workVolumes: WorkVolume[]): WorkVolume | undefined {
  return resolveWorkVolumeStrict(categoryIdOrName, workVolumes).work;
}

function categoryVolumeForRoom(room: RoomProgressItem, categoryIdOrName: string, workVolumes: WorkVolume[]): number {
  const volumes = room.categoryVolumes || {};
  if (volumes[categoryIdOrName] !== undefined) return Number(volumes[categoryIdOrName]) || 0;
  const work = resolveWorkVolume(categoryIdOrName, workVolumes);
  if (work?.workCategoryId && volumes[work.workCategoryId] !== undefined) return Number(volumes[work.workCategoryId]) || 0;
  if (work && volumes[work.id] !== undefined) return Number(volumes[work.id]) || 0;
  if (work && volumes[work.title] !== undefined) return Number(volumes[work.title]) || 0;
  if (textKey(room.workCategory) === textKey(categoryIdOrName) || room.workCategoryId === categoryIdOrName) return Number(room.workVolume) || 0;
  return 0;
}

function sourceUnitForRoomCategory(room: RoomProgressItem, categoryIdOrName: string, workVolumes: WorkVolume[]): string {
  const units = room.categoryVolumeUnits || {};
  const work = resolveWorkVolume(categoryIdOrName, workVolumes);
  return normalizeUnit(units[categoryIdOrName] || (work ? (work.workCategoryId ? units[work.workCategoryId] : '') || units[work.id] || units[work.title] : '') || work?.unit || room.volumeUnit || 'm²') || 'm²';
}

function roomCategories(room: RoomProgressItem, workVolumes: WorkVolume[]): Array<{ id?: string; name: string }> {
  const out = new Map<string, { id?: string; name: string }>();
  Object.keys(room.categoryVolumes || {}).forEach((raw) => {
    const work = resolveWorkVolume(raw, workVolumes);
    const id = work?.workCategoryId || work?.id || (raw === room.workCategoryId ? raw : undefined);
    const name = work?.title || (raw === room.workCategoryId ? room.workCategory || raw : raw);
    out.set(id || textKey(name), { id, name });
  });
  if (room.workCategory || room.workCategoryId) {
    const work = resolveWorkVolume(room.workCategoryId || room.workCategory, workVolumes);
    const canonicalId = work?.workCategoryId || room.workCategoryId || work?.id;
    out.set(canonicalId || textKey(room.workCategory), {
      id: canonicalId,
      name: work?.title || room.workCategory || room.workCategoryId || 'Hạng mục',
    });
  }
  (room.subItems || []).forEach((sub) => {
    const work = resolveWorkVolume(sub.workCategoryId || sub.category, workVolumes);
    if (work || sub.workCategoryId || sub.category) {
      const canonicalId = work?.workCategoryId || sub.workCategoryId || work?.id;
      out.set(canonicalId || textKey(sub.category), {
        id: canonicalId,
        name: work?.title || sub.category || sub.workCategoryId || 'Hạng mục',
      });
    }
  });
  return Array.from(out.values());
}

function uniqueRoomTeamIds(room: RoomProgressItem, resolver: TeamResolver): string[] {
  const ids = new Set<string>();
  const roomTeamId = resolveTeamId(room.teamId, room.assignedTeam, resolver);
  if (roomTeamId) ids.add(roomTeamId);
  (room.subItems || []).forEach((sub) => {
    const teamId = resolveTeamId(sub.teamId, sub.assignedTeam, resolver);
    if (teamId) ids.add(teamId);
  });
  return Array.from(ids);
}

function categorySubItems(room: RoomProgressItem, categoryId: string | undefined, categoryName: string) {
  return (room.subItems || []).filter((sub) => {
    const sameId = Boolean(categoryId && sub.workCategoryId === categoryId);
    const sameName = textKey(sub.category) === textKey(categoryName);
    return sameId || sameName;
  });
}

function uniqueCategoryTeamIds(room: RoomProgressItem, categoryId: string | undefined, categoryName: string, resolver: TeamResolver): string[] {
  return Array.from(new Set(
    categorySubItems(room, categoryId, categoryName)
      .map((sub) => resolveTeamId(sub.teamId, sub.assignedTeam, resolver))
      .filter(Boolean) as string[]
  ));
}

function buildContributions(
  rooms: RoomProgressItem[],
  workVolumes: WorkVolume[],
  teams: TeamInfo[],
  scope: MaterialNeedScope,
  warnings: MaterialNeedWarning[],
): NeedContribution[] {
  const contributions: NeedContribution[] = [];
  const scopedFloorIds = scopeIds(scope.floorId, scope.floorIds);
  const scopedTeamIds = scopeIds(scope.teamId, scope.teamIds);
  const scopedRoomIds = scopeIds(scope.roomId, scope.roomIds);
  const scopedWorkCategoryIds = scopeIds(scope.workCategoryId, scope.workCategoryIds);
  const hasTeamScope = scopedTeamIds.length > 0;
  const activeTeams = teams.filter(isActiveLifecycle);
  const teamResolver = buildTeamResolver(activeTeams);
  const selectedTeamNameKeys = new Set(
    activeTeams.filter((team) => scopedTeamIds.includes(team.id)).map((team) => textKey(team.name)).filter(Boolean)
  );

  rooms.forEach((room) => {
    if (!scopeIncludes(scopedRoomIds, room.id)) return;
    if (!scopeIncludes(scopedFloorIds, room.floorId)) return;
    const cats = roomCategories(room, workVolumes);
    const roomTeamIds = uniqueRoomTeamIds(room, teamResolver);

    cats.forEach((cat) => {
      // Every live material contribution must be provably linked to an ACTIVE WorkVolume.
      // Explicit legacy IDs are authoritative: never fall back by name when an old ID is gone,
      // because a newly-created category may later reuse the same display title. Title matching is
      // allowed only for legacy rows that genuinely have no category ID.
      const resolution = resolveWorkVolumeStrict(cat.id || cat.name, workVolumes);
      const activeWork = resolution.work;
      if (!activeWork) {
        warnings.push({
          code: resolution.state === 'ambiguous' ? 'AMBIGUOUS_LINK' : 'MISSING_LINK',
          roomId: room.id,
          floorId: room.floorId,
          workCategoryId: cat.id,
          message: resolution.state === 'ambiguous'
            ? `Căn ${room.roomName}: liên kết hạng mục ${cat.name} trùng nhiều hạng mục đang hoạt động. Không suy đoán nhu cầu vật tư.`
            : `Căn ${room.roomName}: hạng mục ${cat.name} không còn liên kết hợp lệ với hạng mục thi công đang hoạt động. Không suy đoán nhu cầu vật tư.`,
        });
        return;
      }
      const canonicalCategoryId = canonicalWorkCategoryId(activeWork);
      if (!scopeIncludes(scopedWorkCategoryIds, canonicalCategoryId)) return;
      const categoryRef = canonicalCategoryId || cat.id || cat.name;
      const totalVolume = categoryVolumeForRoom(room, categoryRef, workVolumes);
      if (totalVolume <= 0) return;
      const sourceUnit = sourceUnitForRoomCategory(room, categoryRef, workVolumes);

      if (!hasTeamScope) {
        contributions.push({ roomId: room.id, floorId: room.floorId, workCategoryId: canonicalCategoryId, workCategoryName: cat.name, sourceUnit, volume: totalVolume });
        return;
      }

      const categorySubs = categorySubItems(room, cat.id, cat.name);
      const categoryTeamIds = uniqueCategoryTeamIds(room, cat.id, cat.name, teamResolver);

      // Legacy room rows often stored only assignedTeam text. Resolve that text to a durable
      // teamId only when exactly one ACTIVE TeamInfo has the same normalized name. Explicit
      // teamId remains authoritative and duplicate names never get guessed.
      if (categoryTeamIds.length > 0 && categoryTeamIds.every((id) => scopedTeamIds.includes(id))) {
        contributions.push({ roomId: room.id, floorId: room.floorId, workCategoryId: canonicalCategoryId, workCategoryName: cat.name, sourceUnit, volume: totalVolume });
        return;
      }
      if (categoryTeamIds.length === 0 && roomTeamIds.length > 0 && roomTeamIds.every((id) => scopedTeamIds.includes(id))) {
        contributions.push({ roomId: room.id, floorId: room.floorId, workCategoryId: canonicalCategoryId, workCategoryName: cat.name, sourceUnit, volume: totalVolume });
        return;
      }

      const matchingSubs = categorySubs.filter((sub) => {
        const resolvedTeamId = resolveTeamId(sub.teamId, sub.assignedTeam, teamResolver);
        return Boolean(resolvedTeamId && scopedTeamIds.includes(resolvedTeamId));
      });
      const explicitVolume = matchingSubs.reduce((sum, sub) => sum + (Number(sub.workVolume) || 0), 0);
      if (explicitVolume > 0) {
        contributions.push({ roomId: room.id, floorId: room.floorId, workCategoryId: canonicalCategoryId, workCategoryName: cat.name, sourceUnit: normalizeUnit(matchingSubs[0]?.volumeUnit || sourceUnit) || sourceUnit, volume: explicitVolume });
        return;
      }

      if (categoryTeamIds.length === 1 && scopedTeamIds.includes(categoryTeamIds[0])) {
        contributions.push({ roomId: room.id, floorId: room.floorId, workCategoryId: canonicalCategoryId, workCategoryName: cat.name, sourceUnit, volume: totalVolume });
        return;
      }

      if (roomTeamIds.length === 1 && scopedTeamIds.includes(roomTeamIds[0])) {
        contributions.push({ roomId: room.id, floorId: room.floorId, workCategoryId: canonicalCategoryId, workCategoryName: cat.name, sourceUnit, volume: totalVolume });
        return;
      }

      const intersectsCategory = categoryTeamIds.some((id) => scopedTeamIds.includes(id));
      const intersectsRoom = categoryTeamIds.length === 0 && roomTeamIds.some((id) => scopedTeamIds.includes(id));
      const hasAmbiguousSelectedLegacyTeam = categorySubs.some((sub) => {
        if (String(sub.teamId || '').trim()) return false;
        const key = textKey(sub.assignedTeam);
        return Boolean(key && selectedTeamNameKeys.has(key) && teamResolver.ambiguousNames.has(key));
      }) || (
        categorySubs.length === 0 &&
        !String(room.teamId || '').trim() &&
        Boolean(textKey(room.assignedTeam) && selectedTeamNameKeys.has(textKey(room.assignedTeam)) && teamResolver.ambiguousNames.has(textKey(room.assignedTeam)))
      );
      if (intersectsCategory || intersectsRoom || hasAmbiguousSelectedLegacyTeam) {
        warnings.push({
          code: 'AMBIGUOUS_TEAM',
          roomId: room.id,
          floorId: room.floorId,
          teamId: scopedTeamIds.length === 1 ? scopedTeamIds[0] : undefined,
          workCategoryId: canonicalCategoryId,
          message: hasAmbiguousSelectedLegacyTeam
            ? `Căn ${room.roomName}: hạng mục ${cat.name} chỉ còn tên đội legacy trùng với nhiều đội đang hoạt động. Hãy gán lại đội để hệ thống không suy đoán nhu cầu.`
            : `Căn ${room.roomName}: hạng mục ${cat.name} có nhiều đội nhưng chưa có khối lượng phân bổ đủ cho phạm vi đội đã chọn. Không tự chia nhu cầu.`,
        });
      }
    });
  });
  return contributions;
}

function canonicalNormWorkCategoryIds(norm: MaterialNorm, workVolumes: WorkVolume[]): string[] {
  const refs = [...(norm.workCategoryIds || []), ...(norm.workCategoryId ? [norm.workCategoryId] : [])];
  return Array.from(new Set(refs.map((ref) => canonicalWorkCategoryId(resolveWorkVolumeStrict(ref, workVolumes).work)).filter(Boolean)));
}

function matchingNormsForContribution(c: NeedContribution, norms: MaterialNorm[], workVolumes: WorkVolume[]): MaterialNorm[] {
  return norms.filter((norm) => {
    const ids = canonicalNormWorkCategoryIds(norm, workVolumes);
    if (ids.length > 0 && c.workCategoryId) return ids.includes(c.workCategoryId);
    const names = norm.workCategories || (norm.workCategory ? [norm.workCategory] : []);
    if (ids.length === 0 && names.length === 0) return true;
    return names.some((name) => {
      const resolved = resolveWorkVolumeStrict(name, workVolumes);
      return resolved.state === 'resolved' && canonicalWorkCategoryId(resolved.work) === c.workCategoryId;
    });
  });
}

function factorForContribution(c: NeedContribution, norm: MaterialNorm, workVolumes: WorkVolume[]): number {
  if (c.workCategoryId && norm.workCategoryNormsById) {
    if (norm.workCategoryNormsById[c.workCategoryId] !== undefined) return Number(norm.workCategoryNormsById[c.workCategoryId]) || 0;
    const legacyEntries = Object.entries(norm.workCategoryNormsById).filter(([ref]) => canonicalWorkCategoryId(resolveWorkVolumeStrict(ref, workVolumes).work) === c.workCategoryId);
    if (legacyEntries.length === 1) return Number(legacyEntries[0][1]) || 0;
  }
  if (norm.workCategoryNorms?.[c.workCategoryName] !== undefined) return Number(norm.workCategoryNorms[c.workCategoryName]) || 0;
  const basis = normalizeUnit(norm.normBasisUnit || 'm²') || 'm²';
  return areSameUnit(basis, c.sourceUnit) ? Number(norm.unitNormPerM2) || 0 : 0;
}

export function computeMaterialNeeds(params: {
  rooms: RoomProgressItem[];
  materialNorms: MaterialNorm[];
  inventory: InventoryItem[];
  workVolumes: WorkVolume[];
  teams?: TeamInfo[];
  scope?: MaterialNeedScope;
}): MaterialNeedResult {
  const { rooms: rawRooms, materialNorms: rawMaterialNorms, inventory: rawInventory, workVolumes: rawWorkVolumes } = params;
  const rooms = rawRooms.filter(isActiveLifecycle);
  const materialNorms = rawMaterialNorms.filter(isActiveLifecycle);
  const inventory = rawInventory.filter(isActiveLifecycle);
  const workVolumes = rawWorkVolumes.filter(isActiveLifecycle);
  const teams = (params.teams || []).filter(isActiveLifecycle);
  const teamResolver = buildTeamResolver(teams);
  const scope = params.scope || {};
  const warnings: MaterialNeedWarning[] = [];

  scopeIds(scope.roomId, scope.roomIds).forEach((roomId) => {
    if (!rooms.some((room) => room.id === roomId)) {
      warnings.push({ code: 'MISSING_LINK', roomId, message: `Căn đã chọn (${roomId}) không còn tồn tại/hoạt động. Không mở rộng phạm vi sang căn khác.` });
    }
  });
  scopeIds(scope.workCategoryId, scope.workCategoryIds).forEach((workCategoryId) => {
    const resolution = resolveWorkVolumeStrict(workCategoryId, workVolumes);
    if (resolution.state !== 'resolved') {
      warnings.push({
        code: resolution.state === 'ambiguous' ? 'AMBIGUOUS_LINK' : 'MISSING_LINK',
        workCategoryId,
        message: resolution.state === 'ambiguous'
          ? `Hạng mục đã chọn (${workCategoryId}) đang liên kết mơ hồ. Không suy đoán phạm vi vật tư.`
          : `Hạng mục đã chọn (${workCategoryId}) không còn tồn tại/hoạt động. Không mở rộng phạm vi vật tư.`,
      });
    }
  });

  const contributions = buildContributions(rooms, workVolumes, teams, scope, warnings);
  const aliasMap = buildMaterialAliasMap(materialNorms);
  const canonicalKey = (materialId?: string, materialName?: string, unit?: string) => {
    const resolved = materialId ? (aliasMap.get(String(materialId)) || String(materialId)) : undefined;
    return getMaterialIdentityKey(resolved, materialName, unit);
  };

  const demand = new Map<string, { materialId?: string; materialName: string; category: string; unit: string; qty: number; normIds: Set<string>; normDetails: Map<string, { normId: string; workCategory: string; workCategoryId?: string; factor: number; basisUnit: string }> }>();
  contributions.forEach((c) => {
    const norms = matchingNormsForContribution(c, materialNorms, workVolumes);
    let usable = 0;
    norms.forEach((norm) => {
      const factor = factorForContribution(c, norm, workVolumes);
      if (factor <= 0) return;
      usable++;
      const materialId = resolveNormMaterialId(norm);
      const key = canonicalKey(materialId, norm.materialName, norm.unit);
      const existing = demand.get(key) || { materialId, materialName: norm.materialName, category: norm.category || 'Vật tư', unit: normalizeUnit(norm.unit) || norm.unit, qty: 0, normIds: new Set<string>(), normDetails: new Map<string, { normId: string; workCategory: string; workCategoryId?: string; factor: number; basisUnit: string }>() };
      existing.qty += c.volume * factor;
      existing.normIds.add(norm.id);
      existing.normDetails.set(`${norm.id}|${c.workCategoryId || c.workCategoryName}`, { normId: norm.id, workCategory: c.workCategoryName, workCategoryId: c.workCategoryId, factor, basisUnit: c.sourceUnit });
      demand.set(key, existing);
    });
    if (usable === 0) {
      const hasMatchedNorm = norms.length > 0;
      warnings.push({
        code: hasMatchedNorm ? 'UNIT_MISMATCH' : 'MISSING_NORM',
        roomId: c.roomId,
        floorId: c.floorId,
        teamId: c.teamId,
        workCategoryId: c.workCategoryId,
        message: hasMatchedNorm
          ? `Hạng mục ${c.workCategoryName} (${c.sourceUnit}) không có hệ số định mức tương thích. Không suy đoán vật tư.`
          : `Hạng mục ${c.workCategoryName} chưa có định mức vật tư. Không suy đoán vật tư.`,
      });
    }
  });

  const stock = new Map<string, number>();
  inventory.forEach((tx) => {
    let key = canonicalKey(tx.materialId, tx.materialName, tx.unit);
    if (!tx.materialId) {
      const norm = materialNorms.find((n) => normalizeMaterialNameKey(n.materialName) === normalizeMaterialNameKey(tx.materialName) && areSameUnit(n.unit, tx.unit));
      if (norm) key = canonicalKey(resolveNormMaterialId(norm), norm.materialName, norm.unit);
    }
    stock.set(key, (stock.get(key) || 0) + (tx.type === 'in' ? 1 : -1) * (Number(tx.quantity) || 0));
  });

  const issued = new Map<string, number>();
  const unallocated = new Map<string, number>();
  const scopedFloorIds = scopeIds(scope.floorId, scope.floorIds);
  const scopedTeamIds = scopeIds(scope.teamId, scope.teamIds);
  const scopedRoomIds = scopeIds(scope.roomId, scope.roomIds);
  const scopedWorkCategoryIds = scopeIds(scope.workCategoryId, scope.workCategoryIds);
  const hasTeamScope = scopedTeamIds.length > 0;
  const hasWorkCategoryScope = scopedWorkCategoryIds.length > 0;

  const resolveTxWorkCategoryScope = (tx: InventoryItem): 'inside' | 'outside' | 'ambiguous' => {
    if (!hasWorkCategoryScope) return 'inside';

    const explicitRef = String(tx.sourceWorkCategoryId || '').trim();
    if (explicitRef) {
      const work = resolveWorkVolume(explicitRef, workVolumes);
      const canonicalId = work?.workCategoryId || work?.id || explicitRef;
      return scopedWorkCategoryIds.includes(canonicalId) ? 'inside' : 'outside';
    }

    const sourceNormId = String(tx.sourceNormId || '').trim();
    if (sourceNormId) {
      const sourceNorm = materialNorms.find((norm) => norm.id === sourceNormId);
      if (sourceNorm) {
        const ids = Array.from(new Set(
          [...(sourceNorm.workCategoryIds || []), ...(sourceNorm.workCategoryId ? [sourceNorm.workCategoryId] : [])]
            .map((id) => {
              const work = resolveWorkVolumeStrict(id, workVolumes).work;
              return canonicalWorkCategoryId(work);
            })
            .filter(Boolean),
        ));
        if (ids.length > 0) {
          const matched = ids.filter((id) => scopedWorkCategoryIds.includes(id));
          if (matched.length === ids.length) return 'inside';
          if (matched.length === 0) return 'outside';
          return 'ambiguous';
        }
      }
    }

    if (tx.sourceRoomId) {
      const room = rooms.find((item) => item.id === tx.sourceRoomId);
      if (room) {
        const ids = Array.from(new Set(roomCategories(room, workVolumes)
          .map((cat) => {
            const work = cat.id ? resolveWorkVolume(cat.id, workVolumes) : resolveWorkVolume(cat.name, workVolumes);
            return work?.workCategoryId || work?.id;
          })
          .filter(Boolean) as string[]));
        if (ids.length > 0) {
          const matched = ids.filter((id) => scopedWorkCategoryIds.includes(id));
          if (matched.length === ids.length) return 'inside';
          if (matched.length === 0) return 'outside';
        }
      }
    }

    return 'ambiguous';
  };

  inventory.forEach((tx) => {
    if (tx.type !== 'out') return;

    let key = canonicalKey(tx.materialId, tx.materialName, tx.unit);
    if (!tx.materialId) {
      const norm = materialNorms.find((n) => normalizeMaterialNameKey(n.materialName) === normalizeMaterialNameKey(tx.materialName) && areSameUnit(n.unit, tx.unit));
      if (norm) key = canonicalKey(resolveNormMaterialId(norm), norm.materialName, norm.unit);
    }
    if (!demand.has(key)) return;
    const qty = Number(tx.quantity) || 0;

    const sourceRoom = tx.sourceRoomId ? rooms.find((room) => room.id === tx.sourceRoomId) : undefined;
    if (scopedRoomIds.length > 0) {
      if (tx.sourceRoomId && !scopedRoomIds.includes(tx.sourceRoomId)) return;
      if (!tx.sourceRoomId) {
        unallocated.set(key, (unallocated.get(key) || 0) + qty);
        warnings.push({ code: 'UNALLOCATED_ISSUE', floorId: tx.sourceFloorId, message: `Phiếu ${tx.id} chưa có sourceRoomId để chứng minh thuộc căn đã chọn. Không trừ vào nhu cầu căn.` });
        return;
      }
    }

    if (scopedFloorIds.length > 0) {
      const resolvedFloorId = String(tx.sourceFloorId || sourceRoom?.floorId || '').trim();
      if (resolvedFloorId && !scopedFloorIds.includes(resolvedFloorId)) return;
      if (!resolvedFloorId) {
        unallocated.set(key, (unallocated.get(key) || 0) + qty);
        warnings.push({ code: 'UNALLOCATED_ISSUE', roomId: tx.sourceRoomId, message: `Phiếu ${tx.id} chưa có sourceFloorId/sourceRoomId đủ rõ để chứng minh thuộc tầng đã chọn. Không trừ vào nhu cầu tầng.` });
        return;
      }
    }

    const workCategoryScopeState = resolveTxWorkCategoryScope(tx);
    if (workCategoryScopeState === 'outside') return;
    if (workCategoryScopeState === 'ambiguous') {
      unallocated.set(key, (unallocated.get(key) || 0) + qty);
      warnings.push({
        code: 'UNALLOCATED_ISSUE',
        roomId: tx.sourceRoomId,
        floorId: tx.sourceFloorId,
        workCategoryId: scopedWorkCategoryIds.length === 1 ? scopedWorkCategoryIds[0] : undefined,
        message: `Phiếu ${tx.id} chưa có sourceWorkCategoryId/sourceNormId đủ rõ để chứng minh thuộc hạng mục thi công đã chọn. Không trừ vào nhu cầu hạng mục.`,
      });
      return;
    }

    if (hasTeamScope) {
      if (tx.sourceTeamId && scopedTeamIds.includes(tx.sourceTeamId)) {
        issued.set(key, (issued.get(key) || 0) + qty);
      } else if (!tx.sourceTeamId && tx.sourceRoomId) {
        const room = rooms.find((r) => r.id === tx.sourceRoomId);
        const ids = room ? uniqueRoomTeamIds(room, teamResolver) : [];
        if (ids.length > 0 && ids.every((id) => scopedTeamIds.includes(id))) {
          issued.set(key, (issued.get(key) || 0) + qty);
        } else if (ids.some((id) => scopedTeamIds.includes(id)) || ids.length === 0) {
          unallocated.set(key, (unallocated.get(key) || 0) + qty);
          warnings.push({
            code: 'UNALLOCATED_ISSUE',
            roomId: tx.sourceRoomId,
            floorId: tx.sourceFloorId,
            teamId: scopedTeamIds.length === 1 ? scopedTeamIds[0] : undefined,
            message: `Phiếu ${tx.id} chưa có sourceTeamId và không thể chứng minh toàn bộ phiếu thuộc phạm vi đội đã chọn. Không trừ vào nhu cầu đội.`,
          });
        }
      } else if (!tx.sourceTeamId) {
        unallocated.set(key, (unallocated.get(key) || 0) + qty);
        warnings.push({
          code: 'UNALLOCATED_ISSUE',
          floorId: tx.sourceFloorId,
          teamId: scopedTeamIds.length === 1 ? scopedTeamIds[0] : undefined,
          message: `Phiếu ${tx.id} chưa có sourceTeamId/sourceRoomId để chứng minh thuộc đội đã chọn. Không trừ vào nhu cầu đội.`,
        });
      }
      return;
    }

    // No team filter: every OUT transaction that is proven inside the selected
    // floor/room/work-category scope belongs to that material need. This also
    // fixes whole-project summaries, which must subtract project-wide issued qty.
    issued.set(key, (issued.get(key) || 0) + qty);
  });

  const lines = Array.from(demand.entries()).map(([materialKey, item]) => {
    const estimatedQty = round2(item.qty);
    const alreadyIssued = round2(issued.get(materialKey) || 0);
    const unallocatedIssued = round2(unallocated.get(materialKey) || 0);
    const remainingQty = round2(Math.max(0, estimatedQty - alreadyIssued));
    const stockQty = round2(stock.get(materialKey) || 0);
    const deficitQty = round2(Math.max(0, remainingQty - stockQty));
    return {
      materialKey,
      materialId: item.materialId,
      materialName: item.materialName,
      category: item.category,
      unit: item.unit,
      estimatedQty,
      estQty: estimatedQty,
      alreadyIssued,
      unallocatedIssued,
      remainingQty,
      stockQty,
      deficitQty,
      sufficient: stockQty + 1e-9 >= remainingQty,
      sourceNormIds: Array.from(item.normIds),
      normDetails: Array.from(item.normDetails.values()),
      ...(item.normDetails.size === 1 ? (() => {
        const only = Array.from(item.normDetails.values())[0];
        return { workCategory: only.workCategory, unitNormPerM2: only.factor, normBasisUnit: only.basisUnit };
      })() : {}),
    } satisfies MaterialNeedLine;
  }).sort((a, b) => naturalCompare(a.category, b.category) || naturalCompare(a.materialName, b.materialName) || naturalCompare(a.materialKey, b.materialKey));

  return { lines, warnings, failClosed: warnings.length > 0 };
}
