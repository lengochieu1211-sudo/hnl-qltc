import type { InventoryItem, MaterialNorm, RoomProgressItem, TeamInfo, WorkVolume } from '../types';
import { areSameUnit, normalizeUnit } from './unitUtils';
import { getMaterialIdentityKey, normalizeMaterialNameKey, resolveLegacyMaterialId, resolveNormMaterialId } from './inventoryUtils';

export type LinkResolutionState = 'resolved' | 'missing' | 'ambiguous' | 'floor-mismatch';
export interface WorkVolumeResolution {
  state: LinkResolutionState;
  work?: WorkVolume;
  matches?: WorkVolume[];
}

export const isActiveRecord = <T extends { deletedAt?: number | null }>(item: T): boolean => item.deletedAt === undefined || item.deletedAt === null;
export const normalizeLinkText = (value?: unknown): string => String(value ?? '').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ');
export const canonicalWorkCategoryId = (work?: WorkVolume): string => String(work?.workCategoryId || work?.id || '').trim();

export function workVolumeFloorIds(work?: WorkVolume): string[] {
  if (!work) return [];
  return Array.from(new Set([work.floorId, ...(work.floorIds || [])].map((value) => String(value || '').trim()).filter(Boolean)));
}

export function workVolumeAppliesToFloor(work: WorkVolume, floorId?: string, floorName?: string): boolean {
  const ids = workVolumeFloorIds(work);
  const normalizedFloorId = String(floorId || '').trim();
  if (ids.length > 0) return Boolean(normalizedFloorId && ids.includes(normalizedFloorId));
  const workFloor = normalizeLinkText(work.floor);
  if (!workFloor || ['tất cả', 'toàn nhà', 'công trình', 'all'].includes(workFloor)) return true;
  const normalizedFloorName = normalizeLinkText(floorName);
  if (!normalizedFloorName) return false;
  return workFloor.split(/[,;\n]+/).map((item) => normalizeLinkText(item)).filter(Boolean).includes(normalizedFloorName);
}

export function workVolumeScopesOverlap(a: WorkVolume, b: WorkVolume): boolean {
  const aIds = workVolumeFloorIds(a);
  const bIds = workVolumeFloorIds(b);
  if (aIds.length === 0 || bIds.length === 0) {
    const aFloor = normalizeLinkText(a.floor);
    const bFloor = normalizeLinkText(b.floor);
    const aGlobal = !aFloor || ['tất cả', 'toàn nhà', 'công trình', 'all'].includes(aFloor);
    const bGlobal = !bFloor || ['tất cả', 'toàn nhà', 'công trình', 'all'].includes(bFloor);
    if (aGlobal || bGlobal) return true;
    const aNames = new Set(aFloor.split(/[,;\n]+/).map(normalizeLinkText).filter(Boolean));
    return bFloor.split(/[,;\n]+/).map(normalizeLinkText).some((name) => aNames.has(name));
  }
  const bSet = new Set(bIds);
  return aIds.some((id) => bSet.has(id));
}

/**
 * Durable ID is authoritative. Display-name fallback is only used when the caller
 * does not have an ID. Floor is always part of resolution when supplied.
 */
export function resolveWorkVolumeRef(params: {
  workVolumes: WorkVolume[];
  workCategoryId?: string;
  workCategoryName?: string;
  floorId?: string;
  floorName?: string;
}): WorkVolumeResolution {
  const active = params.workVolumes.filter(isActiveRecord);
  const explicitId = String(params.workCategoryId || '').trim();
  const floorFilter = (items: WorkVolume[]) => items.filter((item) => workVolumeAppliesToFloor(item, params.floorId, params.floorName));
  if (explicitId) {
    const idMatches = active.filter((item) => String(item.id || '').trim() === explicitId || String(item.workCategoryId || '').trim() === explicitId);
    if (idMatches.length === 0) return { state: 'missing' };
    const scoped = params.floorId || params.floorName ? floorFilter(idMatches) : idMatches;
    if (scoped.length === 0) return { state: 'floor-mismatch', matches: idMatches };
    const canonicalIds = new Set(scoped.map(canonicalWorkCategoryId).filter(Boolean));
    return canonicalIds.size === 1 ? { state: 'resolved', work: scoped[0], matches: scoped } : { state: 'ambiguous', matches: scoped };
  }

  const name = normalizeLinkText(params.workCategoryName);
  if (!name) return { state: 'missing' };
  const titleMatches = active.filter((item) => normalizeLinkText(item.title) === name);
  const scoped = params.floorId || params.floorName ? floorFilter(titleMatches) : titleMatches;
  if (scoped.length === 0) return { state: titleMatches.length > 0 ? 'floor-mismatch' : 'missing', matches: titleMatches };
  const canonicalIds = new Set(scoped.map(canonicalWorkCategoryId).filter(Boolean));
  return canonicalIds.size === 1 ? { state: 'resolved', work: scoped[0], matches: scoped } : { state: 'ambiguous', matches: scoped };
}

