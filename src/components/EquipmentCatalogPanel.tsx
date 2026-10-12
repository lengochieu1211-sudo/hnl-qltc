import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, Search, Save, X, AlertTriangle } from 'lucide-react';
import type { InventoryItem } from '../types';
import { confirmAsync } from '../utils/confirmAsync';
import { normalizeUnit } from '../utils/unitUtils';
import {
  equipmentIdentityKey, saveEquipmentCatalogBatch, subscribeEquipmentCatalog,
  type EquipmentCatalogRecord, type EquipmentCatalogInput,
} from '../lib/equipmentCatalog';

interface Props {
  projectId: string;
  inventory: InventoryItem[];
  canManage: boolean;
  onRenameWarehouseUnit?: (input: {
    kind: 'material' | 'equipment'; materialName: string; fromUnit: string; toUnit: string;
  }) => Promise<{ norms: number; vouchers: number }>;
}
const empty: EquipmentCatalogInput = { name: '', unit: 'Cái', category: 'Thiết bị',
  brand: '', model: '', specifications: '', notes: '' };

export const EquipmentCatalogPanel: React.FC<Props> = ({ projectId, inventory, canManage, onRenameWarehouseUnit }) => {
  const [records, setRecords] = useState<EquipmentCatalogRecord[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<EquipmentCatalogInput | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRecords([]);
    setStatus('loading');
    if (!projectId) { setStatus('error'); setError('Chưa chọn dự án'); return; }
    return subscribeEquipmentCatalog(projectId, next => {
      setRecords(next); setError(''); setStatus('ready');
    }, err => { setStatus('error'); setError(err.message); });
  }, [projectId]);

  const items = useMemo(() => {
    const map = new Map<string, EquipmentCatalogInput & { historical: boolean }>();
    inventory.filter(x => x.itemKind === 'equipment' && x.deletedAt == null).forEach(x => {
      const name = String(x.materialName || '').trim();
      const unit = normalizeUnit(x.unit) || x.unit;
      const key = equipmentIdentityKey(name);
      if (key && !map.has(key)) map.set(key, { ...empty, name, unit, historical: true });
    });
    records.forEach(x => map.set(equipmentIdentityKey(x.name), { ...x, historical: map.has(equipmentIdentityKey(x.name)) }));
    return Array.from(map.values())
      .filter(x => !search.trim() || [x.name, x.unit, x.category, x.brand, x.model, x.specifications].join(' ').toLocaleLowerCase('vi-VN').includes(search.toLocaleLowerCase('vi-VN')))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));
  }, [records, inventory, search]);

  const save = async () => {
    if (!edit || !canManage || status !== 'ready' || busy) return;
    setBusy(true);
    try {
      if (edit.id && !records.some(x => x.id === edit.id)) throw new Error('Thiết bị đã thay đổi trên Cloud, vui lòng tải lại.');
      await saveEquipmentCatalogBatch(projectId, [edit]);
      setEdit(null);
    } catch (err) { alert('Không thể lưu thiết bị: ' + (err instanceof Error ? err.message : String(err))); }
    finally { setBusy(false); }
  };

  const rename = async () => {
    if (!edit || !edit.name || !canManage || busy || !onRenameWarehouseUnit) return;
    const currentUnit = normalizeUnit(edit.unit) || edit.unit;
    const history = inventory.filter(x => x.itemKind === 'equipment' && equipmentIdentityKey(x.materialName) === equipmentIdentityKey(edit.name));
    if (history.length === 0) {
      alert('Thiết bị này chưa có phiếu kho. ĐVT đã khai báo hiện được khóa để tránh hai đơn vị cùng tên; cần tính năng chuyển danh mục trống riêng.');
      return;
    }
    const newRaw = window.prompt('Đổi ĐVT thiết bị “' + edit.name + '” từ ' + currentUnit
      + '. CHỈ đổi nhãn tỷ lệ 1:1, không quy đổi số lượng. Nhập ĐVT mới:', currentUnit);
    if (newRaw == null) return;
    const next = normalizeUnit(newRaw) || newRaw.trim();
    if (!next || next === currentUnit) return;
    if (!(await confirmAsync('Đổi ĐVT toàn bộ phiếu nhập/xuất, số dư và danh mục thiết bị?\n'
      + currentUnit + ' → ' + next + '\nKhông thay đổi số lượng (1:1).'))) return;
    setBusy(true);
    try {
      await onRenameWarehouseUnit({ kind: 'equipment', materialName: edit.name, fromUnit: currentUnit, toUnit: next });
      setEdit(null);
    } catch (err) { alert('Chưa đổi ĐVT: ' + (err instanceof Error ? err.message : String(err))); }
    finally { setBusy(false); }
  };

  return <div className="space-y-3" data-hnl-equipment-master="true">
    <p className="text-[11px] text-slate-600">Thông tin danh mục thiết bị được đồng bộ trên Firebase. Nhập, xuất và tồn kho vẫn lấy từ phiếu kho, không tính vào định mức vật tư.</p>
    <div className="flex gap-2">
      <div className="relative min-w-0 flex-1"><Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
        <input className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-2 text-xs" placeholder="Tìm thiết bị, hãng, model..."
          value={search} onChange={e => setSearch(e.target.value)} /></div>
      {canManage && <button type="button" disabled={status !== 'ready'} onClick={() => setEdit({ ...empty })}
        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Plus className="h-4 w-4" />Thêm</button>}
    </div>
    {status === 'loading' && <p className="text-xs text-slate-500">Đang tải danh mục thiết bị...</p>}
    {status === 'error' && <p role="alert" className="text-xs text-rose-700">Không thể tải danh mục thiết bị: {error}. Không cho ghi khi chưa xác minh dữ liệu Cloud.</p>}
    {status === 'ready' && <div className="max-h-[44vh] space-y-2 overflow-y-auto">
      {items.length === 0 && <p className="rounded-lg border border-dashed p-4 text-xs text-slate-500">Chưa có thiết bị nào. ADMIN có thể khai báo thiết bị mà chưa cần nhập kho.</p>}
      {items.map(item => <div key={item.id || equipmentIdentityKey(item.name)} className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="min-w-0"><p className="text-xs font-extrabold text-slate-900 break-words">{item.name} · {item.unit}</p>
          <p className="text-[11px] text-slate-600">{item.category || 'Thiết bị'}{item.brand ? ' · ' + item.brand : ''}{item.model ? ' · ' + item.model : ''}</p>
          {item.specifications && <p className="text-[11px] text-slate-600 break-words">{item.specifications}</p>}
          {!item.id && <p className="text-[10px] text-amber-700">Dữ liệu lịch sử: chưa khai báo thông số danh mục</p>}
        </div>
        {canManage && <button type="button" onClick={() => setEdit({ ...item })} className="shrink-0 rounded-lg border border-indigo-200 p-2 text-indigo-700" title="Chỉnh thông tin thiết bị"><Edit2 className="h-4 w-4" /></button>}
      </div>)}
    </div>}
    {edit && <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-3 space-y-2" data-hnl-equipment-editor="true">
      <div className="flex items-center justify-between"><strong className="text-sm">Chỉnh thông tin thiết bị</strong>
        <button type="button" onClick={() => setEdit(null)} aria-label="Đóng chỉnh thiết bị"><X className="h-4 w-4" /></button></div>
      <div className="grid grid-cols-2 gap-2">
      {([
        ['name','Tên thiết bị'], ['unit','ĐVT'], ['category','Nhóm thiết bị'],
        ['brand','Hãng sản xuất'], ['model','Model / Mã hiệu'],
      ] as const).map(([key,label]) => <label key={key} className={'text-[11px] font-semibold '+(key === 'name'?'col-span-2':'')}>
        {label}<input value={edit[key] || ''} disabled={Boolean(edit.id) && (key === 'name' || key === 'unit')}
          onChange={e => setEdit(prev => prev ? { ...prev, [key]: e.target.value } : prev)}
          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs disabled:bg-slate-100 disabled:text-slate-500" /></label>)}
      </div>
      {(['specifications','notes'] as const).map(key => <label key={key} className="block text-[11px] font-semibold">
        {key === 'specifications' ? 'Quy cách / Công suất / Thông số kỹ thuật' : 'Ghi chú'}
        <textarea value={edit[key] || ''} onChange={e => setEdit(prev => prev ? { ...prev, [key]: e.target.value } : prev)}
          rows={2} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-xs" /></label>)}
      {edit.id && <div className="flex items-start gap-1 text-[10px] text-amber-800"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Tên và ĐVT đang khóa để không làm lệch tồn kho. Đổi ĐVT qua lệnh đồng bộ 1:1 riêng.</div>}
      <div className="flex flex-wrap justify-end gap-2">
        {Boolean(edit.name && inventory.some(x => x.itemKind === 'equipment' && equipmentIdentityKey(x.materialName) === equipmentIdentityKey(edit.name))) && canManage && onRenameWarehouseUnit
          && <button type="button" disabled={busy} onClick={() => { void rename(); }} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800">Đổi ĐVT (1:1)</button>}
        <button type="button" disabled={busy || status !== 'ready'} onClick={() => { void save(); }}
          className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" />Lưu thông tin</button>
      </div>
    </div>}
  </div>;
};
