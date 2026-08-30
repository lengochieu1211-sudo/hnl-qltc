from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'PATCH ASSERTION FAILED: {path}: expected 1 occurrence, found {count}\n{old[:800]}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print('PATCHED', path)


# Security: use app-owned async confirmation for role changes and revoke.
replace_once(
    'src/components/SecurityModal.tsx',
    """import { QuickSortBar } from './QuickSortBar';""",
    """import { QuickSortBar } from './QuickSortBar';\nimport { confirmAsync } from '../utils/confirmAsync';"""
)

replace_once(
    'src/components/SecurityModal.tsx',
    """    if (existingMember?.role === 'ADMIN' && newMemberRole !== 'ADMIN' && countAdmins(existingMembers) <= 1) {\n      setMemberMsg({ type: 'error', text: 'Khong the ha quyen ADMIN cuoi cung cua du an. Hay them/chuyen mot ADMIN khac truoc.' });\n      return;\n    }\n\n    const assignedAt = Date.now();""",
    """    if (existingMember?.role === 'ADMIN' && newMemberRole !== 'ADMIN' && countAdmins(existingMembers) <= 1) {\n      setMemberMsg({ type: 'error', text: 'Không thể hạ quyền ADMIN cuối cùng của dự án. Hãy thêm/chuyển một ADMIN khác trước.' });\n      return;\n    }\n\n    if (existingMember && existingMember.role !== newMemberRole) {\n      const confirmed = await confirmAsync(\n        `Xác nhận thay đổi quyền thành viên?\\n\\nDự án: ${getSelectedProjectName(pidAtSubmit)}\\nTài khoản: ${email}\\nQuyền cũ: ${existingMember.role}\\nQuyền mới: ${newMemberRole}`\n      );\n      if (!confirmed) return;\n    }\n\n    const assignedAt = Date.now();"""
)

replace_once(
    'src/components/SecurityModal.tsx',
    """    if (confirm(`XÃ¡c nháº­n thu há»“i quyá»n truy cáº­p cá»§a ${email}?`)) {""",
    """    if (await confirmAsync(\n      `Xác nhận thu hồi quyền truy cập?\\n\\nDự án: ${getSelectedProjectName(pidAtSubmit)}\\nTài khoản: ${email}\\nQuyền hiện tại: ${targetMember?.role || 'VIEWER'}\\n\\nThao tác này sẽ thu hồi mọi UID/email alias của cùng tài khoản.`\n    )) {"""
)

# Normalize the three user-facing role names inside the Security center.
for old, new in [
    ('ADMIN (Chỉ Huy Trưởng)', 'ADMIN (Quản trị)'),
    ('EDITOR (Kỹ sư Giám Sát)', 'EDITOR (Kỹ sư)'),
    ('EDITOR (Kỹ sư Thi Công)', 'EDITOR (Kỹ sư)'),
    ('VIEWER (Người Xem / Chỉ Đọc)', 'VIEWER (Chỉ xem)'),
]:
    p = Path('src/components/SecurityModal.tsx')
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'PATCH ASSERTION FAILED: missing role label {old}')
    p.write_text(text.replace(old, new), encoding='utf-8')

# Floor plan: only restore pan/zoom when it was saved for a compatible viewport size.
replace_once(
    'src/components/FloorPlanDefectTab.tsx',
    """    let savedZoom = 1;\n    let savedLeft = 0;\n    let savedTop = 0;\n    try {\n      const raw = sessionStorage.getItem(getFloorViewStateKey(selectedFloorId));\n      if (raw) {\n        const saved = JSON.parse(raw);\n        savedZoom = Math.min(20, Math.max(1, Number(saved.zoom) || 1));\n        savedLeft = Math.max(0, Number(saved.scrollLeft) || 0);\n        savedTop = Math.max(0, Number(saved.scrollTop) || 0);\n      }\n    } catch {}""",
    """    let savedZoom = 1;\n    let savedLeft = 0;\n    let savedTop = 0;\n    try {\n      const raw = sessionStorage.getItem(getFloorViewStateKey(selectedFloorId));\n      if (raw) {\n        const saved = JSON.parse(raw);\n        const currentWidth = Math.max(0, parentRef.current?.clientWidth || 0);\n        const currentHeight = Math.max(0, parentRef.current?.clientHeight || 0);\n        const savedWidth = Math.max(0, Number(saved.viewportWidth) || 0);\n        const savedHeight = Math.max(0, Number(saved.viewportHeight) || 0);\n        const widthRatio = savedWidth > 0 && currentWidth > 0 ? currentWidth / savedWidth : 0;\n        const heightRatio = savedHeight > 0 && currentHeight > 0 ? currentHeight / savedHeight : 0;\n        const compatibleViewport = widthRatio >= 0.8 && widthRatio <= 1.25 && heightRatio >= 0.8 && heightRatio <= 1.25;\n        if (compatibleViewport) {\n          savedZoom = Math.min(20, Math.max(1, Number(saved.zoom) || 1));\n          savedLeft = Math.max(0, Number(saved.scrollLeft) || 0);\n          savedTop = Math.max(0, Number(saved.scrollTop) || 0);\n        }\n      }\n    } catch {}"""
)

