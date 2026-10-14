import React, { useEffect, useMemo, useState } from 'react';
import { Copy, FileSpreadsheet, FileText, Image as ImageIcon, FileDown, X, Download, Share2 } from 'lucide-react';
import { SettingsFeatureSheet } from './SettingsFeatureSheet';
import type { InventoryItem, InventoryItemKind, TransactionType } from '../types';
import { formatDateDDMMYYYY } from '../utils/dateFormatter';
import { formatDecimal } from '../utils/numberUtils';
import { saveBlobToDownloads } from '../utils/fileExport';
import { sharePreparedContent } from '../utils/shareUtils';
import { isAndroidExportBridgeAvailable } from '../utils/fileExport';
import { drawWarehouseVoucherPage, paginateWarehouseVouchers } from '../utils/warehouseVoucherPrint';
import { buildWarehouseVoucherText } from '../utils/warehouseVoucherExcel';

type VoucherFormat = 'text' | 'png' | 'xlsx' | 'pdf';
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
type VoucherFile = {
  id: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  dataUrl: string;
};
const makeBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) =>
  canvas.toBlob(blob => blob && blob.size > 0 ? resolve(blob) : reject(new Error('Ảnh phiếu kho rỗng (0 byte).')), 'image/png'));
const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});
const safeFile = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 110);

