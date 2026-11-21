/** Pure room geometry-stage selectors. No mutations, Firebase calls, ID or quantity changes. */
import type { HighlightRegionShape, Point2D, RoomProgressItem } from '../types';
import { findRoomObjectSnap } from './roomHighlightObjectSnap.ts';
import { applyCadDrawingGuide } from './roomHighlightCadShortcuts.ts';
import { validateHighlightShape } from './highlightTotalGeometry.ts';

export const getDirectStageCategory = (stage: { category?: string }, room: Pick<RoomProgressItem, 'workCategory'>): string =>
  stage.category || room.workCategory || 'Chưa phân nhóm';

/** Return saved shapes ONLY. Never include the computed whole-room fallback as a stored drawing. */
export const getSavedDirectHighlightShapes = (room: RoomProgressItem, category: string, target: string): HighlightRegionShape[] => {
  if (target === 'total') return room.categoryHighlightTotalShapes?.[category] || [];
  if (target === 'main') {
    const saved = room.categoryHighlightShapes?.[category];
    const legacy = room.categoryHighlightRegions?.[category];
    return saved?.length ? saved : (legacy ? [legacy] : []);
  }
  const stage = room.subItems?.find((item) => item.id === target && getDirectStageCategory(item, room) === category);
  return stage?.highlightShapes?.length ? stage.highlightShapes : (stage?.highlightRegions || []);
};

/** Geometry-only write; no change to the room's name, status, IDs, quantities or other stages. */
export const withDirectHighlightShapes = (
  room: RoomProgressItem, category: string, target: string, shapes: HighlightRegionShape[],
): RoomProgressItem => {
  if (target === 'total') return {
    ...room,
    categoryHighlightTotalShapes: { ...room.categoryHighlightTotalShapes, [category]: shapes },
  };
  if (target === 'main') return {
    ...room,
    categoryHighlightShapes: { ...room.categoryHighlightShapes, [category]: shapes },
  };
  return {
    ...room,
    subItems: (room.subItems || []).map((stage) => stage.id === target && getDirectStageCategory(stage, room) === category
      ? { ...stage, highlightShapes: shapes }
      : stage),
  };
};

export const getDirectHighlightCategoryNames = (room: RoomProgressItem): string[] => Array.from(new Set([
  room.workCategory,
  ...(room.subItems || []).map((stage) => getDirectStageCategory(stage, room)),
  ...Object.keys(room.categoryHighlightTotalVolumes || {}),
  ...Object.keys(room.categoryHighlightTotalShapes || {}),
  ...Object.keys(room.categoryHighlightShapes || {}),
  ...Object.keys(room.categoryHighlightRegions || {}),
].filter((item): item is string => Boolean(item?.trim()))));


export interface DirectHighlightSaveRequest {
  roomId: string;
  expectedUpdatedAt: number;
  expectedRevision?: number;
  category: string;
  target: string;
  shapes: HighlightRegionShape[];
}

/** Revalidate against the newest in-memory room inside the App state updater. */
export const canApplyDirectHighlightShapes = (room: RoomProgressItem | undefined, request: DirectHighlightSaveRequest): boolean => {
  if (!room || room.id !== request.roomId || room.deletedAt || room.isPolyline || room.width <= 0 || room.height <= 0) return false;
  if (room.updatedAt !== request.expectedUpdatedAt || room.revision !== request.expectedRevision) return false;
  if (room.positionLocked === true || room.inspectionStatus === 'Đạt nghiệm thu') return false;
  if (!getDirectHighlightCategoryNames(room).includes(request.category)) return false;
  if (!Array.isArray(request.shapes) || request.shapes.length < 1 || request.shapes.length > 24) return false;
  if (request.target !== 'total' && request.target !== 'main') {
    const stage = room.subItems?.find((item) => item.id === request.target && getDirectStageCategory(item, room) === request.category);
    if (!stage || stage.status === 'Đã hoàn thành' || stage.inspectionStatus === 'Đạt nghiệm thu') return false;
  }
  return request.shapes.every(validateHighlightShape);
};

/** Mirrors the floor-plan viewer's inverse transform for 0/90/180/270 degrees. */
export const mapDirectHighlightPointerToFloor = (
  clientX: number, clientY: number,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  rotation: number,
): { x: number; y: number } => {
  let x = (clientX - bounds.left) / Math.max(1, bounds.width);
  let y = (clientY - bounds.top) / Math.max(1, bounds.height);
  if (rotation === 90) [x, y] = [y, 1 - x];
  else if (rotation === 180) [x, y] = [1 - x, 1 - y];
  else if (rotation === 270) [x, y] = [1 - y, x];
  return { x: x * 100, y: y * 100 };
};

/**
 * Reuse the floor map's existing OSNAP/CAD guides for new direct highlight points.
 * Object snapping is deliberately scoped to the selected room: a neighbouring
 * room must not pull a corner outside the region being edited. Freehand keeps
 * raw points so a continuous stroke is not distorted by point/grid snapping.
 * All coordinates are the same 0..100 floor percentages as existing map tools.
 */
export interface DirectHighlightSnapOptions {
  room: RoomProgressItem;
  viewport: { width: number; height: number };
  rotation: number;
  pointerType?: string;
  tool: '2point' | 'polygon' | 'freehand';
  anchor?: Point2D | null;
  objectSnapEnabled: boolean;
  objectSnapMidpoints: boolean;
  cadGridSnap: boolean;
  cadOrtho: boolean;
  cadPolar: boolean;
}

export function getDirectHighlightDrawPoint(
  raw: Point2D, options: DirectHighlightSnapOptions,
): { point: Point2D; snapKind: 'vertex' | 'midpoint' | null } {
  if (options.tool === 'freehand') return { point: raw, snapKind: null };
  const rotated = options.rotation === 90 || options.rotation === 270;
  const viewport = rotated
    ? { width: options.viewport.height, height: options.viewport.width }
    : options.viewport;
  if (options.objectSnapEnabled) {
    const candidate = findRoomObjectSnap(raw, [options.room], viewport, {
      tolerancePx: options.pointerType === 'touch' ? 20 : 12,
      midpoints: options.objectSnapMidpoints,
    });
    if (candidate) return { point: candidate.point, snapKind: candidate.kind };
  }
  const guided = applyCadDrawingGuide(
    raw, options.tool === 'polygon' ? options.anchor ?? null : null,
    viewport, { gridSnap: options.cadGridSnap, ortho: options.cadOrtho, polar: options.cadPolar },
  );
  return { point: guided, snapKind: null };
}
