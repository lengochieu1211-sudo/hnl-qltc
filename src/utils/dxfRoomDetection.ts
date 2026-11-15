export interface DxfPoint {
  x: number;
  y: number;
}

export interface DxfRoomCandidate {
  id: string;
  roomName: string;
  layer: string;
  source: 'HATCH' | 'LWPOLYLINE';
  x: number;
  y: number;
  width: number;
  height: number;
  points: DxfPoint[];
  rawPoints: DxfPoint[];
  areaDrawingUnits: number;
  areaM2?: number;
  drawingUnitLabel: string;
  hasDetectedName: boolean;
  textType?: 'TEXT' | 'MTEXT';
  confidence: number;
  selected: boolean;
}

export interface DxfRoomDetectionResult {
  candidates: DxfRoomCandidate[];
  unitCode: number;
  unitLabel: string;
  warnings: string[];
  extents?: { minX: number; minY: number; maxX: number; maxY: number };
}

interface DxfPair {
  code: number;
  value: string;
}

interface RawText {
  text: string;
  type: 'TEXT' | 'MTEXT';
  layer: string;
  x: number;
  y: number;
}

interface RawShape {
  source: 'HATCH' | 'LWPOLYLINE';
  layer: string;
  points: DxfPoint[];
  holes?: DxfPoint[][];
  areaDrawingUnits?: number;
}

const round4 = (value: number) => Math.round(value * 10000) / 10000;

const toPairs = (input: string): DxfPair[] => {
  const normalized = String(input || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
  if (/AutoCAD Binary DXF/i.test(normalized.slice(0, 80))) {
    throw new Error('DXF nhị phân chưa được hỗ trợ. Hãy Save As DXF ASCII (R2013/R2018) rồi thử lại.');
  }
  const lines = normalized.split('\n');
  const pairs: DxfPair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) continue;
    pairs.push({ code, value: lines[i + 1].trim() });
  }
  return pairs;
};

const getNumber = (pairs: DxfPair[], code: number, fallback = 0) => {
  const found = pairs.find((pair) => pair.code === code);
  const value = found ? Number(found.value) : NaN;
  return Number.isFinite(value) ? value : fallback;
};

const getString = (pairs: DxfPair[], code: number, fallback = '') =>
  pairs.find((pair) => pair.code === code)?.value || fallback;

const polygonArea = (points: DxfPoint[]) => {
  if (points.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    twice += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twice) / 2;
};

const polygonCentroid = (points: DxfPoint[]) => {
  if (!points.length) return { x: 0, y: 0 };
  const area = polygonArea(points);
  if (area <= 0) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }
  let factorSum = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const factor = current.x * next.y - next.x * current.y;
    factorSum += factor;
    cx += (current.x + next.x) * factor;
    cy += (current.y + next.y) * factor;
  }
  if (Math.abs(factorSum) < 1e-9) return points[0];
  return { x: cx / (3 * factorSum), y: cy / (3 * factorSum) };
};

const pointInPolygon = (point: DxfPoint, polygon: DxfPoint[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersect = ((pi.y > point.y) !== (pj.y > point.y))
      && (point.x < (pj.x - pi.x) * (point.y - pi.y) / ((pj.y - pi.y) || Number.EPSILON) + pi.x);
    if (intersect) inside = !inside;
  }
  return inside;
};

const cleanDxfText = (value: string) =>
  String(value || '')
    .replace(/\\P/g, ' ')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const readInsUnits = (pairs: DxfPair[]) => {
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code === 9 && pairs[i].value.toUpperCase() === '$INSUNITS') {
      for (let j = i + 1; j < Math.min(pairs.length, i + 8); j++) {
        if (pairs[j].code === 70) {
          const unitCode = Number(pairs[j].value);
          return Number.isFinite(unitCode) ? unitCode : 0;
        }
        if (pairs[j].code === 9 || pairs[j].code === 0) break;
      }
    }
  }
  return 0;
};

const readHeaderPoint = (pairs: DxfPair[], variable: '$EXTMIN' | '$EXTMAX'): DxfPoint | undefined => {
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code !== 9 || pairs[i].value.toUpperCase() !== variable) continue;
    let x: number | undefined;
    let y: number | undefined;
    for (let j = i + 1; j < Math.min(pairs.length, i + 12); j++) {
      if (pairs[j].code === 9 || pairs[j].code === 0) break;
      if (pairs[j].code === 10) {
        const value = Number(pairs[j].value);
        if (Number.isFinite(value)) x = value;
      } else if (pairs[j].code === 20) {
        const value = Number(pairs[j].value);
        if (Number.isFinite(value)) y = value;
      }
    }
    if (x !== undefined && y !== undefined) return { x, y };
  }
  return undefined;
};

const extractEntitiesSection = (pairs: DxfPair[]): DxfPair[] => {
  let inEntities = false;
  const result: DxfPair[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (!inEntities && pair.code === 0 && pair.value.toUpperCase() === 'SECTION') {
      const namePair = pairs[i + 1];
      if (namePair?.code === 2 && namePair.value.toUpperCase() === 'ENTITIES') {
        inEntities = true;
        result.push(pair, namePair);
        i += 1;
        continue;
      }
    }
    if (inEntities && pair.code === 0 && pair.value.toUpperCase() === 'ENDSEC') {
      result.push(pair);
      break;
    }
    if (inEntities) result.push(pair);
  }
  return result.length ? result : pairs;
};

