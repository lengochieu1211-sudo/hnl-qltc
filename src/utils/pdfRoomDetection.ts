import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { loadPdfDocument } from './pdfToImage';

export type PdfRoomDetectionSource = 'annotation' | 'raster-color';

export interface PdfRoomDetectionOptions {
  pageNumber?: number;
  minAreaPercent?: number;
  maxAreaPercent?: number;
  useColorFilter?: boolean;
  targetColor?: string;
  colorTolerance?: number;
  includeRasterFallback?: boolean;
  allowedAnnotationSubtypes?: string[];
  allowNumericOnlyNames?: boolean;
  namePattern?: string;
  centerSearchMarginPercent?: number;
}

export interface PdfRoomCandidate {
  id: string;
  roomName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: { x: number; y: number }[];
  confidence: number;
  source: PdfRoomDetectionSource;
  annotationSubtype?: string;
  color?: string;
  areaPercent: number;
  hasDetectedName: boolean;
  selected: boolean;
}

interface TextBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

interface ShapeBox {
  x: number;
  y: number;
  width: number;
  height: number;
  points?: { x: number; y: number }[];
  source: PdfRoomDetectionSource;
  annotationSubtype?: string;
  color?: string;
  areaPercent: number;
  embeddedText?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round2 = (value: number) => Math.round(value * 100) / 100;

const normalizeHex = (value?: string) => {
  const raw = String(value || '#ffff00').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toUpperCase();
  }
  return '#FFFF00';
};

const hexToRgb = (hex: string) => {
  const clean = normalizeHex(hex).slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
};

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const rgbToHsv = (r: number, g: number, b: number) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
};

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

const colorMatches = (r: number, g: number, b: number, targetHex: string, tolerance: number) => {
  const target = hexToRgb(targetHex);
  const dr = r - target.r;
  const dg = g - target.g;
  const db = b - target.b;
  const distance = Math.sqrt(dr * dr + dg * dg + db * db);
  const tol = clamp(tolerance, 0, 100);
  if (distance <= tol * 4.42) return true;

  const targetHsv = rgbToHsv(target.r, target.g, target.b);
  const pixelHsv = rgbToHsv(r, g, b);
  if (targetHsv.s < 0.08) return false;
  const hueTol = 6 + tol * 0.32;
  const minSat = Math.max(0.08, targetHsv.s * Math.max(0.08, 0.34 - tol / 500));
  return hueDistance(pixelHsv.h, targetHsv.h) <= hueTol && pixelHsv.s >= minSat && pixelHsv.v >= 0.25;
};

const annotationColorToHex = (color: unknown): string | undefined => {
  if (!color) return undefined;
  const values = Array.from(color as ArrayLike<number>);
  if (values.length < 3) return undefined;
  const normalized = values.slice(0, 3).map((v) => Number(v));
  const multiplier = normalized.every((v) => v >= 0 && v <= 1) ? 255 : 1;
  return rgbToHex(normalized[0] * multiplier, normalized[1] * multiplier, normalized[2] * multiplier);
};

const colorFilterPasses = (shapeColor: string | undefined, options: PdfRoomDetectionOptions) => {
  if (!options.useColorFilter) return true;
  if (!shapeColor) return false;
  const c = hexToRgb(shapeColor);
  return colorMatches(c.r, c.g, c.b, normalizeHex(options.targetColor), options.colorTolerance ?? 35);
};

const cleanCandidateText = (value: string) =>
  String(value || '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const buildNameRegex = (pattern?: string): RegExp | null => {
  const source = String(pattern || '').trim();
  if (!source) return null;
  try {
    return new RegExp(source, 'iu');
  } catch {
    return null;
  }
};

