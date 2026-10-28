import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const css = read('src/styles/desktopWorkspace.css');
const windows = {
  'material-norm': ['src/components/MaterialNormModal.tsx', ['catalog-tabs','norm-editor']],
  'quick-grid': ['src/components/QuickEditGridModal.tsx', ['grid-tabs','grid-toolbar','grid-scroll']],
  'source-picker': ['src/components/CatalogTemplatePickerModal.tsx', ['source-selection','source-results','source-basket']],
  'report-export': ['src/components/ExportPdfModal.tsx', ['report-filters','report-actions']],
  'crew-share': ['src/components/CrewReportShareModal.tsx', ['crew-report-body','crew-share-actions']],
  'conflict-merge': ['src/components/ConflictMergeModal.tsx', ['merge-strategy']],
  'room-editor': ['src/components/RoomHighlightModal.tsx', ['room-form']],
};
for (const [windowName, [file, regions]] of Object.entries(windows)) {
  const source = read(file);
  assert.equal(source.split(`data-hnl-pc-v32-window="${windowName}"`).length - 1, 1,
    `${windowName}: only one exact dialog overlay marker`);
  assert.ok(css.includes(`[data-hnl-pc-v32-window="${windowName}"]`), `${windowName}: missing scoped PC CSS`);
  for (const region of regions) {
    assert.ok(source.includes(`data-hnl-pc-v32-region="${region}"`), `${windowName}: missing real region ${region}`);
    assert.ok(css.includes(`[data-hnl-pc-v32-region="${region}"]`), `${windowName}: missing region CSS ${region}`);
  }
}
for (const [file, regions] of [
  ['src/components/EquipmentCatalogPanel.tsx', ['equipment-catalog','equipment-toolbar','equipment-editor']],
  ['src/components/CatalogTemplateManager.tsx', ['template-manager','template-tabs']],
]) {
  const source = read(file);
  for (const region of regions) {
    assert.ok(source.includes(`data-hnl-pc-v32-region="${region}"`), `${file}: missing ${region}`);
    assert.ok(css.includes(`[data-hnl-pc-v32-region="${region}"]`), `${file}: missing CSS for ${region}`);
  }
}
const block = css.slice(css.indexOf('/* HNL PC Workspace V3.2'));
assert.ok(block.includes('@media (min-width: 960px)') && block.includes('max-width: 1100px'), 'Chrome desktop-site bridge and PC breakpoints intact');
assert.ok(block.includes('html[data-hnl-pc-workspace="modern"]'), 'V3.2 requires an opt-in modern PC mode');
assert.ok(!block.includes('html[data-hnl-pc-workspace="classic"]'), 'V3.2 must not target classic directly');
assert.ok(!block.includes('@media (max-width: 959px)'), 'V3.2 must not touch ordinary mobile viewport');
for (const forbidden of ['firebase/firestore','setDoc(', 'updateDoc(', 'deleteDoc(', 'runTransaction(', 'transform:scale(', 'canvas {']) {
  assert.ok(!block.includes(forbidden), `V3.2 presentation CSS should not contain ${forbidden}`);
}
// Preserve the compact, original 84px PC navigation instead of the expanded 224px V3.1 rail.
assert.ok(css.includes('--pc-nav:84px'), 'modern PC must retain the original 84px navigation width');
assert.ok(!css.includes('--pc-nav:224px'), 'expanded V3.1 rail must not return');
assert.ok(!css.includes('PHÂN HỆ QUẢN LÝ'), 'no duplicate oversized navigation heading');
assert.ok(!css.includes('flex-direction:row!important;justify-content:flex-start'), 'original vertical icon+label tab geometry retained');
assert.ok(css.includes('.hnl-pc-quick-nav{display:none!important}'), 'hide duplicated PC quick tabs; old rail is the single primary navigation');
assert.ok(read('src/components/BottomNav.tsx').includes('w-[84px]'), 'unchanged BottomNav legacy compact rail');
assert.ok(read('src/App.tsx').includes("localStorage.getItem('hnl_desktop_workspace_mode_v1')"), 'original classic PC switch retained');
// V3.2 PC screen-density acceptance: hide the duplicated dark banner only in modern
// operation tabs, keep single left rail, and maintain Undo/Redo after retiring banner.
const header = read('src/components/DesktopWorkspaceHeader.tsx');
const app = read('src/App.tsx');
assert.ok(css.includes('[data-hnl-desktop-design="modern"] [data-hnl-global-header]{display:none!important}'), 'PC modern must hide duplicated dark project header');
assert.ok(css.indexOf('[data-hnl-desktop-design="modern"] [data-hnl-global-header]{display:none!important}') > css.indexOf('@media(min-width:960px)'), 'hide dark header only in PC breakpoint');
assert.ok(app.includes("visibleTab !== 'home' ? desktopWorkspaceMode : 'classic'"), 'Home dashboard original layout is preserved');
assert.ok(app.includes("data-hnl-pc-home-modern={visibleTab === 'home' && desktopWorkspaceMode === 'modern' ? 'true' : 'false'}"), 'Home modern header guard is local to the active tab');
assert.ok(css.includes('[data-hnl-pc-home-modern="true"] [data-hnl-global-header]{display:none!important}'), 'Home modern PC dark header must be hidden');
assert.ok(css.includes('html[data-hnl-browser-desktop="true"] [data-hnl-pc-home-modern="true"] [data-hnl-global-header]{display:none!important}'), 'Chrome desktop-site Home must hide redundant dark header');
assert.ok(css.includes('.hnl-pc-home-actions{display:none'), 'Home toolbar must be hidden by default on ordinary mobile and classic');
assert.ok(header.includes('data-hnl-pc-home-actions="true"'), 'Home modern PC has compact replacement controls');
assert.ok(header.includes("if (mode === 'classic') return null"), 'classic Home retains global header');
assert.ok(!header.includes('<nav className="hnl-pc-quick-nav"'), 'do not render duplicated horizontal module tabs');
assert.ok(header.includes('<UndoRedoControls onUndo={onUndo} onRedo={onRedo}'), 'original Undo/Redo remains accessible without dark header');
assert.ok(app.includes('onUndo={handleUndo}') && app.includes('canUndo={isProjectRoleResolved'), 'original undo permission/data guards preserved');
for (const route of ['onOpenProjects', 'onOpenReports', 'onOpenNotifications', 'onOpenSecurity', "onChangeMode('classic')"]) {
  assert.ok(header.includes(route), `PC contextual action must remain accessible: ${route}`);
}
assert.ok(read('src/components/HomeDashboard.tsx').includes('hnl-home-dashboard'), 'Home module unchanged');
console.log('HNL PC WORKSPACE V3.2 GOLDEN PASS — 7 operational dialogs + 2 embedded editors, 26 scoped region/overlay hooks; classic, mobile, Home and data guards');
