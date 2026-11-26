/**
 * HNL QLTC DEV — Cách 2: image-source calibration and measured highlight quantities.
 * Pure calculations ONLY: no Firestore writes, migrations or workVolume replacement.
 * Geometry is stored as percentages of the original, unrotated floor image.
 */
import type { FloorPlan, FloorMetricCalibration, Point2D, HighlightRegionShape, RoomProgressItem } from '../types';
import { calculateHighlightTotalRatio } from './highlightTotalGeometry.ts';

type ImageDimensions = { width: number; height: number };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inFloor = (p: Point2D): boolean => !!p && finite(p.x) && finite(p.y) && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;

/** Stable enough to detect a changed binary without embedding data: URLs in Firestore. */
export function floorMetricSourceKey(floor: FloorPlan): string {
  const durableSource = floor.imageAssetId || floor.storagePath || floor.cloudFileId || floor.driveFileId;
  const identity = [floor.id, floor.imageRevision ?? '', floor.imageAssetId ?? '', floor.cloudFileId ?? '',
    floor.storagePath ?? '', floor.driveFileId ?? '', floor.uploadedAt ?? '', durableSource ? '' : (floor.imageUrl ?? '')].join('|');
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) {
    hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
  }
  return `${floor.id}:${identity.length}:${(hash >>> 0).toString(16)}`;
}

const pointDistancePx = (a: Point2D, b: Point2D, image: ImageDimensions) =>
  Math.hypot((b.x - a.x) * image.width / 100, (b.y - a.y) * image.height / 100);

export function createFloorMetricCalibration(
  floor: FloorPlan, image: ImageDimensions, first: Point2D, second: Point2D, actualMetres: number,
  now = Date.now(),
): FloorMetricCalibration | null {
  if (floor.imageOfflineStale || !floor.id || !floor.imageUrl || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) ||
    image.width <= 1 || image.height <= 1 || !inFloor(first) || !inFloor(second) ||
    !finite(actualMetres) || actualMetres <= 0 || actualMetres > 1_000_000) return null;
  const measuredPx = pointDistancePx(first, second, image);
  if (measuredPx < 2) return null;
  return {
    floorId: floor.id, sourceKey: floorMetricSourceKey(floor), sourceWidthPx: image.width,
    sourceHeightPx: image.height, first: { ...first }, second: { ...second },
    actualMetres, metresPerPixel: actualMetres / measuredPx, updatedAt: now,
  };
}

/** Fail closed for replaced photos, changed revisions and incompatible source dimensions. */
export function getValidFloorMetricCalibration(
  floor: FloorPlan, image: ImageDimensions,
): { valid: true; value: FloorMetricCalibration } | { valid: false; reason: string } {
  if (floor.imageOfflineStale) return { valid: false, reason: 'Ảnh mặt bằng offline đã lỗi thời; cần đồng bộ đúng ảnh trước khi đo.' };
  const c = floor.highlightMetricCalibration;
  if (!c) return { valid: false, reason: 'Mặt bằng chưa hiệu chuẩn tỷ lệ.' };
  if (c.floorId !== floor.id || c.sourceKey !== floorMetricSourceKey(floor) ||
    c.sourceWidthPx !== image.width || c.sourceHeightPx !== image.height) {
    return { valid: false, reason: 'Ảnh mặt bằng đã thay đổi hoặc kích thước nguồn khác; cần hiệu chuẩn lại.' };
  }
  const same = createFloorMetricCalibration(floor, image, c.first, c.second, c.actualMetres, c.updatedAt);
  if (!same || !finite(c.metresPerPixel) || Math.abs(c.metresPerPixel / same.metresPerPixel - 1) > 1e-8) {
    return { valid: false, reason: 'Dữ liệu hiệu chuẩn không hợp lệ; cần hiệu chuẩn lại.' };
  }
  return { valid: true, value: c };
}

type RoomBounds = Pick<RoomProgressItem, 'x' | 'y' | 'width' | 'height' | 'points' | 'isPolyline'>;
export type MetricMeasure = { valid: true; value: number; unit: 'm' | 'm²' } | { valid: false; reason: string };

/** Area = union(shapes) ∩ room ∩ optional-main, never the historical TOTAL region. */
export function measureHighlightAreaM2(args: {
  floor: FloorPlan; image: ImageDimensions; room: RoomBounds;
  shapes: HighlightRegionShape[]; clipToMain?: HighlightRegionShape[];
}): MetricMeasure {
  const calibration = getValidFloorMetricCalibration(args.floor, args.image);
  if ('reason' in calibration) return { valid: false, reason: calibration.reason };
  if (!args.shapes?.length) return { valid: false, reason: 'Chưa vẽ vùng cần đo.' };
  const calc = calculateHighlightTotalRatio({ room: args.room, main: args.shapes, sub: args.clipToMain?.length ? args.clipToMain : undefined });
  if (!calc.valid) return { valid: false, reason: calc.reason || 'Vùng vẽ không hợp lệ.' };
  // coveredArea is in room-local percent²; scale to original image pixels².
  const pixelArea = calc.coveredArea / 10000 *
    (args.room.width / 100 * args.image.width) * (args.room.height / 100 * args.image.height);
  const squareMetres = pixelArea * calibration.value.metresPerPixel ** 2;
  return Number.isFinite(squareMetres) && squareMetres >= 0
    ? { valid: true, value: squareMetres, unit: 'm²' }
    : { valid: false, reason: 'Diện tích đo không hợp lệ.' };
}

/** Explicit open line from two or more floor-coordinate points. NEVER infer wall length from a room's area. */
export function measureHighlightLengthM(args: {
  floor: FloorPlan; image: ImageDimensions; floorPath: Point2D[];
}): MetricMeasure {
  const calibration = getValidFloorMetricCalibration(args.floor, args.image);
  if ('reason' in calibration) return { valid: false, reason: calibration.reason };
  if (!Array.isArray(args.floorPath) || args.floorPath.length < 2 || args.floorPath.length > 128 ||
    !args.floorPath.every(inFloor)) return { valid: false, reason: 'Tuyến đo m không hợp lệ.' };
  let distancePx = 0;
  for (let i = 1; i < args.floorPath.length; i++) distancePx += pointDistancePx(args.floorPath[i - 1], args.floorPath[i], args.image);
  return distancePx >= 2 ? { valid: true, value: distancePx * calibration.value.metresPerPixel, unit: 'm' }
    : { valid: false, reason: 'Đoạn đo quá ngắn.' };
}

/** Only explicit wall height/faces/openings give wall m²; never use floor-slab m². */
export function measureWallAreaM2(lengthMetres: number, heightMetres: number, faces: number, openingsM2: number): MetricMeasure {
  if (![lengthMetres, heightMetres, faces, openingsM2].every(finite) ||
    lengthMetres <= 0 || heightMetres <= 0 || !Number.isSafeInteger(faces) || faces < 1 || faces > 4 || openingsM2 < 0 ||
    openingsM2 > lengthMetres * heightMetres * faces) return { valid: false, reason: 'Chiều dài/cao, số mặt hoặc diện tích ô trống không hợp lệ.' };
  return { valid: true, value: lengthMetres * heightMetres * faces - openingsM2, unit: 'm²' };
}
