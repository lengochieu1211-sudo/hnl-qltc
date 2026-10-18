import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (name) => fs.readFileSync(name, 'utf8');
const app = read('src/App.tsx');
const css = read('src/styles/desktopWorkspace.css');
const cards = read('src/components/DesktopWorkspaceMetrics.tsx');
const moduleFiles = [
  ['warehouse','src/components/WarehouseTab.tsx'],
  ['volume','src/components/WorkVolumeTab.tsx'],
  ['crew','src/components/CrewTabBase.tsx'],
  ['floorplan','src/components/FloorPlanDefectTab.tsx'],
  ['checklist','src/components/ChecklistTab.tsx'],
];
assert.ok(app.includes("localStorage.getItem('hnl_desktop_workspace_mode_v1') === 'modern' ? 'modern' : 'classic'"), 'classic default and instant rollback');
assert.ok(app.includes('document.documentElement.dataset.hnlPcWorkspace = desktopWorkspaceMode'), 'portal style follows locally selected PC mode');
assert.ok(app.includes("visibleTab !== 'home' ? desktopWorkspaceMode : 'classic'"), 'Home stays original');
assert.ok(!cards.includes('firebase/') && !cards.includes('setDoc(') && !cards.includes('runTransaction('), 'metric cards are presentation-only');
for (const [slug, path] of moduleFiles) {
  const source = read(path);
  assert.ok(source.includes(`data-hnl-workspace-module="${slug}"`), `${slug} has a dedicated workspace region`);
  assert.ok(source.includes('<DesktopWorkspaceMetrics'), `${slug} has actual module metrics`);
  assert.ok(css.includes(`[data-hnl-workspace-module="${slug}"]`) || css.includes('[data-hnl-workspace-module]'), `${slug} has desktop-specific layout`);
}
for (const [slug,path] of [
  ['chat-projects','src/features/chat/ChatTab.tsx'], ['chat-room','src/features/chat/ChatTab.tsx'],
  ['ai-workspace','src/features/ai/AiAssistantPage.tsx'],
  ['settings-center','src/components/GoogleConfigTab.tsx'],
  ['system-center','src/components/SuperAdminCenter.tsx'],
  ['project-manager','src/components/ProjectManagerModal.tsx'],
  ['security-center','src/components/SecurityModal.tsx'],
  ['notification-center','src/components/NotificationCenterModal.tsx'],
]) assert.ok(read(path).includes(`data-hnl-pc-module="${slug}"`), `${slug} has its own PC layout selector`);
for (const selector of ['[data-hnl-pc-plan-viewport','[data-hnl-warehouse-filter-layout','[data-hnl-volume-filter-sort','[data-hnl-pc-region="commands"]','[data-hnl-nested-nav]','[data-hnl-settings-sheet]','[data-hnl-pc-module="chat-room"]','[data-hnl-pc-module="ai-workspace"]']) {
  assert.ok(css.includes(selector), `deep-workspace CSS must style ${selector}`);
}
assert.ok(css.includes('@media (max-width: 1023px)') && css.includes('.hnl-pc-v2-overview { display: none !important; }'), 'mobile presentation unchanged');
assert.ok(css.includes('[data-hnl-desktop-design="classic"] .hnl-pc-v2-overview { display: none !important; }'), 'classic presentation unchanged');
for (const unsafe of ['firebase/firestore','firebase/auth','deleteDoc(', 'setDoc(', 'updateDoc(']) {
  assert.ok(!cards.includes(unsafe), `metric shell must not invoke ${unsafe}`);
}
console.log('HNL PC WORKSPACE V2 GOLDEN PASS: 13 screen surfaces, metrics, nested toolbars, classic/mobile/portal guards.');

// Chrome desktop-site auto-view regression runs inside the existing stability suite.
await import('./desktop-site-request-golden.mjs');
