import React from 'react';
import { BookOpen, Plus, Save, Trash2 } from 'lucide-react';
import {
  deleteUserCatalogTemplate,
  deleteUserCatalogTemplates,
  fetchUserCatalogTemplates,
  saveUserCatalogTemplate,
  type UserCatalogTemplate,
  type UserCatalogTemplateKind,
} from '../lib/firebaseBase';
import { confirmAsync } from '../utils/confirmAsync';

type FieldDef = { key: string; label: string; type?: 'text' | 'number' };

const KIND_OPTIONS: Array<{ id: UserCatalogTemplateKind; label: string }> = [
  { id: 'teams', label: 'Đội thi công' },
  { id: 'workVolumes', label: 'Hạng mục thi công' },
  { id: 'materialNorms', label: 'Định mức vật tư' },
  { id: 'materials', label: 'Vật tư' },
  { id: 'equipment', label: 'Thiết bị' },
];

const FIELDS: Record<UserCatalogTemplateKind, FieldDef[]> = {
  teams: [
    { key: 'name', label: 'Tên đội' },
    { key: 'leader', label: 'Đội trưởng' },
    { key: 'phone', label: 'SĐT' },
    { key: 'defaultCount', label: 'Quân số định biên', type: 'number' },
    { key: 'notes', label: 'Ghi chú' },
  ],
  workVolumes: [
    { key: 'title', label: 'Hạng mục' },
    { key: 'category', label: 'Nhóm' },
    { key: 'unit', label: 'ĐVT' },
  ],
  materialNorms: [
    { key: 'materialName', label: 'Tên vật tư' },
    { key: 'category', label: 'Nhóm' },
    { key: 'unit', label: 'ĐVT' },
    { key: 'quotaQuantity', label: 'Định mức chung', type: 'number' },
  ],
  materials: [
    { key: 'materialName', label: 'Tên vật tư' },
    { key: 'category', label: 'Nhóm' },
    { key: 'unit', label: 'ĐVT' },
  ],
  equipment: [
    { key: 'materialName', label: 'Tên thiết bị' },
    { key: 'unit', label: 'ĐVT' },
    { key: 'notes', label: 'Ghi chú' },
  ],
};

