import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FloorPlan, HighlightRegionShape, Point2D, RoomProgressItem, WorkVolume } from '../types';
import { getValidFloorMetricCalibration, measureHighlightLengthM, measureWallAreaM2 } from '../utils/highlightMetricGeometry';
import { getDirectStageCategory, getSavedDirectHighlightShapes, getDirectHighlightCategoryNames, getDirectHighlightEffectiveUnit, resolveDirectHighlightLaunchCategory, mapDirectHighlightPointerToFloor, getDirectHighlightDrawPoint } from '../utils/floorHighlightDirectShapes';
import { mainHighlightColorKey, childHighlightColorKey } from '../utils/highlightCategoryColors';
import { getCalibratedHighlightRows, measureDirectCategoryArea } from '../utils/highlightMetricCategorySummary.ts';
import { useFloorPlanToolPopover } from '../hooks/useFloorPlanToolPopover';
import type { DirectHighlightCommitRequest, DirectHighlightQuantitySaveRequest } from '../utils/floorHighlightDirectShapes';
import {
  calculateHighlightTotalRatio,
  getHighlightShapeFloorPoints,
  validateHighlightShape,
} from '../utils/highlightTotalGeometry';

/**
 * Direct floor-map highlight drawing. All new drawings are drafts until Save.
 * This deliberately reuses optional room fields; it never edits geometry/IDs,
 * acceptance statuses, manual quantities, Firebase configuration or legacy arrays.
 */
type DrawTool = '2point' | 'polygon' | 'freehand';
type Target = 'total' | 'main' | string;
const LIMIT = 24;
const POINT_LIMIT = 128;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const distance = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);
// Saved region colors come from the floor-wide legend (not a single hard-coded blue).

const roomPoint = (floor: Point2D, room: RoomProgressItem): Point2D => ({
  x: clamp((floor.x - room.x) * 100 / room.width),
  y: clamp((floor.y - room.y) * 100 / room.height),
});
const toRect = (a: Point2D, b: Point2D): HighlightRegionShape => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
});
const toPolygon = (points: Point2D[], mode: 'polygon' | 'freehand'): HighlightRegionShape => ({
  kind: 'polygon', drawMode: mode, points,
});

interface Props {
  room: RoomProgressItem;
  /** WorkVolume titles identify the existing ID-backed room quantity keys. */
  workVolumes?: WorkVolume[];
  floor?: FloorPlan;
  imageContainer: HTMLElement | null;
  rotation: number;
  onSaveShapes: (request: DirectHighlightCommitRequest) => Promise<void>;
  highlightColors: Readonly<Record<string, string>>;
  onShowLayer: (layer: 'totalHighlightRegions' | 'mainHighlightRegions' | 'subItemRegions') => void;
  isLocked: boolean;
  disabled?: boolean;
  /** Layout-only: popover anchored under the fullscreen drawing button; does not resize the floor plan. */
  isFullscreen?: boolean;
  /** Shared selection from the floor-map drawing toolbar; does not change room geometry. */
  selectedTool?: DrawTool;
  toolSwitchGuardRef?: React.MutableRefObject<(() => boolean) | null>;
  /** Parent toolbar selected-tool re-click; asks before discarding unsaved Highlight drafts. */
  closeRequestToken?: number;
  /** One-shot escape/exit request from the floor plan, preserving draft confirmation. */
  exitToPlanRequestToken?: number;
  /** Return to the whole floor map, clearing the selected room only after a safe close. */
  onExitToPlan?: () => void;
  onOpenChange?: (active:boolean)=>void;
  // The same CAD/OSNAP settings already used by the normal room drawing tools.
  objectSnapEnabled: boolean;
  objectSnapMidpoints: boolean;
  cadGridSnap: boolean;
  cadOrtho: boolean;
  cadPolar: boolean;
  /** One-shot navigation from the room form; geometries are still saved separately. */
  launch?: { roomId: string; category: string; target: string; token: number } | null;
}

