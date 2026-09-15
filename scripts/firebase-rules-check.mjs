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

const emulatorTargets = [
  { name: 'Auth', host: '127.0.0.1', port: 9099 },
  { name: 'Firestore', host: '127.0.0.1', port: 8080 },
  { name: 'Storage', host: '127.0.0.1', port: 9199 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function probePort({ host, port }, timeoutMs = 750) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForPorts(expectedOpen, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (expectedOpen && child && child.exitCode !== null) {
      throw new Error(`Firebase emulator process exited before readiness: exit code=${child.exitCode}, signal=${child.signalCode || 'none'}`);
    }
    const states = await Promise.all(emulatorTargets.map((target) => probePort(target)));
    const ready = expectedOpen ? states.every(Boolean) : states.every((open) => !open);
    if (ready) return;
    await sleep(500);
  }
  const stateText = (await Promise.all(emulatorTargets.map(async (target) => ({
    ...target,
    open: await probePort(target),
  })))).map((target) => `${target.name}:${target.port}=${target.open ? 'open' : 'closed'}`).join(', ');
  throw new Error(`Firebase emulator ports did not become ${expectedOpen ? 'ready' : 'closed'} within ${timeoutMs / 1000}s (${stateText})`);
}

function waitForExit(child, label, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(async () => {
      await terminateProcessTree(child);
      finish(reject, new Error(`${label} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code, signal) => {
      if (code === 0) finish(resolve);
      else finish(reject, new Error(`${label} failed: exit code=${code}, signal=${signal || 'none'}`));
    });
  });
}

async function runRulesBehaviorAttempt(attempt, startupTimeoutMs = 180000, behaviorTimeoutMs = 120000) {
  await waitForPorts(false, 15000).catch(async (error) => {
    console.warn(`Firebase emulator ports were not clean before attempt ${attempt}: ${error.message}`);
    throw error;
  });

  const { command, prefix } = resolveNpx();
  const args = [
    ...prefix,
    '--yes',
    'firebase-tools@13.35.1',
    'emulators:start',
    '--config', 'firebase.rules-ci.json',
    '--only', 'auth,firestore,storage',
    '--project', demoProject,
  ];

  console.log(`Starting isolated Firebase Rules emulators with explicit readiness probe (attempt ${attempt})`);
  const emulatorChild = spawn(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env,
    shell: false,
    detached: process.platform !== 'win32',
  });

  try {
    await waitForPorts(true, startupTimeoutMs, emulatorChild);
    // Port readiness can precede the final Rules runtime initialization by a few ticks.
    await sleep(750);
    console.log(`Firebase emulator ports ready: ${emulatorTargets.map((target) => `${target.name}:${target.port}`).join(', ')}`);

    const behaviorChild = spawn(process.execPath, ['scripts/firebase-rules-behavior.mjs'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env,
      shell: false,
      detached: false,
    });
    await waitForExit(behaviorChild, 'Firebase Rules behavior test', behaviorTimeoutMs);
  } finally {
    await terminateProcessTree(emulatorChild);
    await waitForPorts(false, 15000).catch((error) => {
      console.warn(`Firebase emulator shutdown port check: ${error.message}`);
    });
  }
}

const maxAttempts = 3;
let lastError;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    await runRulesBehaviorAttempt(attempt);
    console.log('Firestore + Storage Rules compile/behavior PASS');
    process.exitCode = 0;
    lastError = undefined;
    break;
  } catch (error) {
    lastError = error;
    console.warn(`Firebase Rules emulator attempt ${attempt}/${maxAttempts} failed: ${error?.message || error}`);
    if (attempt < maxAttempts) {
      console.log('Retrying with a clean Firebase emulator process...');
      await sleep(2000);
    }
  }
}

if (lastError) throw lastError;
