import React, {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {Download, Share2, FileSpreadsheet, FileDown, Image as ImageIcon, Settings2, X} from 'lucide-react';
import {saveBlobToDownloads, isAndroidExportBridgeAvailable} from '../utils/fileExport';
import {sharePreparedContent} from '../utils/shareUtils';
import {buildWarehouseReportFiles, type WarehouseReport, type WarehouseReportFile, type WarehouseReportFormat, type WarehousePageOptions, DEFAULT_WAREHOUSE_PAGE_OPTIONS} from '../utils/warehouseCatalogReport';

const PALETTE: Record<WarehouseReportFormat,{main:string;outline:string}>={
  png:{main:'bg-sky-600 hover:bg-sky-700',outline:'border-sky-200 text-sky-700'},
  pdf:{main:'bg-red-600 hover:bg-red-700',outline:'border-red-200 text-red-700'},
  xlsx:{main:'bg-green-600 hover:bg-green-700',outline:'border-green-200 text-green-700'},
};
const LABEL: Record<WarehouseReportFormat,string>={png:'Ảnh',pdf:'PDF',xlsx:'Excel'};
export const WarehouseReportActions:React.FC<{report:WarehouseReport; disabled?:boolean}>=({report,disabled=false})=>{
  const [menu,setMenu]=useState<WarehouseReportFormat|null>(null);
  const [showOptions,setShowOptions]=useState(false);
  const [options,setOptions]=useState<WarehousePageOptions>(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem('hnl-warehouse-export-layout-v1')||'null');
      if(saved && ['A3','A4'].includes(saved.paperSize) && ['auto','portrait','landscape'].includes(saved.orientation) && ['one','split'].includes(saved.fit))return saved;
    }catch(_){/* localStorage unavailable: safe default */}
    return DEFAULT_WAREHOUSE_PAGE_OPTIONS;
  });
  useEffect(()=>{
    try{localStorage.setItem('hnl-warehouse-export-layout-v1',JSON.stringify(options));}catch(_){/* preview/export still work without storage */}
    setPrepared(null);setMenu(null);
  },[options]);
  const [prepared,setPrepared]=useState<{format:WarehouseReportFormat;files:WarehouseReportFile[]}|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [status,setStatus]=useState('');
  // The parent provides a memoized report; any content change invalidates prepared bytes.
  useEffect(()=>{setMenu(null);setPrepared(null);setError('');setStatus('');},[report]);
  const select=async(format:WarehouseReportFormat)=>{
    if(busy||disabled||!report.rows.length)return;
    if(menu===format){setMenu(null);return;}
    setMenu(format);setPrepared(null);setBusy(true);setError('');setStatus('');
    try{const files=await buildWarehouseReportFiles(report,format,options);setPrepared({format,files});}
    catch(e){setError(e instanceof Error?e.message:'Không tạo được báo cáo.');}
    finally{setBusy(false);}
  };
  const perform=async(action:'download'|'share')=>{
    if(!menu||!prepared||prepared.format!==menu||busy)return;
    if(action==='share'&&prepared.files.length>6){setError('Chỉ chia sẻ tối đa 6 ảnh mỗi lần. Hãy chọn PDF hoặc Excel cho danh sách dài.');return;}
    setBusy(true);setError('');setStatus('');
    try{
      if(action==='download'){
        for(const file of prepared.files) await saveBlobToDownloads(file.blob,file.fileName,file.mimeType);
        setStatus(prepared.files.length>1&&!isAndroidExportBridgeAvailable()
          ? 'Đã gửi yêu cầu tải ảnh. Trình duyệt có thể cần cấp phép tải nhiều file.'
          : 'Đã gửi yêu cầu lưu file. Hãy kiểm tra thư mục Tải xuống.');
      }else{
        const result=await sharePreparedContent({title:report.title,text:report.subtitle,attachments:prepared.files.map(f=>({id:f.id,fileName:f.fileName,mimeType:f.mimeType,dataUrl:f.dataUrl})),allowTextFallback:false});
        if(result.status==='cancelled')setStatus('Đã hủy chia sẻ.');
        else if(result.status==='shared')setStatus(result.sharedFiles<prepared.files.length
          ?`Chỉ chia sẻ được ${result.sharedFiles}/${prepared.files.length} file; các file còn lại chưa được chia sẻ.`
          :'Đã yêu cầu mở bảng chia sẻ '+LABEL[menu]+'.');
        else throw new Error('Thiết bị không hỗ trợ chia sẻ file. Hãy chọn Tải '+LABEL[menu]+'.');
      }
      setMenu(null);
    }catch(e){setError(e instanceof Error?e.message:'Không thể xuất hoặc chia sẻ báo cáo.');}
    finally{setBusy(false);}
  };
  return <div data-hnl-warehouse-report-actions="unified" className="space-y-2">
    <div data-hnl-warehouse-report-buttons="formats" data-hnl-export-format-group="true" data-hnl-export-format-count="4" className="grid w-full max-w-[480px] min-w-0 grid-cols-2 gap-2 min-[960px]:inline-grid min-[960px]:grid-cols-[repeat(4,112px)] min-[960px]:w-auto min-[960px]:max-w-full" role="group" aria-label={`Xuất ${report.title}`}>
      {([
        ['png',ImageIcon,'Ảnh'],['pdf',FileDown,'PDF'],['xlsx',FileSpreadsheet,'Excel'],
      ] as const).map(([format,Icon,label])=><button type="button" key={format}
        data-hnl-warehouse-report-format={format} disabled={busy||disabled||!report.rows.length} onClick={()=>void select(format)}
        className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-bold text-white disabled:opacity-40 ${PALETTE[format].main}`}>
        <Icon className="h-4 w-4 shrink-0"/>{busy&&menu===format?'Đang tạo…':label}
      </button>)}
      <button type="button" data-hnl-warehouse-export-options="toggle" aria-expanded={showOptions}
        disabled={busy} onClick={()=>setShowOptions(v=>!v)}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 disabled:opacity-40">
        <Settings2 className="h-4 w-4 shrink-0"/> Tùy chọn
      </button>
    </div>
    {showOptions&&<div data-hnl-warehouse-export-options="form" className="grid w-full max-w-[720px] min-w-0 grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs min-[960px]:grid-cols-3">
      <label className="grid min-w-0 gap-1 font-semibold text-slate-700">Khổ giấy
        <select aria-label="Khổ giấy xuất báo cáo" value={options.paperSize} onChange={e=>setOptions(prev=>({...prev,paperSize:e.target.value as WarehousePageOptions['paperSize']}))} className="min-h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2"><option value="A4">A4</option><option value="A3">A3</option></select>
      </label>
      <label className="grid min-w-0 gap-1 font-semibold text-slate-700">Hướng giấy
        <select aria-label="Hướng giấy xuất báo cáo" value={options.orientation} onChange={e=>setOptions(prev=>({...prev,orientation:e.target.value as WarehousePageOptions['orientation']}))} className="min-h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2"><option value="auto">Tự động (ưu tiên dọc)</option><option value="portrait">Dọc</option><option value="landscape">Ngang</option></select>
      </label>
      <label className="grid min-w-0 gap-1 font-semibold text-slate-700">Co giãn bảng
        <select aria-label="Co giãn bảng xuất báo cáo" value={options.fit} onChange={e=>setOptions(prev=>({...prev,fit:e.target.value as WarehousePageOptions['fit']}))} className="min-h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2"><option value="one">Ưu tiên vừa 1 trang</option><option value="split">Tự chia trang</option></select>
      </label>
      <p className="min-w-0 break-words text-[11px] text-slate-500 min-[960px]:col-span-3">PDF/Ảnh giữ đủ nội dung và tự chia trang nếu không thể vừa một trang mà vẫn dễ đọc. Excel giữ nguyên dữ liệu và công thức, thiết lập chỉ áp dụng khi in. Lựa chọn được lưu trên thiết bị.</p>
    </div>}
    {error&&<p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{error}</p>}
    {status&&<p role="status" className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">{status}</p>}
    {menu&&typeof document!=='undefined'&&createPortal(<div data-hnl-warehouse-report-overlay="true" className="fixed inset-0 z-[170] flex items-end justify-center sm:items-center">
      <button type="button" aria-label="Đóng tùy chọn xuất" className="absolute inset-0 bg-slate-950/45" onClick={()=>!busy&&setMenu(null)}/>
      <div role="dialog" aria-modal="true" aria-label={`Tùy chọn ${LABEL[menu]}`} className="relative z-10 mb-[calc(0.75rem+env(safe-area-inset-bottom))] w-[calc(100%-1.5rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:mb-0">
        <div className="mb-3 flex items-center justify-between"><p className="text-sm font-bold">{report.title} · {LABEL[menu]}</p><button type="button" aria-label="Đóng" disabled={busy} onClick={()=>setMenu(null)}><X className="h-5 w-5"/></button></div>
        <p className="mb-3 text-xs text-slate-500">{busy?'Đang chuẩn bị…':prepared?.format===menu?`${prepared.files.length} file đã sẵn sàng`:'Không tạo được file.'}</p>
        {error&&<p role="alert" className="mb-2 text-xs text-rose-600">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy||prepared?.format!==menu} data-hnl-warehouse-report-action="download" onClick={()=>void perform('download')} className={`flex min-h-11 items-center justify-center gap-1 rounded-xl border px-2 text-xs font-bold disabled:opacity-40 ${PALETTE[menu].outline}`}><Download className="h-4 w-4"/>Tải {LABEL[menu]}</button>
          <button type="button" disabled={busy||prepared?.format!==menu} data-hnl-warehouse-report-action="share" onClick={()=>void perform('share')} className={`flex min-h-11 items-center justify-center gap-1 rounded-xl px-2 text-xs font-bold text-white disabled:opacity-40 ${PALETTE[menu].main}`}><Share2 className="h-4 w-4"/>Chia sẻ {LABEL[menu]}</button>
        </div>
      </div>
    </div>,document.body)}
  </div>;
};
