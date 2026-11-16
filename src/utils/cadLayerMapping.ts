/**
 * Read-only CAD layer -> work-category review. Nothing in this module saves
 * rooms, Firestore records, or quantities. A future commit path must require
 * separate authorization, scope/geometry verification and explicit consent.
 */
import type { RoomProgressItem, WorkVolume } from '../types';
import type { DxfQuantityTakeoffResult } from './dxfRoomDetection';
import { unitKey } from './unitUtils';

export type CadQuantityMetric = 'area' | 'length' | 'perimeter' | 'block';
export type CadLayerMapping = { workCategoryId: string; metric: CadQuantityMetric };
export type CadLayerMappings = Record<string, CadLayerMapping>;

export interface CadLayerComparison {
  workCategoryId: string;
  categoryName: string;
  metric: CadQuantityMetric;
  unit: string;
  layers: string[];
  cadQuantity?: number;
  existingQuantity?: number;
  delta?: number;
  issues: string[];
}

export function supportedCadMetrics(unit: string): CadQuantityMetric[] {
  const key = unitKey(unit);
  if (key === 'm²') return ['area'];
  if (key === 'm') return ['length', 'perimeter'];
  if (key === 'cái') return ['block'];
  return [];
}

export function buildCadLayerComparison(
  survey: DxfQuantityTakeoffResult,
  mappings: CadLayerMappings,
  catalog: WorkVolume[],
  rooms: RoomProgressItem[],
  floorId: string,
): CadLayerComparison[] {
  const groups = new Map<string, CadLayerComparison>();
  for (const layer of survey.layers) {
    const mapping = mappings[layer.layer];
    if (!mapping?.workCategoryId) continue;
    const work = catalog.find((item) => (item.workCategoryId || item.id) === mapping.workCategoryId);
    const key = mapping.workCategoryId;
    const group = groups.get(key) || {
      workCategoryId: key, categoryName: work?.title || 'Hạng mục không còn tồn tại',
      metric: mapping.metric, unit: work?.unit || '', layers: [], issues: [],
    };
    group.layers.push(layer.layer);
    if (!work) group.issues.push('Hạng mục đã bị xóa hoặc đổi ID; phải chọn lại.');
    if (work && work.floorId && work.floorId !== floorId) group.issues.push('Hạng mục đang gắn với tầng khác.');
    if (work?.floorIds?.length && !work.floorIds.includes(floorId)) group.issues.push('Hạng mục không thuộc danh sách tầng này.');
    const mixedMetric = mapping.metric !== group.metric;
    if (mixedMetric) group.issues.push('Cùng hạng mục có nhiều cách đo; cần tách/kiểm tra trước khi tổng hợp.');
    if (!supportedCadMetrics(work?.unit || '').includes(mapping.metric)) group.issues.push('Đơn vị hạng mục không phù hợp với đại lượng CAD.');
    let value: number | undefined;
    if (mapping.metric === 'area') value = layer.areaM2;
    if (mapping.metric === 'length') value = layer.lengthM;
    if (mapping.metric === 'perimeter') value = layer.perimeterM;
    if (mapping.metric === 'block') value = layer.blockCount;
    if (value === undefined || !Number.isFinite(value) || value < 0) group.issues.push('Đơn vị hoặc trị số CAD chưa đủ tin cậy.');
    else if (!mixedMetric) group.cadQuantity = (group.cadQuantity || 0) + value;
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.issues.some((issue) => issue.includes('nhiều cách đo') || issue.includes('không phù hợp') || issue.includes('không còn tồn tại'))) {
      group.cadQuantity = undefined;
    }
    // The source parser de-duplicates on the same layer only; geometry on
    // different layers may still represent the same work. Never silently commit.
    if (group.layers.length > 1) group.issues.push('Nhiều layer cùng hạng mục: kiểm tra hình học trùng giữa các layer.');
    if (survey.skippedEntities) group.issues.push('DXF có đối tượng chưa bóc tách được: cần kiểm tra bản vẽ gốc.');
    const work = catalog.find((item) => (item.workCategoryId || item.id) === group.workCategoryId);
    if (!work) continue;
    let total = 0;
    let found = false;
    let unknownUnit = false;
    for (const room of rooms) {
      if (room.floorId !== floorId || room.deletedAt) continue;
      const direct = room.categoryVolumes?.[work.title];
      const fallback = (room.workCategoryId === group.workCategoryId || (!room.workCategoryId && room.workCategory === work.title))
        ? room.workVolume : undefined;
      const value = direct ?? fallback;
      if (value === undefined) continue;
      const unit = direct !== undefined ? (room.categoryVolumeUnits?.[work.title] || room.volumeUnit) : room.volumeUnit;
      if (!unit || unitKey(unit) !== unitKey(work.unit) || !Number.isFinite(value) || value < 0) {
        unknownUnit = true;
        continue;
      }
      total += value;
      found = true;
    }
    if (unknownUnit) group.issues.push('Có khối lượng phòng thiếu đơn vị hoặc sai đơn vị; không thể so sánh đầy đủ.');
    if (found && !unknownUnit) {
      group.existingQuantity = total;
      if (group.cadQuantity !== undefined && group.issues.length === 0) {
        group.delta = Math.round((group.cadQuantity - total) * 10000) / 10000;
      }
    }
    if (!found) group.issues.push('Chưa có khối lượng phòng cùng tầng, cùng hạng mục và đơn vị để đối chiếu.');
  }
  return [...groups.values()];
}

/** CSV formula injection protection for layer and user-managed category names. */
export function exportCadLayerComparisonCsv(rows: CadLayerComparison[]): string {
  const quote = (raw: string | number | undefined) => {
    const s = String(raw ?? '');
    const safe = /^[\s]*[=+@\-\t\r\n]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const data: Array<Array<string | number | undefined>> = [
    ['Hạng mục', 'ID hạng mục', 'Layer CAD', 'Cách đo', 'Đơn vị', 'KL CAD', 'KL phòng cùng tầng', 'Chênh lệch', 'Cảnh báo'],
    ...rows.map((row) => [row.categoryName, row.workCategoryId, row.layers.join('; '), row.metric, row.unit,
      row.cadQuantity, row.existingQuantity, row.delta, row.issues.join(' | ')]),
  ];
  return `\uFEFF${data.map((cells) => cells.map(quote).join(',')).join('\r\n')}\r\n`;
}
