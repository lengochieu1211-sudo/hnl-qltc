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

needle = """<div style=\"font-size: 9px; color: #334155; margin-bottom: 6px;\">Mô tả: ${h(d.description)}</div>"""
replacement = """<div style=\"font-size: 9px; color: #334155; margin-bottom: 2px;\">Mô tả: ${h(d.description)}</div>\n                      <div style=\"font-size: 7.8px; color: #94a3b8; margin-bottom: 6px;\">Mã hệ thống: ${h(getDefectShortCode(d.id))}</div>"""
if needle not in text:
    raise SystemExit('defect appendix description line not found')
text = text.replace(needle, replacement, 1)

checklist_label = """              <label className=\"space-y-1\">\n                <span className=\"block text-[10px] font-bold text-slate-600\">Checklist</span>"""
defect_label = """              <label className=\"space-y-1\">\n                <span className=\"block text-[10px] font-bold text-slate-600\">Defect + phụ lục ảnh</span>\n                <select value={defectReportSortMode} onChange={(e) => setDefectReportSortMode(e.target.value as typeof defectReportSortMode)} className=\"w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold\">\n                  <option value=\"floor-room-category\">Tầng → Phòng/Căn → Hạng mục</option>\n                  <option value=\"room-floor-category\">Phòng/Căn → Tầng → Hạng mục</option>\n                  <option value=\"category-floor-room\">Hạng mục → Tầng → Phòng/Căn</option>\n                  <option value=\"created-desc\">Defect mới nhất → cũ nhất</option>\n                  <option value=\"status-due\">Trạng thái / hạn → Tầng</option>\n                </select>\n              </label>\n"""
if checklist_label not in text:
    raise SystemExit('checklist sort label not found')
text = text.replace(checklist_label, defect_label + checklist_label, 1)

# Remove duplicate Defect sort selector by its visible label; keep the filter grid below it.
label_token = 'Sắp xếp &amp; nhóm danh sách Defect'
filter_token = '<div className="grid grid-cols-1 sm:grid-cols-3 gap-2">'
label_pos = text.find(label_token)
if label_pos < 0:
    raise SystemExit('duplicate Defect sort visible label not found')
container_pos = text.rfind('<div className="space-y-1.5">', 0, label_pos)
if container_pos < 0:
    raise SystemExit('duplicate Defect sort container not found')
line_start = text.rfind('\n', 0, container_pos)
line_start = container_pos if line_start < 0 else line_start + 1
filter_pos = text.find(filter_token, label_pos)
if filter_pos < 0:
    raise SystemExit('Defect filter grid not found after duplicate sort label')
filter_line_start = text.rfind('\n', 0, filter_pos)
filter_line_start = filter_pos if filter_line_start < 0 else filter_line_start + 1
replacement_start = '          {/* Defect filters; sorting now lives in the common per-section panel above. */}\n          <div className="space-y-1.5">\n            <label className="block text-slate-700 font-bold">Lọc Defect trong báo cáo</label>\n'
text = text[:line_start] + replacement_start + text[filter_line_start:]

pdf.write_text(text, encoding='utf-8')

h = header.read_text(encoding='utf-8')
project_id_block = re.compile(r'''\n                  \{projectId && \(\n                    <span\n                      className="text-\[8px\] sm:text-\[9px\] text-slate-500 font-mono truncate"\n                      title=\{`Project ID: \$\{projectId\}`\}\n                    >\n                      ID \{projectId\.slice\(0, 8\)\}\n                    <\/span>\n                  \)\}''')
if not project_id_block.search(h):
    raise SystemExit('project ID header block not found')
h = project_id_block.sub('', h, count=1)

old_time = """                    <span className=\"text-[9px] sm:text-[10px] text-slate-400\">\n                      {formatDateTime(lastUpdatedAt)}\n                    </span>"""
new_time = """                    <span className=\"text-[9px] sm:text-[10px] text-slate-400\" title=\"Thời điểm dữ liệu dự án được nhập/cập nhật gần nhất\">\n                      {formatDateTime(lastUpdatedAt)}\n                    </span>"""
if old_time not in h:
    raise SystemExit('last updated header timestamp block not found')
h = h.replace(old_time, new_time, 1)

header.write_text(h, encoding='utf-8')
print('PDF marker/sort + compact header patch applied')
