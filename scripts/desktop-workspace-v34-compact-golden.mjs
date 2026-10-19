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

const deepWarehouse = read('src/components/WarehouseTab.tsx');
const deepSettings = read('src/components/GoogleConfigTab.tsx');
const deepNotice = read('src/components/NotificationCenterModal.tsx');
const deepNorm = read('src/components/MaterialNormModal.tsx');
const deepChecklist = read('src/components/ChecklistTab.tsx');
const deepRoom = read('src/components/RoomHighlightModal.tsx');
const deepVolume = read('src/components/WorkVolumeTab.tsx');
const deepReport = read('src/components/ExportPdfModal.tsx');
const deepPcCss = css.slice(css.indexOf('@media (min-width: 1024px)'), css.indexOf('/* At 1024–1279px'));
for (const token of [
 'data-hnl-pc-v32-window="room-editor"', 'data-hnl-pc-v32-window="material-norm"',
 'form[data-hnl-pc-v3-form="warehouse"]', 'form[data-hnl-pc-v3-form="volume"]',
 'form[data-hnl-pc-v3-form="crew-log"]', 'data-hnl-pc-compact-actions="checklist-editor"',
 'data-hnl-report-export-actions="true"', 'data-hnl-settings-sheet-card',
 'data-hnl-pc-compact-action="project-settings-save"', 'data-hnl-pc-compact-action="open-project-chat"',
 'scrollbar-gutter: stable', 'scrollbar-width: thin',
]) assert.ok(deepPcCss.includes(token), 'PC deep compact target missing: '+token);
assert.ok(deepSettings.includes('data-hnl-pc-compact-action="project-settings-save"'));
assert.ok(deepNotice.includes('data-hnl-pc-compact-action="open-project-chat"'));
assert.ok(deepNorm.includes('data-hnl-pc-compact-actions="material-norm-editor"'));
assert.equal((deepChecklist.match(/data-hnl-pc-compact-actions="checklist-editor"/g)||[]).length,2);
assert.ok(deepRoom.includes('data-hnl-pc-v32-region="room-form"') && deepVolume.includes('data-hnl-pc-v3-form="volume"'));
assert.ok(deepWarehouse.includes('data-hnl-pc-v3-form="warehouse"') && deepWarehouse.includes('Lưu & thêm tiếp'));
assert.ok(['text','pdf','xlsx'].every(f=>deepReport.includes('data-hnl-report-format="'+f+'"')));
assert.match(deepWarehouse, /data-hnl-pc-v3-inner="warehouse-catalog-grid"[^>]*rounded-xl border border-slate-200 bg-white p-1[^>]*>\s*<div[^>]*max-h-\[46vh\] overflow-auto[^>]*data-hnl-warehouse-catalog-scroll="true"/);
assert.ok(!deepPcCss.includes('pointer-events:') && !deepPcCss.includes('z-index:') && !deepPcCss.includes('canvas:'));
console.log('HNL PC V3.5 DEEP COMPACT BUTTONS / WAREHOUSE SCROLL GOLDEN PASS');

console.log('HNL PC V3.4 COMPACT GOLDEN PASS — mode visibility, compact actions, 84px rail, classic/mobile and plan safety');
