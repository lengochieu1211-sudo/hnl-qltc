import fs from 'node:fs';
import assert from 'node:assert/strict';
const android = fs.readFileSync('android-wrapper/src/com/qlct/app/MainActivity.java','utf8');
const js = fs.readFileSync('src/utils/fileExport.ts','utf8');
const count = (s,part) => s.split(part).length-1;
assert(count(android,'requireNonEmptyExport(export.tempFile)') >= 3,'All native chunk finish paths must reject zero-byte temp files');
assert(android.includes('verifySavedFile(uri, export.tempFile)'), 'Android SAF must verify written file with readback SHA256');
assert(android.includes('verifySavedFile(uri, sourceFile)'), 'Android Downloads must verify file after write');
assert(android.includes('MessageDigest.isEqual(expected, actual)'), 'Readback must check content integrity not only entry creation');
assert(count(android,'MediaStore.MediaColumns.IS_PENDING, 1')===2,'Downloads must remain pending until verified');
assert(count(android,'MediaStore.MediaColumns.IS_PENDING, 0')===2,'Downloads are published only after verify');
assert(count(android,'if (!published) getContentResolver().delete(uri, null, null)')===2,'Failed pending downloads must be cleaned up');
assert(count(js,'blob.size <= 0')===2,'Both export and download routes must reject empty blobs');
assert(android.indexOf('verifySavedFile(uri, export.tempFile)')<android.indexOf('private Uri getAutoSaveTreeUri()'),'SAF readback is part of savePendingExportToUri');
const report=fs.readFileSync('src/components/ExportPdfModal.tsx','utf8');
const excel=fs.readFileSync('src/utils/excelExport.ts','utf8');
assert(android.includes('public void saveHtmlPdf(') && android.includes('openPrintManager(fileName)')
  && android.includes('printManager.print(fileName, adapter, attributes)'),
  'Android report PDF must use supported PrintManager and show the system Save as PDF option');
assert(!report.includes('exportHtmlPdfFileOnAndroid') && !android.includes('public boolean exportHtmlPdfFile('),
  'Never pretend direct PDF saving is supported through inaccessible hidden print callbacks');
assert(report.includes('Lưu HTML vào Tải xuống/QLTC')
  && report.includes('Lưu Excel vào Tải xuống/QLTC')
  && report.includes('saveTextFileToDownloads(getReportHtml()')
  && report.includes("handleExportExcel(isAndroidExportBridgeAvailable() ? 'downloads' : 'picker')")
  && report.includes("handleExportExcel('picker')"),
  'Both HTML and Excel need direct QLTC download actions on APK, without changing report data');
assert(excel.includes("destination: 'picker' | 'downloads' = 'picker'")
  && js.includes("destination === 'downloads'"),
  'Excel must retain legacy picker and support verified direct downloads');
assert(['pdf', 'xlsx', 'html'].every(format => report.includes('data-hnl-report-format="'+format+'"'))
  && report.includes('data-hnl-report-other-save="true"')
  && report.includes('Sao chép tóm tắt để gửi Zalo / Email'),
  'Report UI must keep three concise formats and optional Android export destinations');
console.log('ANDROID 0-BYTE EXPORT GUARDS: PASS');
