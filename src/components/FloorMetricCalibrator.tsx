import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FloorPlan, FloorMetricCalibration, Point2D } from '../types';
import { createFloorMetricCalibration, getValidFloorMetricCalibration } from '../utils/floorMetricGeometry';

interface Props {
  floor: FloorPlan;
  imageContainer: HTMLElement | null;
  rotation: number;
  active: boolean;
  canSave: boolean;
  onClose: () => void;
  onSave: (id: string, calibration: FloorMetricCalibration) => void;
}
const clamp = (n: number) => Math.max(0, Math.min(100,n));
/** Two-point source-image calibration, using the same unrotate mapping as normal room highlight. */
export const FloorMetricCalibrator: React.FC<Props> = ({ floor,imageContainer,rotation,active,canSave,onClose,onSave }) => {
  const [points,setPoints] = useState<Point2D[]>([]);
  const [distanceInput,setDistanceInput] = useState('5');
  const [notice,setNotice] = useState('');
  const [imageDimensions,setImageDimensions] = useState({width:0,height:0});
  useEffect(()=>{setPoints([]);setNotice('');},[floor.id,active]);
  useEffect(()=>{
    const image = imageContainer?.querySelector('img');
    if (!image){setImageDimensions({width:0,height:0});return;}
    const clear = () => { setImageDimensions({width:0,height:0}); setPoints([]); };
    const read = () => {
      if (!image.complete || image.getAttribute('src') !== floor.imageUrl || !image.naturalWidth || !image.naturalHeight) { clear(); return; }
      setImageDimensions({width:image.naturalWidth,height:image.naturalHeight});
      setPoints([]);
    };
    read(); image.addEventListener('load',read); image.addEventListener('error',clear);
    return ()=>{image.removeEventListener('load',read); image.removeEventListener('error',clear);};
  },[imageContainer,floor.id,floor.imageUrl,active]);
  useEffect(()=>{
    if (!active) return;
    const onEsc=(event: KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();onClose();}};
    window.addEventListener('keydown',onEsc);
    return ()=>window.removeEventListener('keydown',onEsc);
  },[active,onClose]);
  if (!active || !imageContainer) return null;
  const saved = getValidFloorMetricCalibration(floor,imageDimensions);
  const length = Number(distanceInput.replace(',','.'));
  const draft = points.length===2 ? createFloorMetricCalibration(floor,imageDimensions,points[0],points[1],length) : null;
  const pointForEvent=(event:React.PointerEvent<SVGSVGElement>):Point2D|null=>{
    const rect=imageContainer.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)return null;
    const x=(event.clientX-rect.left)/rect.width;
    const y=(event.clientY-rect.top)/rect.height;
    const position=rotation===90?{x:y,y:1-x}:rotation===180?{x:1-x,y:1-y}:rotation===270?{x:1-y,y:x}:{x,y};
    return {x:clamp(position.x*100),y:clamp(position.y*100)};
  };
  const imageStillReady = () => {
    const image = imageContainer.querySelector('img');
    return Boolean(image && image.complete && image.getAttribute('src') === floor.imageUrl &&
      image.naturalWidth > 1 && image.naturalHeight > 1 &&
      image.naturalWidth === imageDimensions.width && image.naturalHeight === imageDimensions.height);
  };
  const save=()=>{
    if(!canSave || !draft || !imageStillReady()){setNotice('Chưa chọn đủ 2 điểm chuẩn hoặc số mét không hợp lệ.');return;}
    if(!window.confirm(`Xác nhận ${length} m cho tầng “${floor.floorName}”? Không sửa khối lượng đã nhập.`))return;
    onSave(floor.id,draft); onClose();
  };
  return createPortal(<>
    <div data-hnl-prod-metric-calibration="true" className="absolute left-2 top-2 z-[125] w-[min(310px,calc(100%-16px))] rounded-xl border border-teal-400 bg-slate-950/95 p-3 shadow-2xl text-white text-[11px] pointer-events-auto" onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
      <div className="flex justify-between gap-2"><b>Đo tỷ lệ mặt bằng · 2 điểm</b><button type="button" onClick={onClose} aria-label="Đóng đo tỷ lệ">✕</button></div>
      <div className="mt-1 text-amber-200">Chạm 2 điểm trên bản vẽ có kích thước thực tế đã biết.</div>
      <div className="mt-1 text-slate-200">{saved.valid?`Đã gán: 1 px ≈ ${saved.value.metresPerPixel.toLocaleString('vi-VN',{maximumFractionDigits:6})} m`:('reason' in saved?saved.reason:'Chưa gán tỷ lệ.')}</div>
      <label className="mt-2 block">Chiều dài thực tế (m)<input type="text" inputMode="decimal" aria-label="Chiều dài chuẩn mét" value={distanceInput} onChange={e=>setDistanceInput(e.target.value)} className="mt-1 w-full rounded-lg bg-white px-2 py-1.5 text-slate-900" /></label>
      <div className="mt-1">Điểm đã chọn: {points.length}/2 {draft?`· Dự kiến 1 px = ${draft.metresPerPixel.toLocaleString('vi-VN',{maximumFractionDigits:6})} m`:''}</div>
      {notice && <div role="status" className="text-amber-200 mt-1">{notice}</div>}
      <div className="mt-2 flex gap-2"><button type="button" disabled={!draft||!canSave} onClick={save} className="rounded bg-emerald-700 px-2 py-1.5 disabled:opacity-40">Lưu tỷ lệ</button><button type="button" onClick={()=>setPoints([])} className="rounded bg-slate-700 px-2 py-1.5">Chọn lại</button></div>
    </div>
    <svg data-hnl-prod-metric-canvas="true" className="absolute inset-0 z-[118] h-full w-full cursor-crosshair" viewBox="0 0 100 100" preserveAspectRatio="none"
      style={{touchAction:'none',pointerEvents:'auto'}} onPointerDown={event=>{
        event.preventDefault();event.stopPropagation();
        if(event.button>0 || !imageStillReady())return;
        const point=pointForEvent(event);if(point){setPoints(prev=>prev.length===2?[point]:[...prev,point]);setNotice('');}
      }} onPointerMove={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()}
      onClick={event=>{event.preventDefault();event.stopPropagation();}} onContextMenu={event=>event.preventDefault()}>
      {points.length===2 && <line x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} stroke="#fbbf24" strokeWidth="0.22" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
      {points.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="0.5" fill="#f59e0b" stroke="#0f172a" strokeWidth="0.2" pointerEvents="none"/>)}
    </svg>
  </>,imageContainer);
};
