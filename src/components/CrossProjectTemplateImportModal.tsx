import React, { useEffect, useMemo, useState } from 'react';

export interface TemplateProjectOption {
  id: string;
  name: string;
}

export interface TemplateSourceSnapshot {
  projectId: string;
  projectName: string;
  workVolumes?: any[];
  teams?: any[];
  materialNorms?: any[];
}

export interface TemplateSelection<T = any> {
  projectId: string;
  projectName: string;
  item: T;
  snapshot: TemplateSourceSnapshot;
}

interface CrossProjectTemplateImportModalProps<T = any> {
  open: boolean;
  title: string;
  entityLabel: string;
  currentProjectId: string;
  projects: TemplateProjectOption[];
  loadProject: (projectId: string) => Promise<TemplateSourceSnapshot>;
  getItems: (snapshot: TemplateSourceSnapshot) => T[];
  getItemId: (item: T) => string;
  getItemLabel: (item: T) => string;
  getItemDetail?: (item: T) => string;
  onClose: () => void;
  onImport: (selected: TemplateSelection<T>[]) => void | Promise<void>;
}

export function CrossProjectTemplateImportModal<T = any>({
  open,
  title,
  entityLabel,
  currentProjectId,
  projects,
  loadProject,
  getItems,
  getItemId,
  getItemLabel,
  getItemDetail,
  onClose,
  onImport,
}: CrossProjectTemplateImportModalProps<T>) {
  const availableProjects = useMemo(
    () => projects.filter((project) => project.id && project.id !== currentProjectId),
    [projects, currentProjectId],
  );
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, TemplateSourceSnapshot>>({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setSelectedProjectIds([]);
      setSnapshots({});
      setSelectedKeys(new Set());
      setError('');
    }
  }, [open]);

  if (!open) return null;

  const rows = selectedProjectIds.flatMap((projectId) => {
    const snapshot = snapshots[projectId];
    if (!snapshot) return [];
    return getItems(snapshot).map((item) => ({
      key: `${projectId}::${getItemId(item)}`,
      projectId,
      projectName: snapshot.projectName,
      item,
      snapshot,
    }));
  });

  const loadSelectedProjects = async (nextIds: string[]) => {
    setSelectedProjectIds(nextIds);
    const missing = nextIds.filter((id) => !snapshots[id]);
    if (!missing.length) return;
    setLoading(true);
    setError('');
    try {
      const loaded = await Promise.all(missing.map((id) => loadProject(id)));
      setSnapshots((prev) => {
        const next = { ...prev };
        loaded.forEach((snapshot) => { next[snapshot.projectId] = snapshot; });
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const selectedRows = rows.filter((row) => selectedKeys.has(row.key));
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedKeys.has(row.key));

  return (
    <div className="fixed inset-0 z-[310] bg-slate-950/60 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-5xl rounded-t-3xl sm:rounded-2xl max-h-[94dvh] overflow-hidden flex flex-col shadow-2xl border border-slate-200">
        <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-black text-slate-900 text-sm sm:text-base">{title}</h3>
            <p className="text-[10.5px] text-slate-500 mt-0.5">Chọn một hoặc nhiều công trình nguồn, sau đó chọn các {entityLabel} cần sao chép. Dữ liệu nguồn không bị thay đổi.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600">Đóng</button>
        </div>

        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <label className="block text-[10px] font-extrabold uppercase tracking-wide text-slate-600 mb-1.5">Công trình nguồn</label>
          <div className="flex flex-wrap gap-2">
            {availableProjects.length === 0 && <span className="text-xs text-slate-500">Không có công trình khác mà tài khoản hiện tại được phép đọc.</span>}
            {availableProjects.map((project) => {
              const checked = selectedProjectIds.includes(project.id);
              return (
                <label key={project.id} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold cursor-pointer ${checked ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...selectedProjectIds, project.id]
                        : selectedProjectIds.filter((id) => id !== project.id);
                      void loadSelectedProjects(next);
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                  />
                  {project.name}
                </label>
              );
            })}
          </div>
          {loading && <div className="mt-2 text-[10px] font-bold text-indigo-600">Đang đọc dữ liệu nguồn đã được phân quyền…</div>}
          {error && <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[10.5px] font-bold text-rose-700">{error}</div>}
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[720px] w-full text-[11px] border-collapse">
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-30 bg-slate-100 p-2 border-b text-center w-12">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(event) => {
                        const next = new Set(selectedKeys);
                        rows.forEach((row) => event.target.checked ? next.add(row.key) : next.delete(row.key));
                        setSelectedKeys(next);
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                  </th>
                  <th className="sticky top-0 z-20 bg-slate-100 p-2 border-b text-left">Công trình nguồn</th>
                  <th className="sticky top-0 z-20 bg-slate-100 p-2 border-b text-left">{entityLabel}</th>
                  <th className="sticky top-0 z-20 bg-slate-100 p-2 border-b text-left">Thông tin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className={selectedKeys.has(row.key) ? 'bg-indigo-50/50' : 'bg-white'}>
                    <td className="sticky left-0 z-10 bg-inherit p-2 border-b text-center">
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(row.key)}
                        onChange={(event) => {
                          const next = new Set(selectedKeys);
                          if (event.target.checked) next.add(row.key); else next.delete(row.key);
                          setSelectedKeys(next);
                        }}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                      />
                    </td>
                    <td className="p-2 border-b font-semibold text-slate-600">{row.projectName}</td>
                    <td className="p-2 border-b font-bold text-slate-900">{getItemLabel(row.item)}</td>
                    <td className="p-2 border-b text-slate-500">{getItemDetail?.(row.item) || '—'}</td>
                  </tr>
                ))}
                {!loading && selectedProjectIds.length > 0 && rows.length === 0 && (
                  <tr><td colSpan={4} className="p-6 text-center text-xs text-slate-500">Không có {entityLabel} trong các công trình đã chọn.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-200 bg-white flex items-center gap-2">
          <span className="mr-auto text-[11px] text-slate-600">Đã chọn <strong>{selectedRows.length}</strong> mục</span>
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-600">Hủy</button>
          <button
            type="button"
            disabled={selectedRows.length === 0 || importing}
            onClick={async () => {
              setImporting(true);
              setError('');
              try {
                await onImport(selectedRows);
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setImporting(false);
              }
            }}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black disabled:opacity-40"
          >
            {importing ? 'Đang nhập…' : `Nhập ${selectedRows.length} mục`}
          </button>
        </div>
      </div>
    </div>
  );
}
