import type { Point2D, RoomProgressItem } from '../types';

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export interface RoomHighlightBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export function getRoomHighlightPoints(room: Pick<RoomProgressItem, 'x' | 'y' | 'width' | 'height' | 'points'>): Point2D[] {
  if (room.points && room.points.length >= 2) return room.points.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
  const x = Number(room.x || 0);
  const y = Number(room.y || 0);
  const width = Math.max(0, Number(room.width || 0));
  const height = Math.max(0, Number(room.height || 0));
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

export function getRoomHighlightBounds(roomOrPoints: Pick<RoomProgressItem, 'x' | 'y' | 'width' | 'height' | 'points'> | Point2D[]): RoomHighlightBounds {
  const points = Array.isArray(roomOrPoints) ? roomOrPoints : getRoomHighlightPoints(roomOrPoints);
  const xs = points.map((point) => Number(point.x));
  const ys = points.map((point) => Number(point.y));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function translateIntoCanvas(points: Point2D[]): Point2D[] {
  if (points.length === 0) return points;
  const bounds = getRoomHighlightBounds(points);
  let dx = 0;
  let dy = 0;
  if (bounds.x < 0) dx = -bounds.x;
  else if (bounds.x + bounds.width > 100) dx = 100 - (bounds.x + bounds.width);
  if (bounds.y < 0) dy = -bounds.y;
  else if (bounds.y + bounds.height > 100) dy = 100 - (bounds.y + bounds.height);
  return points.map((point) => ({ x: round1(point.x + dx), y: round1(point.y + dy) }));
}

function roomWithPoints(room: RoomProgressItem, points: Point2D[]): RoomProgressItem {
  const boundedPoints = translateIntoCanvas(points);
  const bounds = getRoomHighlightBounds(boundedPoints);
  return {
    ...room,
    x: round1(clamp(bounds.x)),
    y: round1(clamp(bounds.y)),
    width: round1(Math.max(0.1, Math.min(100, bounds.width))),
    height: round1(Math.max(0.1, Math.min(100, bounds.height))),
    points: boundedPoints,
    isPolyline: room.points && room.points.length >= 2 ? room.isPolyline : false,
  };
}

export function rotateRoomHighlight(room: RoomProgressItem, degrees: number, aspectRatio = 1): RoomProgressItem {
  const points = getRoomHighlightPoints(room);
  const bounds = getRoomHighlightBounds(points);
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotated = points.map((point) => {
    const dx = (point.x - bounds.cx) * aspect;
    const dy = point.y - bounds.cy;
    return {
      x: bounds.cx + (dx * cos - dy * sin) / aspect,
      y: bounds.cy + (dx * sin + dy * cos),
    };
  });
  return roomWithPoints(room, rotated);
}

export function mirrorRoomHighlight(room: RoomProgressItem, axis: 'horizontal' | 'vertical'): RoomProgressItem {
  const points = getRoomHighlightPoints(room);
  const bounds = getRoomHighlightBounds(points);
  const mirrored = points.map((point) => axis === 'horizontal'
    ? { x: 2 * bounds.cx - point.x, y: point.y }
    : { x: point.x, y: 2 * bounds.cy - point.y });
  return roomWithPoints(room, mirrored);
}

export function resizeRoomHighlightToBounds(
  room: RoomProgressItem,
  bounds: Pick<RoomHighlightBounds, 'x' | 'y' | 'width' | 'height'>,
): RoomProgressItem {
  const points = getRoomHighlightPoints(room);
  const source = getRoomHighlightBounds(points);
  if (source.width <= 0 || source.height <= 0) return room;
  const width = Math.max(0.1, Number(bounds.width || 0.1));
  const height = Math.max(0.1, Number(bounds.height || 0.1));
  const scaled = points.map((point) => ({
    x: Number(bounds.x) + ((point.x - source.x) / source.width) * width,
    y: Number(bounds.y) + ((point.y - source.y) / source.height) * height,
  }));
  return roomWithPoints(room, scaled);
}

export function normalizeRotationDelta(degrees: number): number {
  let normalized = degrees % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized <= -180) normalized += 360;
  return normalized;
}

export function snapRotationDelta(degrees: number, threshold = 5): number {
  const normalized = normalizeRotationDelta(degrees);
  const nearest = Math.round(normalized / 90) * 90;
  return Math.abs(normalized - nearest) <= threshold ? nearest : normalized;
}
