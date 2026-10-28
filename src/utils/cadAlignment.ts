import type { Point2D, RoomProgressItem } from '../types';

export interface CadAlignment {
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

export const DEFAULT_CAD_ALIGNMENT: CadAlignment = {
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  rotation: 0,
};

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export const normalizeCadAlignment = (value?: Partial<CadAlignment> | null): CadAlignment => {
  const left = Math.min(99, Math.max(0, Number(value?.left ?? 0) || 0));
  const top = Math.min(99, Math.max(0, Number(value?.top ?? 0) || 0));
  const width = Math.min(100 - left, Math.max(0.1, Number(value?.width ?? 100) || 100));
  const height = Math.min(100 - top, Math.max(0.1, Number(value?.height ?? 100) || 100));
  const rawRotation = Number(value?.rotation ?? 0);
  const rotation: CadAlignment['rotation'] = rawRotation === 90 || rawRotation === 180 || rawRotation === 270 ? rawRotation : 0;
  return { left, top, width, height, rotation };
};

const rotateNormalizedPoint = (point: Point2D, rotation: CadAlignment['rotation']): Point2D => {
  if (rotation === 90) return { x: 100 - point.y, y: point.x };
  if (rotation === 180) return { x: 100 - point.x, y: 100 - point.y };
  if (rotation === 270) return { x: point.y, y: 100 - point.x };
  return point;
};

const unrotateNormalizedPoint = (point: Point2D, rotation: CadAlignment['rotation']): Point2D => {
  if (rotation === 90) return { x: point.y, y: 100 - point.x };
  if (rotation === 180) return { x: 100 - point.x, y: 100 - point.y };
  if (rotation === 270) return { x: 100 - point.y, y: point.x };
  return point;
};

export const mapCadBasePointToAlignment = (point: Point2D, alignmentInput?: Partial<CadAlignment> | null): Point2D => {
  const alignment = normalizeCadAlignment(alignmentInput);
  const rotated = rotateNormalizedPoint(point, alignment.rotation);
  return {
    x: clampPercent(alignment.left + (rotated.x / 100) * alignment.width),
    y: clampPercent(alignment.top + (rotated.y / 100) * alignment.height),
  };
};

export const mapAlignedPointToCadBase = (point: Point2D, alignmentInput?: Partial<CadAlignment> | null): Point2D => {
  const alignment = normalizeCadAlignment(alignmentInput);
  const normalized = {
    x: ((point.x - alignment.left) / Math.max(0.1, alignment.width)) * 100,
    y: ((point.y - alignment.top) / Math.max(0.1, alignment.height)) * 100,
  };
  return unrotateNormalizedPoint(normalized, alignment.rotation);
};

export const remapPointBetweenCadAlignments = (
  point: Point2D,
  previous?: Partial<CadAlignment> | null,
  next?: Partial<CadAlignment> | null,
): Point2D => mapCadBasePointToAlignment(mapAlignedPointToCadBase(point, previous), next);

export const getCadBasePointsForRoom = (room: RoomProgressItem): Point2D[] | null => {
  const source = room.cadSource;
  const extents = source?.extents;
  if (!source || !extents || !Array.isArray(source.rawPoints) || source.rawPoints.length < 2) return null;
  const spanX = Number(extents.maxX) - Number(extents.minX);
  const spanY = Number(extents.maxY) - Number(extents.minY);
  if (!(spanX > 0) || !(spanY > 0)) return null;
  return source.rawPoints.map((point) => ({
    x: ((Number(point.x) - Number(extents.minX)) / spanX) * 100,
    y: ((Number(extents.maxY) - Number(point.y)) / spanY) * 100,
  }));
};

export const rebuildCadRoomForAlignment = (
  room: RoomProgressItem,
  alignmentInput?: Partial<CadAlignment> | null,
): RoomProgressItem => {
  const basePoints = getCadBasePointsForRoom(room);
  if (!basePoints?.length) return room;
  const points = basePoints.map((point) => mapCadBasePointToAlignment(point, alignmentInput));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    ...room,
    x,
    y,
    width: Math.max(0.1, maxX - x),
    height: Math.max(0.1, maxY - y),
    points,
    isPolyline: false,
    updatedAt: Date.now(),
  };
};
