import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const fail = (message) => {
  console.error('IMAGE EDITOR GOLDEN FAIL:', message);
  process.exit(1);
};
const pass = (message) => console.log('PASS IMAGE EDITOR:', message);

const editor = read('src/components/ImageEditorModal.tsx');
const picker = read('src/components/PhotoAttachmentPicker.tsx');
const defect = read('src/components/FloorPlanDefectTab.tsx');
const storage = read('src/utils/photoStorage.ts');
const cloudSync = read('src/lib/photoCloudSync.ts');
const healthEngine = read('src/healthCenter/healthCenterEngine.ts');
const healthPanel = read('src/healthCenter/HealthCenterPanelBase.tsx');
const googleConfig = read('src/components/GoogleConfigTab.tsx');

for (const marker of [
  'type="button"',
  'onCompositionStart',
  'onCompositionEnd',
  'nativeEvent.isComposing',
  "imageKind?: 'defect' | 'crew'",
  'getImageQualityProfile(qualityKind)',
  "const qualityKind: ImageQualityKind = imageKind === 'crew' ? 'crew' : 'defect';",
  'gestureBaseRef',
  'ctx.imageSmoothingQuality = \'high\'',
  "useState<EditorTool>('pan')",
  "setActiveTool('pan')",
  'pointerMapRef',
  'pinchRef',
  "pointerMapRef.current.size >= 2",
  'onWheel={onWheel}',
  'ZoomIn',
  'ZoomOut',
  'Maximize2',
  'Di chuyển / Zoom',
  'PINCH_GESTURE_ROLLBACK',
  "import { createPortal } from 'react-dom';",
  'createPortal(editorModal, document.body)',
  'h-[100dvh]',
  'max-h-[100dvh]',
  'flex-1 min-h-0',
  'max-w-full max-h-full',
  'md:flex-row md:items-center',
  'md:min-w-48 md:shrink-0',
]) {
  if (!editor.includes(marker)) fail(`ImageEditorModal missing ${marker}`);
}
if (editor.includes('window.innerWidth * 0.9') || editor.includes('window.innerHeight * 0.65')) {
  fail('ImageEditorModal still downsizes working pixels to viewport dimensions');
}
if (editor.includes('max-h-[70vh]')) {
  fail('ImageEditorModal still sizes canvas against whole viewport instead of remaining editor stage height');
}
if (editor.includes("setActiveTool('draw');")) {
  fail('ImageEditorModal still defaults to freehand drawing instead of pan/zoom');
}
pass('tool buttons are non-submit, Vietnamese IME is guarded, editor opens in pinch-safe pan/zoom mode, and the editor is portaled above clipped parent modals/desktop rail');

for (const marker of [
  'preserveEncodedSource?: boolean',
  'options.preserveEncodedSource && imageSource instanceof Blob',
  'pendingOwnerUid?: string',
  "photo.pendingOwnerUid || photo.createdByUid",
]) {
  if (!storage.includes(marker)) fail(`photoStorage missing ${marker}`);
}
if (!picker.includes('preserveEncodedSource: true')) fail('PhotoAttachmentPicker still re-encodes edited attachment output');
if (picker.includes('void uploadPhotoToCloud(projectId, editedPhotoMeta)')) fail('PhotoAttachmentPicker edited Cloud upload is still fire-and-forget');
if (!picker.includes('await uploadPhotoToCloud(projectId, editedPhotoMeta)')) fail('PhotoAttachmentPicker edited Cloud upload does not await durable upload');
if (!picker.includes("const retryDelays = [0, 400, 1200, 2500]")) fail('PhotoAttachmentPicker edited Cloud upload lacks bounded retry');
if (!picker.includes('cloudReady = await verifyPhotoBinaryReadyInCloud(projectId, photoId)')) fail('PhotoAttachmentPicker edited Cloud upload lacks ready verification');
if (!picker.includes('} finally {\n      setUploading(false);')) fail('PhotoAttachmentPicker edited save can leave upload state stuck');
if (!picker.includes("imageKind={entityType === 'defect' ? 'defect' : 'crew'}")) fail('PhotoAttachmentPicker does not pass Crew/Defect quality profile to editor');
if (!cloudSync.includes('delete copy.pendingOwnerUid')) fail('Local pending media owner must not leak into Firestore metadata');
pass('edited attachment save is single-encode, account-safe local-first and waits for verified Cloud readiness while online');

for (const marker of [
  'const invalidateViewerFullImages = () => {',
  "if (detail.source === 'cloud') invalidateViewerFullImages();",
  "const currentViewerPhotoId = viewablePhotos[viewerCurrentIndex]?.id || '';",
  "const viewablePhotoIdsKey = viewablePhotos.map((photo) => photo.id).join('|');",
  'viewerActivePhotoIdRef.current = photo.id;',
  'const nextIndex = viewablePhotos.findIndex((photo) => photo.id === viewerActivePhotoIdRef.current);',
  'if (viewingIndex === null || !currentViewerPhotoId || currentViewerFullUrl) return;',
  'void ensureViewerFullImage(viewerCurrentIndex);',
]) {
  if (!picker.includes(marker)) fail(`PhotoAttachmentPicker open-viewer realtime refresh missing ${marker}`);
}
pass('already-open full-resolution viewer preserves the active photo identity, drops stale object URLs and reloads after relevant Cloud photo changes');

for (const marker of ['photo_cache_version_', 'PhotoBinaryCacheVersion', 'isPhotoCachedBinaryCurrent', 'invalidatePhotoBinaryCache', 'staleLocalCache', 'cloudAcknowledgesOwnPending', 'pendingOwnedByCurrent && !cloudAcknowledgesOwnPending', "setPhotoBinaryCacheVersion(cleanCloud, 'cloud')"]) {
  if (!storage.includes(marker)) fail(`photoStorage stale edited-binary cache guard missing ${marker}`);
}
if (!cloudSync.includes('await isPhotoCachedBinaryCurrent(photo)')) fail('offline mirror still trusts any existing Blob without revision validation');
if (!cloudSync.includes('cachePhotoBlob(photoId, storageBlob, true, { id: photoId, projectId, ...meta } as PhotoAttachment)')) fail('Cloud download does not stamp cache provenance');
for (const marker of ['PHOTO_LOCAL_CACHE_STALE', 'PHOTO_BINARY_VERSION_MISMATCH', 'PHOTO_EDIT_PENDING_UPLOAD', 'PHOTO_CLOUD_BINARY_NOT_READY', 'PHOTO_LEGACY_BINARY_UNRECOVERABLE']) {
  if (!healthEngine.includes(marker)) fail(`Health Center photo rule missing ${marker}`);
}
if (!healthPanel.includes('photoDiagnostics')) fail('Health Center does not accept photo diagnostics');
if (!googleConfig.includes('photoDiagnostics={photoDiagnosticSnapshot}')) fail('Config does not feed photo diagnostics into Health Center');
pass('receiving devices invalidate stale edited-photo cache by Cloud revision/checksum while protecting pending edits, and Health surfaces photo sync state');

if (!defect.includes('let photoResultUrl = await readFileAsDataUrl(editedFile);')) {
  fail('legacy Defect editor still recompresses the already-edited file');
}
if (!defect.includes('imageKind="defect"')) fail('legacy Defect editor does not request Defect quality profile');
pass('Defect edited image avoids second compression pass');

console.log('IMAGE EDITOR GOLDEN PASS');