export interface CanonicalRoomCategoryEntry {
  workCategoryId: string;
  workCategoryName: string;
  unit: string;
  quantity: number;
  sourceKey: string;
  work: WorkVolume;
}

/** Canonicalize room category quantities with ID-key winning over title-key. */
export function getCanonicalRoomCategoryEntries(room: RoomProgressItem, workVolumes: WorkVolume[]): CanonicalRoomCategoryEntry[] {
  const output = new Map<string, CanonicalRoomCategoryEntry>();
  const volumes = room.categoryVolumes || {};
  const units = room.categoryVolumeUnits || {};
  const keys = Object.keys(volumes);

  const add = (resolution: WorkVolumeResolution, sourceKey: string, quantity: number, unitHint?: string) => {
    if (resolution.state !== 'resolved' || !resolution.work) return;
    const id = canonicalWorkCategoryId(resolution.work);
    if (!id) return;
    const existing = output.get(id);
    const explicitIdKey = sourceKey === resolution.work.id || sourceKey === resolution.work.workCategoryId;
    if (existing && !explicitIdKey) return; // existing canonical/id source is authoritative
    const unit = normalizeUnit(unitHint || resolution.work.unit || room.volumeUnit || '') || (unitHint || resolution.work.unit || room.volumeUnit || '');
    output.set(id, {
      workCategoryId: id,
      workCategoryName: resolution.work.title,
      unit,
      quantity: Number(quantity) || 0,
      sourceKey,
      work: resolution.work,
    });
  };

  // IDs first, then legacy title keys. This makes duplicate ID+title storage deterministic.
  keys.sort((a, b) => {
    const aId = workVolumes.some((work) => a === work.id || a === work.workCategoryId) ? 0 : 1;
    const bId = workVolumes.some((work) => b === work.id || b === work.workCategoryId) ? 0 : 1;
    return aId - bId;
  }).forEach((key) => {
    const hasExplicitId = workVolumes.some((work) => key === work.id || key === work.workCategoryId);
    let resolution = resolveWorkVolumeRef({
      workVolumes,
      workCategoryId: hasExplicitId ? key : undefined,
      workCategoryName: hasExplicitId ? undefined : key,
      floorId: room.floorId,
      floorName: room.floorName,
    });

    // Legacy categoryVolumes keys may retain an old display title after the durable
    // WorkVolume/category ID was renamed. Durable Room/sub-item IDs are
    // authoritative only when the available evidence resolves to one canonical ID.
    if (!hasExplicitId) {
      const normalizedKey = normalizeLinkText(key);
      const authoritativeIds = new Set<string>();
      const collectAuthoritativeId = (workCategoryId?: string, label?: string) => {
        const id = String(workCategoryId || '').trim();
        if (!id) return;
        const labelMatches = Boolean(normalizedKey && normalizeLinkText(label) === normalizedKey);
        if (!labelMatches && keys.length !== 1) return;
        const candidate = resolveWorkVolumeRef({
          workVolumes,
          workCategoryId: id,
          floorId: room.floorId,
          floorName: room.floorName,
        });
        if (candidate.state !== 'resolved' || !candidate.work) return;
        const canonicalId = canonicalWorkCategoryId(candidate.work);
        if (canonicalId) authoritativeIds.add(canonicalId);
      };

      collectAuthoritativeId(room.workCategoryId, room.workCategory);
      (room.subItems || []).forEach((item) => collectAuthoritativeId(item.workCategoryId, item.category));

      if (authoritativeIds.size > 1) {
        resolution = { state: 'ambiguous' };
      } else if (authoritativeIds.size === 1) {
        const authoritativeId = Array.from(authoritativeIds)[0];
        const resolvedId = resolution.state === 'resolved' && resolution.work
          ? canonicalWorkCategoryId(resolution.work)
          : '';
        if (resolvedId !== authoritativeId) {
          resolution = resolveWorkVolumeRef({
            workVolumes,
            workCategoryId: authoritativeId,
            floorId: room.floorId,
            floorName: room.floorName,
          });
        }
      }
    }
    add(resolution, key, Number(volumes[key]) || 0, units[key]);
  });

  if (room.workCategoryId || room.workCategory) {
    const resolution = resolveWorkVolumeRef({
      workVolumes,
      workCategoryId: room.workCategoryId,
      workCategoryName: room.workCategoryId ? undefined : room.workCategory,
      floorId: room.floorId,
      floorName: room.floorName,
    });
    if (resolution.state === 'resolved' && resolution.work) {
      const id = canonicalWorkCategoryId(resolution.work);
      if (!output.has(id) && (Number(room.workVolume) || 0) > 0) {
        add(resolution, room.workCategoryId || room.workCategory || id, Number(room.workVolume) || 0, room.volumeUnit);
      }
    }
  }

  return Array.from(output.values());
}

