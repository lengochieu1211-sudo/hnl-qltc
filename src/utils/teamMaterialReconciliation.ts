import type { InventoryItem, MaterialNorm, TeamInfo, WorkVolume } from '../types';
import type { TeamStatistics } from './teamUtils';
import { canonicalNormCategoryIds } from './linkageIntegrity';
import { buildMaterialAliasMap, getMaterialIdentityKey, resolveNormMaterialId } from './inventoryUtils';
import { areSameUnit, normalizeUnit } from './unitUtils';
import { naturalCompare } from './sortUtils';

export interface TeamMaterialReconciliationLine {
  materialKey: string;
  materialId?: string;
  materialName: string;
  category: string;
  unit: string;
  expectedAssignedQty: number;
  expectedConstructedQty: number;
  issuedQty: number;
  varianceQty: number;
  issuedVsConstructedPercent?: number;
}

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
const active = <T extends { deletedAt?: number | null }>(item: T) => item.deletedAt === undefined || item.deletedAt === null;

function normFactorForCategory(
  norm: MaterialNorm,
  category: TeamStatistics['categoryBreakdown'][number],
  workVolumes: WorkVolume[],
): number {
  const categoryId = String(category.workCategoryId || '').trim();
  const scopedIds = canonicalNormCategoryIds(norm, workVolumes).ids;

  if (categoryId && scopedIds.length > 0 && !scopedIds.includes(categoryId)) return 0;

  if (categoryId && norm.workCategoryNormsById && Object.keys(norm.workCategoryNormsById).length > 0) {
    if (norm.workCategoryNormsById[categoryId] !== undefined) {
      return Math.max(0, Number(norm.workCategoryNormsById[categoryId]) || 0);
    }
    return 0;
  }

  if ((!norm.workCategoryIds || norm.workCategoryIds.length === 0) && !norm.workCategoryId) {
    const byName = norm.workCategoryNorms?.[category.categoryName];
    if (byName !== undefined) return Math.max(0, Number(byName) || 0);
  }

  if (scopedIds.length === 0 && (norm.workCategories?.length || norm.workCategory)) {
    const names = norm.workCategories || (norm.workCategory ? [norm.workCategory] : []);
    if (!names.some((name) => String(name || '').trim().toLocaleLowerCase('vi-VN') === category.categoryName.trim().toLocaleLowerCase('vi-VN'))) {
      return 0;
    }
  }

  const sourceUnit = normalizeUnit(category.unit) || category.unit;
  const basisUnit = normalizeUnit(norm.normBasisUnit || sourceUnit) || norm.normBasisUnit || sourceUnit;
  if (!areSameUnit(sourceUnit, basisUnit)) return 0;
  return Math.max(0, Number(norm.unitNormPerM2) || 0);
}

export function computeTeamMaterialReconciliation(params: {
  team: TeamInfo;
  stats: TeamStatistics;
  inventory: InventoryItem[];
  materialNorms: MaterialNorm[];
  workVolumes: WorkVolume[];
}): TeamMaterialReconciliationLine[] {
  const { team, stats } = params;
  const materialNorms = params.materialNorms.filter(active);
  const workVolumes = params.workVolumes.filter(active);
  const inventory = params.inventory.filter(active);
  const aliasMap = buildMaterialAliasMap(materialNorms);
  const lines = new Map<string, TeamMaterialReconciliationLine>();

  const canonicalKey = (materialId?: string, materialName?: string, unit?: string) => {
    const resolved = materialId ? (aliasMap.get(String(materialId)) || String(materialId)) : undefined;
    return getMaterialIdentityKey(resolved, materialName, unit);
  };

  stats.categoryBreakdown.forEach((category) => {
    materialNorms.forEach((norm) => {
      const factor = normFactorForCategory(norm, category, workVolumes);
      if (!(factor > 0)) return;
      const materialId = resolveNormMaterialId(norm);
      const key = canonicalKey(materialId, norm.materialName, norm.unit);
      const existing = lines.get(key) || {
        materialKey: key,
        materialId,
        materialName: norm.materialName,
        category: norm.category || 'Vật tư',
        unit: normalizeUnit(norm.unit) || norm.unit,
        expectedAssignedQty: 0,
        expectedConstructedQty: 0,
        issuedQty: 0,
        varianceQty: 0,
      };
      existing.expectedAssignedQty += Math.max(0, Number(category.assignedVol) || 0) * factor;
      existing.expectedConstructedQty += Math.max(0, Number(category.constructedVol) || 0) * factor;
      lines.set(key, existing);
    });
  });

  inventory.forEach((tx) => {
    if (tx.type !== 'out' || tx.sourceTeamId !== team.id) return;
    if (tx.issuePurpose === 'external-project' || tx.issuePurpose === 'other') return;
    const materialId = tx.materialId ? (aliasMap.get(String(tx.materialId)) || String(tx.materialId)) : undefined;
    const key = canonicalKey(materialId, tx.materialName, tx.unit);
    const existing = lines.get(key) || {
      materialKey: key,
      materialId,
      materialName: tx.materialName,
      category: 'Vật tư',
      unit: normalizeUnit(tx.unit) || tx.unit,
      expectedAssignedQty: 0,
      expectedConstructedQty: 0,
      issuedQty: 0,
      varianceQty: 0,
    };
    existing.issuedQty += Math.max(0, Number(tx.quantity) || 0);
    lines.set(key, existing);
  });

  return Array.from(lines.values())
    .map((line) => {
      const expectedAssignedQty = round2(line.expectedAssignedQty);
      const expectedConstructedQty = round2(line.expectedConstructedQty);
      const issuedQty = round2(line.issuedQty);
      const varianceQty = round2(issuedQty - expectedConstructedQty);
      return {
        ...line,
        expectedAssignedQty,
        expectedConstructedQty,
        issuedQty,
        varianceQty,
        ...(expectedConstructedQty > 0 ? { issuedVsConstructedPercent: Math.round((issuedQty / expectedConstructedQty) * 100) } : {}),
      };
    })
    .sort((a, b) => naturalCompare(a.category, b.category) || naturalCompare(a.materialName, b.materialName));
}
