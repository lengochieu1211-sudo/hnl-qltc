import assert from 'node:assert/strict';
import fs from 'node:fs';
const modal = fs.readFileSync('src/components/ProjectManagerModal.tsx', 'utf8');
const photos = fs.readFileSync('src/utils/photoStorage.ts', 'utf8');
const fileExport = fs.readFileSync('src/utils/fileExport.ts', 'utf8');

// Every manual export step must be visible, with no guessed per-byte/percentage figure.
for (const phase of ["'reading'", "'photos'", "'packing'", "'saving'", "'error'"]) {
  assert(modal.includes(phase), `Missing export phase ${phase}`);
}
assert(modal.includes('data-hnl-json-export-progress="true"'), 'Progress overlay is not rendered');
assert(modal.includes('jsonExportRunningRef.current'), 'Repeated-click guard missing');
assert(modal.includes("window.setTimeout(resolve, 0)"), 'First progress paint is not yielded before serialization');
assert(modal.includes('aria-live="polite"'), 'Screen-reader status is missing');
assert(modal.includes('Đã xử lý {jsonExportProgress.completed}/{jsonExportProgress.total}'), 'Real processed count is not displayed');
assert(!modal.includes('Tệp sao lưu cục bộ đã được nén hoàn tất'), 'Do not misrepresent JSON as compressed');
assert(modal.includes("reportExport('error', 'Xuất JSON chưa hoàn tất'"), 'Failure status missing');
assert(modal.includes('setJsonExportProgress(null);\n      setExportedFileInfo({'), 'Success must close progress before confirming download');
assert(modal.includes('await downloadOrShareFile(filename, jsonString'), 'Existing Android/PC JSON export path changed');
assert(modal.includes('await encryptBackupData(finalDataToExport, exportPassword'), 'Existing AES-GCM path changed');
assert(modal.includes('await refreshProjectPhotoMetadataFromCloud(activeId)'), 'Single-project cloud photo metadata gate missing');
assert(modal.includes('await refreshProjectPhotoMetadataFromCloud(pId)'), 'Multi-project cloud photo metadata gate missing');
assert(modal.includes('await getProjectPhotosWithBinary(activeId, true, (done, total) =>'), 'Single-project real photo counter missing');
assert(modal.includes('await getProjectPhotosWithBinary(pId, true, (done, total) =>'), 'Multi-project real photo counter missing');
assert(modal.includes("onProgress?.('project', projectIndex + 1, uniqueIds.length, projectName)"), 'Actual project progress missing');
assert(photos.includes('onProgress?: (done: number, total: number) => void'), 'Optional photo progress API missing');
assert(photos.includes('onProgress?.(results.length, photos.length)'), 'Photo callback must be emitted after a processed binary');
assert(photos.indexOf("if (requireBinary && !String(base64 || '').startsWith('data:image/'))") < photos.indexOf('onProgress?.(results.length, photos.length)'), 'Missing-image gate must precede progress callback');
assert(fileExport.includes('saveTextChunksToAndroid(chunkText(text), safeName, mimeType'), 'Android streaming text bridge missing');
assert(fileExport.includes('const ANDROID_TEXT_CHUNK_SIZE = 32 * 1024'), 'Android safe text-chunk behavior changed');
console.log('DEV BACKUP JSON EXPORT PROGRESS GOLDEN PASS (scope, real progress, encryption, Android, missing-photo safeguards)');