export function canonicalNormCategoryIds(norm: MaterialNorm, workVolumes: WorkVolume[]): { ids: string[]; unresolved: string[] } {
  const refs = Array.from(new Set([...(norm.workCategoryIds || []), ...(norm.workCategoryId ? [norm.workCategoryId] : [])].map((v) => String(v || '').trim()).filter(Boolean)));
  const ids: string[] = [];
  const unresolved: string[] = [];
  if (refs.length > 0) {
    refs.forEach((ref) => {
      const resolved = resolveWorkVolumeRef({ workVolumes, workCategoryId: ref });
      if (resolved.state === 'resolved' && resolved.work) ids.push(canonicalWorkCategoryId(resolved.work));
      else unresolved.push(ref);
    });
    return { ids: Array.from(new Set(ids.filter(Boolean))), unresolved };
  }
  const names = Array.from(new Set([...(norm.workCategories || []), ...(norm.workCategory ? [norm.workCategory] : [])].map((v) => String(v || '').trim()).filter(Boolean)));
  names.forEach((name) => {
    const resolved = resolveWorkVolumeRef({ workVolumes, workCategoryName: name });
    if (resolved.state === 'resolved' && resolved.work) ids.push(canonicalWorkCategoryId(resolved.work));
    else unresolved.push(name);
  });
  return { ids: Array.from(new Set(ids.filter(Boolean))), unresolved };
}


export interface WorkVolumeCatalogIssue {
  code: 'DUPLICATE_WORK_VOLUME';
  workVolumeIds: string[];
  message: string;
}

/** Same title + same unit may repeat on disjoint floors, but never on overlapping scope. */
export function validateWorkVolumeCatalog(workVolumes: WorkVolume[]): WorkVolumeCatalogIssue[] {
  const active = workVolumes.filter(isActiveRecord);
  const issues: WorkVolumeCatalogIssue[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (normalizeLinkText(a.title) !== normalizeLinkText(b.title)) continue;
      if (!areSameUnit(a.unit, b.unit)) continue;
      if (!workVolumeScopesOverlap(a, b)) continue;
      issues.push({
        code: 'DUPLICATE_WORK_VOLUME',
        workVolumeIds: [a.id, b.id],
        message: `Hạng mục "${a.title}" (${normalizeUnit(a.unit) || a.unit}) bị trùng trên phạm vi tầng giao nhau.`,
      });
    }
  }
  return issues;
}

export interface MaterialNormIntegrityIssue {
  code: 'AMBIGUOUS_NORM' | 'MIXED_WORK_UNIT' | 'ORPHAN_CATEGORY';
  normIds: string[];
  materialKey?: string;
  workCategoryIds?: string[];
  message: string;
}

