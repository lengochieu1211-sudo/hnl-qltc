/**
 * Optional room-scoped geometry for the advanced highlight editor.
 * Coordinates are percentages of the room's bounding rectangle (0..100),
 * not pixel/floor coordinates. Ordinary room highlighting is unaffected.
 */
import type { Point2D, RoomProgressItem, HighlightRegionRect } from '../types';

const FINITE = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const TOL = 1e-8;
export const WHOLE_ROOM_REGION: HighlightRegionRect = { x: 0, y: 0, width: 100, height: 100 };

export function normalizeHighlightRect(rect: HighlightRegionRect): HighlightRegionRect | null {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(FINITE)) return null;
  const x = Math.max(0, Math.min(100, rect.x));
  const y = Math.max(0, Math.min(100, rect.y));
  const right = Math.max(x, Math.min(100, rect.x + rect.width));
  const bottom = Math.max(y, Math.min(100, rect.y + rect.height));
  return right - x >= 0.2 && bottom - y >= 0.2 ? { x, y, width: right - x, height: bottom - y } : null;
}

const area = (points: Point2D[]): number => Math.abs(points.reduce((sum, point, i) => {
  const next = points[(i + 1) % points.length];
  return sum + point.x * next.y - next.x * point.y;
}, 0)) / 2;

type Axis = 'x' | 'y';
function clipToLine(points: Point2D[], axis: Axis, limit: number, keepGreater: boolean): Point2D[] {
  const output: Point2D[] = [];
  if (!points.length) return output;
  const inside = (p: Point2D) => keepGreater ? p[axis] >= limit - TOL : p[axis] <= limit + TOL;
  for (let i = 0; i < points.length; i++) {
    const first = points[(i + points.length - 1) % points.length];
    const next = points[i];
    const inFirst = inside(first);
    const inNext = inside(next);
    if (inFirst !== inNext) {
      const denominator = next[axis] - first[axis];
      if (Math.abs(denominator) > TOL) {
        const t = (limit - first[axis]) / denominator;
        output.push({ x: first.x + t * (next.x - first.x), y: first.y + t * (next.y - first.y) });
      }
    }
    if (inNext) output.push(next);
  }
  return output;
}
function clippedArea(roomPolygon: Point2D[], rect: HighlightRegionRect): number {
  let p = clipToLine(roomPolygon, 'x', rect.x, true);
  p = clipToLine(p, 'x', rect.x + rect.width, false);
  p = clipToLine(p, 'y', rect.y, true);
  p = clipToLine(p, 'y', rect.y + rect.height, false);
  return p.length < 3 ? 0 : area(p);
}
function rectangleOverlap(a: HighlightRegionRect, b: HighlightRegionRect): HighlightRegionRect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x + TOL && bottom > y + TOL ? { x, y, width: right - x, height: bottom - y } : null;
}
function roomPolygon(room: Pick<RoomProgressItem, 'x' | 'y' | 'width' | 'height' | 'points' | 'isPolyline'>): Point2D[] | null {
  if (room.isPolyline || !FINITE(room.width) || !FINITE(room.height) || room.width <= 0 || room.height <= 0) return null;
  if (!room.points?.length) return [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  if (room.points.length < 3) return null;
  if (!room.points.every(p => FINITE(p.x) && FINITE(p.y))) return null;
  return room.points.map(p => ({ x: ((p.x - room.x) / room.width) * 100, y: ((p.y - room.y) / room.height) * 100 }));
}

/** Counts the UNION of regions, not their sum; overlapping rectangles never double count. */
export function computeSubHighlightAreaRatio(
  room: Pick<RoomProgressItem, 'x' | 'y' | 'width' | 'height' | 'points' | 'isPolyline'>,
  mainRegion: HighlightRegionRect | undefined,
  subRegions: HighlightRegionRect[],
): { valid: boolean; percent: number; ratio: number; reason?: string } {
  const parent = roomPolygon(room);
  if (!parent || area(parent) < TOL) return { valid: false, percent: 0, ratio: 0, reason: 'Vùng phòng không có diện tích hợp lệ.' };
  const main = mainRegion ? normalizeHighlightRect(mainRegion) : WHOLE_ROOM_REGION;
  if (!main) return { valid: false, percent: 0, ratio: 0, reason: 'Vùng chính không hợp lệ.' };
  const mainArea = clippedArea(parent, main);
  if (mainArea < TOL) return { valid: false, percent: 0, ratio: 0, reason: 'Vùng chính không giao với vùng phòng.' };
  const regions = subRegions.slice(0, 24).map(normalizeHighlightRect)
    .filter((rect): rect is HighlightRegionRect => rect !== null)
    .map(rect => rectangleOverlap(rect, main))
    .filter((rect): rect is HighlightRegionRect => rect !== null);
  if (!regions.length) return { valid: true, percent: 0, ratio: 0 };

  const xs = Array.from(new Set([main.x, main.x + main.width, ...regions.flatMap(r => [r.x, r.x + r.width])])).sort((a, b) => a - b);
  const ys = Array.from(new Set([main.y, main.y + main.height, ...regions.flatMap(r => [r.y, r.y + r.height])])).sort((a, b) => a - b);
  let unionArea = 0;
  for (let xi = 0; xi < xs.length - 1; xi++) {
    for (let yi = 0; yi < ys.length - 1; yi++) {
      const x = xs[xi], y = ys[yi], w = xs[xi + 1] - x, h = ys[yi + 1] - y;
      if (w <= TOL || h <= TOL) continue;
      const mx = x + w / 2, my = y + h / 2;
      if (!regions.some(r => mx >= r.x - TOL && mx <= r.x + r.width + TOL && my >= r.y - TOL && my <= r.y + r.height + TOL)) continue;
      unionArea += clippedArea(parent, { x, y, width: w, height: h });
    }
  }
  const ratio = Math.max(0, Math.min(1, unionArea / mainArea));
  return { valid: true, percent: Math.round(ratio * 10000) / 100, ratio };
}

export function isAreaHighlightUnit(unit?: string): boolean {
  return ['m²', 'm2', '㎡', 'sqm'].includes(String(unit || '').trim().toLocaleLowerCase('vi-VN'));
}

export function getSubHighlightFloorRect(room: Pick<RoomProgressItem, 'x' | 'y' | 'width' | 'height'>, rect: HighlightRegionRect): HighlightRegionRect {
  return {
    x: room.x + rect.x * room.width / 100,
    y: room.y + rect.y * room.height / 100,
    width: rect.width * room.width / 100,
    height: rect.height * room.height / 100,
  };
}
