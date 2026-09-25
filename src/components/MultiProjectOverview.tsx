import React, { useMemo, useState } from 'react';
import { Building2, Search, ShieldCheck, X } from 'lucide-react';
import { UserRole } from '../utils/securityUtils';

interface OverviewProject {
  id: string;
  name: string;
  role?: UserRole;
}

interface MultiProjectOverviewProps {
  isOpen: boolean;
  projects: OverviewProject[];
  activeProjectId: string;
  onClose: () => void;
  onOpenProject: (projectId: string) => void | Promise<void>;
  onManageProjects: () => void;
}

const roleLabel = (role?: UserRole) => {
  if (role === 'ADMIN') return 'Quản trị dự án';
  if (role === 'EDITOR') return 'Kỹ sư';
  return 'Người xem';
};

export const MultiProjectOverview: React.FC<MultiProjectOverviewProps> = ({
  isOpen,
  projects,
  activeProjectId,
  onClose,
  onOpenProject,
  onManageProjects,
}) => {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('vi-VN');
    if (!keyword) return projects;
    return projects.filter((project) =>
      String(project.name || '').toLocaleLowerCase('vi-VN').includes(keyword)
      || String(project.role || '').toLowerCase().includes(keyword)
    );
  }, [projects, query]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[85] bg-slate-950/55 backdrop-blur-[1px] p-2 sm:p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Tổng quan dự án">
      <div className="w-full max-w-4xl mx-auto bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-600" />
              Tổng quan dự án
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Bạn có quyền truy cập {projects.length} dự án. Mỗi dự án vẫn dùng đúng role riêng của tài khoản.
            </p>
          </div>
          <button type="button" onClick={onClose} className="min-w-11 min-h-11 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center" aria-label="Đóng">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 sm:p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="flex-1 min-w-0 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm dự án..."
                className="w-full min-h-11 pl-9 pr-3 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <button type="button" onClick={onManageProjects} className="min-h-11 px-4 rounded-xl border border-slate-300 bg-white text-xs font-extrabold text-slate-700 hover:bg-slate-50">
              Quản lý / đồng bộ dự án
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {filtered.map((project) => {
              const active = project.id === activeProjectId;
              const cardClass = active
                ? 'rounded-2xl border p-3.5 border-indigo-300 bg-indigo-50/50'
                : 'rounded-2xl border p-3.5 border-slate-200 bg-white';
              return (
                <article key={project.id} className={cardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-black text-sm text-slate-900 truncate">{project.name}</div>
                      <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2 py-1 text-[10px] font-extrabold text-slate-700">
                        <ShieldCheck className="w-3 h-3" />
                        {roleLabel(project.role)}
                      </div>
                    </div>
                    {active && <span className="text-[9px] font-black uppercase tracking-wide text-indigo-700 bg-indigo-100 rounded-full px-2 py-1">Đang mở</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => void onOpenProject(project.id)}
                    className="mt-3 w-full min-h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold"
                  >
                    {active ? 'Tiếp tục dự án' : 'Mở dự án'}
                  </button>
                </article>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
              Không có dự án phù hợp từ khóa.
            </div>
          )}

          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-[10.5px] text-slate-500">
            Màn hình này chỉ dùng danh sách dự án đã được Firebase xác minh. Không tải toàn bộ Defect, quân số hoặc dữ liệu nghiệp vụ của mọi dự án khi mở ứng dụng.
          </div>
        </div>
      </div>
    </div>
  );
};
