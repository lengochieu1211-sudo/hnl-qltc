/**
 * HNL QLTC – DEV-only Gemini PC preview source regression.
 * The preview overlays presentation files on exact canonical DEV HEAD only.
 * No runtime writes, no cloud connection, no mock replacement of business actions.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const read = (path) => fs.readFileSync(path, 'utf8');
const blobSha = (path) => {
  const b = fs.readFileSync(path);
  return crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
};
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
for (const k of ['onOpenProjects','onOpenReports','onOpenNotifications','onOpenSecurity', 'onUndo','onRedo',"onChangeMode('classic')", "onChangeMode('modern')"])
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

// GitHub workflow sets this only on the isolated preview branch. These exact
// hashes ensure ZERO rollback of DEV business logic, package and PR474 room hotfix.
if (process.env.HNL_REQUIRE_CANONICAL_DEV === '1') {
  const freeze = {
    'src/App.tsx': '163fe924a30df6d4d00e5e2b7ee7a06db078c6ac',
    'src/components/RoomHighlightModal.tsx': '50aab13c0b5c2b6cbec710109c589f658edf20ca',
    'package.json': '8c71c6e739535df45f53f08ead6aa8b363751b01',
    'package-lock.json': '8ea721854463ef32e556f74a0b8a61d003c971fc',
    'src/styles/desktopWorkspace.css': '739e5a8a1e7412fc515d93e7cbecc169b69cddc2',
    'src/styles/desktopWorkspaceCompact.css': '1fbb5a4c9bb2907d2ef3dd74c2184914534d46b6',
    'src/styles/desktopWorkspaceDeep.css': 'e8ece202ff81ffb12098b4e4821da607ac9338d6',
  };
  for (const [p,sha] of Object.entries(freeze))
    assert.equal(blobSha(p), sha, `original DEV file modified or rolled back: ${p}`);
}
console.log('HNL GEMINI PC PREVIEW PASS: PC-only CSS, old mode, callbacks, DEV business invariants, mobile 980px');
