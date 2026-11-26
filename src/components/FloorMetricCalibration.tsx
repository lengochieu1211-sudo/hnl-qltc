import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FloorPlan, FloorMetricCalibration as FloorMetricCalibrationData, Point2D, RoomProgressItem, WorkVolume } from '../types';
import { mapDirectHighlightPointerToFloor } from '../utils/floorHighlightDirectShapes';
import { findRoomObjectSnap } from '../utils/roomHighlightObjectSnap';
import { applyCadDrawingGuide } from '../utils/roomHighlightCadShortcuts';
import { createFloorMetricCalibration, getValidFloorMetricCalibration, floorMetricSourceKey } from '../utils/highlightMetricGeometry';
import { previewFloorCalibrationQuantities } from '../utils/roomQuantityAutoUpdate';
import { useFloorPlanToolPopover } from '../hooks/useFloorPlanToolPopover';

interface Props {
  floor: FloorPlan;
  imageContainer: HTMLElement | null;
  rotation: number;
  zoomScale: number;
  isFullscreen?: boolean;
  launch?: { floorId: string; token: number } | null;
  rooms: RoomProgressItem[];
  workVolumes: WorkVolume[];
  canSave: boolean;
  onSave: (floorId: string, calibration: FloorMetricCalibrationData, expectedPreviewToken: string) => void;
  onActiveChange?: (active: boolean) => void;
  /** Acknowledge a one-shot toolbar request before another tool can remount us. */
  onLaunchHandled?: (token: number) => void;
  objectSnapEnabled: boolean;
  objectSnapMidpoints: boolean;
  cadGridSnap: boolean;
  cadOrtho: boolean;
  cadPolar: boolean;
}
const floorPoint = (point: Point2D) => ({ x: Math.min(100,Math.max(0,point.x)), y: Math.min(100,Math.max(0,point.y)) });

/** Opt-in two-point calibration. Draws in the *existing* image overlay; zoom / pan
 * and rotation map through the same inverse pointer transform as direct Highlight.
 * Saving may recalculate explicitly linked, editable quantities via the parent.
 */
