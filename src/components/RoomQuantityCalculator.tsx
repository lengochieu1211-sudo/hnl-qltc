import React, { useEffect, useRef } from 'react';
import { ExpressionDisplayInput } from './ExpressionDisplayInput';

type Props = {
  label: string;
  raw: string;
  result: number | null;
  auto: boolean;
  error?: string;
  disabled?: boolean;
  allowParent?: boolean;
  refreshKey?: string;
  onEdit: (raw: string) => void;
  onToggleAuto: (value: boolean) => void;
  onRecalculate: () => void;
};

/** The existing single expression input shows the result on blur and raw formula on focus. */
export function RoomQuantityCalculator({label,raw,result,auto,error,disabled,allowParent,refreshKey,onEdit,onToggleAuto,onRecalculate}: Props) {
  const recalculate = useRef(onRecalculate);
  recalculate.current = onRecalculate;
  const isLinked = /[A-Za-z]/.test(raw);
  useEffect(() => {
    if (!auto || disabled || !isLinked) return;
    const timer=window.setTimeout(()=>recalculate.current(),250);
    return ()=>window.clearTimeout(timer);
  }, [auto,disabled,isLinked,raw,refreshKey]);
  return <div data-hnl-quantity-calculator={label} className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10.5px]">
    <ExpressionDisplayInput aria-label={'Khối lượng '+label} inputMode="text"
      disabled={disabled} value={raw} resolvedValue={error ? null : result}
      aria-invalid={!!error} maxLength={256} placeholder={allowParent?'VD: KL*2':'VD: S hoặc L*2.8'}
      onChange={e=>onEdit(e.target.value)}
      className={'w-28 min-w-0 rounded-lg border bg-white px-2 py-1.5 text-center font-black text-xs text-emerald-950 '+(error?'border-rose-400':'border-emerald-300')}/>
    {isLinked && <>
      <label className="flex items-center gap-1 whitespace-nowrap">
        <input type="checkbox" checked={auto} disabled={disabled} onChange={e=>onToggleAuto(e.target.checked)}/> Tự tính
      </label>
      {!auto && <button type="button" disabled={disabled} onClick={onRecalculate}
        className="rounded-lg bg-indigo-700 px-2 py-1.5 font-bold text-white disabled:opacity-40">Tính lại</button>}
    </>}
    {error && <span role="alert" className="basis-full text-rose-700">{error}</span>}
    <span className="basis-full text-slate-500">S: diện tích · L: chu vi/chiều dài{allowParent?' · KL: khối lượng chính':''}. Nhấn vào KL để sửa công thức.</span>
  </div>;
}
