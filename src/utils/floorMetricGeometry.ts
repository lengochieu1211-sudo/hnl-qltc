/**
 * Scoped PROD integration of DEV 2026-11-23 two-point calibration mathematics.
 * Pure read-only geometry; never writes an official work quantity.
 * Room points use 0–100% original, unrotated image coordinates.
 */
import type { FloorPlan, FloorMetricCalibration, Point2D, RoomProgressItem } from '../types';

type ImageDimensions = { width: number; height: number };
type RoomOutline = Pick<RoomProgressItem, 'x' | 'y' | 'width' | 'height' | 'points' | 'isPolyline'>;
export type FloorMetricResult = { valid: true; value: number; unit: 'm' | 'm²'; label: string }
  | { valid: false; reason: string };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pointOk = (p: Point2D) => !!p && finite(p.x) && finite(p.y) && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;
const dimensionsOk = (image: ImageDimensions) => Number.isSafeInteger(image.width) && Number.isSafeInteger(image.height) && image.width > 1 && image.height > 1;
const pixel = (point: Point2D, image: ImageDimensions) => ({ x: point.x * image.width / 100, y: point.y * image.height / 100 });
const distance = (a: Point2D, b: Point2D, image: ImageDimensions) => {
  const pa = pixel(a, image), pb = pixel(b, image);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
};

/** Byte-compatible key and parameters from DEV's highlightMetricGeometry.ts. */
export function floorMetricSourceKey(floor: FloorPlan): string {
  const durableSource = floor.imageAssetId || floor.storagePath || floor.cloudFileId || floor.driveFileId;
  const identity = [floor.id, floor.imageRevision ?? '', floor.imageAssetId ?? '', floor.cloudFileId ?? '',
    floor.storagePath ?? '', floor.driveFileId ?? '', floor.uploadedAt ?? '', durableSource ? '' : (floor.imageUrl ?? '')].join('|');
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
  return `${floor.id}:${identity.length}:${(hash >>> 0).toString(16)}`;
}

export function createFloorMetricCalibration(
  floor: FloorPlan, image: ImageDimensions, first: Point2D, second: Point2D, actualMetres: number,
  now = Date.now(),
): FloorMetricCalibration | null {
  if (!floor.id || !floor.imageUrl || !dimensionsOk(image) || !pointOk(first) || !pointOk(second) ||
    !finite(actualMetres) || actualMetres <= 0 || actualMetres > 1_000_000) return null;
  const measuredPx = distance(first, second, image);
  if (measuredPx < 2) return null;
  return {
    floorId: floor.id, sourceKey: floorMetricSourceKey(floor), sourceWidthPx: image.width,
    sourceHeightPx: image.height, first: { ...first }, second: { ...second },
    actualMetres, metresPerPixel: actualMetres / measuredPx, updatedAt: now,
  };
}

export function getValidFloorMetricCalibration(floor: FloorPlan, image: ImageDimensions):
  { valid: true; value: FloorMetricCalibration } | { valid: false; reason: string } {
  const c = floor.highlightMetricCalibration;
  if (!c) return { valid: false, reason: 'Tầng chưa đo tỷ lệ mặt bằng.' };
  if (c.floorId !== floor.id || c.sourceKey !== floorMetricSourceKey(floor) ||
    c.sourceWidthPx !== image.width || c.sourceHeightPx !== image.height) {
    return { valid: false, reason: 'Ảnh mặt bằng hoặc kích thước ảnh nguồn đã thay đổi, cần đo tỷ lệ lại.' };
  }
  const regenerated = createFloorMetricCalibration(floor, image, c.first, c.second, c.actualMetres, c.updatedAt);
  if (!regenerated || !finite(c.metresPerPixel) ||
    Math.abs(c.metresPerPixel / regenerated.metresPerPixel - 1) > 1e-8) {
    return { valid: false, reason: 'Dữ liệu tỷ lệ không hợp lệ, cần đo lại.' };
  }
  return { valid: true, value: c };
}

const closePoint = (a: Point2D, b: Point2D) => Math.abs(a.x - b.x) < 1e-7 && Math.abs(a.y - b.y) < 1e-7;
const cross = (a: Point2D, b: Point2D, c: Point2D) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const segmentsIntersect = (a: Point2D, b: Point2D, c: Point2D, d: Point2D) => {
  const on = (p: Point2D, q: Point2D, r: Point2D) =>
    Math.abs(cross(p, q, r)) < 1e-7 && r.x >= Math.min(p.x,q.x) - 1e-7 && r.x <= Math.max(p.x,q.x) + 1e-7 &&
    r.y >= Math.min(p.y,q.y) - 1e-7 && r.y <= Math.max(p.y,q.y) + 1e-7;
  const ab1 = cross(a, b, c), ab2 = cross(a, b, d), cd1 = cross(c, d, a), cd2 = cross(c, d, b);
  return ((ab1 > 1e-7 && ab2 < -1e-7 || ab1 < -1e-7 && ab2 > 1e-7) &&
    (cd1 > 1e-7 && cd2 < -1e-7 || cd1 < -1e-7 && cd2 > 1e-7)) ||
    on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b);
};

