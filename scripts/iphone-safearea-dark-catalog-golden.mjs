import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Read-only source regression: no Firebase credentials or real data are used.
const read = (name) => readFileSync(name, 'utf8');
const plan = read('src/components/FloorPlanDefectTab.tsx');
const viewer = read('src/components/ImageViewerModal.tsx');
const editor = read('src/components/ImageEditorModal.tsx');
const quick = read('src/components/QuickEditGridModal.tsx');
const css = read('src/index.css');
const inventory = read('src/components/WarehouseTab.tsx');
const expected = [
  ['Full floor plan toolbar safe top', plan, /data-hnl-ios-fullscreen-toolbar="true"[\s\S]{0,550}env\(safe-area-inset-top\)/],
  ['Full floor plan left/right safe', plan, /data-hnl-ios-fullscreen-toolbar="true"[\s\S]{0,850}env\(safe-area-inset-left\)[\s\S]{0,140}env\(safe-area-inset-right\)/],
  ['Full floor plan exit pinned on mobile', plan, /data-hnl-ios-fullscreen-exit="true"[^>]*className="flex shrink-0[^>]*justify-end/],
  ['Full floor plan horizontal tools', plan, /data-hnl-ios-fullscreen-scrolltools="true"[^>]*overflow-x-auto/],
  ['Full floor plan bottom safe', plan, /data-hnl-ios-fullscreen-bottom="true"|bottom: 'max\(0\.75rem, env\(safe-area-inset-bottom\)\)'/],
  ['Photo viewer safe top', viewer, /data-hnl-ios-photo-viewer-header="true"[\s\S]{0,320}env\(safe-area-inset-top\)/],
  ['Photo editor safe top', editor, /data-hnl-ios-photo-editor-header="true"[\s\S]{0,320}env\(safe-area-inset-top\)/],
  ['Photo editor bottom safe', editor, /data-hnl-ios-photo-editor-footer="true"[\s\S]{0,320}env\(safe-area-inset-bottom\)/],
  ['Quick edit top safe', quick, /data-hnl-ios-quick-grid-safe="true"[\s\S]{0,310}env\(safe-area-inset-top\)/],
  ['Quick edit bottom safe', quick, /data-hnl-ios-quick-grid-safe="true"[\s\S]{0,370}env\(safe-area-inset-bottom\)/],
  ['Catalog row scope', inventory, /data-hnl-warehouse-catalog-table="auto-width"[\s\S]{0,2200}data-hnl-catalog-open-master/],
  ['Dark catalog hover override', css, /html\[data-hnl-theme="dark"\] \[data-hnl-warehouse-catalog-table="auto-width"\] \[data-hnl-catalog-open-master\]:is\(:hover, :focus-visible\)/],
  ['Mobile catalog name text selection disabled', css, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]{0,180}\[data-hnl-catalog-open-master\][\s\S]{0,160}-webkit-user-select: none/],
];
for (const [name, content, matcher] of expected) {
  assert.match(content, matcher, name);
  console.log('PASS:', name);
}
assert.match(plan, /data-hnl-pc-plan-viewport="true"/, 'Map viewport remains present');
assert.match(inventory, /data-hnl-catalog-in-history/, 'Warehouse transaction history remains present');
console.log('IPHONE SAFE AREA + DARK CATALOG SOURCE GOLDEN PASS', expected.length, 'checks');
