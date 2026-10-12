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
  const [addGroupMode, setAddGroupMode] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setRecords([]);
    setEdit(null);
    setNotice('');
    setAddGroupMode(false);
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

  // Use the existing Cloud catalog as the list of available equipment groups.
  // User-defined groups become reusable immediately after the first successful save.
  const groupOptions = useMemo(() => {
    const unique = new Map<string, string>();
    ['Thiết bị', ...records.map(item => item.category)].forEach(group => {
      const clean = String(group || '').trim();
      if (clean && !unique.has(clean.toLocaleLowerCase('vi-VN'))) {
        unique.set(clean.toLocaleLowerCase('vi-VN'), clean);
      }
    });
    if (edit?.category && !addGroupMode) {
      const clean = edit.category.trim();
      if (clean && !unique.has(clean.toLocaleLowerCase('vi-VN'))) unique.set(clean.toLocaleLowerCase('vi-VN'), clean);
    }
    return [...unique.values()].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  }, [records, edit?.category, addGroupMode]);

  const startAdd = () => {
    setNotice('');
    setAddGroupMode(false);
    setEdit({ ...empty });
  };

  const startEdit = (item: EquipmentCatalogInput) => {
    setNotice('');
    setAddGroupMode(false);
    setEdit({ ...item });
  };

  const save = async (addAnother = false) => {
    if (!edit || !canManage || status !== 'ready' || busy) return;
    if (!edit.name.trim() || !edit.unit.trim() || !edit.category.trim()) {
      alert('Vui lòng nhập Tên thiết bị, ĐVT và Nhóm thiết bị.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      if (edit.id && !records.some(x => x.id === edit.id)) throw new Error('Thiết bị đã thay đổi trên Cloud, vui lòng tải lại.');
      const historicalUnits = new Set(inventory.filter(item =>
        item.itemKind === 'equipment'
        && equipmentIdentityKey(item.materialName) === equipmentIdentityKey(edit.name)
      ).map(item => normalizeUnit(item.unit) || item.unit));
      if (historicalUnits.size > 1 || (historicalUnits.size === 1
        && !historicalUnits.has(normalizeUnit(edit.unit) || edit.unit))) {
        throw new Error('Thiết bị đã có lịch sử kho với ĐVT khác hoặc không duy nhất. Hãy đối chiếu phiếu trước khi lưu danh mục.');
      }
      await saveEquipmentCatalogBatch(projectId, [edit]);
      if (addAnother && !edit.id) {
        setEdit({ ...empty, category: edit.category.trim() });
        setAddGroupMode(false);
        setNotice('Đã lưu thiết bị. Có thể thêm thiết bị tiếp theo trong cùng nhóm.');
      } else {
        setEdit(null);
        setAddGroupMode(false);
        setNotice('Đã lưu thông tin thiết bị vào Firebase.');
      }
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
      {canManage && <button type="button" disabled={status !== 'ready' || busy} onClick={startAdd}
        data-hnl-equipment-add="true"
        className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-extrabold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-40">
        <Plus className="h-4 w-4" /> Thêm thiết bị
      </button>}
    </div>
    {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{notice}</p>}
    {status === 'loading' && <p className="text-xs text-slate-500">Đang tải thông tin thiết bị...</p>}
    {status === 'error' && <p role="alert" className="text-xs text-rose-700">Không thể tải danh mục thiết bị: {error}. Không cho ghi khi chưa xác minh dữ liệu Cloud.</p>}
    {status === 'ready' && !edit && <div className="max-h-[44vh] space-y-2 overflow-y-auto">
      {items.length === 0 && <p className="rounded-lg border border-dashed p-4 text-xs text-slate-500">Chưa có thiết bị nào. ADMIN có thể thêm thiết bị mà chưa cần nhập kho.</p>}
      {items.map(item => <div key={item.id || equipmentIdentityKey(item.name)} className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="min-w-0"><p className="text-xs font-extrabold text-slate-900 break-words">{item.name} · {item.unit}</p>
          <p className="text-[11px] text-slate-600">{item.category || 'Thiết bị'}{item.brand ? ' · ' + item.brand : ''}{item.model ? ' · ' + item.model : ''}</p>
          {item.specifications && <p className="text-[11px] text-slate-600 break-words">{item.specifications}</p>}
          {!item.id && <p className="text-[10px] text-amber-700">Dữ liệu lịch sử: chưa khai báo thông số danh mục</p>}
        </div>
        {canManage && <button type="button" onClick={() => startEdit(item)} disabled={busy}
          className="shrink-0 rounded-xl border border-indigo-200 bg-indigo-50 p-2 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50" title="Sửa thông tin thiết bị" aria-label={`Sửa thông tin ${item.name}`}>
          <Edit2 className="h-4 w-4" />
        </button>}
      </div>)}
    </div>}
    {edit && <form onSubmit={(event) => { event.preventDefault(); void save(false); }}
      className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-3 sm:p-4 shadow-sm"
      data-hnl-equipment-editor="true">
      <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <div className="min-w-0">
          <h4 className="text-sm font-extrabold text-slate-900">{edit.id ? 'Sửa thông tin thiết bị' : 'Thêm thiết bị mới'}</h4>
          <p className="text-[10px] text-slate-500">Các trường đánh dấu * bắt buộc · Chỉ ADMIN được lưu</p>
        </div>
        <button type="button" disabled={busy} onClick={() => setEdit(null)}
          className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          title="Quay lại danh sách" aria-label="Quay lại danh sách thiết bị"><X className="h-4 w-4" /></button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-bold text-slate-700 sm:col-span-2">Tên thiết bị *
          <input required maxLength={180} value={edit.name} disabled={busy || Boolean(edit.id)}
            onChange={event => setEdit(prev => prev ? { ...prev, name: event.target.value } : null)}
            placeholder="Ví dụ: Máy khoan bê tông, giàn giáo, máy laser..."
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100" />
        </label>

        <label className="block text-xs font-bold text-slate-700">Nhóm thiết bị *
          <select value={addGroupMode ? '__new__' : edit.category} disabled={busy}
            onChange={event => {
              if (event.target.value === '__new__') { setAddGroupMode(true); setEdit(prev => prev ? { ...prev, category: '' } : null); }
              else { setAddGroupMode(false); setEdit(prev => prev ? { ...prev, category: event.target.value } : null); }
            }}
            data-hnl-equipment-group-select="true"
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
            {groupOptions.map(group => <option key={group} value={group}>{group}</option>)}
            <option value="__new__">+ Nhập nhóm thiết bị mới...</option>
          </select>
          {addGroupMode && <input autoFocus maxLength={120} required disabled={busy} value={edit.category}
            data-hnl-equipment-custom-group="true"
            onChange={event => setEdit(prev => prev ? { ...prev, category: event.target.value } : null)}
            placeholder="Nhập tên nhóm mới" className="mt-2 w-full rounded-xl border border-indigo-300 bg-white px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-indigo-100" />}
          <span className="mt-1 block text-[10px] font-normal text-slate-500">Nhóm đã tạo sẽ có trong danh sách chọn lần sau.</span>
        </label>

        <label className="block text-xs font-bold text-slate-700">Đơn vị tính (ĐVT) *
          <input required maxLength={60} value={edit.unit} disabled={busy || Boolean(edit.id)}
            onChange={event => setEdit(prev => prev ? { ...prev, unit: event.target.value } : null)}
            placeholder="Cái, bộ, chiếc, máy..."
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100" />
        </label>

        {([
          ['brand','Hãng sản xuất',120], ['model','Model / Mã hiệu',120],
        ] as const).map(([key,label,maxLength]) => <label key={key} className="block text-xs font-bold text-slate-700">
          {label}
          <input maxLength={maxLength} disabled={busy} value={edit[key] || ''}
            onChange={event => setEdit(prev => prev ? { ...prev, [key]: event.target.value } : null)}
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
        </label>)}

        {(['specifications','notes'] as const).map(key => <label key={key} className="block text-xs font-bold text-slate-700 sm:col-span-2">
          {key === 'specifications' ? 'Quy cách / Công suất / Thông số kỹ thuật' : 'Ghi chú'}
          <textarea maxLength={1200} rows={2} disabled={busy} value={edit[key] || ''}
            onChange={event => setEdit(prev => prev ? { ...prev, [key]: event.target.value } : null)}
            className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
        </label>)}
      </div>

      {edit.id && <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-800">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Tên và ĐVT đang khóa để bảo vệ phiếu kho, tồn kho. Đổi ĐVT phải qua bước đối chiếu dữ liệu 1:1 riêng.
      </p>}
      <div className="grid grid-cols-2 gap-2 border-t border-indigo-100 pt-3 sm:grid-cols-3">
        <button type="button" disabled={busy} onClick={() => { setEdit(null); setAddGroupMode(false); }}
          className="min-h-10 rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
          Hủy
        </button>
        {!edit.id && <button type="button" disabled={busy || status !== 'ready'}
          onClick={() => { void save(true); }}
          data-hnl-equipment-save-continue="true"
          className="min-h-10 rounded-xl border border-indigo-200 bg-white px-3 py-2.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
          Lưu & thêm tiếp
        </button>}
        <button type="submit" disabled={busy || status !== 'ready'}
          data-hnl-equipment-save="true"
          className={`min-h-10 inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 ${edit.id ? 'col-span-1 sm:col-span-2' : 'col-span-2 sm:col-span-1'}`}>
          <Save className="h-4 w-4" /> {busy ? 'Đang lưu...' : edit.id ? 'Lưu thay đổi' : 'Lưu & đóng'}
        </button>
      </div>
      {edit.id && Boolean(edit.name && inventory.some(item => item.itemKind === 'equipment'
        && equipmentIdentityKey(item.materialName) === equipmentIdentityKey(edit.name)))
        && onRenameWarehouseUnit && <button type="button" disabled={busy} onClick={() => { void rename(); }}
          className="text-xs font-bold text-amber-700 underline disabled:opacity-40">Đổi ĐVT (1:1) sau khi đối chiếu phiếu kho</button>}
    </form>
  </div>;
};