const unitInfo = (unitCode: number): { label: string; meterFactor?: number } => {
  switch (unitCode) {
    case 1: return { label: 'inch', meterFactor: 0.0254 };
    case 2: return { label: 'ft', meterFactor: 0.3048 };
    case 4: return { label: 'mm', meterFactor: 0.001 };
    case 5: return { label: 'cm', meterFactor: 0.01 };
    case 6: return { label: 'm', meterFactor: 1 };
    case 10: return { label: 'yard', meterFactor: 0.9144 };
    case 14: return { label: 'dm', meterFactor: 0.1 };
    default: return { label: unitCode === 0 ? 'unitless' : `INSUNITS ${unitCode}` };
  }
};

const collectEntities = (pairs: DxfPair[]) => {
  const entities: Array<{ type: string; pairs: DxfPair[] }> = [];
  let current: { type: string; pairs: DxfPair[] } | null = null;
  pairs.forEach((pair) => {
    if (pair.code === 0) {
      if (current) entities.push(current);
      current = { type: pair.value.toUpperCase(), pairs: [] };
    } else if (current) {
      current.pairs.push(pair);
    }
  });
  if (current) entities.push(current);
  return entities;
};

const readTexts = (entities: Array<{ type: string; pairs: DxfPair[] }>): RawText[] => {
  const rows: RawText[] = [];
  entities.forEach((entity) => {
    if (entity.type !== 'TEXT' && entity.type !== 'MTEXT') return;
    let x = getNumber(entity.pairs, 10, NaN);
    let y = getNumber(entity.pairs, 20, NaN);
    if (entity.type === 'TEXT') {
      const horizontalJustification = getNumber(entity.pairs, 72, 0);
      const verticalJustification = getNumber(entity.pairs, 73, 0);
      if (horizontalJustification !== 0 || verticalJustification !== 0) {
        const alignedX = getNumber(entity.pairs, 11, NaN);
        const alignedY = getNumber(entity.pairs, 21, NaN);
        if (Number.isFinite(alignedX) && Number.isFinite(alignedY)) {
          x = alignedX;
          y = alignedY;
        }
      }
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const text = entity.type === 'MTEXT'
      ? cleanDxfText(entity.pairs.filter((pair) => pair.code === 3 || pair.code === 1).map((pair) => pair.value).join(''))
      : cleanDxfText(getString(entity.pairs, 1));
    if (!text) return;
    rows.push({
      text,
      type: entity.type as 'TEXT' | 'MTEXT',
      layer: getString(entity.pairs, 8),
      x,
      y,
    });
  });
  return rows;
};

const readLwPolyline = (entityPairs: DxfPair[]): DxfPoint[] => {
  const flag = getNumber(entityPairs, 70, 0);
  // Bulge denotes an arc segment; its straight chord is not the true room
  // boundary. Reject rather than write a wrong area into room progress.
  if ((flag & 1) !== 1 || entityPairs.some((pair) => pair.code === 42 && (!Number.isFinite(Number(pair.value)) || Math.abs(Number(pair.value)) > 1e-9))) return [];
  const points: DxfPoint[] = [];
  let x: number | undefined;
  entityPairs.forEach((pair) => {
    if (pair.code === 10) {
      const value = Number(pair.value);
      x = Number.isFinite(value) ? value : undefined;
    } else if (pair.code === 20 && x !== undefined) {
      const y = Number(pair.value);
      if (Number.isFinite(y)) points.push({ x, y });
      x = undefined;
    }
  });
  return points.length >= 3 ? points : [];
};

const readHatchBoundaryPath = (pathPairs: DxfPair[]): DxfPoint[] => {
  const flags = Number(pathPairs.find((pair) => pair.code === 92)?.value);
  if (!Number.isFinite(flags)) return [];

  if ((flags & 2) === 2) {
    const countIndex = pathPairs.findIndex((pair) => pair.code === 93);
    const vertexCount = countIndex >= 0 ? Number(pathPairs[countIndex].value) || 0 : 0;
    if (vertexCount <= 0) return [];
    const points: DxfPoint[] = [];
    let x: number | undefined;
    for (let i = countIndex + 1; i < pathPairs.length && points.length < vertexCount; i++) {
      const pair = pathPairs[i];
      if (pair.code === 10) {
        const value = Number(pair.value);
        x = Number.isFinite(value) ? value : undefined;
      } else if (pair.code === 20 && x !== undefined) {
        const y = Number(pair.value);
        if (Number.isFinite(y)) points.push({ x, y });
        x = undefined;
      }
    }
    return points.length >= 3 ? points : [];
  }

  // Edge-list fallback: only straight line edges are accepted. Curves/splines are
  // deliberately rejected rather than approximated into a wrong room polygon.
  const countIndex = pathPairs.findIndex((pair) => pair.code === 93);
  const edgeCount = countIndex >= 0 ? Number(pathPairs[countIndex].value) || 0 : 0;
  if (edgeCount <= 0) return [];
  const points: DxfPoint[] = [];
  let cursor = countIndex + 1;
  for (let edge = 0; edge < edgeCount && cursor < pathPairs.length; edge++) {
    while (cursor < pathPairs.length && pathPairs[cursor].code !== 72) cursor++;
    if (cursor >= pathPairs.length) return [];
    const edgeType = Number(pathPairs[cursor].value);
    cursor++;
    if (edgeType !== 1) return [];
    let x1: number | undefined;
    let y1: number | undefined;
    let x2: number | undefined;
    let y2: number | undefined;
    while (cursor < pathPairs.length && pathPairs[cursor].code !== 72) {
      const pair = pathPairs[cursor];
      if (pair.code === 10) x1 = Number(pair.value);
      else if (pair.code === 20) y1 = Number(pair.value);
      else if (pair.code === 11) x2 = Number(pair.value);
      else if (pair.code === 21) y2 = Number(pair.value);
      cursor++;
    }
    if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) return [];
    if (!points.length) points.push({ x: x1!, y: y1! });
    points.push({ x: x2!, y: y2! });
  }
  return points.length >= 3 ? points : [];
};

