/**
 * HNL QLTC – DEV Gemini PC-only integration regression.
 * The DEV integration overlays PC presentation only on latest canonical DEV.
 * No runtime writes, no cloud connection, no mock replacement of business actions.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const pro = read('src/styles/desktopWorkspacePro.css');
const main = read('src/main.tsx');
const nav = read('src/components/BottomNav.tsx');
const header = read('src/components/DesktopWorkspaceHeader.tsx');
const app = read('src/App.tsx');
const base = read('src/styles/desktopWorkspace.css');
const compact = read('src/styles/desktopWorkspaceCompact.css');
const deep = read('src/styles/desktopWorkspaceDeep.css');

assert.ok(main.includes("import './styles/desktopWorkspacePro.css';"), 'Gemini stylesheet imported after base PC CSS');
assert.ok(app.includes('forceDesktopRail={isDesktopRuntime || chromeDesktopSite}'), 'Chrome Desktop Site/PC bridge preserved');
assert.ok(app.includes("userChoice === 'modern' || userChoice === 'classic'"), 'classic/modern selection preserved');
for (const k of ['onOpenProjects','onOpenReports','onOpenNotifications','onOpenSecurity', 'onUndo','onRedo', 'DesktopPcModeMenu'])
  assert.ok(header.includes(k), `missing existing header callback: ${k}`);
for (const k of ['setActiveTab', 'onPreloadTab', 'showChecklist', 'showAi', 'showSuperAdmin', 'onLockNow', 'onSignOut', 'onClick={() => activate(tab.id)}', 'data-hnl-sidebar-collapsed'])
  assert.ok(nav.includes(k), `missing existing navigation callback: ${k}`);
assert.ok(nav.includes('aria-expanded={!sidebarCollapsed}'), 'sidebar collapse exposes accessible state');
assert.ok(nav.includes('localStorage.getItem(SIDEBAR_STORAGE_KEY)'), 'sidebar preference works without changing project data');

// CSS is presentation-only, guarded by >=1024px. No unscoped styles or data layer changes.
assert.ok(/@media\s*\(min-width:\s*1024px\)/.test(pro), 'PC gate present');
assert.ok(!/firebase|firestore|r2\.workers|localstorage/i.test(pro.replace(/\/\*[\s\S]*?\*\//g,'')), 'no backend/data layer in CSS');
const media = [...pro.matchAll(/@media\s*\((?:min-width|width)\s*:\s*(\d+)px\)/g)].map(m=>Number(m[1]));
assert.ok(media.length > 1 && media.every(x=>x >= 1024), 'every Gemini media rule begins at desktop width');
assert.equal(pro.slice(0,pro.indexOf('@media')).replace(/\/\*[\s\S]*?\*\//g,'').trim(), '', 'no unscoped CSS selectors');
assert.ok(base.includes('@media (min-width: 960px) and (max-width: 1023px)'), 'DEV Chrome desktop-site bridge preserved');
assert.ok(compact.includes('@media (min-width: 960px) and (max-width: 1023px)'), 'DEV compact bridge preserved');
for (const [name,body] of [['base',base], ['compact',compact], ['deep',deep]])
  assert.ok(!/min-width:\s*1024px\)\s*and\s*\(max-width:\s*1023px/.test(body), `impossible media query in ${name}`);


console.log('GEMINI PC DEV INTEGRATION PASS: callbacks, old mode, desktop-only style and mobile bridge preserved');
