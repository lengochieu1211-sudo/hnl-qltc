import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const firebaseArgs = [
  '--yes',
  'firebase-tools@13.35.1',
  'emulators:exec',
  '--only', 'auth,firestore,storage',
  '--project', 'demo-hnl-qltc-rules',
  'node scripts/firebase-rules-behavior.mjs',
];

// Do not spawn `npx.cmd` directly on Windows. Newer Node/Windows runner combinations can
// reject direct .cmd execution with spawnSync EINVAL when shell=false. npm scripts expose
// npm_execpath, and npm's npx-cli.js sits beside npm-cli.js, so execute that JavaScript CLI
// through the current Node binary. This keeps argument boundaries intact and avoids shell
// quoting/injection differences while remaining portable across Windows/Linux/macOS.
const npmExecPath = String(process.env.npm_execpath || '').trim();
const npxCliPath = npmExecPath ? path.join(path.dirname(npmExecPath), 'npx-cli.js') : '';
const hasNpxCli = Boolean(npxCliPath && fs.existsSync(npxCliPath));

let command;
let args;
let shell = false;

if (hasNpxCli) {
  command = process.execPath;
  args = [npxCliPath, ...firebaseArgs];
} else if (process.platform === 'win32') {
  // Defensive fallback for direct `node scripts/firebase-rules-check.mjs` execution outside
  // npm. cmd.exe is the Windows-supported launcher for .cmd shims; all arguments here are
  // fixed repository constants, not user/model input.
  command = process.env.ComSpec || 'cmd.exe';
  const quoted = firebaseArgs.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(' ');
  args = ['/d', '/s', '/c', `npx ${quoted}`];
} else {
  command = 'npx';
  args = firebaseArgs;
}

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell,
  env: {
    ...process.env,
    FIREBASE_PROJECT_ID: 'demo-hnl-qltc-rules',
    GCLOUD_PROJECT: 'demo-hnl-qltc-rules',
  },
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Firestore + Storage Rules compile/behavior PASS');