const readHatchBoundaryShapes = (entityPairs: DxfPair[]) => {
  const pathStarts = entityPairs
    .map((pair, index) => pair.code === 92 ? index : -1)
    .filter((index) => index >= 0);
  const loops: DxfPoint[][] = [];
  let unsupportedPathCount = 0;
  pathStarts.forEach((start, index) => {
    const end = pathStarts[index + 1] ?? entityPairs.length;
    const points = readHatchBoundaryPath(entityPairs.slice(start, end));
    if (points.length >= 3) loops.push(points);
    else unsupportedPathCount++;
  });

  const meta = loops.map((points, index) => ({
    index,
    points,
    area: polygonArea(points),
    centroid: polygonCentroid(points),
    parent: -1,
    depth: 0,
  }));
  meta.forEach((item) => {
    let parent = -1;
    let parentArea = Number.POSITIVE_INFINITY;
    meta.forEach((candidate) => {
      if (candidate.index === item.index || candidate.area <= item.area) return;
      if (!pointInPolygon(item.centroid, candidate.points)) return;
      if (candidate.area < parentArea) {
        parent = candidate.index;
        parentArea = candidate.area;
      }
    });
    item.parent = parent;
  });
  const depthOf = (index: number): number => {
    let depth = 0;
    let cursor = meta[index]?.parent ?? -1;
    const seen = new Set<number>();
    while (cursor >= 0 && !seen.has(cursor)) {
      seen.add(cursor);
      depth++;
      cursor = meta[cursor]?.parent ?? -1;
    }
    return depth;
  };
  meta.forEach((item) => { item.depth = depthOf(item.index); });
  const rootOf = (index: number): number => {
    let cursor = index;
    const seen = new Set<number>();
    while (meta[cursor]?.parent >= 0 && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = meta[cursor].parent;
    }
    return cursor;
  };

  const boundaries = meta
    .filter((item) => item.depth === 0)
    .map((outer) => {
      const descendants = meta.filter((item) => rootOf(item.index) === outer.index);
      const areaDrawingUnits = descendants.reduce(
        (sum, item) => sum + (item.depth % 2 === 0 ? item.area : -item.area),
        0
      );
      const holes = descendants.filter((item) => item.depth % 2 === 1).map((item) => item.points);
      return {
        points: outer.points,
        holes,
        // All nested contours (including an island within a hole) must
        // contribute to perimeter measurement even when area alternates sign.
        loops: descendants.map((item) => item.points),
        areaDrawingUnits: Math.max(0, areaDrawingUnits),
      };
    });

  return {
    boundaries,
    unsupportedPathCount,
    innerLoopCount: meta.filter((item) => item.depth > 0).length,
  };
};

const readShapes = (entities: Array<{ type: string; pairs: DxfPair[] }>, warnings: string[]): RawShape[] => {
  const shapes: RawShape[] = [];
  entities.forEach((entity) => {
    if (entity.type === 'HATCH') {
      const parsed = readHatchBoundaryShapes(entity.pairs);
      const layer = getString(entity.pairs, 8);
      const unsafeBoundary = parsed.unsupportedPathCount > 0
        || entity.pairs.some((pair) => pair.code === 42 && (!Number.isFinite(Number(pair.value)) || Math.abs(Number(pair.value)) > 1e-9))
        || parsed.boundaries.some((boundary) => boundary.loops.some((loop) => !quantityIsSimpleBoundary(loop)));
      if (unsafeBoundary) {
        warnings.push(`Bỏ qua toàn bộ HATCH layer “${layer || '(không tên)'}”: có biên cong, tự cắt hoặc không đầy đủ; tránh ghi sai diện tích Căn / Phòng.`);
        return;
      }
      parsed.boundaries.forEach((boundary) => {
        shapes.push({
          source: 'HATCH',
          layer,
          points: boundary.points,
          holes: boundary.holes,
          areaDrawingUnits: boundary.areaDrawingUnits,
        });
      });
      if (parsed.unsupportedPathCount > 0) {
        warnings.push(`HATCH layer “${layer || '(không tên)'}” có ${parsed.unsupportedPathCount} boundary cung/spline hoặc không đọc được; hệ thống không dùng HATCH này để tránh sai diện tích.`);
      }
      if (parsed.innerLoopCount > 0) {
        warnings.push(`HATCH layer “${layer || '(không tên)'}” có ${parsed.innerLoopCount} island/hole; diện tích đã trừ phần rỗng, highlight dùng boundary ngoài để bạn kiểm tra trước khi lưu.`);
      }
      if (parsed.boundaries.length === 0) {
        warnings.push(`Bỏ qua HATCH layer “${layer || '(không tên)'}”: không có boundary polygon/line kín đọc an toàn.`);
      }
    }
  });
  entities.forEach((entity) => {
    if (entity.type !== 'LWPOLYLINE') return;
    const points = readLwPolyline(entity.pairs);
    if (points.length < 3) return;
    const layer = getString(entity.pairs, 8);
    if (!quantityIsSimpleBoundary(points)) {
      warnings.push(`Bỏ qua polyline kín layer “${layer || '(không tên)'}”: biên tự cắt hoặc không hợp lệ; cần kiểm tra AutoCAD.`);
      return;
    }
    const centroid = polygonCentroid(points);
    const area = polygonArea(points);
    const duplicate = shapes.some((shape) => {
      const otherCentroid = polygonCentroid(shape.points);
      const otherArea = polygonArea(shape.points);
      const scale = Math.max(1, Math.sqrt(Math.max(area, otherArea)));
      return Math.abs(area - otherArea) / Math.max(area, otherArea, 1) < 0.01
        && Math.hypot(centroid.x - otherCentroid.x, centroid.y - otherCentroid.y) < scale * 0.01;
    });
    if (!duplicate) shapes.push({ source: 'LWPOLYLINE', layer, points });
  });
  return shapes;
};

