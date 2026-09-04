from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly 1 match, found {count} for:\n{old[:160]}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


floor = Path('src/components/FloorPlanDefectTab.tsx')
css = Path('public/darkmode-final.css')
golden = Path('scripts/room-excel-roundtrip-golden.ts')

replace_once(
    floor,
    """    const resolveExcelTeamName = (teamId?: string, assignedTeam?: string) =>\n      (teamId ? teamNameById.get(teamId) : undefined) || assignedTeam?.trim() || '';\n\n    const roomHeaders = [\n""",
    """    const resolveExcelTeamName = (teamId?: string, assignedTeam?: string) =>\n      (teamId ? teamNameById.get(teamId) : undefined) || assignedTeam?.trim() || '';\n\n    // Export durable IDs even for older room/sub-item records that only retained the\n    // human-readable team/category name. This keeps a downloaded workbook round-trip\n    // safe without inventing links: IDs are restored only on an exact active catalog match.\n    const excelTeamIdByName = new Map<string, string>();\n    teams.forEach((team) => {\n      const id = String(team.id || '').trim();\n      const name = String(team.name || '').trim();\n      if (id && name) excelTeamIdByName.set(name.toLocaleLowerCase('vi-VN'), id);\n    });\n    const excelCategoryIdByName = new Map<string, string>();\n    workVolumes.forEach((item) => {\n      const name = String(item.title || '').trim();\n      const id = String(item.workCategoryId || item.id || '').trim();\n      if (id && name) excelCategoryIdByName.set(name.toLocaleLowerCase('vi-VN'), id);\n    });\n    const resolveExcelTeamId = (teamId?: string, assignedTeam?: string) => {\n      const explicitId = String(teamId || '').trim();\n      if (explicitId) return explicitId;\n      const name = String(assignedTeam || '').trim();\n      return name ? (excelTeamIdByName.get(name.toLocaleLowerCase('vi-VN')) || '') : '';\n    };\n    const resolveExcelCategoryId = (workCategoryId?: string, categoryName?: string) => {\n      const explicitId = String(workCategoryId || '').trim();\n      if (explicitId) return explicitId;\n      const name = String(categoryName || '').trim();\n      return name ? (excelCategoryIdByName.get(name.toLocaleLowerCase('vi-VN')) || '') : '';\n    };\n\n    const roomHeaders = [\n""",
)

replace_once(
    floor,
    """      'Hạng Mục Thi Công Chính': r.workCategory || '',\n      '__workCategoryId': r.workCategoryId || '',\n      'Đội Thi Công Căn / Phòng': resolveExcelTeamName(r.teamId, r.assignedTeam),\n      '__teamId': r.teamId || '',\n""",
    """      'Hạng Mục Thi Công Chính': r.workCategory || '',\n      '__workCategoryId': resolveExcelCategoryId(r.workCategoryId, r.workCategory),\n      'Đội Thi Công Căn / Phòng': resolveExcelTeamName(r.teamId, r.assignedTeam),\n      '__teamId': resolveExcelTeamId(r.teamId, r.assignedTeam),\n""",
)

replace_once(
    floor,
    """    const roomSheet = XLSX.utils.json_to_sheet(roomData, { header: roomHeaders });\n    XLSX.utils.book_append_sheet(wb, roomSheet, 'Can_Phong');\n""",
    """    const roomSheet = XLSX.utils.json_to_sheet(roomData, { header: roomHeaders });\n    roomSheet['!cols'] = [\n      { wch: 6 }, { wch: 24, hidden: true }, { wch: 26 }, { wch: 24 }, { wch: 24, hidden: true },\n      { wch: 22 }, { wch: 24, hidden: true }, { wch: 18 }, { wch: 14 },\n      { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 15 },\n      { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 22 }, { wch: 32 }\n    ];\n    roomSheet['!autofilter'] = { ref: `A1:S${Math.max(2, roomData.length + 1)}` };\n    roomSheet['!rows'] = [{ hpt: 24 }];\n    XLSX.utils.book_append_sheet(wb, roomSheet, 'Can_Phong');\n""",
)

replace_once(
    floor,
    """        'Hạng Mục Thi Công': subItem.category || room.workCategory || '',\n        '__workCategoryId': subItem.workCategoryId || room.workCategoryId || '',\n        'Công Đoạn / Nội Dung': subItem.name,\n""",
    """        'Hạng Mục Thi Công': subItem.category || room.workCategory || '',\n        '__workCategoryId': resolveExcelCategoryId(\n          subItem.workCategoryId || room.workCategoryId,\n          subItem.category || room.workCategory\n        ),\n        'Công Đoạn / Nội Dung': subItem.name,\n""",
)

replace_once(
    floor,
    """        'Đội Thi Công': resolveExcelTeamName(subItem.teamId, subItem.assignedTeam),\n        '__teamId': subItem.teamId || '',\n""",
    """        'Đội Thi Công': resolveExcelTeamName(subItem.teamId, subItem.assignedTeam),\n        '__teamId': resolveExcelTeamId(subItem.teamId, subItem.assignedTeam),\n""",
)

