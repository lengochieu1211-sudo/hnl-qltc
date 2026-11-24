import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FloorPlan, Point2D, RoomProgressItem } from '../types';
import { mapDirectHighlightPointerToFloor } from '../utils/floorHighlightDirectShapes';
import { findRoomObjectSnap } from '../utils/roomHighlightObjectSnap';
import { applyCadDrawingGuide } from '../utils/roomHighlightCadShortcuts';
import { createFloorMetricCalibration, getValidFloorMetricCalibration, getFloorCalibrationBaseline, canSaveFloorCalibration, type FloorCalibrationSaveRequest, type FloorCalibrationBaseline } from '../utils/highlightMetricGeometry';
import { useFloorPlanToolPopover } from '../hooks/useFloorPlanToolPopover';

import { highlightDraftKey, openHighlightDraft, writeHighlightDraft, removeHighlightDraft, draftRecord, draftOptionalNumber, draftPoint, type DraftSlot, type HighlightDraftScope } from '../utils/highlightLocalDraft';
type CalibrationDraft={baseline:FloorCalibrationBaseline;points:Point2D[];distanceInput:string};
const isCalibrationDraft=(v:unknown):v is CalibrationDraft=>draftRecord(v)&&draftRecord(v.baseline)&&typeof v.baseline.floorId==='string'&&typeof v.baseline.sourceKey==='string'&&draftOptionalNumber(v.baseline.imageRevision)&&draftOptionalNumber(v.baseline.revision)&&draftOptionalNumber(v.baseline.updatedAt)&&draftOptionalNumber(v.baseline.calibrationUpdatedAt)&&Array.isArray(v.points)&&v.points.length<=2&&v.points.every(draftPoint)&&typeof v.distanceInput==='string'&&v.distanceInput.length<=100;
interface Props {
  draftScope?: HighlightDraftScope;
  floor: FloorPlan;
  imageContainer: HTMLElement | null;
  rotation: number;
  zoomScale: number;
  isFullscreen?: boolean;
  launch?: { floorId: string; token: number } | null;
  rooms: RoomProgressItem[];
  canSave: boolean;
  onSave: (request:FloorCalibrationSaveRequest) => Promise<void>;
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
 * No stored quantity is mutated by calibrating.
 */
export const FloorMetricCalibration: React.FC<Props> = ({
  floor, draftScope, imageContainer, rotation, zoomScale, isFullscreen=false, launch, rooms, canSave, onSave, onActiveChange, onLaunchHandled,
  objectSnapEnabled, objectSnapMidpoints, cadGridSnap, cadOrtho, cadPolar,
}) => {
  const [active, setActive] = useState(false);
  const [points, setPoints] = useState<Point2D[]>([]);
  const [distanceInput, setDistanceInput] = useState('5');
  const [notice, setNotice] = useState('');
  const [saving,setSaving]=useState(false);
  const savingRef=useRef(false);
  const mountedRef=useRef(false);
  useEffect(()=>{mountedRef.current=true;return()=>{mountedRef.current=false;};},[]);
  const baseline=useRef<FloorCalibrationBaseline|null>(null);
  const slot=useRef<DraftSlot<CalibrationDraft>|null>(null);
  const [draftNotice,setDraftNotice]=useState('');
  const draftError=useRef('');
  const reportDraft=(message:string)=>{draftError.current=message;setDraftNotice(message);};
  const fullscreenPopover = useFloorPlanToolPopover(active || !!notice, isFullscreen, imageContainer,
    '[data-hnl-metric-calibrate-fullscreen="true"]', 328, 0.55);
  // Same inverse-zoom behavior as polygon drawing points. These are only visual
  // markers: keep the SVG pointer target full-size for precise mouse/touch input.
  const pointDisplayScale = 1 / Math.max(1, zoomScale);

  const image = imageContainer?.querySelector('img');
  const dimensions = { width: image?.naturalWidth || 0, height: image?.naturalHeight || 0 };
  const saved = getValidFloorMetricCalibration(floor, dimensions);
  const stale=Boolean(baseline.current&&JSON.stringify(baseline.current)!==JSON.stringify(getFloorCalibrationBaseline(floor)));
  const actualDistance = Number(distanceInput.replace(',', '.'));
  const draft = points.length === 2
    ? createFloorMetricCalibration(floor, dimensions, points[0], points[1], actualDistance)
    : null;
  const close = (acknowledged=false) => { if(savingRef.current)return; if(!acknowledged&&(points.length>0||distanceInput!=='5')&&draftError.current&&!window.confirm('Nháp chưa được bảo vệ. Thoát có thể mất điểm chuẩn. Tiếp tục?'))return; baseline.current=null;setActive(false); if(mountedRef.current)onActiveChange?.(false); setPoints([]); setNotice(''); };
  
  useEffect(() => () => { onActiveChange?.(false); }, []);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active, points.length, distanceInput]);
  const open = () => {
    if (active) { close(); return; }
    if (!canSave || !imageContainer || dimensions.width <= 1 || dimensions.height <= 1) {
      setNotice('Chưa có ảnh mặt bằng sẵn sàng để hiệu chuẩn.'); return;
    }
    baseline.current=getFloorCalibrationBaseline(floor);
    setPoints([]);setDistanceInput('5');setNotice('Chọn 2 điểm chuẩn trên mặt bằng.');
    slot.current=null;reportDraft('');
    try {
      const entry=openHighlightDraft(highlightDraftKey(draftScope,'calibration',floor.id),isCalibrationDraft);
      if(entry.value&&entry.value.baseline.floorId!==floor.id)throw new Error('Bản nháp không đúng tầng.');
      slot.current=entry;
      if(entry.value){const v=entry.value;baseline.current=v.baseline;setPoints(v.points);setDistanceInput(v.distanceInput);setNotice('Đã khôi phục nháp trên thiết bị; chưa lưu tỷ lệ chính thức.');}
    }catch(error){reportDraft(`Không thể lưu/khôi phục nháp: ${error instanceof Error?error.message:String(error)}`);}
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
  useLayoutEffect(()=>{
    if(!active||!baseline.current||!slot.current||(!points.length&&distanceInput==='5'&&!slot.current.value))return;
    try{writeHighlightDraft(slot.current,{baseline:baseline.current,points,distanceInput});reportDraft('');}
    catch(error){reportDraft(`Chưa bảo vệ nháp: ${error instanceof Error?error.message:String(error)}`);}
  },[active,points,distanceInput]);
  const resetDraft=()=>{
    if(savingRef.current||!window.confirm('Xóa nháp hiện tại và chọn lại điểm trên ảnh mới nhất?'))return;
    try{if(!slot.current)throw new Error('Không mở được bản nháp.');removeHighlightDraft(slot.current);baseline.current=getFloorCalibrationBaseline(floor);setPoints([]);setDistanceInput('5');reportDraft('');setNotice('Chọn lại 2 điểm chuẩn trên mặt bằng hiện tại.');}
    catch(error){reportDraft(`Không thể xóa nháp: ${error instanceof Error?error.message:String(error)}`);}
  };
  const clickPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    event.preventDefault(); event.stopPropagation();
    if (savingRef.current || !canSave || !imageContainer || event.button > 0) return;
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
  const save = async () => {
    if (savingRef.current) return;
    if (!canSave || !draft || !active || !baseline.current) { setNotice('Đoạn chuẩn, quyền hoặc số mét không hợp lệ.'); return; }
    const request={baseline:baseline.current,calibration:draft};
    if(!canSaveFloorCalibration(floor,request)){setNotice('Ảnh hoặc hiệu chuẩn đã thay đổi. Chưa lưu; hai điểm nháp vẫn còn.');return;}
    if (!window.confirm(`Lưu hiệu chuẩn ${actualDistance} m cho tầng “${floor.floorName}”? Không thay đổi khối lượng đã nhập.`)) return;
    savingRef.current=true;setSaving(true);setNotice('Đang xác nhận tỷ lệ trên Firestore...');
    try {await onSave(request);try{if(slot.current)removeHighlightDraft(slot.current);}catch(error){reportDraft(`Đã lưu tỷ lệ nhưng chưa xóa nháp: ${String(error)}`);}savingRef.current=false;close(true);}
    catch(error){setNotice(`Chưa xác nhận lưu tỷ lệ: ${error instanceof Error?error.message:String(error)}. Hai điểm nháp vẫn còn.`);}
    finally{savingRef.current=false;setSaving(false);}
  };
  return <>
    {(active || notice || draftNotice) && <div data-hnl-floor-metric-calibration="true"
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
        {active&&stale&&<div role="alert" className="text-amber-600">Ảnh hoặc tỷ lệ đã thay đổi; nháp cũ chỉ để đối chiếu. Chọn lại để bắt đầu mới.</div>}
        {draftNotice&&<div role="alert" className="text-amber-600">{draftNotice}</div>}
        {active && <div className={`mt-2 border-t pt-2 space-y-2 ${isFullscreen ? 'border-slate-600' : 'border-slate-200'}`}>
          <div className={isFullscreen ? 'text-indigo-200' : 'text-indigo-700'}>Đã chọn {points.length}/2 điểm.</div>
          <label className="block">Chiều dài thực tế (m)
            <input aria-label="Chiều dài hiệu chuẩn mét" type="text" inputMode="decimal" disabled={saving} value={distanceInput}
              onChange={(e)=>setDistanceInput(e.target.value)} className="mt-1 w-full rounded-lg bg-white p-2 text-slate-900" />
          </label>
          {draft && <div className={isFullscreen ? 'text-emerald-200' : 'text-emerald-700'}>Tỷ lệ dự kiến: {draft.metresPerPixel.toLocaleString('vi-VN',{maximumFractionDigits:6})} m/px</div>}

          {!draftNotice&&<div>Nháp lưu trên thiết bị; chưa cập nhật tỷ lệ chính thức.</div>}
          {notice && <div className={isFullscreen ? 'text-amber-200' : 'text-amber-700'}>{notice}</div>}
          <div className="flex gap-2">
            <button type="button" disabled={saving||!canSave||!draft||stale} onClick={save} className="bg-emerald-700 text-white disabled:opacity-50 rounded-lg px-2 py-1.5 font-bold">Xác nhận lưu tỷ lệ</button>
            <button type="button" disabled={saving||!canSave} onClick={resetDraft} className={`rounded-lg px-2 py-1.5 ${isFullscreen ? 'bg-slate-700 text-slate-100' : 'bg-slate-100 text-slate-700'}`}>Chọn lại</button>
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
