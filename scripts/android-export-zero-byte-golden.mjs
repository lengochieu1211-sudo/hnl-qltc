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
const renderer=fs.readFileSync('android-wrapper/src/com/qlct/app/ReportPdfRenderer.java','utf8');
const report=fs.readFileSync('src/components/ExportPdfModal.tsx','utf8');
const excel=fs.readFileSync('src/utils/excelExport.ts','utf8');
assert(renderer.includes('createPrintDocumentAdapter(fileName)')
  && renderer.includes('adapter.onLayout(') && renderer.includes('adapter.onWrite(')
  && renderer.includes('onWriteFinished(PageRange[] pages)'),
  'Android report PDFs must be genuine WebView-rendered PDF bytes, not HTML with a .pdf extension');
assert(android.includes('public boolean exportHtmlPdfFile(')
  && android.includes('"downloads".equals(destination)') && android.includes('"picker".equals(destination)')
  && android.includes('"share".equals(destination)'),
  'Android export bridge must explicitly support QLTC downloads, SAF picker and native share');
assert(android.includes('!"%PDF".equals(new String(header,StandardCharsets.US_ASCII))')
  && android.includes('requireNonEmptyExport(file)')
  && android.includes('saveFileToDownloads(fileName,"application/pdf",file)')
  && android.includes('startCreateDocumentForExport(new PendingExport('),
  'Rendered PDFs must reject zero bytes/non-PDF and use existing verified download/picker paths');
assert(android.includes('PickerCacheProvider.AUTHORITY') && android.includes('Intent.FLAG_GRANT_READ_URI_PERMISSION'),
  'Native PDF share must only expose secure read-granted content URIs');
assert(js.includes('exportHtmlPdfFileOnAndroid') && js.includes('waitForAndroidResult(')
  && report.includes("handleAndroidPdfFileAction('downloads')")
  && report.includes("handleAndroidPdfFileAction('picker')")
  && report.includes("handleAndroidPdfFileAction('share')")
  && report.includes('onClick={handlePrintHTML}'),
  'Report panel must preserve Xem/In and expose distinct save/share/pick actions');
assert(report.includes('handleDownloadHtmlToQLTC')
  && report.includes("handleExportExcel('downloads')")
  && excel.includes("destination: 'picker' | 'downloads' = 'picker'"),
  'HTML and Excel must be directly downloadable to QLTC without changing their sheet contents');
console.log('ANDROID 0-BYTE EXPORT GUARDS: PASS');