export function detectRoomsFromDxf(input: string): DxfRoomDetectionResult {
  const pairs = toPairs(input);
  if (pairs.length < 10) throw new Error('DXF quá ngắn hoặc không đúng định dạng ASCII.');

  const warnings: string[] = [];
  const unitCode = readInsUnits(pairs);
  const unit = unitInfo(unitCode);
  if (!unit.meterFactor) {
    warnings.push('DXF không khai báo đơn vị đo có thể quy đổi sang mét. Diện tích vẫn được nhận diện theo đơn vị bản vẽ nhưng không tự ghi m².');
  }

  const entities = collectEntities(extractEntitiesSection(pairs));
  const texts = readTexts(entities);
  const shapes = readShapes(entities, warnings);
  if (!shapes.length) {
    throw new Error('Không tìm thấy HATCH boundary hoặc LWPOLYLINE kín phù hợp để tạo Căn / Phòng.');
  }

  const allPoints = shapes.flatMap((shape) => shape.points);
  const shapeMinX = Math.min(...allPoints.map((point) => point.x));
  const shapeMaxX = Math.max(...allPoints.map((point) => point.x));
  const shapeMinY = Math.min(...allPoints.map((point) => point.y));
  const shapeMaxY = Math.max(...allPoints.map((point) => point.y));
  const headerMin = readHeaderPoint(pairs, '$EXTMIN');
  const headerMax = readHeaderPoint(pairs, '$EXTMAX');
  const hasHeaderExtents = Boolean(
    headerMin && headerMax
    && headerMax.x > headerMin.x
    && headerMax.y > headerMin.y
    && shapeMinX >= headerMin.x - 1e-6
    && shapeMaxX <= headerMax.x + 1e-6
    && shapeMinY >= headerMin.y - 1e-6
    && shapeMaxY <= headerMax.y + 1e-6
  );
  const minX = hasHeaderExtents ? headerMin!.x : shapeMinX;
  const maxX = hasHeaderExtents ? headerMax!.x : shapeMaxX;
  const minY = hasHeaderExtents ? headerMin!.y : shapeMinY;
  const maxY = hasHeaderExtents ? headerMax!.y : shapeMaxY;
  if (!hasHeaderExtents) {
    warnings.push('DXF không có $EXTMIN/$EXTMAX hợp lệ; tọa độ highlight được chuẩn hóa theo phạm vi HATCH/Polyline nhận diện. Hãy kiểm tra vị trí trên mặt bằng trước khi lưu.');
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (!(spanX > 0) || !(spanY > 0)) throw new Error('Không xác định được extents DXF hợp lệ.');

  const candidates = shapes.map((shape, index): DxfRoomCandidate => {
    const centroid = polygonCentroid(shape.points);
    const looksLikeMeasurement = (value: string) =>
      /(?:m2|m²|㎡|sqm|sq\.?m)/i.test(value.replace(/\s+/g, ''));
    const insideTexts = texts
      .filter((text) =>
        pointInPolygon(text, shape.points)
        && !(shape.holes || []).some((hole) => pointInPolygon(text, hole))
      )
      .map((text) => ({
        ...text,
        distance: Math.hypot(text.x - centroid.x, text.y - centroid.y),
        measurement: looksLikeMeasurement(text.text),
      }))
      .sort((a, b) => Number(a.measurement) - Number(b.measurement) || a.distance - b.distance);
    const selectedText = insideTexts[0];
    const rawArea = shape.areaDrawingUnits ?? polygonArea(shape.points);
    const areaM2 = unit.meterFactor ? rawArea * unit.meterFactor * unit.meterFactor : undefined;
    const percentPoints = shape.points.map((point) => ({
      x: round4(((point.x - minX) / spanX) * 100),
      y: round4(((maxY - point.y) / spanY) * 100),
    }));
    const px = percentPoints.map((point) => point.x);
    const py = percentPoints.map((point) => point.y);
    const x = Math.min(...px);
    const y = Math.min(...py);
    const width = Math.max(...px) - x;
    const height = Math.max(...py) - y;
    return {
      id: `dxf-room-${index + 1}`,
      roomName: selectedText?.text || `CAD-${String(index + 1).padStart(3, '0')}`,
      layer: shape.layer || '',
      source: shape.source,
      x: round4(x),
      y: round4(y),
      width: round4(width),
      height: round4(height),
      points: percentPoints,
      rawPoints: shape.points,
      areaDrawingUnits: round4(rawArea),
      areaM2: areaM2 === undefined ? undefined : round4(areaM2),
      drawingUnitLabel: unit.label,
      hasDetectedName: Boolean(selectedText),
      textType: selectedText?.type,
      confidence: selectedText ? 0.96 : 0.55,
      selected: true,
    };
  });

  const duplicateNames = new Map<string, number>();
  candidates.forEach((candidate) => {
    const key = candidate.roomName.trim().toLocaleLowerCase('vi-VN');
    duplicateNames.set(key, (duplicateNames.get(key) || 0) + 1);
  });
  duplicateNames.forEach((count, key) => {
    if (count > 1) warnings.push(`Tên Căn / Phòng “${key}” xuất hiện ${count} lần trong DXF; hãy kiểm tra trước khi lưu.`);
  });

  return {
    candidates,
    unitCode,
    unitLabel: unit.label,
    warnings,
    extents: { minX, minY, maxX, maxY },
  };
}

export interface DxfFloorPlanRenderResult {
  dataUrl: string;
  renderedEntities: number;
  skippedEntities: number;
  extents: { minX: number; minY: number; maxX: number; maxY: number };
  layers: string[];
}

const xmlEscape = (value: string) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const readLwPolylineAny = (entityPairs: DxfPair[]) => {
  const flag = getNumber(entityPairs, 70, 0);
  const points: DxfPoint[] = [];
  let x: number | undefined;
  entityPairs.forEach((pair) => {
    if (pair.code === 10) {
      const value = Number(pair.value);
      x = Number.isFinite(value) ? value : undefined;
    } else if (pair.code === 20 && x !== undefined) {
      const y = Number(pair.value);
      if (Number.isFinite(y)) points.push({ x, y });
      x = undefined;
    }
  });
  return { points, closed: (flag & 1) === 1 };
};

/**
 * Render a conservative 2D CAD background from an ASCII DXF. This is display-only:
 * it never mutates business IDs. Supported: LINE, LWPOLYLINE, CIRCLE, TEXT/MTEXT
 * plus safe HATCH polygon boundaries.
 */
export function renderDxfFloorPlanSvgDataUrl(input: string): DxfFloorPlanRenderResult {
  const pairs = toPairs(input);
  if (pairs.length < 10) throw new Error('DXF quá ngắn hoặc không đúng định dạng ASCII.');
  const entities = collectEntities(extractEntitiesSection(pairs));
  const texts = readTexts(entities);
  const warnings: string[] = [];
  const roomShapes = readShapes(entities, warnings);

  const headerMin = readHeaderPoint(pairs, '$EXTMIN');
  const headerMax = readHeaderPoint(pairs, '$EXTMAX');
  const geometryPoints: DxfPoint[] = [];
  roomShapes.forEach((shape) => geometryPoints.push(...shape.points));
  texts.forEach((row) => geometryPoints.push({ x: row.x, y: row.y }));
  entities.forEach((entity) => {
    if (entity.type === 'LINE') {
      const x1 = getNumber(entity.pairs, 10, NaN);
      const y1 = getNumber(entity.pairs, 20, NaN);
      const x2 = getNumber(entity.pairs, 11, NaN);
      const y2 = getNumber(entity.pairs, 21, NaN);
      if ([x1, y1, x2, y2].every(Number.isFinite)) geometryPoints.push({ x: x1, y: y1 }, { x: x2, y: y2 });
    } else if (entity.type === 'LWPOLYLINE') {
      geometryPoints.push(...readLwPolylineAny(entity.pairs).points);
    } else if (entity.type === 'CIRCLE') {
      const cx = getNumber(entity.pairs, 10, NaN);
      const cy = getNumber(entity.pairs, 20, NaN);
      const r = Math.abs(getNumber(entity.pairs, 40, NaN));
      if ([cx, cy, r].every(Number.isFinite)) geometryPoints.push({ x: cx - r, y: cy - r }, { x: cx + r, y: cy + r });
    }
  });

  const fallbackX = geometryPoints.map((point) => point.x);
  const fallbackY = geometryPoints.map((point) => point.y);
  const minX = headerMin?.x ?? Math.min(...fallbackX);
  const minY = headerMin?.y ?? Math.min(...fallbackY);
  const maxX = headerMax?.x ?? Math.max(...fallbackX);
  const maxY = headerMax?.y ?? Math.max(...fallbackY);
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
    throw new Error('Không xác định được phạm vi bản vẽ DXF để tạo mặt bằng CAD.');
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const mapX = (x: number) => ((x - minX) / spanX) * 1000;
  const mapY = (y: number) => ((maxY - y) / spanY) * 1000;
  const layers = new Set<string>();
  let renderedEntities = 0;
  let skippedEntities = 0;
  const body: string[] = [];
  const maxEntities = 15000;

  for (const entity of entities) {
    if (renderedEntities >= maxEntities) { skippedEntities += 1; continue; }
    const layer = getString(entity.pairs, 8) || '0';
    layers.add(layer);
    if (entity.type === 'LINE') {
      const x1 = getNumber(entity.pairs, 10, NaN);
      const y1 = getNumber(entity.pairs, 20, NaN);
      const x2 = getNumber(entity.pairs, 11, NaN);
      const y2 = getNumber(entity.pairs, 21, NaN);
      if ([x1, y1, x2, y2].every(Number.isFinite)) {
        body.push(`<line x1="${mapX(x1).toFixed(2)}" y1="${mapY(y1).toFixed(2)}" x2="${mapX(x2).toFixed(2)}" y2="${mapY(y2).toFixed(2)}"/>`);
        renderedEntities += 1;
      } else skippedEntities += 1;
    } else if (entity.type === 'LWPOLYLINE') {
      // Do not replace a CAD arc-bulge with a misleading straight chord on
      // the floor background. Surface a skipped count for manual review.
      const hasCurve = entity.pairs.some((pair) => pair.code === 42 && (!Number.isFinite(Number(pair.value)) || Math.abs(Number(pair.value)) > 1e-9));
      if (hasCurve) { skippedEntities += 1; continue; }
      const row = readLwPolylineAny(entity.pairs);
      if (row.points.length >= 2) {
        const points = row.points.map((point) => `${mapX(point.x).toFixed(2)},${mapY(point.y).toFixed(2)}`).join(' ');
        body.push(row.closed ? `<polygon points="${points}" fill="none"/>` : `<polyline points="${points}" fill="none"/>`);
        renderedEntities += 1;
      } else skippedEntities += 1;
    } else if (entity.type === 'CIRCLE') {
      const cx = getNumber(entity.pairs, 10, NaN);
      const cy = getNumber(entity.pairs, 20, NaN);
      const r = Math.abs(getNumber(entity.pairs, 40, NaN));
      if ([cx, cy, r].every(Number.isFinite)) {
        body.push(`<ellipse cx="${mapX(cx).toFixed(2)}" cy="${mapY(cy).toFixed(2)}" rx="${(r / spanX * 1000).toFixed(2)}" ry="${(r / spanY * 1000).toFixed(2)}" fill="none"/>`);
        renderedEntities += 1;
      } else skippedEntities += 1;
    } else if (['ARC', 'INSERT', 'SPLINE', 'ELLIPSE', 'POLYLINE'].includes(entity.type)) {
      // Not yet rendered on this conservative SVG backdrop. Quantity preview
      // has a separate parser for some of these types.
      skippedEntities += 1;
    }
  }

  roomShapes.forEach((shape) => {
    if (renderedEntities >= maxEntities) return;
    const points = shape.points.map((point) => `${mapX(point.x).toFixed(2)},${mapY(point.y).toFixed(2)}`).join(' ');
    if (points) {
      body.push(`<polygon points="${points}" fill="none" opacity="0.7"/>`);
      renderedEntities += 1;
    }
  });

  const textBody = texts.slice(0, 2500).map((row) => {
    layers.add(row.layer || '0');
    return `<text x="${mapX(row.x).toFixed(2)}" y="${mapY(row.y).toFixed(2)}" font-size="10" fill="#334155" stroke="none">${xmlEscape(row.text)}</text>`;
  }).join('');
  renderedEntities += Math.min(texts.length, 2500);
  if (texts.length > 2500) skippedEntities += texts.length - 2500;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" width="1600" height="1600"><rect width="1000" height="1000" fill="white"/><g fill="none" stroke="#475569" stroke-width="0.8" vector-effect="non-scaling-stroke">${body.join('')}</g>${textBody}</svg>`;
  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    renderedEntities,
    skippedEntities,
    extents: { minX, minY, maxX, maxY },
    layers: Array.from(layers).sort((a, b) => a.localeCompare(b, 'vi')),
  };
}

