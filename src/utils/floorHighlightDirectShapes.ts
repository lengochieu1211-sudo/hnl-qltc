/** Pure room geometry-stage selectors. No mutations, Firebase calls, ID or quantity changes. */
import type { HighlightRegionShape, Point2D, RoomProgressItem } from '../types';
import { findRoomObjectSnap } from './roomHighlightObjectSnap.ts';
import { applyCadDrawingGuide } from './roomHighlightCadShortcuts.ts';
import { calculateHighlightTotalRatio, getHighlightStageShapes, validateHighlightShape } from './highlightTotalGeometry.ts';

export const getDirectStageCategory = (stage: { category?: string }, room: Pick<RoomProgressItem, 'workCategory'>): string =>
  stage.category || room.workCategory || 'Chưa phân nhóm';

/** The same persisted unit is used by the drawing UI and the authoritative save guard.
 * An empty child unit means "Theo ĐVT chính", NEVER an implicit m² conversion.
 * Unknown secondary-category units fail closed until saved in the room form.
 */
export const getDirectHighlightEffectiveUnit = (
  room: RoomProgressItem, category: string, target: string,
): string => {
  const categoryUnit = String(room.categoryVolumeUnits?.[category] ||
    (room.workCategory === category ? room.volumeUnit || 'm²' : '')).trim();
  if (target === 'main') return categoryUnit;
  const stage = room.subItems?.find(item => item.id === target && getDirectStageCategory(item, room) === category);
  if (!stage) return '';
  return String(stage.volumeUnit || categoryUnit).trim();
};

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
  ...Object.keys(room.categoryVolumes || {}),
  ...Object.keys(room.categoryVolumeUnits || {}),
].filter((item): item is string => Boolean(item?.trim()))));


/**
 * Resolve a room-form category title to the ORIGINAL persisted key before
 * selecting a direct drawing target. Imported categoryVolumes may be keyed by
 * WorkVolume.id, while the room form deliberately renders WorkVolume.title.
 * A mismatched category must never silently fall back to the first entry.
 * This selector is read-only: it does not rename IDs, migrate legacy fields,
 * or change any saved quantities.
 */
export const resolveDirectHighlightLaunchCategory = (
  room: RoomProgressItem,
  requestedLabel: string,
  target: string,
  catalog: ReadonlyArray<{ id: string; title: string }> = [],
): string | null => {
  const requested = requestedLabel.trim();
  if (!requested) return null;
  const names = getDirectHighlightCategoryNames(room);
  const normalize = (value: string) => value.trim().toLocaleLowerCase('vi-VN');
  const labelMatches = (key: string) => key === requested || catalog.some(
    (entry) => entry.id === key && normalize(entry.title) === normalize(requested),
  );
  if (target !== 'main') {
    const stage = room.subItems?.find((item) => item.id === target);
    if (!stage) return null;
    const stageCategory = getDirectStageCategory(stage, room);
    return names.includes(stageCategory) && labelMatches(stageCategory) ? stageCategory : null;
  }
  // A MAIN quantity's existing storage key is authoritative. Do not create a
  // second field under a display title when an imported ID key already exists.
  const keys = Object.keys(room.categoryVolumes || {}).filter(labelMatches);
  if (keys.length > 1) return null; // Ambiguous old keys: fail closed.
  if (keys.length === 1) return names.includes(keys[0]) ? keys[0] : null;
  // Geometries-only legacy category: match an exact key first, then the catalog.
  if (names.includes(requested)) return requested;
  const possible = names.filter(labelMatches);
  return possible.length === 1 ? possible[0] : null;
};


export interface DirectHighlightSaveRequest {
  roomId: string;
  expectedUpdatedAt: number;
  expectedRevision?: number;
  category: string;
  target: string;
  shapes: HighlightRegionShape[];
}

/** Explicit user-approved quantity write. No automatic calculation may use this path. */
export interface DirectHighlightQuantitySaveRequest extends Omit<DirectHighlightSaveRequest, 'shapes'> {
  measuredQuantity: { value: number; unit: 'm' | 'm²' };
  /** Bind measurement to the already-saved, same-source floor calibration. */
  floorId: string;
  expectedFloorSourceKey: string;
  expectedCalibrationUpdatedAt: number;
  /** A new uncommitted polygon may be saved atomically with an area quantity. */
  shapes?: HighlightRegionShape[];
}

export type DirectHighlightCommitRequest = DirectHighlightSaveRequest | DirectHighlightQuantitySaveRequest;

const isEditableDirectTarget = (room: RoomProgressItem | undefined, request: Omit<DirectHighlightSaveRequest, 'shapes'>): boolean => {
  if (!room || room.id !== request.roomId || room.deletedAt || room.isPolyline || room.width <= 0 || room.height <= 0) return false;
  if (room.updatedAt !== request.expectedUpdatedAt || room.revision !== request.expectedRevision) return false;
  if (room.positionLocked === true || room.inspectionStatus === 'Đạt nghiệm thu') return false;
  if (request.target === 'total' || !getDirectHighlightCategoryNames(room).includes(request.category)) return false;
  if (request.target !== 'main') {
    const stage = room.subItems?.find((item) => item.id === request.target && getDirectStageCategory(item, room) === request.category);
    if (!stage || stage.status === 'Đã hoàn thành' || stage.inspectionStatus === 'Đạt nghiệm thu') return false;
  }
  return true;
};

