import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Point2D, RoomProgressItem } from '../types';
import { createEntityId } from '../utils/idUtils';
import { getDirectHighlightDrawPoint, getSavedDirectHighlightShapes, mapDirectHighlightPointerToFloor } from '../utils/floorHighlightDirectShapes';
import { getHighlightShapeFloorPoints } from '../utils/highlightTotalGeometry';
import { isCountStage, totalCountPoints, validCountPoints, MAX_COUNT_MARKERS, type CountMode, type CountPoint, type CountRegionMode, type HighlightCountSaveRequest } from '../utils/highlightCountPoints';

type Props = {
  room: RoomProgressItem;
  imageContainer: HTMLElement | null;
  rotation: number;
  locked: boolean;
  onSave: (request: HighlightCountSaveRequest) => void;
  launchStageId?: string | null;
  onReturnToRoom?: (afterSave?:boolean) => void;
  onActiveChange?: (active: boolean) => void;
  otherDrawingActive?: boolean;
  objectSnapEnabled: boolean;
  objectSnapMidpoints: boolean;
  cadGridSnap: boolean;
  cadOrtho: boolean;
  cadPolar: boolean;
};

/** Stage count editor: point markers are always a draft until explicit Save.
 * Never alters a floor plan, room geometry, Defect pins or legacy quantities.
 */
