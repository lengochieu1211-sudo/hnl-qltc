from pathlib import Path
import re

root = Path('.')
pdf = root / 'src/components/ExportPdfModal.tsx'
header = root / 'src/components/GoogleAuthHeader.tsx'

text = pdf.read_text(encoding='utf-8')

old = """    .map((d, index) => {\n      const displayCode = getDefectShortCode(d.id);\n      const markerCode = displayCode.replace(/^DF-/, '');\n      return {\n        ...d,\n        markerNumber: index + 1,\n        markerCode,\n        displayCode,"""
new = """    .map((d, index) => {\n      const markerNumber = index + 1;\n      const digits = filteredDefects.length >= 100 ? 3 : 2;\n      const markerCode = String(markerNumber).padStart(digits, '0');\n      // One visible code follows the user's PDF marker setting everywhere:\n      // map marker -> map legend -> defect table -> defect photo appendix.\n      const displayCode = pdfDefectCodeStyle === 'df' ? `DF-${markerCode}` : markerCode;\n      return {\n        ...d,\n        markerNumber,\n        markerCode,\n        displayCode,"""
if old not in text:
    raise SystemExit('stable defect display-code block not found')
text = text.replace(old, new, 1)

# Make the room legend explain the visual language once, close to the map.
needle = """<p style=\"margin: 0 0 4px 0; font-size: 9.5px; font-weight: bold; color: #1e1b4b;\">Chú giải mã vị trí khu vực / phòng (${h(formatFloorName(fp.floorName))}):</p>"""
replacement = needle + """\n                          <p style=\"margin: 0 0 5px 0; font-size: 8.5px; color: #64748b;\">🟣 Ký hiệu tím = Căn/Phòng. Mã hiển thị khớp với cột Mã trong bảng chú giải.</p>"""
if needle not in text:
    raise SystemExit('room legend title not found')
text = text.replace(needle, replacement, 1)

needle = """<p style=\"margin: 0 0 4px 0; font-size: 9.5px; font-weight: bold; color: #9f1239;\">Chú giải vị trí Defect trên bản vẽ (${h(formatFloorName(fp.floorName))}):</p>"""
replacement = needle + """\n                          <p style=\"margin: 0 0 5px 0; font-size: 8.5px; color: #64748b;\">🔴 Ký hiệu đỏ = Defect. Mã trên bản vẽ, bảng Defect và phụ lục ảnh dùng cùng một mã hiển thị.</p>"""
if needle not in text:
    raise SystemExit('defect legend title not found')
text = text.replace(needle, replacement, 1)

# Add the technical/system code only as a secondary traceability note in the photo appendix.
needle = """<div style=\"font-size: 9px; color: #334155; margin-bottom: 6px;\">Mô tả: ${h(d.description)}</div>"""
replacement = """<div style=\"font-size: 9px; color: #334155; margin-bottom: 2px;\">Mô tả: ${h(d.description)}</div>\n                      <div style=\"font-size: 7.8px; color: #94a3b8; margin-bottom: 6px;\">Mã hệ thống: ${h(getDefectShortCode(d.id))}</div>"""
if needle not in text:
    raise SystemExit('defect appendix description line not found')
text = text.replace(needle, replacement, 1)

# Insert Defect sorting into the common per-section sorting panel, immediately before Checklist.
checklist_label = """              <label className=\"space-y-1\">\n                <span className=\"block text-[10px] font-bold text-slate-600\">Checklist</span>"""
defect_label = """              <label className=\"space-y-1\">\n                <span className=\"block text-[10px] font-bold text-slate-600\">Defect + phụ lục ảnh</span>\n                <select value={defectReportSortMode} onChange={(e) => setDefectReportSortMode(e.target.value as typeof defectReportSortMode)} className=\"w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold\">\n                  <option value=\"floor-room-category\">Tầng → Phòng/Căn → Hạng mục</option>\n                  <option value=\"room-floor-category\">Phòng/Căn → Tầng → Hạng mục</option>\n                  <option value=\"category-floor-room\">Hạng mục → Tầng → Phòng/Căn</option>\n                  <option value=\"created-desc\">Defect mới nhất → cũ nhất</option>\n                  <option value=\"status-due\">Trạng thái / hạn → Tầng</option>\n                </select>\n              </label>\n"""
if checklist_label not in text:
    raise SystemExit('checklist sort label not found')
text = text.replace(checklist_label, defect_label + checklist_label, 1)

# Remove the old duplicate Defect sorting selector but keep its three filters below as one compact filter block.
pattern = re.compile(r'''\n          \{\/\* Defect list grouping\/sorting - display-only; map marker placement is intentionally unchanged\. \*\/\}\n          <div className="space-y-1\.5">\n            <label className="block text-slate-700 font-bold">Sắp xếp &amp; nhóm danh sách Defect<\/label>\n            <select\n              value=\{defectReportSortMode\}\n              onChange=\{\(e\) => setDefectReportSortMode\(e\.target\.value as typeof defectReportSortMode\)\}\n              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"\n            >\n              <option value="floor-room-category">Tầng → Phòng/Căn → Hạng mục<\/option>\n              <option value="room-floor-category">Phòng/Căn → Tầng → Hạng mục<\/option>\n              <option value="category-floor-room">Hạng mục → Tầng → Phòng/Căn<\/option>\n              <option value="created-desc">.*?<\/option>\n              <option value="status-due">.*?<\/option>\n            <\/select>''', re.S)
match = pattern.search(text)
if not match:
    raise SystemExit('old defect sort selector not found')
text = text[:match.start()] + '\n          {/* Defect filters; sorting now lives in the common per-section panel above. */}\n          <div className="space-y-1.5">\n            <label className="block text-slate-700 font-bold">Lọc Defect trong báo cáo</label>' + text[match.end():]

pdf.write_text(text, encoding='utf-8')

h = header.read_text(encoding='utf-8')
# Project ID is technical metadata; keep the prop for project-switch state alignment but hide it from the normal header.
project_id_block = re.compile(r'''\n                  \{projectId && \(\n                    <span\n                      className="text-\[8px\] sm:text-\[9px\] text-slate-500 font-mono truncate"\n                      title=\{`Project ID: \$\{projectId\}`\}\n                    >\n                      ID \{projectId\.slice\(0, 8\)\}\n                    <\/span>\n                  \)\}''')
if not project_id_block.search(h):
    raise SystemExit('project ID header block not found')
h = project_id_block.sub('', h, count=1)

# Clarify semantics without adding visual clutter: this timestamp is the latest project data change.
old_time = """                    <span className=\"text-[9px] sm:text-[10px] text-slate-400\">\n                      {formatDateTime(lastUpdatedAt)}\n                    </span>"""
new_time = """                    <span className=\"text-[9px] sm:text-[10px] text-slate-400\" title=\"Thời điểm dữ liệu dự án được nhập/cập nhật gần nhất\">\n                      {formatDateTime(lastUpdatedAt)}\n                    </span>"""
if old_time not in h:
    raise SystemExit('last updated header timestamp block not found')
h = h.replace(old_time, new_time, 1)

header.write_text(h, encoding='utf-8')
print('PDF marker/sort + compact header patch applied')
