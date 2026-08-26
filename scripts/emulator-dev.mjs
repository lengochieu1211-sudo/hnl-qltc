import { spawnSync } from 'node:child_process';
import os from 'node:os';

const action = process.argv[2] || 'start';
if (!['build', 'start'].includes(action)) {
  console.error('Usage: node scripts/emulator-dev.mjs [build|start]');
  process.exit(2);
}

const projectId = 'demo-hnl-qltc-dev';
if (String(process.env.VITE_APP_ENV || '').toUpperCase() === 'PROD') {
  console.error('REFUSING: dev:emulator cannot be launched from a PROD environment.');
  process.exit(1);
}

const emulatorEnv = {
  ...process.env,
  VITE_APP_ENV: 'DEV',
  VITE_RUNTIME_BACKEND: 'firebase-only',
  VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_FIREBASE_EMULATOR_PROJECT_ID: projectId,
  VITE_FIREBASE_EMULATOR_HOST: 'auto',
  VITE_FIREBASE_AUTH_EMULATOR_PORT: '9099',
  VITE_FIRESTORE_EMULATOR_PORT: '8080',
  VITE_FIREBASE_STORAGE_EMULATOR_PORT: '9199',
  VITE_ENABLE_LEGACY_DRIVE_WRITE: 'false',
  VITE_ENABLE_LEGACY_LOCAL_BUSINESS_CACHE_WRITE: 'false',
};

function quoteCmdToken(value) {
  // Keep simple controlled tokens unquoted. npm on Windows treats literal
  // quotes around command names (for example "run") as part of the token.
  // Quote only when cmd.exe actually needs it.
  const token = String(value);
  if (!/[\s&()<>^|]/.test(token)) return token;
  return `"${token.replace(/"/g, '\\"')}"`;
}

function run(name, args) {
  const isWindows = process.platform === 'win32';
  const commandName = isWindows && (name === 'npm' || name === 'npx') ? `${name}.cmd` : name;
  const executable = isWindows ? (process.env.ComSpec || 'cmd.exe') : commandName;
  const executableArgs = isWindows
    ? ['/d', '/s', '/c', [commandName, ...args].map(quoteCmdToken).join(' ')]
    : args;

  const result = spawnSync(executable, executableArgs, {
    cwd: process.cwd(),
    env: emulatorEnv,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('=== HNL QLTC RC2.2.2 DEV Emulator ===');
console.log(`Project: ${projectId} (demo-* only; never PROD)`);
console.log('Building DEV Emulator bundle...');
run('npm', ['run', 'build']);

if (action === 'build') {
  console.log('EMULATOR BUILD PASS');
  process.exit(0);
}

const lanIps = [];
for (const entries of Object.values(os.networkInterfaces())) {
  for (const item of entries || []) {
    if (item.family === 'IPv4' && !item.internal) lanIps.push(item.address);
  }
}
console.log('\nOpen on this PC: http://127.0.0.1:5000');
for (const ip of [...new Set(lanIps)]) console.log(`Open on phone (same Wi-Fi): http://${ip}:5000`);
console.log('Emulator UI: http://127.0.0.1:4000');
console.log('Auth 9099 | Firestore 8080 | Storage 9199 | Hosting 5000');
console.log('Press Ctrl+C to stop. Emulator data is disposable by design.\n');

run('npx', [
  '--yes', 'firebase-tools@13.35.1', 'emulators:start',
  '--project', projectId,
  '--only', 'auth,firestore,storage,hosting',
]);
