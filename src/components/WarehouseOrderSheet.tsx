import React, {useEffect, useMemo, useState} from 'react';
import {ClipboardList, Search} from 'lucide-react';
import {SettingsFeatureSheet} from './SettingsFeatureSheet';
import {WarehouseReportActions} from './WarehouseReportActions';
import type {WarehouseReport} from '../utils/warehouseCatalogReport';
import {
  loadWarehouseOrderDraft, orderWeightSummary, parseOrderNumber, parseOrderQuantity, parseOrderWeight, saveWarehouseOrderDraft,
  type WarehouseOrderItem, type WarehouseOrderKind, type WarehouseOrderValues,
} from '../utils/warehouseCatalogOrder';
import {naturalCompare} from '../utils/sortUtils';

type Props={
  open:boolean;onClose:()=>void;projectId:string;projectName:string;projectLocation:string;contractorName:string;
  items:WarehouseOrderItem[];canEdit:boolean;initialKind:WarehouseOrderKind;
};
const vi=(n:number)=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:3}).format(n);
const empty:WarehouseOrderValues={quantity:0,kgPerUnit:null};
const NumberField:React.FC<{value:number|null;onCommit:(value:number|null)=>void;emptyAsBlank?:boolean;positive?:boolean;label:string;editable:boolean;parseValue?:(text:string)=>number|null}>=({value,onCommit,emptyAsBlank,positive,label,editable,parseValue=parseOrderNumber})=>{
  const format=(n:number|null)=>n===null||(emptyAsBlank&&n===0)?'':String(n);
  const [text,setText]=useState(format(value));
  const [error,setError]=useState(false);
  useEffect(()=>setText(format(value)),[value,emptyAsBlank]);
  return <div className="min-w-[96px]">
    <input type="text" inputMode="decimal" autoComplete="off" aria-label={label} value={text} disabled={!editable}
      onChange={e=>{setText(e.target.value);setError(false);}}
      onBlur={()=>{
        const n=parseValue(text);
        if(text.trim()&& (n===null || (positive&&n===0))){setError(true);setText(format(value));return;}
        onCommit(n);setText(format(n));
      }}
      aria-invalid={error}
      className={`h-10 w-full rounded-lg border bg-white px-2 text-right text-xs tabular-nums disabled:bg-slate-50 ${error?'border-rose-600':'border-slate-300'}`} placeholder="—"/>
    {error&&<p className="text-[10px] text-rose-600">Số không hợp lệ</p>}
  </div>;
};
export const WarehouseOrderSheet:React.FC<Props>=({open,onClose,projectId,projectName,projectLocation,contractorName,items,canEdit,initialKind})=>{
  const [kind,setKind]=useState<WarehouseOrderKind>(initialKind);
  const [search,setSearch]=useState('');
  const [draft,setDraft]=useState<Record<string,WarehouseOrderValues>>(()=>loadWarehouseOrderDraft(projectId));
  const [saveError,setSaveError]=useState(false);
  useEffect(()=>{setDraft(loadWarehouseOrderDraft(projectId));setSaveError(false);setKind(initialKind);setSearch('');},[projectId,initialKind]);
  const setValue=(key:string,which:'quantity'|'kgPerUnit',value:number|null)=>{
    if(!canEdit)return;
    const existing=draft[key]||empty;
    const updated={...draft,[key]:{...existing,[which]:which==='quantity'?(value??0):value}};
    setDraft(updated);
    setSaveError(!saveWarehouseOrderDraft(projectId,updated));
  };
  const filtered=useMemo(()=>items.filter(x=>x.kind===kind && (!search.trim()||`${x.name} ${x.category} ${x.unit}`.toLocaleLowerCase('vi-VN').includes(search.trim().toLocaleLowerCase('vi-VN')))).sort((a,b)=>naturalCompare(a.category,b.category)||naturalCompare(a.name,b.name)),[items,kind,search]);
  const selected=useMemo(()=>items.filter(x=>(draft[x.key]?.quantity||0)>0).sort((a,b)=>a.kind.localeCompare(b.kind)||naturalCompare(a.category,b.category)||naturalCompare(a.name,b.name)),[items,draft]);
  const summary=useMemo(()=>orderWeightSummary(selected.map(row=>draft[row.key]||empty)),[selected,draft]);
  const report:WarehouseReport=useMemo(()=>({
    title:'ĐƠN ĐẶT HÀNG VẬT TƯ / THIẾT BỊ',projectName,projectLocation,contractorName,
    subtitle:`${selected.length} dòng được chọn · Khối lượng ước tính theo khai báo kg/đơn vị`,
    filePrefix:'HNL-QLTC-DON-DAT-HANG',
    columns:[{label:'STT',width:37},{label:'Vật tư / thiết bị',width:230},{label:'ĐVT',width:55},{label:'SL đặt',width:69,numeric:true},{label:'KL/đv (kg)',width:82,numeric:true},{label:'Thành KL (kg)',width:95,numeric:true}],
    rows:selected.map((row,i)=>{
      const v=draft[row.key]||empty;const valid=v.kgPerUnit!==null&&v.kgPerUnit>0;
      return [i+1,row.name,row.unit,v.quantity,valid?v.kgPerUnit!:'Chưa có',valid?v.quantity*v.kgPerUnit!:'Chưa có'];
    }),
    footer:`Tổng khối lượng đã biết: ${vi(summary.kilograms)} kg = ${vi(summary.tonnes)} tấn${summary.complete?'':' (chưa đủ)'}`,
    warning:summary.missing?`CẢNH BÁO: ${summary.missing} dòng chưa có kg/đơn vị. KHÔNG dùng tổng này để chốt tải trọng xe.`:'Khối lượng chỉ là ước tính hàng hóa, chưa gồm bao bì/pallet và tải trọng xe thực tế.',
  }),[projectName,projectLocation,contractorName,selected,draft,summary]);
  return <SettingsFeatureSheet open={open} onClose={onClose} sheetKey="warehouse-order" icon={ClipboardList}
    title="Đặt hàng vật tư / thiết bị" description="Lập danh sách và ước tính khối lượng vận chuyển, không tự tạo phiếu nhập kho.">
    <div data-hnl-warehouse-order="local-draft" className="space-y-3">
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1" role="group" aria-label="Loại hàng đặt">
        {(['material','equipment'] as const).map(tab=><button type="button" key={tab} aria-pressed={kind===tab} onClick={()=>setKind(tab)}
          className={`min-h-10 rounded-lg px-3 py-2 text-xs font-bold ${kind===tab?'bg-white text-blue-700 shadow':'text-slate-600'}`}>
          {tab==='material'?'Vật tư':'Thiết bị'}
        </button>)}
      </div>
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400"/>
        <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Tìm vật tư, thiết bị…"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs" />
      </div>
      <p className="text-xs text-slate-600">Số lượng: 20,000 hoặc 20.000 đều là hai mươi nghìn; khối lượng/đơn vị: 0,03 hoặc 0.030 là 0,03 kg. Nhập kg/đơn vị một lần và giữ cho lần sau trên thiết bị này.</p>
      <div className="max-h-[49vh] overflow-auto overscroll-contain rounded-xl border border-slate-200">
        <table className="w-max min-w-full border-collapse text-xs" data-hnl-warehouse-order-table="true">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-800"><tr>
            {['Tên vật tư / thiết bị','ĐVT','Số lượng đặt','KL/đơn vị (kg)','Thành KL (kg)'].map(label=><th key={label} scope="col" className="border-b px-2 py-3 text-left font-bold whitespace-nowrap">{label}</th>)}
          </tr></thead>
          <tbody>{filtered.map(item=>{
            const values=draft[item.key]||empty;const hasWeight=values.kgPerUnit!==null&&values.kgPerUnit>0;
            return <tr key={item.key} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="min-w-[170px] max-w-[330px] px-2 py-2 font-semibold text-slate-800"><span className="block whitespace-normal break-words">{item.name}</span><span className="text-[10px] font-normal text-slate-500">{item.category}</span></td>
              <td className="px-2 py-2 text-slate-600">{item.unit}</td>
              <td className="px-2 py-2"><NumberField editable={canEdit} value={values.quantity} emptyAsBlank parseValue={parseOrderQuantity} label={`Số lượng đặt ${item.name}`} onCommit={value=>setValue(item.key,'quantity',value)}/></td>
              <td className="px-2 py-2"><NumberField editable={canEdit} positive parseValue={parseOrderWeight} value={values.kgPerUnit} label={`Khối lượng mỗi ${item.unit} của ${item.name}`} onCommit={value=>setValue(item.key,'kgPerUnit',value)}/></td>
              <td className="px-2 py-2 text-right font-bold tabular-nums text-indigo-700">{values.quantity>0?(hasWeight?vi(values.quantity*values.kgPerUnit!):'Chưa có'):'—'}</td>
            </tr>;
          })}{filtered.length===0&&<tr><td colSpan={5} className="p-5 text-center text-slate-500">Không có vật tư, thiết bị phù hợp.</td></tr>}</tbody>
        </table>
      </div>
      {saveError&&<p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">Thiết bị không lưu được bản nháp. Không nên đóng ứng dụng trước khi sao chép thông tin đặt hàng.</p>}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm" data-hnl-warehouse-order-summary="true">
        <p className="font-bold text-slate-800">Đã chọn {summary.selected} vật tư / thiết bị</p>
        <p className="mt-1 font-extrabold text-indigo-800">Tổng khối lượng đã biết: {vi(summary.kilograms)} kg ({vi(summary.tonnes)} tấn)</p>
        {summary.missing>0?<p role="alert" className="mt-1 text-xs font-semibold text-amber-800">Còn {summary.missing} dòng chưa khai báo kg/đơn vị. Tổng chưa đầy đủ, không dùng để chốt xe vận chuyển.</p>
        :<p className="mt-1 text-xs text-slate-600">Chưa bao gồm bao bì, pallet hoặc giới hạn tải trọng thực tế của xe.</p>}
      </div>
      <p className="text-xs font-bold text-slate-700">Xuất / chia sẻ đơn đặt hàng</p>
      <WarehouseReportActions report={report} disabled={!selected.length}/>
      <p className="text-[11px] text-slate-500">Bản nháp và khối lượng lưu cục bộ theo dự án và tên/đơn vị vật tư trên thiết bị này; chưa đồng bộ đa thiết bị. Không ghi vào tồn kho hoặc tạo phiếu nhập/xuất.</p>
    </div>
  </SettingsFeatureSheet>;
};