/**
 * Existing auto/shared-total quantities are recalculated by RoomHighlightModal.
 * Reject a direct metric value that would be overwritten by that source on the
 * next form save. Never silently flip legacy auto modes to manual to hide drift.
 * The caller may instead save the geometry only, or explicitly edit the legacy
 * source total/mode in the room form with its existing confirmation semantics.
 */
export function isDirectMetricConsistentWithExistingAuto(room: RoomProgressItem, request: DirectHighlightQuantitySaveRequest): boolean {
  const cat = request.category;
  const stage = request.target === 'main' ? undefined : room.subItems?.find(s => s.id === request.target && getDirectStageCategory(s, room) === cat);
  const usingAuto = request.target === 'main'
    ? room.categoryHighlightAutoMode?.[cat] === true
    : stage?.highlightVolumeMode === 'area';
  if (!usingAuto) return true;
  if (request.measuredQuantity.unit !== 'm²') return false;
  const independentTotal = room.categoryHighlightTotalVolumes?.[cat];
  if (!Number.isFinite(independentTotal) || independentTotal === undefined || independentTotal <= 0) return false;
  const updated = request.shapes?.length
    ? withDirectHighlightShapes(room, cat, request.target, request.shapes)
    : room;
  const main = getSavedDirectHighlightShapes(updated, cat, 'main');
  const currentStage = request.target === 'main' ? undefined : updated.subItems?.find(s => s.id === request.target && getDirectStageCategory(s, updated) === cat);
  const ratio = calculateHighlightTotalRatio({
    room: updated,
    total: updated.categoryHighlightTotalShapes?.[cat] || [],
    main,
    ...(currentStage ? { sub: getHighlightStageShapes(currentStage) } : {}),
  });
  if (!ratio.valid) return false;
  // The form stores 4 decimals; direct measurement saves 3. Allow only
  // the rounding envelope, not a change in formula source/meaning.
  const recalculated = Math.round(independentTotal * ratio.ratio * 10000) / 10000;
  return Math.abs(recalculated - request.measuredQuantity.value) <= 0.0011;
}

/** Unit and accepted-progress validation is repeated on the server transaction's actual room. */
export function canApplyDirectHighlightQuantity(room: RoomProgressItem | undefined, request: DirectHighlightQuantitySaveRequest): boolean {
  if (!isEditableDirectTarget(room, request) || !room) return false;
  const storedUnit = getDirectHighlightEffectiveUnit(room, request.category, request.target)
    .toLowerCase().replace(/\s/g, '').replace('m2', 'm²');
  if (!storedUnit) return false; // Unknown unit must never be treated as a number of m².
  if (storedUnit !== request.measuredQuantity?.unit) return false;
  if (!Number.isFinite(request.measuredQuantity.value) || request.measuredQuantity.value <= 0 || request.measuredQuantity.value > 1_000_000_000) return false;
  if (!request.floorId || request.floorId !== room.floorId || !request.expectedFloorSourceKey ||
      !Number.isFinite(request.expectedCalibrationUpdatedAt) || request.expectedCalibrationUpdatedAt <= 0) return false;
  if (request.shapes !== undefined && (!Array.isArray(request.shapes) || request.shapes.length < 1 ||
      request.shapes.length > 24 || !request.shapes.every(validateHighlightShape))) return false;
  // Never pair an open line measurement with geometry from an unrelated polygon draft.
  if (request.measuredQuantity.unit === 'm' && request.shapes !== undefined) return false;
  // The exact legacy formula is reapplied at the next room form save. Never
  // accept an incompatible direct quantity and quietly destroy that linkage.
  if (!isDirectMetricConsistentWithExistingAuto(room, request)) return false;
  return true;
}

/** Patch ONLY the selected official quantity, preserving sibling subItems and accepted data. */
export function withDirectHighlightQuantity(room: RoomProgressItem, request: DirectHighlightQuantitySaveRequest): RoomProgressItem {
  if (request.target === 'main') return {
    ...room, categoryVolumes: { ...room.categoryVolumes, [request.category]: request.measuredQuantity.value },
    ...(room.workCategory === request.category ? { workVolume: request.measuredQuantity.value } : {}),
    // Keep existing shared-total/auto policy. Manual changes are deliberate
    // room-form actions, not side-effects of measuring a region.
  };
  return {
    ...room,
    subItems: (room.subItems || []).map((s) => s.id === request.target && getDirectStageCategory(s, room) === request.category
      ? { ...s, workVolume: request.measuredQuantity.value } : s),
  };
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
