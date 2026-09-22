import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, CheckSquare, RefreshCw, Save, Search, Square, UsersRound } from 'lucide-react';
import {
  CloudProjectSummary,
  fetchProjectEmailAccessFromCloud,
  fetchProjectMembersFromCloud,
  fetchProjectUserRoleFromCloud,
  getCurrentRealFirebaseUser,
  refreshCurrentUserProjectDiscovery,
  removeProjectMemberFromCloud,
  saveProjectAuditLog,
  saveProjectMemberToCloud,
  subscribeCurrentUserProjectsRealtime,
} from '../lib/firebase';
import { UserRole, logAuditAction } from '../utils/securityUtils';
import { confirmAsync } from '../utils/confirmAsync';
import { isSuperAdminEmail } from '../config/superAdmin';

type AccessChoice = UserRole | 'NONE';

interface AccessRow {
  project: CloudProjectSummary;
  actorRole: UserRole;
  current: AccessChoice;
  draft: AccessChoice;
  isOwner: boolean;
  selected: boolean;
}

const normalizeRole = (role?: string | null): UserRole => {
  const value = String(role || 'VIEWER').toUpperCase();
  if (value === 'ADMIN') return 'ADMIN';
  if (value === 'EDITOR' || value === 'ENGINEER') return 'EDITOR';
  return 'VIEWER';
};

const roleLabel = (role: AccessChoice) => {
  if (role === 'ADMIN') return 'Quản trị dự án';
  if (role === 'EDITOR') return 'Kỹ sư';
  if (role === 'VIEWER') return 'Người xem';
  return 'Không cấp quyền';
};

const activeAdminCount = (members: any[]) => new Set(
  members
    .filter((member) => member?.active !== false && normalizeRole(member?.role) === 'ADMIN')
    .map((member) => String(member?.email || '').trim().toLowerCase())
    .filter(Boolean),
).size;

