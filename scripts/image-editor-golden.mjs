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
]) {
  if (!editor.includes(marker)) fail(`ImageEditorModal missing ${marker}`);
}
if (editor.includes('window.innerWidth * 0.9') || editor.includes('window.innerHeight * 0.65')) {
  fail('ImageEditorModal still downsizes working pixels to viewport dimensions');
}
if (editor.includes("setActiveTool('draw');")) {
  fail('ImageEditorModal still defaults to freehand drawing instead of pan/zoom');
}
pass('tool buttons are non-submit, Vietnamese IME is guarded, and editor opens in pinch-safe pan/zoom mode');

for (const marker of [
  'preserveEncodedSource?: boolean',
  'options.preserveEncodedSource && imageSource instanceof Blob',
]) {
  if (!storage.includes(marker)) fail(`photoStorage missing ${marker}`);
}
if (!picker.includes('preserveEncodedSource: true')) fail('PhotoAttachmentPicker still re-encodes edited attachment output');
if (!picker.includes('void uploadPhotoToCloud(projectId, editedPhotoMeta)')) fail('PhotoAttachmentPicker edited Cloud upload is not background/local-first');
if (!picker.includes("imageKind={entityType === 'defect' ? 'defect' : 'crew'}")) fail('PhotoAttachmentPicker does not pass Crew/Defect quality profile to editor');
pass('edited attachment save is single-encode and local-first');

if (!defect.includes('let photoResultUrl = await readFileAsDataUrl(editedFile);')) {
  fail('legacy Defect editor still recompresses the already-edited file');
}
if (!defect.includes('imageKind="defect"')) fail('legacy Defect editor does not request Defect quality profile');
pass('Defect edited image avoids second compression pass');

console.log('IMAGE EDITOR GOLDEN PASS');
