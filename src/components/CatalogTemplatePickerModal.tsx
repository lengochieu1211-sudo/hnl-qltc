import React from 'react';
import { X, Search, Download, FolderOpen } from 'lucide-react';
import { fetchCurrentUserProjectsFromCloud, fetchProjectFromCloud, getCloudPayload, fetchUserCatalogTemplates, saveUserCatalogTemplate, deleteUserCatalogTemplate, type UserCatalogTemplate } from '../lib/firebaseBase';

export type CatalogTemplateKind = 'workVolumes' | 'teams' | 'materialNorms';

interface BasketItem {
  key: string;
  sourceProjectId: string;
  sourceProjectName: string;
  item: any;
}

interface CatalogTemplatePickerModalProps {
  open: boolean;
  onClose: () => void;
  currentProjectId?: string;
  kind: CatalogTemplateKind;
  title: string;
  onImport: (items: BasketItem[]) => void | Promise<void>;
}

const itemLabel = (kind: CatalogTemplateKind, item: any) => {
  if (kind === 'workVolumes') return String(item?.title || item?.name || item?.id || '');
  if (kind === 'teams') return String(item?.name || item?.leader || item?.id || '');
  return String(item?.materialName || item?.name || item?.id || '');
};

const itemMeta = (kind: CatalogTemplateKind, item: any) => {
  if (kind === 'workVolumes') return [item?.category, item?.unit].filter(Boolean).join(' · ');
  if (kind === 'teams') return [item?.leader, item?.phone].filter(Boolean).join(' · ');
  const categories = Array.isArray(item?.workCategories) ? item.workCategories : (item?.workCategory ? [item.workCategory] : []);
  return [item?.unit, ...categories.slice(0, 2)].filter(Boolean).join(' · ');
};

