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
for (const forbidden of ['setDoc(', 'updateDoc(', 'deleteDoc(', 'fetch(', 'localStorage.setItem(', 'sessionStorage.setItem(', 'setInterval(', 'requestAnimationFrame(']) {
  assert.ok(!effects.includes(forbidden), `${forbidden} is forbidden in decoration renderer`);
}
// Realistic effects without introducing unbounded particles, canvas loops or assets.
assert.match(effects, /length: 56/, 'snow should have a bounded, fuller density');
assert.match(effects, /length: 15/, 'blossom budget must remain unchanged');
assert.match(effects, /length: 8/, 'firework burst count must stay bounded');
assert.match(effects, /length: 26/, 'rays per burst must stay bounded');
assert.match(effects, /length: 16/, 'embers per burst must stay bounded');
assert.match(effects, /depth === 0[^\n]+depth === 1/, 'snow must have multiple perspective depths');
assert.match(css, /radial-gradient\(circle at 35% 30%/, 'snow needs a white core with contrast on white backgrounds');
assert.match(css, /--snow-x25/, 'snow must sway while falling');
assert.match(css, /\.hnl-festival-firework-flash/, 'firework core flash must exist');
assert.match(css, /\.hnl-festival-ember/, 'firework fading embers must exist');
assert.match(css, /drop-shadow/, 'fireworks need a visible halo on light surfaces');
assert.doesNotMatch(css, /canvas|url\(/, 'render without canvas or remote resources');
console.log('FESTIVAL EFFECTS GOLDEN PASS: settings, PC-only, power, auth safety, contrast, density, 3D snow and layered fireworks');
