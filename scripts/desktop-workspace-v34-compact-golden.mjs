import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const app = read('src/App.tsx');
const main = read('src/main.tsx');
const css = read('src/styles/desktopWorkspaceCompact.css');
const previous = read('src/styles/desktopWorkspaceDeep.css');
assert.match(main, /import '\.\/styles\/desktopWorkspaceDeep\.css';\s*import '\.\/styles\/desktopWorkspaceCompact\.css';/,
  'Compact layer must follow V3.3 CSS to override stretched toolbar rules');
assert.match(app, /const userChoice = localStorage\.getItem\('hnl_desktop_workspace_mode_v1'\);\s*if \(userChoice === 'modern' \|\| userChoice === 'classic'\) return userChoice;/,
  'Persisted choice must continue to override new default');
assert.match(app, /return \(isDesktopRuntime \|\| window\.innerWidth >= 1024 \|\| chromeDesktopSite\) \? 'modern' : 'classic';/,
  'PC without saved preference defaults to modern, mobile stays classic');
assert.ok(css.startsWith('/* HNL QLTC — PC Workspace V3.4'));
assert.match(css, /@media \(min-width: 1024px\)/);
assert.match(css, /html\[data-hnl-pc-workspace="modern"\] \[data-hnl-desktop-design="modern"\]/);
for (const scope of ['floorplan', 'crew', 'warehouse', 'checklist', 'settings-center', 'chat-projects', 'ai-workspace', 'volume-filter-panel']) {
  assert.ok(css.includes(scope), `Missing compact presentation of ${scope}`);
}
assert.match(css, /\[data-hnl-workspace-module="floorplan"\] \[data-hnl-pc-region="commands"\] \{\s*display: block;/,
  'Floor plan commands must preserve nested toolbar layout');
assert.doesNotMatch(css, /(?:canvas|transform|zoom|z-index|pointer-events)\s*:/,
  'Compact layer must not mutate plan/media geometry or modal input semantics');
assert.match(previous, /\.hnl-pc-breadcrumb \{\s*display: none !important;/);
assert.match(read('src/styles/desktopWorkspace.css'), /--pc-nav:84px/);
// PC V3.5 scrollbar/layout regression: scroll affordances stay visible, not
// clipped by the warehouse table border, and only confirmed oversized CTAs
// become content-sized. This gate is static; device DPI is separately tested.
for (const marker of [
  '[data-hnl-settings-sheet-scrollbody]',
  '[data-hnl-warehouse-catalog-scroll="true"]',
  '[data-hnl-pc-v3-form="warehouse"]',
  '[data-hnl-pc-v3-form="volume"]',
  '[data-hnl-pc-v3-center="notification-center"]',
  '[data-hnl-pc-v32-window] [class*="overflow-y-auto"]',
]) assert.ok(css.includes(marker), `PC V3.5 missing scrollbar target ${marker}`);
assert.match(css, /scrollbar-width: thin;/);
assert.match(css, /::-webkit-scrollbar-thumb\s*\{\s*background-color: #94a3b8;/);
assert.match(css, /\[data-hnl-pc-v3-inner="warehouse-catalog-grid"\]\s*\{\s*border-color: #c7d2fe;/);
assert.ok(css.includes('scrollbar-gutter: stable;') && css.includes('overscroll-behavior: contain;'),
  'Catalogue must preserve scroll gutter and containment');
assert.ok(read('src/components/WarehouseTab.tsx').includes('data-hnl-warehouse-catalog-scroll="true"'),
  'Warehouse list must retain its real scroll container');
assert.ok(read('src/components/GoogleConfigTab.tsx').includes('data-hnl-project-settings-save="true"'),
  'Project settings save action remains mounted');
assert.ok(read('src/components/NotificationCenterModal.tsx').includes('data-hnl-notification-open-chat="true"'),
  'Notification chat action remains mounted');
assert.match(css, /@media \(min-width: 1024px\)\s*\{[\s\S]*data-hnl-notification-open-chat/,
  'CTA/scroll changes are scoped to PC 1024px+');
console.log('HNL PC V3.5 MODAL SCROLL & CTA GOLDEN PASS');


const deepWarehouse = read('src/components/WarehouseTab.tsx');
const deepNorm = read('src/components/MaterialNormModal.tsx');
const deepChecklist = read('src/components/ChecklistTab.tsx');
const deepRoom = read('src/components/RoomHighlightModal.tsx');
const deepVolume = read('src/components/WorkVolumeTab.tsx');
const deepReport = read('src/components/ExportPdfModal.tsx');
const deepPcCss = css.slice(css.indexOf('/* V3.5 continued, after #298:'));
for (const token of [
 'data-hnl-pc-v32-window="room-editor"', 'data-hnl-pc-v32-window="material-norm"',
 'form[data-hnl-pc-v3-form="warehouse"]', 'form[data-hnl-pc-v3-form="volume"]',
 'form[data-hnl-pc-v3-form="crew-log"]', 'data-hnl-pc-compact-actions="checklist-editor"',
 'data-hnl-report-export-actions="true"', 'data-hnl-settings-sheet-card', 'scrollbar-gutter: stable',
]) assert.ok(deepPcCss.includes(token), 'PC V3.5 continued target missing: '+token);
assert.ok(deepNorm.includes('data-hnl-pc-compact-actions="material-norm-editor"'));
assert.equal((deepChecklist.match(/data-hnl-pc-compact-actions="checklist-editor"/g)||[]).length,2);
assert.ok(deepRoom.includes('data-hnl-pc-v32-region="room-form"') && deepVolume.includes('data-hnl-pc-v3-form="volume"'));
assert.ok(deepWarehouse.includes('data-hnl-pc-v3-form="warehouse"') && deepWarehouse.includes('Lưu & thêm tiếp'));
assert.ok(['text','pdf','xlsx'].every(f=>deepReport.includes('data-hnl-report-format="'+f+'"')));
assert.match(deepWarehouse, /data-hnl-pc-v3-inner="warehouse-catalog-grid"[^>]*rounded-xl border border-slate-200 bg-white p-1[^>]*>\s*<div[^>]*max-h-\[46vh\] overflow-auto[^>]*data-hnl-warehouse-catalog-scroll="true"/);
assert.ok(css.includes('[data-hnl-project-settings-save="true"]') && css.includes('[data-hnl-notification-open-chat="true"]'),
  'Keep already-merged #298 project settings and notification sizing CSS');
assert.doesNotMatch(deepPcCss, /(?:canvas|transform|z-index|pointer-events)\s*:/);
console.log('HNL PC V3.5 CONTINUED DEEP COMPACT / CATALOG INNER SCROLL GOLDEN PASS');

console.log('HNL PC V3.4 COMPACT GOLDEN PASS — mode visibility, compact actions, 84px rail, classic/mobile and plan safety');
