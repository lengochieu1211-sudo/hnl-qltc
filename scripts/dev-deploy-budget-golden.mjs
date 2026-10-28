#!/usr/bin/env node
/** CI-only contract: changes to DEV workflow must not silently re-enable auto Hosting deploys. */
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const expect = (ok, reason) => { if (!ok) throw new Error(`DEV deploy budget regression: ${reason}`); };
const actions = f => read(`.github/workflows/${f}`);
const triggers = yml => {
  const match = yml.match(/^on:\s*\n([\s\S]*?)(?=^(?:permissions|concurrency|env|jobs):)/m);
  expect(match, 'Cannot parse workflow triggers');
  return match[1];
};
const deploy = actions('firebase-dev-environment.yml');
const golden = actions('dev-runtime-golden.yml');
const pkg = actions('dev-deliverables.yml');
const build = actions('build.yml');
const bootstrap = actions('firebase-dev-firestore-bootstrap.yml');
const devTrigger = triggers(deploy);
const goldenTrigger = triggers(golden);
expect(/^  workflow_dispatch:\s*$/m.test(devTrigger), 'DEV manual fallback must remain');
expect(/^  push:\s*\n    branches:\s*\n      - dev\s*\n    paths:\s*\n      - '\.github\/dev-release-approval\.json'\s*$/m.test(devTrigger), 'DEV push trigger must require only the exact approval marker path');
expect((devTrigger.match(/^  push:/gm) || []).length === 1, 'No extra DEV push triggers');
expect(/name: Explicit DEV release approval gate/.test(deploy) && /Validate one-shot marker and unchanged source/.test(deploy), 'Missing explicit one-shot approval gate');
expect(/CHANGED_FILES=.*git diff-tree/.test(deploy) && /approved_source_sha/.test(deploy) && /git rev-parse HEAD\^/.test(deploy), 'Approval must be standalone and pinned to its immediate source parent');
expect(/project_id/.test(deploy) && /test "\$DEV_PROJECT_ID" = 'hnl-qltc-dev'/.test(deploy), 'Firebase DEV must be pinned to hnl-qltc-dev');
expect(/^  workflow_dispatch:\s*$/m.test(goldenTrigger), 'Hosted Golden manual fallback must remain');
expect(/^  push:\s*\n    branches:\s*\n      - dev\s*\n    paths:\s*\n      - '\.github\/dev-release-approval\.json'\s*$/m.test(goldenTrigger), 'Golden must only auto-run on the exact approved release marker');
expect((goldenTrigger.match(/^  push:/gm) || []).length === 1, 'Golden may have only one scoped push trigger');
expect(/filter\(x=>x.head_sha===process.env.TARGET_SHA/.test(golden), 'Golden must select an exact DEV deploy SHA');
expect(/\['push','workflow_dispatch'\]\.includes\(x.event\)/.test(golden), 'Golden must accept both approved push and manual DEV deploys');
expect(/^  workflow_dispatch:\s*$/m.test(triggers(bootstrap)) && !/^  push:/m.test(triggers(bootstrap)), 'Firestore DEV bootstrap must not run on push');
expect((deploy.match(/firebase-tools@13\.35\.1 deploy --only hosting\b/g) || []).length === 1, 'DEV release must publish Hosting once');
expect(!/\b(?:firebase-tools@\S+ deploy --only hosting|hosting:channel:deploy|action-hosting-deploy)\b/.test(golden), 'Golden must never deploy Hosting');
expect(/hnl-dev-release\.json/.test(deploy), 'DEV publish must create hosted release identity');
expect(/dev-release-gate\.mjs verify/.test(golden), 'Golden must verify hosted SHA/asset bytes');
expect(/hnl-qltc-dev-release/.test(deploy), 'DEV deployment must retain its release serialization lock');
expect(/hnl-qltc-dev-runtime-golden-/.test(golden) && !/group: hnl-qltc-dev-release/.test(golden), 'Golden must not block the release it waits for');
expect(/cancel-in-progress:\s*false/.test(deploy) && /cancel-in-progress:\s*false/.test(golden), 'DEV publish and Golden queues must not cancel runs');
expect(/if: github\.event_name == 'workflow_dispatch'/.test(pkg), 'Certification package must not run automatically on push');
expect(/Firebase Rules certification/.test(pkg) && /workflow_dispatch/.test(triggers(pkg)), 'Rules certification and manual delivery must remain');
expect(/branches:\s*\n\s+- main\n\s+- dev/.test(build), 'CI build gates must run on every DEV push');
const firebase = JSON.parse(read('firebase.json'));
// Validate Hosting's schema, not just JSON.parse: nested source/headers objects inside
// headers[] are syntactically valid JSON but invalid Firebase header definitions.
const expectedCache = new Map([
  ['/hnl-dev-release.json', 'no-cache, no-store, must-revalidate'],
  ['/', 'no-cache, no-store, must-revalidate'],
  ['/index.html', 'no-cache, no-store, must-revalidate'],
  ['/sw.js', 'no-cache, no-store, must-revalidate'],
  ['/sw-assets.json', 'no-cache, no-store, must-revalidate'],
  ['/assets/**', 'public, max-age=31536000, immutable'],
]);
expect(firebase.hosting?.public === 'dist', 'Hosting public directory changed');
expect(Array.isArray(firebase.hosting?.headers), 'Hosting headers must be an array');
expect(firebase.hosting.headers.length === expectedCache.size, 'Unexpected Hosting cache header routes');
const seenCacheSources = new Set();
for (const route of firebase.hosting.headers) {
  expect(route && typeof route === 'object' && !Array.isArray(route), 'Invalid Hosting header route');
  expect(Object.keys(route).sort().join(',') === 'headers,source', 'Unexpected Hosting header route fields');
  expect(expectedCache.has(route.source) && !seenCacheSources.has(route.source), `Unexpected/duplicate Hosting header route: ${route.source}`);
  seenCacheSources.add(route.source);
  expect(Array.isArray(route.headers) && route.headers.length === 1, `Invalid headers[] for ${route.source}`);
  const header = route.headers[0];
  expect(header && typeof header === 'object' && !Array.isArray(header), `Invalid header for ${route.source}`);
  expect(Object.keys(header).sort().join(',') === 'key,value', `Malformed Firebase header schema for ${route.source}`);
  expect(header.key === 'Cache-Control' && header.value === expectedCache.get(route.source), `Unexpected cache policy for ${route.source}`);
}
expect(seenCacheSources.size === expectedCache.size, 'Missing Hosting cache header route');
const prod = actions('firebase-hosting-merge.yml');
expect(/^  workflow_dispatch:\s*$/m.test(triggers(prod)), 'PROD manual gate must remain');
console.log('DEV deploy budget regression: PASS — CI auto; one-shot approved DEV publish and post-release Golden; package manual; one Hosting publish; SHA guard; PROD manual');
