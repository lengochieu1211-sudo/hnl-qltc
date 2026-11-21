import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FloorPlan, FloorMetricCalibration, Point2D, RoomProgressItem } from '../types';
import { mapDirectHighlightPointerToFloor } from '../utils/floorHighlightDirectShapes';
import { findRoomObjectSnap } from '../utils/roomHighlightObjectSnap';
import { applyCadDrawingGuide } from '../utils/roomHighlightCadShortcuts';
import { createFloorMetricCalibration, getValidFloorMetricCalibration } from '../utils/highlightMetricGeometry';

interface Props {
  floor: FloorPlan;
  imageContainer: HTMLElement | null;
  rotation: number;
  rooms: RoomProgressItem[];
  canSave: boolean;
  onSave: (floorId: string, calibration: FloorMetricCalibration) => void;
  onActiveChange?: (active: boolean) => void;
  objectSnapEnabled: boolean;
  objectSnapMidpoints: boolean;
  cadGridSnap: boolean;
  cadOrtho: boolean;
  cadPolar: boolean;
}
const floorPoint = (point: Point2D) => ({ x: Math.min(100,Math.max(0,point.x)), y: Math.min(100,Math.max(0,point.y)) });

/** Opt-in two-point calibration. Draws in the *existing* image overlay; zoom / pan
 * and rotation map through the same inverse pointer transform as direct Highlight.
 * No stored quantity is mutated by calibrating.
 */
export const FloorMetricCalibration: React.FC<Props> = ({
  floor, imageContainer, rotation, rooms, canSave, onSave, onActiveChange,
  objectSnapEnabled, objectSnapMidpoints, cadGridSnap, cadOrtho, cadPolar,
}) => {
  const [active, setActive] = useState(false);
  const [points, setPoints] = useState<Point2D[]>([]);
  const [distanceInput, setDistanceInput] = useState('10');
  const [notice, setNotice] = useState('');
  const image = imageContainer?.querySelector('img');
  const dimensions = { width: image?.naturalWidth || 0, height: image?.naturalHeight || 0 };
  const saved = getValidFloorMetricCalibration(floor, dimensions);
  const actualDistance = Number(distanceInput.replace(',', '.'));
  const draft = points.length === 2
    ? createFloorMetricCalibration(floor, dimensions, points[0], points[1], actualDistance)
    : null;
  const close = () => { setActive(false); onActiveChange?.(false); setPoints([]); setNotice(''); };
  useEffect(() => { close(); }, [floor.id]);
  useEffect(() => () => { onActiveChange?.(false); }, []);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active]);
  const open = () => {
    if (active) { close(); return; }
    if (!canSave || !imageContainer || dimensions.width <= 1 || dimensions.height <= 1) {
      setNotice('Chưa có ảnh mặt bằng sẵn sàng để hiệu chuẩn.'); return;
    }
    setPoints([]); setNotice('Chạm hai đầu đoạn có chiều dài thực tế đã biết.');
    setActive(true); onActiveChange?.(true);
  };
  const clickPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    event.preventDefault(); event.stopPropagation();
    if (!imageContainer || event.button > 0) return;
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
    if (!canSave || !draft || !active) { setNotice('Đoạn chuẩn hoặc số mét không hợp lệ.'); return; }
    if (!window.confirm(`Lưu hiệu chuẩn ${actualDistance} m cho tầng “${floor.floorName}”? Không thay đổi khối lượng đã nhập.`)) return;
    onSave(floor.id,draft);
    close();
  };
  return <>
    <div data-hnl-floor-metric-calibration="true" className="absolute left-2 top-14 z-[85] pointer-events-auto w-[min(328px,calc(100vw-32px))]">
      <div className="rounded-xl border border-teal-400/50 bg-slate-950/95 p-2 text-white shadow-xl text-[11px]">
        <div className="flex justify-between items-center gap-2">
          <span className="font-extrabold">Cách 2 · Hiệu chuẩn tỷ lệ</span>
          {canSave && <button type="button" aria-pressed={active} onClick={open} className="bg-teal-700 px-2 py-1.5 rounded-lg font-bold">{active ? 'Hủy đo' : 'Chọn 2 điểm'}</button>}
        </div>
        <div className="mt-1 text-[10px] text-slate-200" role="status">
          {saved.valid ? `Đã hiệu chuẩn: 1 px ≈ ${saved.value.metresPerPixel.toLocaleString('vi-VN',{maximumFractionDigits:5})} m` : saved.reason}
        </div>
        {active && <div className="mt-2 border-t border-slate-700 pt-2 space-y-2">
          <div className="text-teal-100">Đã chọn {points.length}/2 điểm. OSNAP {objectSnapEnabled?'bật':'tắt'}. Kéo/zoom trước khi chọn điểm nếu cần.</div>
          <label className="block">Chiều dài thực tế (m)
            <input aria-label="Chiều dài hiệu chuẩn mét" type="text" inputMode="decimal" value={distanceInput}
              onChange={(e)=>setDistanceInput(e.target.value)} className="mt-1 w-full rounded-lg bg-white p-2 text-slate-900" />
          </label>
          {draft && <div className="text-emerald-200">Tỷ lệ dự kiến: {draft.metresPerPixel.toLocaleString('vi-VN',{maximumFractionDigits:6})} m/px</div>}
          {notice && <div className="text-amber-200">{notice}</div>}
          <div className="flex gap-2">
            <button type="button" disabled={!draft} onClick={save} className="bg-emerald-700 disabled:opacity-50 rounded-lg px-2 py-1.5 font-bold">Xác nhận lưu tỷ lệ</button>
            <button type="button" onClick={()=>setPoints([])} className="bg-slate-700 rounded-lg px-2 py-1.5">Chọn lại</button>
          </div>
        </div>}
      </div>
    </div>
    {active && imageContainer && createPortal(
      <svg data-hnl-floor-metric-calibration-canvas="true" className="absolute inset-0 w-full h-full z-[78] cursor-crosshair"
        style={{touchAction:'none',pointerEvents:'auto'}} viewBox="0 0 100 100" preserveAspectRatio="none"
        onPointerDown={clickPoint} onClick={(event)=>{event.stopPropagation();event.preventDefault();}}
        onContextMenu={(event)=>{event.stopPropagation();event.preventDefault();}}>
        {points.length===2 && <line x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} stroke="#2dd4bf" strokeWidth="0.5" />}
        {points.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="0.7" stroke="white" strokeWidth="0.2" fill="#0d9488" />)}
      </svg>,imageContainer)}
  </>;
};
