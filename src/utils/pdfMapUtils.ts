export interface Point {
  x: number;
  y: number;
}

export interface MapObstacle {
  x: number;
  y: number;
  radius?: number;
}

export interface DefectMapLabelPos {
  x: number;   // exact defect coordinate (0..100)
  y: number;
  lx: number;  // numbered marker / label centre
  ly: number;
  isOffset: boolean;
  showLabel: boolean;
  clusterIndex: number;
  clusterCount: number;
}

export interface RoomMapLabelPos {
  x: number;
  y: number;
  lx: number;
  ly: number;
  isOffset: boolean;
  showLabel: boolean;
}

interface Box {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const boxesOverlap = (a: Box, b: Box, padding = 0): boolean => (
  a.x1 < b.x2 + padding &&
  a.x2 > b.x1 - padding &&
  a.y1 < b.y2 + padding &&
  a.y2 > b.y1 - padding
);

const circleIntersectsBox = (cx: number, cy: number, radius: number, box: Box, padding = 0): boolean => {
  const px = clamp(cx, box.x1, box.x2);
  const py = clamp(cy, box.y1, box.y2);
  return Math.hypot(cx - px, cy - py) < radius + padding;
};

const makeBox = (cx: number, cy: number, width: number, height: number): Box => ({
  x1: cx - width / 2,
  x2: cx + width / 2,
  y1: cy - height / 2,
  y2: cy + height / 2,
});

/**
 * Candidate positions in 8 directions, expanding outward ring-by-ring.
 * This deliberately favours short leader lines while guaranteeing that dense
 * clusters get progressively more room before we give up and fall back to the legend.
 */
const buildCandidateOffsets = (radii: number[]): Array<{ dx: number; dy: number }> => {
  const dirs = [
    { dx: 1, dy: -1 }, { dx: 0, dy: -1 }, { dx: -1, dy: -1 },
    { dx: 1, dy: 0 },                         { dx: -1, dy: 0 },
    { dx: 1, dy: 1 },  { dx: 0, dy: 1 },   { dx: -1, dy: 1 },
  ];

  const out: Array<{ dx: number; dy: number }> = [];
  radii.forEach((radius) => {
    dirs.forEach((dir) => {
      const diag = dir.dx !== 0 && dir.dy !== 0 ? 0.78 : 1;
      out.push({ dx: dir.dx * radius * diag, dy: dir.dy * radius * diag });
    });
  });
  return out;
};

const DEFECT_CANDIDATES = buildCandidateOffsets([3.8, 5.3, 6.8, 8.5, 10.5, 12.5, 14.5]);
const ROOM_CANDIDATES = buildCandidateOffsets([3.8, 5.2, 6.8, 8.5, 10.5, 12.5]);

/**
 * Places the small numbered defect markers without overlapping room-number badges,
 * other defect-number markers or nearby raw defect coordinates.
 *
 * Exact defect coordinates (x/y) never move. If several defects share the same
 * coordinate, their numbered markers fan out around that point and the renderer can
 * draw a single cluster origin marker using clusterIndex/clusterCount.
 */
export function computeDefectLabelPositions<T extends { x: number; y: number; markerCode?: string; displayCode?: string }>(
  defects: T[],
  existingObstacles: MapObstacle[] = [],
  labelScale = 1
): DefectMapLabelPos[] {
  // Collision box follows the selected marker size from the PDF export settings.
  const safeScale = clamp(Number.isFinite(labelScale) ? labelScale : 1, 0.65, 2.2);
  const labelWidth = (defects.length >= 100 ? 5.7 : 5.0) * safeScale;
  const labelHeight = 3.5 * safeScale;
  const placed: Box[] = [];

  const origins = defects.map((d) => ({
    x: clamp(Number.isFinite(d.x) ? d.x : 50, 2.2, 97.8),
    y: clamp(Number.isFinite(d.y) ? d.y : 50, 2.2, 97.8),
  }));

  // Build near-identical-coordinate clusters (within ~1% of drawing size).
  const clusterIds = new Array(defects.length).fill(-1);
  const clusters: number[][] = [];
  for (let i = 0; i < origins.length; i += 1) {
    if (clusterIds[i] >= 0) continue;
    const id = clusters.length;
    const members: number[] = [];
    for (let j = i; j < origins.length; j += 1) {
      if (clusterIds[j] >= 0) continue;
      if (Math.hypot(origins[i].x - origins[j].x, origins[i].y - origins[j].y) <= 1.05) {
        clusterIds[j] = id;
        members.push(j);
      }
    }
    clusters.push(members);
  }

  return defects.map((_, index) => {
    const orig = origins[index];
    const cluster = clusters[clusterIds[index]] || [index];
    const clusterIndex = Math.max(0, cluster.indexOf(index));
    const clusterCount = cluster.length;

    let selected: { lx: number; ly: number; box: Box } | null = null;

    // Rotate candidate preference per item in a cluster so 2-5 defects at one point
    // naturally spread around the coordinate instead of competing for the same corner.
    const rotatedCandidates = DEFECT_CANDIDATES.map((_, i) => (
      DEFECT_CANDIDATES[(i + clusterIndex * 2) % DEFECT_CANDIDATES.length]
    ));

    for (const off of rotatedCandidates) {
      const lx = clamp(orig.x + off.dx, labelWidth / 2 + 0.8, 100 - labelWidth / 2 - 0.8);
      const ly = clamp(orig.y + off.dy, labelHeight / 2 + 0.8, 100 - labelHeight / 2 - 0.8);
      const box = makeBox(lx, ly, labelWidth, labelHeight);

      if (placed.some((p) => boxesOverlap(box, p, 0.5))) continue;

      // Room number badges and any caller-provided obstacles.
      if (existingObstacles.some((o) => circleIntersectsBox(o.x, o.y, o.radius ?? 2.2, box, 0.65))) continue;

      // Do not place a numbered marker over any raw defect point, except its own cluster
      // origin which is expected to be connected by the leader line.
      const hitsOtherOrigin = origins.some((other, otherIndex) => {
        if (clusterIds[otherIndex] === clusterIds[index]) return false;
        return circleIntersectsBox(other.x, other.y, 1.25, box, 0.55);
      });
      if (hitsOtherOrigin) continue;

      selected = { lx, ly, box };
      break;
    }

    // Last-resort local grid search. We prefer dropping the numbered marker (legend-only)
    // over knowingly overlapping another label or clipping the drawing edge.
    if (!selected) {
      for (let radius = 4; radius <= 18 && !selected; radius += 2) {
        for (let angle = 0; angle < 360; angle += 30) {
          const rad = angle * Math.PI / 180;
          const lx = clamp(orig.x + Math.cos(rad) * radius, labelWidth / 2 + 0.8, 100 - labelWidth / 2 - 0.8);
          const ly = clamp(orig.y + Math.sin(rad) * radius, labelHeight / 2 + 0.8, 100 - labelHeight / 2 - 0.8);
          const box = makeBox(lx, ly, labelWidth, labelHeight);
          if (placed.some((p) => boxesOverlap(box, p, 0.45))) continue;
          if (existingObstacles.some((o) => circleIntersectsBox(o.x, o.y, o.radius ?? 2.2, box, 0.55))) continue;
          selected = { lx, ly, box };
          break;
        }
      }
    }

    if (selected) placed.push(selected.box);

    return {
      x: orig.x,
      y: orig.y,
      lx: selected?.lx ?? orig.x,
      ly: selected?.ly ?? orig.y,
      isOffset: !!selected && Math.hypot(selected.lx - orig.x, selected.ly - orig.y) > 1.5,
      showLabel: !!selected,
      clusterIndex,
      clusterCount,
    };
  });
}

/**
 * Places room-number badges while avoiding each other and known defect coordinates.
 * The centroid stays as the room's anchor; only the number badge may be offset.
 */
export function computeRoomLabelPositions<T extends { x?: number; y?: number; width?: number; height?: number; points?: Point[] }>(
  rooms: T[],
  existingObstacles: MapObstacle[] = [],
  labelScale = 1
): RoomMapLabelPos[] {
  // Room numbers are rendered as compact white pills (no "#" on-map).
  // One digit is nearly circular; two/three digits gain only enough width for readability.
  // Collision uses the real pill box instead of the old oversized fixed circle.
  const placed: Box[] = [];

  return rooms.map((r, index) => {
    let minX = typeof r.x === 'number' ? r.x : 10;
    let minY = typeof r.y === 'number' ? r.y : 10;
    let maxX = minX + (r.width || 15);
    let maxY = minY + (r.height || 15);

    if (r.points && r.points.length > 0) {
      minX = Math.min(...r.points.map((p) => p.x));
      maxX = Math.max(...r.points.map((p) => p.x));
      minY = Math.min(...r.points.map((p) => p.y));
      maxY = Math.max(...r.points.map((p) => p.y));
    }

    const roomWidth = Math.max(0.5, maxX - minX);
    const roomHeight = Math.max(0.5, maxY - minY);
    let cx = (minX + maxX) / 2;
    let cy = (minY + maxY) / 2;
    cx = clamp(cx, 1.5, 98.5);
    cy = clamp(cy, 1.5, 98.5);

    const digits = String(index + 1).length;
    const safeScale = clamp(Number.isFinite(labelScale) ? labelScale : 1, 0.65, 2.2);
    const labelWidth = (digits <= 1 ? 1.75 : digits === 2 ? 2.35 : 2.85) * safeScale;
    const labelHeight = 1.70 * safeScale;
    const edgePadX = labelWidth / 2 + 0.55;
    const edgePadY = labelHeight / 2 + 0.55;

    const collides = (x: number, y: number): boolean => {
      const box = makeBox(x, y, labelWidth, labelHeight);
      if (placed.some((p) => boxesOverlap(box, p, 0.48))) return true;
      // Raw Defect origins are protected with extra clearance so a room pill
      // never sits on top of the Defect pin/origin.
      if (existingObstacles.some((o) => circleIntersectsBox(o.x, o.y, o.radius ?? 1.10, box, 0.60))) return true;
      return false;
    };

    // Architectural drawings commonly put text / dimensions near the centre.
    // Prefer quiet in-room zones first: upper-left, upper-right, lower-left,
    // lower-right, then edge-midpoints. Centre is deliberately last.
    const insetX = Math.min(Math.max(roomWidth * 0.22, edgePadX), Math.max(edgePadX, roomWidth / 2));
    const insetY = Math.min(Math.max(roomHeight * 0.22, edgePadY), Math.max(edgePadY, roomHeight / 2));
    const inRoomCandidates = [
      { x: minX + insetX, y: minY + insetY },
      { x: maxX - insetX, y: minY + insetY },
      { x: minX + insetX, y: maxY - insetY },
      { x: maxX - insetX, y: maxY - insetY },
      { x: minX + roomWidth * 0.50, y: minY + insetY },
      { x: minX + insetX, y: minY + roomHeight * 0.50 },
      { x: maxX - insetX, y: minY + roomHeight * 0.50 },
      { x: minX + roomWidth * 0.50, y: maxY - insetY },
      { x: cx, y: cy },
    ].map((p) => ({
      x: clamp(p.x, edgePadX, 100 - edgePadX),
      y: clamp(p.y, edgePadY, 100 - edgePadY),
    }));

    let lx = cx;
    let ly = cy;
    let showLabel = false;
    let usedExternalFallback = false;

    // For normal-sized rooms, stay inside the highlight whenever possible.
    const canFitInside = roomWidth >= labelWidth + 1.0 && roomHeight >= labelHeight + 1.0;
    if (canFitInside) {
      for (const candidate of inRoomCandidates) {
        if (!collides(candidate.x, candidate.y)) {
          lx = candidate.x;
          ly = candidate.y;
          showLabel = true;
          break;
        }
      }
    }

    // Dense/small room: fan out around the room centroid while still avoiding
    // room badges and all Defect origins.
    if (!showLabel) {
      for (const off of ROOM_CANDIDATES) {
        const tx = clamp(cx + off.dx, edgePadX, 100 - edgePadX);
        const ty = clamp(cy + off.dy, edgePadY, 100 - edgePadY);
        if (!collides(tx, ty)) {
          lx = tx;
          ly = ty;
          showLabel = true;
          usedExternalFallback = true;
          break;
        }
      }
    }

    // Last-resort angular search. Prefer legend-only over knowingly overlapping
    // a Defect or another room marker.
    if (!showLabel) {
      for (let radius = 4; radius <= 18 && !showLabel; radius += 2) {
        for (let angle = 0; angle < 360; angle += 30) {
          const rad = angle * Math.PI / 180;
          const tx = clamp(cx + Math.cos(rad) * radius, edgePadX, 100 - edgePadX);
          const ty = clamp(cy + Math.sin(rad) * radius, edgePadY, 100 - edgePadY);
          if (!collides(tx, ty)) {
            lx = tx;
            ly = ty;
            showLabel = true;
            usedExternalFallback = true;
            break;
          }
        }
      }
    }

    if (showLabel) placed.push(makeBox(lx, ly, labelWidth, labelHeight));

    return {
      x: cx,
      y: cy,
      lx,
      ly,
      // Normal in-room corner placement needs no leader line; only collision
      // fallback outside the room gets a leader to keep the drawing clean.
      isOffset: showLabel && usedExternalFallback && Math.hypot(lx - cx, ly - cy) > 1.8,
      showLabel,
    };
  });
}
