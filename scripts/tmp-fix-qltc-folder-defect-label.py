from pathlib import Path

android = Path('android-wrapper/src/com/qlct/app/MainActivity.java')
text = android.read_text(encoding='utf-8')
replacements = {
    '"QLCT camera output"': '"QLTC camera output"',
    '"QLCT_IMG_" + System.currentTimeMillis() + ".jpg"': '"QLTC_IMG_" + System.currentTimeMillis() + ".jpg"',
    'Environment.DIRECTORY_PICTURES + "/QLCT"': 'Environment.DIRECTORY_PICTURES + "/QLTC"',
    '"Da luu file vao Download/QLCT: "': '"Da luu file vao Download/QLTC: "',
    'Environment.DIRECTORY_DOWNLOADS + "/QLCT"': 'Environment.DIRECTORY_DOWNLOADS + "/QLTC"',
    'Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "QLCT"': 'Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "QLTC"',
    '"Cannot create Download/QLCT"': '"Cannot create Download/QLTC"',
    'safe = "QLCT_" + System.currentTimeMillis();': 'safe = "QLTC_" + System.currentTimeMillis();',
}
changed = False
for old, new in replacements.items():
    if old in text:
        text = text.replace(old, new)
        changed = True
    elif new not in text:
        raise SystemExit(f'Neither old nor new Android token found: {old}')
if changed:
    android.write_text(text, encoding='utf-8')

pdf = Path('src/components/ExportPdfModal.tsx')
text = pdf.read_text(encoding='utf-8')
wrong = '                      <div style="font-size: 8px; color: #94a3b8; margin: -3px 0 4px;">Mã hệ thống: ${h(d.displayCode)}</div>\n'
if wrong in text:
    text = text.replace(wrong, '', 1)
    pdf.write_text(text, encoding='utf-8')
elif 'Mã hệ thống: ${h(getDefectShortCode(d.id))}' not in text:
    raise SystemExit('Expected final Defect system-code line missing')

android_text = android.read_text(encoding='utf-8')
assert 'Download/QLCT' not in android_text
assert 'DIRECTORY_DOWNLOADS + "/QLCT"' not in android_text
assert 'Download/QLTC' in android_text
pdf_text = pdf.read_text(encoding='utf-8')
assert 'Mã hệ thống: ${h(d.displayCode)}' not in pdf_text
assert 'Mã hệ thống: ${h(getDefectShortCode(d.id))}' in pdf_text
print('QLTC folder + Defect appendix patch verified.')
