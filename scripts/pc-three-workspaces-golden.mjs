/**
 * HNL QLTC — three independent PC presentations; source-only golden.
 * No browser credentials, writes, or Firebase/R2 connections.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const app = read('src/App.tsx');
const header = read('src/components/DesktopWorkspaceHeader.tsx');
const legacy = read('src/components/DesktopWorkspaceHeaderLegacy.tsx');
const pro = read('src/styles/desktopWorkspacePro.css');
const base = read('src/styles/desktopWorkspace.css');
const nav = read('src/components/BottomNav.tsx');

assert.ok(header.includes("export type DesktopWorkspaceMode = 'modern' | 'classic' | 'gemini'"), 'exact three persisted PC states');
assert.ok(header.includes("if (mode !== 'gemini') return <LegacyDesktopWorkspaceHeader {...props} />;"), 'both old PC variants render original source');
assert.ok(legacy.includes("if (mode === 'classic') return null"), 'traditional Home keeps original dark banner');
assert.ok(legacy.includes("if (mode === 'classic') return ("), 'traditional operation keeps classic layout');
assert.ok(legacy.includes('data-hnl-pc-home-actions="true"'), 'original bright PROD Home toolbar preserved');
assert.ok(legacy.includes("onChangeMode('classic')") && legacy.includes("onChangeMode('modern')"), 'original two-way old control preserved');
assert.ok(legacy.includes('onOpenProjects') && legacy.includes('onOpenSecurity'), 'project and security handlers retained');
assert.ok(app.includes("if (userChoice === 'modern' || userChoice === 'classic') return userChoice;"), 'original persisted choices unchanged');
assert.ok(app.includes("if (userChoice === 'gemini') return 'gemini';"), 'new Gemini opt-in persisted');
assert.ok(app.includes("desktopWorkspaceModeChoice === 'gemini' ? 'modern' : desktopWorkspaceModeChoice"), 'legacy CSS mode for Gemini only');
assert.ok(app.includes('document.documentElement.dataset.hnlPcWorkspace = desktopWorkspaceMode;'), 'original PC layout CSS identity still applies');
assert.ok(app.includes("dataset.hnlPcWorkspacePro = desktopWorkspaceModeChoice === 'gemini' ? 'gemini' : 'off'"), 'Gemini scoped style flag');
assert.ok(app.includes("visibleTab !== 'home' ? desktopWorkspaceMode : 'classic'"), 'original Home/classic DOM contract retained');
assert.ok(app.includes("mode={desktopWorkspaceModeChoice}"), 'Gemini selector not masked by legacy shell mode');
assert.ok(app.includes("data-hnl-pc-mode-selector=\"true\""), 'three-way PC chooser exists');
assert.ok(app.includes("(!isMobileRuntime || isDesktopRuntime || chromeDesktopSite)"), 'never add chooser in Android APK or ordinary mobile Web');
for (const id of ['classic', 'modern', 'gemini']) assert.ok(app.includes('value="'+id+'"'), 'mode option missing: '+id);
assert.ok(app.includes('localStorage.setItem(\'hnl_desktop_workspace_mode_v1\', next)'), 'browser-only preference unchanged');
assert.ok(!pro.includes('data-hnl-pc-workspace="modern"'), 'Gemini stylesheet must not affect original PROD bright PC');
assert.ok((pro.match(/data-hnl-pc-workspace-pro="gemini"/g) || []).length >= 140, 'Gemini presentation fully isolated');
assert.ok(pro.includes('@media (min-width: 1024px)'), 'Gemini width gate stays desktop only');
assert.ok(base.includes('[data-hnl-desktop-design="modern"] [data-hnl-global-header]{display:none!important}'), 'original bright PC still hides dark top header');
assert.ok(nav.includes("w-[84px]") && nav.includes('data-hnl-sidebar-collapsed'), 'existing 84px rail and Gemini toggle remain');
for (const s of ['firebase.json','firestore.rules','storage.rules','.firebaserc']) assert.ok(fs.existsSync(s), 'core config preserved: '+s);
console.log('PC THREE MODES GOLDEN PASS: traditional dark header + original bright PROD + opt-in Gemini; mobile unchanged by selector');
