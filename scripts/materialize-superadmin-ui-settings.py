from pathlib import Path


def rep(path, old, new, label, count=1):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    found = s.count(old)
    if found < count:
        raise SystemExit(f'{label}: expected >= {count}, found {found}')
    p.write_text(s.replace(old, new, count), encoding='utf-8')
    print('patched', label)

# SuperAdminCenter: add functional settings panel.
p = Path('src/components/SuperAdminCenter.tsx')
s = p.read_text(encoding='utf-8')
s = s.replace("import React from 'react';", "import React, { useEffect, useState } from 'react';", 1)
s = s.replace("  onOpenNotificationCenter: () => void;\n}", "  onOpenNotificationCenter: () => void;\n  uiSettings: { scalePercent: number; checklistVisibility: 'auto' | 'always'; };\n  onPreviewUiSettings: (settings: { scalePercent: number; checklistVisibility: 'auto' | 'always' }) => void;\n  onSaveUiSettings: (settings: { scalePercent: number; checklistVisibility: 'auto' | 'always' }) => Promise<void>;\n  onResetUiSettings: () => Promise<void>;\n}", 1)
s = s.replace("  onOpenNotificationCenter,\n}) => {", "  onOpenNotificationCenter,\n  uiSettings,\n  onPreviewUiSettings,\n  onSaveUiSettings,\n  onResetUiSettings,\n}) => {\n  const [showUiSettings, setShowUiSettings] = useState(false);\n  const [draftUi, setDraftUi] = useState(uiSettings);\n  const [savingUi, setSavingUi] = useState(false);\n  const [uiMessage, setUiMessage] = useState('');\n\n  useEffect(() => setDraftUi(uiSettings), [uiSettings.scalePercent, uiSettings.checklistVisibility]);\n\n  const updateDraft = (next: typeof draftUi) => {\n    setDraftUi(next);\n    onPreviewUiSettings(next);\n    setUiMessage('Đang xem trước — chưa lưu lên Cloud.');\n  };\n\n  const saveDraft = async () => {\n    setSavingUi(true);\n    setUiMessage('');\n    try {\n      await onSaveUiSettings(draftUi);\n      setUiMessage('Đã lưu giao diện cho dự án.');\n    } catch (err: any) {\n      setUiMessage(`Không lưu được: ${err?.message || err}`);\n    } finally { setSavingUi(false); }\n  };\n", 1)
s = s.replace("      onClick: onOpenConfig,\n    },\n    {\n      title: 'Thông báo',", "      onClick: () => setShowUiSettings(true),\n    },\n    {\n      title: 'Thông báo',", 1)
anchor = "      <section className=\"rounded-2xl border border-slate-200 bg-slate-50 p-4\">\n"
panel = '''      {showUiSettings && (
        <section className="rounded-3xl border border-indigo-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between gap-3">
            <div><h3 className="text-sm font-black text-indigo-950">Giao diện & Module</h3><p className="text-[10px] text-indigo-700 mt-0.5">Chỉ thay đổi cách hiển thị, không thay đổi quyền hay dữ liệu.</p></div>
            <button type="button" onClick={() => { setShowUiSettings(false); onPreviewUiSettings(uiSettings); }} className="text-[11px] font-bold text-slate-500 px-2 py-1 rounded-lg hover:bg-white">Đóng</button>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-[11px] font-extrabold text-slate-700">Tỷ lệ giao diện toàn ứng dụng</span>
                <select value={draftUi.scalePercent} onChange={(e) => updateDraft({ ...draftUi, scalePercent: Number(e.target.value) })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold">
                  <option value={90}>90% · Gọn</option><option value={100}>100% · Tiêu chuẩn</option><option value={110}>110% · Dễ đọc</option><option value={120}>120% · Chữ/nút lớn</option>
                </select>
                <p className="text-[10px] text-slate-400">Xem trước áp dụng ngay trên thiết bị hiện tại.</p>
              </label>
              <label className="space-y-1.5">
                <span className="text-[11px] font-extrabold text-slate-700">Hiển thị Checklist</span>
                <select value={draftUi.checklistVisibility} onChange={(e) => updateDraft({ ...draftUi, checklistVisibility: e.target.value as 'auto' | 'always' })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold">
                  <option value="auto">Tự ẩn khi chưa có dữ liệu</option><option value="always">Luôn hiện module Checklist</option>
                </select>
                <p className="text-[10px] text-slate-400">Không xóa Checklist; chỉ điều khiển menu hiển thị.</p>
              </label>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex flex-wrap gap-2 items-center justify-between">
              <div className="text-[10px] text-slate-500">Định dạng ngày vẫn dùng nguồn chuẩn trong Cài đặt → Cấu hình để tránh tạo hai cấu hình khác nhau.</div>
              <button type="button" onClick={onOpenConfig} className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-[10px] font-extrabold text-slate-700">Mở cấu hình ngày</button>
            </div>
            {uiMessage && <div className="text-[10px] font-semibold text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{uiMessage}</div>}
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" disabled={savingUi} onClick={async () => { setSavingUi(true); try { await onResetUiSettings(); setUiMessage('Đã khôi phục mặc định.'); } finally { setSavingUi(false); } }} className="px-3 py-2 rounded-xl border border-slate-300 text-[11px] font-bold text-slate-600 disabled:opacity-50">Khôi phục mặc định</button>
              <button type="button" disabled={savingUi} onClick={() => void saveDraft()} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-[11px] font-extrabold shadow-sm disabled:opacity-50">{savingUi ? 'Đang lưu…' : 'Áp dụng & Lưu'}</button>
            </div>
          </div>
        </section>
      )}

'''
if anchor not in s:
    raise SystemExit('SuperAdmin panel anchor missing')