replace_once(
    floor,
    """    const subItemSheet = XLSX.utils.json_to_sheet(subItemData, { header: subItemHeaders });\n    XLSX.utils.book_append_sheet(wb, subItemSheet, 'Hang_Muc_Thi_Cong');\n""",
    """    const subItemSheet = XLSX.utils.json_to_sheet(subItemData, { header: subItemHeaders });\n    subItemSheet['!cols'] = [\n      { wch: 8 }, { wch: 24, hidden: true }, { wch: 26 }, { wch: 24, hidden: true },\n      { wch: 24 }, { wch: 24, hidden: true }, { wch: 28 }, { wch: 20 }, { wch: 22 },\n      { wch: 16 }, { wch: 22 }, { wch: 24, hidden: true }, { wch: 14 }, { wch: 12 }, { wch: 18 }\n    ];\n    subItemSheet['!autofilter'] = { ref: `A1:O${Math.max(2, subItemData.length + 1)}` };\n    subItemSheet['!rows'] = [{ hpt: 24 }];\n    XLSX.utils.book_append_sheet(wb, subItemSheet, 'Hang_Muc_Thi_Cong');\n""",
)

replace_once(
    floor,
    """    const teamSheet = XLSX.utils.json_to_sheet(teamData, { header: teamHeaders });\n    XLSX.utils.book_append_sheet(wb, teamSheet, 'Danh_Muc_Doi');\n""",
    """    const teamSheet = XLSX.utils.json_to_sheet(teamData, { header: teamHeaders });\n    teamSheet['!cols'] = [\n      { wch: 24, hidden: true }, { wch: 24 }, { wch: 24 }, { wch: 18 }, { wch: 32 }\n    ];\n    teamSheet['!autofilter'] = { ref: `A1:E${Math.max(2, teamData.length + 1)}` };\n    teamSheet['!rows'] = [{ hpt: 24 }];\n    XLSX.utils.book_append_sheet(wb, teamSheet, 'Danh_Muc_Doi');\n""",
)

replace_once(
    floor,
    """      ['4', 'Giữ nguyên các cột kỹ thuật __recordId, __subItemId, __teamId, __workCategoryId khi chỉ chỉnh dữ liệu hiện có.'],\n      ['5', 'Sheet Danh_Muc_Doi chỉ để tham chiếu đội đã khai báo; nhập lại sẽ liên kết theo __teamId hoặc tên đội trùng khớp.']\n    ]);\n    XLSX.utils.book_append_sheet(wb, guideSheet, 'Huong_Dan');\n""",
    """      ['4', 'Các cột kỹ thuật __recordId, __subItemId, __teamId, __workCategoryId được ẩn để bảng dễ đọc nhưng vẫn được giữ nguyên khi Nhập Excel lại.'],\n      ['5', 'Sheet Danh_Muc_Doi chỉ để tham chiếu đội đã khai báo; nhập lại sẽ liên kết theo __teamId hoặc tên đội trùng khớp.'],\n      ['6', 'Nếu dữ liệu cũ chỉ có tên đội/hạng mục, khi Xuất Excel ứng dụng sẽ tự bổ sung ID nếu tên khớp chính xác danh mục hiện hành.']\n    ]);\n    guideSheet['!cols'] = [{ wch: 8 }, { wch: 100 }];\n    guideSheet['!rows'] = [{ hpt: 26 }];\n    XLSX.utils.book_append_sheet(wb, guideSheet, 'Huong_Dan');\n""",
)

css_text = css.read_text(encoding='utf-8')
css_patch = """

/* Project Manager active-project card: Tailwind gradient stop utilities keep their
 * light RGB values even after neutral/pale background guards run. Scope the fix to
 * the exact active-card gradient so dark mode stays dark without changing status UI. */
html[data-hnl-theme="dark"] .bg-gradient-to-r.from-indigo-50\\/90.to-blue-50\\/50 {
  background-image: linear-gradient(to right, rgb(49 46 129 / .42), rgb(30 64 175 / .28)) !important;
  border-color: rgb(99 102 241 / .66) !important;
}
"""
if 'Project Manager active-project card' not in css_text:
    css.write_text(css_text.rstrip() + css_patch, encoding='utf-8')


golden_text = golden.read_text(encoding='utf-8')
needle = """assert.match(source, /'Đội Thi Công': resolveExcelTeamName\\(subItem\\.teamId, subItem\\.assignedTeam\\)/, 'Sub-item team must be exported with durable team linkage');\n"""
insert = needle + """assert.match(source, /resolveExcelTeamId/, 'Excel export must recover durable team IDs from exact catalog names');\nassert.match(source, /resolveExcelCategoryId/, 'Excel export must recover durable work-category IDs from exact catalog names');\nassert.match(source, /roomSheet\\['!cols'\\]/, 'Room sheet must set readable column widths and hide technical IDs');\nassert.match(source, /roomSheet\\['!autofilter'\\]/, 'Room sheet must enable AutoFilter');\nassert.match(source, /subItemSheet\\['!cols'\\]/, 'Work-item sheet must set readable column widths and hide technical IDs');\nassert.match(source, /subItemSheet\\['!autofilter'\\]/, 'Work-item sheet must enable AutoFilter');\nassert.match(source, /teamSheet\\['!cols'\\]/, 'Team catalog must hide the technical team ID by default');\n"""
if needle not in golden_text:
    raise SystemExit('golden test insertion point not found')
golden.write_text(golden_text.replace(needle, insert, 1), encoding='utf-8')

print('Dark project card + Excel export layout/link repair staged successfully.')
