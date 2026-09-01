from pathlib import Path
import re

pdf = Path('src/components/ExportPdfModal.tsx')
header = Path('src/components/GoogleAuthHeader.tsx')
text = pdf.read_text(encoding='utf-8')

old = """    .map((d, index) => {\n      const displayCode = getDefectShortCode(d.id);\n      const markerCode = displayCode.replace(/^DF-/, '');\n      return {\n        ...d,\n        markerNumber: index + 1,\n        markerCode,\n        displayCode,"""
new = """    .map((d, index) => {\n      const markerNumber = index + 1;\n      const digits = filteredDefects.length >= 100 ? 3 : 2;\n      const markerCode = String(markerNumber).padStart(digits, '0');\n      // One visible code follows the user's selected PDF marker style everywhere.\n      const displayCode = pdfDefectCodeStyle === 'df' ? `DF-${markerCode}` : markerCode;\n      return {\n        ...d,\n        markerNumber,\n        markerCode,\n        displayCode,"""
if old not in text:
    raise SystemExit('stable defect display-code block not found')
text = text.replace(old, new, 1)

room_legend = """<p style=\"margin: 0 0 4px 0; font-size: 9.5px; font-weight: bold; color: #1e1b4b;\">Chú giải mã vị trí khu vực / phòng (${h(formatFloorName(fp.floorName))}):</p>"""
if room_legend not in text:
    raise SystemExit('room legend title not found')
text = text.replace(room_legend, room_legend + """\n                          <p style=\"margin: 0 0 5px 0; font-size: 8.5px; color: #64748b;\">🟣 Ký hiệu tím = Căn/Phòng. Mã trên bản vẽ khớp với cột Mã trong bảng chú giải.</p>""", 1)

defect_legend = """<p style=\"margin: 0 0 4px 0; font-size: 9.5px; font-weight: bold; color: #9f1239;\">Chú giải vị trí Defect trên bản vẽ (${h(formatFloorName(fp.floorName))}):</p>"""
if defect_legend not in text:
    raise SystemExit('defect legend title not found')
text = text.replace(defect_legend, defect_legend + """\n                          <p style=\"margin: 0 0 5px 0; font-size: 8.5px; color: #64748b;\">🔴 Ký hiệu đỏ = Defect. Mã trên bản vẽ, danh sách Defect và phụ lục ảnh dùng cùng một mã hiển thị.</p>""", 1)

appendix_desc = """<div style=\"font-size: 9px; color: #334155; margin-bottom: 6px;\">Mô tả: ${h(d.description)}</div>"""
if appendix_desc not in text:
    raise SystemExit('defect appendix description line not found')
text = text.replace(appendix_desc, """<div style=\"font-size: 9px; color: #334155; margin-bottom: 2px;\">Mô tả: ${h(d.description)}</div>\n                      <div style=\"font-size: 7.8px; color: #94a3b8; margin-bottom: 6px;\">Mã hệ thống: ${h(getDefectShortCode(d.id))}</div>""", 1)
pdf.write_text(text, encoding='utf-8')

h = header.read_text(encoding='utf-8')
project_id_block = re.compile(r'''\n                  \{projectId && \(\n                    <span\n                      className="text-\[8px\] sm:text-\[9px\] text-slate-500 font-mono truncate"\n                      title=\{`Project ID: \$\{projectId\}`\}\n                    >\n                      ID \{projectId\.slice\(0, 8\)\}\n                    <\/span>\n                  \)\}''')
if not project_id_block.search(h):
    raise SystemExit('project ID header block not found')
h = project_id_block.sub('', h, count=1)

old_time = """                    <span className=\"text-[9px] sm:text-[10px] text-slate-400\">\n                      {formatDateTime(lastUpdatedAt)}\n                    </span>"""
new_time = """                    <span className=\"text-[9px] sm:text-[10px] text-slate-400\" title=\"Thời điểm dữ liệu dự án được nhập/cập nhật gần nhất\">\n                      {formatDateTime(lastUpdatedAt)}\n                    </span>"""
if old_time not in h:
    raise SystemExit('last updated timestamp block not found')
h = h.replace(old_time, new_time, 1)
header.write_text(h, encoding='utf-8')

print('PDF marker/legend + compact header patch applied')