s = s.replace(anchor, panel + anchor, 1)
p.write_text(s, encoding='utf-8')
print('patched SuperAdminCenter UI panel')

# App: state, apply root scale, shared-settings hydration/save and checklist policy.
p = Path('src/App.tsx')
s = p.read_text(encoding='utf-8')
state_anchor = "  const [trashSettings, setTrashSettings] = useState<TrashSettings>(DEFAULT_TRASH_SETTINGS);\n"
state_new = "  const [trashSettings, setTrashSettings] = useState<TrashSettings>(DEFAULT_TRASH_SETTINGS);\n  const [superAdminUiSettings, setSuperAdminUiSettings] = useState<{ scalePercent: number; checklistVisibility: 'auto' | 'always' }>({ scalePercent: 100, checklistVisibility: 'auto' });\n"
if state_anchor not in s: raise SystemExit('App state anchor missing')
s = s.replace(state_anchor, state_new, 1)

show_old = "  const showChecklistModule = activeChecklist.length > 0;"
show_new = "  const showChecklistModule = superAdminUiSettings.checklistVisibility === 'always' || activeChecklist.length > 0;"
if show_old not in s: raise SystemExit('Checklist visibility anchor missing')
s = s.replace(show_old, show_new, 1)

# Add scale effect before checklist nav effect.
nav_anchor = "  useEffect(() => {\n    // Checklist is kept in source/data for compatibility but stays out of navigation"
scale_effect = "  useEffect(() => {\n    const pct = Math.min(120, Math.max(90, Number(superAdminUiSettings.scalePercent) || 100));\n    document.documentElement.style.fontSize = `${pct}%`;\n    return () => { document.documentElement.style.fontSize = ''; };\n  }, [superAdminUiSettings.scalePercent]);\n\n"
if nav_anchor not in s: raise SystemExit('App nav effect anchor missing')
s = s.replace(nav_anchor, scale_effect + nav_anchor, 1)

# Shared settings subscription hydration.
trash_block = "      if (settings.trash) {\n        const nextTrash = normalizeTrashSettings(settings.trash);\n        trashSettingsRef.current = nextTrash;\n        setTrashSettings(nextTrash);\n        localStorage.setItem(getKey('construction_trash_settings', activeProjectId), JSON.stringify(nextTrash));\n      }\n"
trash_new = trash_block + "      if (settings.superAdminUi && typeof settings.superAdminUi === 'object') {\n        const raw = settings.superAdminUi as any;\n        const nextUi = {\n          scalePercent: [90, 100, 110, 120].includes(Number(raw.scalePercent)) ? Number(raw.scalePercent) : 100,\n          checklistVisibility: raw.checklistVisibility === 'always' ? 'always' as const : 'auto' as const,\n        };\n        setSuperAdminUiSettings(nextUi);\n        localStorage.setItem(getKey('construction_superadmin_ui', activeProjectId), JSON.stringify(nextUi));\n      }\n"
if trash_block not in s: raise SystemExit('shared settings subscription anchor missing')
s = s.replace(trash_block, trash_new, 1)

