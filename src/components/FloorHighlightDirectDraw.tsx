import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HighlightRegionShape, Point2D, RoomProgressItem } from '../types';
import { getDirectStageCategory, getSavedDirectHighlightShapes, getDirectHighlightCategoryNames, mapDirectHighlightPointerToFloor, getDirectHighlightDrawPoint } from '../utils/floorHighlightDirectShapes';
import type { DirectHighlightSaveRequest } from '../utils/floorHighlightDirectShapes';
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
const rgba = (target: Target) => target === 'total' ? '#64748b' : target === 'main' ? '#0284c7' : '#16a34a';

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
  imageContainer: HTMLElement | null;
  rotation: number;
  onSaveShapes: (request: DirectHighlightSaveRequest) => void;
  onShowLayer: (layer: 'totalHighlightRegions' | 'mainHighlightRegions' | 'subItemRegions') => void;
  isLocked: boolean;
  disabled?: boolean;
  onOpenChange?: (active:boolean)=>void;
  // The same CAD/OSNAP settings already used by the normal room drawing tools.
  objectSnapEnabled: boolean;
  objectSnapMidpoints: boolean;
  cadGridSnap: boolean;
  cadOrtho: boolean;
  cadPolar: boolean;
}

export const FloorHighlightDirectDraw: React.FC<Props> = ({
  room, imageContainer, rotation, onSaveShapes, onShowLayer, isLocked, disabled=false, onOpenChange,
  objectSnapEnabled, objectSnapMidpoints, cadGridSnap, cadOrtho, cadPolar,
}) => {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(() => getDirectHighlightCategoryNames(room)[0] || '');
  const [target, setTarget] = useState<Target>('total');
  const [tool, setTool] = useState<DrawTool>('2point');
  const [draft, setDraft] = useState<HighlightRegionShape[]>([]);
  const [corners, setCorners] = useState<Point2D[]>([]);
  const [hover, setHover] = useState<Point2D | null>(null);
  const [freehand, setFreehand] = useState<Point2D[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [notice, setNotice] = useState('');
  const [snapMarker, setSnapMarker] = useState<{ point: Point2D; kind: 'vertex' | 'midpoint' } | null>(null);
  const freehandRef = useRef<Point2D[]>([]);
  const activePointerRef = useRef<number | null>(null);
  const baselineRef = useRef<{ revision?: number; updatedAt: number } | null>(null);
  const categories = useMemo(() => getDirectHighlightCategoryNames(room), [room]);
  const currentCategory = categories.includes(category) ? category : (categories[0] || '');
  const stages = (room.subItems || []).filter((stage) => getDirectStageCategory(stage, room) === currentCategory);
  const currentTarget: Target = target === 'total' || target === 'main' || stages.some((stage) => stage.id === target) ? target : 'total';
  const targetStage = stages.find((stage) => stage.id === currentTarget);
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
  const totalQuantity = room.categoryHighlightTotalVolumes?.[currentCategory];
  const previewQuantity = previewRatio.valid && typeof totalQuantity === 'number' && Number.isFinite(totalQuantity)
    ? (totalQuantity * previewRatio.ratio).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
    : null;

  const clearWork = () => {
    setDraft([]); setCorners([]); setFreehand([]); setHover(null); setNotice(''); setSnapMarker(null);
    freehandRef.current = []; activePointerRef.current = null;
  };
  const changeTarget = (next: Target) => { clearWork(); setTarget(next); setReplaceExisting(false); };
  const changeCategory = (next: string) => { clearWork(); setCategory(next); setTarget('total'); setReplaceExisting(false); };
  const toggle = () => {
    if (open) { clearWork(); baselineRef.current = null; setOpen(false); onOpenChange?.(false); return; }
    if (disabled) return;
    if (locked || !imageContainer || room.width <= 0 || room.height <= 0 || room.isPolyline) {
      setNotice('Không thể vẽ: vùng phòng không hợp lệ, đang khóa hoặc đã nghiệm thu.'); return;
    }
    baselineRef.current = { revision: room.revision, updatedAt: room.updatedAt };
    setOpen(true); onOpenChange?.(true); clearWork();
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
    if (locked || event.button > 0 || !imageContainer) return;
    const { point, marker } = getPoint(event);
    setSnapMarker(marker);
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
    if (tool !== 'freehand' || activePointerRef.current !== event.pointerId) return;
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
  const save = () => {
    if (!draft.length || !currentCategory || locked || !baselineRef.current) return;
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
    onSaveShapes({
      roomId: room.id, expectedUpdatedAt: baselineRef.current.updatedAt,
      expectedRevision: baselineRef.current.revision, category: currentCategory,
      target: currentTarget, shapes: candidateShapes,
    });
    onShowLayer(currentTarget === 'total' ? 'totalHighlightRegions' : currentTarget === 'main' ? 'mainHighlightRegions' : 'subItemRegions');
    clearWork(); setOpen(false); onOpenChange?.(false); baselineRef.current = null;
  };
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { clearWork(); setOpen(false); onOpenChange?.(false); baselineRef.current = null; }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open]);

  const toFloorSvg = (points: Point2D[]): string => points.map((p) => `${room.x + room.width * p.x / 100},${room.y + room.height * p.y / 100}`).join(' ');
  const activePreview = corners.length ? corners.concat(hover && tool !== 'freehand' ? [hover] : []) : freehand;
  const hasDrawPermission = !locked && !disabled && room.width > 0 && room.height > 0 && !room.isPolyline;
  return <>
    <div data-hnl-direct-highlight-toolbar="true" className="absolute right-2 top-14 z-[80] pointer-events-auto max-w-[calc(100%-16px)]">
      <div className="rounded-xl border border-sky-400/50 bg-slate-950/95 p-2 text-white shadow-2xl w-[min(340px,calc(100vw-32px))] text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span className="font-extrabold truncate">Vẽ Highlight · {room.roomName}</span>
          <button type="button" disabled={!hasDrawPermission && !open} aria-pressed={open} onClick={toggle}
            className={`shrink-0 px-3 py-1.5 rounded-lg font-bold ${open ? 'bg-rose-700' : 'bg-sky-600 disabled:bg-slate-700'}`}>
            {open ? 'Tắt vẽ' : 'Bật vẽ'}
          </button>
        </div>
        {open && <div className="mt-2 space-y-2 border-t border-slate-700 pt-2" data-hnl-direct-highlight-edit="true">
          <label className="block font-bold">Hạng mục chính
            <select aria-label="Hạng mục chính của vùng highlight" className="mt-1 w-full rounded-lg bg-white text-slate-900 p-2" value={currentCategory}
              onChange={(event) => changeCategory(event.target.value)}>
              {categories.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="block font-bold">Vùng cần vẽ
            <select aria-label="Vùng tổng, chính hoặc con trên mặt bằng" className="mt-1 w-full rounded-lg bg-white text-slate-900 p-2" value={currentTarget}
              onChange={(event) => changeTarget(event.target.value)}>
              <option value="total">Vùng tổng</option><option value="main">Hạng mục chính</option>
              {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
            </select>
          </label>
          <div className="flex gap-1" role="group" aria-label="Công cụ vẽ trực tiếp">
            {(['2point', 'polygon', 'freehand'] as const).map((value) => <button key={value} type="button" aria-pressed={tool === value}
              onClick={() => { clearWork(); setTool(value); }}
              className={`flex-1 rounded-md border p-1.5 font-bold ${tool === value ? 'bg-sky-600 border-sky-300' : 'border-slate-600'}`}>
              {value === '2point' ? '2 điểm' : value === 'polygon' ? 'Đa giác' : 'Tự do'}
            </button>)}
          </div>
          <div data-hnl-direct-highlight-cad-settings="true" className="text-[10px] text-sky-200">
            Bắt điểm có sẵn: OSNAP {objectSnapEnabled ? (objectSnapMidpoints ? '(góc + trung điểm)' : '(góc)') : 'tắt'} · Lưới {cadGridSnap ? 'bật' : 'tắt'} · Vuông góc {cadOrtho ? 'bật' : 'tắt'} · Góc {cadPolar ? 'bật' : 'tắt'}.
            {tool === 'freehand' ? ' Nét tự do giữ nguyên, không hút từng điểm.' : ''}
          </div>
          <div className="text-[10px] text-slate-200">{tool === '2point' ? 'Chạm 2 góc đối diện.' : tool === 'polygon' ? `Chấm các đỉnh rồi bấm Chốt (${corners.length} điểm).` : 'Nhấn giữ và rê để khoanh vùng.'} Dữ liệu chưa ghi khi đang vẽ.</div>
          {tool === 'polygon' && <div className="flex gap-1">
            <button type="button" disabled={corners.length < 3} onClick={() => addShape(toPolygon(corners, 'polygon'))} className="rounded-lg bg-emerald-700 disabled:opacity-50 px-2 py-1">Chốt đa giác</button>
            <button type="button" disabled={!corners.length} onClick={() => setCorners((prev) => prev.slice(0, -1))} className="rounded-lg bg-slate-700 px-2 py-1">Lùi 1 điểm</button>
          </div>}
          <label className="flex items-center gap-2 text-amber-200"><input type="checkbox" checked={replaceExisting}
            onChange={(event) => { clearWork(); setReplaceExisting(event.target.checked); }} />Thay thế các vùng cũ (cần xác nhận)</label>
          <div className="text-[10px]">Có {oldShapes.length} vùng cũ · {draft.length} vùng nháp · {previewRatio.valid ? `${previewRatio.percent}% vùng tổng` : previewRatio.reason}{previewQuantity !== null ? ` · KL tham khảo ${previewQuantity} m² (chưa ghi)` : ''}</div>
          {locked && <span className="text-amber-300 font-bold">Phòng/hạng mục bị khóa hoặc đã nghiệm thu; không cho lưu.</span>}
          {notice && <div role="status" className="text-amber-200 break-words">{notice}</div>}
          <div className="flex gap-2">
            <button type="button" disabled={!draft.length || locked || missingTarget} onClick={save} className="rounded-lg bg-emerald-700 disabled:opacity-50 px-3 py-1.5 font-bold">Lưu vùng</button>
            <button type="button" onClick={clearWork} className="rounded-lg bg-slate-700 px-3 py-1.5">Xóa nháp</button>
            <button type="button" onClick={toggle} className="rounded-lg bg-slate-700 px-3 py-1.5">Hủy</button>
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
        {existingShapes.map((points, i) => <polygon key={`existing-${i}`} points={points.map(p => `${p.x},${p.y}`).join(' ')} fill={rgba(currentTarget)} fillOpacity={0.12} stroke={rgba(currentTarget)} strokeWidth="0.45" strokeDasharray="1.5,0.8" />)}
        {visibleShapes.map((points, i) => <polygon key={`draft-${i}`} points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="#f59e0b" fillOpacity={0.30} stroke="#f59e0b" strokeWidth="0.65" />)}
        {activePreview.length > 0 && <polyline points={toFloorSvg(activePreview)} fill="none" stroke="#f59e0b" strokeWidth="0.55" strokeDasharray="1.5,0.7" />}
        {activePreview.map((point,i) => <circle key={i} cx={room.x + room.width * point.x / 100} cy={room.y + room.height * point.y / 100} r="0.6" fill="#f59e0b" />)}
        {snapMarker && <g pointerEvents="none" data-hnl-direct-highlight-snap-marker={snapMarker.kind}>
          <circle cx={snapMarker.point.x} cy={snapMarker.point.y} r="1.0" fill="none" stroke="#22d3ee" strokeWidth="0.35" />
          <circle cx={snapMarker.point.x} cy={snapMarker.point.y} r="0.32" fill="#22d3ee" />
        </g>}
      </svg>, imageContainer)}
  </>;
};
