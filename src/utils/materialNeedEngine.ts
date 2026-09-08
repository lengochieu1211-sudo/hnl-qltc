import { InventoryItem, MaterialNorm, RoomProgressItem, TeamInfo, WorkVolume } from '../types';
import { areSameUnit, normalizeUnit } from './unitUtils';
import { buildMaterialAliasMap, getMaterialIdentityKey, normalizeMaterialNameKey, resolveNormMaterialId } from './inventoryUtils';

export interface MaterialNeedWarning {
  code: 'MISSING_NORM' | 'UNIT_MISMATCH' | 'AMBIGUOUS_TEAM' | 'UNALLOCATED_ISSUE';
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
  teamId?: string;
  roomId?: string;
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

const round2 = (value: number) => Math.ceil((Number(value) || 0) * 100) / 100;
const textKey = (value?: string) => String(value || '').trim().toLocaleLowerCase('vi-VN');

function resolveWorkVolume(categoryIdOrName: string | undefined, workVolumes: WorkVolume[]): WorkVolume | undefined {
  if (!categoryIdOrName) return undefined;
  const key = textKey(categoryIdOrName);
  return workVolumes.find((item) => item.id === categoryIdOrName || textKey(item.title) === key);
}

function categoryVolumeForRoom(room: RoomProgressItem, categoryIdOrName: string, workVolumes: WorkVolume[]): number {
  const volumes = room.categoryVolumes || {};
  if (volumes[categoryIdOrName] !== undefined) return Number(volumes[categoryIdOrName]) || 0;
  const work = resolveWorkVolume(categoryIdOrName, workVolumes);
  if (work && volumes[work.id] !== undefined) return Number(volumes[work.id]) || 0;
  if (work && volumes[work.title] !== undefined) return Number(volumes[work.title]) || 0;
  if (textKey(room.workCategory) === textKey(categoryIdOrName) || room.workCategoryId === categoryIdOrName) return Number(room.workVolume) || 0;
  return 0;
}

function sourceUnitForRoomCategory(room: RoomProgressItem, categoryIdOrName: string, workVolumes: WorkVolume[]): string {
  const units = room.categoryVolumeUnits || {};
  const work = resolveWorkVolume(categoryIdOrName, workVolumes);
  return normalizeUnit(units[categoryIdOrName] || (work ? units[work.id] || units[work.title] : '') || work?.unit || room.volumeUnit || 'm²') || 'm²';
}

function roomCategories(room: RoomProgressItem, workVolumes: WorkVolume[]): Array<{ id?: string; name: string }> {
  const out = new Map<string, { id?: string; name: string }>();
  Object.keys(room.categoryVolumes || {}).forEach((raw) => {
    const work = resolveWorkVolume(raw, workVolumes);
    const id = work?.id || (raw === room.workCategoryId ? raw : undefined);
    const name = work?.title || (raw === room.workCategoryId ? room.workCategory || raw : raw);
    out.set(id || textKey(name), { id, name });
  });
  if (room.workCategory || room.workCategoryId) {
    const work = resolveWorkVolume(room.workCategoryId || room.workCategory, workVolumes);
    out.set(work?.id || room.workCategoryId || textKey(room.workCategory), {
      id: work?.id || room.workCategoryId,
      name: work?.title || room.workCategory || room.workCategoryId || 'Hạng mục',
    });
  }
  (room.subItems || []).forEach((sub) => {
    const work = resolveWorkVolume(sub.workCategoryId || sub.category, workVolumes);
    if (work || sub.workCategoryId || sub.category) {
      out.set(work?.id || sub.workCategoryId || textKey(sub.category), {
        id: work?.id || sub.workCategoryId,
        name: work?.title || sub.category || sub.workCategoryId || 'Hạng mục',
      });
    }
  });
  return Array.from(out.values());
}

function uniqueRoomTeamIds(room: RoomProgressItem): string[] {
  const ids = new Set<string>();
  if (room.teamId) ids.add(room.teamId);
  (room.subItems || []).forEach((sub) => { if (sub.teamId) ids.add(sub.teamId); });
  return Array.from(ids);
}

function categorySubItems(room: RoomProgressItem, categoryId: string | undefined, categoryName: string) {
  return (room.subItems || []).filter((sub) => {
    const sameId = Boolean(categoryId && sub.workCategoryId === categoryId);
    const sameName = textKey(sub.category) === textKey(categoryName);
    return sameId || sameName;
  });
}

function uniqueCategoryTeamIds(room: RoomProgressItem, categoryId: string | undefined, categoryName: string): string[] {
  return Array.from(new Set(categorySubItems(room, categoryId, categoryName).map((sub) => sub.teamId).filter(Boolean) as string[]));
}

function buildContributions(
  rooms: RoomProgressItem[],
  workVolumes: WorkVolume[],
  scope: MaterialNeedScope,
  warnings: MaterialNeedWarning[],
): NeedContribution[] {
  const contributions: NeedContribution[] = [];
  rooms.forEach((room) => {
    if (scope.roomId && room.id !== scope.roomId) return;
    if (scope.floorId && room.floorId !== scope.floorId) return;
    const cats = roomCategories(room, workVolumes);
    const teamIds = uniqueRoomTeamIds(room);

    cats.forEach((cat) => {
      const categoryRef = cat.id || cat.name;
      const totalVolume = categoryVolumeForRoom(room, categoryRef, workVolumes);
      if (totalVolume <= 0) return;
      const sourceUnit = sourceUnitForRoomCategory(room, categoryRef, workVolumes);

      if (!scope.teamId) {
        contributions.push({ roomId: room.id, floorId: room.floorId, workCategoryId: cat.id, workCategoryName: cat.name, sourceUnit, volume: totalVolume });
        return;
      }

      const categorySubs = categorySubItems(room, cat.id, cat.name);
      const categoryTeamIds = uniqueCategoryTeamIds(room, cat.id, cat.name);
      const matchingSubs = categorySubs.filter((sub) => sub.teamId === scope.teamId);
      const explicitVolume = matchingSubs.reduce((sum, sub) => sum + (Number(sub.workVolume) || 0), 0);
      if (explicitVolume > 0) {
        contributions.push({ roomId: room.id, floorId: room.floorId, teamId: scope.teamId, workCategoryId: cat.id, workCategoryName: cat.name, sourceUnit: normalizeUnit(matchingSubs[0]?.volumeUnit || sourceUnit) || sourceUnit, volume: explicitVolume });
        return;
      }

      // A room may contain several teams across different categories. When every
      // sub-step for this category points to one team, the category-level linkage is
      // deterministic even if the individual steps do not duplicate workVolume.
      // Reuse the category's total quantity, matching what the room progress UI shows.
      if (categoryTeamIds.length === 1 && categoryTeamIds[0] === scope.teamId) {
        contributions.push({ roomId: room.id, floorId: room.floorId, teamId: scope.teamId, workCategoryId: cat.id, workCategoryName: cat.name, sourceUnit, volume: totalVolume });
        return;
      }

      if (teamIds.length === 1 && teamIds[0] === scope.teamId) {
        contributions.push({ roomId: room.id, floorId: room.floorId, teamId: scope.teamId, workCategoryId: cat.id, workCategoryName: cat.name, sourceUnit, volume: totalVolume });
        return;
      }

      if (categoryTeamIds.includes(scope.teamId) || (categoryTeamIds.length === 0 && teamIds.includes(scope.teamId))) {
        warnings.push({
          code: 'AMBIGUOUS_TEAM',
          roomId: room.id,
          floorId: room.floorId,
          teamId: scope.teamId,
          workCategoryId: cat.id,
          message: `Căn ${room.roomName}: hạng mục ${cat.name} có nhiều đội nhưng chưa có khối lượng phân bổ theo teamId. Không tự chia nhu cầu.`,
        });
      }
    });
  });
  return contributions;
}

function matchingNormsForContribution(c: NeedContribution, norms: MaterialNorm[]): MaterialNorm[] {
  return norms.filter((norm) => {
    const ids = norm.workCategoryIds || (norm.workCategoryId ? [norm.workCategoryId] : []);
    if (ids.length > 0 && c.workCategoryId) return ids.includes(c.workCategoryId);
    const names = norm.workCategories || (norm.workCategory ? [norm.workCategory] : []);
    if (ids.length === 0 && names.length === 0) return true;
    return names.some((name) => textKey(name) === textKey(c.workCategoryName));
  });
}

function factorForContribution(c: NeedContribution, norm: MaterialNorm): number {
  if (c.workCategoryId && norm.workCategoryNormsById?.[c.workCategoryId] !== undefined) return Number(norm.workCategoryNormsById[c.workCategoryId]) || 0;
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
  const { rooms, materialNorms, inventory, workVolumes } = params;
  const scope = params.scope || {};
  const warnings: MaterialNeedWarning[] = [];
  const contributions = buildContributions(rooms, workVolumes, scope, warnings);
  const aliasMap = buildMaterialAliasMap(materialNorms);
  const canonicalKey = (materialId?: string, materialName?: string, unit?: string) => {
    const resolved = materialId ? (aliasMap.get(String(materialId)) || String(materialId)) : undefined;
    return getMaterialIdentityKey(resolved, materialName, unit);
  };

  const demand = new Map<string, { materialId?: string; materialName: string; category: string; unit: string; qty: number; normIds: Set<string>; normDetails: Map<string, { normId: string; workCategory: string; workCategoryId?: string; factor: number; basisUnit: string }> }>();
  contributions.forEach((c) => {
    const norms = matchingNormsForContribution(c, materialNorms);
    let usable = 0;
    norms.forEach((norm) => {
      const factor = factorForContribution(c, norm);
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
  inventory.forEach((tx) => {
    if (tx.type !== 'out') return;
    if (scope.roomId && tx.sourceRoomId !== scope.roomId) return;
    if (scope.floorId && tx.sourceFloorId !== scope.floorId) return;
    let key = canonicalKey(tx.materialId, tx.materialName, tx.unit);
    if (!tx.materialId) {
      const norm = materialNorms.find((n) => normalizeMaterialNameKey(n.materialName) === normalizeMaterialNameKey(tx.materialName) && areSameUnit(n.unit, tx.unit));
      if (norm) key = canonicalKey(resolveNormMaterialId(norm), norm.materialName, norm.unit);
    }
    const qty = Number(tx.quantity) || 0;
    if (scope.teamId) {
      if (tx.sourceTeamId === scope.teamId) issued.set(key, (issued.get(key) || 0) + qty);
      else if (!tx.sourceTeamId && tx.sourceRoomId) {
        const room = rooms.find((r) => r.id === tx.sourceRoomId);
        const ids = room ? uniqueRoomTeamIds(room) : [];
        if (ids.length === 1 && ids[0] === scope.teamId) issued.set(key, (issued.get(key) || 0) + qty);
        else if (ids.includes(scope.teamId)) {
          unallocated.set(key, (unallocated.get(key) || 0) + qty);
          warnings.push({ code: 'UNALLOCATED_ISSUE', roomId: tx.sourceRoomId, floorId: tx.sourceFloorId, teamId: scope.teamId, message: `Phiếu ${tx.id} chưa có sourceTeamId và không thể chứng minh duy nhất đội nhận. Không trừ vào nhu cầu đội.` });
        }
      }
      return;
    }
    if (scope.floorId && tx.sourceFloorId === scope.floorId) issued.set(key, (issued.get(key) || 0) + qty);
    else if (scope.roomId && tx.sourceRoomId === scope.roomId) issued.set(key, (issued.get(key) || 0) + qty);
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
  }).sort((a, b) => a.category.localeCompare(b.category, 'vi') || a.materialName.localeCompare(b.materialName, 'vi'));

  return { lines, warnings, failClosed: warnings.some((w) => w.code === 'MISSING_NORM' || w.code === 'UNIT_MISMATCH' || w.code === 'AMBIGUOUS_TEAM') };
}