/**
 * Read-only quantity survey for ASCII DXF model-space entities. Do not write
 * these preview numbers to RoomProgress/Firestore without an explicit mapping
 * and user confirmation. Every value keeps its underlying drawing unit.
 */
export interface DxfQuantityLayer {
  layer: string;
  areaDrawingUnits: number;
  perimeterDrawingUnits: number;
  lengthDrawingUnits: number;
  areaM2?: number;
  perimeterM?: number;
  lengthM?: number;
  hatchCount: number;
  closedPolylineCount: number;
  openPolylineCount: number;
  lineCount: number;
  arcCount: number;
  circleCount: number;
  blockCount: number;
}

export interface DxfQuantityTakeoffResult {
  unitCode: number;
  unitLabel: string;
  layers: DxfQuantityLayer[];
  skippedEntities: number;
  warnings: string[];
}

const quantityEdgeKey = (a: DxfPoint, b: DxfPoint) => {
  const token = (point: DxfPoint) => `${Math.round(point.x * 10000)},${Math.round(point.y * 10000)}`;
  const p = token(a);
  const q = token(b);
  return p <= q ? `${p}:${q}` : `${q}:${p}`;
};

const quantityLoopPoints = (points: DxfPoint[]) => {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first.x === last.x && first.y === last.y ? points.slice(0, -1) : points;
};

