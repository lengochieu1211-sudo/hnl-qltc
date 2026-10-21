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
expect(/^  workflow_dispatch:\s*$/m.test(devTrigger) && !/^  push:/m.test(devTrigger), 'DEV publish must be manual-only');
expect(/^  workflow_dispatch:\s*$/m.test(goldenTrigger) && !/^  push:/m.test(goldenTrigger), 'Hosted Golden must be manual-only');
expect(/^  workflow_dispatch:\s*$/m.test(triggers(bootstrap)) && !/^  push:/m.test(triggers(bootstrap)), 'Firestore DEV bootstrap must not run on push');
expect((deploy.match(/firebase-tools@13\.35\.1 deploy --only hosting\b/g) || []).length === 1, 'DEV release must publish Hosting once');
expect(!/\b(?:firebase-tools@\S+ deploy --only hosting|hosting:channel:deploy|action-hosting-deploy)\b/.test(golden), 'Golden must never deploy Hosting');
expect(/hnl-dev-release\.json/.test(deploy), 'DEV publish must create hosted release identity');
expect(/dev-release-gate\.mjs verify/.test(golden), 'Golden must verify hosted SHA/asset bytes');
expect(/hnl-qltc-dev-release/.test(deploy) && /hnl-qltc-dev-release/.test(golden), 'Release and Golden must share single concurrency lock');
expect(/cancel-in-progress:\s*false/.test(deploy) && /cancel-in-progress:\s*false/.test(golden), 'Release lock must not cancel a running Golden');
expect(/if: github\.event_name == 'workflow_dispatch'/.test(pkg), 'Certification package must not run automatically on push');
expect(/Firebase Rules certification/.test(pkg) && /workflow_dispatch/.test(triggers(pkg)), 'Rules certification and manual delivery must remain');
expect(/branches:\s*\n\s+- main\n\s+- dev/.test(build), 'CI build gates must run on every DEV push');
const firebase = JSON.parse(read('firebase.json'));
const h = firebase.hosting.headers.find(x => x.source === '/hnl-dev-release.json');
expect(h?.headers?.some(x => x.key === 'Cache-Control' && x.value.includes('no-store')), 'Release identity must not be cached');
const prod = actions('firebase-hosting-merge.yml');
expect(/^  workflow_dispatch:\s*$/m.test(triggers(prod)), 'PROD manual gate must remain');
console.log('DEV deploy budget regression: PASS — CI auto; DEV/Golden/package manual; one Hosting publish; SHA guard; PROD manual');
