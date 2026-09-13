import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

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
    const finish = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForEmulators(timeoutMs = 90000) {
  const ports = [9099, 8080, 9199];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await Promise.all(ports.map((port) => canConnect(port)));
    if (ready.every(Boolean)) return;
    await sleep(1000);
  }
  throw new Error(`Firebase emulators were not ready within ${timeoutMs / 1000}s`);
}

async function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      shell: false,
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }

  const deadline = Date.now() + 5000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(100);

  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

function runBehavior(timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/firebase-rules-behavior.mjs'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env,
      shell: false,
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Firebase Rules behavior timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Firebase Rules behavior failed: exit code=${code}, signal=${signal || 'none'}`));
    });
  });
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

console.log('Starting isolated Firebase Rules emulators');
const emulator = spawn(command, [...prefix, ...firebaseArgs], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env,
  shell: false,
  detached: process.platform !== 'win32',
});

try {
  await waitForEmulators();
  console.log('Firebase Rules emulators are ready');
  await runBehavior();
  console.log('Firestore + Storage Rules compile/behavior PASS');
} finally {
  await terminateProcessTree(emulator);
}
