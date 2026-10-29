import type { Point2D } from '../types';

/** Optional pixel-tolerance orthogonal snap for polygon creation / vertex edits.
 * Works in percentage map coordinates, but measures tolerance in actual viewport pixels,
 * so zoom does not change user-visible snap distance. Already-saved geometry is untouched. */
export function snapRoomPointOrthogonal(
  point: Point2D,
  nearby: readonly Point2D[],
  viewport: { width: number; height: number },
  options: { disabled?: boolean; tolerancePx?: number } = {},
): Point2D {
  if (options.disabled || nearby.length === 0) return point;
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const tolerance = Math.max(0, options.tolerancePx ?? 8);
  const x = nearby.map((p) => ({ value: p.x, delta: Math.abs(p.x - point.x) * width / 100, anchor: p }))
    .filter((p) => p.delta <= tolerance).sort((a, b) => a.delta - b.delta)[0];
  const y = nearby.map((p) => ({ value: p.y, delta: Math.abs(p.y - point.y) * height / 100, anchor: p }))
    .filter((p) => p.delta <= tolerance).sort((a, b) => a.delta - b.delta)[0];
  // Avoid snapping a new polygon point onto its existing neighbouring vertex:
  // that would create a zero-length edge or collapse a shape.
  if (x && y && x.anchor === y.anchor) {
    return x.delta <= y.delta ? { ...point, x: x.value } : { ...point, y: y.value };
  }
  return { x: x ? x.value : point.x, y: y ? y.value : point.y };
}
