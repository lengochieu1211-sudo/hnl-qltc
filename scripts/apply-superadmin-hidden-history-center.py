from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# 1) Super Admin Center: add dedicated recovery/history entry.
p = ROOT / 'src/components/SuperAdminCenter.tsx'
s = p.read_text(encoding='utf-8')
s = s.replace(
"  onOpenProjectManager: () => void;\n  onOpenSecurity: () => void;\n  onOpenConfig: () => void;",
"  onOpenProjectManager: () => void;\n  onOpenSecurity: () => void;\n  onOpenConfig: () => void;\n  onOpenHiddenHistory: () => void;",
1)
s = s.replace(
"  onOpenProjectManager,\n  onOpenSecurity,\n  onOpenConfig,",
"  onOpenProjectManager,\n  onOpenSecurity,\n  onOpenConfig,\n  onOpenHiddenHistory,",
1)
needle = """    {
      title: 'Dự án & dữ liệu',
      description: 'Quản lý dự án, backup/khôi phục và phạm vi đồng bộ của dự án hiện tại.',
      icon: FolderKanban,
      onClick: onOpenProjectManager,
    },
"""
insert = needle + """    {
      title: 'Dữ liệu đã ẩn & lịch sử',
      description: 'Khôi phục hoặc dọn dữ liệu đã xóa: Căn/Phòng, Hạng mục, Định mức, Phiếu nhập/xuất kho, Mặt bằng, Defect, Checklist, Quân số và Đội thi công.',
      icon: DatabaseZap,
      onClick: onOpenHiddenHistory,
    },
"""
if "title: 'Dữ liệu đã ẩn & lịch sử'" not in s:
    if needle not in s:
        raise SystemExit('SuperAdmin action anchor not found')
    s = s.replace(needle, insert, 1)
p.write_text(s, encoding='utf-8')

# 2) App: route Super Admin directly to recovery card, retrying until lazy Config is mounted.
p = ROOT / 'src/App.tsx'
s = p.read_text(encoding='utf-8')
anchor = """              onOpenSecurity={() => setIsSecurityModalOpen(true)}
              onOpenConfig={() => setActiveTab('config')}
              onOpenNotificationCenter={() => setIsNotificationCenterOpen(true)}
"""
replacement = """              onOpenSecurity={() => setIsSecurityModalOpen(true)}
              onOpenConfig={() => setActiveTab('config')}
              onOpenHiddenHistory={() => {
                setActiveTab('config');
                let attempts = 0;
                const focusTrash = () => {
                  const target = document.getElementById('trash-recovery-card');
                  if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    target.classList.add('ring-2', 'ring-indigo-300');
                    window.setTimeout(() => target.classList.remove('ring-2', 'ring-indigo-300'), 1800);
                    return;
                  }
                  attempts += 1;
                  if (attempts < 25) window.setTimeout(focusTrash, 100);
                };
                window.setTimeout(focusTrash, 0);
              }}
              onOpenNotificationCenter={() => setIsNotificationCenterOpen(true)}
"""
if 'onOpenHiddenHistory={() =>' not in s:
    if anchor not in s:
        raise SystemExit('App SuperAdmin props anchor not found')
    s = s.replace(anchor, replacement, 1)
p.write_text(s, encoding='utf-8')

# 3) Config: make recovery card addressable, clarify semantics, and fix QLTC folder message.
p = ROOT / 'src/components/GoogleConfigTab.tsx'
s = p.read_text(encoding='utf-8')
s = s.replace('`Đã lưu ${fileName} vào Download/QLCT.`', '`Đã lưu ${fileName} vào Download/QLTC.`')
s = s.replace(
'      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3.5">\n        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">\n          <div>\n            <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">\n              <Trash2 className="w-4 h-4 text-rose-600" /> Thùng rác dữ liệu\n            </h3>',
'      <div id="trash-recovery-card" className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3.5 scroll-mt-24 transition-shadow">\n        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">\n          <div>\n            <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">\n              <Trash2 className="w-4 h-4 text-rose-600" /> Dữ liệu đã ẩn & lịch sử\n            </h3>',
1)
desc = """            <p className=\"text-[10px] text-slate-500 mt-1\">
              Chỉ lưu metadata cần khôi phục, không nhân đôi Base64/blob/ảnh nhị phân. Mặc định giữ 7 ngày.
            </p>
"""
warn = desc + """            <p className=\"text-[10px] text-amber-700 mt-1\">
              Phiếu nhập/xuất kho là lịch sử giao dịch: nếu xóa nhầm hãy ưu tiên Khôi phục rồi Hủy/Điều chỉnh trong Kho; chỉ xóa vĩnh viễn khi chắc chắn không cần đối chiếu.
            </p>
"""
if 'Phiếu nhập/xuất kho là lịch sử giao dịch' not in s:
    if desc not in s:
        raise SystemExit('Trash description anchor not found')
    s = s.replace(desc, warn, 1)
p.write_text(s, encoding='utf-8')

# 4) Trash collection terminology: inventory is transaction history, not a master catalog.
p = ROOT / 'src/lib/trash.ts'
s = p.read_text(encoding='utf-8')
s = s.replace("inventory: 'Nhật ký kho'", "inventory: 'Phiếu nhập / xuất kho'")
p.write_text(s, encoding='utf-8')

# 5) Stability guard: Android user-facing folder was renamed from QLCT to QLTC.
p = ROOT / 'scripts/stability-gate.mjs'
s = p.read_text(encoding='utf-8')
s = s.replace('Download/QLCT', 'Download/QLTC')
p.write_text(s, encoding='utf-8')

print('Applied Super Admin hidden/history center patch')