export const FloorMetricCalibration: React.FC<Props> = ({
  floor, imageContainer, rotation, zoomScale, isFullscreen=false, launch, rooms, workVolumes, canSave, onSave, onActiveChange, onLaunchHandled,
  objectSnapEnabled, objectSnapMidpoints, cadGridSnap, cadOrtho, cadPolar,
}) => {
  const [active, setActive] = useState(false);
  const [points, setPoints] = useState<Point2D[]>([]);
  const [distanceInput, setDistanceInput] = useState('5');
  const [notice, setNotice] = useState('');
  const fullscreenPopover = useFloorPlanToolPopover(active || !!notice, isFullscreen, imageContainer,
    '[data-hnl-metric-calibrate-fullscreen="true"]', 328, 0.55);
  // Same inverse-zoom behavior as polygon drawing points. These are only visual
  // markers: keep the SVG pointer target full-size for precise mouse/touch input.
  const pointDisplayScale = 1 / Math.max(1, zoomScale);

  const image = imageContainer?.querySelector('img');
  const dimensions = { width: image?.naturalWidth || 0, height: image?.naturalHeight || 0 };
  const imageReady = !floor.imageOfflineStale && !!image?.complete && image.getAttribute('src') === floor.imageUrl && dimensions.width > 1 && dimensions.height > 1;
  const sourceRevision = JSON.stringify([floorMetricSourceKey(floor), floor.revision, floor.highlightMetricCalibration?.updatedAt, dimensions.width, dimensions.height]);
  const [draftSource, setDraftSource] = useState<string | null>(null);
  const saved = getValidFloorMetricCalibration(floor, dimensions);
  const actualDistance = Number(distanceInput.replace(',', '.'));
  const draft = imageReady && draftSource === sourceRevision && points.length === 2
    ? createFloorMetricCalibration(floor, dimensions, points[0], points[1], actualDistance)
    : null;
  const preview = draft ? previewFloorCalibrationQuantities(floor,draft,rooms,workVolumes) : null;
  const close = () => { setActive(false); onActiveChange?.(false); setPoints([]); setDraftSource(null); setNotice(''); };
  useEffect(() => { close(); }, [floor.id]);
  useEffect(() => {
    if (active && (!imageReady || draftSource !== sourceRevision || !canSave)) {
      close();
      setNotice('Nguồn ảnh, tỷ lệ hoặc quyền đã thay đổi. Hãy mở lại Đo tỷ lệ.');
    }
  }, [active, imageReady, draftSource, sourceRevision, canSave]);
  useEffect(() => () => { onActiveChange?.(false); }, []);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active]);
  const open = () => {
    if (active) { close(); return; }
    if (!canSave || !imageContainer || !imageReady) {
      setNotice('Chưa có ảnh mặt bằng sẵn sàng để hiệu chuẩn.'); return;
    }
    setDraftSource(sourceRevision); setPoints([]); setNotice('Chọn 2 điểm chuẩn trên mặt bằng.');
    setActive(true); onActiveChange?.(true);
  };
  useEffect(() => {
    if (launch?.floorId === floor.id && launch.token > 0) {
      onLaunchHandled?.(launch.token);
      open();
    }
    // Triggered only by toolbar click, not by image/zoom updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch?.token]);
  const clickPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    event.preventDefault(); event.stopPropagation();
    if (!imageContainer || !imageReady || draftSource !== sourceRevision || !canSave || event.button > 0) return;
    const rect = imageContainer.getBoundingClientRect();
    const raw = floorPoint(mapDirectHighlightPointerToFloor(event.clientX,event.clientY,rect,rotation));
    const viewport = rotation === 90 || rotation === 270 ? {width:rect.height,height:rect.width} : {width:rect.width,height:rect.height};
    const candidate = objectSnapEnabled ? findRoomObjectSnap(raw, rooms, viewport, {
      tolerancePx: event.pointerType === 'touch' ? 20 : 12, midpoints: objectSnapMidpoints,
    }) : null;
    const guided = candidate?.point || applyCadDrawingGuide(raw, points[0] || null, viewport, {
      gridSnap: cadGridSnap, ortho: cadOrtho, polar: cadPolar,
    });
    setPoints((prev) => prev.length >= 2 ? [floorPoint(guided)] : [...prev, floorPoint(guided)]);
    setNotice('');
  };
  const save = () => {
    if (!canSave || !draft || !preview || !active || !imageReady || draftSource !== sourceRevision) { setNotice('Đoạn chuẩn hoặc số mét không hợp lệ.'); return; }
    if (!window.confirm(`Lưu hiệu chuẩn ${actualDistance} m cho tầng “${floor.floorName}”? Khối lượng có công thức liên kết có thể tự cập nhật: ${preview.changes.length} mục trong ${preview.changedRooms.size} phòng theo bảng xem trước. Số nhập tay và phần đã chốt được giữ nguyên. Tiếp tục?`)) return;
    onSave(floor.id,draft,preview.token);
    close();
  };
  return <>
    {(active || notice) && <div data-hnl-floor-metric-calibration="true"
      style={isFullscreen ? fullscreenPopover : undefined}
      className="absolute left-2 top-16 z-[85] pointer-events-auto w-[min(328px,calc(100vw-32px))] max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain">
      {/* Match the Display settings panel in BOTH floor viewing modes. The existing
          calibration geometry, draft and persistence paths stay untouched. */}
      <div data-hnl-metric-calibration-panel="true" className={`rounded-xl border p-2 text-[11px] ${isFullscreen
        ? 'border-slate-600 bg-slate-800 text-slate-100 shadow-2xl'
        : 'border-slate-200 bg-white text-slate-700 shadow-xl'}`}>
        <div className="flex justify-between items-center gap-2">
          <span className="font-extrabold">📏 Đo tỷ lệ mặt bằng</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {canSave && !active && <button type="button" onClick={open}
              className="rounded-lg bg-indigo-600 px-2 py-1.5 font-bold text-white hover:bg-indigo-700">Chọn 2 điểm</button>}
            <button type="button" data-hnl-metric-calibration-close="true" aria-label="Đóng bảng Đo tỷ lệ"
              title="Đóng bảng Đo tỷ lệ" onClick={(event) => { event.stopPropagation(); close(); }}
              className={`rounded-lg px-2 py-1.5 font-bold ${isFullscreen
                ? 'bg-slate-700 text-slate-100 hover:bg-slate-600'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>✕</button>
          </div>
        </div>
        <div className={`mt-1 text-[10px] ${isFullscreen ? 'text-slate-200' : 'text-slate-600'}`} role="status">
          {saved.valid ? `Đã hiệu chuẩn: 1 px ≈ ${saved.value.metresPerPixel.toLocaleString('vi-VN',{maximumFractionDigits:5})} m` : ('reason' in saved ? saved.reason : 'Chưa hiệu chuẩn.')}
        </div>
        {active && <div className={`mt-2 border-t pt-2 space-y-2 ${isFullscreen ? 'border-slate-600' : 'border-slate-200'}`}>
          <div className={isFullscreen ? 'text-indigo-200' : 'text-indigo-700'}>Đã chọn {points.length}/2 điểm.</div>
          <label className="block">Chiều dài thực tế (m)
            <input aria-label="Chiều dài hiệu chuẩn mét" type="text" inputMode="decimal" value={distanceInput}
              onChange={(e)=>setDistanceInput(e.target.value)} className="mt-1 w-full rounded-lg bg-white p-2 text-slate-900" />
          </label>
          {draft && <div className={isFullscreen ? 'text-emerald-200' : 'text-emerald-700'}>Tỷ lệ dự kiến: {draft.metresPerPixel.toLocaleString('vi-VN',{maximumFractionDigits:6})} m/px</div>}
          {preview && <div data-hnl-calibration-quantity-preview="true" className="border rounded p-1.5 space-y-1">
            <div className="font-bold">KL dự kiến: {preview.changes.length} mục / {preview.changedRooms.size} phòng</div>
            {preview.changes.length === 0 ? <div>Không có khối lượng liên kết thay đổi.</div> : <div className="max-h-40 overflow-y-auto overscroll-contain space-y-1" tabIndex={0} aria-label="Danh sách khối lượng dự kiến thay đổi">
              {preview.changes.map(change=><div key={JSON.stringify([change.roomId,change.settingId])} className="border-t pt-1 break-words"><div className="font-medium">{change.roomName || change.roomId} · {change.label}</div><div>{change.before.toLocaleString('vi-VN',{maximumFractionDigits:2})} → {change.after.toLocaleString('vi-VN',{maximumFractionDigits:2})} {change.unit}</div></div>)}
            </div>}
            <div>Chỉ là dự kiến trên dữ liệu hiện có; xác nhận sẽ gửi lưu theo cơ chế đồng bộ hiện tại.</div>
          </div>}
          {notice && <div className={isFullscreen ? 'text-amber-200' : 'text-amber-700'}>{notice}</div>}
          <div className="flex gap-2">
            <button type="button" disabled={!draft || !preview} onClick={save} className="bg-emerald-700 text-white disabled:opacity-50 rounded-lg px-2 py-1.5 font-bold">Xác nhận lưu tỷ lệ</button>
            <button type="button" onClick={()=>setPoints([])} className={`rounded-lg px-2 py-1.5 ${isFullscreen ? 'bg-slate-700 text-slate-100' : 'bg-slate-100 text-slate-700'}`}>Chọn lại</button>
          </div>
        </div>}
      </div>
    </div>}
    {active && imageContainer && createPortal(
      <svg data-hnl-floor-metric-calibration-canvas="true" className="absolute inset-0 w-full h-full z-[78] cursor-crosshair"
        style={{touchAction:'none',pointerEvents:'auto'}} viewBox="0 0 100 100" preserveAspectRatio="none"
        onPointerDown={clickPoint} onClick={(event)=>{event.stopPropagation();event.preventDefault();}}
        onContextMenu={(event)=>{event.stopPropagation();event.preventDefault();}}>
        {points.length===2 && <line x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y}
          stroke="#f59e0b" strokeWidth={0.4 * pointDisplayScale} pointerEvents="none" />}
        <g data-hnl-metric-small-points="true" pointerEvents="none">
          {points.map((p,i)=><circle key={i} cx={p.x} cy={p.y}
            r={0.45 * pointDisplayScale} stroke="#0f172a" strokeWidth={0.16 * pointDisplayScale} fill="#f59e0b" />)}
        </g>
      </svg>,imageContainer)}
  </>;
};
