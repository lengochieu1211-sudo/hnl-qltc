import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

const demoProject = 'demo-hnl-qltc-rules';
const env = {
  ...process.env,
  FIREBASE_PROJECT_ID: demoProject,
  GCLOUD_PROJECT: demoProject,
  GOOGLE_CLOUD_PROJECT: demoProject,
};

function resolveNpx() {
  const npmExecPath = String(process.env.npm_execpath || '').trim();
  const npxCliPath = npmExecPath ? path.join(path.dirname(npmExecPath), 'npx-cli.js') : '';
  if (npxCliPath && fs.existsSync(npxCliPath)) {
    return { command: process.execPath, prefix: [npxCliPath] };
  }
  if (process.platform === 'win32') {
    return { command: process.env.ComSpec || 'cmd.exe', prefix: ['/d', '/s', '/c', 'npx'] };
  }
  return { command: 'npx', prefix: [] };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(800);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForEmulators(child, timeoutMs = 90000) {
  const ports = [9099, 8080, 9199];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Firebase emulator process exited before readiness (code ${child.exitCode})`);
    }
    const ready = await Promise.all(ports.map(canConnect));
    if (ready.every(Boolean)) return;
    await sleep(500);
  }
  throw new Error(`Firebase emulators did not expose ports ${ports.join(', ')} within ${timeoutMs / 1000}s`);
}

function runBehavior(timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/firebase-rules-behavior.mjs'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env,
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Firebase Rules behavior exceeded ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Firebase Rules behavior failed (code=${code}, signal=${signal || 'none'})`));
    });
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + 5000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(100);
  if (child.exitCode === null) child.kill('SIGKILL');
}

const { command, prefix } = resolveNpx();
const firebaseArgs = [
  '--yes',
  'firebase-tools@13.35.1',
  'emulators:start',
  '--config', 'firebase.rules-ci.json',
  '--only', 'auth,firestore,storage',
  '--project', demoProject,
];

const child = spawn(command, [...prefix, ...firebaseArgs], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env,
  shell: false,
});

try {
  await waitForEmulators(child);
  console.log('Firebase Rules emulators ready on 9099/8080/9199');
  await runBehavior();
  console.log('Firestore + Storage Rules compile/behavior PASS');
} finally {
  await stopChild(child);
}
