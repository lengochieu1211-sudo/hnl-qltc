import type { Point2D } from '../types';

/** Keyboard shortcuts only; no toolbar UI and no persistent geometry changes. */
export const CAD_GRID_STEP = 10;
export type CadHotkey = 'F3' | 'F7' | 'F8' | 'F9' | 'F10';

export function getCadDrawingHotkey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>): CadHotkey | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null;
  const key = event.key.toUpperCase();
  return key === 'F3' || key === 'F7' || key === 'F8' || key === 'F9' || key === 'F10' ? key : null;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/** Apply only to a NEW point. Object snap is handled first by the caller. */
export function applyCadDrawingGuide(
  point: Point2D,
  anchor: Point2D | null,
  viewport: { width: number; height: number },
  flags: { gridSnap: boolean; ortho: boolean; polar: boolean },
): Point2D {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  let target = { x: point.x, y: point.y };
  if (flags.gridSnap) {
    target = { x: Math.round(target.x / CAD_GRID_STEP) * CAD_GRID_STEP,
      y: Math.round(target.y / CAD_GRID_STEP) * CAD_GRID_STEP };
  }
  if (anchor) {
    const dx = (target.x - anchor.x) * width;
    const dy = (target.y - anchor.y) * height;
    if (flags.ortho) {
      if (Math.abs(dx) >= Math.abs(dy)) target.y = anchor.y;
      else target.x = anchor.x;
    } else if (flags.polar && (dx !== 0 || dy !== 0)) {
      // Match 0°,45°,90°... in SCREEN space, despite stretched floor-plan viewBox.
      const angle = Math.atan2(dy, dx);
      const step = Math.PI / 4;
      const nearest = Math.round(angle / step) * step;
      const delta = Math.atan2(Math.sin(angle - nearest), Math.cos(angle - nearest));
      if (Math.abs(delta) <= 10 * Math.PI / 180) {
        const distance = Math.hypot(dx, dy);
        target = { x: anchor.x + distance * Math.cos(nearest) / width,
          y: anchor.y + distance * Math.sin(nearest) / height };
      }
    }
  }
  return { x: clamp(target.x), y: clamp(target.y) };
}
