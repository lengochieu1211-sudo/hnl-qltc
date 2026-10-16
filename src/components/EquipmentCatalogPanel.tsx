import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Edit3, Plus, Search, Save, Trash2, RotateCcw, X } from 'lucide-react';
import { AddSourceMenu } from './AddSourceMenu';
import { QuickSortBar } from './QuickSortBar';
import { CatalogTemplatePickerModal } from './CatalogTemplatePickerModal';
import { MoveOrderControls } from './MoveOrderControls';
import { catalogOrderRank, reorderVisibleCatalogItems } from '../utils/catalogDisplayOrder';
import type { InventoryItem } from '../types';
import type { WarehouseUnitRenameInput } from '../lib/warehouseUnitMigration';
import { confirmAsync } from '../utils/confirmAsync';
import { normalizeUnit, areSameUnit } from '../utils/unitUtils';
import {
  equipmentIdentityKey, EquipmentUnitMigrationRequiredError, saveEquipmentCatalogBatch, softDeleteEquipmentCatalogBatch,
  restoreEquipmentCatalog, reorderEquipmentCatalog, subscribeEquipmentCatalog,
  type EquipmentCatalogRecord, type EquipmentCatalogInput,
} from '../lib/equipmentCatalog';

interface Props {
  projectId: string;
  inventory: InventoryItem[];
  canManage: boolean;
  initialTarget?: { name: string; unit: string };
  onDraftDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  onRenameWarehouseUnit?: (input: Omit<WarehouseUnitRenameInput, 'projectId'>) => Promise<{ norms: number; vouchers: number }>;
}

const EMPTY_EQUIPMENT: EquipmentCatalogInput = {
  name: '', unit: 'Cái', category: 'Thiết bị',
  brand: '', model: '', specifications: '', notes: '',
};

// Match the 12px typography and field spacing used by the Add Material Norm form.
const FIELD_CLASS = 'mt-1 block w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500';
const TEXTAREA_CLASS = FIELD_CLASS.replace('font-semibold', 'font-medium');
const normalizeCategory = (text: string) => text.trim().toLocaleLowerCase('vi-VN');

