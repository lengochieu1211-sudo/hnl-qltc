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
  existingObstacles: MapObstacle[] = []
): DefectMapLabelPos[] {
  // The map only renders a short sequence number (01/02/03), not the long defect name.
  // Keep the collision rectangle deliberately compact.
  const labelWidth = defects.length >= 100 ? 5.7 : 5.0;
  const labelHeight = 3.5;
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
  existingObstacles: MapObstacle[] = []
): RoomMapLabelPos[] {
  const badgeRadius = 1.85;
  const placed: Array<{ x: number; y: number; radius: number }> = [];

  return rooms.map((r) => {
    let cx = (typeof r.x === 'number' ? r.x : 10) + (r.width || 15) / 2;
    let cy = (typeof r.y === 'number' ? r.y : 10) + (r.height || 15) / 2;
    let isSmall = !!((r.width && r.width < 5) || (r.height && r.height < 5));

    if (r.points && r.points.length > 0) {
      cx = r.points.reduce((sum, p) => sum + p.x, 0) / r.points.length;
      cy = r.points.reduce((sum, p) => sum + p.y, 0) / r.points.length;
      const minX = Math.min(...r.points.map((p) => p.x));
      const maxX = Math.max(...r.points.map((p) => p.x));
      const minY = Math.min(...r.points.map((p) => p.y));
      const maxY = Math.max(...r.points.map((p) => p.y));
      if ((maxX - minX) < 5 || (maxY - minY) < 5) isSmall = true;
    }

    cx = clamp(cx, 2.2, 97.8);
    cy = clamp(cy, 2.2, 97.8);

    const collides = (x: number, y: number) => {
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.radius + badgeRadius + 0.7)) return true;
      if (existingObstacles.some((o) => Math.hypot(o.x - x, o.y - y) < (o.radius ?? 1.3) + badgeRadius + 0.65)) return true;
      return false;
    };

    let lx = cx;
    let ly = cy;
    let isOffset = false;
    let showLabel = true;

    if (isSmall || collides(lx, ly)) {
      let found = false;
      for (const off of ROOM_CANDIDATES) {
        const tx = clamp(cx + off.dx, badgeRadius + 0.7, 100 - badgeRadius - 0.7);
        const ty = clamp(cy + off.dy, badgeRadius + 0.7, 100 - badgeRadius - 0.7);
        if (!collides(tx, ty)) {
          lx = tx;
          ly = ty;
          isOffset = true;
          found = true;
          break;
        }
      }
      if (!found && collides(lx, ly)) {
        // Do not knowingly overlap. Room name remains available in the legend table.
        showLabel = false;
      }
    }

    if (showLabel) placed.push({ x: lx, y: ly, radius: badgeRadius });

    return {
      x: cx,
      y: cy,
      lx,
      ly,
      isOffset: showLabel && (isOffset || Math.hypot(lx - cx, ly - cy) > 1.8),
      showLabel,
    };
  });
}
