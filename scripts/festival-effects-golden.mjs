import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync('src/App.tsx', 'utf8');
const admin = readFileSync('src/components/SuperAdminCenter.tsx', 'utf8');
const effects = readFileSync('src/components/FestivalEffects.tsx', 'utf8');
const css = readFileSync('src/styles/festivalEffects.css', 'utf8');
const mode = readFileSync('src/utils/festivalEffectMode.ts', 'utf8');
assert.match(app, /festivalEffect:\s*'off'/, 'legacy and fresh projects must default off');
assert.match(app, /festivalEffect:\s*normalizeFestivalEffectMode\(raw\?\.festivalEffect\)/, 'cloud settings sanitize unknown modes');
assert.match(app, /React\.lazy\(\(\) => import\('\.\/components\/FestivalEffects'\)/, 'effects should be lazy-loaded');
assert.match(app, /activeTab === 'home' && !isMobileRuntime && !chromeDesktopSite/, 'never run on mobile or Android desktop site');
assert.match(app, /isCurrentSuperAdmin\s*\|\|\s*!getCurrentRealFirebaseUser\(\)/, 'reuse established superadmin server settings guard');
assert.match(admin, /data-hnl-pc-festival-settings/, 'superadmin settings panel must include effect control');
for (const value of ['off','snow','apricot','peach','blossoms','fireworks']) {
  assert.ok(admin.includes(`value="${value}"`), `missing Super Admin select mode: ${value}`);
  assert.ok(mode.includes(`'${value}'`), `mode whitelist missing ${value}`);
}
assert.match(mode, /Android\|iPhone\|iPad\|iPod\|Mobile/, 'no mobile device animations');
assert.match(effects, /document\.hidden/, 'pause on hidden tabs');
assert.match(effects, /prefers-reduced-motion/, 'reduced motion gate');
assert.match(effects, /connection\?\.saveData/, 'power-save gate');
assert.match(effects, /visibilitychange.*update/, 'tab event listener');
assert.match(effects, /removeEventListener\('visibilitychange', update\)/, 'remove tab event listener');
assert.match(css, /pointer-events:none/, 'effects must never block inputs');
assert.match(css, /contain:layout paint/, 'effect containment');
assert.match(css, /prefers-reduced-motion:reduce/, 'CSS reduced motion fallback');
for (const forbidden of ['setDoc(', 'updateDoc(', 'deleteDoc(', 'fetch(', 'localStorage.setItem(', 'sessionStorage.setItem(']) {
  assert.ok(!effects.includes(forbidden), `${forbidden} is forbidden in decoration renderer`);
}
assert.equal((effects.match(/length: 24/g) || []).length,1, 'snow budget should stay bounded');
assert.equal((effects.match(/length: 15/g) || []).length,1, 'blossom budget should stay bounded');
assert.equal((effects.match(/length: 5/g) || []).length,1, 'firework budget should stay bounded');
console.log('FESTIVAL EFFECTS GOLDEN PASS: settings, PC-only, power, auth safety, CSS, budgets');