const looksLikeRoomName = (text: string, regex: RegExp | null, allowNumericOnly = false) => {
  const value = cleanCandidateText(text);
  if (!value || value.length > 40) return false;
  if (/^\d+(?:[.,]\d+)?$/.test(value)) {
    // Pure dimensions such as 3000/1200 are common on CAD drawings. They are
    // rejected by default and only allowed when a project explicitly uses numeric room names.
    return allowNumericOnly && /^\d{1,4}$/.test(value);
  }
  if (regex && regex.test(value)) return true;
  if (/^[A-ZÀ-Ỹ]{1,5}[-_. ]?\d{1,5}$/iu.test(value)) return true;
  if (/^(?:CĂN|PHÒNG|P\.?|ROOM|WC|KHU|ZONE)\s*[-_. ]?[A-ZÀ-Ỹ0-9][A-ZÀ-Ỹ0-9 ._/#-]{0,25}$/iu.test(value)) return true;
  if (/^[A-ZÀ-Ỹ][A-ZÀ-Ỹ0-9 ._/#-]{1,18}$/iu.test(value) && /\d/u.test(value)) return true;
  return false;
};

const rectToPercent = (rect: ArrayLike<number>, viewport: any) => {
  const converted = viewport.convertToViewportRectangle(Array.from(rect));
  const x1 = Math.min(converted[0], converted[2]);
  const x2 = Math.max(converted[0], converted[2]);
  const y1 = Math.min(converted[1], converted[3]);
  const y2 = Math.max(converted[1], converted[3]);
  return {
    x: clamp((x1 / viewport.width) * 100, 0, 100),
    y: clamp((y1 / viewport.height) * 100, 0, 100),
    width: clamp(((x2 - x1) / viewport.width) * 100, 0, 100),
    height: clamp(((y2 - y1) / viewport.height) * 100, 0, 100),
  };
};

const flattenNumericPairs = (value: any, out: number[] = []): number[] => {
  if (value == null) return out;
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.push(value);
    return out;
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    Array.from(value as ArrayLike<any>).forEach((item) => flattenNumericPairs(item, out));
    return out;
  }
  if (typeof value === 'object') {
    if (Number.isFinite(value.x) && Number.isFinite(value.y)) {
      out.push(Number(value.x), Number(value.y));
      return out;
    }
  }
  return out;
};

const pointsToPercent = (raw: any, viewport: any): { x: number; y: number }[] | undefined => {
  const nums = flattenNumericPairs(raw);
  if (nums.length < 6) return undefined;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const [vx, vy] = viewport.convertToViewportPoint(nums[i], nums[i + 1]);
    const p = {
      x: round2(clamp((vx / viewport.width) * 100, 0, 100)),
      y: round2(clamp((vy / viewport.height) * 100, 0, 100)),
    };
    if (!points.some((existing) => Math.abs(existing.x - p.x) < 0.01 && Math.abs(existing.y - p.y) < 0.01)) {
      points.push(p);
    }
  }
  return points.length >= 3 ? points : undefined;
};

const boundsFromPercentPoints = (points: { x: number; y: number }[]) => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x, y, width: maxX - x, height: maxY - y };
};

const extractTextBoxes = async (page: any, viewport: any, annotations: any[]): Promise<TextBox[]> => {
  const textContent = await page.getTextContent();
  const boxes: TextBox[] = [];
  for (const item of textContent.items || []) {
    if (!item || typeof item.str !== 'string' || !item.str.trim() || !item.transform) continue;
    const transformed = (pdfjsLib as any).Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.max(1, Math.hypot(transformed[2] || 0, transformed[3] || 0));
    const width = Math.max(1, Math.abs(Number(item.width || 0) * Number(viewport.scale || 1)));
    const x = Number(transformed[4] || 0);
    const baselineY = Number(transformed[5] || 0);
    const y = baselineY - fontHeight;
    boxes.push({
      text: cleanCandidateText(item.str),
      x,
      y,
      width,
      height: fontHeight,
      cx: x + width / 2,
      cy: y + fontHeight / 2,
    });
  }

  for (const annotation of annotations) {
    const subtype = String(annotation?.subtype || '').toLowerCase();
    if (subtype !== 'freetext' || !annotation?.rect || Number(annotation.rect.length || 0) < 4) continue;
    const text = cleanCandidateText(annotation?.contents || annotation?.contentsObj?.str || annotation?.titleObj?.str || '');
    if (!text) continue;
    const converted = viewport.convertToViewportRectangle(Array.from(annotation.rect as ArrayLike<number>));
    const x1 = Math.min(converted[0], converted[2]);
    const x2 = Math.max(converted[0], converted[2]);
    const y1 = Math.min(converted[1], converted[3]);
    const y2 = Math.max(converted[1], converted[3]);
    boxes.push({ text, x: x1, y: y1, width: x2 - x1, height: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 });
  }
  return boxes;
};

