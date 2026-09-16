import { InventoryItem, MaterialNorm, RoomProgressItem, TeamInfo, WorkVolume } from '../types';
import { areSameUnit, normalizeUnit } from './unitUtils';
import { buildMaterialAliasMap, getMaterialIdentityKey, normalizeMaterialNameKey, resolveNormMaterialId } from './inventoryUtils';
import { naturalCompare } from './sortUtils';
import {
  canonicalNormCategoryIds,
  canonicalWorkCategoryId as canonicalWorkCategoryIdShared,
  getCanonicalRoomCategoryEntries,
  resolveAuthoritativeWorkVolumeRef,
  resolveUniqueMaterialIdentity,
  resolveWorkVolumeRef,
  validateInventoryOutProvenance,
  validateMaterialNormCatalog,
} from './linkageIntegrity';

export interface MaterialNeedWarning {
  code: 'MISSING_NORM' | 'UNIT_MISMATCH' | 'AMBIGUOUS_TEAM' | 'UNALLOCATED_ISSUE' | 'MISSING_LINK' | 'AMBIGUOUS_LINK' | 'AMBIGUOUS_NORM' | 'MIXED_WORK_UNIT';
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
  /** Unrounded calculation values. Decisions must use these, not display-rounded fields. */
  rawEstimatedQty: number;
  rawAlreadyIssued: number;
  rawUnallocatedIssued: number;
  rawRemainingQty: number;
  rawStockQty: number;
  rawDeficitQty: number;
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

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
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

const canonicalWorkCategoryId = canonicalWorkCategoryIdShared;

function resolveWorkVolumeStrict(categoryIdOrName: string | undefined, workVolumes: WorkVolume[], floorId?: string, floorName?: string): WorkVolumeResolution {
  const raw = String(categoryIdOrName || '').trim();
  if (!raw) return { state: 'missing' };
  const looksLikeId = workVolumes.some((item) => String(item.id || '').trim() === raw || String(item.workCategoryId || '').trim() === raw);
  const resolution = looksLikeId
    ? resolveAuthoritativeWorkVolumeRef({ workVolumes, workCategoryId: raw, floorId, floorName })
    : resolveWorkVolumeRef({ workVolumes, workCategoryName: raw, floorId, floorName });
  if (resolution.state === 'resolved') return { work: resolution.work, state: 'resolved' };

  // Legacy Room rows can contain floorId but no floorName while older WorkVolume rows
  // scope themselves only by the display floor name. In that specific case, resolve
  // by title only when the ACTIVE catalog has one canonical category identity. This
  // restores deterministic material demand without guessing between duplicate titles.
  if (!looksLikeId && resolution.state === 'floor-mismatch' && !String(floorName || '').trim()) {
    const unscoped = resolveWorkVolumeRef({ workVolumes, workCategoryName: raw });
    if (unscoped.state === 'resolved' && unscoped.work) {
      return { work: unscoped.work, state: 'resolved' };
    }
    if (unscoped.state === 'ambiguous') return { state: 'ambiguous' };
  }

  return { state: resolution.state === 'ambiguous' ? 'ambiguous' : 'missing' };
}

function resolveWorkVolume(categoryIdOrName: string | undefined, workVolumes: WorkVolume[]): WorkVolume | undefined {
  return resolveWorkVolumeStrict(categoryIdOrName, workVolumes).work;
}

function getMaterialRoomCategoryEntries(room: RoomProgressItem, workVolumes: WorkVolume[]) {
  const canonical = getCanonicalRoomCategoryEntries(room, workVolumes);
  // Normal/current records already have full floor context and use the shared canonicalizer.
  if (String(room.floorName || '').trim()) return canonical;

  // Legacy records may keep only floorId while legacy WorkVolume scope is name-only.
  // Recover only identities that resolve uniquely with resolveWorkVolumeStrict(); duplicate
  // same-title categories remain ambiguous/fail-closed. ID-backed entries from the shared
  // canonicalizer always win, so this compatibility path cannot double-count a category.
  const output = new Map(canonical.map((entry) => [entry.workCategoryId, entry] as const));
  const volumes = room.categoryVolumes || {};
  const units = room.categoryVolumeUnits || {};
  const keys = Object.keys(volumes).sort((a, b) => {
    const aIsId = workVolumes.some((work) => a === work.id || a === work.workCategoryId) ? 0 : 1;
    const bIsId = workVolumes.some((work) => b === work.id || b === work.workCategoryId) ? 0 : 1;
    return aIsId - bIsId;
  });

  const addResolved = (rawRef: string, quantity: number, unitHint?: string) => {
    const resolved = resolveWorkVolumeStrict(rawRef, workVolumes, room.floorId, room.floorName);
    if (resolved.state !== 'resolved' || !resolved.work) return;
    const id = canonicalWorkCategoryId(resolved.work);
    if (!id || output.has(id)) return;
    const unit = normalizeUnit(unitHint || resolved.work.unit || room.volumeUnit || '')
      || unitHint || resolved.work.unit || room.volumeUnit || 'm²';
    output.set(id, {
      workCategoryId: id,
      workCategoryName: resolved.work.title,
      unit,
      quantity: Number(quantity) || 0,
      sourceKey: rawRef,
      work: resolved.work,
    });
  };

  keys.forEach((key) => addResolved(key, Number(volumes[key]) || 0, units[key]));
  if (room.workCategoryId || room.workCategory) {
    addResolved(room.workCategoryId || room.workCategory || '', Number(room.workVolume) || 0, room.volumeUnit);
  }
  (room.subItems || []).forEach((item) => {
    const ref = String(item.workCategoryId || item.category || '').trim();
    if (ref) addResolved(ref, 0, item.volumeUnit || room.volumeUnit);
  });

  return Array.from(output.values());
}

function categoryVolumeForRoom(room: RoomProgressItem, categoryIdOrName: string, workVolumes: WorkVolume[]): number {
  const entries = getMaterialRoomCategoryEntries(room, workVolumes);
  const direct = entries.find((entry) => entry.workCategoryId === categoryIdOrName);
  if (direct) return direct.quantity;
  const resolved = resolveWorkVolumeStrict(categoryIdOrName, workVolumes, room.floorId, room.floorName);
  const canonicalId = canonicalWorkCategoryId(resolved.work);
  return entries.find((entry) => entry.workCategoryId === canonicalId)?.quantity || 0;
}

function sourceUnitForRoomCategory(room: RoomProgressItem, categoryIdOrName: string, workVolumes: WorkVolume[]): string {
  const entries = getMaterialRoomCategoryEntries(room, workVolumes);
  const direct = entries.find((entry) => entry.workCategoryId === categoryIdOrName);
  if (direct) return direct.unit;
  const resolved = resolveWorkVolumeStrict(categoryIdOrName, workVolumes, room.floorId, room.floorName);
  const canonicalId = canonicalWorkCategoryId(resolved.work);
  return entries.find((entry) => entry.workCategoryId === canonicalId)?.unit || normalizeUnit(resolved.work?.unit || room.volumeUnit || 'm²') || 'm²';
}

function roomCategories(room: RoomProgressItem, workVolumes: WorkVolume[]): Array<{ id?: string; name: string }> {
  return getMaterialRoomCategoryEntries(room, workVolumes).map((entry) => ({ id: entry.workCategoryId, name: entry.workCategoryName }));
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
    if (categoryId) {
      if (sub.workCategoryId) return sub.workCategoryId === categoryId;
      return textKey(sub.category) === textKey(categoryName);
    }
    return textKey(sub.category) === textKey(categoryName);
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
      const resolution = resolveWorkVolumeStrict(cat.id || cat.name, workVolumes, room.floorId, room.floorName);
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
  return canonicalNormCategoryIds(norm, workVolumes).ids;
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
  if (c.workCategoryId && norm.workCategoryNormsById && Object.keys(norm.workCategoryNormsById).length > 0) {
    if (norm.workCategoryNormsById[c.workCategoryId] !== undefined) return Number(norm.workCategoryNormsById[c.workCategoryId]) || 0;
    const legacyEntries = Object.entries(norm.workCategoryNormsById).filter(([ref]) => canonicalWorkCategoryId(resolveWorkVolumeStrict(ref, workVolumes).work) === c.workCategoryId);
    return legacyEntries.length === 1 ? Number(legacyEntries[0][1]) || 0 : 0;
  }
  if ((!norm.workCategoryIds || norm.workCategoryIds.length === 0) && !norm.workCategoryId && norm.workCategoryNorms?.[c.workCategoryName] !== undefined) {
    return Number(norm.workCategoryNorms[c.workCategoryName]) || 0;
  }
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
  const normIntegrity = validateMaterialNormCatalog(materialNorms, workVolumes);
  normIntegrity.forEach((issue) => {
    warnings.push({
      code: issue.code === 'MIXED_WORK_UNIT' ? 'MIXED_WORK_UNIT' : issue.code === 'AMBIGUOUS_NORM' ? 'AMBIGUOUS_NORM' : 'MISSING_LINK',
      workCategoryId: issue.workCategoryIds?.length === 1 ? issue.workCategoryIds[0] : undefined,
      message: issue.message,
    });
  });
  const blockedNormIds = new Set(normIntegrity.filter((issue) => issue.code === 'AMBIGUOUS_NORM' || issue.code === 'MIXED_WORK_UNIT').flatMap((issue) => issue.normIds));

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

  rooms.forEach((room) => { if (!scopeIncludes(scopeIds(scope.roomId, scope.roomIds), room.id) || !scopeIncludes(scopeIds(scope.floorId, scope.floorIds), room.floorId)) return; Object.keys(room.categoryVolumes || {}).forEach((raw) => { const authoritativeRefs = [room.workCategoryId, ...(room.subItems || []).map((item) => item.workCategoryId)].filter(Boolean) as string[]; const hasAuthoritativeMatch = authoritativeRefs.some((ref) => { const resolved = resolveWorkVolumeStrict(ref, workVolumes); return resolved.state === 'resolved' && textKey(resolved.work?.title) === textKey(raw); }); if (hasAuthoritativeMatch || workVolumes.some((work) => String(work.id || '').trim() === raw || String(work.workCategoryId || '').trim() === raw)) return; const titleMatches = workVolumes.filter((work) => textKey(work.title) === textKey(raw)); const ids = new Set(titleMatches.map((work) => canonicalWorkCategoryId(work)).filter(Boolean)); if (ids.size > 1 && !warnings.some((warning) => warning.code === 'AMBIGUOUS_LINK' && warning.roomId === room.id && warning.message.includes(raw))) warnings.push({ code: 'AMBIGUOUS_LINK', roomId: room.id, floorId: room.floorId, message: `Căn ${room.roomName}: liên kết hạng mục ${raw} trùng nhiều hạng mục đang hoạt động. Không suy đoán nhu cầu vật tư.` }); }); });
  const contributions = buildContributions(rooms, workVolumes, teams, scope, warnings);
  const aliasMap = buildMaterialAliasMap(materialNorms);
  const canonicalKey = (materialId?: string, materialName?: string, unit?: string) => {
    const resolved = materialId ? (aliasMap.get(String(materialId)) || String(materialId)) : undefined;
    return getMaterialIdentityKey(resolved, materialName, unit);
  };

  const demand = new Map<string, { materialId?: string; materialName: string; category: string; unit: string; qty: number; normIds: Set<string>; normDetails: Map<string, { normId: string; workCategory: string; workCategoryId?: string; factor: number; basisUnit: string }> }>();
  contributions.forEach((c) => {
    const norms = matchingNormsForContribution(c, materialNorms.filter((norm) => !blockedNormIds.has(norm.id)), workVolumes);
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
      const material = resolveUniqueMaterialIdentity({ materialName: tx.materialName, unit: tx.unit, materialNorms });
      if (material.state === 'resolved') key = canonicalKey(material.materialId, tx.materialName, tx.unit);
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
      const material = resolveUniqueMaterialIdentity({ materialName: tx.materialName, unit: tx.unit, materialNorms });
      if (material.state === 'resolved') key = canonicalKey(material.materialId, tx.materialName, tx.unit);
    }
    if (!demand.has(key)) return;
    const qty = Number(tx.quantity) || 0;

    const provenance = validateInventoryOutProvenance({ tx, rooms, workVolumes, materialNorms, teams });
    if (provenance.state === 'resolved' && !provenance.teamId && provenance.room) { const normalizeTeamName = (value: unknown) => String(value || '').trim().toLocaleLowerCase('vi'); const ids = new Set<string>(); const collect = (idValue?: string, nameValue?: string) => { const directId = String(idValue || '').trim(); if (directId && teams.some((team) => team.id === directId)) ids.add(directId); const name = normalizeTeamName(nameValue); if (!name) return; const matches = teams.filter((team) => normalizeTeamName(team.name) === name); if (matches.length === 1) ids.add(matches[0].id); else if (matches.length > 1) matches.forEach((team) => ids.add(team.id)); }; collect(provenance.room.teamId, provenance.room.assignedTeam); (provenance.room.subItems || []).forEach((item) => collect(item.teamId, item.assignedTeam)); if (ids.size === 1) provenance.teamId = Array.from(ids)[0]; }
    const categoryAmbiguousButMaterialAllocatable = provenance.state === 'ambiguous' && provenance.ambiguityAt === 'workCategory';
    if (provenance.state !== 'resolved' && !categoryAmbiguousButMaterialAllocatable) {
      unallocated.set(key, (unallocated.get(key) || 0) + qty);
      warnings.push({
        code: 'UNALLOCATED_ISSUE',
        roomId: tx.sourceRoomId,
        floorId: tx.sourceFloorId,
        teamId: tx.sourceTeamId,
        workCategoryId: tx.sourceWorkCategoryId,
        message: `Phiếu ${tx.id} có provenance OUT ${provenance.state}: ${provenance.reason || 'không chứng minh được liên kết nguồn'}. Không trừ vào nhu cầu.`,
      });
      return;
    }
    if (categoryAmbiguousButMaterialAllocatable) {
      // The material/room/floor provenance is still usable for a material-total view,
      // but the category allocation is not. Keep the amount visible as unallocated so
      // category/team scoped views remain fail-closed while project/floor/room material
      // totals can still subtract the physical OUT exactly once.
      unallocated.set(key, (unallocated.get(key) || 0) + qty);
      warnings.push({
        code: 'UNALLOCATED_ISSUE',
        roomId: tx.sourceRoomId,
        floorId: provenance.floorId || tx.sourceFloorId,
        teamId: tx.sourceTeamId,
        message: `Phiếu ${tx.id} chưa suy ra duy nhất hạng mục nguồn. Chỉ tính vào tổng vật tư khi phạm vi không lọc theo hạng mục/đội.`,
      });
      if (hasWorkCategoryScope || hasTeamScope) return;
    }
    const sourceRoom = provenance.room;

    if (scopedRoomIds.length > 0) {
      if (tx.sourceRoomId && !scopedRoomIds.includes(tx.sourceRoomId)) return;
      if (!tx.sourceRoomId) {
        unallocated.set(key, (unallocated.get(key) || 0) + qty);
        warnings.push({ code: 'UNALLOCATED_ISSUE', floorId: tx.sourceFloorId, message: `Phiếu ${tx.id} chưa có sourceRoomId để chứng minh thuộc căn đã chọn. Không trừ vào nhu cầu căn.` });
        return;
      }
    }

    if (scopedFloorIds.length > 0) {
      const resolvedFloorId = String(provenance.floorId || '').trim();
      if (resolvedFloorId && !scopedFloorIds.includes(resolvedFloorId)) return;
      if (!resolvedFloorId) {
        unallocated.set(key, (unallocated.get(key) || 0) + qty);
        warnings.push({ code: 'UNALLOCATED_ISSUE', roomId: tx.sourceRoomId, message: `Phiếu ${tx.id} chưa có sourceFloorId/sourceRoomId đủ rõ để chứng minh thuộc tầng đã chọn. Không trừ vào nhu cầu tầng.` });
        return;
      }
    }

    const workCategoryScopeState = hasWorkCategoryScope
      ? (provenance.workCategoryId ? (scopedWorkCategoryIds.includes(provenance.workCategoryId) ? 'inside' : 'outside') : 'ambiguous')
      : 'inside';
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
      if (provenance.teamId && scopedTeamIds.includes(provenance.teamId)) issued.set(key, (issued.get(key) || 0) + qty);
      else if (provenance.teamId) return;
      else {
        unallocated.set(key, (unallocated.get(key) || 0) + qty);
        warnings.push({ code: 'UNALLOCATED_ISSUE', roomId: tx.sourceRoomId, floorId: provenance.floorId, teamId: scopedTeamIds.length === 1 ? scopedTeamIds[0] : undefined, message: `Phiếu ${tx.id} không suy ra duy nhất đội nguồn. Không trừ vào nhu cầu đội.` });
      }
      return;
    }

    // No team filter: every OUT transaction that is proven inside the selected
    // floor/room/work-category scope belongs to that material need. This also
    // fixes whole-project summaries, which must subtract project-wide issued qty.
    issued.set(key, (issued.get(key) || 0) + qty);
  });

  const lines = Array.from(demand.entries()).map(([materialKey, item]) => {
    const rawEstimatedQty = Number(item.qty) || 0;
    const rawAlreadyIssued = Number(issued.get(materialKey) || 0);
    const rawUnallocatedIssued = Number(unallocated.get(materialKey) || 0);
    const rawRemainingQty = Math.max(0, rawEstimatedQty - rawAlreadyIssued);
    const rawStockQty = Number(stock.get(materialKey) || 0);
    const rawDeficitQty = Math.max(0, rawRemainingQty - rawStockQty);
    const estimatedQty = round2(rawEstimatedQty);
    const alreadyIssued = round2(rawAlreadyIssued);
    const unallocatedIssued = round2(rawUnallocatedIssued);
    const remainingQty = round2(rawRemainingQty);
    const stockQty = round2(rawStockQty);
    const deficitQty = round2(rawDeficitQty);
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
      sufficient: rawStockQty + 1e-9 >= rawRemainingQty,
      rawEstimatedQty,
      rawAlreadyIssued,
      rawUnallocatedIssued,
      rawRemainingQty,
      rawStockQty,
      rawDeficitQty,
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
