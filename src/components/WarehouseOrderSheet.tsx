import React, {useEffect,useMemo,useRef,useState} from 'react';
import {ClipboardList, Search} from 'lucide-react';
import {SettingsFeatureSheet} from './SettingsFeatureSheet';
import {WarehouseReportActions} from './WarehouseReportActions';
import type {WarehouseReport} from '../utils/warehouseCatalogReport';
import {
  evaluateWarehouseOrderInput, isWarehouseOrderExpression, orderWeightSummary, parseOrderQuantity, parseOrderWeight,
  type WarehouseOrderItem, type WarehouseOrderKind, type WarehouseOrderValues,
} from '../utils/warehouseCatalogOrder';
import {naturalCompare} from '../utils/sortUtils';
import type {WarehouseOrderSync} from '../hooks/useWarehouseOrderSync';

type Props={
  open:boolean;onClose:()=>void;projectId:string;projectName:string;projectLocation:string;contractorName:string;
  items:WarehouseOrderItem[];canEdit:boolean;initialKind:WarehouseOrderKind;sync:WarehouseOrderSync;
};
const vi=(n:number)=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:3}).format(n);
const empty:WarehouseOrderValues={quantity:0,kgPerUnit:null};
/** Blurred = evaluated number; focused = original editable expression. */
const NumberField:React.FC<{
  value:number|null;expression?:string;onCommit:(value:number|null, expression?:string)=>void;
  emptyAsBlank?:boolean;positive?:boolean;label:string;editable:boolean;
  parseValue:(text:string)=>number|null;field:'quantity'|'kgPerUnit';
}>=({value,expression,onCommit,emptyAsBlank,positive,label,editable,parseValue,field})=>{
  const format=(n:number|null)=>n===null||(emptyAsBlank&&n===0)?'':new Intl.NumberFormat('vi-VN',{maximumFractionDigits:10}).format(n);
  const [text,setText]=useState(format(value));
  const [error,setError]=useState(false);
  const focused=useRef(false);
  const inputRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(!focused.current)setText(format(value));},[value,expression,emptyAsBlank]);
  const commit=()=>{
    if(!editable){setText(format(value));return;}
    const raw=text.trim();
    if(!raw){onCommit(null);setText('');setError(false);return;}
    const number=isWarehouseOrderExpression(raw)?evaluateWarehouseOrderInput(raw,field):parseValue(raw);
    if(number===null||(positive&&number<=0)){
      setError(true); // Keep the invalid expression visible so it can be corrected.
      return;
    }
    onCommit(number,isWarehouseOrderExpression(raw)?raw:undefined);
    setText(format(number));
    setError(false);
  };
  return <div className="min-w-[108px]">
    <input ref={inputRef} type="text" inputMode="decimal" autoComplete="off" aria-label={label}
      value={text} disabled={!editable} aria-invalid={error}
      title={expression ? `Công thức đã lưu: ${expression}` : 'Có thể nhập 12*5, (20+10)/2 hoặc =12*5'}
      onFocus={()=>{focused.current=true;setError(false);setText(expression||format(value));}}
      onChange={e=>{setText(e.target.value);setError(false);}}
      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();inputRef.current?.blur();}}}
      onBlur={()=>{focused.current=false;commit();}}
      className={`h-10 w-full rounded-lg border bg-white px-2 text-right text-xs tabular-nums disabled:bg-slate-50 ${error?'border-rose-600 ring-1 ring-rose-300':'border-slate-300'}`}
      placeholder="—"/>
    {error&&<p role="alert" className="text-[10px] text-rose-600">Số/công thức không hợp lệ</p>}
  </div>;
};
export const WarehouseOrderSheet:React.FC<Props>=({open,onClose,projectId,projectName,projectLocation,contractorName,items,canEdit,initialKind,sync})=>{
  const [kind,setKind]=useState<WarehouseOrderKind>(initialKind);
  const [search,setSearch]=useState('');
  useEffect(()=>{setKind(initialKind);setSearch('');},[projectId,initialKind]);
  const {draft,expectedDate,cloudError,saveError,pendingCount,conflicts,setValue,updateExpectedDate}=sync;
  const filtered=useMemo(()=>items.filter(x=>x.kind===kind && (!search.trim()||`${x.name} ${x.category} ${x.unit}`.toLocaleLowerCase('vi-VN').includes(search.trim().toLocaleLowerCase('vi-VN')))).sort((a,b)=>naturalCompare(a.category,b.category)||naturalCompare(a.name,b.name)),[items,kind,search]);
  const selected=useMemo(()=>items.filter(x=>(draft[x.key]?.quantity||0)>0).sort((a,b)=>a.kind.localeCompare(b.kind)||naturalCompare(a.category,b.category)||naturalCompare(a.name,b.name)),[items,draft]);
  const summary=useMemo(()=>orderWeightSummary(selected.map(row=>draft[row.key]||empty)),[selected,draft]);
  // The visible table covers the active kind/search only; keep its total scoped
  // to those visible rows, unlike the cross-tab exported order summary.
  const visibleSummary=useMemo(()=>orderWeightSummary(filtered.map(row=>draft[row.key]||empty)),[filtered,draft]);
  const report:WarehouseReport=useMemo(()=>({
    title:'ĐƠN ĐẶT HÀNG VẬT TƯ / THIẾT BỊ',projectName,projectLocation,contractorName,
    subtitle:`${selected.length} dòng được chọn · Dự kiến hàng về: ${expectedDate ? expectedDate.split('-').reverse().join('/') : 'Chưa khai báo'} · Khối lượng ước tính theo kg/đơn vị`,
    filePrefix:'HNL-QLTC-DON-DAT-HANG',
    columns:[{label:'STT',width:37},{label:'Vật tư / thiết bị',width:230},{label:'ĐVT',width:55},{label:'SL đặt',width:69,numeric:true},{label:'KL/đv (kg)',width:82,numeric:true},{label:'Thành KL (kg)',width:95,numeric:true}],
    rows:selected.map((row,i)=>{
      const v=draft[row.key]||empty;const valid=v.kgPerUnit!==null&&v.kgPerUnit>0;
      const weight=valid?v.quantity*v.kgPerUnit!:null;
      return [i+1,row.name,row.unit,v.quantity,valid?v.kgPerUnit!:'Chưa có',weight===null?'Chưa có':weight];
    }),
    // Export the summary as a REAL table row (PNG/PDF/XLSX), not a note.
    totalRow:['TỔNG CỘNG KHỐI LƯỢNG'+(summary.complete?'':' (CHƯA ĐỦ)'),'','', '', '',summary.kilograms],
    orderWeightFormulas:true,
    warning:summary.missing?`CẢNH BÁO tại thời điểm xuất: ${summary.missing} dòng chưa có kg/đơn vị. KHÔNG dùng tổng này để chốt tải trọng xe.`:'Khối lượng chỉ là ước tính hàng hóa, chưa gồm bao bì/pallet và tải trọng xe thực tế.',
  }),[projectName,projectLocation,contractorName,selected,draft,summary,expectedDate]);
  return <SettingsFeatureSheet open={open} onClose={onClose} sheetKey="warehouse-order" icon={ClipboardList}
    title="Đặt hàng vật tư / thiết bị" description="Lập danh sách và ước tính khối lượng vận chuyển, không tự tạo phiếu nhập kho.">
    <div data-hnl-warehouse-order="cloud-synced-with-local-backup" className="space-y-3">
      <div data-hnl-warehouse-order-kind-tabs="true" className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 min-[960px]:inline-grid min-[960px]:grid-cols-[repeat(2,160px)] min-[960px]:max-w-full" role="group" aria-label="Loại hàng đặt">
        {(['material','equipment'] as const).map(tab=><button type="button" key={tab} aria-pressed={kind===tab} onClick={()=>setKind(tab)}
          className={`min-h-10 rounded-lg px-3 py-2 text-xs font-bold ${kind===tab?'bg-white text-blue-700 shadow':'text-slate-600'}`}>
          {tab==='material'?'Vật tư':'Thiết bị'}
        </button>)}
      </div>
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400"/>
        <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Tìm vật tư, thiết bị…"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs" />
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" data-hnl-warehouse-order-sync="centralized">
        <label className="flex flex-col gap-1 font-semibold text-slate-700">Ngày dự kiến hàng về
          <input aria-label="Ngày dự kiến hàng về" type="date" value={expectedDate} disabled={!canEdit}
            onChange={e=>updateExpectedDate(e.target.value)}
            className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-xs" />
        </label>
        {(conflicts.length>0 || cloudError || pendingCount>0) && <span role="status" aria-live="polite" className="text-amber-700 font-semibold">
          {conflicts.length>0?`${conflicts.length} dòng xung đột`:cloudError?'Lỗi đồng bộ':`Còn ${pendingCount} thay đổi chờ`} · Xử lý tại Kiểm tra dữ liệu → Trạng thái hệ thống & đồng bộ
        </span>}
      </div>
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
              <td className="px-2 py-2"><NumberField editable={canEdit} value={values.quantity} expression={values.quantityExpression} emptyAsBlank field="quantity" parseValue={parseOrderQuantity} label={`Số lượng đặt ${item.name}`} onCommit={(value,expression)=>setValue(item.key,'quantity',value,expression)}/></td>
              <td className="px-2 py-2"><NumberField editable={canEdit} positive field="kgPerUnit" parseValue={parseOrderWeight} value={values.kgPerUnit} expression={values.kgPerUnitExpression} label={`Khối lượng mỗi ${item.unit} của ${item.name}`} onCommit={(value,expression)=>setValue(item.key,'kgPerUnit',value,expression)}/></td>
              <td className="px-2 py-2 text-right font-bold tabular-nums text-indigo-700">{values.quantity>0?(hasWeight?vi(values.quantity*values.kgPerUnit!):'Chưa có'):'—'}</td>
            </tr>;
          })}{filtered.length===0&&<tr><td colSpan={5} className="p-5 text-center text-slate-500">Không có vật tư, thiết bị phù hợp.</td></tr>}</tbody>
          <tfoot data-hnl-warehouse-order-total="visible-weight" className="sticky bottom-0 bg-slate-100 font-extrabold text-slate-900">
            <tr className="border-t-2 border-slate-300"><td colSpan={4} className="px-2 py-3 text-right whitespace-nowrap">TỔNG CỘNG KHỐI LƯỢNG{visibleSummary.complete?'':' (CHƯA ĐỦ)'}</td>
            <td className="px-2 py-3 text-right tabular-nums text-indigo-800 whitespace-nowrap">{vi(visibleSummary.kilograms)} kg</td></tr>
          </tfoot>
        </table>
      </div>
      {saveError&&<p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">Thiết bị không lưu được bản nháp. Không nên đóng ứng dụng trước khi sao chép thông tin đặt hàng.</p>}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs" data-hnl-warehouse-order-summary="true">
        <p className="font-bold text-slate-800">Đã chọn {summary.selected} vật tư / thiết bị trong cả hai nhóm. Tổng phiếu xuất: {vi(summary.kilograms)} kg ({vi(summary.tonnes)} tấn).</p>
        {summary.missing>0?<p role="alert" className="mt-1 text-xs font-semibold text-amber-800">Còn {summary.missing} dòng chưa khai báo kg/đơn vị. Tổng chưa đầy đủ, không dùng để chốt xe vận chuyển.</p>
        :<p className="mt-1 text-xs text-slate-600">Chưa bao gồm bao bì, pallet hoặc giới hạn tải trọng thực tế của xe.</p>}
      </div>
      <p className="text-xs font-bold text-slate-700">Xuất / chia sẻ đơn đặt hàng</p>
      <WarehouseReportActions report={report} disabled={!selected.length}/>
    </div>
  </SettingsFeatureSheet>;
};