const makeItemId = () => `template-item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getItemLabel = (kind: UserCatalogTemplateKind, item: any): string => {
  if (kind === 'teams') return String(item?.name || item?.leader || 'Mục chưa đặt tên');
  if (kind === 'workVolumes') return String(item?.title || item?.category || 'Mục chưa đặt tên');
  return String(item?.materialName || item?.name || 'Mục chưa đặt tên');
};

const cloneTemplate = (template: UserCatalogTemplate): UserCatalogTemplate =>
  JSON.parse(JSON.stringify(template));

export const CatalogTemplateManager: React.FC = () => {
  const [templates, setTemplates] = React.useState<UserCatalogTemplate[]>([]);
  const [selectedKind, setSelectedKind] = React.useState<UserCatalogTemplateKind>('teams');
  const [selectedTemplateId, setSelectedTemplateId] = React.useState('');
  const [selectedTemplateIds, setSelectedTemplateIds] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState<UserCatalogTemplate | null>(null);
  const [selectedItemIds, setSelectedItemIds] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const reload = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await fetchUserCatalogTemplates();
      setTemplates(rows);
      const visible = rows.filter((row) => row.kind === selectedKind);
      setSelectedTemplateId((current) =>
        current && visible.some((row) => row.id === current) ? current : (visible[0]?.id || '')
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không đọc được danh sách mẫu.');
    } finally {
      setLoading(false);
    }
  }, [selectedKind]);

  React.useEffect(() => { void reload(); }, [reload]);

  const visibleTemplates = React.useMemo(
    () => templates.filter((template) => template.kind === selectedKind),
    [templates, selectedKind],
  );

  React.useEffect(() => {
    const current = templates.find((template) => template.id === selectedTemplateId);
    setDraft(current ? cloneTemplate(current) : null);
    setSelectedItemIds([]);
  }, [templates, selectedTemplateId]);

  React.useEffect(() => {
    const visible = templates.filter((template) => template.kind === selectedKind);
    setSelectedTemplateIds([]);
    setSelectedTemplateId((current) =>
      current && visible.some((row) => row.id === current) ? current : (visible[0]?.id || '')
    );
  }, [selectedKind, templates]);

  const createTemplate = async () => {
    const name = window.prompt('Tên mẫu mới:', `Mẫu ${KIND_OPTIONS.find((item) => item.id === selectedKind)?.label || ''}`);
    if (!name?.trim()) return;
    setSaving(true);
    try {
      const saved = await saveUserCatalogTemplate({ name: name.trim(), kind: selectedKind, items: [] });
      setTemplates((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setSelectedTemplateId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được mẫu.');
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError('Tên mẫu không được để trống.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await saveUserCatalogTemplate({
        id: draft.id,
        name: draft.name.trim(),
        kind: draft.kind,
        items: draft.items,
      });
      setTemplates((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setSelectedTemplateId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được thay đổi mẫu.');
    } finally {
      setSaving(false);
    }
  };

  const deleteOne = async (template: UserCatalogTemplate) => {
    if (!await confirmAsync(`Xóa mẫu “${template.name}”? Dữ liệu đã lấy vào công trình sẽ không bị xóa.`)) return;
    setSaving(true);
    try {
      await deleteUserCatalogTemplate(template.id);
      const next = templates.filter((item) => item.id !== template.id);
      setTemplates(next);
      setSelectedTemplateId(next.find((item) => item.kind === selectedKind)?.id || '');
      setSelectedTemplateIds((current) => current.filter((id) => id !== template.id));
    } finally {
      setSaving(false);
    }
  };

  const deleteSelectedTemplates = async () => {
    const ids = selectedTemplateIds.filter((id) => visibleTemplates.some((item) => item.id === id));
    if (!ids.length) return;
    if (!await confirmAsync(`Xóa ${ids.length} mẫu đã chọn? Dữ liệu đã lấy vào công trình sẽ giữ nguyên.`)) return;
    setSaving(true);
    try {
      await deleteUserCatalogTemplates(ids);
      const idSet = new Set(ids);
      const next = templates.filter((item) => !idSet.has(item.id));
      setTemplates(next);
      setSelectedTemplateIds([]);
      setSelectedTemplateId(next.find((item) => item.kind === selectedKind)?.id || '');
    } finally {
      setSaving(false);
    }
  };

  const updateDraftItem = (itemId: string, key: string, value: string, type?: 'text' | 'number') => {
    setDraft((current) => current ? {
      ...current,
      items: current.items.map((item: any) =>
        String(item?.id) === itemId
          ? { ...item, [key]: type === 'number' ? Math.max(0, Number(value || 0)) : value }
          : item
      ),
    } : current);
  };

  const addDraftItem = () => {
    const fields = FIELDS[selectedKind];
    const item: any = { id: makeItemId() };
    fields.forEach((field) => { item[field.key] = field.type === 'number' ? 0 : ''; });
    setDraft((current) => current ? { ...current, items: [...current.items, item] } : current);
  };

  const deleteSelectedItems = () => {
    if (!draft || !selectedItemIds.length) return;
    const ids = new Set(selectedItemIds);
    setDraft({ ...draft, items: draft.items.filter((item: any) => !ids.has(String(item?.id))) });
    setSelectedItemIds([]);
  };

  const allTemplatesSelected = visibleTemplates.length > 0 && visibleTemplates.every((item) => selectedTemplateIds.includes(item.id));
  const allItemsSelected = Boolean(draft?.items.length) && draft!.items.every((item: any) => selectedItemIds.includes(String(item?.id)));

  return (
    <div className="space-y-3" data-hnl-template-manager>
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-[10px] text-indigo-900">
        Mẫu cá nhân được lưu theo tài khoản Google hiện tại. Bạn được sửa/xóa mẫu của chính mình.
        Sửa hoặc xóa mẫu không thay đổi dữ liệu đã lấy vào các công trình trước đó.
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {KIND_OPTIONS.map((kind) => (
          <button
            type="button"
            key={kind.id}
            onClick={() => setSelectedKind(kind.id)}
            style={{ touchAction: 'manipulation' }}
            className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold active:scale-[0.97] ${selectedKind === kind.id ? 'border-indigo-300 bg-indigo-100 text-indigo-800' : 'border-slate-200 bg-white text-slate-600'}`}
          >
            {kind.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-semibold text-rose-700">{error}</div>}

      <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-2.5">
            <label className="flex items-center gap-2 text-[10px] font-bold text-slate-700">
              <input
                type="checkbox"
                checked={allTemplatesSelected}
                onChange={(event) => setSelectedTemplateIds(event.target.checked ? visibleTemplates.map((item) => item.id) : [])}
              />
              Chọn tất cả
            </label>
            <button
              type="button"
              onClick={() => void createTemplate()}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1.5 text-[10px] font-bold text-white disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Mẫu mới
            </button>
          </div>

          {selectedTemplateIds.length > 0 && (
            <button
              type="button"
              onClick={() => void deleteSelectedTemplates()}
              className="m-2 inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] font-bold text-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" /> Xóa đã chọn ({selectedTemplateIds.length})
            </button>
          )}

          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-[10px] text-slate-500">Đang đọc mẫu…</div>
            ) : visibleTemplates.length === 0 ? (
              <div className="p-4 text-center text-[10px] text-slate-500">Chưa có mẫu loại này.</div>
            ) : visibleTemplates.map((template) => (
              <div key={template.id} className={`flex items-center gap-2 border-b border-slate-100 px-2.5 py-2 ${selectedTemplateId === template.id ? 'bg-indigo-50' : 'bg-white'}`}>
                <input
                  type="checkbox"
                  checked={selectedTemplateIds.includes(template.id)}
                  onChange={(event) => setSelectedTemplateIds((current) =>
                    event.target.checked ? [...new Set([...current, template.id])] : current.filter((id) => id !== template.id)
                  )}
                />
                <button
                  type="button"
                  onClick={() => setSelectedTemplateId(template.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-[11px] font-extrabold text-slate-800">{template.name}</div>
                  <div className="text-[9px] text-slate-500">{template.items.length} mục</div>
                </button>
                <button type="button" onClick={() => void deleteOne(template)} title="Xóa mẫu" className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          {!draft ? (
            <div className="flex min-h-40 flex-col items-center justify-center text-center text-[10px] text-slate-500">
              <BookOpen className="mb-2 h-6 w-6 text-slate-300" />
              Chọn một mẫu để chỉnh sửa.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1 text-[10px] font-bold text-slate-700">
                  Tên mẫu
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" /> Lưu thay đổi
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
                <label className="flex items-center gap-2 text-[10px] font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={allItemsSelected}
                    onChange={(event) => setSelectedItemIds(event.target.checked ? draft.items.map((item: any) => String(item?.id)) : [])}
                  />
                  Chọn tất cả mục ({draft.items.length})
                </label>
                <div className="flex gap-2">
                  {selectedItemIds.length > 0 && (
                    <button type="button" onClick={deleteSelectedItems} className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700">
                      <Trash2 className="h-3.5 w-3.5" /> Xóa mục đã chọn ({selectedItemIds.length})
                    </button>
                  )}
                  <button type="button" onClick={addDraftItem} className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700">
                    <Plus className="h-3.5 w-3.5" /> Thêm mục
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {draft.items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-[10px] text-slate-500">Mẫu đang trống.</div>
                ) : draft.items.map((item: any, index) => {
                  const itemId = String(item?.id || `draft-${index}`);
                  return (
                    <div key={itemId} className="rounded-xl border border-slate-200 p-2.5">
                      <div className="mb-2 flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedItemIds.includes(itemId)}
                          onChange={(event) => setSelectedItemIds((current) =>
                            event.target.checked ? [...new Set([...current, itemId])] : current.filter((id) => id !== itemId)
                          )}
                        />
                        <div className="min-w-0 flex-1 truncate text-[10px] font-extrabold text-slate-800">{getItemLabel(draft.kind, item)}</div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {FIELDS[draft.kind].map((field) => (
                          <label key={field.key} className="text-[9px] font-bold text-slate-600">
                            {field.label}
                            <input
                              type={field.type === 'number' ? 'number' : 'text'}
                              min={field.type === 'number' ? 0 : undefined}
                              value={item?.[field.key] ?? (field.type === 'number' ? 0 : '')}
                              onChange={(event) => updateDraftItem(itemId, field.key, event.target.value, field.type)}
                              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[10px] text-slate-800"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
