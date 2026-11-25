import React, { useState, useEffect, useRef } from 'react';

type Source = 'area' | 'length' | 'parent' | 'formula';
type Props = { label: string; allowParent?: boolean; disabled?: boolean; refreshKey?: string; onCalculate: (expression: string, source: Source) => string | null };
const sourceExpressions: Record<Exclude<Source, 'formula'>, string> = {area:'S',length:'L',parent:'KL'};

/** Explicit draft calculator. Configuration is local to the open form, not durable automation. */
export function RoomQuantityCalculator({label, allowParent, disabled, refreshKey, onCalculate}: Props) {
  const [source,setSource] = useState<Source | 'manual'>('manual');
  const [formula,setFormula] = useState('');
  const [message,setMessage] = useState('');
  const [auto,setAuto] = useState(false);
  const calculateRef = useRef(onCalculate);
  calculateRef.current = onCalculate;
  useEffect(() => {
    if (!auto || disabled || source === 'manual') return;
    const expression = source === 'formula' ? formula : sourceExpressions[source];
    if (!expression.trim()) {setMessage('Nhập công thức để tự tính.');return;}
    const timer = window.setTimeout(() => {
      setMessage(calculateRef.current(expression,source) || 'Đã tự tính vào ô KL, nhấn Lưu để ghi.');
    }, 250);
    return () => window.clearTimeout(timer);
  }, [auto,disabled,source,formula,refreshKey]);
  return <div data-hnl-quantity-calculator={label} className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10.5px]">
    <label className="font-bold text-slate-600">Nguồn tính:
      <select aria-label={'Nguồn tính '+label} disabled={disabled} value={source}
        onChange={e=>{setSource(e.target.value as Source | 'manual');setMessage('');}}
        className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-800">
        <option value="manual">Nhập tay</option>
        {allowParent && <option value="parent">Theo KL chính</option>}
        <option value="area">Diện tích (S)</option>
        <option value="length">Chu vi / Chiều dài (L)</option>
        <option value="formula">Công thức</option>
      </select>
    </label>
    {source === 'formula' && <input aria-label={'Công thức '+label} disabled={disabled}
      value={formula} maxLength={256} onChange={e=>{setFormula(e.target.value);setMessage('');}}
      placeholder={allowParent?'VD: KL*2':'VD: L*2.8'} className="min-w-0 w-36 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-800"/>}
    {source !== 'manual' && <label className="flex items-center gap-1">
      <input type="checkbox" checked={auto} disabled={disabled} onChange={e=>{setAuto(e.target.checked);setMessage('');}}/> Tự tính trong biểu mẫu
    </label>}
    {source !== 'manual' && <button type="button" disabled={disabled}
      onClick={()=>setMessage(onCalculate(source === 'formula' ? formula : sourceExpressions[source],source) || 'Đã tính vào ô KL, nhấn Lưu để ghi.')}
      className="rounded-lg bg-indigo-700 px-2 py-1.5 font-bold text-white disabled:opacity-40">Tính</button>}
    {source === 'formula' && <span className="basis-full text-slate-500">S: diện tích · L: chu vi kín / chiều dài tuyến hở{allowParent?' · KL: khối lượng chính':''}. Dùng * để nhân. Tự kiểm tra ĐVT kết quả.</span>}
    {message && <span role="status" className="basis-full text-slate-700">{message}</span>}
  </div>;
}
