import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const css = read('src/styles/desktopWorkspaceDeep.css');
const oldCss = read('src/styles/desktopWorkspace.css');
const entry = read('src/main.tsx');
const app = read('src/App.tsx');

assert.match(entry, /import '\.\/styles\/desktopWorkspace\.css';\s*import '\.\/styles\/desktopWorkspaceDeep\.css';/,
  'deep layer must load AFTER existing PC styles');
assert.ok(css.includes('html[data-hnl-pc-workspace="modern"]'), 'modern PC preference guard');
assert.ok(css.includes('@media (min-width: 960px)'), 'desktop breakpoint');
assert.ok(!css.includes('html[data-hnl-pc-workspace="classic"]'), 'classic mode must remain untouched');
assert.ok(!css.includes('transform:') && !css.includes('pointer-events:') && !css.includes('z-index:') && !css.includes('position: fixed'),
  'never change canvas transforms, event hit areas or modal stacking');
assert.ok(!/\b(?:firebase|firestore|updateDoc|setDoc|deleteDoc|R2|storagePath|projectId)\(/.test(css),
  'presentation only');
assert.ok(oldCss.includes('--pc-nav:84px') && read('src/components/BottomNav.tsx').includes('w-[84px]'),
  'original 84px sidebar retained');
assert.ok(css.includes('.hnl-pc-breadcrumb') && css.includes('display: none !important'),
  'noninteractive breadcrumb hidden only in PC modern');
assert.ok(app.includes("visibleTab !== 'home' ? desktopWorkspaceMode : 'classic'"), 'HomeDashboard layout preserved');

const modules = [
  ['Trang chủ', 'src/components/HomeDashboard.tsx', 'hnl-home-dashboard'],
  ['Kho vật tư', 'src/components/WarehouseTab.tsx', 'data-hnl-workspace-module="warehouse"'],
  ['Quân số/Nhật ký', 'src/components/CrewTabBase.tsx', 'data-hnl-workspace-module="crew"'],
  ['Mặt bằng/Defect', 'src/components/FloorPlanDefectTab.tsx', 'data-hnl-workspace-module="floorplan"'],
  ['Khối lượng', 'src/components/WorkVolumeTab.tsx', 'data-hnl-workspace-module="volume"'],
  ['Checklist', 'src/components/ChecklistTab.tsx', 'data-hnl-workspace-module="checklist"'],
  ['Trao đổi', 'src/features/chat/ChatTab.tsx', 'data-hnl-pc-module="chat-room"'],
  ['HNL AI', 'src/features/ai/AiAssistantPage.tsx', 'data-hnl-pc-module="ai-workspace"'],
  ['Hệ thống', 'src/components/SuperAdminCenter.tsx', 'data-hnl-pc-module="system-center"'],
  ['Cài đặt', 'src/components/GoogleConfigTab.tsx', 'data-hnl-pc-module="settings-center"'],
];
for (const [name,file,marker] of modules) {
  assert.ok(read(file).includes(marker), `${name}: existing primary module not found`);
}
for (const [name,file,group,pressed] of [
  ['Kho: Vật tư/Thiết bị','src/components/WarehouseTab.tsx','data-hnl-nested-nav="warehouse-catalog"','aria-pressed={warehouseCatalogTab === kind}'],
  ['Quân số: Nhật ký/Đội','src/components/CrewTabBase.tsx','data-hnl-pc-region="subtabs"','aria-pressed={activeSubTab === \'logs\'}'],
  ['Checklist: Tầng','src/components/ChecklistTab.tsx','data-hnl-pc-region="floor-tabs"','aria-pressed={selectedFloor === floor}'],
  ['Khối lượng: Hạng mục','src/components/WorkVolumeTab.tsx','data-hnl-volume-category-filters="true"','aria-pressed={selectedCategory === catId}'],
]) {
  const code = read(file);
  assert.ok(code.includes(group) && code.includes(pressed) && code.includes('role="group"'),
    `${name}: subtab must keep its existing handler and expose pressed state`);
}
for (const [name, file, group, pressed] of [
  ['Đội thi công: 4 tab chi tiết', 'src/components/CrewTabBase.tsx', 'data-hnl-pc-deep-tabs="crew-team-detail"', "aria-pressed={detailModalTab === 'materials'}"],
  ['HNL AI: 4 chế độ', 'src/features/ai/AiAssistantPage.tsx', 'data-hnl-pc-deep-tabs="ai-modes"', 'aria-pressed={active}'],
]) {
  const code = read(file);
  assert.ok(code.includes(group) && code.includes(pressed) && code.includes('role="group"'),
    `${name}: unmarked deeper tabs or selected state`);
  assert.ok(css.includes(group), `${name}: missing common deep navigation styles`);
}
const dataWindows = [
  'material-norm','quick-grid','source-picker','report-export','crew-share','conflict-merge','room-editor',
];
for (const name of dataWindows) assert.ok(oldCss.includes(`data-hnl-pc-v32-window="${name}"`), `${name}: existing modal UI must survive`);
for (const selector of [
  'data-hnl-pc-region="subtabs"','data-hnl-pc-region="floor-tabs"',
  'data-hnl-pc-region="records"','data-hnl-pc-v32-region="grid-scroll"',
  'data-hnl-pc-v32-region="norm-editor"','data-hnl-pc-v32-region="room-form"',
  'data-hnl-pc-v32-region="source-results"','data-hnl-pc-module="chat-room"',
  'data-hnl-pc-module="ai-workspace"','data-hnl-pc-module="system-center"',
  'data-hnl-pc-module="settings-center"','data-hnl-pc-module="security-center"',
  'data-hnl-pc-module="notification-center"','data-hnl-pc-module="project-manager"',
]) assert.ok(css.includes(selector), `Deep surface not covered: ${selector}`);
// V3.5 regression: the generic nested active-tab palette must not recolor
// the four HNL AI mode buttons, whose JSX deliberately uses white-on-indigo.
// This was a confirmed PC contrast bug: active labels looked blue/hidden.
const aiModeSource = read('src/features/ai/AiAssistantPage.tsx');
const navActivePalette = css.match(/html\[data-hnl-pc-workspace="modern"\] :is\([\s\S]*?\)\s*:not\(\[data-hnl-pc-deep-tabs="ai-modes"\]\)\s*> button:is\(\[aria-selected="true"\],\[aria-pressed="true"\],\[data-state="active"\]\)\s*\{[\s\S]*?color: var\(--hnl-deep-accent\);[\s\S]*?background-color:/);
assert.ok(navActivePalette, 'Generic selected-tab colors must explicitly exempt AI mode buttons');
for (const label of ['HNL Data', 'Kiểm tra dữ liệu', 'AI chung', 'HNL + AI']) {
  assert.ok(aiModeSource.includes(`label: '${label}'`), `AI mode label missing: ${label}`);
}
assert.ok(aiModeSource.includes('data-hnl-pc-deep-tabs="ai-modes"') &&
  aiModeSource.includes('aria-pressed={active}') &&
  aiModeSource.includes("active ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 border border-slate-200'"),
  'AI modes keep white-on-indigo selected state and dark-on-white inactive state');
console.log('HNL AI MODES PC ACTIVE-TAB TEXT CONTRAST GOLDEN PASS');

console.log(`HNL PC V3.3 DEEP GOLDEN PASS — ${modules.length} primary modules, 4 nested selector groups, ${dataWindows.length} critical dialog families; 84px rail, classic, Home, handler and canvas protections intact`);
