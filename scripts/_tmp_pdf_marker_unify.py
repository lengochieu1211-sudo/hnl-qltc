from pathlib import Path
import re

pdf_path = Path('src/components/ExportPdfModal.tsx')
text = pdf_path.read_text(encoding='utf-8')
orig = text

# 1) Extend Defect sort modes with explicit display-code order.
old = "useState<'floor-room-category' | 'room-floor-category' | 'category-floor-room' | 'created-desc' | 'status-due'>('floor-room-category')"
new = "useState<'floor-room-category' | 'room-floor-category' | 'category-floor-room' | 'created-desc' | 'status-due' | 'code-asc' | 'code-desc'>('floor-room-category')"
assert old in text, 'defect sort state signature not found'
text = text.replace(old, new, 1)

# 2) Make code sorting use the same short marker number that appears on the map/list/photo appendix.
needle = "    if (defectReportSortMode === 'status-due') {\n      const statusCmp = compareTextVi(a.status, b.status);"
insert = "    if (defectReportSortMode === 'code-asc') return (Number(a.markerNumber) || 0) - (Number(b.markerNumber) || 0);\n    if (defectReportSortMode === 'code-desc') return (Number(b.markerNumber) || 0) - (Number(a.markerNumber) || 0);\n    if (defectReportSortMode === 'status-due') {\n      const statusCmp = compareTextVi(a.status, b.status);"
assert needle in text, 'defect comparator insertion point not found'
text = text.replace(needle, insert, 1)

needle = "    if (defectReportSortMode === 'status-due') return `Trạng thái: ${defect.status}`;\n    return `${formatFloorName(defect.floorName)} · ${getDefectRoomName(defect)}`;"
replace = "    if (defectReportSortMode === 'status-due') return `Trạng thái: ${defect.status}`;\n    if (defectReportSortMode === 'code-asc' || defectReportSortMode === 'code-desc') return 'Theo mã Defect hiển thị';\n    return `${formatFloorName(defect.floorName)} · ${getDefectRoomName(defect)}`;"
assert needle in text, 'defect group insertion point not found'
text = text.replace(needle, replace, 1)

# 3) Put Defect sorting inside the shared "Sắp xếp từng phần trong PDF" panel.
needle = '''                </select>\n              </label>\n            </div>\n            <p className="px-3 pb-3 text-[10px] text-slate-500">Phụ lục ảnh Defect đi theo thứ tự Defect bên dưới; phụ lục ảnh nhân công đi theo đúng thứ tự Nhật ký nhân công.</p>'''
replace = '''                </select>\n              </label>\n              <label className="space-y-1">\n                <span className="block text-[10px] font-bold text-slate-600">Defect + phụ lục ảnh Defect</span>\n                <select value={defectReportSortMode} onChange={(e) => setDefectReportSortMode(e.target.value as typeof defectReportSortMode)} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold">\n                  <option value="floor-room-category">Tầng → Phòng/Căn → Hạng mục</option>\n                  <option value="room-floor-category">Phòng/Căn → Tầng → Hạng mục</option>\n                  <option value="category-floor-room">Hạng mục → Tầng → Phòng/Căn</option>\n                  <option value="created-desc">Defect mới nhất → cũ nhất</option>\n                  <option value="status-due">Trạng thái → Hạn xử lý → Tầng/Phòng</option>\n                  <option value="code-asc">Mã Defect 01 → 02 → 03</option>\n                  <option value="code-desc">Mã Defect lớn → nhỏ</option>\n                </select>\n              </label>\n            </div>\n            <p className="px-3 pb-3 text-[10px] text-slate-500">Phụ lục ảnh Defect đi đúng thứ tự Defect đã chọn; phụ lục ảnh nhân công đi theo đúng thứ tự Nhật ký nhân công.</p>'''
assert needle in text, 'shared sort panel end not found'
text = text.replace(needle, replace, 1)

