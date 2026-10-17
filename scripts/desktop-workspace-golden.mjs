import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(name)=>fs.readFileSync(new URL(`../${name}`, import.meta.url),'utf8');
const app=read('src/App.tsx');
const header=read('src/components/DesktopWorkspaceHeader.tsx');
const css=read('src/styles/desktopWorkspace.css');
const nav=read('src/components/BottomNav.tsx');
const home=read('src/components/HomeDashboard.tsx');
const tabs=['home','floorplan','crew','warehouse','volume','checklist','chat','ai','superadmin','config'];
for(const tab of tabs) assert.match(header,new RegExp(`\\b${tab}: \\{ name:`), `missing page ${tab}`);
assert.match(app, /localStorage\.getItem\('hnl_desktop_workspace_mode_v1'\) === 'modern' \? 'modern' : 'classic'/,'must default classic');
assert.match(app, /catch \{ return 'classic'; \}/,'private browsing must default classic');
assert.match(app, /localStorage\.setItem\('hnl_desktop_workspace_mode_v1', next\)/,'mode preference must be browser-local');
assert.match(app,/data-hnl-desktop-design=\{visibleTab !== 'home' \? desktopWorkspaceMode : 'classic'\}/,'home must always keep classic look');
assert.match(css,/@media\(min-width:1024px\)/,'modern design must be PC-scoped');
assert.match(css,/@media\(max-width:1023px\)/,'keep mobile unchanged');
assert.match(header,/if \(activeTab === 'home'\) return null;/);
assert.match(header,/onChangeMode\('classic'\)/,'visible rollback');
assert.match(header,/onChangeMode\('modern'\)/,'visible opt-in');
for(const action of ['onOpenProjects','onOpenReports','onOpenNotifications','onOpenSecurity','onNavigate']) {
  assert.match(app,new RegExp(`${action}=\\{`),`original handler must be passed: ${action}`);
  assert.match(header,new RegExp(`onClick=\\{(?:${action}|\\(\\) => ${action}\\()`),`header must delegate ${action}`);
}
for(const forbidden of ['firebase/firestore','setDoc(', 'updateDoc(', 'deleteDoc(', 'runTransaction(', 'projectId =','storagePath =']) {
  assert(!header.includes(forbidden),`header cannot write business data: ${forbidden}`);
}
for(const existing of ['data-hnl-nav-surface="desktop"','data-hnl-nav-tab={tab.id}','data-hnl-nav-tab="chat"']) assert(nav.includes(existing));
assert(home.includes('hnl-home-dashboard'),'original HomeDashboard retained');
for(const f of ['.firebaserc','firestore.rules','package-lock.json','.github/workflows/dev-runtime-golden.yml']) assert(fs.existsSync(new URL(`../${f}`,import.meta.url)),`critical config retained: ${f}`);
console.log('HNL PC Desktop Workspace Golden: PASS (navigation, opt-in/rollback, Home/mobile isolation, source guard).');
