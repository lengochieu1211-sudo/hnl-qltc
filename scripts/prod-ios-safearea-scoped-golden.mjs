import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const css = read('src/index.css');
const windows = [
  'CatalogTemplatePickerModal.tsx',
  'ChecklistTab.tsx',
  'ConflictMergeModal.tsx',
  'CrewReportShareModal.tsx',
  'CrewTabBase.tsx',
  'ExportPdfModal.tsx',
  'MaterialNormModal.tsx',
  'NotificationCenterModal.tsx',
  'RoomHighlightModal.tsx',
  'WarehouseTab.tsx',
  'WorkVolumeTab.tsx',
];
for (const file of windows) {
  const source = read('src/components/' + file);
  assert.ok(source.includes('hnl-ios-safe-modal'), 'Missing opted-in iOS safe modal: ' + file);
}
for (const file of ['CrewTabBase.tsx', 'ExportPdfModal.tsx', 'MaterialNormModal.tsx', 'RoomHighlightModal.tsx', 'WarehouseTab.tsx', 'WorkVolumeTab.tsx']) {
  assert.ok(read('src/components/' + file).includes('hnl-ios-safe-dialog'), 'Missing safe dialog: ' + file);
}
const floor = read('src/components/FloorPlanDefectTab.tsx');
assert.ok(floor.includes('data-hnl-ios-fullscreen-toolbar="true"'), 'Map Full toolbar must protect notch');
assert.ok(floor.includes('data-hnl-map-display-inline="anchored-popover"'), 'Map display stays anchored');
assert.ok(floor.includes('hnl-mobile-map-display-panel'), 'Map mobile display is viewport contained');
assert.ok(floor.includes('hnl-cross-device-safe-overlay') && floor.includes('hnl-cross-device-safe-dialog'), 'Manage Floors safe overlay');
const viewer = read('src/components/ImageViewerModal.tsx');
const editor = read('src/components/ImageEditorModal.tsx');
const quick = read('src/components/QuickEditGridModal.tsx');
assert.ok(viewer.includes('data-hnl-ios-photo-viewer-header="true"'), 'Photo viewer top');
assert.ok(editor.includes('data-hnl-ios-photo-editor-header="true"') && editor.includes('data-hnl-ios-photo-editor-footer="true"'), 'Photo editor top/bottom');
assert.ok(quick.includes('data-hnl-ios-quick-grid-safe="true"'), 'Quick edit insets');
assert.ok(css.includes('@supports (-webkit-touch-callout: none)'), 'iOS WebKit-specific fallback');
assert.ok(css.includes('padding-top: max(3.75rem, env(safe-area-inset-top, 0px))'), 'Top notch fallback');
assert.ok(css.includes('padding-bottom: max(1rem, env(safe-area-inset-bottom, 0px))'), 'Home indicator safe area');
assert.ok(css.includes('.hnl-cross-device-safe-overlay'), 'Cross-device floor modal CSS');
assert.ok(css.includes('[data-hnl-map-display-inline="anchored-popover"][open]'), 'Mobile map display stays in bounds');
assert.ok(!css.includes('.hnl-ios-safe-modal { position: fixed'), 'Do not override modal positioning globally');
const nav = read('src/components/BottomNav.tsx');
assert.ok(nav.includes('data-hnl-nav-surface="desktop"') && nav.includes('data-hnl-nav-surface="mobile"'), 'PC/mobile isolation');
const prodSquareGolden = read('scripts/prod-pc-sidebar-square-golden.mjs');
assert.ok(prodSquareGolden.includes('exact-square desktop left-rail targets.'), 'Keep PR424 PC golden');
console.log('PROD iOS SAFE-AREA SCOPED GOLDEN: PASS (CSS/WebKit fallback, iPhone header/footer, modal opt-in, map, PC isolation)');