export const MultiProjectAccessPanel: React.FC = () => {
  const [projects, setProjects] = useState<CloudProjectSummary[]>([]);
  const [targetEmail, setTargetEmail] = useState('');
  const [loadedEmail, setLoadedEmail] = useState('');
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkRole, setBulkRole] = useState<AccessChoice>('VIEWER');
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    const start = async () => {
      const user = getCurrentRealFirebaseUser();
      if (!user?.uid || !user.email) {
        setProjects([]);
        setLoadingProjects(false);
        return;
      }
      await refreshCurrentUserProjectDiscovery().catch(() => {});
      if (cancelled) return;
      unsubscribe = subscribeCurrentUserProjectsRealtime((items) => {
        if (cancelled) return;
        setProjects(items);
        setLoadingProjects(false);
      });
    };
    void start();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const manageableProjects = useMemo(
    () => projects.filter((project) => normalizeRole(project.role) === 'ADMIN'),
    [projects],
  );
  const readonlyProjectCount = Math.max(0, projects.length - manageableProjects.length);
  const changedRows = useMemo(() => rows.filter((row) => row.draft !== row.current), [rows]);
  const selectedRows = useMemo(() => rows.filter((row) => row.selected && !row.isOwner), [rows]);

  const loadAccess = async () => {
    const email = targetEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage({ type: 'error', text: 'Email không hợp lệ.' });
      return;
    }
    if (isSuperAdminEmail(email)) {
      setRows([]);
      setLoadedEmail(email);
      setMessage({ type: 'info', text: 'Tài khoản SUPER ADMIN có quyền hệ thống riêng, không chỉnh role dự án tại bảng này.' });
      return;
    }
    if (manageableProjects.length === 0) {
      setRows([]);
      setLoadedEmail(email);
      setMessage({ type: 'info', text: 'Tài khoản hiện tại chưa có dự án nào với quyền Quản trị dự án.' });
      return;
    }

    setLoadingAccess(true);
    setMessage(null);
    const next: AccessRow[] = [];
    try {
      for (const project of manageableProjects) {
        const access = await fetchProjectEmailAccessFromCloud(project.id, email);
        const current: AccessChoice = access.role || 'NONE';
        next.push({
          project,
          actorRole: 'ADMIN',
          current,
          draft: current,
          isOwner: access.isOwner,
          selected: !access.isOwner,
        });
      }
      setRows(next);
      setLoadedEmail(email);
    } catch (err: any) {
      setRows([]);
      setLoadedEmail('');
      setMessage({ type: 'error', text: 'Không tải được quyền nhiều dự án: ' + String(err?.message || err) });
    } finally {
      setLoadingAccess(false);
    }
  };

  const applyBulkRole = () => {
    if (selectedRows.length === 0) {
      setMessage({ type: 'info', text: 'Hãy chọn ít nhất một dự án.' });
      return;
    }
    setRows((currentRows) => currentRows.map((row) =>
      row.selected && !row.isOwner ? { ...row, draft: bulkRole } : row
    ));
    setMessage(null);
  };

  const saveChanges = async () => {
    if (!loadedEmail || changedRows.length === 0 || saving) return;
    const actor = getCurrentRealFirebaseUser();
    if (!actor?.uid || !actor.email) {
      setMessage({ type: 'error', text: 'Cần đăng nhập Google để lưu phân quyền.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      for (const row of changedRows) {
        const liveActorRole = await fetchProjectUserRoleFromCloud(row.project.id, actor);
        if (!liveActorRole.allowed || liveActorRole.role !== 'ADMIN') {
          throw new Error('Bạn không còn quyền ADMIN tại "' + row.project.name + '". Chưa ghi thay đổi nào.');
        }
        if (row.isOwner && row.draft !== 'ADMIN') {
          throw new Error('Không thể hạ quyền Project Owner tại "' + row.project.name + '".');
        }
        if (loadedEmail === String(actor.email || '').trim().toLowerCase() && row.draft !== 'ADMIN') {
          throw new Error('Không hạ/thu hồi chính tài khoản đang thao tác trong bảng nhiều dự án. Hãy dùng luồng quản lý từng dự án để tránh tự khóa quyền.');
        }
        if (row.current === 'ADMIN' && row.draft !== 'ADMIN') {
          const members = (await fetchProjectMembersFromCloud(row.project.id)).filter((member) => member?.email && member?.active !== false);
          if (activeAdminCount(members) <= 1) {
            throw new Error('Không thể hạ quyền ADMIN cuối cùng tại "' + row.project.name + '". Hãy thêm/chuyển một ADMIN khác trước.');
          }
        }
      }

      const confirmed = await confirmAsync(
        'Lưu ' + changedRows.length + ' thay đổi quyền cho ' + loadedEmail + '?\n\nMỗi dự án vẫn được Firebase Rules kiểm tra độc lập.',
        { title: 'Xác nhận phân quyền nhiều dự án', confirmLabel: 'Lưu thay đổi', cancelLabel: 'Hủy' },
      );
      if (!confirmed) return;

      let saved = 0;
      for (const row of changedRows) {
        if (row.draft === 'NONE') {
          await removeProjectMemberFromCloud(row.project.id, loadedEmail);
        } else {
          await saveProjectMemberToCloud(row.project.id, {
            email: loadedEmail,
            role: row.draft,
            assignedAt: Date.now(),
          });
        }
        const description = row.draft === 'NONE'
          ? 'Thu hồi quyền nhiều dự án của ' + loadedEmail
          : 'Đặt quyền ' + row.draft + ' cho ' + loadedEmail + ' từ bảng nhiều dự án';
        logAuditAction('ROLE_CHANGE', description, row.project.id, actor.email || '', 'ADMIN');
        await saveProjectAuditLog(row.project.id, {
          action: 'ROLE_CHANGE',
          module: 'security',
          recordId: loadedEmail,
          description,
          details: description,
          actorRole: 'ADMIN',
        }).catch((err) => console.warn('Multi-project role audit warning:', err));
        saved += 1;
      }

      await loadAccess();
      setMessage({ type: 'success', text: 'Đã cập nhật ' + saved + '/' + changedRows.length + ' dự án cho ' + loadedEmail + '.' });
    } catch (err: any) {
      await loadAccess().catch(() => {});
      setMessage({ type: 'error', text: String(err?.message || err || 'Không lưu được phân quyền nhiều dự án.') });
    } finally {
      setSaving(false);
    }
  };

  const messageClass = message?.type === 'success'
    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
    : message?.type === 'error'
      ? 'bg-rose-50 border-rose-200 text-rose-800'
      : 'bg-amber-50 border-amber-200 text-amber-800';

  return (
    <section className="bg-white p-3.5 sm:p-4 rounded-2xl border border-indigo-200 space-y-3" data-testid="multi-project-access-panel">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <h4 className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
            <UsersRound className="w-4 h-4 text-indigo-600" />
            <span>Quản lý quyền nhiều dự án</span>
          </h4>
          <p className="mt-1 text-[10.5px] text-slate-500 leading-relaxed">
            Nhập một email rồi gán ADMIN / EDITOR / VIEWER cho nhiều dự án tại một chỗ. Quyền thật vẫn nằm ở membership từng dự án và Firebase Rules vẫn là lớp chặn cuối.
          </p>
        </div>
        <div className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 whitespace-nowrap">
          Quản trị được {manageableProjects.length}/{projects.length} dự án
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          value={targetEmail}
          onChange={(event) => setTargetEmail(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void loadAccess(); } }}
          placeholder="email.nguoidung@gmail.com"
          className="flex-1 min-w-0 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={() => void loadAccess()}
          disabled={loadingProjects || loadingAccess}
          className="min-h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {loadingAccess ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {loadingAccess ? 'Đang tải...' : 'Tải quyền'}
        </button>
      </div>

      {readonlyProjectCount > 0 && (
        <div className="text-[10px] text-slate-500">
          {readonlyProjectCount} dự án bạn chỉ là Kỹ sư/Người xem nên không được chỉnh thành viên từ đây.
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-col lg:flex-row lg:items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 p-2.5">
            <div className="text-[10.5px] font-semibold text-slate-600 flex-1 min-w-0 truncate">
              Tài khoản: <span className="font-mono font-bold text-slate-800">{loadedEmail}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={bulkRole}
                onChange={(event) => setBulkRole(event.target.value as AccessChoice)}
                className="min-h-10 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-bold"
              >
                <option value="ADMIN">Quản trị dự án</option>
                <option value="EDITOR">Kỹ sư</option>
                <option value="VIEWER">Người xem</option>
                <option value="NONE">Không cấp quyền</option>
              </select>
              <button type="button" onClick={applyBulkRole} className="min-h-10 px-3 rounded-lg bg-white border border-slate-300 text-xs font-extrabold text-slate-700 hover:bg-slate-100">
                Áp dụng cho dự án đã chọn
              </button>
              <button type="button" onClick={() => setRows((currentRows) => currentRows.map((row) => ({ ...row, selected: !row.isOwner })))} className="min-h-10 px-3 rounded-lg bg-white border border-slate-300 text-xs font-extrabold text-slate-700 hover:bg-slate-100">
                Chọn tất cả
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-[52vh] overflow-y-auto pr-0.5">
            {rows.map((row) => (
              <div key={row.project.id} className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    disabled={row.isOwner}
                    onClick={() => setRows((currentRows) => currentRows.map((item) => item.project.id === row.project.id ? { ...item, selected: !item.selected } : item))}
                    className="mt-0.5 p-1 text-indigo-600 disabled:text-slate-300"
                    aria-label={row.selected ? 'Bỏ chọn dự án' : 'Chọn dự án'}
                  >
                    {row.selected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-xs text-slate-800 truncate flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      {row.project.name}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      Hiện tại: <strong>{roleLabel(row.current)}</strong>
                      {row.isOwner && <span className="ml-1 text-amber-700 font-bold">· Project Owner</span>}
                    </div>
                  </div>
                  <select
                    value={row.draft}
                    disabled={row.isOwner || saving}
                    onChange={(event) => setRows((currentRows) => currentRows.map((item) => item.project.id === row.project.id ? { ...item, draft: event.target.value as AccessChoice } : item))}
                    className="min-h-10 max-w-[150px] px-2 rounded-lg border border-slate-200 bg-white text-[10.5px] font-bold disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="ADMIN">Quản trị dự án</option>
                    <option value="EDITOR">Kỹ sư</option>
                    <option value="VIEWER">Người xem</option>
                    <option value="NONE">Không cấp quyền</option>
                  </select>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
            <div className="text-[10.5px] text-slate-500">
              {changedRows.length > 0 ? changedRows.length + ' dự án có thay đổi chưa lưu.' : 'Chưa có thay đổi.'}
            </div>
            <button
              type="button"
              onClick={() => void saveChanges()}
              disabled={saving || changedRows.length === 0}
              className="min-h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Đang lưu...' : 'Lưu ' + (changedRows.length || '') + ' thay đổi'}
            </button>
          </div>
        </>
      )}

      {message && (
        <div className={'rounded-xl border p-2.5 text-[10.5px] font-bold ' + messageClass}>
          {message.type === 'error' && <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />}
          {message.text}
        </div>
      )}
    </section>
  );
};
