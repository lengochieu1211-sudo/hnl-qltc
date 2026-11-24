import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Point2D, RoomProgressItem } from '../types';
import { createEntityId } from '../utils/idUtils';
import { getDirectHighlightDrawPoint, getSavedDirectHighlightShapes, mapDirectHighlightPointerToFloor } from '../utils/floorHighlightDirectShapes';
import { getHighlightShapeFloorPoints } from '../utils/highlightTotalGeometry';
import { isCountStage, totalCountPoints, validCountPoints, parseManualHighlightCount, MAX_COUNT_MARKERS, type CountMode, type CountPoint, type CountRegionMode, type HighlightCountSaveRequest } from '../utils/highlightCountPoints';

import { highlightDraftKey, openHighlightDraft, writeHighlightDraft, removeHighlightDraft, draftRecord, draftNumber, draftOptionalNumber, draftPoint, type DraftSlot, type HighlightDraftScope } from '../utils/highlightLocalDraft';
type CountBaseline={updatedAt:number;revision?:number;stageId:string};
type CountDraft={baseline:CountBaseline;points:CountPoint[];mode:CountMode;regionMode:CountRegionMode;manual:string};
const isCountDraft=(v:unknown):v is CountDraft=>draftRecord(v)&&draftRecord(v.baseline)&&typeof v.baseline.stageId==='string'&&draftNumber(v.baseline.updatedAt)&&draftOptionalNumber(v.baseline.revision)&&Array.isArray(v.points)&&v.points.length<=MAX_COUNT_MARKERS&&v.points.every(p=>draftPoint(p)&&draftRecord(p)&&typeof p.id==='string'&&p.id.length<=100&&(p.count===undefined||(draftNumber(p.count)&&Number.isSafeInteger(p.count)&&p.count>=1&&p.count<=100000)))&&(v.mode==='manual'||v.mode==='points')&&(v.regionMode==='main'||v.regionMode==='own'||v.regionMode==='none')&&typeof v.manual==='string'&&v.manual.length<=100;
type Props = {
  draftScope?: HighlightDraftScope;
  room: RoomProgressItem;
  imageContainer: HTMLElement | null;
  rotation: number;
  locked: boolean;
  onSave: (request: HighlightCountSaveRequest) => Promise<RoomProgressItem>;
  launchStageId?: string | null;
  onReturnToRoom?: (acknowledged?:RoomProgressItem) => void;
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
  room,draftScope,imageContainer,rotation,locked,onSave,launchStageId,onReturnToRoom,onActiveChange,otherDrawingActive=false,
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
  const [saving,setSaving]=useState(false);
  const savingRef=useRef(false);
  const mountedRef=useRef(false);
  useEffect(()=>{mountedRef.current=true;return()=>{mountedRef.current=false;};},[]);
  const [history,setHistory]=useState<CountPoint[][]>([]);
  const baseline=useRef<CountBaseline|null>(null);
  const slot=useRef<DraftSlot<CountDraft>|null>(null);
  const [draftNotice,setDraftNotice]=useState('');
  const draftError=useRef('');
  const reportDraft=(message:string)=>{draftError.current=message;setDraftNotice(message);};
  const dragRef=useRef<{pointerId:number;markerId:string}|null>(null);
  const renderedRoomId=useRef(room.id);
  const currentId=open?stageId:(stages.some(s=>s.id===stageId)?stageId:stages[0]?.id||'');
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
  const stale=Boolean(baseline.current&&(room.updatedAt!==baseline.current.updatedAt||room.revision!==baseline.current.revision));
  const chosen=points.find(p=>p.id===selectedId);

  const initialize=(id:string)=>{
    const stage=stages.find(s=>s.id===id);
    if(!stage)return;
    setStageId(id);setPoints((stage.highlightCountPoints||[]).map(p=>({...p})));
    setMode(stage.highlightCountMode||'manual');setRegionMode(stage.highlightCountRegionMode||'main');
    setManual(String(stage.workVolume??0));setAction('add');setSelectedId(null);
    setHistory([]);setNotice('');baseline.current={updatedAt:room.updatedAt,revision:room.revision,stageId:id};
    slot.current=null;reportDraft('');
    try {
      const entry=openHighlightDraft(highlightDraftKey(draftScope,'count',room.id,id),isCountDraft);
      if(entry.value && entry.value.baseline.stageId!==id)throw new Error('Bản nháp không đúng hạng mục.');
      slot.current=entry;
      if(entry.value){const v=entry.value;baseline.current=v.baseline;setPoints(v.points);setMode(v.mode);setRegionMode(v.regionMode);setManual(v.manual);
        setNotice('Đã khôi phục bản nháp trên thiết bị. Chưa ghi Firestore.');}
    } catch(error){reportDraft(`Không thể lưu/khôi phục nháp: ${error instanceof Error?error.message:String(error)}`);}
  };
  const close=(returnToRoom=false)=>{
    if(savingRef.current)return;
    if(changed && draftError.current && !window.confirm('Bản nháp chưa được bảo vệ trên thiết bị. Thoát có thể mất thay đổi. Tiếp tục?'))return;
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
    if(savingRef.current)return;
    if(changed&&draftError.current&&!window.confirm('Bản nháp chưa được bảo vệ. Đổi hạng mục có thể mất thay đổi. Tiếp tục?'))return;
    initialize(id);
  };
  useLayoutEffect(()=>{
    if(!open||!baseline.current||baseline.current.stageId!==stageId||!slot.current||(!changed&&!slot.current.value))return;
    try{writeHighlightDraft(slot.current,{baseline:baseline.current,points,mode,regionMode,manual});reportDraft('');}
    catch(error){reportDraft(`Chưa bảo vệ nháp: ${error instanceof Error?error.message:String(error)}`);}
  },[open,stageId,points,mode,regionMode,manual,changed]);
  const discardDraft=()=>{
    if(savingRef.current||!current||!window.confirm('Xóa bản nháp trên thiết bị và tải lại dữ liệu hiện tại?'))return;
    try{if(!slot.current)throw new Error('Không mở được bản nháp.');removeHighlightDraft(slot.current);initialize(current.id);}
    catch(error){reportDraft(`Không thể xóa nháp: ${error instanceof Error?error.message:String(error)}`);}
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
    if(savingRef.current||finalized||ev.button>0||!imageContainer)return;
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
    if(savingRef.current||!dragRef.current||dragRef.current.pointerId!==ev.pointerId||!imageContainer)return;
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
  const save=async()=>{
    if(savingRef.current||!current||!baseline.current||baseline.current.stageId!==current.id||finalized||invalid)return;
    if(room.updatedAt!==baseline.current.updatedAt||room.revision!==baseline.current.revision){setNotice('Phòng đã thay đổi. Giữ nháp để đối chiếu; chọn Xóa nháp nếu muốn bắt đầu từ dữ liệu mới.');return;}
    const volume=parseManualHighlightCount(manual);
    if(mode==='manual'&&volume===null){
      setNotice('Nhập số cái nguyên từ 0 đến 100.000. Ô trống không được hiểu là 0.');return;
    }
    if(mode==='points'&&current.workVolume!==undefined&&current.workVolume!==sum&&
      !window.confirm(`Áp dụng ${sum} cái tự đếm thay cho ${current.workVolume} cái đã lưu?`))return;
    const request:HighlightCountSaveRequest={roomId:room.id,stageId:current.id,
      expectedUpdatedAt:baseline.current.updatedAt,expectedRevision:baseline.current.revision,
      points:points.map(p=>({...p})),mode,regionMode,
      ...(mode==='manual'&&volume!==null?{manualVolume:volume}:{}),
    };
    savingRef.current=true;setSaving(true);setNotice('Đang xác nhận điểm đếm và KL trên Firestore...');
    try {
      const acknowledged=await onSave(request);
      try{if(slot.current)removeHighlightDraft(slot.current);}catch(error){reportDraft(`Đã lưu Firestore nhưng chưa xóa nháp: ${String(error)}`);}
      baseline.current=null;setOpen(false);if(mountedRef.current)onActiveChange?.(false);setNotice('Firestore đã xác nhận lưu điểm đếm.');
      if(mountedRef.current&&launchStageId)onReturnToRoom?.(acknowledged);
    } catch(error) {
      setNotice(`Chưa xác nhận lưu: ${error instanceof Error?error.message:String(error)}. Bản nháp vẫn còn.`);
    } finally {savingRef.current=false;setSaving(false);}
  };
  const backdropShapes=regionMode==='none'||!current?[]:
    getSavedDirectHighlightShapes(room,current.category||room.workCategory||'',regionMode==='own'?current.id:'main')
      .map(shape=>getHighlightShapeFloorPoints(room,shape)).filter((p):p is Point2D[]=>Boolean(p));
  const toFloor=(p:CountPoint)=>({x:room.x+p.x*room.width/100,y:room.y+p.y*room.height/100});
  if(!stages.length&&!open)return null;
  return <>
    <div data-hnl-count-toolbar="true" className="absolute left-2 top-14 z-[82] pointer-events-auto max-w-[calc(100%-16px)]">
      <div className="rounded-xl border border-teal-400 bg-slate-950/95 px-2.5 py-2 text-white shadow-2xl w-[min(340px,calc(100vw-32px))] text-[11px]">
        <div className="flex justify-between items-center gap-2">
          <span className="font-extrabold truncate">Đếm hạng mục con · Cái</span>
          <button type="button" disabled={!open&&(finalized||otherDrawingActive||!imageContainer)} onClick={open?()=>close():start}
            aria-pressed={open} className="bg-teal-700 disabled:bg-slate-700 rounded-lg font-bold px-2.5 py-1.5">{open?'Đóng đếm':'Đánh dấu'}</button>
        </div>
        {open&&!current&&<p role="status" className="text-amber-200">Hạng mục đã thay đổi hoặc bị xóa. Điểm nháp vẫn còn; không thể lưu.</p>}
        {open&&current&&<fieldset disabled={saving} className="mt-2 space-y-2 border-t border-slate-700 pt-2 min-w-0" data-hnl-count-editor="true">
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
          {mode==='manual'&&parseManualHighlightCount(manual)===null&&<p role="alert" className="text-amber-200">Nhập số cái nguyên từ 0 đến 100.000. Ô trống không được hiểu là 0.</p>}
          {mode==='manual'&&parseManualHighlightCount(manual)!==null&&Number(manual)!==sum&&<p className="text-amber-200">Chênh lệch nhập tay so với điểm: {Number(manual)-sum} Cái; không tự ghi đè.</p>}
          {mode==='points'&&<p className="text-sky-200">Khi bấm Lưu, KL đề xuất {sum} Cái sẽ trở thành KL chính thức.</p>}
          {stale&&<p role="alert" className="text-amber-200">Dữ liệu phòng đã thay đổi; chỉ xem nháp, không ghi đè.</p>}
          {draftNotice&&<p role="alert" className="text-amber-200 break-words">{draftNotice}</p>}
          {!draftNotice&&<p className="text-slate-300">Nháp lưu trên thiết bị; chỉ cập nhật KL chính thức khi Firestore xác nhận.</p>}
          <button type="button" onClick={discardDraft} className="text-amber-200 underline">Xóa nháp / tải dữ liệu mới</button>
          {notice&&<p role="status" className="text-amber-200 break-words">{notice}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={!changed||finalized||invalid||stale||(mode==='manual'&&parseManualHighlightCount(manual)===null)} onClick={save} className="rounded-lg bg-emerald-700 px-3 py-2 font-bold disabled:opacity-40">Lưu điểm & KL</button>
            <button type="button" onClick={()=>close(true)} className="rounded-lg bg-slate-700 px-3 py-2">Xong – Quay lại</button>
          </div>
        </fieldset>}
        {!open&&draftNotice&&<p role="alert" className="text-amber-200 mt-1">{draftNotice}</p>}
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
