import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileSpreadsheet, FileText, Image as ImageIcon, FileDown, X, Download, Share2, Settings2 } from 'lucide-react';
import { SettingsFeatureSheet } from './SettingsFeatureSheet';
import type { InventoryItem, InventoryItemKind, TransactionType } from '../types';
import { formatDateDDMMYYYY } from '../utils/dateFormatter';
import { formatDecimal } from '../utils/numberUtils';
import { saveBlobToDownloads } from '../utils/fileExport';
import { sharePreparedContent } from '../utils/shareUtils';
import { isAndroidExportBridgeAvailable } from '../utils/fileExport';
import { drawWarehouseVoucherPage, paginateWarehouseVouchers, DEFAULT_VOUCHER_PAGE_OPTIONS } from '../utils/warehouseVoucherPrint';
import type {WarehousePageOptions} from '../utils/warehouseCatalogReport';
import { warehouseVoucherIsoDate, isWarehouseVoucherDateInRange } from '../utils/warehouseVoucherDateFilter';

type VoucherFormat = 'png' | 'xlsx' | 'pdf';

// Match the Crew Report sharing controls: selected format determines both
// the primary action color and the complementary outlined download action.
const voucherActionPalette: Record<VoucherFormat, { download: string; share: string }> = {
  png: { download: 'border-sky-200 text-sky-700 hover:bg-sky-50', share: 'bg-sky-600 hover:bg-sky-700' },
  xlsx: { download: 'border-green-200 text-green-700 hover:bg-green-50', share: 'bg-green-600 hover:bg-green-700' },
  pdf: { download: 'border-red-200 text-red-700 hover:bg-red-50', share: 'bg-red-600 hover:bg-red-700' },
};
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
  return rows.filter(x => x.deletedAt == null && isWarehouseVoucherDateInRange(x.date, start, end)
    && (opts.kind === 'all' || (x.itemKind === 'equipment' ? 'equipment' : 'material') === opts.kind)
    && (opts.direction === 'all' || x.type === opts.direction))
    .sort((a,b) => (warehouseVoucherIsoDate(b.date).localeCompare(warehouseVoucherIsoDate(a.date)) || a.id.localeCompare(b.id)));
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