export function validateMaterialNormCatalog(norms: MaterialNorm[], workVolumes: WorkVolume[]): MaterialNormIntegrityIssue[] {
  const activeNorms = norms.filter(isActiveRecord);
  const issues: MaterialNormIntegrityIssue[] = [];
  const scoped = activeNorms.map((norm) => ({ norm, scope: canonicalNormCategoryIds(norm, workVolumes) }));
  scoped.forEach(({ norm, scope }) => {
    if (scope.unresolved.length > 0) {
      issues.push({ code: 'ORPHAN_CATEGORY', normIds: [norm.id], workCategoryIds: scope.ids, message: `Định mức ${norm.materialName} còn liên kết hạng mục không hợp lệ: ${scope.unresolved.join(', ')}` });
    }
    const units = new Set(scope.ids.map((id) => resolveWorkVolumeRef({ workVolumes, workCategoryId: id }).work?.unit).filter(Boolean).map((u) => normalizeUnit(u) || String(u)));
    if (units.size > 1) issues.push({ code: 'MIXED_WORK_UNIT', normIds: [norm.id], workCategoryIds: scope.ids, message: `Định mức ${norm.materialName} phủ các hạng mục có ĐVT nguồn khác nhau.` });
  });
  for (let i = 0; i < scoped.length; i++) {
    for (let j = i + 1; j < scoped.length; j++) {
      const a = scoped[i]; const b = scoped[j];
      const aMaterial = getMaterialIdentityKey(resolveNormMaterialId(a.norm), a.norm.materialName, a.norm.unit);
      const bMaterial = getMaterialIdentityKey(resolveNormMaterialId(b.norm), b.norm.materialName, b.norm.unit);
      if (aMaterial !== bMaterial) continue;
      const bSet = new Set(b.scope.ids);
      const overlap = a.scope.ids.filter((id) => bSet.has(id));
      if (overlap.length > 0) issues.push({ code: 'AMBIGUOUS_NORM', normIds: [a.norm.id, b.norm.id], materialKey: aMaterial, workCategoryIds: overlap, message: `Hai định mức cùng vật tư phủ trùng hạng mục: ${overlap.join(', ')}` });
    }
  }
  return issues;
}

export function resolveUniqueMaterialIdentity(params: { materialId?: string; materialName?: string; unit?: string; materialNorms: MaterialNorm[] }): { state: 'resolved' | 'missing' | 'ambiguous'; materialId?: string } {
  const explicit = String(params.materialId || '').trim();
  if (explicit) return { state: 'resolved', materialId: explicit };
  const name = normalizeMaterialNameKey(params.materialName);
  const unit = normalizeUnit(params.unit || '') || String(params.unit || '').trim();
  if (!name || !unit) return { state: 'missing' };
  const ids = Array.from(new Set(params.materialNorms.filter(isActiveRecord).filter((norm) => normalizeMaterialNameKey(norm.materialName) === name && areSameUnit(norm.unit, unit)).map(resolveNormMaterialId).filter(Boolean) as string[]));
  if (ids.length === 1) return { state: 'resolved', materialId: ids[0] };
  if (ids.length > 1) return { state: 'ambiguous' };

  // A warehouse item does not need a MaterialNorm to exist. When Name + Unit has no
  // catalog match, keep it as an independent deterministic bucket instead of rejecting
  // the ledger write or guessing a different norm by display name.
  const independentId = resolveLegacyMaterialId(params.materialName, unit);
  return independentId ? { state: 'resolved', materialId: independentId } : { state: 'missing' };
}

export interface InventoryOutProvenanceResult {
  state: 'resolved' | 'ambiguous' | 'invalid';
  ambiguityAt?: 'material' | 'workCategory';
  room?: RoomProgressItem;
  floorId?: string;
  workCategoryId?: string;
  teamId?: string;
  normId?: string;
  reason?: string;
}

