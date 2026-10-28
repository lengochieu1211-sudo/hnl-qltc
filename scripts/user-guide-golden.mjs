import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const read = (relative) => fs.readFileSync(path.resolve(relative), 'utf8');
const content = read('src/components/UserGuideContent.ts');
const guide = read('src/components/UserGuideCenter.tsx');
const config = read('src/components/GoogleConfigTab.tsx');
const ids = [...content.matchAll(/\bT\('([a-z0-9-]+)'\s*,/g)].map((match) => match[1]);
assert(ids.length >= 60, 'Deep manual should cover 60+ nested topics');
assert.equal(new Set(ids).size, ids.length, 'Every help topic must have a stable unique id');
assert.match(config, /id="user-guide-center-card"[\s\S]*?<UserGuideCenter\s*\/>/, 'Settings entry must open help in a feature-sheet');
assert.match(config, /lazy\s+unmountOnClose/, 'Help UI should be lazy and unload when closed');
assert.match(guide, /data-hnl-guide-platform="pc"/, 'Separate PC guide must exist');
assert.match(guide, /data-hnl-guide-platform="mobile"/, 'Separate mobile guide must exist');
assert.match(guide, /data-hnl-guide-search="true"/, 'Search must be accessible');
assert.match(guide, /Sơ đồ minh họa thao tác, không phải ảnh chụp ứng dụng/, 'Uncaptured screens must be clearly labelled');
assert.match(content, /Cloud.*P1|P1.*Cloud|P1-07/s, 'High-risk cleanup or ledger topics must retain safety warning');
assert.doesNotMatch(guide, /from [\"']firebase|\b(?:setDoc|updateDoc|deleteDoc|addDoc)\s*\(/i, 'Guide UI must not write Cloud data');
const references = [...content.matchAll(/image\('([^']+)'\)/g)].map((match) => match[1]);
assert(references.length >= 10, 'Real Golden screenshots must be referenced');
for (const image of references) {
  const file = path.resolve('public/user-guide', `${image}.webp`);
  assert(fs.existsSync(file) && fs.statSync(file).size > 1000, `Screenshot missing: ${image}`);
}
// Typography/layout regression: Settings uses text-xs for regular content; desktop platform controls must be compact.
assert.doesNotMatch(guide, /text-\[(?:9|10)px\]/, 'Avoid small 9/10px text in guide; match existing Settings body font');
assert.match(guide, /grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:justify-start/, 'Phone/tablet gets two tap targets; PC should not expand full width');
assert.equal((guide.match(/lg:max-w-\[180px\]/g) || []).length, 2, 'Both PC/mobile platform buttons must be max 180px on PC');
assert.match(guide, /lg:max-w-\[560px\]/, 'PC search control should be compact');
assert.match(guide, /min-h-10.*?lg:flex-none/g, 'PC platform action should have stable width');
console.log(`HNL USER GUIDE GOLDEN PASS: ${ids.length} nested topics, ${new Set(references).size} Golden images, search+platform switch+read-only security`);