async function prepareVoucherFiles(rows: InventoryItem[], format: VoucherFormat, projectName: string, projectLocation: string, contractorName: string, options: WarehousePageOptions): Promise<VoucherFile[]> {
  const pages = paginateWarehouseVouchers(rows,options);
  if (!pages.length) throw new Error('Chưa có giao dịch kho để xuất.');
  if (format === 'xlsx') {
    const {buildWarehouseVoucherExcel} = await import('../utils/warehouseVoucherExcel');
    const {blob,fileName,mimeType} = await buildWarehouseVoucherExcel(pages, {projectName, projectLocation, contractorName}, options);
    return [{id:'voucher-excel',fileName,mimeType,blob,dataUrl:await toDataUrl(blob)}];
  }
  if (format === 'png') {
    const files: VoucherFile[] = [];
    for (const [index, page] of pages.entries()) {
      const blob = await makeBlob(drawWarehouseVoucherPage(page, { projectName, projectLocation, contractorName }, options));
      const fileName = safeFile('PHIEU_' + (page.direction === 'in' ? 'NHAP' : 'XUAT') + '_KHO_' + page.date + '_TRANG_' + (index + 1) + '.png');
      files.push({ id: 'page-' + (index + 1), fileName, mimeType: 'image/png', blob, dataUrl: await toDataUrl(blob) });
    }
    return files;
  }
  // Text PDF: unlike the PNG renderer, this uses native PDF text with an
  // embedded Unicode font (offline, searchable/selectable, no raster screenshot).
  const {buildWarehouseVoucherTextPdf} = await import('../utils/warehouseVoucherTextPdf');
  const blob = await buildWarehouseVoucherTextPdf(pages, {projectName, projectLocation, contractorName}, options);
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
  const [showOptions,setShowOptions]=useState(false);
  const [options,setOptions]=useState<WarehousePageOptions>(()=>{
    try {
      const saved=JSON.parse(localStorage.getItem('hnl-warehouse-export-layout-v1')||'null');
      if(saved&&['A4','A3'].includes(saved.paperSize)&&['auto','portrait','landscape'].includes(saved.orientation)&&['one','split'].includes(saved.fit))return saved;
    } catch (_) { /* unavailable storage: keep safe defaults */ }
    return DEFAULT_VOUCHER_PAGE_OPTIONS;
  });
  useEffect(()=>{
    try {localStorage.setItem('hnl-warehouse-export-layout-v1',JSON.stringify(options));} catch (_) { /* ignore */ }
    setPrepared(null);setMenu(null);
  },[options]);
  const [prepared,setPrepared]=useState<{format:VoucherFormat;signature:string;files:VoucherFile[]}|null>(null);
  const visible=useMemo(()=>selectWarehouseVouchers(inventory,{period,start,end,kind,direction}),[inventory,period,start,end,kind,direction]);
  const chosen=useMemo(()=>pick==='all'?visible:pick==='one'
    ?visible.filter(v=>v.id===checked.find(id=>visible.some(x=>x.id===id))).slice(0,1)
    :visible.filter(v=>checked.includes(v.id)),[pick,visible,checked]);
  const selectionSignature=[JSON.stringify(options),projectName,projectLocation,contractorName,...chosen.map(item=>[item.id,item.type,item.date,item.location,item.handler,item.materialName,item.unit,item.quantity,item.notes].join('|'))].join('\n');
  const pages=useMemo(()=>paginateWarehouseVouchers(chosen,options),[chosen,options]);
  useEffect(()=>{setPrepared(null);setMenu(null);setError('');setMessage('');},[selectionSignature]);
  const choice=(current:boolean)=>'min-h-10 rounded-lg border px-3 py-2 text-xs font-semibold '+(current?'border-indigo-600 bg-indigo-600 text-white':'border-slate-300 bg-white text-slate-700');
  const formatLabel=(format:VoucherFormat) => format==='png'?'ảnh':format==='xlsx'?'Excel':'PDF';
  const openActions=async(format:VoucherFormat)=>{
    if(!chosen.length||busy)return;
    if(menu===format){setMenu(null);return;}
    setMenu(format);setError('');setMessage('');
    if(prepared?.format===format && prepared.signature===selectionSignature)return;
    setPrepared(null);setBusy(true);
    try{
      const files=await prepareVoucherFiles(chosen,format,projectName,projectLocation,contractorName,options);
      setPrepared({format,signature:selectionSignature,files});
    }catch(e){setError(e instanceof Error?e.message:'Không chuẩn bị được phiếu kho.');}
    finally{setBusy(false);}
  };
  const act=async(action:'download'|'share')=>{
    if(!menu||busy)return;
    if(!prepared||prepared.signature!==selectionSignature||prepared.format!==menu)return;
    const files=prepared.files;
    if(action==='share'&&files.length>6){
      setError('Chia sẻ tối đa 6 ảnh/trang mỗi lần. Hãy chọn PDF hoặc Excel để chia sẻ toàn bộ.');
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
      }else if(action==='share'){
        // File bytes are prepared before the final click to preserve native share activation.
        const result=await sharePreparedContent({title:'Phiếu nhập/xuất kho',
          text:'Phiếu kho · '+chosen.length+' dòng vật tư · '+pages.length+' trang '+options.paperSize,
          attachments:files.map(file=>({id:file.id,fileName:file.fileName,mimeType:file.mimeType,dataUrl:file.dataUrl})),
          // Avoid re-decoding large XLSX data URLs during the short browser share gesture.
          browserFiles:files.map(file=>new File([file.blob],file.fileName,{type:file.mimeType})),
          allowTextFallback:false});
        if(result.status==='shared')setMessage('Đã yêu cầu mở bảng chia sẻ '+formatLabel(menu)+'.');
        else if(result.status==='cancelled')setMessage('Đã hủy chia sẻ.');
        else if(result.failureReason==='browser-file-sharing-unavailable'
          && !isAndroidExportBridgeAvailable() && files.length===1 && (menu==='xlsx'||menu==='pdf')){
          // Some mobile browsers reject XLSX/PDF as a Web Share attachment.
          // Never send text instead of the real file or claim Zalo has received it.
          await saveBlobToDownloads(files[0].blob,files[0].fileName,files[0].mimeType);
          setMessage('Trình duyệt chưa cho chia sẻ trực tiếp '+formatLabel(menu)+
            '. Đã yêu cầu tải file về máy. Mở Quản lý tệp → Tải xuống → chọn file → Chia sẻ → Zalo.');
        }else throw new Error('Trình duyệt/thiết bị không cho chia sẻ '+formatLabel(menu)+
          ' trực tiếp. Hãy chọn Tải '+formatLabel(menu)+' rồi chia sẻ file từ Tải xuống.');
      }
      setMenu(null);
    }catch(e){setError(e instanceof Error?e.message:'Không thể tải hoặc chia sẻ phiếu kho.');}
    finally{setBusy(false);}
  };
  return <SettingsFeatureSheet open={open} onClose={onClose} sheetKey="warehouse-voucher-share" icon={FileText}
    title="Chia sẻ phiếu nhập/xuất kho" description="Chọn Ảnh, Excel hoặc PDF. Phiếu chỉ đọc, không ảnh hưởng tồn kho.">
    <div data-hnl-warehouse-voucher-share="readonly" className="space-y-4">
      <p className="text-xs text-slate-500">Bộ lọc chia sẻ độc lập với tìm kiếm ở Nhật ký. Mặc định chỉ lấy phiếu hôm nay; chọn Khoảng ngày nếu cần các phiếu cũ.</p>
      <p className="text-xs font-bold text-slate-700">Khoảng ngày</p>
      <div className="flex flex-wrap gap-2">{([['today','Hôm nay'],['yesterday','Hôm qua'],['range','Khoảng ngày']] as const).map(([v,label])=>
        <button type="button" key={v} className={choice(period===v)} aria-pressed={period===v} onClick={()=>{setPeriod(v);setChecked([]);}}>{label}</button>)}</div>
      {period==='range'&&<div data-hnl-voucher-date-range="compact" className="flex flex-wrap items-start gap-2">
        <label className="flex w-full max-w-[158px] min-w-0 flex-col text-xs font-semibold">Từ ngày<input type="date" value={start} max={end} onChange={e=>{setStart(e.target.value);setChecked([]);}} className="mt-1 w-full min-w-0 rounded-lg border p-2" /></label>
        <label className="flex w-full max-w-[158px] min-w-0 flex-col text-xs font-semibold">Đến ngày<input type="date" value={end} min={start} onChange={e=>{setEnd(e.target.value);setChecked([]);}} className="mt-1 w-full min-w-0 rounded-lg border p-2" /></label>
      </div>}
      <p className="text-xs font-bold text-slate-700">Loại hàng</p>
      <div className="flex flex-wrap gap-2">{([['all','Cả hai'],['material','Vật tư'],['equipment','Thiết bị']] as const).map(([v,label])=>
        <button type="button" key={v} className={choice(kind===v)} aria-pressed={kind===v} onClick={()=>{setKind(v);setChecked([]);}}>{label}</button>)}</div>
      <p className="text-xs font-bold text-slate-700">Loại phiếu</p>
      <div className="flex flex-wrap gap-2">{([['all','Nhập và xuất'],['in','Nhập kho'],['out','Xuất kho']] as const).map(([v,label])=>
        <button type="button" key={v} className={choice(direction===v)} aria-pressed={direction===v} onClick={()=>{setDirection(v);setChecked([]);}}>{label}</button>)}</div>
      <p className="text-xs font-bold text-slate-700">Chọn giao dịch in phiếu</p>
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
      <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700" data-hnl-voucher-layout="multirow-paper">
        {chosen.length} dòng vật tư/thiết bị → {pages.length} trang {options.paperSize}. Các dòng cùng ngày, loại nhập/xuất,
        kho và người thực hiện được xếp chung một phiếu; mã tham chiếu gốc vẫn được giữ trong bảng.
      </p>
      {error&&<p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
      {message&&<p role="status" className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">{message}</p>}
      <div data-hnl-voucher-formats="unified" data-hnl-export-format-group="true" data-hnl-export-format-count="4" className="grid w-full max-w-[480px] min-w-0 grid-cols-2 gap-2 min-[960px]:inline-grid min-[960px]:w-auto min-[960px]:max-w-full min-[960px]:grid-cols-[repeat(4,112px)]" role="group" aria-label="Định dạng chia sẻ phiếu kho">
        {([
          ['png','Ảnh',ImageIcon,'bg-sky-600 hover:bg-sky-700 focus-visible:ring-sky-300'],
          ['xlsx','Excel',FileSpreadsheet,'bg-green-600 hover:bg-green-700 focus-visible:ring-green-300'],
          ['pdf','PDF',FileDown,'bg-red-600 hover:bg-red-700 focus-visible:ring-red-300'],
        ] as const).map(([format,label,Icon,buttonColor])=>
          <button key={format} data-hnl-voucher-format={format} type="button" disabled={busy||!chosen.length}
            aria-expanded={menu===format} onClick={()=>void openActions(format)}
            className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-bold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40 ${buttonColor}`}>
            <Icon className="h-4 w-4 shrink-0" /> {busy&&menu===format?'Đang tạo…':label}
          </button>)}
        <button type="button" data-hnl-voucher-export-options="toggle" aria-expanded={showOptions}
          disabled={busy} onClick={()=>setShowOptions(v=>!v)}
          className="inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 disabled:opacity-40">
          <Settings2 className="h-4 w-4 shrink-0"/> Tùy chọn
        </button>
      </div>
      {showOptions&&<div data-hnl-voucher-export-options="form" className="grid w-full max-w-[720px] min-w-0 grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs min-[960px]:grid-cols-3">
        <label className="grid min-w-0 gap-1 font-semibold text-slate-700">Khổ giấy
          <select aria-label="Khổ giấy chia sẻ phiếu kho" value={options.paperSize} onChange={e=>setOptions(v=>({...v,paperSize:e.target.value as WarehousePageOptions['paperSize']}))} className="min-h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2"><option value="A4">A4</option><option value="A3">A3</option></select>
        </label>
        <label className="grid min-w-0 gap-1 font-semibold text-slate-700">Hướng giấy
          <select aria-label="Hướng giấy chia sẻ phiếu kho" value={options.orientation} onChange={e=>setOptions(v=>({...v,orientation:e.target.value as WarehousePageOptions['orientation']}))} className="min-h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2"><option value="auto">Tự động (ưu tiên dọc)</option><option value="portrait">Dọc</option><option value="landscape">Ngang</option></select>
        </label>
        <label className="grid min-w-0 gap-1 font-semibold text-slate-700">Co giãn bảng
          <select aria-label="Co giãn phiếu kho" value={options.fit} onChange={e=>setOptions(v=>({...v,fit:e.target.value as WarehousePageOptions['fit']}))} className="min-h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2"><option value="one">Ưu tiên vừa 1 trang</option><option value="split">Tự chia trang</option></select>
        </label>
        <p className="min-w-0 break-words text-[11px] text-slate-500 min-[960px]:col-span-3">PDF/Ảnh ưu tiên vừa 1 trang mỗi phiếu khi vẫn đọc rõ; bảng quá dài sẽ tự chia trang. Excel giữ nguyên dữ liệu, tùy chọn áp dụng khi in. Thiết lập được ghi nhớ trên thiết bị.</p>
      </div>}
      {/* Mirror the Crew Report action sheet: portal outside the scrolling settings panel. */}
      {menu && typeof document !== 'undefined' && createPortal(
        <div data-hnl-voucher-action-overlay="true" className="fixed inset-0 z-[160] flex items-end justify-center sm:items-center">
          <button type="button" data-hnl-voucher-action-backdrop="true" onClick={()=>!busy&&setMenu(null)}
            className="absolute inset-0 bg-slate-950/45" aria-label="Đóng tùy chọn xuất phiếu kho" />
          <div role="dialog" aria-modal="true" aria-label="Tùy chọn xuất và chia sẻ phiếu kho"
            data-hnl-voucher-action-menu={menu}
            className="relative z-10 mb-[calc(0.75rem+env(safe-area-inset-bottom))] w-[calc(100%-1.5rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:mb-0">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-900">Phiếu kho · {formatLabel(menu)}</p>
              <button type="button" disabled={busy} onClick={()=>setMenu(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600"
                aria-label="Đóng tùy chọn"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              {busy?'Đang chuẩn bị file...':prepared?.format===menu&&prepared.signature===selectionSignature?
                prepared.files.length+' file đã sẵn sàng':'Định dạng chưa sẵn sàng'}
            </p>
            {error&&<p role="alert" className="mb-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
            <div data-hnl-voucher-action-buttons="unified" className="grid grid-cols-2 gap-2">
              <button type="button" data-hnl-voucher-action={menu+'-download'}
                disabled={busy||!prepared||prepared.signature!==selectionSignature||prepared.format!==menu}
                onClick={()=>void act('download')}
                className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-lg border bg-white px-2 text-xs font-bold disabled:opacity-40 ${voucherActionPalette[menu].download}`}>
                <Download className="mr-1 inline h-4 w-4 shrink-0" /> Tải {formatLabel(menu)}
              </button>
              <button type="button" data-hnl-voucher-action={menu+'-share'}
                disabled={busy||!prepared||prepared.signature!==selectionSignature||prepared.format!==menu}
                onClick={()=>void act('share')}
                className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-lg px-2 text-xs font-bold text-white disabled:opacity-40 ${voucherActionPalette[menu].share}`}>
                <Share2 className="mr-1 inline h-4 w-4 shrink-0" /> Chia sẻ {formatLabel(menu)}
              </button>
            </div>
          </div>
        </div>, document.body)}
      <p className="text-[11px] text-slate-500">Một phiếu chứa bảng nhiều dòng. Ảnh và Excel theo trang; PDF chữ thật, tìm kiếm và sao chép được. Chia sẻ ảnh tối đa 6 trang/lần.</p>
    </div>
  </SettingsFeatureSheet>;
}