const assignNameToShape = (shape: ShapeBox, textBoxes: TextBox[], viewport: any, options: PdfRoomDetectionOptions) => {
  const regex = buildNameRegex(options.namePattern);
  const marginPct = clamp(options.centerSearchMarginPercent ?? 8, 0, 30);
  const sx = (shape.x / 100) * viewport.width;
  const sy = (shape.y / 100) * viewport.height;
  const sw = (shape.width / 100) * viewport.width;
  const sh = (shape.height / 100) * viewport.height;
  const cx = sx + sw / 2;
  const cy = sy + sh / 2;
  const mx = sw * (marginPct / 100);
  const my = sh * (marginPct / 100);

  const inside = textBoxes
    .filter((box) => box.cx >= sx - mx && box.cx <= sx + sw + mx && box.cy >= sy - my && box.cy <= sy + sh + my)
    .map((box) => ({
      box,
      distance: Math.hypot((box.cx - cx) / Math.max(sw, 1), (box.cy - cy) / Math.max(sh, 1)),
    }))
    .sort((a, b) => a.distance - b.distance);

  const candidates: { text: string; distance: number }[] = [];
  if (shape.embeddedText) candidates.push({ text: cleanCandidateText(shape.embeddedText), distance: 0 });
  inside.slice(0, 8).forEach(({ box, distance }) => candidates.push({ text: box.text, distance }));

  const nearCenter = inside.filter((entry) => entry.distance <= 0.75).slice(0, 5);
  if (nearCenter.length >= 2) {
    const byRow = [...nearCenter].sort((a, b) => {
      const dy = a.box.cy - b.box.cy;
      return Math.abs(dy) > Math.max(a.box.height, b.box.height) * 0.75 ? dy : a.box.x - b.box.x;
    });
    candidates.push({ text: byRow.map((entry) => entry.box.text).join(' '), distance: byRow.reduce((sum, entry) => sum + entry.distance, 0) / byRow.length });
  }

  const unique = new Map<string, number>();
  candidates.forEach((candidate) => {
    const text = cleanCandidateText(candidate.text);
    if (!text) return;
    if (!unique.has(text) || candidate.distance < (unique.get(text) || Infinity)) unique.set(text, candidate.distance);
  });

  const ranked = Array.from(unique.entries())
    .map(([text, distance]) => ({ text, distance, valid: looksLikeRoomName(text, regex, Boolean(options.allowNumericOnlyNames)) }))
    .sort((a, b) => Number(b.valid) - Number(a.valid) || a.distance - b.distance || a.text.length - b.text.length);

  const best = ranked.find((item) => item.valid) || ranked[0];
  if (!best) return { roomName: '', hasDetectedName: false, nameConfidence: 0 };
  const nameConfidence = best.valid ? clamp(0.72 + (1 - Math.min(best.distance, 1)) * 0.22, 0, 0.98) : 0.35;
  return { roomName: best.text, hasDetectedName: best.valid, nameConfidence };
};

