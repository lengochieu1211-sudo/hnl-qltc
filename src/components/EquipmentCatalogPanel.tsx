import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, Search, Save, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
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
const empty: EquipmentCatalogInput = {
  name: '', unit: 'Cái', category: 'Thiết bị', brand: '', model: '', specifications: '', notes: '',
};
const inputClass = 'mt-1 block w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500';
const labelClass = 'block min-w-0 text-[11px] font-bold text-slate-700';

export const EquipmentCatalogPanel: React.FC<Props> = ({ projectId, inventory, canManage, onRenameWarehouseUnit }) => {
  const [records, setRecords] = useState<EquipmentCatalogRecord[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<EquipmentCatalogInput | null>(null);
  const [customGroupMode, setCustomGroupMode] = useState(false);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    setRecords([]);
    setStatus('loading');
    setEdit(null);
    setFeedback('');
    setRenameDraft(null);
    if (!projectId) { setStatus('error'); setError('Chưa chọn dự án'); return; }
    return subscribeEquipmentCatalog(projectId, next => {
      setRecords(next); setError(''); setStatus('ready');
    }, err => { setStatus('error'); setError(err.message); });
  }, [projectId]);

  // Previously saved groups are reusable by all users; a new group can still
  // be entered without creating an extra independent catalogue or collection.
  const groupOptions = useMemo(() => Array.from(new Set([
    'Thiết bị',
    ...records.map(item => String(item.category || '').trim()).filter(Boolean),
  ])).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' })), [records]);

  const items = useMemo(() => {
    const map = new Map<string, EquipmentCatalogInput & { historical: boolean }>();
    inventory.filter(x => x.itemKind === 'equipment' && x.deletedAt == null).forEach(x => {
      const name = String(x.materialName || '').trim();
      const unit = normalizeUnit(x.unit) || x.unit;
      const key = equipmentIdentityKey(name);
      if (key && !map.has(key)) map.set(key, { ...empty, name, unit, historical: true });
    });
    records.forEach(x => map.set(equipmentIdentityKey(x.name), { ...x, historical: map.has(equipmentIdentityKey(x.name)) }));
    const query = search.trim().toLocaleLowerCase('vi-VN');
    return Array.from(map.values())
      .filter(x => !query || [x.name, x.unit, x.category, x.brand, x.model, x.specifications]
        .join(' ').toLocaleLowerCase('vi-VN').includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));
  }, [records, inventory, search]);

  const openEditor = (item: EquipmentCatalogInput) => {
    if (!canManage || busy) return;
    setEdit({ ...item });
    setCustomGroupMode(Boolean(item.category) && !groupOptions.includes(item.category));
    setRenameDraft(null);
    setFeedback('');
  };

  const save = async (addAnother: boolean) => {
    if (!edit || !canManage || status !== 'ready' || busy) return;
    const candidate = {
      ...edit,
      name: edit.name.trim(),
      unit: normalizeUnit(edit.unit.trim()) || edit.unit.trim(),
      category: edit.category.trim(),
    };
    if (!candidate.name || !candidate.unit || !candidate.category) {
      setFeedback('Vui lòng nhập tên thiết bị, ĐVT và nhóm thiết bị.');
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      if (candidate.id && !records.some(x => x.id === candidate.id)) throw new Error('Thiết bị đã thay đổi trên Cloud, vui lòng tải lại.');
      const historicalUnits = new Set(inventory.filter(item =>
        item.itemKind === 'equipment'
        && equipmentIdentityKey(item.materialName) === equipmentIdentityKey(candidate.name)
      ).map(item => normalizeUnit(item.unit) || item.unit));
      if (historicalUnits.size > 1 || (historicalUnits.size === 1 && !historicalUnits.has(candidate.unit))) {
        throw new Error('Thiết bị có lịch sử phiếu kho với ĐVT khác hoặc không duy nhất. Phải đối chiếu kho trước khi lưu.');
      }
      await saveEquipmentCatalogBatch(projectId, [candidate]);
      setFeedback('Đã lưu thông tin thiết bị “' + candidate.name + '” trên Firebase.');
      if (addAnother && !candidate.id) {
        // Keep just the selected group; never carry the prior equipment model,
        // name, specifications or technical identity into the next record.
        setEdit({ ...empty, category: candidate.category });
        setCustomGroupMode(!groupOptions.includes(candidate.category));
      } else {
        setEdit(null);
        setRenameDraft(null);
      }
    } catch (err) {
      setFeedback('Không thể lưu thiết bị: ' + (err instanceof Error ? err.message : String(err)));
    } finally { setBusy(false); }
  };

  const rename = async () => {
    if (!edit || !edit.name || !canManage || busy || !onRenameWarehouseUnit || renameDraft === null) return;
    const currentUnit = normalizeUnit(edit.unit) || edit.unit;
    const nextUnit = normalizeUnit(renameDraft) || renameDraft.trim();
    if (!nextUnit || nextUnit === currentUnit) { setRenameDraft(null); return; }
    if (!inventory.some(item => item.itemKind === 'equipment' && equipmentIdentityKey(item.materialName) === equipmentIdentityKey(edit.name))) {
      setFeedback('Thiết bị chưa có phiếu kho: chưa hỗ trợ chuyển ĐVT đã khai báo mà chưa phát sinh giao dịch.');
      return;
    }
    if (!(await confirmAsync('Đổi ĐVT toàn bộ phiếu nhập/xuất, số dư và thông tin thiết bị?\n'
      + currentUnit + ' → ' + nextUnit + '\nChỉ đổi NHÃN 1:1, không quy đổi số lượng.'))) return;
    setBusy(true);
    setFeedback('');
    try {
      await onRenameWarehouseUnit({ kind: 'equipment', materialName: edit.name, fromUnit: currentUnit, toUnit: nextUnit });
      setEdit(null);
      setRenameDraft(null);
      setFeedback('Đã cập nhật ĐVT cho “' + edit.name + '”. Danh mục và tồn kho sẽ đồng bộ từ Firebase.');
    } catch (err) {
      setFeedback('Chưa đổi ĐVT: ' + (err instanceof Error ? err.message : String(err)));
    } finally { setBusy(false); }
  };

  return <div className="space-y-3" data-hnl-equipment-master="true">
    <p className="text-[11px] leading-relaxed text-slate-600">
      Chỉnh thông tin thiết bị tại đây. Danh mục kho chỉ xem nhập, xuất, tồn; thiết bị không tham gia định mức hao phí vật tư.
    </p>
    {feedback && <div role="status" className={'rounded-xl border px-3 py-2 text-[11px] font-semibold ' +
      (feedback.startsWith('Đã ') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800')}>
      {feedback.startsWith('Đã ') && <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />}{feedback}
    </div>}
    <div className="flex gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-xs outline-none focus:border-indigo-500"
          type="search" placeholder="Tìm thiết bị, nhóm, hãng, model..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {canManage && <button type="button" disabled={status !== 'ready' || busy}
        onClick={() => openEditor({ ...empty })}
        className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
        <Plus className="h-4 w-4" />Thêm thiết bị
      </button>}
    </div>

    {edit && <div className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3 shadow-sm"
      data-hnl-equipment-editor="true">
      <div className="flex items-center justify-between gap-2">
        <div><strong className="text-sm text-slate-900">{edit.id ? 'Chỉnh thông tin thiết bị' : 'Thêm thiết bị mới'}</strong>
          <p className="mt-0.5 text-[10px] text-slate-600">Các mục đánh dấu * là bắt buộc. Chỉ ADMIN được lưu.</p></div>
        <button type="button" disabled={busy} onClick={() => { setEdit(null); setRenameDraft(null); }}
          className="rounded-lg p-2 text-slate-600 hover:bg-white" aria-label="Đóng chỉnh thiết bị"><X className="h-4 w-4" /></button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={labelClass + ' sm:col-span-2'}>Tên thiết bị *
          <input className={inputClass} maxLength={180} value={edit.name} disabled={busy || Boolean(edit.id)}
            onChange={e => setEdit(prev => prev ? { ...prev, name: e.target.value } : null)}
            placeholder="Ví dụ: Máy khoan bê tông" />
        </label>
        <label className={labelClass}>Đơn vị tính (ĐVT) *
          <input className={inputClass} maxLength={60} value={edit.unit} disabled={busy || Boolean(edit.id)}
            onChange={e => setEdit(prev => prev ? { ...prev, unit: e.target.value } : null)}
            placeholder="Cái, Bộ, Máy..." />
        </label>
        <label className={labelClass}>Nhóm thiết bị *
          <select className={inputClass} disabled={busy}
            value={customGroupMode ? '__new_group__' : groupOptions.includes(edit.category) ? edit.category : '__new_group__'}
            onChange={e => {
              if (e.target.value === '__new_group__') {
                setCustomGroupMode(true);
                setEdit(prev => prev ? { ...prev, category: '' } : null);
              } else {
                setCustomGroupMode(false);
                setEdit(prev => prev ? { ...prev, category: e.target.value } : null);
              }
            }} aria-label="Chọn nhóm thiết bị">
            {groupOptions.map(group => <option key={group} value={group}>{group}</option>)}
            <option value="__new_group__">+ Nhập nhóm thiết bị mới…</option>
          </select>
          {customGroupMode && <input className={inputClass} autoFocus maxLength={120}
            value={edit.category} onChange={e => setEdit(prev => prev ? { ...prev, category: e.target.value } : null)}
            placeholder="Nhập tên nhóm thiết bị mới" aria-label="Tên nhóm thiết bị mới" />}
        </label>
        <label className={labelClass}>Hãng sản xuất
          <input className={inputClass} maxLength={120} value={edit.brand} disabled={busy}
            onChange={e => setEdit(prev => prev ? { ...prev, brand: e.target.value } : null)} placeholder="Bosch, Makita..." />
        </label>
        <label className={labelClass}>Model / Mã hiệu
          <input className={inputClass} maxLength={120} value={edit.model} disabled={busy}
            onChange={e => setEdit(prev => prev ? { ...prev, model: e.target.value } : null)} placeholder="Model thiết bị" />
        </label>
        <label className={labelClass + ' sm:col-span-2'}>Quy cách / Công suất / Thông số kỹ thuật
          <textarea className={inputClass} rows={2} maxLength={1200} value={edit.specifications} disabled={busy}
            onChange={e => setEdit(prev => prev ? { ...prev, specifications: e.target.value } : null)} />
        </label>
        <label className={labelClass + ' sm:col-span-2'}>Ghi chú
          <textarea className={inputClass} rows={2} maxLength={1200} value={edit.notes} disabled={busy}
            onChange={e => setEdit(prev => prev ? { ...prev, notes: e.target.value } : null)} />
        </label>
      </div>

      {edit.id && <div className="flex gap-2 rounded-xl bg-amber-50 p-2 text-[10px] text-amber-900">
        <AlertTriangle className="h-4 w-4 shrink-0" />Tên và ĐVT đã sử dụng bị khóa để giữ nguyên phiếu và tồn kho.
        Việc đổi ĐVT phải thực hiện đồng bộ 1:1 riêng.
      </div>}
      {renameDraft !== null && <div className="space-y-2 rounded-xl border border-amber-200 bg-white p-3" data-hnl-equipment-rename="true">
        <label className={labelClass}>ĐVT mới (chỉ đổi nhãn 1:1, không quy đổi số lượng)
          <input className={inputClass} value={renameDraft} disabled={busy} maxLength={60}
            onChange={e => setRenameDraft(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setRenameDraft(null)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">Hủy</button>
          <button type="button" disabled={busy || !renameDraft.trim()} onClick={() => { void rename(); }}
            className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Xác nhận đổi ĐVT</button>
        </div>
      </div>}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-indigo-100 pt-3">
        {Boolean(edit.name && edit.id && inventory.some(x =>
          x.itemKind === 'equipment' && equipmentIdentityKey(x.materialName) === equipmentIdentityKey(edit.name)))
          && canManage && onRenameWarehouseUnit && renameDraft === null &&
          <button type="button" disabled={busy} onClick={() => setRenameDraft(edit.unit)}
            className="mr-auto rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-xs font-bold text-amber-800">
            Đổi ĐVT (1:1)
          </button>}
        <button type="button" disabled={busy} onClick={() => { setEdit(null); setRenameDraft(null); }}
          className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-700">
          Hủy
        </button>
        <button type="button" disabled={busy || status !== 'ready' || !canManage}
          onClick={() => { void save(false); }}
          className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-indigo-300 bg-white px-3 py-2.5 text-xs font-bold text-indigo-700 disabled:opacity-40">
          <Save className="h-3.5 w-3.5" />Lưu
        </button>
        {!edit.id && <button type="button" disabled={busy || status !== 'ready' || !canManage}
          onClick={() => { void save(true); }}
          className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" />Lưu & thêm tiếp
        </button>}
      </div>
    </div>}

    {status === 'loading' && <p className="text-xs text-slate-500">Đang tải thông tin thiết bị...</p>}
    {status === 'error' && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">
      Không thể tải dữ liệu thiết bị: {error}. Không cho ghi khi chưa xác minh Cloud.</p>}
    {status === 'ready' && <div className="max-h-[44vh] space-y-2 overflow-y-auto">
      {items.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500">
        Chưa có thiết bị. Nhấn “Thêm thiết bị” để nhập thông tin trước khi phát sinh phiếu kho.</p>}
      {items.map(item => <div key={item.id || equipmentIdentityKey(item.name)}
        className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="min-w-0">
          <p className="break-words text-xs font-extrabold text-slate-900">{item.name} · {item.unit}</p>
          <p className="text-[11px] text-slate-600">
            {item.category || 'Thiết bị'}{item.brand ? ' · ' + item.brand : ''}{item.model ? ' · ' + item.model : ''}
          </p>
          {item.specifications && <p className="break-words text-[11px] text-slate-600">{item.specifications}</p>}
          {!item.id && <p className="text-[10px] text-amber-700">
            Có lịch sử phiếu kho nhưng chưa bổ sung thông số thiết bị.</p>}
        </div>
        {canManage && <button type="button" disabled={busy} onClick={() => openEditor(item)}
          className="shrink-0 rounded-lg border border-indigo-200 p-2 text-indigo-700 hover:bg-indigo-50"
          aria-label={'Chỉnh thông tin ' + item.name} title="Chỉnh thông tin thiết bị">
          <Edit2 className="h-4 w-4" />
        </button>}
      </div>)}
    </div>}
  </div>;
};