export function FloorHighlightCountPoints({
  room,imageContainer,rotation,locked,onSave,launchStageId,onReturnToRoom,onActiveChange,otherDrawingActive=false,
  objectSnapEnabled,objectSnapMidpoints,cadGridSnap,cadOrtho,cadPolar,
}: Props) {
  const stages=useMemo(()=> (room.subItems||[]).filter(s=>isCountStage(s,room)),[room]);
  const [stageId,setStageId]=useState('');
  const [open,setOpen]=useState(false);
  const [points,setPoints]=useState<CountPoint[]>([]);
  const [mode,setMode]=useState<CountMode>('manual');
  const [regionMode,setRegionMode]=useState<CountRegionMode>('main');
  const [manual,setManual]=useState('0');
  const [action,setAction]=useState<'add'|'move'>('add');
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [notice,setNotice]=useState('');
  const [history,setHistory]=useState<CountPoint[][]>([]);
  const baseline=useRef<{updatedAt:number;revision?:number;stageId:string}|null>(null);
  const dragRef=useRef<{pointerId:number;markerId:string}|null>(null);
  const renderedRoomId=useRef(room.id);
  const currentId=stages.some(s=>s.id===stageId)?stageId:stages[0]?.id||'';
  const current=stages.find(s=>s.id===currentId);
  const saved=current?.highlightCountPoints||[];
  const sum=totalCountPoints(points);
  const invalid=points.length>MAX_COUNT_MARKERS||!validCountPoints(room,points);
  const finalized=locked||room.positionLocked===true||room.inspectionStatus==='Đạt nghiệm thu'||
    current?.status==='Đã hoàn thành'||current?.inspectionStatus==='Đạt nghiệm thu'||room.subItemProgressMigrated===true;
  const changed=JSON.stringify({points,mode,regionMode,manual})!==JSON.stringify({
    points:saved,mode:current?.highlightCountMode||'manual',
    regionMode:current?.highlightCountRegionMode||'main',manual:String(current?.workVolume??0),
  });
  const chosen=points.find(p=>p.id===selectedId);

  const initialize=(id:string)=>{
    const stage=stages.find(s=>s.id===id);
    if(!stage)return;
    setStageId(id);setPoints((stage.highlightCountPoints||[]).map(p=>({...p})));
    setMode(stage.highlightCountMode||'manual');setRegionMode(stage.highlightCountRegionMode||'main');
    setManual(String(stage.workVolume??0));setAction('add');setSelectedId(null);
    setHistory([]);setNotice('');baseline.current={updatedAt:room.updatedAt,revision:room.revision,stageId:id};
  };
  const close=(returnToRoom=false)=>{
    if(changed && !window.confirm('Bỏ các điểm/khối lượng chưa lưu và thoát chế độ đếm?'))return;
    setOpen(false);onActiveChange?.(false);baseline.current=null;setNotice('');
    if(returnToRoom)onReturnToRoom?.();
  };
  useEffect(()=>{
    if(renderedRoomId.current===room.id)return;
    renderedRoomId.current=room.id;
    setOpen(false);setStageId('');setPoints([]);setHistory([]);
    baseline.current=null;onActiveChange?.(false);
  },[room.id]);
  useEffect(()=>{
    if(!launchStageId || !stages.some(s=>s.id===launchStageId) || finalized)return;
    initialize(launchStageId);setOpen(true);onActiveChange?.(true);
    // The parent supplies a new launch id only on navigation from the Room form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[launchStageId]);
  useEffect(()=>{
    if(!open)return;
    const onKey=(ev:KeyboardEvent)=>{if(ev.key==='Escape')close();};
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[open,changed]);
  const start=()=>{
    if(!current||!imageContainer||finalized||otherDrawingActive)return;
    initialize(current.id);setOpen(true);onActiveChange?.(true);
  };
  const switchStage=(id:string)=>{
    if(changed&&!window.confirm('Bỏ bản nháp đếm của hạng mục hiện tại?'))return;
    initialize(id);
  };
  const pushHistory=()=>setHistory(h=>[...h.slice(-29),points.map(p=>({...p}))]);
  const mapped=(ev:React.PointerEvent<SVGSVGElement>):CountPoint=>{
    const rect=imageContainer!.getBoundingClientRect();
    const raw=mapDirectHighlightPointerToFloor(ev.clientX,ev.clientY,rect,rotation);
    const snapped=getDirectHighlightDrawPoint(raw,{
      room,viewport:{width:rect.width,height:rect.height},rotation,pointerType:ev.pointerType,
      tool:'2point',anchor:null,objectSnapEnabled,objectSnapMidpoints,cadGridSnap,cadOrtho,cadPolar,
    }).point;
    return {id:createEntityId('count-point'),x:(snapped.x-room.x)*100/room.width,y:(snapped.y-room.y)*100/room.height,count:1};
  };
  const onPointerDown=(ev:React.PointerEvent<SVGSVGElement>)=>{
    ev.stopPropagation();ev.preventDefault();
    if(finalized||ev.button>0||!imageContainer)return;
    const el=ev.target as SVGElement;
    const markerId=el.closest('[data-hnl-count-marker]')?.getAttribute('data-hnl-count-marker');
    if(markerId){
      setSelectedId(markerId);
      if(action==='move'){
        pushHistory();dragRef.current={pointerId:ev.pointerId,markerId};
        try{ev.currentTarget.setPointerCapture(ev.pointerId);}catch{/* optional */}
      }
      return;
    }
    if(action!=='add')return;
    const p=mapped(ev);
    if(!validCountPoints(room,[p])){setNotice('Chỉ được đánh dấu trong vùng Căn/Phòng hợp lệ.');return;}
    if(points.length>=MAX_COUNT_MARKERS){setNotice(`Tối đa ${MAX_COUNT_MARKERS} vị trí.`);return;}
    // Near-identical points should be combined by editing count, not silently duplicated.
    if(points.some(mark=>Math.hypot(mark.x-p.x,mark.y-p.y)<0.15)){
      setNotice('Đã có dấu ở vị trí này. Hãy chọn dấu để tăng số cái.');return;
    }
    pushHistory();setPoints(prev=>[...prev,p]);setSelectedId(p.id);setNotice('Đã thêm điểm nháp. Bấm Lưu để ghi.');
  };
  const onPointerMove=(ev:React.PointerEvent<SVGSVGElement>)=>{
    if(!dragRef.current||dragRef.current.pointerId!==ev.pointerId||!imageContainer)return;
    ev.stopPropagation();ev.preventDefault();
    const p=mapped(ev);if(!validCountPoints(room,[p]))return;
    setPoints(prev=>prev.map(mark=>mark.id===dragRef.current?.markerId?{...mark,x:p.x,y:p.y}:mark));
  };
  const finishPointer=(ev:React.PointerEvent<SVGSVGElement>)=>{
    if(dragRef.current?.pointerId!==ev.pointerId)return;
    dragRef.current=null;
    try{ev.currentTarget.releasePointerCapture(ev.pointerId);}catch{/* optional */}
  };
  const setMarkerCount=(n:number)=>{
    if(!chosen||!Number.isSafeInteger(n)||n<1||n>100000)return;
    const candidate=points.map(p=>p.id===chosen.id?{...p,count:n}:p);
    if(totalCountPoints(candidate)>100000){setNotice('Tổng tối đa 100.000 cái.');return;}
    pushHistory();setPoints(candidate);
  };
  const save=()=>{
    if(!current||!baseline.current||finalized||invalid)return;
    if(room.updatedAt!==baseline.current.updatedAt||room.revision!==baseline.current.revision){setNotice('Phòng đã thay đổi. Đóng và mở lại để tránh ghi đè.');return;}
    const volume=Number(manual);
    if(mode==='manual'&&(!Number.isSafeInteger(volume)||volume<0||volume>100000)){
      setNotice('Khối lượng nhập tay phải là số cái nguyên từ 0 đến 100.000.');return;
    }
    if(mode==='points'&&current.workVolume!==undefined&&current.workVolume!==sum&&
      !window.confirm(`Áp dụng ${sum} cái tự đếm thay cho ${current.workVolume} cái đã lưu?`))return;
    const request:HighlightCountSaveRequest={roomId:room.id,stageId:current.id,
      expectedUpdatedAt:baseline.current.updatedAt,expectedRevision:baseline.current.revision,
      points:points.map(p=>({...p})),mode,regionMode,
      ...(mode==='manual'?{manualVolume:volume}:{}),
    };
    onSave(request);
    setNotice('Đã gửi yêu cầu cập nhật. Hãy đối chiếu khối lượng và trạng thái đồng bộ sau khi lưu.');
    baseline.current=null;setOpen(false);onActiveChange?.(false);
    if(launchStageId)onReturnToRoom?.(true);
  };
  const backdropShapes=regionMode==='none'||!current?[]:
    getSavedDirectHighlightShapes(room,current.category||room.workCategory||'',regionMode==='own'?current.id:'main')
      .map(shape=>getHighlightShapeFloorPoints(room,shape)).filter((p):p is Point2D[]=>Boolean(p));
  const toFloor=(p:CountPoint)=>({x:room.x+p.x*room.width/100,y:room.y+p.y*room.height/100});
  if(!stages.length)return null;
  return <>
    <div data-hnl-count-toolbar="true" className="absolute left-2 top-14 z-[82] pointer-events-auto max-w-[calc(100%-16px)]">
      <div className="rounded-xl border border-teal-400 bg-slate-950/95 px-2.5 py-2 text-white shadow-2xl w-[min(340px,calc(100vw-32px))] text-[11px]">
        <div className="flex justify-between items-center gap-2">
          <span className="font-extrabold truncate">Đếm hạng mục con · Cái</span>
          <button type="button" disabled={!open&&(finalized||otherDrawingActive||!imageContainer)} onClick={open?()=>close():start}
            aria-pressed={open} className="bg-teal-700 disabled:bg-slate-700 rounded-lg font-bold px-2.5 py-1.5">{open?'Đóng đếm':'Đánh dấu'}</button>
        </div>
        {open&&current&&<div className="mt-2 space-y-2 border-t border-slate-700 pt-2" data-hnl-count-editor="true">
          <label className="block font-bold">Hạng mục con (đơn vị Cái)
            <select className="mt-1 w-full rounded-md p-2 text-slate-900 bg-white" value={currentId} onChange={ev=>switchStage(ev.target.value)}>
              {stages.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block font-bold">Vùng nền Highlight
            <select className="mt-1 w-full rounded-md p-2 text-slate-900 bg-white" value={regionMode} onChange={ev=>setRegionMode(ev.target.value as CountRegionMode)}>
              <option value="main">Dùng vùng chính</option><option value="own">Vùng riêng đã vẽ</option><option value="none">Chỉ hiện điểm</option>
            </select>
          </label>
          <div className="flex gap-1">
            <button type="button" aria-pressed={action==='add'} onClick={()=>setAction('add')} className={`flex-1 rounded-md p-1.5 ${action==='add'?'bg-teal-600':'bg-slate-700'}`}>+ Thêm điểm</button>
            <button type="button" aria-pressed={action==='move'} onClick={()=>setAction('move')} className={`flex-1 rounded-md p-1.5 ${action==='move'?'bg-teal-600':'bg-slate-700'}`}>Chọn / Dời</button>
            <button type="button" disabled={!selectedId} onClick={()=>{pushHistory();setPoints(ps=>ps.filter(p=>p.id!==selectedId));setSelectedId(null);}} className="rounded-md bg-rose-800 px-2 disabled:opacity-40">Xóa</button>
            <button type="button" disabled={!history.length} onClick={()=>{const previous=history[history.length-1];setHistory(h=>h.slice(0,-1));setPoints(previous);setSelectedId(null);}} className="rounded-md bg-slate-700 px-2 disabled:opacity-40">Hoàn tác</button>
          </div>
          {chosen&&<label className="flex items-center justify-between gap-3">Số cái tại điểm đã chọn
            <input aria-label="Số cái tại một vị trí" type="number" min="1" max="100000" step="1" value={chosen.count??1}
              onChange={ev=>setMarkerCount(Number(ev.target.value))} className="w-24 rounded-md bg-white p-1.5 text-slate-900" />
          </label>}
          <label className="block font-bold">Chế độ khối lượng
            <select aria-label="Chế độ tính cái" value={mode} onChange={ev=>setMode(ev.target.value as CountMode)} className="mt-1 w-full rounded-md p-2 text-slate-900 bg-white">
              <option value="manual">Nhập tay · giữ KL đã lưu</option><option value="points">Tự đếm theo điểm</option>
            </select>
          </label>
          {mode==='manual'&&<label className="flex justify-between items-center gap-2">KL nhập tay (Cái)
            <input aria-label="Khối lượng Cái nhập tay" type="number" min="0" step="1" value={manual} onChange={ev=>setManual(ev.target.value)} className="w-28 rounded-md bg-white text-slate-900 p-1.5"/>
          </label>}
          <div className="font-bold text-teal-200">{points.length} điểm · Tự đếm {sum} Cái · KL lưu {current.workVolume??'Chưa có'} Cái</div>
          {mode==='manual'&&Number(manual)!==sum&&<p className="text-amber-200">Chênh lệch nhập tay so với điểm: {Number(manual)-sum} Cái; không tự ghi đè.</p>}
          {mode==='points'&&<p className="text-sky-200">Khi bấm Lưu, KL đề xuất {sum} Cái sẽ trở thành KL chính thức.</p>}
          {notice&&<p role="status" className="text-amber-200 break-words">{notice}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={!changed||finalized||invalid} onClick={save} className="rounded-lg bg-emerald-700 px-3 py-2 font-bold disabled:opacity-40">Lưu điểm & KL</button>
            <button type="button" onClick={()=>close(true)} className="rounded-lg bg-slate-700 px-3 py-2">Xong – Quay lại</button>
          </div>
        </div>}
        {!open&&notice&&<p role="status" className="text-amber-200 mt-1">{notice}</p>}
        {!open&&finalized&&<p className="text-amber-200 mt-1">Phòng/hạng mục bị khóa hoặc đã chốt.</p>}
      </div>
    </div>
    {open&&current&&imageContainer&&!finalized&&createPortal(<svg data-hnl-count-point-canvas="true" className="absolute inset-0 z-[67] h-full w-full cursor-crosshair"
      viewBox="0 0 100 100" preserveAspectRatio="none" style={{touchAction:'none',pointerEvents:'auto'}}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishPointer}
      onPointerCancel={()=>{dragRef.current=null;}} onClick={ev=>{ev.preventDefault();ev.stopPropagation();}}
      onContextMenu={ev=>{ev.preventDefault();ev.stopPropagation();}}>
      {backdropShapes.map((poly,i)=><polygon key={i} points={poly.map(p=>`${p.x},${p.y}`).join(' ')} fill="#38bdf8" fillOpacity="0.12" stroke="#0ea5e9" strokeWidth="0.4" pointerEvents="none"/>)}
      {points.map(point=>{const p=toFloor(point);return <g key={point.id} data-hnl-count-marker={point.id}>
        <circle cx={p.x} cy={p.y} r={selectedId===point.id?1.7:1.4} fill={current.highlightColor||'#0f766e'} stroke={selectedId===point.id?'#fbbf24':'white'} strokeWidth="0.45" />
        <text x={p.x} y={p.y+0.4} textAnchor="middle" fontSize="1.05" fontWeight="bold" fill="white" pointerEvents="none">{point.count??1}</text>
      </g>;})}
    </svg>,imageContainer)}
  </>;
}
