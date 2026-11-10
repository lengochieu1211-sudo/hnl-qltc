import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nav = readFileSync('src/components/BottomNav.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');
const desktopStart = nav.indexOf('<aside data-hnl-nav-surface="desktop"');
const mobileStart = nav.indexOf('data-hnl-nav-surface="mobile"');
assert.ok(desktopStart >= 0 && mobileStart > desktopStart, 'PC and mobile nav must stay separate');
const desktop = nav.slice(desktopStart, mobileStart);
const mobile = nav.slice(mobileStart);
assert.match(desktop, /<nav data-hnl-desktop-primary-nav="true"/);
assert.match(desktop, /<div data-hnl-desktop-footer="true"/);
assert.equal((desktop.match(/\brounded-lg\b/g) || []).length, 6, 'PC buttons keep lightly rounded corners');
assert.doesNotMatch(desktop, /\brounded-2xl\b/, 'PC buttons must not be pill shaped');
assert.match(mobile, /\brounded-2xl\b/, 'Mobile menu styles are unchanged');
assert.match(desktop, /<span className="block w-\[68px\] shrink-0 whitespace-nowrap text-center text-\[9px\] font-bold leading-3">\{tab\.label\}<\/span>/, 'PC labels must stay centered and untruncated');
assert.doesNotMatch(desktop, /max-w-full truncate text-\[9px\]/, 'PC labels are not clipped');

const desktopMarker = '/* DEV 2026-11-09: distribute unused vertical rail space';
const squareMarker = '/* DEV 2026-11-09: exact-square desktop left-rail targets.';
assert.ok(css.includes(desktopMarker) && css.includes(squareMarker), 'CSS must be ported exactly from DEV');
const styles = css.slice(css.indexOf(desktopMarker));
assert.match(styles, /justify-content: space-evenly;/);
const square = styles.slice(styles.indexOf(squareMarker));
const p = '[data-hnl-nav-surface="desktop"] [data-hnl-desktop-primary-nav="true"] > button';
const f = '[data-hnl-nav-surface="desktop"] [data-hnl-desktop-footer="true"] > button';
const tiers = square.split(/(?=@media \(max-height: (?:820|680|560)px\))/);
assert.equal(tiers.length, 4, 'Default and three desktop-only height breakpoints required');
const dimensions = [[62,58],[58,54],[52,50],[44,44]];
for (let i = 0; i < tiers.length; i++) {
  for (const [selector,size] of [[p,dimensions[i][0]],[f,dimensions[i][1]]]) {
    const at = tiers[i].indexOf(selector);
    assert.ok(at >= 0, 'Missing PC button selector at tier ' + i);
    const decl = tiers[i].slice(at+selector.length).split('}')[0];
    assert.match(decl, new RegExp('width:\\s*'+size+'px;'), 'Missing square width');
    assert.match(decl, new RegExp('height:\\s*'+size+'px;'), 'Missing square height');
  }
}
assert.match(square, /margin-inline: auto;/, 'Footer square remains centered');
assert.doesNotMatch(styles, /data-hnl-nav-surface="mobile"/, 'CSS must not modify mobile menu');
console.log('PROD PR424 PC SIDEBAR TRUE SQUARE GOLDEN: PASS (1:1, radius, captions, density, mobile isolation)');
