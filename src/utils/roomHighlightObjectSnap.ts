import type { Point2D, RoomProgressItem } from '../types';

/** CAD-style Object Snap (OSNAP), read-only against saved room geometry.
 * Tolerance is measured in screen pixels so it stays consistent through zoom.
 * No existing room is mutated; only an explicitly newly drawn point can snap.
 */
export interface RoomSnapCandidate {
  point: Point2D;
  kind: 'vertex' | 'midpoint';
  roomId: string;
  distancePx: number;
}

export function findRoomObjectSnap(
  point: Point2D,
  rooms: readonly Pick<RoomProgressItem, 'id' | 'x' | 'y' | 'width' | 'height' | 'points' | 'isPolyline'>[],
  viewport: { width: number; height: number },
  options: { tolerancePx?: number; midpoints?: boolean } = {},
): RoomSnapCandidate | null {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const tolerance = Math.max(0, options.tolerancePx ?? 12);
  let best: RoomSnapCandidate | null = null;
  for (const room of rooms) {
    const coordinates: Point2D[] = room.points?.length
      ? room.points
      : [
          { x: room.x, y: room.y },
          { x: room.x + room.width, y: room.y },
          { x: room.x + room.width, y: room.y + room.height },
          { x: room.x, y: room.y + room.height },
        ];
    const consider = (candidate: Point2D, kind: RoomSnapCandidate['kind']) => {
      if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return;
      const distancePx = Math.hypot((candidate.x - point.x) * width / 100, (candidate.y - point.y) * height / 100);
      if (distancePx > tolerance) return;
      // Prefer a vertex over a midpoint at the same screen distance.
      if (!best || distancePx < best.distancePx - 0.01 ||
        (Math.abs(distancePx - best.distancePx) <= 0.01 && kind === 'vertex' && best.kind === 'midpoint')) {
        best = { point: { x: candidate.x, y: candidate.y }, kind, roomId: room.id, distancePx };
      }
    };
    coordinates.forEach((p) => consider(p, 'vertex'));
    if (options.midpoints && coordinates.length >= 2) {
      const segmentCount = room.isPolyline || coordinates.length === 2 ? coordinates.length - 1 : coordinates.length;
      for (let i = 0; i < segmentCount; i++) {
        const a = coordinates[i];
        const b = coordinates[(i + 1) % coordinates.length];
        consider({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'midpoint');
      }
    }
  }
  return best;
}
