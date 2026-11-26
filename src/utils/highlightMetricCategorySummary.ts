/**
 * Live, READ-ONLY calibrated room/category summary. Never changes Firestore,
 * official work quantities, inherited legacy auto modes, or main/sub IDs.
 * A room's default full-zone is a preview, never a persisted Highlight shape.
 */
import type { FloorPlan, HighlightRegionShape, RoomProgressItem, WorkVolume } from '../types';
import { measureHighlightAreaM2, getValidFloorMetricCalibration } from './highlightMetricGeometry.ts';
import { getSavedDirectHighlightShapes, getDirectHighlightCategoryNames, getDirectStageCategory, measureDirectHighlightArea, isDirectPrimaryCategory } from './floorHighlightDirectShapes.ts';

export type CalibratedHighlightRow = {
  id: string;
  category: string;
  target: string;
  categoryName: string;
  label: string;
  savedQuantity?: number;
  storedUnit: string;
  areaM2: number | null;
  source: 'own' | 'main' | 'room';
  autoPolicy: boolean;
  warning?: string;
};
const WHOLE_ROOM: HighlightRegionShape[] = [{ x: 0, y: 0, width: 100, height: 100 }];
const isAreaUnit = (unit: string): boolean => ['m²', 'm2'].includes(unit.trim().toLowerCase().replace(/\s+/g, ''));
const rounded = (number: number): number => Math.round(number * 1000) / 1000;

export function getCalibratedHighlightRows(
  room: RoomProgressItem,
  floor: FloorPlan | undefined,
  image: { width: number; height: number },
  catalog: ReadonlyArray<WorkVolume> = [],
): CalibratedHighlightRow[] {
  if (!floor || !getValidFloorMetricCalibration(floor, image).valid || room.isPolyline || room.width <= 0 || room.height <= 0) return [];
  const rows: CalibratedHighlightRow[] = [];
  for (const category of getDirectHighlightCategoryNames(room)) {
    const item = catalog.find(v => v.id === category || v.title === category);
    const categoryName = item?.title || category;
    const unit = room.categoryVolumeUnits?.[category] || (isDirectPrimaryCategory(room,category) ? room.volumeUnit : undefined) || item?.unit || '';
    const mainShapes = getSavedDirectHighlightShapes(room, category, 'main');
    const mainSource: CalibratedHighlightRow['source'] = mainShapes.length ? 'own' : 'room';
    const mainRegion = mainShapes.length ? mainShapes : WHOLE_ROOM;
    const mainMeasure = measureHighlightAreaM2({ floor, image, room, shapes: mainRegion });
    rows.push({
      id: `${category}:main`, category, target: 'main', categoryName, label: 'Hạng mục chính',
      savedQuantity: room.categoryVolumes?.[category] ?? (isDirectPrimaryCategory(room,category) ? room.workVolume : undefined),
      storedUnit: unit, areaM2: mainMeasure.valid ? rounded(mainMeasure.value) : null,
      source: mainSource, autoPolicy: room.categoryHighlightAutoMode?.[category] === true,
      ...(!isAreaUnit(unit) ? { warning: `ĐVT ${unit}: diện tích chỉ tham khảo, không tự quy đổi.` } : {}),
    });
    for (const stage of room.subItems || []) {
      if (getDirectStageCategory(stage, room) !== category) continue;
      const ownShapes = getSavedDirectHighlightShapes(room, category, stage.id);
      const source: CalibratedHighlightRow['source'] = ownShapes.length ? 'own' : mainShapes.length ? 'main' : 'room';
      // An empty child inherits the main zone, as in RoomHighlightModal, but is
      // not an additional quantity to add to the main category.
      const area = measureDirectHighlightArea(floor,image,room,category,stage.id,ownShapes.length ? ownShapes : mainRegion);
      const storedUnit = stage.volumeUnit || unit;
      rows.push({
        id: `${category}:${stage.id}`, category, target: stage.id, categoryName,
        label: stage.name, savedQuantity: stage.workVolume, storedUnit,
        areaM2: area.valid ? rounded(area.value) : null,
        source, autoPolicy: stage.highlightVolumeMode === 'area',
        ...(!isAreaUnit(storedUnit) ? { warning: `ĐVT ${storedUnit}: diện tích chỉ tham khảo, không tự quy đổi.` } : {}),
      });
    }
  }
  return rows;
}
