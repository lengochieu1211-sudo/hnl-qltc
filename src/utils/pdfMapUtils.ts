import { formatFloorName } from './dateFormatter';

export interface Point {
  x: number;
  y: number;
}

export interface DefectMapLabelPos {
  x: number;   // Origin dot X (0..100 percentage) - NEVER MOVES
  y: number;   // Origin dot Y (0..100 percentage) - NEVER MOVES
  lx: number;  // Label center X (0..100 percentage)
  ly: number;  // Label center Y (0..100 percentage)
  isOffset?: boolean;
}

export interface RoomMapLabelPos {
  x: number;   // Geometric centroid X (0..100 percentage)
  y: number;   // Geometric centroid Y (0..100 percentage)
  lx: number;  // Label center X (0..100 percentage)
  ly: number;  // Label center Y (0..100 percentage)
  isOffset: boolean;
}

/**
 * Calculates optimal label offsets for defects to prevent overlapping labels.
 * The origin dot (x, y) stays 100% FIXED at its exact floor plan coordinates.
 */
export function computeDefectLabelPositions<T extends { x: number; y: number; displayCode?: string }>(
  defects: T[],
  existingObstacles: { x: number; y: number; radius?: number }[] = []
): DefectMapLabelPos[] {
  const labelWidth = 8.5;
  const labelHeight = 3.8;

  const candidateOffsets = [
    { dx: 3.2, dy: -2.8 },  // Top-Right
    { dx: -3.2, dy: -2.8 }, // Top-Left
    { dx: 3.2, dy: 2.8 },   // Bottom-Right
    { dx: -3.2, dy: 2.8 },  // Bottom-Left
    { dx: 4.0, dy: 0 },     // Right
    { dx: -4.0, dy: 0 },    // Left
    { dx: 0, dy: -3.5 },    // Top
    { dx: 0, dy: 3.5 },     // Bottom
    { dx: 5.5, dy: -4.5 },  // Farther Top-Right
    { dx: -5.5, dy: -4.5 }, // Farther Top-Left
    { dx: 5.5, dy: 4.5 },   // Farther Bottom-Right
    { dx: -5.5, dy: 4.5 },  // Farther Bottom-Left
    { dx: 6.5, dy: 0 },     // Farther Right
    { dx: -6.5, dy: 0 },    // Farther Left
    { dx: 0, dy: -5.5 },    // Farther Top
    { dx: 0, dy: 5.5 },     // Farther Bottom
    { dx: 7.5, dy: -6.0 },
    { dx: -7.5, dy: -6.0 },
    { dx: 7.5, dy: 6.0 },
    { dx: -7.5, dy: 6.0 },
  ];

  const placedLabels: { lx: number; ly: number; x1: number; x2: number; y1: number; y2: number }[] = [];

  return defects.map((d) => {
    // Ensure raw origin coordinates are bounded 0..100
    const origX = Math.min(98, Math.max(2, typeof d.x === 'number' && !isNaN(d.x) ? d.x : 50));
    const origY = Math.min(98, Math.max(2, typeof d.y === 'number' && !isNaN(d.y) ? d.y : 50));

    let bestLx = origX + 3.8;
    let bestLy = origY - 2.8;
    let minPenalty = Infinity;

    for (const offset of candidateOffsets) {
      let lx = origX + offset.dx;
      let ly = origY + offset.dy;

      lx = Math.min(94, Math.max(6, lx));
      ly = Math.min(94, Math.max(6, ly));

      const x1 = lx - labelWidth / 2;
      const x2 = lx + labelWidth / 2;
      const y1 = ly - labelHeight / 2;
      const y2 = ly + labelHeight / 2;

      let penalty = 0;

      if (lx < 8 || lx > 92) penalty += 12;
      if (ly < 6 || ly > 94) penalty += 12;

      const distSq = (lx - origX) ** 2 + (ly - origY) ** 2;
      penalty += distSq * 0.35;

      for (const placed of placedLabels) {
        const overlapX = Math.max(0, Math.min(x2, placed.x2) - Math.max(x1, placed.x1));
        const overlapY = Math.max(0, Math.min(y2, placed.y2) - Math.max(y1, placed.y1));
        if (overlapX > 0 && overlapY > 0) {
          penalty += overlapX * overlapY * 150;
        }
      }

      for (const obs of existingObstacles) {
        const obsR = obs.radius || 3.0;
        const ox1 = obs.x - obsR;
        const ox2 = obs.x + obsR;
        const oy1 = obs.y - obsR;
        const oy2 = obs.y + obsR;
        const overlapX = Math.max(0, Math.min(x2, ox2) - Math.max(x1, ox1));
        const overlapY = Math.max(0, Math.min(y2, oy2) - Math.max(y1, oy1));
        if (overlapX > 0 && overlapY > 0) {
          penalty += overlapX * overlapY * 180;
        }
      }

      for (const otherDefect of defects) {
        if (otherDefect === d) continue;
        const otherX = typeof otherDefect.x === 'number' ? otherDefect.x : 50;
        const otherY = typeof otherDefect.y === 'number' ? otherDefect.y : 50;
        if (otherX >= x1 && otherX <= x2 && otherY >= y1 && otherY <= y2) {
          penalty += 250;
        }
      }

      if (penalty < minPenalty) {
        minPenalty = penalty;
        bestLx = lx;
        bestLy = ly;
      }
    }

    const finalX1 = bestLx - labelWidth / 2;
    const finalX2 = bestLx + labelWidth / 2;
    const finalY1 = bestLy - labelHeight / 2;
    const finalY2 = bestLy + labelHeight / 2;

    placedLabels.push({ lx: bestLx, ly: bestLy, x1: finalX1, x2: finalX2, y1: finalY1, y2: finalY2 });

    const isOffset = Math.abs(bestLx - origX) > 1.5 || Math.abs(bestLy - origY) > 1.5;

    return {
      x: origX,
      y: origY,
      lx: bestLx,
      ly: bestLy,
      isOffset,
    };
  });
}

