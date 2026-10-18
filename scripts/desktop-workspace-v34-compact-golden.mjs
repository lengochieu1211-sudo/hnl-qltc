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
console.log('HNL PC V3.4 COMPACT GOLDEN PASS — mode visibility, compact actions, 84px rail, classic/mobile and plan safety');
