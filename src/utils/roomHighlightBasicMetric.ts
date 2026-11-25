import type { FloorPlan, RoomProgressItem, Point2D } from '../types';
import { getValidFloorMetricCalibration, measureHighlightAreaM2, measureHighlightLengthM, type MetricMeasure } from './highlightMetricGeometry.ts';

// Temporary release gate: retain advanced data and implementation, hide advanced entry points.
export const ADVANCED_HIGHLIGHT_ENABLED: boolean = false;
export function getBasicRoomMetricUnit(unit: string): 'm²' | 'm' | 'md' | null {
  const key = unit.trim().toLowerCase().replace(/\s/g, '');
  return key === 'm2' || key === 'm²' ? 'm²' : key === 'm' || key === 'md' ? key : null;
}

/** Use only the existing closed room boundary, never advanced total/main/sub shapes. */
export function measureBasicRoomHighlight(args: {
  floor: FloorPlan; image: { width: number; height: number }; room: RoomProgressItem; unit: string;
}): MetricMeasure {
  const { floor, image, room } = args;
  const invalid = (reason: string): MetricMeasure => ({ valid: false, reason });
  const unit = getBasicRoomMetricUnit(args.unit);
  if (!unit) return invalid('Chỉ hỗ trợ hạng mục chính có ĐVT m², m hoặc md đã xác định.');
  if (room.floorId !== floor.id || room.deletedAt || room.positionLocked || room.inspectionStatus === 'Đạt nghiệm thu')
    return invalid('Phòng không thuộc tầng này, đã khóa, đã xóa hoặc đã nghiệm thu.');
  if (room.isPolyline || ![room.x, room.y, room.width, room.height].every(Number.isFinite) ||
      room.width <= 0 || room.height <= 0 || room.x < 0 || room.y < 0 || room.x + room.width > 100 + 1e-8 || room.y + room.height > 100 + 1e-8)
    return invalid('Cần vùng Highlight căn/phòng khép kín, hợp lệ.');
  const path: Point2D[] = room.points?.length ? room.points : [
    { x: room.x, y: room.y }, { x: room.x + room.width, y: room.y },
    { x: room.x + room.width, y: room.y + room.height }, { x: room.x, y: room.y + room.height },
  ];
  if (path.length < 3 || !path.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
      p.x >= 0 && p.y >= 0 && p.x <= 100 + 1e-8 && p.y <= 100 + 1e-8))
    return invalid('Biên Highlight phòng không hợp lệ.');
  // Validate closed geometry (including self intersections) for both area and perimeter.
  const area = measureHighlightAreaM2({ floor, image, room, shapes: [{ x: 0, y: 0, width: 100, height: 100 }] });
  if (area.valid === false) return area;
  if (unit === 'm²') return area.value > 0 ? area : invalid('Diện tích bằng 0.');
  const calibration = getValidFloorMetricCalibration(floor, image);
  if (calibration.valid === false) return calibration;
  let lengthPx = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[(i + 1) % path.length];
    lengthPx += Math.hypot((a.x - b.x) * image.width / 100, (a.y - b.y) * image.height / 100);
  }
  const value = lengthPx * calibration.value.metresPerPixel;
  return Number.isFinite(value) && value > 0 ? { valid: true, value, unit: 'm' } : invalid('Chu vi không hợp lệ.');
}

/** Explicit source selection; output units are not used to guess the geometry. */
export type BasicRoomQuantitySource = 'area' | 'perimeter' | 'length' | 'linear';
export function measureBasicRoomQuantitySource(args: {
  floor: FloorPlan; image: { width: number; height: number }; room: RoomProgressItem; source: BasicRoomQuantitySource;
}): MetricMeasure {
  const { floor, image, room, source } = args;
  const invalid = (reason: string): MetricMeasure => ({ valid: false, reason });
  if (source === 'linear') return measureBasicRoomQuantitySource({ ...args, source: room.isPolyline ? 'length' : 'perimeter' });
  if (source === 'area' || source === 'perimeter') {
    return measureBasicRoomHighlight({ floor, image, room, unit: source === 'area' ? 'm²' : 'm' });
  }
  if (source !== 'length') return invalid('Nguồn đo không hợp lệ.');
  if (room.floorId !== floor.id || room.deletedAt || room.positionLocked || room.inspectionStatus === 'Đạt nghiệm thu')
    return invalid('Phòng không thuộc tầng này, đã khóa, đã xóa hoặc đã nghiệm thu.');
  if (!room.isPolyline || !room.points || room.points.length < 2)
    return invalid('Chiều dài L chỉ lấy từ tuyến Highlight hở.');
  const first = room.points[0], last = room.points[room.points.length - 1];
  if (!first || !last || (first.x === last.x && first.y === last.y))
    return invalid('Tuyến hở không được trùng điểm đầu và cuối.');
  const result = measureHighlightLengthM({ floor, image, floorPath: room.points });
  return result.valid && (!Number.isFinite(result.value) || result.value <= 0) ? invalid('Chiều dài không hợp lệ.') : result;
}