# 4) Remove the duplicate standalone Defect sorting select but retain the three Defect filters.
pattern = re.compile(r'''\n\s*\{\/\* Defect list grouping\/sorting - display-only; map marker placement is intentionally unchanged\. \*\/\}\n\s*<div className="space-y-1\.5">\n\s*<label className="block text-slate-700 font-bold">Sắp xếp &amp; nhóm danh sách Defect<\/label>\n\s*<select\n\s*value=\{defectReportSortMode\}\n\s*onChange=\{\(e\) => setDefectReportSortMode\(e\.target\.value as typeof defectReportSortMode\)\}\n\s*className="[^"]+"\n\s*>.*?<\/select>''', re.S)
m = pattern.search(text)
assert m, 'standalone Defect sort block not found'
replacement = '''\n\n          {/* Defect filters - sorting lives in the shared per-section PDF sorting panel above. */}\n          <div className="space-y-1.5">\n            <label className="block text-slate-700 font-bold">Bộ lọc Defect</label>'''
text = text[:m.start()] + replacement + text[m.end():]

# 5) Add a compact legend before floor maps so room/Defect codes are self-explanatory.
needle = '''          <div class="section-title">🖼️ MẶT BẰNG CĂN / PHÒNG &amp; SƠ ĐỒ DEFECT</div>\n          ${targetFloorPlans.map(fp => {'''
replace = '''          <div class="section-title">🖼️ MẶT BẰNG CĂN / PHÒNG &amp; SƠ ĐỒ DEFECT</div>\n          <div class="page-break-avoid" style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:0 0 10px;padding:7px 9px;border:1px solid #cbd5e1;border-radius:7px;background:#f8fafc;font-size:8.8px;color:#475569;">\n            <span><strong style="color:#4f46e5;">● Căn/Phòng:</strong> ${pdfRoomCodeStyle === 'hash' ? '#1, #2…' : pdfRoomCodeStyle === 'room' ? 'C1, C2…' : '1, 2, 3…'}</span>\n            <span><strong style="color:#e11d48;">● Defect:</strong> ${pdfDefectCodeStyle === 'df' ? 'DF-01, DF-02…' : '01, 02, 03…'}</span>\n            <span>Số/mã trên bản vẽ khớp với bảng chú giải, danh sách Defect và phụ lục ảnh.</span>\n            <span style="color:#64748b;">Mã hệ thống DF-xxxx chỉ dùng để truy vết kỹ thuật.</span>\n          </div>\n          ${targetFloorPlans.map(fp => {'''
assert needle in text, 'floor-plan report section title not found'
text = text.replace(needle, replace, 1)

# 6) Photo appendix must use the same display code as map + legend + defect table.
needle = '''<span style="color: #e11d48; font-weight: 900;">${d.displayCode} - ${h(d.category)}</span>'''
replace = '''<span style="color: #e11d48; font-weight: 900;">Defect ${getDefectMapCode(d)} - ${h(d.category)}</span>'''
assert needle in text, 'Defect photo appendix technical-code title not found'
text = text.replace(needle, replace, 1)

needle = '''                      <div style="font-size: 9px; color: #334155; margin-bottom: 6px;">Mô tả: ${h(d.description)}</div>'''
replace = '''                      <div style="font-size: 8px; color: #94a3b8; margin: -3px 0 4px;">Mã hệ thống: ${h(d.displayCode)}</div>\n                      <div style="font-size: 9px; color: #334155; margin-bottom: 6px;">Mô tả: ${h(d.description)}</div>'''
assert needle in text, 'Defect photo appendix description line not found'
text = text.replace(needle, replace, 1)

assert text != orig
pdf_path.write_text(text, encoding='utf-8')

# 7) Header: logo + project name is enough; remove the redundant small blue app-name line.
header_path = Path('src/components/GoogleAuthHeader.tsx')
header = header_path.read_text(encoding='utf-8')
header_orig = header
line = '                <div className="text-[8px] sm:text-[9px] font-extrabold uppercase tracking-widest text-indigo-300 truncate">{appDisplayName}</div>\n'
assert line in header, 'redundant app display-name line not found in header'
header = header.replace(line, '', 1)
assert header != header_orig
header_path.write_text(header, encoding='utf-8')

print('PATCH_OK')
