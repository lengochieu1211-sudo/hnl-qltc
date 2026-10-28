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
  if ((flag & 1) !== 1) return [];
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
        warnings.push(`HATCH layer “${layer || '(không tên)'}” có ${parsed.unsupportedPathCount} boundary cung/spline hoặc không đọc được; hệ thống chỉ dùng boundary polygon/line an toàn.`);
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
