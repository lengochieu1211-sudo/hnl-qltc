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
assert(android.includes('public void saveHtmlPdf(') && android.includes('openPrintManager(fileName, view)')
  && android.includes('printManager.print(fileName, adapter, attributes)'),
  'Android report PDF must use supported PrintManager and show the system Save as PDF option');
assert(!report.includes('exportHtmlPdfFileOnAndroid') && !android.includes('public boolean exportHtmlPdfFile('),
  'Never pretend direct PDF saving is supported through inaccessible hidden print callbacks');
assert(report.includes('Tải HTML (.html)')
  && report.includes('Lưu Excel vào Tải xuống/QLTC')
  && report.includes('saveTextFileToDownloads(getReportHtml()')
  && report.includes("await handleExportExcel(isAndroidExportBridgeAvailable() ? 'downloads' : 'picker')")
  && report.includes("handleExportExcel('picker')"),
  'Both HTML and Excel need direct QLTC download actions on APK, without changing report data');
assert(excel.includes("destination: 'picker' | 'downloads' = 'picker'")
  && js.includes("destination === 'downloads'"),
  'Excel must retain legacy picker and support verified direct downloads');
assert(['text', 'pdf', 'xlsx'].every(format => report.includes('data-hnl-report-format="'+format+'"'))
  && !report.includes('data-hnl-report-format="html"')
  && report.includes('data-hnl-report-secondary-format="html"')
  && report.includes('data-hnl-report-other-save="true"')
  && report.includes('aria-label="Tùy chọn xuất khác"')
  && report.includes('handleCopySummaryText()'),
  'Report must keep only Content/PDF/Excel as primary buttons and preserve optional HTML');
assert(!report.includes('Nội dung: sao chép tóm tắt')
  && !report.includes('Tùy chọn khác: tải HTML / chọn nơi lưu')
  && !report.includes('Chia sẻ / chọn nơi lưu HTML'),
  'Report footer must not clutter the three primary buttons with duplicated explanations');
assert(report.includes('reportExportInFlightRef.current = true')
  && report.includes('await waitForReportPaint()')
  && report.includes('data-hnl-report-export-pending="true"')
  && report.includes("runReportExport('pdf')")
  && report.includes("runReportExport('xlsx')")
  && report.includes("runReportExport('html')"),
  'PDF/Excel and optional HTML must respond with a pending state before heavy work and prevent duplicate taps');
assert(report.includes("window.open('about:blank', '_blank')")
  && report.includes('readyPrintWindow.location.replace(blobUrl)')
  && report.includes("typeof window.AndroidExport?.saveHtmlPdf !== 'function'"),
  'PDF must keep popup activation on the original browser click and leave native Android PrintManager unchanged');
assert(report.includes("await navigator.clipboard.writeText(text)")
  && report.includes("document.execCommand('copy')")
  && report.includes("setCopiedText(true)")
  && report.includes("setCopiedText(false)"),
  'Content button must copy actual report text and show success only after clipboard confirmation');
assert(!android.includes('printWebView.setAlpha(0f)')
  && android.includes('ViewGroup.LayoutParams.MATCH_PARENT,')
  && android.includes('postVisualStateCallback(')
  && android.includes('contentAdapter.onWrite(pages, destination, cancellationSignal, callback)')
  && android.includes('contentAdapter.onFinish()')
  && android.includes('finishReportPrinting(pdfView)')
  && android.includes('pdfPrintInProgress = true'),
  'Android PDF must print from a full-size rendered WebView and keep it alive until PrintManager finishes');
const warehouseShare = fs.readFileSync('src/components/WarehouseVoucherShareSheet.tsx', 'utf8');
const header = fs.readFileSync('src/components/GoogleAuthHeader.tsx', 'utf8');
assert(report.includes('border border-red-600 bg-red-600')
  && report.includes('border border-blue-600 bg-blue-600')
  && warehouseShare.includes('border-red-600 bg-red-600')
  && warehouseShare.includes('border-blue-600 bg-blue-600'),
  'Report PDF and Excel buttons must reuse the exact warehouse share color/hover/focus styling');
assert(header.includes('bg-indigo-700 hover:bg-indigo-800') && header.includes('border border-indigo-500') && !header.includes('ring-1 ring-sky-300/60'),
  'Project header action must remain clear without an unrelated bright cyan ring');
console.log('ANDROID 0-BYTE EXPORT GUARDS: PASS');
