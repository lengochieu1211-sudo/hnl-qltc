import fs from 'node:fs';
const read = (p) => fs.readFileSync(p, 'utf8');
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
const pass = (m) => console.log(`PASS: ${m}`);
const includesAll = (t, ns, l) => { for (const n of ns) if (!t.includes(n)) fail(`${l}: missing ${n}`); };

const firebase = read('src/lib/firebase.ts');
const storage = read('src/lib/firebaseStorage.ts');
const appCheck = read('src/lib/appCheck.ts');
const authModal = read('src/components/GoogleAuthModal.tsx');
const firebaseJson = JSON.parse(read('firebase.json'));
const pkg = JSON.parse(read('package.json'));
const vite = read('vite.config.ts');
const workflow = read('.github/workflows/firebase-hosting-pull-request.yml');

includesAll(firebase, ['VITE_USE_FIREBASE_EMULATORS', "APP_ENVIRONMENT === 'PROD'", 'FIREBASE_EMULATOR_PROJECT_ID === PROD_FIREBASE_PROJECT_ID', "startsWith('demo-')", 'connectFirestoreEmulator', 'connectAuthEmulator', 'signInWithEmulatorTestAccount'], 'Firebase emulator runtime guard');
if (!firebase.includes("const PROD_FIREBASE_PROJECT_ID = 'com-example-qlct-61329'")) fail('Production project guard changed or missing');
if (!firebase.includes('const firebaseConfig = FIREBASE_EMULATOR_ENABLED')) fail('Emulator config is not forced independently of ambient live VITE_FIREBASE_* variables');
pass('Emulator runtime is DEV-only, demo-only, and ignores ambient live Firebase config');

includesAll(storage, ['connectStorageEmulator', 'FIREBASE_EMULATOR_ENABLED'], 'Storage emulator connection');
includesAll(appCheck, ['FIREBASE_EMULATOR_ENABLED', 'if (FIREBASE_EMULATOR_ENABLED) return null'], 'App Check emulator bypass');
includesAll(authModal, ['DEV Emulator Golden', 'signInWithEmulatorTestAccount', "['ADMIN', 'EDITOR', 'VIEWER']"], 'Deterministic DEV users');
pass('Auth/Firestore/Storage and deterministic multi-user test identities are wired');

for (const [name, port] of [['auth', 9099], ['firestore', 8080], ['storage', 9199], ['hosting', 5000]]) {
  const cfg = firebaseJson.emulators?.[name];
  if (!cfg || cfg.port !== port || cfg.host !== '0.0.0.0') fail(`${name} emulator must bind 0.0.0.0:${port}`);
}
if (firebaseJson.emulators?.ui?.port !== 4000) fail('Emulator UI port must be 4000');
pass('Emulators expose LAN-testable fixed ports');

includesAll(vite, ['VITE_USE_FIREBASE_EMULATORS', 'VITE_FIREBASE_EMULATOR_PROJECT_ID', 'VITE_FIREBASE_EMULATOR_HOST'], 'Vite emulator env propagation');
if (pkg.scripts?.['dev:emulator'] !== 'node scripts/emulator-dev.mjs start') fail('dev:emulator script missing');
if (pkg.scripts?.['build:emulator'] !== 'node scripts/emulator-dev.mjs build') fail('build:emulator script missing');
if (!String(pkg.scripts?.['test:stability'] || '').includes('emulator-golden.mjs')) fail('emulator golden is not part of stability gate');
pass('Cross-platform emulator launch/build scripts are wired into CI stability');

const launcher = read('scripts/emulator-dev.mjs');
includesAll(launcher, ["process.env.ComSpec || 'cmd.exe'", "['/d', '/s', '/c'", "`${name}.cmd`", "shell: false"], 'Windows npm/npx launcher');
if (launcher.includes('spawnSync(executable(name)')) fail('Regression: Windows launcher directly spawns npm.cmd/npx.cmd and can hit EINVAL on Node 24');
pass('Windows npm/npx launcher uses cmd.exe and avoids direct .cmd spawn EINVAL');

if (!workflow.includes("vars.HNL_QLTC_DEV_PROJECT_ID != ''")) fail('Optional Cloud DEV preview must skip when no separate DEV project is configured');
if (!workflow.includes('DEV Firebase isolation gate') || !workflow.includes('!= "com-example-qlct-61329"')) fail('Cloud DEV workflow no longer blocks PROD');
pass('Cloud DEV preview is optional while its PROD isolation gate remains intact');
console.log('EMULATOR DEV GOLDEN CONFIG PASS');
