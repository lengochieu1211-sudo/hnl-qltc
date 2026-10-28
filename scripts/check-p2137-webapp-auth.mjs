#!/usr/bin/env node
// Pure read-only validation of P21.37 DEV BACKUP first-party Auth build configuration.
// Never contacts Firebase, never modifies files or user data.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';

const root = process.argv[2] || '.';
const workflow = join(root, '.github/workflows/p2137-dev-backup-canonical-smoke.yml');
const authSource = join(root, 'src/lib/firebaseBase.ts');
const bootstrap = join(root, 'src/main.tsx');
const persistence = join(root, 'src/lib/authPersistence.ts');
for (const p of [workflow, authSource, bootstrap, persistence]) {
  assert.ok(existsSync(p), `Missing required file: ${p}`);
}
const src = readFileSync(workflow, 'utf8');
const auth = readFileSync(authSource, 'utf8');
const main = readFileSync(bootstrap, 'utf8');
const persist = readFileSync(persistence, 'utf8');

function exactlyOnce(s, needle) {
  assert.equal(s.split(needle).length - 1, 1, `Required exactly once: ${needle}`);
}
const host = 'hnl-qltc-dev-backup.web.app';
const proj = 'hnl-qltc-dev-backup';
const r2 = 'https://hnl-qltc-r2-gateway-dev-backup.lengochieu1211.workers.dev';

exactlyOnce(src, `VITE_FIREBASE_AUTH_DOMAIN: ${host}`);
exactlyOnce(src, `cfg.authDomain='${host}';`);
exactlyOnce(src, `test "$VITE_FIREBASE_AUTH_DOMAIN" = '${host}'`);
exactlyOnce(src, `grep -R -q '${host}' dist/assets`);
exactlyOnce(src, `https://${host}/?p2137=1`);
exactlyOnce(src, `https://${host}/__/firebase/init.json`);
exactlyOnce(src, `"origin":"${host}"`);
exactlyOnce(src, `BACKUP_PROJECT: ${proj}`);
exactlyOnce(src, `VITE_R2_GATEWAY_URL: ${r2}`);
assert.ok(!src.includes(`VITE_FIREBASE_AUTH_DOMAIN: ${proj}.firebaseapp.com`), 'Cross-origin build config detected');
assert.ok(!src.includes(`cfg.authDomain='${proj}.firebaseapp.com'`), 'Cross-origin SDK override detected');
assert.ok(!src.includes('hnl-qltc-r2-gateway.lengochieu1211.workers.dev'), 'PROD R2 must not be used');
assert.ok(!src.includes('deploy --only firestore'), 'Firestore deploy forbidden');
assert.ok(!src.includes('deploy --only storage'), 'Storage rules deploy forbidden');
assert.ok(src.includes('deploy --only hosting'), 'Original live deploy workflow expected: NEVER push this workflow to its trigger branch during CI');
assert.ok(src.includes('p2137-rollback'), 'Existing rollback channel reference must remain');
assert.ok(auth.includes('await signInWithRedirect(auth, provider)'), 'Android redirect Auth invariant missing');
assert.ok(auth.includes('await signInWithPopup(auth, provider)'), 'Desktop popup Auth invariant missing');
assert.ok(persist.includes('await getRedirectResult(auth)'), 'Google redirect completion missing');
assert.ok(main.includes('await prepareFirebaseAuthPersistence()'), 'Auth persistence preflight missing');
assert.ok(main.includes('await completeFirebaseAuthRedirect()'), 'Auth redirect bootstrap missing');
console.log('PASS: 20 DEV BACKUP first-party Auth, isolation, R2, rollback and existing-flow assertions; read-only');