export const FloorHighlightDirectDraw: React.FC<Props> = ({
  room, workVolumes = [], floor, imageContainer, rotation, onSaveShapes, highlightColors, onShowLayer, isLocked, disabled=false, isFullscreen=false, selectedTool, toolSwitchGuardRef, closeRequestToken=0, exitToPlanRequestToken=0, onExitToPlan, onOpenChange,
  objectSnapEnabled, objectSnapMidpoints, cadGridSnap, cadOrtho, cadPolar, launch,
}) => {
  const [open, setOpen] = useState(false);
  const [lineMode, setLineMode] = useState(false);
  const [measurePath, setMeasurePath] = useState<Point2D[]>([]);
  const [wallHeight, setWallHeight] = useState('3');
  const [wallFaces, setWallFaces] = useState('1');
  const [wallOpenings, setWallOpenings] = useState('0');
  const [category, setCategory] = useState(() => getDirectHighlightCategoryNames(room)[0] || '');
  const [target, setTarget] = useState<Target>('main');
  const tool: DrawTool = selectedTool ?? '2point';
  const fullscreenPopover = useFloorPlanToolPopover(open, isFullscreen, imageContainer,
    `[data-hnl-fullscreen-highlight-tool="${tool}"]`, 340, 0.73);
  const [showOptions, setShowOptions] = useState(false);
  const [showAllCategoryMeasures, setShowAllCategoryMeasures] = useState(false);
  // UI-only choice: a measured m² quantity is written only on deliberate confirmation.
  // Persisting a cross-category shared-source/auto policy needs a separate server-reviewed CAS design.
  const [quantityMode, setQuantityMode] = useState<'measure' | 'manual'>('measure');
  // The map-toolbar tools select Cách 2 geometry, never create a new room.
  // A mode change keeps completed draft regions; only the unfinished gesture is cleared.
  useEffect(() => {
    setCorners([]); setFreehand([]); setHover(null); setSnapMarker(null);
    freehandRef.current = []; activePointerRef.current = null;
    setLineMode(false); setMeasurePath([]);
  }, [selectedTool]);
  const [draft, setDraft] = useState<HighlightRegionShape[]>([]);
  const [corners, setCorners] = useState<Point2D[]>([]);
  const [hover, setHover] = useState<Point2D | null>(null);
  const [freehand, setFreehand] = useState<Point2D[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [snapMarker, setSnapMarker] = useState<{ point: Point2D; kind: 'vertex' | 'midpoint' } | null>(null);
  const freehandRef = useRef<Point2D[]>([]);
  const activePointerRef = useRef<number | null>(null);
  const baselineRef = useRef<{ revision?: number; updatedAt: number } | null>(null);
  const categories = useMemo(() => getDirectHighlightCategoryNames(room), [room]);
  const currentCategory = categories.includes(category) ? category : (categories[0] || '');
  const categoryCatalog = workVolumes.find((item) => item.id === currentCategory);
  const displayCategory = categoryCatalog?.title || currentCategory;
  const stages = (room.subItems || []).filter((stage) => getDirectStageCategory(stage, room) === currentCategory);
  const currentTarget: Target = target === 'main' || stages.some((stage) => stage.id === target) ? target : 'main';
  const targetStage = stages.find((stage) => stage.id === currentTarget);
  const currentHighlightColor = currentTarget === 'total' ? '#64748b'
    : currentTarget === 'main' ? (highlightColors[mainHighlightColorKey(currentCategory)] || '#2563eb')
    : (highlightColors[childHighlightColorKey(currentCategory, targetStage?.name?.trim() || targetStage?.id || currentTarget)] || '#16a34a');
  const locked = isLocked || room.positionLocked === true || room.inspectionStatus === 'Đạt nghiệm thu' ||
    Boolean(targetStage && (targetStage.status === 'Đã hoàn thành' || targetStage.inspectionStatus === 'Đạt nghiệm thu'));
  const oldShapes = useMemo(() => getSavedDirectHighlightShapes(room, currentCategory, currentTarget), [room, currentCategory, currentTarget]);
  const candidateShapes = useMemo(() => replaceExisting ? draft : [...oldShapes, ...draft], [replaceExisting, oldShapes, draft]);
  const missingTarget = currentTarget !== target;
  const visibleShapes = draft.map((shape) => getHighlightShapeFloorPoints(room, shape)).filter((item): item is Point2D[] => Boolean(item));
  const existingShapes = oldShapes.map((shape) => getHighlightShapeFloorPoints(room, shape)).filter((item): item is Point2D[] => Boolean(item));
  const selectedCategoryTotal = currentTarget === 'total' ? candidateShapes : getSavedDirectHighlightShapes(room, currentCategory, 'total');
  const selectedCategoryMain = currentTarget === 'main' ? candidateShapes : getSavedDirectHighlightShapes(room, currentCategory, 'main');
  const selectedCategorySub = targetStage ? (currentTarget === targetStage.id ? candidateShapes : getSavedDirectHighlightShapes(room, currentCategory, targetStage.id)) : [];
  // The geometry engine partitions polygon edges; don't rerun it on every cursor move.
  const previewRatio = useMemo(() => calculateHighlightTotalRatio({
    room, total: selectedCategoryTotal, main: selectedCategoryMain, sub: selectedCategorySub,
  }), [room, currentCategory, currentTarget, candidateShapes]);
  // Image loading may finish after the editor mounts (Android/R2). Subscribe to
  // natural dimensions instead of depending on an unrelated parent re-render.
  const [imageDimensions, setImageDimensions] = useState({width:0,height:0});
  useEffect(() => {
    const image = imageContainer?.querySelector('img');
    if (!image) { setImageDimensions({width:0,height:0}); return; }
    const readDimensions = () => setImageDimensions({width:image.naturalWidth || 0,height:image.naturalHeight || 0});
    readDimensions();
    image.addEventListener('load', readDimensions);
    return () => image.removeEventListener('load', readDimensions);
  }, [imageContainer, floor?.imageUrl]);
  // Intersection/union area may require an O(edges²) sweep: never recompute on hover.
  const metricPreview = useMemo(() => floor ? measureDirectCategoryArea({
    floor, image: imageDimensions, room, category:currentCategory, target:currentTarget, shapes:candidateShapes,
  }) : { valid: false as const, reason: 'Chưa chọn mặt bằng.' },
  [floor, imageDimensions.width, imageDimensions.height, room, currentCategory, currentTarget, candidateShapes]);
  // Calculate all existing main/stage areas from the approved floor calibration,
  // without cloud writes and without recategorizing any manually entered quantities.
  const calibratedRows = useMemo(() => getCalibratedHighlightRows(room, floor, imageDimensions, workVolumes),
    [room, floor, imageDimensions.width, imageDimensions.height, workVolumes]);
  const calculatedRows = calibratedRows.filter((row) => row.areaM2 !== null);
  const formatted = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
  // The persisted category unit (including a child's inherited unit) is shared
  // with the server-side guard. Unknown legacy aliases cannot silently become m².
  const activeUnit = getDirectHighlightEffectiveUnit(room, currentCategory, currentTarget);
  const unitLabel = activeUnit || 'Chưa xác định ĐVT';
  const inheritedRegion = Boolean(targetStage && oldShapes.length === 0 && draft.length === 0);
  const savedQuantity = currentTarget === 'main'
    ? room.categoryVolumes?.[currentCategory] ?? (room.workCategory === currentCategory ? room.workVolume : undefined)
    : targetStage?.workVolume;
  const autoByKey = currentTarget === 'main' ? room.categoryHighlightAutoMode?.[currentCategory] === true : targetStage?.highlightVolumeMode === 'area';
  const autoByDisplayAlias = currentTarget === 'main' && currentCategory !== displayCategory && room.categoryHighlightAutoMode?.[displayCategory] === true;
  // When old auto policy uses a display name but the stored quantity uses an
  // ID, require explicit reconciliation instead of accidentally writing to an
  // incompatible source key. Geometry can still be viewed/read without writes.
  const unresolvedAutoAlias = autoByDisplayAlias && !autoByKey;
  const autoMode = autoByKey || autoByDisplayAlias;
  const isAreaUnit = ['m2','m²'].includes(activeUnit.trim().toLowerCase().replace(/\s/g,''));
  const isLengthUnit = activeUnit.trim().toLowerCase().replace(/\s/g,'') === 'm';
  const calibrationStatus = floor ? getValidFloorMetricCalibration(floor, imageDimensions)
    : {valid:false as const, reason:'Chưa chọn mặt bằng.'};
  const linePreview = floor ? measureHighlightLengthM({floor, image:imageDimensions, floorPath:measurePath})
    : {valid:false as const, reason:'Chưa chọn mặt bằng.'};
  const wallAreaPreview = linePreview.valid ? measureWallAreaM2(linePreview.value,
    Number(wallHeight.replace(',','.')), Number(wallFaces), Number(wallOpenings.replace(',','.'))) : null;

  const clearWork = () => {
    setDraft([]); setCorners([]); setFreehand([]); setMeasurePath([]); setHover(null); setNotice(''); setSnapMarker(null);
    freehandRef.current = []; activePointerRef.current = null;
  };
  // Use one exit gate for toolbar re-clicks, the visible back-to-plan button and Esc.
  // A cancelled confirmation must leave both the editor and its room selection intact.
  const exitDrawing = (toPlan: boolean): void => {
    if (saving || !open) return;
    if ((draft.length || corners.length || freehand.length || measurePath.length) &&
        !window.confirm('Tắt vẽ Highlight và bỏ phần chưa lưu?')) return;
    clearWork();
    baselineRef.current = null;
    setOpen(false);
    onOpenChange?.(false);
    if (toPlan) onExitToPlan?.();
  };
  useEffect(() => {
    if (closeRequestToken) exitDrawing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeRequestToken]);
  useEffect(() => {
    if (exitToPlanRequestToken) exitDrawing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitToPlanRequestToken]);
  const confirmDiscardGesture = (): boolean => !saving && (
    !(corners.length || freehand.length || freehandRef.current.length || measurePath.length) ||
    window.confirm('Đổi công cụ sẽ bỏ nét hoặc tuyến đo chưa hoàn thành. Tiếp tục?'));
  React.useLayoutEffect(() => {
    if (!toolSwitchGuardRef) return;
    toolSwitchGuardRef.current = confirmDiscardGesture;
    return () => { toolSwitchGuardRef.current = null; };
  });
  const confirmSwitchWithDraft = (): boolean =>
    !(draft.length || corners.length || freehand.length || measurePath.length) ||
    window.confirm('Đổi hạng mục sẽ bỏ vùng đang vẽ chưa lưu. Tiếp tục?');
  const changeTarget = (next: Target) => {
    if (next === currentTarget || !confirmSwitchWithDraft()) return;
    clearWork(); setTarget(next); setReplaceExisting(false);
  };
  const changeCategory = (next: string) => {
    if (next === currentCategory || !confirmSwitchWithDraft()) return;
    clearWork(); setCategory(next); setTarget('main'); setReplaceExisting(false);
  };
  React.useEffect(() => {
    if (!launch || launch.roomId !== room.id || !imageContainer || disabled || locked || room.isPolyline || room.width <= 0 || room.height <= 0) return;
    const chosenCategory = resolveDirectHighlightLaunchCategory(room, launch.category, launch.target, workVolumes);
    if (!chosenCategory) {
      setOpen(false); onOpenChange?.(false);
      setNotice(`Không xác định được khóa lưu của hạng mục “${launch.category}”. Hãy kiểm tra ID/tên hoặc khóa trùng trong biểu mẫu; không tự chọn hạng mục khác.`);
      return;
    }
    const chosenTarget = launch.target === 'main' || (room.subItems || []).some(s => s.id === launch.target && getDirectStageCategory(s, room) === chosenCategory)
      ? launch.target : 'main';
    setCategory(chosenCategory);
    setTarget(chosenTarget);
    setLineMode(false);
    clearWork(); setReplaceExisting(false);
    baselineRef.current = { revision: room.revision, updatedAt: room.updatedAt };
    setOpen(true); setShowOptions(false); setQuantityMode('measure'); onOpenChange?.(true);
    // Opening is keyed exclusively by the deliberate navigation token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch?.token, room.id, imageContainer]);

  const toggle = () => {
    if (saving) return;
    if (open) { exitDrawing(false); return; }
    if (disabled) return;
    if (locked || !imageContainer || room.width <= 0 || room.height <= 0 || room.isPolyline) {
      setNotice('Không thể vẽ: vùng phòng không hợp lệ, đang khóa hoặc đã nghiệm thu.'); return;
    }
    baselineRef.current = { revision: room.revision, updatedAt: room.updatedAt };
    setReplaceExisting(false); setLineMode(false);
    setOpen(true); setShowOptions(false); setQuantityMode('measure'); onOpenChange?.(true); clearWork();
  };
  const addShape = (shape: HighlightRegionShape) => {
    if (!validateHighlightShape(shape)) { setNotice('Vùng vẽ không hợp lệ hoặc quá nhỏ.'); return; }
    if (draft.length + (replaceExisting ? 0 : oldShapes.length) >= LIMIT) {
      setNotice('Mỗi nhóm tối đa 24 vùng. Hãy chỉnh/xóa vùng cũ trong cửa sổ chi tiết.'); return;
    }
    setDraft((prev) => [...prev, shape]);
    setCorners([]); setFreehand([]); setHover(null); setNotice('Đã thêm vùng nháp. Nhấn Lưu vùng để ghi.');
  };
  const getPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = imageContainer!.getBoundingClientRect();
    const raw = mapDirectHighlightPointerToFloor(event.clientX, event.clientY, rect, rotation);
    const result = getDirectHighlightDrawPoint(raw, {
      room, viewport: { width: rect.width, height: rect.height }, rotation,
      pointerType: event.pointerType, tool,
      anchor: tool === 'polygon' && corners.length ? {
        x: room.x + corners[corners.length - 1].x * room.width / 100,
        y: room.y + corners[corners.length - 1].y * room.height / 100,
      } : null,
      objectSnapEnabled, objectSnapMidpoints, cadGridSnap, cadOrtho, cadPolar,
    });
    return { point: roomPoint(result.point, room),
      marker: result.snapKind ? { point: result.point, kind: result.snapKind } : null };
  };
  const handleDown = (event: React.PointerEvent<SVGSVGElement>) => {
    event.stopPropagation(); event.preventDefault();
    if (saving || locked || event.button > 0 || !imageContainer) return;
    const { point, marker } = getPoint(event);
    setSnapMarker(marker);
    if (lineMode) {
      setMeasurePath(prev => prev.length >= 128 ? prev : [...prev, {
        x: room.x + point.x * room.width / 100,
        y: room.y + point.y * room.height / 100,
      }]);
      return;
    }
    if (tool === '2point') {
      if (corners.length === 1) addShape(toRect(corners[0], point));
      else setCorners([point]);
    } else if (tool === 'polygon') {
      setCorners((prev) => prev.length >= POINT_LIMIT ? prev : [...prev, point]);
    } else {
      activePointerRef.current = event.pointerId;
      freehandRef.current = [point];
      setFreehand([point]);
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* optional */ }
    }
  };
  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    event.stopPropagation();
    if (!imageContainer) return;
    const { point, marker } = getPoint(event);
    setSnapMarker(marker);
    setHover(point);
    if (lineMode || tool !== 'freehand' || activePointerRef.current !== event.pointerId) return;
    const prev = freehandRef.current;
    if (prev.length < POINT_LIMIT && distance(prev[prev.length - 1], point) >= 0.5) {
      freehandRef.current = [...prev, point]; setFreehand(freehandRef.current);
    }
  };
  const endFreehand = (event: React.PointerEvent<SVGSVGElement>) => {
    event.stopPropagation();
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* optional */ }
    const pts = freehandRef.current;
    freehandRef.current = [];
    if (pts.length >= 3) addShape(toPolygon(pts, 'freehand'));
    else { setFreehand([]); setNotice('Cần khoanh vùng kín bằng ít nhất 3 điểm.'); }
  };
  const closeAfterServerAck = () => {
    onShowLayer(currentTarget === 'total' ? 'totalHighlightRegions' : currentTarget === 'main' ? 'mainHighlightRegions' : 'subItemRegions');
    clearWork(); setOpen(false); onOpenChange?.(false); baselineRef.current = null;
  };
  const isSameRoomDraft = () => Boolean(baselineRef.current &&
    baselineRef.current.revision === room.revision && baselineRef.current.updatedAt === room.updatedAt);
  const save = async () => {
    if (saving || lineMode || !draft.length || !currentCategory || locked || unresolvedAutoAlias || !baselineRef.current) return;
    if (missingTarget) { setNotice('Hạng mục đã thay đổi. Chọn lại vùng trước khi lưu.'); return; }
    if (baselineRef.current.revision !== room.revision || baselineRef.current.updatedAt !== room.updatedAt) {
      setNotice('Phòng đã thay đổi trong lúc vẽ. Hủy chế độ vẽ, mở lại để lấy dữ liệu mới; chưa lưu gì.'); return;
    }
    if (!replaceExisting && oldShapes.length + draft.length > LIMIT) {
      setNotice('Vượt quá 24 vùng; chưa lưu.'); return;
    }
    if (!candidateShapes.every(validateHighlightShape) || !previewRatio.valid) {
      setNotice(previewRatio.reason || 'Vùng hình học không hợp lệ; chưa lưu.'); return;
    }
    if (replaceExisting && oldShapes.length && !window.confirm('Thay các vùng đã lưu bằng vùng mới? Các khối lượng và trạng thái nghiệm thu vẫn giữ nguyên.')) return;
    setSaving(true); setNotice('Đang xác nhận phiên bản trên Firestore...');
    try {
      await onSaveShapes({
        roomId: room.id, expectedUpdatedAt: baselineRef.current.updatedAt,
        expectedRevision: baselineRef.current.revision, category: currentCategory,
        target: currentTarget, shapes: candidateShapes,
      });
      closeAfterServerAck();
    } catch (error) {
      setNotice(`Chưa lưu vùng: ${error instanceof Error ? error.message : String(error)}. Bản nháp vẫn còn.`);
    } finally { setSaving(false); }
  };

  /** Explicit user confirmation: region edits do NOT change official quantity until server CAS succeeds. */
  const confirmMeasuredQuantity = async (kind: 'area' | 'length' | 'wall') => {
    if (unresolvedAutoAlias) { setNotice('Khối lượng gốc dùng ID còn chế độ tự tính dùng tên. Cần đối chiếu nguồn tự tính trước khi lưu; dữ liệu cũ được giữ nguyên.'); return; }
    if (saving || locked || disabled || !floor || !isSameRoomDraft() || !baselineRef.current || missingTarget) {
      setNotice('Bản vẽ hoặc dữ liệu phòng đã thay đổi. Mở lại công cụ trước khi xác nhận.'); return;
    }
    const calibration = getValidFloorMetricCalibration(floor, imageDimensions);
    if (!calibration.valid) { setNotice('reason' in calibration ? calibration.reason : 'Cần hiệu chuẩn lại.'); return; }
    const measure = kind === 'area' ? metricPreview : kind === 'length' ? linePreview : wallAreaPreview;
    if (!measure || !measure.valid || measure.value <= 0) {
      setNotice('Giá trị đo không hợp lệ, không thể cập nhật khối lượng.'); return;
    }
    if (kind === 'length' ? !isLengthUnit : !isAreaUnit) {
      setNotice('Đơn vị hạng mục không khớp m hoặc m². Không tự chuyển đổi đơn vị.'); return;
    }
    if (kind === 'area' && (!candidateShapes.length || candidateShapes.length > LIMIT || !previewRatio.valid || !candidateShapes.every(validateHighlightShape))) {
      setNotice('Cần vùng vẽ hợp lệ trước khi chuyển diện tích thành khối lượng.'); return;
    }
    const value = Math.round(measure.value * 1000) / 1000;
    if (!Number.isFinite(value) || value <= 0) { setNotice('Khối lượng làm tròn không hợp lệ.'); return; }
    const oldQuantity = savedQuantity;
    const label = currentTarget === 'main' ? `hạng mục chính “${currentCategory}”` : `hạng mục con “${targetStage?.name || currentTarget}”`;
    const unit = measure.unit;
    if (!window.confirm(`XÁC NHẬN CẬP NHẬT KHỐI LƯỢNG CHÍNH THỨC\n${label}\n` +
      `Giá trị cũ: ${oldQuantity ?? 'chưa nhập'} ${activeUnit}\nGiá trị đo mới: ${value} ${unit}\n` +
      `${kind === 'area' && replaceExisting && oldShapes.length ? 'Các vùng cũ của đúng hạng mục này sẽ được thay thế. ' : ''}Chỉ ADMIN được xác nhận. Vùng cũ của hạng mục khác và dữ liệu lịch sử vẫn giữ nguyên. Tiếp tục?`)) return;
    const request: DirectHighlightQuantitySaveRequest = {
      roomId: room.id, expectedUpdatedAt: baselineRef.current.updatedAt,
      expectedRevision: baselineRef.current.revision, category: currentCategory, target: currentTarget,
      floorId: floor.id, expectedFloorSourceKey: calibration.value.sourceKey,
      expectedCalibrationUpdatedAt: calibration.value.updatedAt,
      measuredQuantity: {value, unit}, measurementKind:kind,
      ...(kind === 'area' && draft.length ? {shapes: candidateShapes} : {}),
    };
    setSaving(true); setNotice('Đang đối chiếu phiên bản phòng và hiệu chuẩn trên Firestore...');
    try {
      await onSaveShapes(request);
      closeAfterServerAck();
    } catch (error) {
      setNotice(`Chưa cập nhật KL: ${error instanceof Error ? error.message : String(error)}. Nếu hạng mục đang dùng vùng tổng tự tính, hãy kiểm tra lại nguồn vùng tổng trong Căn/Phòng; không tự đổi sang nhập tay. Bản nháp và KL cũ giữ nguyên.`);
    } finally { setSaving(false); }
  };
  // FloorPlanDefectTab handles Esc in capture phase so it cannot unselect
  // the room before this editor has checked and confirmed unsaved drafts.
  const toFloorSvg = (points: Point2D[]): string => points.map((p) => `${room.x + room.width * p.x / 100},${room.y + room.height * p.y / 100}`).join(' ');
  const activePreview = corners.length ? corners.concat(hover && tool !== 'freehand' ? [hover] : []) : freehand;
  const hasDrawPermission = !locked && !disabled && room.width > 0 && room.height > 0 && !room.isPolyline;
  // The user opens this editor from the "Mặt bằng" action beside the target quantity.
  // Do not render an extra launch button simply because a Căn/Phòng is selected.
  // All hooks/effects (including the explicit launch token) remain active above.
  if (!open) return null;
  return <>
    <div data-hnl-direct-highlight-toolbar="true" data-hnl-direct-highlight-layout={isFullscreen ? 'fullscreen-docked' : 'plan-floating'}
      style={isFullscreen ? fullscreenPopover : undefined}
      className={isFullscreen
        ? 'absolute left-2 top-16 z-[85] pointer-events-auto max-w-[calc(100%-16px)] max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain'
        : 'absolute right-2 top-14 z-[80] pointer-events-auto max-w-[calc(100%-16px)] max-h-[calc(100%-7rem)] overflow-y-auto overscroll-contain'}>
      <div className={`rounded-xl border border-sky-400/50 bg-slate-950/95 p-2 text-white shadow-2xl text-[11px] ${open ? 'w-[min(340px,calc(100vw-32px))]' : 'w-fit'}`}>
        <div className="flex items-center justify-between gap-1.5">
          {open && <span className="font-extrabold truncate min-w-0">Đo vẽ KL · {room.roomName}</span>}
          {open && <button type="button" data-hnl-direct-highlight-options-toggle="true"
            aria-expanded={showOptions} onClick={() => setShowOptions(v => !v)}
            className="shrink-0 px-2 py-1.5 rounded-lg border border-slate-600 bg-slate-800">
            {showOptions ? 'Thu gọn' : 'Tùy chọn ▾'}
          </button>}
          <button type="button" data-hnl-direct-highlight-exit-to-plan="true"
            disabled={saving} onClick={() => exitDrawing(true)}
            aria-label="Thoát vẽ về mặt bằng" title="Thoát về mặt bằng · Esc"
            className="shrink-0 px-2.5 py-1.5 rounded-lg border border-slate-600 bg-slate-800 font-bold hover:bg-slate-700 disabled:opacity-40">
            ↩ Mặt bằng
          </button>
          <button type="button" disabled={saving || (!hasDrawPermission && !open)} aria-pressed={open} onClick={toggle}
            aria-label={open ? 'Tắt Đo vẽ khối lượng' : 'Bật Đo vẽ khối lượng'}
            className={`shrink-0 px-2.5 py-1.5 rounded-lg font-bold ${open ? 'bg-rose-700' : 'bg-sky-600 disabled:bg-slate-700'}`}>
            {open ? 'Tắt vẽ' : 'Đo vẽ KL'}
          </button>
        </div>
        {open && <div className="mt-1.5 space-y-1.5 border-t border-slate-700 pt-1.5" data-hnl-direct-highlight-edit="true">
          <div data-hnl-highlight-active-color="true" className="flex items-center gap-2 text-[10px] text-sky-200 min-w-0" title={currentCategory}>
            <span aria-hidden="true" className="w-3.5 h-3.5 rounded-sm shrink-0 border border-white/50" style={{backgroundColor:currentHighlightColor}} />
            <span className="truncate">{displayCategory || 'Chưa chọn hạng mục'} · {targetStage?.name || 'Hạng mục chính'} · {lineMode ? 'Đo tuyến' : tool === '2point' ? 'Vẽ chữ nhật' : tool === 'polygon' ? 'Vẽ đa giác' : 'Vẽ tự do'}</span>
          </div>
          <div data-hnl-direct-highlight-quantity-summary="true" className="rounded-lg border border-slate-700 bg-slate-900/75 px-2 py-1.5 space-y-0.5 text-[10px] leading-snug">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              <span>KL đang lưu: <b className="text-emerald-200">{savedQuantity === undefined ? 'Chưa nhập' : Number(savedQuantity).toLocaleString('vi-VN', {maximumFractionDigits:3})} {unitLabel}</b></span>
              <span>Đo theo vùng: <b className="text-sky-200">{metricPreview.valid ? `${metricPreview.value.toLocaleString('vi-VN', {maximumFractionDigits:2})} m²` : 'Chưa có vùng đo hợp lệ'}</b></span>
            </div>
            <div className="text-slate-300">Nguồn KL: {autoMode ? 'Tự tính theo vùng' : 'Theo giá trị đang lưu / nhập tay'} · {calibrationStatus.valid ? 'Đã hiệu chuẩn tỷ lệ' : 'Chưa có tỷ lệ hợp lệ'}</div>
            {inheritedRegion && <div data-hnl-highlight-inherited-region="true" className="text-amber-200">Vùng con chưa vẽ riêng: số đo tham khảo vùng chính, không phải vùng con đã lưu.</div>}
            {!activeUnit && <div data-hnl-highlight-unit-unknown="true" className="text-amber-200">Chưa xác định ĐVT gốc; kiểm tra ĐVT trong Căn/Phòng trước khi ghi KL.</div>}
            {!calibrationStatus.valid && <div className="text-amber-200 font-bold" data-hnl-metric-calibration-warning="true">
              {'reason' in calibrationStatus ? calibrationStatus.reason : 'Cần hiệu chuẩn tỷ lệ.'} Nhấn “Đo tỷ lệ” trên thanh công cụ mặt bằng trước khi tính m².
            </div>}
            {calibrationStatus.valid && <div className="text-slate-300">Vẽ vùng → xem khối lượng m² → nhấn “Lưu vùng + KL” và xác nhận để cập nhật khối lượng.</div>}
            {unresolvedAutoAlias && <div className="text-amber-300 font-bold">Khóa KL dùng ID nhưng chế độ tự tính dùng tên: chỉ xem, cần đối chiếu dữ liệu trước khi lưu.</div>}
          </div>
          {calibrationStatus.valid && calibratedRows.length > 0 && (
            <div data-hnl-calibrated-main-sub-quantities="true" className="rounded-lg border border-slate-700 bg-slate-900/70 px-2 py-1.5 text-[10px]">
              <button type="button" aria-expanded={showAllCategoryMeasures}
                onClick={() => setShowAllCategoryMeasures(v => !v)}
                className="w-full flex items-center justify-between gap-2 font-bold text-sky-200 text-left">
                <span>Diện tích chính/con · {calculatedRows.length}/{calibratedRows.length}</span>
                <span>{showAllCategoryMeasures ? 'Thu gọn' : 'Xem'}</span>
              </button>
              {showAllCategoryMeasures && (
                <div className="mt-1 max-h-28 overflow-y-auto space-y-1 pr-1" aria-label="Diện tích đo theo tỷ lệ của các hạng mục đã gán">
                  {calibratedRows.map((row) => (
                    <div key={row.id} className="flex items-start justify-between gap-1.5 border-b border-slate-700/60 pb-1 last:border-0" title={`${row.categoryName} · ${row.label}`}>
                      <span className="min-w-0 flex-1 truncate text-slate-200">
                        {row.categoryName} / {row.label}
                        <span className="block text-[9px] text-slate-400">
                          {row.source === 'room' ? 'Theo biên Căn/Phòng' : row.source === 'main' ? 'Theo vùng chính' : 'Theo vùng riêng'}
                          {row.autoPolicy ? ' · Công thức vùng tổng' : ' · KL nhập tay giữ nguyên'}
                        </span>
                        <span className="block text-[9px] text-slate-400">
                          Đang lưu: {typeof row.savedQuantity === 'number' && Number.isFinite(row.savedQuantity) ? `${formatted(row.savedQuantity)} ${row.storedUnit || '· Chưa xác định ĐVT'}` : 'Chưa nhập'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right font-bold text-sky-200">
                        {row.areaM2 === null ? 'Chưa đo được' : `${formatted(row.areaM2)} m²`}
                        {row.warning && <span className="block text-[9px] text-amber-300 font-normal" title={row.warning}>Chỉ tham khảo ĐVT</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-1 text-slate-400">Số đo xem trước, không tự ghi KL. Vùng con có thể dùng chung vùng chính; không cộng trùng.</div>
            </div>
          )}
          {showOptions && <div className="space-y-1.5" data-hnl-direct-highlight-advanced="true">
          <label className="block font-bold">Hạng mục chính
            <select aria-label="Hạng mục chính của vùng highlight" className="mt-1 w-full rounded-lg bg-white text-slate-900 p-2" value={currentCategory}
              onChange={(event) => changeCategory(event.target.value)}>
              {categories.map((name) => <option key={name} value={name}>{workVolumes.find((item) => item.id === name)?.title || name}</option>)}
            </select>
          </label>
          <label className="block font-bold">Vùng cần vẽ
            <select aria-label="Vùng hạng mục chính hoặc con trên mặt bằng" className="mt-1 w-full rounded-lg bg-white text-slate-900 p-2" value={currentTarget}
              onChange={(event) => changeTarget(event.target.value)}>
              <option value="main">Hạng mục chính</option>
              {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
            </select>
          </label>
          </div>}
          <button type="button" data-hnl-cach2-line-mode="true" aria-pressed={lineMode}
            disabled={draft.length > 0} onClick={() => { if (!confirmDiscardGesture()) return; setLineMode(v=>!v); setMeasurePath([]); setCorners([]); setFreehand([]); setHover(null); setSnapMarker(null); freehandRef.current=[]; activePointerRef.current=null; }}
            className={`w-full rounded-md border p-1.5 text-left font-bold ${lineMode?'border-teal-300 bg-teal-800':'border-slate-600 bg-slate-800'}`}>
            {lineMode ? '◉ Đang đo chiều dài / vách' : '📏 Đo chiều dài / vách'}
          </button>
          {lineMode && <div className="space-y-1 text-[10px]" data-hnl-cach2-length-preview="true">
            <div>Chạm lần lượt các điểm theo tuyến. {measurePath.length} điểm. Tuyến không tự chuyển thành vùng khép kín.</div>
            <div className="font-bold text-teal-200">{linePreview.valid
              ? `Chiều dài thực tế: ${linePreview.value.toLocaleString('vi-VN',{maximumFractionDigits:2})} m`
              : ('reason' in linePreview ? linePreview.reason : 'Chưa đo được tuyến.')}</div>
            <div className="grid grid-cols-3 gap-1">
              <label>Cao vách (m)<input aria-label="Chiều cao vách mét" value={wallHeight} onChange={e=>setWallHeight(e.target.value)} inputMode="decimal" className="w-full rounded bg-white text-slate-900 p-1" /></label>
              <label>Số mặt<input aria-label="Số mặt vách" value={wallFaces} onChange={e=>setWallFaces(e.target.value)} inputMode="numeric" className="w-full rounded bg-white text-slate-900 p-1" /></label>
              <label>Ô trống (m²)<input aria-label="Diện tích ô trống" value={wallOpenings} onChange={e=>setWallOpenings(e.target.value)} inputMode="decimal" className="w-full rounded bg-white text-slate-900 p-1" /></label>
            </div>
            {wallAreaPreview && <div className="font-bold text-emerald-200">{wallAreaPreview.valid
              ? `Diện tích vách: ${wallAreaPreview.value.toLocaleString('vi-VN',{maximumFractionDigits:2})} m²`
              : ('reason' in wallAreaPreview ? wallAreaPreview.reason : 'Không tính được diện tích vách.')}</div>}
            <button type="button" onClick={()=>setMeasurePath(prev=>prev.slice(0,-1))} disabled={!measurePath.length} className="rounded bg-slate-700 px-2 py-1 disabled:opacity-50">Lùi 1 điểm</button>
          </div>}
          {lineMode && <div className="flex flex-wrap gap-1" data-hnl-cach2-confirm-line-quantity="true">
            {isLengthUnit && <button type="button" disabled={saving || locked || missingTarget || !linePreview.valid}
              onClick={() => void confirmMeasuredQuantity('length')} className="rounded bg-emerald-700 px-2 py-1 disabled:opacity-50 font-bold">Xác nhận KL tuyến (m)</button>}
            {isAreaUnit && <button type="button" disabled={saving || locked || missingTarget || !wallAreaPreview?.valid}
              onClick={() => void confirmMeasuredQuantity('wall')} className="rounded bg-emerald-700 px-2 py-1 disabled:opacity-50 font-bold">Xác nhận KL vách (m²)</button>}
          </div>}
          {showOptions && <div data-hnl-direct-highlight-cad-settings="true" className="text-[10px] text-sky-200">
            Bắt điểm có sẵn: OSNAP {objectSnapEnabled ? (objectSnapMidpoints ? '(góc + trung điểm)' : '(góc)') : 'tắt'} · Lưới {cadGridSnap ? 'bật' : 'tắt'} · Vuông góc {cadOrtho ? 'bật' : 'tắt'} · Góc {cadPolar ? 'bật' : 'tắt'}.
            {tool === 'freehand' ? ' Nét tự do giữ nguyên, không hút từng điểm.' : ''}
          </div>}
          <div className="text-[10px] text-slate-200">{lineMode ? 'Đang đo tuyến m: chưa lưu kết quả vào khối lượng.' : tool === '2point' ? 'Chạm 2 góc đối diện.' : tool === 'polygon' ? `Chấm các đỉnh rồi bấm Chốt (${corners.length} điểm).` : 'Nhấn giữ và rê để khoanh vùng.'} Dữ liệu chưa ghi khi đang vẽ.</div>
          {tool === 'polygon' && <div className="flex gap-1">
            <button type="button" disabled={corners.length < 3} onClick={() => addShape(toPolygon(corners, 'polygon'))} className="rounded-lg bg-emerald-700 disabled:opacity-50 px-2 py-1">Chốt đa giác</button>
            <button type="button" disabled={!corners.length} onClick={() => setCorners((prev) => prev.slice(0, -1))} className="rounded-lg bg-slate-700 px-2 py-1">Lùi 1 điểm</button>
          </div>}
          {showOptions && <label className="flex items-center gap-2 text-amber-200"><input type="checkbox" checked={replaceExisting}
            onChange={(event) => {
              if ((draft.length || corners.length || freehand.length || measurePath.length) &&
                !window.confirm('Đổi chế độ thay vùng sẽ xóa các vùng nháp chưa lưu. Tiếp tục?')) return;
              clearWork(); setReplaceExisting(event.target.checked);
            }} />Thay thế các vùng cũ (cần xác nhận)</label>}
          {!lineMode && <label className="flex flex-wrap items-center gap-2 text-[10px] font-bold" data-hnl-metric-quantity-mode="true">
            Tính khối lượng
            <select aria-label="Chế độ tính khối lượng theo vùng" value={isAreaUnit ? quantityMode : 'manual'}
              disabled={!isAreaUnit || saving}
              onChange={(event) => setQuantityMode(event.target.value as 'manual' | 'measure')}
              className="rounded border border-slate-500 bg-slate-900 px-2 py-1 text-white">
              <option value="measure">Đo m² · xác nhận lưu</option>
              <option value="manual">Nhập tay</option>
            </select>
            {!isAreaUnit && <span className="font-normal text-amber-200">ĐVT {activeUnit} không quy đổi từ m²; nhập tay trong Căn/Phòng</span>}
          </label>}
          <div data-hnl-cach2-area-preview="true" className="text-[10px]">
            Có {oldShapes.length} vùng cũ · {draft.length} vùng nháp.
            {isAreaUnit ? (metricPreview.valid
              ? ` KL tự tính: ${metricPreview.value.toLocaleString('vi-VN', {maximumFractionDigits:2})} m² (xem trước)`
              : ` ${'reason' in metricPreview ? metricPreview.reason : 'Chưa có kết quả đo'}`)
              : ' Hạng mục đơn vị khác m²: không suy khối lượng từ diện tích. Tuyến m cần đo riêng.'}
          </div>
          {!lineMode && isAreaUnit && quantityMode === 'measure' && <button type="button" data-hnl-cach2-confirm-area-quantity="true"
            disabled={saving || locked || missingTarget || unresolvedAutoAlias || !metricPreview.valid || !candidateShapes.length}
            onClick={() => void confirmMeasuredQuantity('area')}
            className="w-full rounded-lg bg-emerald-700 disabled:opacity-50 px-3 py-2 font-bold text-left">
            Lưu vùng + KL {metricPreview.valid ? `${metricPreview.value.toLocaleString('vi-VN', {maximumFractionDigits:2})} m²` : 'm²'}
          </button>}
          {locked && <span className="text-amber-300 font-bold">Phòng/hạng mục bị khóa hoặc đã nghiệm thu; không cho lưu.</span>}
          {notice && <div role="status" className="text-amber-200 break-words">{notice}</div>}
          <div className="flex gap-2">
            <button type="button" disabled={saving || lineMode || !draft.length || locked || unresolvedAutoAlias || missingTarget} onClick={() => void save()} className="rounded-lg bg-slate-700 disabled:opacity-50 px-3 py-1.5 font-bold">{isAreaUnit && quantityMode === 'measure' ? 'Chỉ lưu vùng' : 'Lưu vùng'}</button>
            <button type="button" disabled={saving} onClick={() => {
              if ((draft.length || corners.length || freehand.length || measurePath.length) &&
                  !window.confirm('Xóa toàn bộ vùng nháp chưa lưu?')) return;
              clearWork();
            }} className="rounded-lg bg-slate-700 px-3 py-1.5">Xóa nháp</button>
          </div>
        </div>}
        {!open && !hasDrawPermission && <div className="text-amber-200 mt-1">Vùng phòng đang khóa, đã nghiệm thu hoặc không có diện tích.</div>}
        {!open && notice && <div role="status" className="text-amber-200 mt-1">{notice}</div>}
      </div>
    </div>
    {open && imageContainer && !locked && createPortal(
      <svg data-hnl-direct-highlight-canvas="true" className="absolute inset-0 h-full w-full z-[65] cursor-crosshair"
        style={{ touchAction: 'none', pointerEvents: 'auto' }}
        viewBox="0 0 100 100" preserveAspectRatio="none"
        onPointerDown={handleDown} onPointerMove={handleMove} onPointerUp={endFreehand}
        onPointerLeave={() => setSnapMarker(null)}
        onPointerCancel={(event) => { event.stopPropagation(); activePointerRef.current = null; freehandRef.current = []; setFreehand([]); }}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        {existingShapes.map((points, i) => <polygon key={`existing-${i}`} points={points.map(p => `${p.x},${p.y}`).join(' ')} fill={currentHighlightColor} fillOpacity={0.12} stroke={currentHighlightColor} strokeWidth="2" strokeDasharray={currentTarget === 'main' ? undefined : '5 3'} vectorEffect="non-scaling-stroke" />)}
        {visibleShapes.map((points, i) => <polygon key={`draft-${i}`} points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="#f59e0b" fillOpacity={0.30} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />)}
        {measurePath.length > 0 && <polyline data-hnl-cach2-floor-line="true" points={measurePath.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#2dd4bf" strokeWidth="1.5" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
        {measurePath.map((p,i)=><circle key={`line-${i}`} cx={p.x} cy={p.y} r="0.34" stroke="white" strokeWidth="0.12" fill="#0d9488" />)}
        {!lineMode && activePreview.length > 0 && <polyline points={toFloorSvg(activePreview)} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
        {!lineMode && activePreview.map((point,i) => <circle key={i} cx={room.x + room.width * point.x / 100} cy={room.y + room.height * point.y / 100} r="0.32" fill="#f59e0b" />)}
        {snapMarker && <g pointerEvents="none" data-hnl-direct-highlight-snap-marker={snapMarker.kind}>
          <circle cx={snapMarker.point.x} cy={snapMarker.point.y} r="0.55" fill="none" stroke="#22d3ee" strokeWidth="0.22" />
          <circle cx={snapMarker.point.x} cy={snapMarker.point.y} r="0.22" fill="#22d3ee" />
        </g>}
      </svg>, imageContainer)}
  </>;
};