/**
 * Calculates centroid and optimal label position for rooms (#1, #2, #3...)
 * If a room is very narrow or small, offsets label outward with leader line.
 */
export function computeRoomLabelPositions<T extends { x?: number; y?: number; width?: number; height?: number; points?: Point[] }>(
  rooms: T[]
): RoomMapLabelPos[] {
  const badgeRadius = 2.4;
  const placedBadges: { lx: number; ly: number; r: number }[] = [];

  return rooms.map((r) => {
    let cx = (typeof r.x === 'number' ? r.x : 10) + (r.width || 15) / 2;
    let cy = (typeof r.y === 'number' ? r.y : 10) + (r.height || 15) / 2;
    let isSmall = (r.width && r.width < 5) || (r.height && r.height < 5);

    if (r.points && r.points.length > 0) {
      cx = r.points.reduce((sum, p) => sum + p.x, 0) / r.points.length;
      cy = r.points.reduce((sum, p) => sum + p.y, 0) / r.points.length;
      const minX = Math.min(...r.points.map(p => p.x));
      const maxX = Math.max(...r.points.map(p => p.x));
      const minY = Math.min(...r.points.map(p => p.y));
      const maxY = Math.max(...r.points.map(p => p.y));
      if ((maxX - minX) < 5 || (maxY - minY) < 5) {
        isSmall = true;
      }
    }

    cx = Math.min(96, Math.max(4, cx));
    cy = Math.min(96, Math.max(4, cy));

    let lx = cx;
    let ly = cy;
    let isOffset = false;

    // Check collision with previously placed badges
    let collision = placedBadges.some(b => {
      const dist = Math.hypot(b.lx - lx, b.ly - ly);
      return dist < (b.r + badgeRadius + 1.0);
    });

    if (collision || isSmall) {
      const offsets = [
        { dx: 3.5, dy: -3.5 },
        { dx: -3.5, dy: -3.5 },
        { dx: 3.5, dy: 3.5 },
        { dx: -3.5, dy: 3.5 },
        { dx: 0, dy: -4.5 },
        { dx: 0, dy: 4.5 },
        { dx: 4.5, dy: 0 },
        { dx: -4.5, dy: 0 },
        { dx: 6.0, dy: -5.0 },
        { dx: -6.0, dy: -5.0 },
      ];

      for (const off of offsets) {
        const testLx = Math.min(96, Math.max(4, cx + off.dx));
        const testLy = Math.min(96, Math.max(4, cy + off.dy));
        const coll = placedBadges.some(b => Math.hypot(b.lx - testLx, b.ly - testLy) < (b.r + badgeRadius + 0.8));
        if (!coll) {
          lx = testLx;
          ly = testLy;
          isOffset = true;
          break;
        }
      }
    }

    placedBadges.push({ lx, ly, r: badgeRadius });

    return {
      x: cx,
      y: cy,
      lx,
      ly,
      isOffset: isOffset || Math.hypot(lx - cx, ly - cy) > 1.8,
    };
  });
}
