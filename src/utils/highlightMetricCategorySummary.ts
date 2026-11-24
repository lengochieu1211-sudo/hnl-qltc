/**
 * Live, READ-ONLY calibrated room/category summary. Never changes Firestore,
 * official work quantities, inherited legacy auto modes, or main/sub IDs.
 * A room's default full-zone is a preview, never a persisted Highlight shape.
 */
import type { FloorPlan, HighlightRegionShape, RoomProgressItem, WorkVolume } from '../types';
import { measureHighlightAreaM2, getValidFloorMetricCalibration } from './highlightMetricGeometry.ts';
import { getSavedDirectHighlightShapes, getDirectHighlightCategoryNames, getDirectStageCategory, getDirectHighlightEffectiveUnit } from './floorHighlightDirectShapes.ts';

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
/** One area policy shared by the live editor and read-only summary. */
export function measureDirectCategoryArea(args: {
  floor: FloorPlan; image: {width:number;height:number}; room: RoomProgressItem;
  category: string; target: string; shapes?: HighlightRegionShape[];
}) {
  const { floor, image, room, category, target } = args;
  const main = getSavedDirectHighlightShapes(room, category, 'main');
  const own = args.shapes ?? getSavedDirectHighlightShapes(room, category, target);
  return measureHighlightAreaM2({floor,image,room,
    shapes: own.length ? own : (target !== 'main' && main.length ? main : WHOLE_ROOM),
    ...(target !== 'main' && own.length && main.length ? {clipToMain:main} : {}),
  });
}
const unitWarning = (unit:string) => unit ? `ĐVT ${unit}: diện tích chỉ tham khảo, không tự quy đổi.` : 'Chưa xác định ĐVT: diện tích chỉ tham khảo, không tự quy đổi.';
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
    const unit = getDirectHighlightEffectiveUnit(room, category, 'main');
    const mainShapes = getSavedDirectHighlightShapes(room, category, 'main');
    const mainSource: CalibratedHighlightRow['source'] = mainShapes.length ? 'own' : 'room';
    const mainMeasure = measureDirectCategoryArea({floor,image,room,category,target:'main'});
    rows.push({
      id: `${category}:main`, category, target: 'main', categoryName, label: 'Hạng mục chính',
      savedQuantity: room.categoryVolumes?.[category] ?? (room.workCategory === category ? room.workVolume : undefined),
      storedUnit: unit, areaM2: mainMeasure.valid ? rounded(mainMeasure.value) : null,
      source: mainSource, autoPolicy: room.categoryHighlightAutoMode?.[category] === true,
      ...(!isAreaUnit(unit) ? { warning: unitWarning(unit) } : {}),
    });
    for (const stage of room.subItems || []) {
      if (getDirectStageCategory(stage, room) !== category) continue;
      const ownShapes = getSavedDirectHighlightShapes(room, category, stage.id);
      const source: CalibratedHighlightRow['source'] = ownShapes.length ? 'own' : mainShapes.length ? 'main' : 'room';
      // An empty child inherits the main zone, as in RoomHighlightModal, but is
      // not an additional quantity to add to the main category.
      const area = measureDirectCategoryArea({floor,image,room,category,target:stage.id});
      const storedUnit = getDirectHighlightEffectiveUnit(room, category, stage.id);
      rows.push({
        id: `${category}:${stage.id}`, category, target: stage.id, categoryName,
        label: stage.name, savedQuantity: stage.workVolume, storedUnit,
        areaM2: area.valid ? rounded(area.value) : null,
        source, autoPolicy: stage.highlightVolumeMode === 'area',
        ...(!isAreaUnit(storedUnit) ? { warning: unitWarning(storedUnit) } : {}),
      });
    }
  }
  return rows;
}