export const CatalogTemplatePickerModal: React.FC<CatalogTemplatePickerModalProps> = ({
  open,
  onClose,
  currentProjectId,
  kind,
  title,
  onImport,
}) => {
  const [projects, setProjects] = React.useState<Array<{ id: string; name: string }>>([]);
  const [templates, setTemplates] = React.useState<UserCatalogTemplate[]>([]);
  const [sourceProjectId, setSourceProjectId] = React.useState('');
  const [sourceItems, setSourceItems] = React.useState<any[]>([]);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [basket, setBasket] = React.useState<BasketItem[]>([]);
  const [search, setSearch] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setLoading(true);
    Promise.all([fetchCurrentUserProjectsFromCloud(), fetchUserCatalogTemplates()])
      .then(([rows, savedTemplates]) => {
        const visible = rows.filter((project) => project.id !== currentProjectId);
        const matchingTemplates = savedTemplates.filter((template) => template.kind === kind);
        setProjects(visible);
        setTemplates(matchingTemplates);
        setSourceProjectId((current) => {
          if (current && (visible.some((project) => project.id === current) || matchingTemplates.some((template) => `template:${template.id}` === current))) return current;
          return visible[0]?.id || (matchingTemplates[0] ? `template:${matchingTemplates[0].id}` : '');
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Không đọc được danh sách công trình/mẫu.'))
      .finally(() => setLoading(false));
  }, [open, currentProjectId]);

  React.useEffect(() => {
    if (!open || !sourceProjectId) {
      setSourceItems([]);
      setSelectedIds([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    const savedTemplate = sourceProjectId.startsWith('template:')
      ? templates.find((template) => `template:${template.id}` === sourceProjectId)
      : undefined;
    const sourcePromise = savedTemplate
      ? Promise.resolve(savedTemplate.items)
      : fetchProjectFromCloud(sourceProjectId, { serverOnly: true }).then((record) => {
          if (!record) throw new Error('Không đọc được công trình nguồn hoặc bạn không còn quyền.');
          const payload: any = getCloudPayload(record);
          return Array.isArray(payload?.[kind]) ? payload[kind].filter((item: any) => item && item.deleted !== true && !item.deletedAt) : [];
        });
    sourcePromise
      .then((rows) => {
        if (cancelled) return;
        setSourceItems(rows);
        setSelectedIds([]);
      })
      .catch((err) => {
        if (!cancelled) {
          setSourceItems([]);
          setError(err instanceof Error ? err.message : 'Không đọc được dữ liệu mẫu.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, sourceProjectId, kind, templates]);

  React.useEffect(() => {
    if (!open) {
      setBasket([]);
      setSelectedIds([]);
      setSearch('');
      setError('');
    }
  }, [open]);

  if (!open) return null;

  const activeTemplate = sourceProjectId.startsWith('template:') ? templates.find((template) => `template:${template.id}` === sourceProjectId) : undefined;
  const sourceName = activeTemplate?.name || projects.find((project) => project.id === sourceProjectId)?.name || sourceProjectId;
  const query = search.trim().toLocaleLowerCase('vi-VN');
  const filteredItems = sourceItems.filter((item) => {
    if (!query) return true;
    return `${itemLabel(kind, item)} ${itemMeta(kind, item)}`.toLocaleLowerCase('vi-VN').includes(query);
  });
  const selectedSet = new Set(selectedIds);
  const allVisibleSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedSet.has(String(item.id)));

  const addSelectedToBasket = () => {
    const next = new Map(basket.map((row) => [row.key, row] as const));
    sourceItems.filter((item) => selectedSet.has(String(item.id))).forEach((item) => {
      const key = `${sourceProjectId}::${String(item.id)}`;
      next.set(key, { key, sourceProjectId, sourceProjectName: sourceName, item });
    });
    setBasket(Array.from(next.values()));
    setSelectedIds([]);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-3">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-sm font-black text-slate-900">{title}</h3>
            <p className="mt-0.5 text-[10px] text-slate-500">Có thể chọn từ nhiều công trình: thêm mục vào giỏ, đổi công trình nguồn rồi chọn tiếp.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-4 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex min-h-0 flex-col gap-2">
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
              <select value={sourceProjectId} onChange={(e) => setSourceProjectId(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold">
                {projects.length === 0 && templates.length === 0 && <option value="">Không có công trình/mẫu nguồn</option>}
                {projects.length > 0 && <optgroup label="Công trình khác">{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</optgroup>}
                {templates.length > 0 && <optgroup label="Mẫu đã lưu">{templates.map((template) => <option key={template.id} value={`template:${template.id}`}>★ {template.name}</option>)}</optgroup>}
              </select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm trong công trình nguồn..." className="w-full rounded-xl border border-slate-300 py-2 pl-8 pr-3 text-xs" />
              </div>
            </div>

            {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">{error}</div>}

            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200">
              <label className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-extrabold text-slate-700">
                <input type="checkbox" checked={allVisibleSelected} onChange={(e) => {
                  const next = new Set(selectedIds);
                  filteredItems.forEach((item) => e.target.checked ? next.add(String(item.id)) : next.delete(String(item.id)));
                  setSelectedIds(Array.from(next));
                }} />
                Chọn tất cả đang hiển thị · {filteredItems.length}
              </label>
              {loading ? (
                <div className="p-6 text-center text-xs text-slate-500">Đang đọc dữ liệu nguồn…</div>
              ) : filteredItems.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">Không có dữ liệu phù hợp.</div>
              ) : filteredItems.map((item) => (
                <label key={String(item.id)} className="flex cursor-pointer items-start gap-2 border-b border-slate-100 px-3 py-2.5 hover:bg-indigo-50/40">
                  <input type="checkbox" checked={selectedSet.has(String(item.id))} onChange={(e) => {
                    const next = new Set(selectedIds);
                    e.target.checked ? next.add(String(item.id)) : next.delete(String(item.id));
                    setSelectedIds(Array.from(next));
                  }} className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-extrabold text-slate-900">{itemLabel(kind, item)}</div>
                    <div className="mt-0.5 truncate text-[10px] text-slate-500">{itemMeta(kind, item) || 'Không có ghi chú bổ sung'}</div>
                  </div>
                </label>
              ))}
            </div>
            <button type="button" disabled={selectedIds.length === 0} onClick={addSelectedToBasket} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
              <FolderOpen className="h-4 w-4" /> Thêm {selectedIds.length || ''} mục vào giỏ
            </button>
          </div>

          <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-slate-50/70">
            <div className="border-b border-slate-200 px-3 py-2 text-[11px] font-black text-slate-800">Đã chọn từ nhiều công trình · {basket.length}</div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {basket.length === 0 ? <div className="p-4 text-center text-[10px] text-slate-500">Chưa có mục nào trong giỏ.</div> : basket.map((row) => (
                <div key={row.key} className="mb-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-extrabold text-slate-800">{itemLabel(kind, row.item)}</div>
                      <div className="truncate text-[9px] text-slate-500">{row.sourceProjectName}</div>
                    </div>
                    <button type="button" onClick={() => setBasket((current) => current.filter((item) => item.key !== row.key))} className="text-slate-400 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[10px] text-slate-500">Công trình nguồn đọc trực tiếp từ Cloud. “Mẫu đã lưu” được đồng bộ trong hồ sơ Google của bạn và giới hạn 40 mục/mẫu để tránh phình dữ liệu.</div>
          <div className="flex shrink-0 items-center gap-2">
            {activeTemplate && (
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm(`Xóa mẫu “${activeTemplate.name}”? Dữ liệu công trình không bị ảnh hưởng.`)) return;
                  await deleteUserCatalogTemplate(activeTemplate.id);
                  const next = templates.filter((template) => template.id !== activeTemplate.id);
                  setTemplates(next);
                  setSourceProjectId(projects[0]?.id || (next[0] ? `template:${next[0].id}` : ''));
                }}
                className="rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] font-bold text-rose-700"
              >
                Xóa mẫu
              </button>
            )}
            <button
              type="button"
              disabled={basket.length === 0}
              onClick={async () => {
                const name = window.prompt('Tên mẫu muốn lưu:', `Mẫu ${title.replace(/^Lấy\s+/i, '')}`);
                if (!name?.trim()) return;
                const saved = await saveUserCatalogTemplate({ name: name.trim(), kind, items: basket.map((row) => row.item) });
                setTemplates((current) => [saved, ...current.filter((template) => template.id !== saved.id)]);
                setSourceProjectId(`template:${saved.id}`);
              }}
              className="rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-2 text-[11px] font-bold text-indigo-700 disabled:opacity-40"
            >
              Lưu giỏ thành mẫu
            </button>
            <button type="button" disabled={basket.length === 0} onClick={async () => { await onImport(basket); onClose(); }} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40">
              <Download className="h-4 w-4" /> Lấy {basket.length || ''} mục
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