export const EquipmentCatalogPanel: React.FC<Props> = ({
  projectId, inventory, canManage, initialTarget, onDraftDirtyChange, onBusyChange, onRenameWarehouseUnit,
}) => {
  const [records, setRecords] = useState<EquipmentCatalogRecord[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const initialTargetHandled = React.useRef(false);
  const [targetNotFound, setTargetNotFound] = useState(false);
  const [edit, setEdit] = useState<EquipmentCatalogInput | null>(null);
  const [editBaseline, setEditBaseline] = useState('');
  // A voucher-backed legacy item may not have a catalog ID; edit mode is explicit.
  const [editingExisting, setEditingExisting] = useState(false);
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<string[]>([]);
  const [showEquipmentSourcePicker, setShowEquipmentSourcePicker] = useState(false);
  const [equipmentSortBy, setEquipmentSortBy] = useState<'none' | 'name' | 'category' | 'unit' | 'brand'>('none');
  const [equipmentSortOrder, setEquipmentSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showDeleted, setShowDeleted] = useState(false);
  const [draggedEquipmentId, setDraggedEquipmentId] = useState<string | null>(null);
  const [customGroup, setCustomGroup] = useState(false);
  const [originalEditUnit, setOriginalEditUnit] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    onDraftDirtyChange?.(edit !== null && JSON.stringify(edit) !== editBaseline);
  }, [edit, editBaseline, onDraftDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

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
    }, { includeDeleted: true });
  }, [projectId]);

  const activeRecords = useMemo(() => records.filter(item => item.deletedAt == null), [records]);
  const deletedRecords = useMemo(() => records.filter(item => item.deletedAt != null), [records]);
  const historicalNames = useMemo(() => new Set(
    inventory.filter(item => item.itemKind === 'equipment')
      .map(item => equipmentIdentityKey(String(item.materialName || ''))),
  ), [inventory]);
  const editingHasHistory = Boolean(edit && historicalNames.has(equipmentIdentityKey(edit.name)));
  const editingHistoricalUnits = useMemo(() => edit ? Array.from(new Set(inventory
    .filter(item => item.itemKind === 'equipment'
      && equipmentIdentityKey(item.materialName) === equipmentIdentityKey(edit.name))
    .map(item => normalizeUnit(item.unit) || item.unit))) : [], [edit?.name, inventory]);

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

  const hasSavedOrder = activeRecords.some(item => catalogOrderRank(item.order) !== Number.MAX_SAFE_INTEGER);
  const sortManualEquipment = (a: { name: string; order?: number }, b: { name: string; order?: number }) =>
    (hasSavedOrder ? catalogOrderRank(a.order) - catalogOrderRank(b.order) : 0)
      || a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' });
  const orderedSavedRecords = [...activeRecords].sort(sortManualEquipment);

  const items = useMemo(() => {
    const map = new Map<string, EquipmentCatalogInput & { historical: boolean; order?: number }>();
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
        ...item, displayName: item.displayName || item.name, historical: map.has(equipmentIdentityKey(item.name)),
      }));
    const q = search.trim().toLocaleLowerCase('vi-VN');
    return Array.from(map.values())
      .filter(item => !q || [
        item.name, item.displayName, item.unit, item.category, item.brand, item.model, item.specifications,
      ].join(' ').toLocaleLowerCase('vi-VN').includes(q))
      .sort((a, b) => {
        if (equipmentSortBy === 'none') return sortManualEquipment(a, b); // Same canonical order as Cloud reorder base.
        const compared = String(equipmentSortBy === 'name' ? (a.displayName || a.name) : a[equipmentSortBy] || '').localeCompare(
          String(equipmentSortBy === 'name' ? (b.displayName || b.name) : b[equipmentSortBy] || ''), 'vi', { numeric: true, sensitivity: 'base' });
        const named = a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' });
        return (equipmentSortOrder === 'desc' ? -compared : compared) || named;
      });
  }, [inventory, activeRecords, search, equipmentSortBy, equipmentSortOrder, hasSavedOrder]);

  const deletableVisibleItems = useMemo(() => items.filter(item =>
    Boolean(item.id) && !historicalNames.has(equipmentIdentityKey(item.name))),
  [items, historicalNames]);
  const selectedVisibleItems = useMemo(() => deletableVisibleItems.filter(item =>
    item.id && selectedEquipmentIds.includes(item.id)),
  [deletableVisibleItems, selectedEquipmentIds]);

  const visibleSavedIds = items.filter(item => Boolean(item.id)).map(item => item.id!);
  const canReorderEquipment = canManage && status === 'ready' && !busy
    && equipmentSortBy === 'none' && orderedSavedRecords.length >= 2
    && orderedSavedRecords.length <= 100;

  const moveVisibleEquipment = async (sourceId: string, targetId: string) => {
    if (!canReorderEquipment || sourceId === targetId) return;
    const ids = [...visibleSavedIds];
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);
    const next = reorderVisibleCatalogItems(orderedSavedRecords, ids);
    if (!next) return;
    setBusy(true);
    setNotice('');
    try {
      await reorderEquipmentCatalog(projectId,
        activeRecords.map(item => ({ id: item.id, revision: item.revision })),
        next.map(item => item.id));
      setNotice('Đã lưu thứ tự thiết bị lên Cloud cho các tài khoản.');
    } catch (error) {
      setNotice('Chưa thể sắp xếp thiết bị: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  };

  const startNew = (keep?: Pick<EquipmentCatalogInput, 'category' | 'unit'>) => {
    setEditingExisting(false);
    const next = {
      ...EMPTY_EQUIPMENT,
      category: keep?.category || groupOptions[0] || 'Thiết bị',
      unit: keep?.unit || EMPTY_EQUIPMENT.unit,
    };
    setEdit(next);
    setEditBaseline(JSON.stringify(next));
    setCustomGroup(false);
    setOriginalEditUnit('');
    setNotice('');
  };

  const startEdit = (item: EquipmentCatalogInput) => {
    setEditingExisting(true);
    const next = { ...item, displayName: item.displayName || item.name };
    setEdit(next);
    setEditBaseline(JSON.stringify(next));
    setCustomGroup(false);
    setOriginalEditUnit(normalizeUnit(item.unit) || item.unit);
    setNotice('');
  };

  // The equipment master can be populated asynchronously from Cloud, or an
  // equipment may exist only in legacy vouchers. Match canonical name AND unit.
  // Only open edit when uniquely identified and current user may manage it.
  useEffect(() => {
    if (!initialTarget || status !== 'ready' || initialTargetHandled.current) return;
    initialTargetHandled.current = true;
    setSearch(initialTarget.name);
    const requestedName = equipmentIdentityKey(initialTarget.name);
    const requestedUnit = normalizeUnit(initialTarget.unit) || initialTarget.unit;
    const matches = items.filter(item => equipmentIdentityKey(item.name) === requestedName
      && (normalizeUnit(item.unit) || item.unit) === requestedUnit);
    setTargetNotFound(matches.length !== 1);
    if (canManage && matches.length === 1) startEdit(matches[0]);
  }, [initialTarget, status, canManage, items]);

  const save = async (addAnother: boolean) => {
    if (!edit || !canManage || status !== 'ready' || busy) return;
    const equipment = {
      ...edit,
      displayName: editingExisting ? String(edit.displayName ?? edit.name).trim() : String(edit.name || '').trim(),
      name: String(edit.name || '').trim(),
      category: String(edit.category || '').trim(),
      unit: normalizeUnit(edit.unit) || String(edit.unit || '').trim(),
    };
    if (!equipment.name || !equipment.displayName || !equipment.unit || !equipment.category) {
      setNotice('Cần nhập tên, đơn vị tính và nhóm thiết bị trước khi lưu.');
      return;
    }
    if (equipment.id && !records.some(item => item.id === equipment.id)) {
      setNotice('Thiết bị đã thay đổi trên Cloud, vui lòng tải lại.');
      return;
    }
    const existingRecord = equipment.id ? records.find(item => item.id === equipment.id) : undefined;
    const storedUnit = originalEditUnit || existingRecord?.unit || '';
    const changingUnit = editingExisting && Boolean(storedUnit) && !areSameUnit(storedUnit, equipment.unit);
    const hasVouchersLocally = editingHasHistory;
    const equipmentMetadata = {
      displayName: equipment.displayName, category: equipment.category,
      brand: equipment.brand || '', model: equipment.model || '',
      specifications: equipment.specifications || '', notes: equipment.notes || '',
      expectedRevision: existingRecord?.revision,
    };
    // A direct edit to a voucher-backed unit is a *single* confirmed action.
    // The backend migrates vouchers, balances and catalog metadata atomically;
    // never write the new unit through saveEquipmentCatalogBatch.
    const migrateUnit = async (fromUnit: string): Promise<boolean> => {
      if (!onRenameWarehouseUnit) {
        setNotice('Chưa thể đổi ĐVT: thiếu chức năng đồng bộ phiếu kho.');
        return false;
      }
      if (!areSameUnit(fromUnit, storedUnit)) {
        setNotice('ĐVT đã thay đổi trên Cloud. Hãy đóng rồi mở lại thiết bị trước khi sửa.');
        return false;
      }
      const approved = await confirmAsync(
        `Sửa ĐVT thiết bị “${equipment.name}” từ “${fromUnit}” thành “${equipment.unit}”?\n`
        + 'Thao tác này đồng bộ danh mục, phiếu nhập/xuất và số dư trong một giao dịch. '
        + 'Chỉ sửa đơn vị ghi nhầm theo tỷ lệ 1:1, KHÔNG quy đổi số lượng. '
        + 'Nếu Cái và Bộ có số lượng thực tế khác nhau, hãy hủy để đối chiếu trước.',
        { title: 'Xác nhận sửa ĐVT có lịch sử kho', confirmLabel: 'Đồng bộ và lưu', cancelLabel: 'Hủy' },
      );
      if (!approved) {
        setNotice('Chưa thay đổi ĐVT hoặc thông tin thiết bị.');
        return false;
      }
      await onRenameWarehouseUnit({
        kind: 'equipment', materialName: equipment.name,
        fromUnit, toUnit: equipment.unit, equipmentMetadata,
      });
      setEdit(null);
      setNotice(`Đã đồng bộ ĐVT “${fromUnit}” → “${equipment.unit}” và lưu thông tin thiết bị.`);
      return true;
    };
    setBusy(true);
    setNotice('');
    try {
      if (changingUnit && hasVouchersLocally) {
        await migrateUnit(storedUnit);
        return;
      }
      try {
        await saveEquipmentCatalogBatch(projectId, [equipment]);
      } catch (err) {
        // Local cache may miss vouchers that exist on the authoritative server.
        // Treat the typed Cloud guard as proof that this is a migration, not a
        // metadata-only edit. Never discard the user's new unit silently.
        if (changingUnit && err instanceof EquipmentUnitMigrationRequiredError) {
          await migrateUnit(err.storedUnit);
          return;
        }
        throw err;
      }
      if (addAnother && !equipment.id) {
        startNew({ category: equipment.category, unit: equipment.unit });
        setNotice('Đã lưu “' + equipment.name + '”. Bạn có thể thêm thiết bị tiếp theo.');
      } else {
        setEdit(null);
        setNotice('Đã lưu thông tin thiết bị “' + equipment.name + '”.');
      }
    } catch (err) {
      setNotice('Chưa lưu thiết bị: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  const deleteCatalogItems = async (targets: EquipmentCatalogRecord[]) => {
    if (!canManage || busy || status !== 'ready' || !targets.length) return;
    const approved = await confirmAsync(
      'Chuyển ' + targets.length + ' thiết bị vào thùng rác?\n'
      + 'Chỉ xóa thiết bị chưa có lịch sử nhập/xuất (kể cả phiếu đã xóa). '
      + 'Dữ liệu và mã gốc được giữ để khôi phục.',
    );
    if (!approved) return;
    setBusy(true);
    setNotice('');
    try {
      await softDeleteEquipmentCatalogBatch(projectId, targets.map(item => ({
        id: item.id, name: item.name, revision: item.revision,
      })));
      setSelectedEquipmentIds([]);
      setNotice('Đã chuyển ' + targets.length + ' thiết bị vào thùng rác; có thể khôi phục bằng mã gốc.');
    } catch (err) {
      setNotice('Chưa xóa thiết bị: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  const restoreCatalogItem = async (item: EquipmentCatalogRecord) => {
    if (!canManage || busy || status !== 'ready') return;
    if (!(await confirmAsync('Khôi phục thiết bị “' + item.name + '” bằng mã đã lưu?'))) return;
    setBusy(true);
    setNotice('');
    try {
      await restoreEquipmentCatalog(projectId, {
        id: item.id, name: item.name, unit: item.unit, revision: item.revision,
      });
      setNotice('Đã khôi phục thiết bị “' + item.name + '”.');
    } catch (err) {
      setNotice('Chưa khôi phục thiết bị: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-3" data-hnl-equipment-master="true">
    <p className="text-sm leading-relaxed text-slate-600">
      Quản lý thông số thiết bị tại đây. Nhật ký Nhập/Xuất và tồn kho giữ nguyên, không đưa thiết bị vào định mức hao phí vật tư.
    </p>
    {notice && <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{notice}</p>}
    {initialTarget && targetNotFound && status === 'ready' && (
      <p data-hnl-equipment-target-not-found="true" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
        Không xác định được duy nhất “{initialTarget.name}” ({initialTarget.unit}).
        Hãy chọn đúng thiết bị trong danh sách; chưa mở màn hình chỉnh sửa.
      </p>
    )}
    <div className="flex flex-wrap gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <input type="search" className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-2 text-xs"
          placeholder="Tìm tên, nhóm, hãng, model..."
          value={search} onChange={event => setSearch(event.target.value)} />
      </div>
      {canManage && !edit && <AddSourceMenu
        triggerLabel="Thêm thiết bị"
        createLabel="Tạo mới"
        onCreateNew={() => startNew()}
        onOpenSourcePicker={() => setShowEquipmentSourcePicker(true)}
        disabled={status !== 'ready' || busy}
      />}
    </div>

    {status === 'loading' && <p className="text-xs text-slate-500">Đang tải thiết bị...</p>}
    {status === 'error' && <p role="alert" className="text-xs text-rose-700">
      Không tải được thông tin thiết bị: {error}. Chức năng chỉnh sửa được khóa để bảo vệ dữ liệu.
    </p>}

    {edit && <section className="space-y-3.5 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3 sm:p-4" data-hnl-equipment-editor="true">
      <div className="flex items-center justify-between gap-2 border-b border-indigo-100 pb-2">
        <strong className="text-xs font-bold text-slate-900">
          {editingExisting ? (edit.id ? 'Chỉnh thông tin thiết bị' : 'Bổ sung thông tin thiết bị từ phiếu kho') : 'Tạo thiết bị mới'}
        </strong>
        <button type="button" disabled={busy} onClick={() => setEdit(null)}
          aria-label="Đóng thông tin thiết bị" className="rounded-lg p-1.5 text-slate-600 hover:bg-white disabled:opacity-40">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-bold text-slate-700 sm:col-span-2">
          {editingExisting ? 'Tên thiết bị hiển thị' : 'Tên thiết bị'} <span className="text-rose-600">*</span>
          <input value={editingExisting ? (edit.displayName ?? edit.name) : edit.name} disabled={busy}
            onChange={event => setEdit(prev => prev ? (editingExisting
              ? { ...prev, displayName: event.target.value }
              : { ...prev, name: event.target.value, displayName: event.target.value }) : prev)}
            placeholder="Ví dụ: Máy cắt thạch cao" className={FIELD_CLASS} />
          {editingExisting && <span className="mt-1 block text-xs font-normal text-slate-500">
            Tên định danh trên phiếu kho: <strong>{edit.name}</strong>. Việc đổi tên hiển thị không thay đổi mã thiết bị hoặc lịch sử nhập/xuất.
          </span>}
        </label>
        <label className="block text-xs font-bold text-slate-700">
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
          <span className="mt-1 block text-xs font-normal text-slate-500">
            Nhóm mới sẽ xuất hiện trong danh sách chọn sau khi lưu thiết bị.
          </span>
        </label>
        <label className="block text-xs font-bold text-slate-700">
          Đơn vị tính <span className="text-rose-600">*</span>
          <input value={edit.unit} disabled={busy}
            onChange={event => setEdit(prev => prev ? { ...prev, unit: event.target.value } : prev)}
            placeholder="Cái, Bộ, Chiếc..." className={FIELD_CLASS} />
        </label>
        {([
          ['brand', 'Hãng sản xuất', 'Ví dụ: Bosch'],
          ['model', 'Model / Mã hiệu', 'Ví dụ: GWS 750'],
        ] as const).map(([key, label, placeholder]) =>
          <label key={key} className="block text-xs font-bold text-slate-700">
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
          <label key={key} className="block text-xs font-bold text-slate-700 sm:col-span-2">
            {label}
            <textarea value={edit[key] || ''} disabled={busy} rows={2}
              onChange={event => setEdit(prev => prev ? { ...prev, [key]: event.target.value } : prev)}
              className={TEXTAREA_CLASS} />
          </label>
        )}
      </div>

      {editingExisting && editingHistoricalUnits.length > 1 && <p className="text-sm font-semibold text-amber-800">
        Chú ý: phiếu kho của thiết bị này đang có nhiều ĐVT ({editingHistoricalUnits.join(', ')}). Chỉ sửa tên hiển thị / thông tin; các ĐVT kho vẫn được giữ riêng, không tự gộp hoặc quy đổi.
      </p>}
      {editingExisting && <p className="flex items-start gap-2 text-sm text-amber-800" data-hnl-equipment-unit-guidance="true">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {editingHasHistory
          ? 'Có phiếu kho: sửa ngay tại Đơn vị tính rồi bấm Lưu thay đổi. Hệ thống sẽ yêu cầu xác nhận và chỉ đồng bộ 1:1 khi phiếu/số dư hợp lệ. Nếu Cái và Bộ khác nhau thực tế hoặc có nhiều ĐVT lịch sử, cần đối chiếu trước.'
          : 'Có thể sửa Đơn vị tính trực tiếp tại ô trên. Nếu Cloud phát hiện phiếu cũ, hệ thống sẽ yêu cầu xác nhận đồng bộ an toàn trước khi lưu.'}
      </p>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-indigo-100 pt-3">
        <button type="button" disabled={busy} onClick={() => setEdit(null)}
          className="min-h-10 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">
          Hủy
        </button>
        <button type="button" disabled={busy || status !== 'ready'} onClick={() => { void save(false); }}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-indigo-300 bg-white px-4 py-2 text-xs font-bold text-indigo-700 disabled:opacity-40">
          <Save className="h-4 w-4" /> {editingExisting ? 'Lưu thay đổi' : 'Lưu'}
        </button>
        {!editingExisting && <button type="button" disabled={busy || status !== 'ready'} onClick={() => { void save(true); }}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
          <Plus className="h-4 w-4" /> Lưu &amp; thêm tiếp
        </button>}
      </div>
    </section>}

    {status === 'ready' && !edit && <div className="space-y-2">
      <QuickSortBar
        itemCount={items.length}
        options={[
          { key: 'name', label: 'Tên thiết bị', kind: 'alpha', defaultOrder: 'asc' },
          { key: 'category', label: 'Nhóm thiết bị', kind: 'alpha', defaultOrder: 'asc' },
          { key: 'unit', label: 'ĐVT', kind: 'alpha', defaultOrder: 'asc' },
          { key: 'brand', label: 'Hãng sản xuất', kind: 'alpha', defaultOrder: 'asc' },
        ]}
        activeKey={equipmentSortBy === 'none' ? null : equipmentSortBy}
        order={equipmentSortOrder}
        onChange={(key, order) => { setEquipmentSortBy(key); setEquipmentSortOrder(order); }}
        onToggleOrder={() => setEquipmentSortOrder(value => value === 'asc' ? 'desc' : 'asc')}
        onReset={() => { setEquipmentSortBy('none'); setEquipmentSortOrder('asc'); }}
      />
      {canManage && equipmentSortBy === 'none' && orderedSavedRecords.length > 1 && orderedSavedRecords.length <= 100 && (
        <p className="text-[11px] text-slate-500">Sắp xếp thủ công: kéo-thả trên PC hoặc bấm mũi tên lên/xuống. Vị trí được lưu trên Cloud.</p>
      )}
      {canManage && equipmentSortBy !== 'none' && (
        <p className="text-[11px] text-slate-500">Tắt Sắp xếp nhanh để thay đổi vị trí thủ công, thứ tự Cloud đã lưu vẫn được giữ.</p>
      )}
      {canManage && orderedSavedRecords.length > 100 && (
        <p className="text-sm text-amber-700">Danh mục có hơn 100 thiết bị: khóa sắp xếp hàng loạt để tránh ghi Cloud không nguyên tử.</p>
      )}
      {canManage && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
          <input type="checkbox" disabled={busy || deletableVisibleItems.length === 0}
            checked={deletableVisibleItems.length > 0 && deletableVisibleItems.every(item => selectedEquipmentIds.includes(item.id!))}
            onChange={event => {
              const visible = deletableVisibleItems.map(item => item.id!);
              setSelectedEquipmentIds(previous => event.target.checked
                ? Array.from(new Set([...previous, ...visible]))
                : previous.filter(id => !visible.includes(id)));
            }}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
          Chọn tất cả ({deletableVisibleItems.length})
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {selectedVisibleItems.length > 0 && <button type="button" disabled={busy}
            onClick={() => { void deleteCatalogItems(activeRecords.filter(record =>
              selectedVisibleItems.some(item => item.id === record.id))); }}
            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-bold text-rose-700 disabled:opacity-40">
            <Trash2 className="h-4 w-4" /> Xóa đã chọn ({selectedVisibleItems.length})
          </button>}
          {deletedRecords.length > 0 && <button type="button" disabled={busy}
            onClick={() => setShowDeleted(previous => !previous)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700">
            <RotateCcw className="h-4 w-4" /> Thùng rác ({deletedRecords.length})
          </button>}
        </div>
      </div>}
      <div className="max-h-[44vh] space-y-2 overflow-y-auto">
        {items.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500">
          Chưa có thiết bị. ADMIN có thể thêm thiết bị trước khi nhập kho.
        </p>}
        {items.map(item => {
          const historyProtected = historicalNames.has(equipmentIdentityKey(item.name));
          const deletable = Boolean(item.id) && !historyProtected;
          const target = item.id ? activeRecords.find(record => record.id === item.id) : undefined;
          return <div key={item.id || equipmentIdentityKey(item.name)}
            draggable={canReorderEquipment && Boolean(item.id)}
            onDragStart={() => { if (item.id) setDraggedEquipmentId(item.id); }}
            onDragEnd={() => setDraggedEquipmentId(null)}
            onDragOver={event => { if (canReorderEquipment && item.id && draggedEquipmentId) event.preventDefault(); }}
            onDrop={event => {
              event.preventDefault();
              if (item.id && draggedEquipmentId) void moveVisibleEquipment(draggedEquipmentId, item.id);
              setDraggedEquipmentId(null);
            }}
            className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3">
            {canManage && <input type="checkbox"
              aria-label={'Chọn thiết bị ' + item.name}
              disabled={busy || !deletable}
              title={!deletable ? 'Chỉ được xóa thiết bị đã lưu, không có phiếu kho' : 'Chọn để xóa'}
              checked={Boolean(item.id && selectedEquipmentIds.includes(item.id))}
              onChange={event => setSelectedEquipmentIds(previous =>
                event.target.checked ? (previous.includes(item.id!) ? previous : [...previous, item.id!])
                  : previous.filter(id => id !== item.id))}
              className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600" />}
            <div className="min-w-0 flex-1">
              <p className="break-words text-xs font-extrabold text-slate-900">{item.displayName || item.name} · {item.unit}</p>
              {item.displayName && item.displayName !== item.name && <p className="text-[10px] text-slate-500">Tên phiếu kho: {item.name}</p>}
              <p className="text-[11px] text-slate-600">
                {item.category || 'Thiết bị'}{item.brand ? ' · ' + item.brand : ''}{item.model ? ' · ' + item.model : ''}
              </p>
              {item.specifications && <p className="break-words text-[11px] text-slate-600">{item.specifications}</p>}
              {!item.id && <p className="text-[10px] text-amber-700">Phiếu lịch sử: chưa có thông số thiết bị</p>}
            </div>
            {canManage && <div className="flex shrink-0 items-start gap-1">
              {canReorderEquipment && item.id && <MoveOrderControls
                label={'Sắp xếp ' + item.name}
                showDragHandle
                onMoveUp={() => {
                  const index = visibleSavedIds.indexOf(item.id!);
                  if (index > 0) void moveVisibleEquipment(item.id!, visibleSavedIds[index - 1]);
                }}
                onMoveDown={() => {
                  const index = visibleSavedIds.indexOf(item.id!);
                  if (index >= 0 && index + 1 < visibleSavedIds.length)
                    void moveVisibleEquipment(item.id!, visibleSavedIds[index + 1]);
                }}
                disableUp={visibleSavedIds[0] === item.id}
                disableDown={visibleSavedIds[visibleSavedIds.length - 1] === item.id}
              />}
              <button type="button" disabled={busy} onClick={() => startEdit(item)}
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-indigo-700 transition-colors hover:bg-indigo-50 hover:text-indigo-800 disabled:opacity-40"
                title="Sửa thông tin thiết bị" aria-label={'Sửa thiết bị ' + item.name}>
                <Edit3 className="h-3.5 w-3.5" />
              </button>
              <button type="button" disabled={busy || !deletable || !target}
                onClick={() => { if (target) void deleteCatalogItems([target]); }}
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"
                title={deletable ? 'Chuyển thiết bị vào thùng rác' : 'Không thể xóa thiết bị có lịch sử phiếu kho'}
                aria-label={'Xóa thiết bị ' + item.name}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>}
          </div>;
        })}
      </div>
      {canManage && showDeleted && deletedRecords.length > 0 && <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <h3 className="text-xs font-extrabold text-amber-900">Thiết bị đã xóa (giữ mã gốc)</h3>
        {deletedRecords.map(item => <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-white p-2">
          <span className="min-w-0 break-words text-xs text-slate-700">{item.displayName || item.name} · {item.unit}</span>
          <button type="button" disabled={busy} onClick={() => { void restoreCatalogItem(item); }}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-200 px-2 py-1.5 text-xs font-bold text-amber-800 disabled:opacity-40">
            <RotateCcw className="h-3.5 w-3.5" /> Khôi phục
          </button>
        </div>)}
      </section>}
    </div>}
    <CatalogTemplatePickerModal
      open={showEquipmentSourcePicker && canManage}
      onClose={() => setShowEquipmentSourcePicker(false)}
      currentProjectId={projectId}
      currentItems={activeRecords.map(item => ({
        id: item.id, name: item.name, displayName: item.displayName || item.name, unit: item.unit, category: item.category,
        brand: item.brand, model: item.model, specifications: item.specifications, notes: item.notes,
      }))}
      kind="equipment"
      title="Lấy thiết bị từ công trình/mẫu"
      onImport={async (rows) => {
        if (!canManage || status !== 'ready' || busy) throw new Error('Chỉ ADMIN có thể thêm thiết bị khi dữ liệu Cloud sẵn sàng.');
        if (!rows.length) return;
        const seen = new Set<string>();
        const existing = new Set(records.map(item => equipmentIdentityKey(item.name)));
        const unique: EquipmentCatalogInput[] = [];
        let skipped = 0;
        rows.forEach(row => {
          const source = row.item as Partial<EquipmentCatalogInput>;
          const name = String(source.name || '').trim();
          const identity = equipmentIdentityKey(name);
          if (!name || !String(source.unit || '').trim() || !identity || seen.has(identity) || existing.has(identity)) {
            skipped += 1;
            return;
          }
          seen.add(identity);
          unique.push({
            name, displayName: String(source.displayName || name).trim(), unit: String(source.unit).trim(), category: String(source.category || 'Thiết bị').trim(),
            brand: String(source.brand || ''), model: String(source.model || ''),
            specifications: String(source.specifications || ''), notes: String(source.notes || ''),
          });
        });
        if (unique.length > 50) throw new Error('Mỗi lần lấy tối đa 50 thiết bị. Hãy chọn ít mục hơn.');
        if (!unique.length) {
          setNotice('Không có thiết bị mới để thêm; các tên trùng hoặc không hợp lệ đã được bỏ qua.');
          return;
        }
        setBusy(true);
        try {
          // Save is an admin-only Firestore transaction and revalidates names/units
          // against the target server ledger; never copy source IDs/revisions.
          await saveEquipmentCatalogBatch(projectId, unique);
          setNotice('Đã lấy ' + unique.length + ' thiết bị mới vào danh mục.'
            + (skipped ? ' Bỏ qua ' + skipped + ' thiết bị trùng/không hợp lệ.' : ''));
        } finally {
          setBusy(false);
        }
      }}
    />
  </div>;
};