# There are two writers for the same per-floor view state; both must persist viewport dimensions.
p = Path('src/components/FloorPlanDefectTab.tsx')
text = p.read_text(encoding='utf-8')
old = """              zoom: zoomScaleRef.current,\n              scrollLeft: next.scrollLeft,\n              scrollTop: next.scrollTop,"""
new = """              zoom: zoomScaleRef.current,\n              scrollLeft: next.scrollLeft,\n              scrollTop: next.scrollTop,\n              viewportWidth: next.clientWidth,\n              viewportHeight: next.clientHeight,"""
if text.count(old) != 1:
    raise SystemExit(f'PATCH ASSERTION FAILED: expected scroll writer once, got {text.count(old)}')
text = text.replace(old, new, 1)
old2 = """        zoom: zoomScale,\n        scrollLeft: parent.scrollLeft,\n        scrollTop: parent.scrollTop,"""
new2 = """        zoom: zoomScale,\n        scrollLeft: parent.scrollLeft,\n        scrollTop: parent.scrollTop,\n        viewportWidth: Math.max(1, parent.clientWidth),\n        viewportHeight: Math.max(1, parent.clientHeight),"""
if text.count(old2) != 1:
    raise SystemExit(f'PATCH ASSERTION FAILED: expected zoom writer once, got {text.count(old2)}')
text = text.replace(old2, new2, 1)
p.write_text(text, encoding='utf-8')
print('PATCHED floor viewport writers')

# Regression assertions.
replace_once(
    'scripts/rbac-matrix.mjs',
    """check('Security member mutation is ADMIN-only', has(src.securityModal, 'canManageProjectMembers', 'canManageMembers(currentRole)'));""",
    """check('Security member mutation is ADMIN-only', has(src.securityModal, 'canManageProjectMembers', 'canManageMembers(currentRole)'));\ncheck('Security role change/revoke uses app confirmation with identity context', has(src.securityModal, 'confirmAsync(', 'Quyền cũ:', 'Quyền mới:', 'Thao tác này sẽ thu hồi mọi UID/email alias'));\ncheck('Security role labels are normalized', has(src.securityModal, 'ADMIN (Quản trị)', 'EDITOR (Kỹ sư)', 'VIEWER (Chỉ xem)') && !src.securityModal.includes('Kỹ sư Giám Sát') && !src.securityModal.includes('Kỹ sư Thi Công'));"""
)

replace_once(
    'scripts/rbac-matrix.mjs',
    """check('Floor target-date editor moved to Mặt bằng and remains ADMIN-only', has(src.floor, 'Kế hoạch tiến độ tầng', 'onUpdateFloorPlan?:', 'targetFrameDate', 'targetBoardDate', 'disabled={!canManageStructure}') && !src.config.includes('Cài đặt Tiến Độ Mục Tiêu Từng Tầng'));""",
    """check('Floor target-date editor moved to Mặt bằng and remains ADMIN-only', has(src.floor, 'Kế hoạch tiến độ tầng', 'onUpdateFloorPlan?:', 'targetFrameDate', 'targetBoardDate', 'disabled={!canManageStructure}') && !src.config.includes('Cài đặt Tiến Độ Mục Tiêu Từng Tầng'));\ncheck('Floor view does not restore stale pan/zoom across incompatible viewport sizes', has(src.floor, 'viewportWidth', 'viewportHeight', 'compatibleViewport', 'widthRatio >= 0.8', 'heightRatio >= 0.8'));"""
)

print('RC2.2.8 SECURITY + FLOOR VIEW PATCH COMPLETE')