# Insert handlers before trash settings handler.
handler_anchor = "  const handleTrashSettingsChange = (nextInput: TrashSettings) => {\n"
handlers = "  const previewSuperAdminUiSettings = (next: { scalePercent: number; checklistVisibility: 'auto' | 'always' }) => {\n    if (!isCurrentSuperAdmin) return;\n    setSuperAdminUiSettings(next);\n  };\n\n  const saveSuperAdminUiSettings = async (next: { scalePercent: number; checklistVisibility: 'auto' | 'always' }) => {\n    if (!isCurrentSuperAdmin || !getCurrentRealFirebaseUser()) throw new Error('Chỉ SUPER ADMIN đã xác thực được lưu cấu hình giao diện.');\n    const sanitized = {\n      scalePercent: [90, 100, 110, 120].includes(Number(next.scalePercent)) ? Number(next.scalePercent) : 100,\n      checklistVisibility: next.checklistVisibility === 'always' ? 'always' as const : 'auto' as const,\n    };\n    setSuperAdminUiSettings(sanitized);\n    localStorage.setItem(getKey('construction_superadmin_ui', activeProjectIdRef.current), JSON.stringify(sanitized));\n    await saveProjectSharedSettings(activeProjectIdRef.current, { superAdminUi: sanitized });\n    await saveProjectAuditLog(activeProjectIdRef.current, { action: 'SECURITY_CONFIG_CHANGE', description: `SUPER ADMIN cập nhật giao diện: scale ${sanitized.scalePercent}%, checklist ${sanitized.checklistVisibility}`, module: 'system-ui', syncStatus: 'PENDING' }).catch(() => {});\n  };\n\n  const resetSuperAdminUiSettings = async () => {\n    await saveSuperAdminUiSettings({ scalePercent: 100, checklistVisibility: 'auto' });\n  };\n\n"
if handler_anchor not in s: raise SystemExit('UI handler anchor missing')
s = s.replace(handler_anchor, handlers + handler_anchor, 1)

# Pass props to SuperAdminCenter.
props_anchor = "              onOpenNotificationCenter={() => setIsNotificationCenterOpen(true)}\n            />"
props_new = "              onOpenNotificationCenter={() => setIsNotificationCenterOpen(true)}\n              uiSettings={superAdminUiSettings}\n              onPreviewUiSettings={previewSuperAdminUiSettings}\n              onSaveUiSettings={saveSuperAdminUiSettings}\n              onResetUiSettings={resetSuperAdminUiSettings}\n            />"
if props_anchor not in s: raise SystemExit('SuperAdmin props anchor missing')
s = s.replace(props_anchor, props_new, 1)
p.write_text(s, encoding='utf-8')
print('patched App UI settings wiring')

# Add lightweight regression guard to RBAC source matrix.
p = Path('scripts/rbac-matrix.mjs')
s = p.read_text(encoding='utf-8')
needle = "console.log('MASTER RBAC MATRIX PASS – ADMIN / EDITOR / VIEWER');"
guard = """assertContains(firebaseSource, 'requestProjectMemberPinReset', 'SUPER ADMIN remote PIN reset API is wired');
assertContains(firebaseSource, 'isSuperAdminEmail(actor.email)', 'remote PIN reset is company SUPER ADMIN-bound');
assertContains(appSource, 'subscribeCurrentUserPinResetRealtime', 'target account listens for remote PIN reset');
assertContains(securitySource, 'applyRemotePinReset', 'remote reset clears local PIN through monotonic epoch helper');
console.log('PASS RBAC: SUPER ADMIN remote PIN reset is identity-bound and target-listened');

"""
if needle not in s: raise SystemExit('RBAC final anchor missing')
s = s.replace(needle, guard + needle, 1)
p.write_text(s, encoding='utf-8')
print('patched remote PIN regression guard')
