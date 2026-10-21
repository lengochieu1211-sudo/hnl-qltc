import React, {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {Download, Share2, FileSpreadsheet, FileDown, Image as ImageIcon, X} from 'lucide-react';
import {saveBlobToDownloads, isAndroidExportBridgeAvailable} from '../utils/fileExport';
import {sharePreparedContent} from '../utils/shareUtils';
import {buildWarehouseReportFiles, type WarehouseReport, type WarehouseReportFile, type WarehouseReportFormat} from '../utils/warehouseCatalogReport';

const PALETTE: Record<WarehouseReportFormat,{main:string;outline:string}>={
  png:{main:'bg-sky-600 hover:bg-sky-700',outline:'border-sky-200 text-sky-700'},
  pdf:{main:'bg-red-600 hover:bg-red-700',outline:'border-red-200 text-red-700'},
  xlsx:{main:'bg-green-600 hover:bg-green-700',outline:'border-green-200 text-green-700'},
};
const LABEL: Record<WarehouseReportFormat,string>={png:'Ảnh',pdf:'PDF',xlsx:'Excel'};
export const WarehouseReportActions:React.FC<{report:WarehouseReport; disabled?:boolean}>=({report,disabled=false})=>{
  const [menu,setMenu]=useState<WarehouseReportFormat|null>(null);
  const [prepared,setPrepared]=useState<{format:WarehouseReportFormat;files:WarehouseReportFile[]}|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [status,setStatus]=useState('');
  // The parent provides a memoized report; any content change invalidates prepared bytes.
  useEffect(()=>{setMenu(null);setPrepared(null);setError('');setStatus('');},[report]);
  const select=async(format:WarehouseReportFormat)=>{
    if(busy||disabled||!report.rows.length)return;
    if(menu===format){setMenu(null);return;}
    setMenu(format);setPrepared(null);setBusy(true);setError('');setStatus('');
    try{const files=await buildWarehouseReportFiles(report,format);setPrepared({format,files});}
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
    <div className="grid grid-cols-3 gap-2" role="group" aria-label={`Xuất ${report.title}`}>
      {([
        ['png',ImageIcon,'Ảnh'],['pdf',FileDown,'PDF'],['xlsx',FileSpreadsheet,'Excel'],
      ] as const).map(([format,Icon,label])=><button type="button" key={format}
        data-hnl-warehouse-report-format={format} disabled={busy||disabled||!report.rows.length} onClick={()=>void select(format)}
        className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-bold text-white disabled:opacity-40 ${PALETTE[format].main}`}>
        <Icon className="h-4 w-4 shrink-0"/>{busy&&menu===format?'Đang tạo…':label}
      </button>)}
    </div>
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
