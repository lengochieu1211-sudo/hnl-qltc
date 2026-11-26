import React, { useEffect, useRef, useState } from 'react';
import { ExpressionDisplayInput } from './ExpressionDisplayInput';
import { hasLinkedQuantityVariables } from '../utils/roomQuantityFormula';

type Props = {
  label: string;
  raw: string;
  result: number | null;
  auto: boolean;
  error?: string;
  disabled?: boolean;
  allowParent?: boolean;
  unit?: string;
  refreshKey?: string;
  onEdit: (raw: string) => void;
  onRecalculate: () => void;
};

/** The existing single expression input shows the result on blur and raw formula on focus. */
export function RoomQuantityCalculator({label,raw,result,auto,error,disabled,allowParent,unit,refreshKey,onEdit,onRecalculate}: Props) {
  const recalculate = useRef(onRecalculate);
  recalculate.current = onRecalculate;
  const [showHelp,setShowHelp] = useState(false);
  const help = `S: Diện tích · L: Chu vi/chiều dài${allowParent?' · KL: Khối lượng hạng mục chính':''}`;
  const isLinked = hasLinkedQuantityVariables(raw);
  useEffect(() => {
    if (!auto || disabled || !isLinked) return;
    const timer=window.setTimeout(()=>recalculate.current(),250);
    return ()=>window.clearTimeout(timer);
  }, [auto,disabled,isLinked,raw,refreshKey]);
  return <div data-hnl-quantity-calculator={label} className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 text-[10.5px]">
    <ExpressionDisplayInput aria-label={'Khối lượng '+label} title={help} inputMode="text"
      disabled={disabled} value={raw} resolvedValue={error ? null : result}
      aria-invalid={!!error} maxLength={256} placeholder={allowParent?'VD: KL*2':'VD: S hoặc L*2.8'}
      onChange={e=>onEdit(e.target.value)}
      className={'w-24 min-w-0 rounded-lg border bg-white px-1.5 py-1 text-center font-black text-xs text-emerald-950 '+(error?'border-rose-400':'border-emerald-300')}/>
    {unit && <span className="shrink-0 whitespace-nowrap font-black text-emerald-800">{unit}</span>}
    <button type="button" title={help} aria-label={'Hướng dẫn công thức '+label} aria-expanded={showHelp}
      onClick={()=>setShowHelp(v=>!v)}
      className="hnl-quantity-touch-help inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-[11px] font-bold text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500">?</button>
    {error && <span role="alert" className="basis-full text-rose-700">{error}</span>}
    {showHelp && <span role="note" className="hnl-quantity-touch-help-note basis-full text-slate-600">{help}</span>}
  </div>;
}
