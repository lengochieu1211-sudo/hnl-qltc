import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Edit2, Plus, Search, Save, Trash2, RotateCcw, X } from 'lucide-react';
import type { InventoryItem } from '../types';
import { confirmAsync } from '../utils/confirmAsync';
import { normalizeUnit } from '../utils/unitUtils';
import {
  equipmentIdentityKey, saveEquipmentCatalogBatch, softDeleteEquipmentCatalogBatch,
  restoreEquipmentCatalog, subscribeEquipmentCatalog,
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

const EMPTY_EQUIPMENT: EquipmentCatalogInput = {
  name: '', unit: 'Cái', category: 'Thiết bị',
  brand: '', model: '', specifications: '', notes: '',
};

const FIELD_CLASS = 'mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500';
const normalizeCategory = (text: string) => text.trim().toLocaleLowerCase('vi-VN');

export const EquipmentCatalogPanel: React.FC<Props> = ({
  projectId, inventory, canManage, onRenameWarehouseUnit,
}) => {
  const [records, setRecords] = useState<EquipmentCatalogRecord[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<EquipmentCatalogInput | null>(null);
  // A voucher-backed legacy item may not have a catalog ID; edit mode is explicit.
  const [editingExisting, setEditingExisting] = useState(false);
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [customGroup, setCustomGroup] = useState(false);
  const [renameUnitOpen, setRenameUnitOpen] = useState(false);
  const [newUnit, setNewUnit] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setRecords([]);
    setEdit(null);
    setEditingExisting(false);
    setSelectedEquipmentIds([]);
    setShowDeleted(false);
    setStatus('loading');
    setNotice('');
    if (!projectId) {
      setStatus('error');
      setError('Chưa chọn dự án');
      return;
    }
    return subscribeEquipmentCatalog(projectId, (next) => {
      setRecords(next);
      setError('');
      setStatus('ready');
    }, (err) => {
      setStatus('error');
      setError(err.message);
    });
  }, [projectId]);

  const activeRecords = useMemo(() => records.filter(item => item.deletedAt == null), [records]);
  const deletedRecords = useMemo(() => records.filter(item => item.deletedAt != null), [records]);
  const historicalNames = useMemo(() => new Set(
    inventory.filter(item => item.itemKind === 'equipment')
      .map(item => equipmentIdentityKey(String(item.materialName || ''))),
  ), [inventory]);
  const editingHasHistory = Boolean(edit && historicalNames.has(equipmentIdentityKey(edit.name)));

  // Equipment groups are derived exclusively from the saved master data.
  // No second mutable "groups" table is created; new groups become selectable
  // for all users as soon as an ADMIN saves the first equipment of that group.
  const groupOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    activeRecords.forEach((record) => {
      const group = String(record.category || '').trim();
      if (group && !byKey.has(normalizeCategory(group))) byKey.set(normalizeCategory(group), group);
    });
    if (!byKey.size) byKey.set(normalizeCategory('Thiết bị'), 'Thiết bị');
    return Array.from(byKey.values()).sort((a, b) =>
      a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' }));
  }, [activeRecords]);

  const items = useMemo(() => {
    const map = new Map<string, EquipmentCatalogInput & { historical: boolean }>();
    inventory.filter(item => item.itemKind === 'equipment' && item.deletedAt == null).forEach(item => {
      const name = String(item.materialName || '').trim();
      const unit = normalizeUnit(item.unit) || item.unit;
      const key = equipmentIdentityKey(name);
      if (key && !map.has(key)) {
        map.set(key, { ...EMPTY_EQUIPMENT, name, unit, historical: true });
      }
    });
    activeRecords.forEach(item =>
      map.set(equipmentIdentityKey(item.name), {
        ...item, historical: map.has(equipmentIdentityKey(item.name)),
      }));
    const q = search.trim().toLocaleLowerCase('vi-VN');
    return Array.from(map.values())
      .filter(item => !q || [
        item.name, item.unit, item.category, item.brand, item.model, item.specifications,
      ].join(' ').toLocaleLowerCase('vi-VN').includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));
  }, [inventory, activeRecords, search]);

  const deletableVisibleItems = useMemo(() => items.filter(item =>
    Boolean(item.id) && !historicalNames.has(equipmentIdentityKey(item.name))),
  [items, historicalNames]);
  const selectedVisibleItems = useMemo(() => deletableVisibleItems.filter(item =>
    item.id && selectedEquipmentIds.includes(item.id)),
  [deletableVisibleItems, selectedEquipmentIds]);

  const startNew = (keep?: Pick<EquipmentCatalogInput, 'category' | 'unit'>) => {
    setEditingExisting(false);
    setEdit({
      ...EMPTY_EQUIPMENT,
      category: keep?.category || groupOptions[0] || 'Thiết bị',
      unit: keep?.unit || EMPTY_EQUIPMENT.unit,
    });
    setCustomGroup(false);
    setRenameUnitOpen(false);
    setNewUnit('');
    setNotice('');
  };

  const startEdit = (item: EquipmentCatalogInput) => {
    setEditingExisting(true);
    setEdit({ ...item });
    setCustomGroup(false);
    setRenameUnitOpen(false);
    setNewUnit('');
    setNotice('');
  };

  const save = async (addAnother: boolean) => {
    if (!edit || !canManage || status !== 'ready' || busy) return;
    const equipment = {
      ...edit,
      name: String(edit.name || '').trim(),
      category: String(edit.category || '').trim(),
      unit: normalizeUnit(edit.unit) || String(edit.unit || '').trim(),
    };
    if (!equipment.name || !equipment.unit || !equipment.category) {
      setNotice('Cần nhập tên, đơn vị tính và nhóm thiết bị trước khi lưu.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      if (equipment.id && !records.some(item => item.id === equipment.id)) {
        throw new Error('Thiết bị đã thay đổi trên Cloud, vui lòng tải lại.');
      }
      // Retain the fail-closed check for ALL historical equipment vouchers,
      // including restorable deleted transactions. The server also verifies
      // the ledger so a stale device cannot establish a conflicting unit.
      const historicalUnits = new Set(inventory.filter(item =>
        item.itemKind === 'equipment'
        && equipmentIdentityKey(item.materialName) === equipmentIdentityKey(equipment.name)
      ).map(item => normalizeUnit(item.unit) || item.unit));
      if (historicalUnits.size > 1 || (historicalUnits.size === 1 && !historicalUnits.has(equipment.unit))) {
        throw new Error('Thiết bị đã có lịch sử kho với ĐVT khác hoặc không duy nhất. Hãy đối chiếu phiếu trước khi lưu.');
      }
      await saveEquipmentCatalogBatch(projectId, [equipment]);
      if (addAnother && !equipment.id) {
        // Keep the selected group and unit for repeated entry; never repeat
        // name, model, technical specs or the previous record's Cloud ID.
        startNew({ category: equipment.category, unit: equipment.unit });
        setNotice('Đã lưu “' + equipment.name + '”. Bạn có thể thêm thiết bị tiếp theo.');
      } else {
        setEdit(null);
        setNotice('Đã lưu thông tin thiết bị “' + equipment.name + '”.');
      }
    } catch (err) {
      setNotice('Không thể lưu thiết bị: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!edit || !edit.name || !canManage || busy || !onRenameWarehouseUnit) return;
    const currentUnit = normalizeUnit(edit.unit) || edit.unit;
    const next = normalizeUnit(newUnit) || newUnit.trim();
    if (!next || next === currentUnit) {
      setNotice('Hãy nhập ĐVT mới khác ĐVT hiện tại.');
      return;
    }
    if (!(await confirmAsync(
      'Đổi ĐVT toàn bộ phiếu nhập/xuất, số dư và thông tin thiết bị?\n'
      + currentUnit + ' → ' + next + '\nChỉ đổi nhãn đơn vị tỷ lệ 1:1; không quy đổi số lượng.'
    ))) return;
    setBusy(true);
    setNotice('');
    try {
      await onRenameWarehouseUnit({
        kind: 'equipment', materialName: edit.name,
        fromUnit: currentUnit, toUnit: next,
      });
      setEdit(null);
      setRenameUnitOpen(false);
      setNotice('Đã đổi ĐVT. Dữ liệu sẽ cập nhật qua đồng bộ Firebase.');
    } catch (err) {
      setNotice('Chưa đổi ĐVT: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-3" data-hnl-equipment-master="true">
    <p className="text-[11px] leading-relaxed text-slate-600">
      Quản lý thông số thiết bị tại đây. Nhật ký Nhập/Xuất và tồn kho giữ nguyên, không đưa thiết bị vào định mức hao phí vật tư.
    </p>
    {notice && <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{notice}</p>}
    <div className="flex flex-wrap gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <input type="search" className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-2 text-xs"
          placeholder="Tìm tên, nhóm, hãng, model..."
          value={search} onChange={event => setSearch(event.target.value)} />
      </div>
      {canManage && !edit && <button type="button" disabled={status !== 'ready' || busy}
        onClick={() => startNew()}
        className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
        <Plus className="h-4 w-4" /> Thêm thiết bị
      </button>}
    </div>

    {status === 'loading' && <p className="text-xs text-slate-500">Đang tải thiết bị...</p>}
    {status === 'error' && <p role="alert" className="text-xs text-rose-700">
      Không tải được thông tin thiết bị: {error}. Chức năng chỉnh sửa được khóa để bảo vệ dữ liệu.
    </p>}

    {edit && <section className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3 sm:p-4" data-hnl-equipment-editor="true">
      <div className="flex items-center justify-between gap-2 border-b border-indigo-100 pb-2">
        <strong className="text-sm font-extrabold text-slate-900">
          {editingExisting ? (edit.id ? 'Chỉnh thông tin thiết bị' : 'Bổ sung thông tin thiết bị từ phiếu kho') : 'Thêm thiết bị'}
        </strong>
        <button type="button" disabled={busy} onClick={() => setEdit(null)}
          aria-label="Đóng thông tin thiết bị" className="rounded-lg p-1.5 text-slate-600 hover:bg-white disabled:opacity-40">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">
          Tên thiết bị <span className="text-rose-600">*</span>
          <input value={edit.name} disabled={busy || editingExisting}
            onChange={event => setEdit(prev => prev ? { ...prev, name: event.target.value } : prev)}
            placeholder="Ví dụ: Máy cắt thạch cao" className={FIELD_CLASS} />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Nhóm thiết bị <span className="text-rose-600">*</span>
          <select value={customGroup ? '__new_group__' : edit.category}
            disabled={busy} className={FIELD_CLASS}
            onChange={event => {
              if (event.target.value === '__new_group__') {
                setCustomGroup(true);
                setEdit(prev => prev ? { ...prev, category: '' } : prev);
              } else {
                setCustomGroup(false);
                setEdit(prev => prev ? { ...prev, category: event.target.value } : prev);
              }
            }}>
            {Array.from(new Set([
              ...groupOptions,
              ...(edit.category && !customGroup ? [edit.category] : []),
            ])).map(group => <option key={group} value={group}>{group}</option>)}
            <option value="__new_group__">+ Nhập nhóm mới...</option>
          </select>
          {customGroup && <input value={edit.category} disabled={busy} className={FIELD_CLASS}
            placeholder="Nhập tên nhóm thiết bị mới"
            onChange={event => setEdit(prev => prev ? { ...prev, category: event.target.value } : prev)} />}
          <span className="mt-1 block text-[10px] font-normal text-slate-500">
            Nhóm mới sẽ xuất hiện trong danh sách chọn sau khi lưu thiết bị.
          </span>
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Đơn vị tính <span className="text-rose-600">*</span>
          <input value={edit.unit} disabled={busy || (editingExisting && editingHasHistory)}
            onChange={event => setEdit(prev => prev ? { ...prev, unit: event.target.value } : prev)}
            placeholder="Cái, Bộ, Chiếc..." className={FIELD_CLASS} />
        </label>
        {([
          ['brand', 'Hãng sản xuất', 'Ví dụ: Bosch'],
          ['model', 'Model / Mã hiệu', 'Ví dụ: GWS 750'],
        ] as const).map(([key, label, placeholder]) =>
          <label key={key} className="block text-xs font-semibold text-slate-700">
            {label}
            <input value={edit[key] || ''} disabled={busy} placeholder={placeholder}
              onChange={event => setEdit(prev => prev ? { ...prev, [key]: event.target.value } : prev)}
              className={FIELD_CLASS} />
          </label>
        )}
        {([
          ['specifications', 'Quy cách / Công suất / Thông số kỹ thuật'],
          ['notes', 'Ghi chú'],
        ] as const).map(([key, label]) =>
          <label key={key} className="block text-xs font-semibold text-slate-700 sm:col-span-2">
            {label}
            <textarea value={edit[key] || ''} disabled={busy} rows={2}
              onChange={event => setEdit(prev => prev ? { ...prev, [key]: event.target.value } : prev)}
              className={FIELD_CLASS} />
          </label>
        )}
      </div>

      {editingExisting && <p className="flex items-start gap-2 text-[11px] text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {editingHasHistory
          ? 'Tên và ĐVT đang có phiếu kho được khóa. Đổi ĐVT bằng quy trình 1:1, không tự quy đổi số lượng hoặc phá dữ liệu cũ.'
          : 'Tên thiết bị được giữ nguyên để bảo toàn mã. Chưa có phiếu kho nên có thể chỉnh trực tiếp ĐVT và lưu thay đổi.'}
      </p>}
      {editingExisting && editingHasHistory && canManage && onRenameWarehouseUnit &&
        <div className="space-y-2 rounded-xl border border-amber-200 bg-white p-3">
          {!renameUnitOpen
            ? <button type="button" disabled={busy} onClick={() => { setNewUnit(''); setRenameUnitOpen(true); }}
                className="text-xs font-bold text-amber-800 underline">Đổi ĐVT (1:1)</button>
            : <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700">ĐVT mới (chỉ đổi nhãn 1:1)
                  <input value={newUnit} disabled={busy} onChange={event => setNewUnit(event.target.value)}
                    className={FIELD_CLASS} placeholder="Nhập ĐVT mới" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => { void rename(); }}
                    className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white">Xác nhận đổi ĐVT</button>
                  <button type="button" disabled={busy} onClick={() => setRenameUnitOpen(false)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">Hủy đổi ĐVT</button>
                </div>
              </div>}
        </div>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-indigo-100 pt-3">
        <button type="button" disabled={busy} onClick={() => setEdit(null)}
          className="min-h-10 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">
          Hủy
        </button>
        <button type="button" disabled={busy || status !== 'ready'} onClick={() => { void save(false); }}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-indigo-300 bg-white px-4 py-2 text-xs font-extrabold text-indigo-700 disabled:opacity-40">
          <Save className="h-4 w-4" /> {editingExisting ? 'Lưu thay đổi' : 'Lưu'}
        </button>
        {!editingExisting && <button type="button" disabled={busy || status !== 'ready'} onClick={() => { void save(true); }}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-indigo-700 disabled:opacity-40">
          <Plus className="h-4 w-4" /> Lưu &amp; thêm tiếp
        </button>}
      </div>
    </section>}

    {status === 'ready' && !edit && <div className="max-h-[44vh] space-y-2 overflow-y-auto">
      {items.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500">
        Chưa có thiết bị. ADMIN có thể thêm thiết bị trước khi nhập kho.
      </p>}
      {items.map(item => <div key={item.id || equipmentIdentityKey(item.name)}
        className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="min-w-0">
          <p className="break-words text-xs font-extrabold text-slate-900">{item.name} · {item.unit}</p>
          <p className="text-[11px] text-slate-600">
            {item.category || 'Thiết bị'}{item.brand ? ' · ' + item.brand : ''}{item.model ? ' · ' + item.model : ''}
          </p>
          {item.specifications && <p className="break-words text-[11px] text-slate-600">{item.specifications}</p>}
          {!item.id && <p className="text-[10px] text-amber-700">Phiếu lịch sử: chưa có thông số thiết bị</p>}
        </div>
        {canManage && <button type="button" onClick={() => startEdit(item)}
          className="shrink-0 rounded-lg border border-indigo-200 p-2 text-indigo-700"
          title="Chỉnh thông tin thiết bị" aria-label={'Chỉnh thiết bị ' + item.name}>
          <Edit2 className="h-4 w-4" />
        </button>}
      </div>)}
    </div>}
  </div>;
};