const getAnnotationShapes = (annotations: any[], viewport: any, options: PdfRoomDetectionOptions): ShapeBox[] => {
  const minArea = Math.max(0.01, options.minAreaPercent ?? 0.12);
  const maxArea = Math.max(minArea, options.maxAreaPercent ?? 35);
  const supported = new Set((options.allowedAnnotationSubtypes?.length ? options.allowedAnnotationSubtypes : ['square', 'polygon', 'highlight']).map((v) => String(v).toLowerCase()));
  const shapes: ShapeBox[] = [];

  annotations.forEach((annotation) => {
    const subtype = String(annotation?.subtype || '').toLowerCase();
    if (!supported.has(subtype) || !annotation?.rect || Number(annotation.rect.length || 0) < 4) return;
    const color = annotationColorToHex(annotation?.color);
    if (!colorFilterPasses(color, options)) return;

    let points: { x: number; y: number }[] | undefined;
    // Preserve true Polygon geometry; other annotation types use their stable bounding rectangle.
    // Highlight/Ink quad paths are often text strokes or freehand paths and must not become a malformed room polygon.
    if (subtype === 'polygon') points = pointsToPercent(annotation?.vertices, viewport);

    const rect = points && points.length >= 3 ? boundsFromPercentPoints(points) : rectToPercent(annotation.rect, viewport);
    const areaPercent = (rect.width * rect.height) / 100;
    if (!Number.isFinite(areaPercent) || areaPercent < minArea || areaPercent > maxArea) return;

    shapes.push({
      ...rect,
      points: points && points.length >= 3 ? points : undefined,
      source: 'annotation',
      annotationSubtype: annotation?.subtype || subtype,
      color,
      areaPercent,
      embeddedText: cleanCandidateText(annotation?.contents || annotation?.contentsObj?.str || ''),
    });
  });

  return shapes;
};

const closeSmallMaskGaps = (source: Uint8Array, width: number, height: number): Uint8Array => {
  // 3x3 morphological close: joins tiny anti-aliased gaps caused by CAD lines/text
  // crossing a flattened highlight, without aggressively merging distant rooms.
  const dilated = new Uint8Array(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!source[idx]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) dilated[ny * width + nx] = 1;
      }
    }
  }
  const closed = new Uint8Array(source.length);
  for (let y = 1; y + 1 < height; y++) {
    for (let x = 1; x + 1 < width; x++) {
      let keep = 1;
      for (let dy = -1; dy <= 1 && keep; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dilated[(y + dy) * width + (x + dx)]) { keep = 0; break; }
      }
      if (keep) closed[y * width + x] = 1;
    }
  }
  return closed;
};