// Reject self-intersecting or degenerate closed boundaries instead of deriving
// a confident area from the shoelace formula on malformed CAD geometry.
const quantityIsSimpleBoundary = (original: DxfPoint[]) => {
  const points = quantityLoopPoints(original);
  const n = points.length;
  if (n < 3 || n > 2000) return false;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite) || Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) return false;
  }
  const cross = (a: DxfPoint, b: DxfPoint, c: DxfPoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const inRange = (x: number, a: number, b: number) => x >= Math.min(a, b) - 1e-9 && x <= Math.max(a, b) + 1e-9;
  const onSegment = (a: DxfPoint, b: DxfPoint, c: DxfPoint) =>
    Math.abs(cross(a, b, c)) <= 1e-9 && inRange(c.x, a.x, b.x) && inRange(c.y, a.y, b.y);
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = points[j], d = points[(j + 1) % n];
      const abC = cross(a, b, c), abD = cross(a, b, d);
      const cdA = cross(c, d, a), cdB = cross(c, d, b);
      if ((abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0)
        || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) {
        return false;
      }
    }
  }
  return true;
};

const quantityBoundaryKey = (rawPoints: DxfPoint[]) => {
  const points = quantityLoopPoints(rawPoints);
  return points.map((point, index) => quantityEdgeKey(point, points[(index + 1) % points.length])).sort().join('|');
};

const quantityPolylineLength = (rawPoints: DxfPoint[], closed: boolean) => {
  const points = closed ? quantityLoopPoints(rawPoints) : rawPoints;
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  if (closed && points.length > 2) {
    length += Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y);
  }
  return length;
};

