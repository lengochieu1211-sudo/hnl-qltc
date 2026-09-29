import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizePhone } from '../src/utils/contactUtils';

const cases = [
  { input: '090 123 4567', national: '0901234567', e164: '+84901234567', dial: '+84901234567', valid: true },
  { input: '090.123.4567', national: '0901234567', e164: '+84901234567', dial: '+84901234567', valid: true },
  { input: '84901234567', national: '0901234567', e164: '+84901234567', dial: '+84901234567', valid: true },
  { input: '+84 90 123 4567', national: '0901234567', e164: '+84901234567', dial: '+84901234567', valid: true },
  { input: '901234567', national: '0901234567', e164: '+84901234567', dial: '+84901234567', valid: true },
  { input: '+12025550123', national: '', e164: '', dial: '+12025550123', valid: true },
  { input: '12345', national: '', e164: '', dial: '', valid: false },
  { input: 'abc', national: '', e164: '', dial: '', valid: false },
  { input: '', national: '', e164: '', dial: '', valid: false },
] as const;

for (const testCase of cases) {
  const result = normalizePhone(testCase.input);
  assert.equal(result.original, testCase.input.trim(), `original must be preserved: ${testCase.input}`);
  assert.equal(result.national, testCase.national, `national mismatch: ${testCase.input}`);
  assert.equal(result.e164, testCase.e164, `e164 mismatch: ${testCase.input}`);
  assert.equal(result.dial, testCase.dial, `dial mismatch: ${testCase.input}`);
  assert.equal(result.valid, testCase.valid, `valid mismatch: ${testCase.input}`);
}

const memberContactService = fs.readFileSync('src/lib/memberContactService.ts', 'utf8');
assert.match(memberContactService, /updatedByEmail[,\s]/, 'member contact writes must include updatedByEmail required by Firestore Rules');

const contactUtils = fs.readFileSync('src/utils/contactUtils.ts', 'utf8');
const crewTab = fs.readFileSync('src/components/CrewTabBase.tsx', 'utf8');
const androidMain = fs.readFileSync('android-wrapper/src/com/qlct/app/MainActivity.java', 'utf8');
const desktopShell = fs.readFileSync('desktop-wrapper/DesktopWebShellForm.cs', 'utf8');
assert.match(contactUtils, /https:\/\/chat\.zalo\.me\//, 'web Zalo fallback must use the stable web chat origin');
assert.doesNotMatch(contactUtils, /window\.open\('https:\/\/zalo\.me\//, 'web must not force the generic zalo.me root deep link');
assert.match(crewTab, /AndroidContact[\s\S]*pickContact/, 'Crew team phone picker must prefer the APK native contact bridge');
assert.match(androidMain, /Intent\.ACTION_PICK, ContactsContract\.CommonDataKinds\.Phone\.CONTENT_URI/, 'Android APK must use the user-scoped system contact picker');
assert.match(androidMain, /android-contact-result/, 'Android contact picker must return the selected name and phone to WebView');
assert.match(androidMain, /webView\.saveState\(outState\)/, 'Android wrapper must preserve WebView navigation state across Activity recreation');


const appSource = fs.readFileSync('src/App.tsx', 'utf8');
assert.match(appSource, /qlct_active_tab_v1/, 'Web/mobile shell must remember the active primary tab across an unavoidable page recreation');
assert.match(appSource, /Warm primary field screens after first paint without flooding the main thread/, 'primary lazy tabs must be warmed after first paint without blocking input');
assert.match(appSource, /loader\(\)\.catch\(\(\) => undefined\)\.finally\(\(\) => \{[\s\S]*?nextTimer = window\.setTimeout\(next, warmGapMs\)/, 'primary lazy tabs must warm truly sequentially instead of overlapping heavy parses');
assert.match(appSource, /const warmGapMs = mobileLike \? 650 : 220/, 'mobile lazy-tab warm cadence must stay serialized and gentler than desktop while warming earlier');
assert.match(appSource, /navigationRequestRef/, 'rapid primary navigation must coalesce stale heavy-screen transitions');
assert.match(appSource, /navigationCommitTimerRef/, 'rapid primary navigation must debounce heavy-screen commits during continuous taps');
assert.match(appSource, /commitDelayMs = rapidMode \? 80 : 0/, 'single navigation must commit immediately while rapid taps keep a bounded quiet window');
assert.match(appSource, /rapidTap = sinceLastRequest < 220/, 'rapid navigation mode must be driven by actual tap cadence');
assert.match(appSource, /if \(tab === activeTabRef\.current\)[\s\S]*?setNavigationTargetTab\(null\);[\s\S]*?return;/, 're-tapping the current tab must cancel pending work without scheduling another render');
const navigationCoordinator = appSource.slice(appSource.indexOf('const navigateToTab'), appSource.indexOf('// Warm primary field screens'));
assert.doesNotMatch(navigationCoordinator, /React\.startTransition/, 'settled rapid navigation commit must not remain transition-delayed');

const showWebAppSection = desktopShell.slice(desktopShell.indexOf('internal void ShowWebApp()'), desktopShell.indexOf('private void InitializeEmbeddedWeb()'));
assert.doesNotMatch(showWebAppSection, /Navigate\(Program\.BuildAppUrl\(\)\)/, 'Windows EXE must not re-navigate the WebView when returning from native home/tray');
assert.match(appSource, /const securityModalProjects = React\.useMemo\(/, 'SecurityModal projects must stay referentially stable across Android VisualViewport keyboard renders');
assert.doesNotMatch(appSource, /<SecurityModal[\s\S]{0,500}projects=\{getProjectsList\(\)\}/, 'SecurityModal must not receive a fresh projects array on every App render');

const securityModalSource = fs.readFileSync('src/components/SecurityModal.tsx', 'utf8');
assert.match(securityModalSource, /\[isOpen, activeProjectId, firstProjectId\]/, 'SecurityModal initialization must depend on primitive project identity, not projects array identity');
assert.doesNotMatch(securityModalSource, /\[isOpen, activeProjectId, projects\]/, 'projects array identity must not retrigger SecurityModal initialization');

console.log(`Contact Core Golden: PASS (${cases.length} phone normalization cases + persistence/Zalo runtime guards)`);
