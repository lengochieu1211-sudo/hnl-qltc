import React, { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { SettingsFeatureSheet } from './SettingsFeatureSheet';
import type { InventoryItem, InventoryItemKind, TransactionType } from '../types';
import { formatDateDDMMYYYY } from '../utils/dateFormatter';
import { formatDecimal } from '../utils/numberUtils';
import { saveBlobToDownloads } from '../utils/fileExport';
import { sharePreparedContent } from '../utils/shareUtils';

type Period = 'today' | 'yesterday' | 'range';
type Pick = 'one' | 'many' | 'all';
type Kind = 'all' | InventoryItemKind;
type Direction = 'all' | TransactionType;
function localDay(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
export function selectWarehouseVouchers(rows: InventoryItem[], opts: {
  period: Period; start: string; end: string; kind: Kind; direction: Direction; today?: string; yesterday?: string;
}): InventoryItem[] {
  const start = opts.period === 'today' ? (opts.today || localDay()) : opts.period === 'yesterday' ? (opts.yesterday || localDay(-1)) : opts.start;
  const end = opts.period === 'range' ? opts.end : start;
  if (!start || !end || start > end) return [];
  return rows.filter(x => x.deletedAt == null && x.date >= start && x.date <= end
    && (opts.kind === 'all' || (x.itemKind === 'equipment' ? 'equipment' : 'material') === opts.kind)
    && (opts.direction === 'all' || x.type === opts.direction))
    .sort((a,b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
function drawVoucher(item: InventoryItem) {
  const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 1400;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Không thể tạo ảnh PNG trên thiết bị.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,1000,1400);
  ctx.fillStyle='#172554';ctx.fillRect(0,0,1000,186);
  ctx.fillStyle='#fff';ctx.font='bold 44px Arial';ctx.fillText('HNL QLTC',70,78);
  ctx.font='bold 34px Arial';ctx.fillText(item.type === 'in' ? 'PHIẾU NHẬP KHO' : 'PHIẾU XUẤT KHO',70,143);
  const line = (label:string,value:string,y:number) => {
    ctx.fillStyle='#334155';ctx.font='bold 23px Arial';ctx.fillText(label,70,y);
    ctx.fillStyle='#0f172a';ctx.font='26px Arial';
    const words = String(value || '—').split(/\s+/);
    let row='';let lineY=y+50;
    for(const word of words) {
      const next=row ? row+' '+word : word;
      if(ctx.measureText(next).width>850 && row) {ctx.fillText(row,70,lineY,850);lineY+=38;row=word;}
      else row=next;
    }
    if(row)ctx.fillText(row,70,lineY,850);
  };
  line('Mã phiếu', item.id,265);
  line('Ngày',formatDateDDMMYYYY(item.date),405);
  line('Loại hàng',item.itemKind==='equipment'?'Thiết bị':'Vật tư',500);
  line('Tên vật tư / thiết bị',item.materialName,605);
  line('Số lượng / đơn vị',formatDecimal(item.quantity)+' '+item.unit,790);
  line('Vị trí / kho',item.location,925);
  line('Người thực hiện',item.handler,1035);
  line('Ghi chú',item.notes||'—',1140);
  ctx.fillStyle='#64748b';ctx.font='20px Arial';ctx.fillText('HNL QLTC · Phiếu chỉ đọc · Không làm thay đổi tồn kho',70,1340);
  return canvas;
}
const makeBlob=(canvas:HTMLCanvasElement) => new Promise<Blob>((resolve,reject) => canvas.toBlob(b => b&&b.size>0?resolve(b):reject(new Error('PNG rỗng (0 byte).')), 'image/png'));
const toDataUrl=(blob:Blob) => new Promise<string>((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);
});
const safeFile=(name:string) => name.replace(/[\\/:*?"<>|]/g,'_').slice(0,90);
async function exportReceipts(rows:InventoryItem[],format:'png'|'pdf',action:'download'|'share') {
  if(!rows.length)throw new Error('Chưa chọn phiếu.');
  if(format==='png') {
    if(action==='share' && rows.length>6)throw new Error('Chia sẻ PNG tối đa 6 phiếu/lần; chọn PDF để chia sẻ tất cả.');
    const attachments=[];
    for(const row of rows) {
      const blob=await makeBlob(drawVoucher(row));
      const name=safeFile('HNL-'+(row.type==='in'?'NHAP-':'XUAT-')+row.id+'.png');
      if(action==='download') await saveBlobToDownloads(blob,name,'image/png');
      else attachments.push({id:row.id,fileName:name,mimeType:'image/png',dataUrl:await toDataUrl(blob)});
    }
    if(action==='share') {
      const result=await sharePreparedContent({title:'HNL QLTC · Phiếu kho',text:rows.length+' phiếu kho',attachments,allowTextFallback:false});
      if(result.status==='failed')throw new Error('Không hỗ trợ chia sẻ PNG. Chọn Tải PNG.');
    }
    return;
  }
  const {jsPDF}=await import('jspdf');
  const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
  for(let i=0;i<rows.length;i++) {
    if(i>0)pdf.addPage();
    pdf.addImage(drawVoucher(rows[i]).toDataURL('image/png'),'PNG',0,0,210,294,undefined,'FAST');
  }
  const blob=pdf.output('blob'); if(blob.size<=0)throw new Error('PDF rỗng (0 byte).');
  const name=safeFile('HNL-PHIEU-KHO-'+rows.length+'-'+(rows[0]?.date||'')+'.pdf');
  if(action==='download')await saveBlobToDownloads(blob,name,'application/pdf');
  else {
    const result=await sharePreparedContent({title:'HNL QLTC · Phiếu kho',text:rows.length+' phiếu kho',
      attachments:[{id:'warehouse-pdf',fileName:name,mimeType:'application/pdf',dataUrl:await toDataUrl(blob)}],allowTextFallback:false});
    if(result.status==='failed')throw new Error('Không hỗ trợ chia sẻ PDF. Chọn Tải PDF.');
  }
}
export function WarehouseVoucherShareSheet({open,onClose,inventory,initialVoucherId}:{
  open:boolean;onClose:()=>void;inventory:InventoryItem[];initialVoucherId?:string|null;
}) {
  const first=inventory.find(x=>x.id===initialVoucherId && x.deletedAt==null);
  const [period,setPeriod]=useState<Period>(first?'range':'today');
  const [start,setStart]=useState(first?.date||localDay());
  const [end,setEnd]=useState(first?.date||localDay());
  const [kind,setKind]=useState<Kind>('all');
  const [direction,setDirection]=useState<Direction>('all');
  const [pick,setPick]=useState<Pick>(first?'one':'all');
  const [checked,setChecked]=useState<string[]>(first?[first.id]:[]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const visible=useMemo(()=>selectWarehouseVouchers(inventory,{period,start,end,kind,direction}),[inventory,period,start,end,kind,direction]);
  const chosen=pick==='all'?visible:pick==='one'?visible.filter(v=>v.id===checked.find(id=>visible.some(x=>x.id===id))).slice(0,1):visible.filter(v=>checked.includes(v.id));
  const choice=(current:boolean)=>'min-h-10 rounded-lg border px-3 py-2 text-xs font-semibold '+(current?'border-indigo-600 bg-indigo-600 text-white':'border-slate-300 bg-white text-slate-700');
  const act=async(format:'png'|'pdf',action:'download'|'share')=>{
    setBusy(true);setError('');
    try{await exportReceipts(chosen,format,action);}catch(e){setError(e instanceof Error?e.message:'Xuất phiếu thất bại');}
    finally{setBusy(false);}
  };
  return <SettingsFeatureSheet open={open} onClose={onClose} sheetKey="warehouse-voucher-share" icon={FileText}
    title="Xuất / Chia sẻ phiếu kho" description="Phiếu chỉ đọc, không chỉnh sửa tồn kho hoặc dữ liệu.">
    <div data-hnl-warehouse-voucher-share="readonly" className="space-y-4">
      <p className="text-xs font-bold text-slate-700">Khoảng ngày</p>
      <div className="flex flex-wrap gap-2">{([['today','Hôm nay'],['yesterday','Hôm qua'],['range','Khoảng ngày']] as const).map(([v,label])=>
        <button type="button" key={v} className={choice(period===v)} aria-pressed={period===v} onClick={()=>{setPeriod(v);setChecked([]);}}>{label}</button>)}</div>
      {period==='range'&&<div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold">Từ ngày<input type="date" value={start} max={end} onChange={e=>{setStart(e.target.value);setChecked([]);}} className="mt-1 w-full rounded-lg border p-2" /></label>
        <label className="text-xs font-semibold">Đến ngày<input type="date" value={end} min={start} onChange={e=>{setEnd(e.target.value);setChecked([]);}} className="mt-1 w-full rounded-lg border p-2" /></label>
      </div>}
      <p className="text-xs font-bold text-slate-700">Loại hàng</p>
      <div className="flex flex-wrap gap-2">{([['all','Cả hai'],['material','Vật tư'],['equipment','Thiết bị']] as const).map(([v,label])=>
        <button type="button" key={v} className={choice(kind===v)} aria-pressed={kind===v} onClick={()=>{setKind(v);setChecked([]);}}>{label}</button>)}</div>
      <p className="text-xs font-bold text-slate-700">Loại phiếu</p>
      <div className="flex flex-wrap gap-2">{([['all','Nhập và xuất'],['in','Nhập kho'],['out','Xuất kho']] as const).map(([v,label])=>
        <button type="button" key={v} className={choice(direction===v)} aria-pressed={direction===v} onClick={()=>{setDirection(v);setChecked([]);}}>{label}</button>)}</div>
      <p className="text-xs font-bold text-slate-700">Chọn số phiếu</p>
      <div className="flex flex-wrap gap-2">{([['one','Một phiếu'],['many','Nhiều phiếu'],['all','Tất cả']] as const).map(([v,label])=>
        <button type="button" key={v} className={choice(pick===v)} aria-pressed={pick===v} onClick={()=>setPick(v)}>{label}</button>)}</div>
      <p className="text-xs text-slate-500">Đã chọn {chosen.length}/{visible.length} phiếu.</p>
      {pick!=='all'&&<div className="max-h-72 divide-y overflow-y-auto rounded-lg border">{visible.map(row=>
        <label key={row.id} className="flex min-h-12 items-center gap-2 p-2 text-xs">
          <input type={pick==='one'?'radio':'checkbox'} name={pick==='one'?'voucher-selector':undefined}
            checked={checked.includes(row.id)} onChange={e=>setChecked(prev=>pick==='one'?[row.id]:e.target.checked?[...new Set([...prev,row.id])]:prev.filter(x=>x!==row.id))}/>
          <span className="min-w-0 flex-1 break-words"><b>{formatDateDDMMYYYY(row.date)} · {row.type==='in'?'Nhập':'Xuất'}</b> · {row.materialName}<span className="block break-all text-slate-500">{row.id}</span></span>
          <span className="shrink-0 font-semibold">{formatDecimal(row.quantity)} {row.unit}</span>
        </label>)}</div>}
      {error&&<p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        {([['png','download','Tải PNG'],['pdf','download','Tải PDF'],['png','share','Chia sẻ PNG'],['pdf','share','Chia sẻ PDF']] as const).map(([f,a,label])=>
          <button key={label} data-hnl-voucher-action={f+'-'+a} type="button" disabled={busy||!chosen.length}
            onClick={()=>void act(f,a)} className="min-h-11 rounded-lg bg-indigo-600 px-2 text-xs font-bold text-white disabled:opacity-50">{label}</button>)}
      </div>
      <p className="text-[11px] text-slate-500">PNG: một ảnh mỗi phiếu. PDF: một tài liệu nhiều trang. Chia sẻ PNG tối đa 6 phiếu mỗi lần.</p>
    </div>
  </SettingsFeatureSheet>;
}