export function analyzeDxfQuantities(input: string): DxfQuantityTakeoffResult {
  const pairs = toPairs(input);
  if (pairs.length < 10) throw new Error('DXF quá ngắn hoặc không đúng định dạng ASCII.');
  const unitCode = readInsUnits(pairs);
  const unit = unitInfo(unitCode);
  const entities = collectEntities(extractEntitiesSection(pairs));
  const layers = new Map<string, DxfQuantityLayer>();
  const warnings: string[] = [];
  const warn = (message: string) => { if (warnings.length < 20) warnings.push(message); };
  const seenAreas = new Map<string, Set<string>>();
  const seenPerimeters = new Map<string, Set<string>>();
  const seenLengths = new Map<string, Set<string>>();
  let skippedEntities = 0;
  let overlapCount = 0;
  const layerRow = (name: string): DxfQuantityLayer => {
    const layer = name || '0';
    let row = layers.get(layer);
    if (!row) {
      row = {
        layer, areaDrawingUnits: 0, perimeterDrawingUnits: 0, lengthDrawingUnits: 0,
        hatchCount: 0, closedPolylineCount: 0, openPolylineCount: 0,
        lineCount: 0, arcCount: 0, circleCount: 0, blockCount: 0,
      };
      layers.set(layer, row);
    }
    return row;
  };
  const unique = (registry: Map<string, Set<string>>, layer: string, key: string) => {
    const set = registry.get(layer) || new Set<string>();
    registry.set(layer, set);
    if (set.has(key)) {
      overlapCount++;
      return false;
    }
    set.add(key);
    return true;
  };
  const safeNumber = (value: number) => Number.isFinite(value) && value >= 0;
  const segment = (row: DxfQuantityLayer, a: DxfPoint, b: DxfPoint) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!safeNumber(length) || length <= 0) return false;
    if (!unique(seenLengths, row.layer, quantityEdgeKey(a, b))) return false;
    row.lengthDrawingUnits += length;
    return true;
  };

  // HATCH is authoritative for area where it has complete straight boundaries.
  // Process HATCH first, regardless of DXF entity order, to prevent double-counting
  // a matching closed LWPOLYLINE on the same layer.
  for (const entity of entities) {
    if (entity.type !== 'HATCH') continue;
    if (getNumber(entity.pairs, 67, 0) === 1) continue;
    const layer = getString(entity.pairs, 8) || '0';
    const parsed = readHatchBoundaryShapes(entity.pairs);
    const curved = entity.pairs.some((pair) => pair.code === 42 && (!Number.isFinite(Number(pair.value)) || Math.abs(Number(pair.value)) > 1e-9));
    if (curved || parsed.unsupportedPathCount || !parsed.boundaries.length || parsed.boundaries.some((boundary) => boundary.loops.some((loop) => !quantityIsSimpleBoundary(loop)))) {
      skippedEntities++;
      warn(`HATCH layer “${layer}” bị bỏ qua trong bảng KL: biên cong, tự cắt, quá phức tạp hoặc không đọc đầy đủ. Không ước tính diện tích.`);
      continue;
    }
    const row = layerRow(layer);
    for (const boundary of parsed.boundaries) {
      const key = quantityBoundaryKey(boundary.points);
      if (!unique(seenAreas, layer, key)) continue;
      const area = boundary.areaDrawingUnits;
      if (!safeNumber(area)) { skippedEntities++; continue; }
      row.areaDrawingUnits += area;
      row.hatchCount++;
      const loops = boundary.loops;
      for (const loop of loops) {
        const loopKey = quantityBoundaryKey(loop);
        if (unique(seenPerimeters, layer, loopKey)) row.perimeterDrawingUnits += quantityPolylineLength(loop, true);
      }
    }
  }

  for (const entity of entities) {
    const type = entity.type;
    if (!['LWPOLYLINE', 'LINE', 'ARC', 'CIRCLE', 'INSERT'].includes(type)) {
      // Legacy POLYLINE / ELLIPSE / SPLINE / nested block geometry needs
      // specialist parsing, not a guessed result.
      if (['POLYLINE', 'ELLIPSE', 'SPLINE'].includes(type)) skippedEntities++;
      continue;
    }
    if (getNumber(entity.pairs, 67, 0) === 1) continue;
    const layout = getString(entity.pairs, 410);
    if (layout && layout.toLowerCase() !== 'model') continue;
    const row = layerRow(getString(entity.pairs, 8) || '0');
    if (type === 'INSERT') {
      // One entity = one inserted block reference. Nested block contents,
      // anonymous/dynamic geometry and MINSERT arrays are not expanded.
      const columns = getNumber(entity.pairs, 70, 1);
      const rows = getNumber(entity.pairs, 71, 1);
      if (columns !== 1 || rows !== 1) {
        skippedEntities++;
        warn(`BLOCK MINSERT trên layer “${row.layer}” cần kiểm tra riêng, chưa cộng số lượng tự động.`);
        continue;
      }
      const blockName = getString(entity.pairs, 2);
      if (!blockName) { skippedEntities++; continue; }
      row.blockCount++;
    } else if (type === 'LWPOLYLINE') {
      const polyline = readLwPolylineAny(entity.pairs);
      if (polyline.points.length < 2 || entity.pairs.some((pair) => pair.code === 42 && (!Number.isFinite(Number(pair.value)) || Math.abs(Number(pair.value)) > 1e-9))) {
        skippedEntities++;
        warn(`Polyline cong (bulge) hoặc thiếu đỉnh trên layer “${row.layer}” được bỏ qua; cần đo trong AutoCAD.`);
        continue;
      }
      const { points, closed } = polyline;
      if (closed && points.length >= 3) {
        if (!quantityIsSimpleBoundary(points)) {
          skippedEntities++;
          warn(`Polyline kín trên layer “${row.layer}” có biên tự cắt hoặc quá phức tạp; bỏ qua cả chu vi và diện tích.`);
          continue;
        }
        const key = quantityBoundaryKey(points);
        if (!unique(seenPerimeters, row.layer, key)) continue;
        const perimeter = quantityPolylineLength(points, true);
        if (!safeNumber(perimeter)) { skippedEntities++; continue; }
        row.closedPolylineCount++;
        row.perimeterDrawingUnits += perimeter;
        // Do not count boundary perimeter again as linear length.
        if (unique(seenAreas, row.layer, key)) row.areaDrawingUnits += polygonArea(quantityLoopPoints(points));
      } else {
        row.openPolylineCount++;
        for (let i = 1; i < points.length; i++) segment(row, points[i - 1], points[i]);
      }
    } else if (type === 'LINE') {
      const a = { x: getNumber(entity.pairs, 10, NaN), y: getNumber(entity.pairs, 20, NaN) };
      const b = { x: getNumber(entity.pairs, 11, NaN), y: getNumber(entity.pairs, 21, NaN) };
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) { skippedEntities++; continue; }
      if (segment(row, a, b)) row.lineCount++;
    } else if (type === 'ARC') {
      const radius = getNumber(entity.pairs, 40, NaN);
      const start = getNumber(entity.pairs, 50, NaN);
      const end = getNumber(entity.pairs, 51, NaN);
      if (![radius, start, end].every(Number.isFinite) || radius <= 0) { skippedEntities++; continue; }
      const sweep = ((end - start) % 360 + 360) % 360;
      if (!sweep) { skippedEntities++; continue; }
      const cx = getNumber(entity.pairs, 10, NaN);
      const cy = getNumber(entity.pairs, 20, NaN);
      if (![cx, cy].every(Number.isFinite)) { skippedEntities++; continue; }
      row.arcCount++;
      row.lengthDrawingUnits += radius * sweep * Math.PI / 180;
    } else if (type === 'CIRCLE') {
      const r = getNumber(entity.pairs, 40, NaN);
      const cx = getNumber(entity.pairs, 10, NaN);
      const cy = getNumber(entity.pairs, 20, NaN);
      if (![cx, cy].every(Number.isFinite) || !Number.isFinite(r) || r <= 0) { skippedEntities++; continue; }
      row.circleCount++;
      row.areaDrawingUnits += Math.PI * r * r;
      row.perimeterDrawingUnits += 2 * Math.PI * r;
    }
  }

  if (!unit.meterFactor) warnings.unshift('DXF chưa có đơn vị quy đổi được: chỉ hiển thị số đo theo đơn vị bản vẽ, không tự suy đoán mét hoặc m².');
  if (overlapCount) warnings.push(`Đã tránh cộng trùng ${overlapCount} biên/đoạn thẳng cùng layer có hình học trùng nhau. Hãy đối chiếu nếu bản vẽ có đối tượng chồng nét có chủ ý.`);
  if (skippedEntities) warnings.push(`Có ${skippedEntities} đối tượng chưa thể bóc tách tin cậy. Không dùng bảng này làm quyết toán khi chưa kiểm tra AutoCAD.`);
  const rounded = Array.from(layers.values()).map((row): DxfQuantityLayer => ({
    ...row,
    areaDrawingUnits: round4(row.areaDrawingUnits),
    perimeterDrawingUnits: round4(row.perimeterDrawingUnits),
    lengthDrawingUnits: round4(row.lengthDrawingUnits),
    areaM2: unit.meterFactor === undefined ? undefined : round4(row.areaDrawingUnits * unit.meterFactor ** 2),
    perimeterM: unit.meterFactor === undefined ? undefined : round4(row.perimeterDrawingUnits * unit.meterFactor),
    lengthM: unit.meterFactor === undefined ? undefined : round4(row.lengthDrawingUnits * unit.meterFactor),
  }));
  rounded.sort((a, b) => a.layer.localeCompare(b.layer, 'vi', { numeric: true }));
  return { unitCode, unitLabel: unit.label, layers: rounded, skippedEntities, warnings };
}