function getOutline(room: RoomOutline): Point2D[] | null {
  if (![room.x, room.y, room.width, room.height].every(finite) ||
    (room.isPolyline ? (room.width < 0 || room.height < 0) : (room.width <= 0 || room.height <= 0)) || room.x < 0 || room.y < 0 ||
    room.x + room.width > 100.000001 || room.y + room.height > 100.000001) return null;
  const corners = room.points?.length ? room.points : [
    { x: room.x, y: room.y }, { x: room.x + room.width, y: room.y },
    { x: room.x + room.width, y: room.y + room.height }, { x: room.x, y: room.y + room.height },
  ];
  if (!corners.length || corners.length > 128 || !corners.every(pointOk)) return null;
  const outline: Point2D[] = [];
  for (const p of corners) if (!outline.length || !closePoint(outline[outline.length-1],p)) outline.push(p);
  if (outline.length > 2 && closePoint(outline[0], outline[outline.length-1])) outline.pop();
  return outline;
}

function validPolygon(points: Point2D[]): boolean {
  if (points.length < 3) return false;
  for (let i=0;i<points.length;i++) for(let j=i+1;j<points.length;j++) {
    if (j===i+1 || (i===0 && j===points.length-1)) continue;
    if (segmentsIntersect(points[i], points[(i+1)%points.length],points[j],points[(j+1)%points.length])) return false;
  }
  return true;
}

/** Live area of the highlighted room footprint, not wall-surface area. */
export function measureRoomHighlightAreaM2(
  floor: FloorPlan | undefined, room: RoomOutline, image?: ImageDimensions,
): FloorMetricResult {
  if (!floor || !image || !dimensionsOk(image)) return { valid:false,reason:'Chưa có ảnh nguồn mặt bằng để tính m².' };
  const calibration = getValidFloorMetricCalibration(floor,image);
  if ('reason' in calibration) return {valid:false,reason:calibration.reason};
  if (room.isPolyline) return {valid:false,reason:'Tuyến hở không có diện tích; dùng Lấy chiều dài.'};
  const points = getOutline(room);
  if (!points || !validPolygon(points)) return {valid:false,reason:'Vùng Highlight không hợp lệ hoặc tự cắt nhau.'};
  const pixels = points.map(p=>pixel(p,image));
  const areaPx2 = Math.abs(pixels.reduce((s,p,i)=>{
    const n = pixels[(i+1)%pixels.length];return s+p.x*n.y-n.x*p.y;
  },0))/2;
  const value = areaPx2 * calibration.value.metresPerPixel ** 2;
  return Number.isFinite(value) && value > 0 ? { valid:true,value,unit:'m²',label:'Diện tích vùng mặt bằng' }
    : {valid:false,reason:'Không tính được diện tích hợp lệ.'};
}

/** An open polyline is a centerline; a closed rectangle/polygon is perimeter. Never conflate with a wall length. */
export function measureRoomHighlightLengthM(
  floor: FloorPlan | undefined, room: RoomOutline, image?: ImageDimensions,
): FloorMetricResult {
  if (!floor || !image || !dimensionsOk(image)) return {valid:false,reason:'Chưa có ảnh nguồn mặt bằng để tính chiều dài.'};
  const calibration = getValidFloorMetricCalibration(floor,image);
  if ('reason' in calibration) return {valid:false,reason:calibration.reason};
  const points = getOutline(room);
  if (!points || points.length < 2 || (!room.isPolyline && !validPolygon(points)))
    return {valid:false,reason:'Vùng hoặc tuyến Highlight không hợp lệ.'};
  let pixels=0;
  for(let i=1;i<points.length;i++) pixels+=distance(points[i-1],points[i],image);
  if(!room.isPolyline) pixels+=distance(points[points.length-1],points[0],image);
  const value=pixels*calibration.value.metresPerPixel;
  return Number.isFinite(value)&&value>0 ? {valid:true,value,unit:'m',label:room.isPolyline?'Chiều dài tuyến hở':'Chu vi vùng kín'}
    :{valid:false,reason:'Không tính được chiều dài hợp lệ.'};
}
