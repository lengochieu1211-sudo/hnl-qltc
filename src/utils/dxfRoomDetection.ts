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
    const x = getNumber(entity.pairs, 10, NaN);
    const y = getNumber(entity.pairs, 20, NaN);
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

const readHatchPolylineBoundary = (entityPairs: DxfPair[]): DxfPoint[] => {
  for (let i = 0; i < entityPairs.length; i++) {
    if (entityPairs[i].code !== 92) continue;
    const flags = Number(entityPairs[i].value);
    if (!Number.isFinite(flags)) continue;

    if ((flags & 2) === 2) {
      let vertexCount = 0;
      let start = -1;
      for (let j = i + 1; j < entityPairs.length; j++) {
        if (entityPairs[j].code === 92) break;
        if (entityPairs[j].code === 93) {
          vertexCount = Number(entityPairs[j].value) || 0;
          start = j + 1;
          break;
        }
      }
      if (vertexCount > 0 && start >= 0) {
        const points: DxfPoint[] = [];
        let x: number | undefined;
        for (let j = start; j < entityPairs.length && points.length < vertexCount; j++) {
          const pair = entityPairs[j];
          if (pair.code === 92) break;
          if (pair.code === 10) {
            const value = Number(pair.value);
            x = Number.isFinite(value) ? value : undefined;
          } else if (pair.code === 20 && x !== undefined) {
            const y = Number(pair.value);
            if (Number.isFinite(y)) points.push({ x, y });
            x = undefined;
          }
        }
        if (points.length >= 3) return points;
      }
    } else {
      // Line-edge boundary fallback. Arc/spline edges are deliberately not approximated:
      // fail closed rather than silently distorting a room outline.
      let edgeCount = 0;
      let start = -1;
      for (let j = i + 1; j < entityPairs.length; j++) {
        if (entityPairs[j].code === 92) break;
        if (entityPairs[j].code === 93) {
          edgeCount = Number(entityPairs[j].value) || 0;
          start = j + 1;
          break;
        }
      }
      if (edgeCount > 0 && start >= 0) {
        const points: DxfPoint[] = [];
        let cursor = start;
        let supported = true;
        for (let edge = 0; edge < edgeCount && cursor < entityPairs.length; edge++) {
          while (cursor < entityPairs.length && entityPairs[cursor].code !== 72 && entityPairs[cursor].code !== 92) cursor++;
          if (cursor >= entityPairs.length || entityPairs[cursor].code === 92) break;
          const edgeType = Number(entityPairs[cursor].value);
          cursor++;
          if (edgeType !== 1) {
            supported = false;
            break;
          }
          let x1: number | undefined;
          let y1: number | undefined;
          let x2: number | undefined;
          let y2: number | undefined;
          while (cursor < entityPairs.length && entityPairs[cursor].code !== 72 && entityPairs[cursor].code !== 92) {
            const pair = entityPairs[cursor];
            if (pair.code === 10) x1 = Number(pair.value);
            else if (pair.code === 20) y1 = Number(pair.value);
            else if (pair.code === 11) x2 = Number(pair.value);
            else if (pair.code === 21) y2 = Number(pair.value);
            cursor++;
          }
          if ([x1, y1, x2, y2].every((value) => Number.isFinite(value))) {
            if (!points.length) points.push({ x: x1!, y: y1! });
            points.push({ x: x2!, y: y2! });
          }
        }
        if (supported && points.length >= 3) return points;
      }
    }
  }
  return [];
};

const readShapes = (entities: Array<{ type: string; pairs: DxfPair[] }>, warnings: string[]): RawShape[] => {
  const shapes: RawShape[] = [];
  entities.forEach((entity) => {
    if (entity.type === 'HATCH') {
      const points = readHatchPolylineBoundary(entity.pairs);
      if (points.length >= 3) {
        shapes.push({ source: 'HATCH', layer: getString(entity.pairs, 8), points });
      } else {
        warnings.push(`Bỏ qua HATCH layer “${getString(entity.pairs, 8) || '(không tên)'}”: boundary có cung/spline hoặc không đọc được polygon kín.`);
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

  const entities = collectEntities(pairs);
  const texts = readTexts(entities);
  const shapes = readShapes(entities, warnings);
  if (!shapes.length) {
    throw new Error('Không tìm thấy HATCH boundary hoặc LWPOLYLINE kín phù hợp để tạo Căn / Phòng.');
  }

  const allPoints = shapes.flatMap((shape) => shape.points);
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (!(spanX > 0) || !(spanY > 0)) throw new Error('Không xác định được extents DXF hợp lệ.');

  const candidates = shapes.map((shape, index): DxfRoomCandidate => {
    const centroid = polygonCentroid(shape.points);
    const insideTexts = texts
      .filter((text) => pointInPolygon(text, shape.points))
      .map((text) => ({ ...text, distance: Math.hypot(text.x - centroid.x, text.y - centroid.y) }))
      .sort((a, b) => a.distance - b.distance);
    const selectedText = insideTexts[0];
    const rawArea = polygonArea(shape.points);
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