/** CSV is a preview/export only. Guard against formula injection in spreadsheet apps. */
export function exportDxfQuantitiesCsv(result: DxfQuantityTakeoffResult): string {
  const quote = (input: string | number) => {
    const value = String(input);
    const safe = /^[\s]*[=+@\-\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = [
    ['Layer', 'Diện tích', 'Đơn vị DT', 'Chu vi', 'Đơn vị CV', 'Chiều dài', 'Đơn vị CD', 'Số Block', 'HATCH', 'Polyline kín', 'Polyline hở', 'LINE', 'ARC', 'CIRCLE'],
    ...result.layers.map((row) => [
      row.layer, row.areaM2 ?? row.areaDrawingUnits, row.areaM2 === undefined ? `${result.unitLabel}²` : 'm²',
      row.perimeterM ?? row.perimeterDrawingUnits, row.perimeterM === undefined ? result.unitLabel : 'm',
      row.lengthM ?? row.lengthDrawingUnits, row.lengthM === undefined ? result.unitLabel : 'm',
      row.blockCount, row.hatchCount, row.closedPolylineCount, row.openPolylineCount, row.lineCount, row.arcCount, row.circleCount,
    ]),
  ];
  return `\uFEFF${lines.map((cells) => cells.map(quote).join(',')).join('\r\n')}\r\n`;
}