const getRasterColorShapes = async (page: any, options: PdfRoomDetectionOptions): Promise<ShapeBox[]> => {
  const baseViewport = page.getViewport({ scale: 1 });
  const maxDimension = 1200;
  const scale = Math.min(2.5, Math.max(0.5, maxDimension / Math.max(baseViewport.width, baseViewport.height, 1)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) return [];
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;
  let mask = new Uint8Array(width * height);
  const target = normalizeHex(options.targetColor);
  const tolerance = options.colorTolerance ?? 35;

  for (let i = 0, p = 0; p < mask.length; p++, i += 4) {
    if (colorMatches(data[i], data[i + 1], data[i + 2], target, tolerance)) mask[p] = 1;
  }
  mask = closeSmallMaskGaps(mask, width, height);

  const queue = new Int32Array(mask.length);
  const minArea = Math.max(0.01, options.minAreaPercent ?? 0.12);
  const maxArea = Math.max(minArea, options.maxAreaPercent ?? 35);
  const shapes: ShapeBox[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    mask[start] = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let count = 0;

    while (head < tail) {
      const idx = queue[head++];
      const y = Math.floor(idx / width);
      const x = idx - y * width;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const tryPush = (next: number) => {
        if (next >= 0 && next < mask.length && mask[next]) {
          mask[next] = 0;
          queue[tail++] = next;
        }
      };
      if (x > 0) tryPush(idx - 1);
      if (x + 1 < width) tryPush(idx + 1);
      if (y > 0) tryPush(idx - width);
      if (y + 1 < height) tryPush(idx + width);
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    if (boxWidth < 4 || boxHeight < 4) continue;
    const bboxArea = boxWidth * boxHeight;
    const fillRatio = count / Math.max(1, bboxArea);
    if (fillRatio < 0.08) continue;
    const areaPercent = (bboxArea / (width * height)) * 100;
    if (areaPercent < minArea || areaPercent > maxArea) continue;

    shapes.push({
      x: (minX / width) * 100,
      y: (minY / height) * 100,
      width: (boxWidth / width) * 100,
      height: (boxHeight / height) * 100,
      source: 'raster-color',
      color: target,
      areaPercent,
    });
  }

  canvas.width = 1;
  canvas.height = 1;
  return shapes;
};

const dedupeShapes = (shapes: ShapeBox[]): ShapeBox[] => {
  const result: ShapeBox[] = [];
  for (const shape of shapes.sort((a, b) => Number(b.source === 'annotation') - Number(a.source === 'annotation') || b.areaPercent - a.areaPercent)) {
    const duplicate = result.some((existing) => {
      const x1 = Math.max(shape.x, existing.x);
      const y1 = Math.max(shape.y, existing.y);
      const x2 = Math.min(shape.x + shape.width, existing.x + existing.width);
      const y2 = Math.min(shape.y + shape.height, existing.y + existing.height);
      const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      const smaller = Math.min(shape.width * shape.height, existing.width * existing.height);
      return smaller > 0 && intersection / smaller > 0.84;
    });
    if (!duplicate) result.push(shape);
  }
  return result;
};

export async function detectPdfRoomCandidatesFromDocument(pdf: any, options: PdfRoomDetectionOptions = {}): Promise<PdfRoomCandidate[]> {
  const pageNumber = clamp(Math.trunc(options.pageNumber || 1), 1, Math.max(1, pdf.numPages || 1));
  const page = await pdf.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const annotations = await page.getAnnotations({ intent: 'display' });
    const textBoxes = await extractTextBoxes(page, viewport, annotations);

    const annotationShapes = getAnnotationShapes(annotations, viewport, options);
    const rasterShapes = options.includeRasterFallback ? await getRasterColorShapes(page, options) : [];
    const shapes = dedupeShapes([...annotationShapes, ...rasterShapes]);

    return shapes
      .map((shape, index) => {
        const nameInfo = assignNameToShape(shape, textBoxes, viewport, options);
        const geometryConfidence = shape.source === 'annotation' ? 0.92 : 0.68;
        const confidence = clamp(geometryConfidence * 0.58 + nameInfo.nameConfidence * 0.42, 0.15, 0.99);
        return {
          id: `pdf-room-${pageNumber}-${index + 1}`,
          roomName: nameInfo.roomName,
          x: round2(shape.x),
          y: round2(shape.y),
          width: round2(shape.width),
          height: round2(shape.height),
          points: shape.points?.map((p) => ({ x: round2(p.x), y: round2(p.y) })),
          confidence: round2(confidence),
          source: shape.source,
          annotationSubtype: shape.annotationSubtype,
          color: shape.color,
          areaPercent: round2(shape.areaPercent),
          hasDetectedName: nameInfo.hasDetectedName,
          selected: true,
        } satisfies PdfRoomCandidate;
      })
      .sort((a, b) => a.y - b.y || a.x - b.x);
  } finally {
    try { page.cleanup?.(); } catch {}
  }
}

export async function detectPdfRoomCandidates(file: File, options: PdfRoomDetectionOptions = {}): Promise<PdfRoomCandidate[]> {
  const pdf = await loadPdfDocument(file);
  try {
    return await detectPdfRoomCandidatesFromDocument(pdf, options);
  } finally {
    try { await pdf.destroy?.(); } catch {}
  }
}

export const DEFAULT_PDF_ROOM_NAME_PATTERN = '^(?=.*[A-Za-zÀ-ỹ])(?:Căn|Phòng|P\\.?|Room|WC|Khu|Zone)?\\s*[-_. ]?[A-Za-zÀ-ỹ0-9]+(?:[\\s._/#-]+[A-Za-zÀ-ỹ0-9]+){0,3}$';