async function prepareVoucherFiles(rows: InventoryItem[], format: Exclude<VoucherFormat, 'text'>, projectName: string, projectLocation: string, contractorName: string): Promise<VoucherFile[]> {
  const pages = paginateWarehouseVouchers(rows);
  if (!pages.length) throw new Error('Chưa có giao dịch kho để xuất.');
  if (format === 'xlsx') {
    const {buildWarehouseVoucherExcel} = await import('../utils/warehouseVoucherExcel');
    const {blob,fileName,mimeType} = await buildWarehouseVoucherExcel(pages, {projectName, projectLocation, contractorName});
    return [{id:'voucher-excel',fileName,mimeType,blob,dataUrl:await toDataUrl(blob)}];
  }
  if (format === 'png') {
    const files: VoucherFile[] = [];
    for (const [index, page] of pages.entries()) {
      const blob = await makeBlob(drawWarehouseVoucherPage(page, { projectName, projectLocation, contractorName }));
      const fileName = safeFile('PHIEU_' + (page.direction === 'in' ? 'NHAP' : 'XUAT') + '_KHO_' + page.date + '_TRANG_' + (index + 1) + '.png');
      files.push({ id: 'page-' + (index + 1), fileName, mimeType: 'image/png', blob, dataUrl: await toDataUrl(blob) });
    }
    return files;
  }
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  for (const [index, page] of pages.entries()) {
    if (index) pdf.addPage();
    pdf.addImage(drawWarehouseVoucherPage(page, { projectName, projectLocation, contractorName }).toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  }
  const blob = pdf.output('blob');
  if (blob.size <= 0) throw new Error('PDF phiếu kho rỗng (0 byte).');
  const fileName = safeFile('PHIEU_KHO_' + rows.length + '_DONG_' + pages.length + '_TRANG.pdf');
  return [{ id: 'voucher-pdf', fileName, mimeType: 'application/pdf', blob, dataUrl: await toDataUrl(blob) }];
}
export function WarehouseVoucherShareSheet({open,onClose,inventory,projectName='',projectLocation='',contractorName=''}:{
  open:boolean;onClose:()=>void;inventory:InventoryItem[];projectName?:string;projectLocation?:string;contractorName?:string;
}) {
  // One shared export entry point: users explicitly select one, many or all items.
  const [period,setPeriod]=useState<Period>('today');
  const [start,setStart]=useState(localDay());
  const [end,setEnd]=useState(localDay());
  const [kind,setKind]=useState<Kind>('all');
  const [direction,setDirection]=useState<Direction>('all');
  const [pick,setPick]=useState<Pick>('all');
  const [checked,setChecked]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [menu,setMenu]=useState<VoucherFormat|null>(null);
  const [prepared,setPrepared]=useState<{format:Exclude<VoucherFormat,'text'>;signature:string;files:VoucherFile[]}|null>(null);
  const visible=useMemo(()=>selectWarehouseVouchers(inventory,{period,start,end,kind,direction}),[inventory,period,start,end,kind,direction]);
  const chosen=useMemo(()=>pick==='all'?visible:pick==='one'
    ?visible.filter(v=>v.id===checked.find(id=>visible.some(x=>x.id===id))).slice(0,1)
    :visible.filter(v=>checked.includes(v.id)),[pick,visible,checked]);
  const selectionSignature=[projectName,projectLocation,contractorName,...chosen.map(item=>[item.id,item.type,item.date,item.location,item.handler,item.materialName,item.unit,item.quantity,item.notes].join('|'))].join('\n');
  const pages=useMemo(()=>paginateWarehouseVouchers(chosen),[chosen]);
  useEffect(()=>{setPrepared(null);setMenu(null);setError('');setMessage('');},[selectionSignature]);
  const choice=(current:boolean)=>'min-h-10 rounded-lg border px-3 py-2 text-xs font-semibold '+(current?'border-indigo-600 bg-indigo-600 text-white':'border-slate-300 bg-white text-slate-700');
  const openActions=async(format:'png'|'pdf')=>{
    if(!chosen.length||busy)return;
    if(menu===format){setMenu(null);return;}
    setMenu(format);setError('');setMessage('');
    if(prepared?.format===format && prepared.signature===selectionSignature)return;
    setPrepared(null);setBusy(true);
    try{
      const files=await prepareVoucherFiles(chosen,format,projectName,projectLocation,contractorName);
      setPrepared({format,signature:selectionSignature,files});
    }catch(e){setError(e instanceof Error?e.message:'Không chuẩn bị được phiếu kho.');}
    finally{setBusy(false);}
  };
  const act=async(action:'download'|'share')=>{
    if(!menu||!prepared||prepared.signature!==selectionSignature||prepared.format!==menu||busy)return;
    const files=prepared.files;
    if(action==='share'&&files.length>6){
      setError('Chia sẻ PNG tối đa 6 trang mỗi lần. Hãy chọn PDF để chia sẻ toàn bộ.');
      return;
    }
    setBusy(true);setError('');setMessage('');
    try{
      if(action==='download'){
        for(const file of files)await saveBlobToDownloads(file.blob,file.fileName,file.mimeType);
        setMessage(files.length===1?'Đã yêu cầu tải file phiếu kho. Hãy kiểm tra Tải xuống.':
          isAndroidExportBridgeAvailable()
            ? 'Đã lưu '+files.length+' ảnh phiếu kho vào Tải xuống/QLTC.'
            : 'Đã yêu cầu tải '+files.length+' ảnh; trình duyệt có thể yêu cầu cấp quyền tải nhiều file.');
      }else{
        // All image/PDF bytes are prepared on the earlier PNG/PDF click, so the
        // final Share click can invoke navigator.share with transient activation.
        const result=await sharePreparedContent({title:'Phiếu nhập/xuất kho',
          text:'Phiếu kho · '+chosen.length+' dòng vật tư · '+pages.length+' trang A4',
          attachments:files.map(file=>({id:file.id,fileName:file.fileName,mimeType:file.mimeType,dataUrl:file.dataUrl})),
          allowTextFallback:false});
        if(result.status==='shared')setMessage('Đã yêu cầu mở bảng chia sẻ '+menu.toUpperCase()+'.');
        else if(result.status==='cancelled')setMessage('Đã hủy chia sẻ.');
        else setError('Thiết bị hoặc trình duyệt không hỗ trợ chia sẻ file trực tiếp. Hãy chọn Tải '+menu.toUpperCase()+'.');
      }
    }catch(e){setError(e instanceof Error?e.message:'Không thể tải hoặc chia sẻ phiếu kho.');}
    finally{setBusy(false);}
  };
  return <SettingsFeatureSheet open={open} onClose={onClose} sheetKey="warehouse-voucher-share" icon={FileText}
    title="Chia sẻ phiếu nhập/xuất kho" description="Chọn Nội dung, Ảnh, Excel hoặc PDF. Phiếu chỉ đọc, không ảnh hưởng tồn kho.">
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
      <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700" data-hnl-voucher-layout="multirow-a4">
        {chosen.length} dòng vật tư/thiết bị → {pages.length} trang A4. Các dòng cùng ngày, loại nhập/xuất,
        kho và người thực hiện được xếp chung một phiếu; mã tham chiếu gốc vẫn được giữ trong bảng.
      </p>
      {error&&<p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
      {message&&<p role="status" className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">{message}</p>}
      <div className="grid grid-cols-2 gap-2">
        {(['png','pdf'] as const).map(format=>
          <button key={format} data-hnl-voucher-format={format} type="button" disabled={busy||!chosen.length}
            aria-expanded={menu===format} onClick={()=>void openActions(format)}
            className="min-h-11 rounded-xl border border-indigo-200 bg-indigo-600 px-3 text-xs font-bold text-white disabled:opacity-50">
            {busy&&menu===format?'Đang chuẩn bị...':format==='png'?'Ảnh PNG':'Tài liệu PDF'}
          </button>)}
      </div>
      {menu&&<div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
        <p className="mb-2 text-xs font-semibold text-slate-700">{menu.toUpperCase()} · {prepared?.format===menu?prepared.files.length:'Đang tạo'} file</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" data-hnl-voucher-action={menu+'-download'} disabled={busy||!prepared||prepared.format!==menu}
            onClick={()=>void act('download')} className="min-h-11 rounded-lg bg-white px-3 text-xs font-bold text-indigo-700 disabled:opacity-50">
            Tải {menu.toUpperCase()}
          </button>
          <button type="button" data-hnl-voucher-action={menu+'-share'} disabled={busy||!prepared||prepared.format!==menu}
            onClick={()=>void act('share')} className="min-h-11 rounded-lg bg-indigo-700 px-3 text-xs font-bold text-white disabled:opacity-50">
            Chia sẻ {menu.toUpperCase()}
          </button>
        </div>
      </div>}
      <p className="text-[11px] text-slate-500">Một phiếu in chứa bảng nhiều dòng; PNG theo trang, PDF gộp mọi trang. Chia sẻ PNG tối đa 6 trang/lần.</p>
    </div>
  </SettingsFeatureSheet>;
}