export function validateInventoryOutProvenance(params: {
  tx: InventoryItem;
  rooms: RoomProgressItem[];
  workVolumes: WorkVolume[];
  materialNorms: MaterialNorm[];
  teams?: TeamInfo[];
}): InventoryOutProvenanceResult {
  const { tx, workVolumes, materialNorms } = params;
  if (tx.type !== 'out') return { state: 'resolved' };
  const room = tx.sourceRoomId ? params.rooms.find((item) => item.id === tx.sourceRoomId && isActiveRecord(item)) : undefined;
  if (tx.sourceRoomId && !room) return { state: 'invalid', reason: 'sourceRoomId không tồn tại/hoạt động' };
  const floorId = String(tx.sourceFloorId || room?.floorId || '').trim() || undefined;
  if (room && tx.sourceFloorId && room.floorId !== tx.sourceFloorId) return { state: 'invalid', room, floorId, reason: 'sourceFloorId mâu thuẫn sourceRoomId' };

  const material = resolveUniqueMaterialIdentity({ materialId: tx.materialId, materialName: tx.materialName, unit: tx.unit, materialNorms });
  if (material.state !== 'resolved') return { state: material.state === 'ambiguous' ? 'ambiguous' : 'invalid', ambiguityAt: material.state === 'ambiguous' ? 'material' : undefined, room, floorId, reason: 'material identity không duy nhất' };

  const norm = tx.sourceNormId ? materialNorms.find((item) => item.id === tx.sourceNormId && isActiveRecord(item)) : undefined;
  if (tx.sourceNormId && !norm) return { state: 'invalid', room, floorId, reason: 'sourceNormId không tồn tại' };
  if (norm) {
    const normMaterial = resolveUniqueMaterialIdentity({ materialId: norm.materialId || resolveNormMaterialId(norm), materialName: norm.materialName, unit: norm.unit, materialNorms });
    if (normMaterial.state !== 'resolved' || normMaterial.materialId !== material.materialId || !areSameUnit(norm.unit, tx.unit)) return { state: 'invalid', room, floorId, normId: norm.id, reason: 'sourceNormId không khớp vật tư/ĐVT' };
  }

  let categoryId = String(tx.sourceWorkCategoryId || '').trim() || undefined;
  if (categoryId) {
    const resolved = resolveWorkVolumeRef({ workVolumes, workCategoryId: categoryId, floorId, floorName: room?.floorName });
    if (resolved.state !== 'resolved' || !resolved.work) return { state: resolved.state === 'ambiguous' ? 'ambiguous' : 'invalid', ambiguityAt: resolved.state === 'ambiguous' ? 'workCategory' : undefined, room, floorId, reason: 'sourceWorkCategoryId không hợp lệ trong tầng nguồn' };
    categoryId = canonicalWorkCategoryId(resolved.work);
  }

  const roomCategoryIds = room ? getCanonicalRoomCategoryEntries(room, workVolumes).map((entry) => entry.workCategoryId) : [];
  if (categoryId && room && !roomCategoryIds.includes(categoryId)) return { state: 'invalid', room, floorId, workCategoryId: categoryId, reason: 'sourceWorkCategoryId không thuộc sourceRoomId' };

  const normScope = norm ? canonicalNormCategoryIds(norm, workVolumes).ids : [];
  if (categoryId && norm && !normScope.includes(categoryId)) return { state: 'invalid', room, floorId, workCategoryId: categoryId, normId: norm.id, reason: 'sourceNormId không áp dụng cho sourceWorkCategoryId' };

  if (!categoryId) {
    let candidates = roomCategoryIds;
    if (normScope.length > 0) candidates = candidates.length > 0 ? candidates.filter((id) => normScope.includes(id)) : normScope;
    candidates = Array.from(new Set(candidates));
    if (candidates.length === 1) categoryId = candidates[0];
    else return { state: 'ambiguous', ambiguityAt: 'workCategory', room, floorId, normId: norm?.id, reason: 'không suy ra duy nhất hạng mục nguồn' };
  }

  let teamId = String(tx.sourceTeamId || '').trim() || undefined;
  if (teamId && params.teams && !params.teams.some((team) => team.id === teamId && isActiveRecord(team))) return { state: 'invalid', room, floorId, workCategoryId: categoryId, teamId, normId: norm?.id, reason: 'sourceTeamId không tồn tại' };
  if (room) {
    const categoryTeams = Array.from(new Set((room.subItems || []).filter((sub) => {
      if (sub.workCategoryId) return sub.workCategoryId === categoryId;
      if (!sub.category) return false;
      const resolved = resolveWorkVolumeRef({ workVolumes, workCategoryName: sub.category, floorId: room.floorId, floorName: room.floorName });
      return resolved.state === 'resolved' && canonicalWorkCategoryId(resolved.work) === categoryId;
    }).map((sub) => String(sub.teamId || '').trim()).filter(Boolean)));
    if (teamId && categoryTeams.length > 0 && !categoryTeams.includes(teamId)) return { state: 'invalid', room, floorId, workCategoryId: categoryId, teamId, normId: norm?.id, reason: 'sourceTeamId không phụ trách hạng mục trong sourceRoomId' };
    if (!teamId) {
      const fallbackTeams = categoryTeams.length > 0 ? categoryTeams : (room.teamId ? [room.teamId] : []);
      if (fallbackTeams.length === 1) teamId = fallbackTeams[0];
      // Multiple candidate teams are acceptable for floor/project allocation, but
      // remain unallocated for team-scoped Material Need because teamId stays empty.
    }
  }

  return { state: 'resolved', room, floorId, workCategoryId: categoryId, teamId, normId: norm?.id };
}
