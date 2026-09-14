import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const demoProject = 'demo-hnl-qltc-rules';
const env = {
  ...process.env,
  FIREBASE_PROJECT_ID: demoProject,
  GCLOUD_PROJECT: demoProject,
  GOOGLE_CLOUD_PROJECT: demoProject,
};

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

function runRulesBehaviorAttempt(attempt, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const { command, prefix } = resolveNpx();
    const behaviorCommand = `"${process.execPath}" scripts/firebase-rules-behavior.mjs`;
    const args = [
      ...prefix,
      '--yes',
      'firebase-tools@13.35.1',
      'emulators:exec',
      '--config', 'firebase.rules-ci.json',
      '--only', 'auth,firestore,storage',
      '--project', demoProject,
      behaviorCommand,
    ];

    console.log(`Starting isolated Firebase Rules emulators via emulators:exec (attempt ${attempt})`);
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env,
      shell: false,
      detached: process.platform !== 'win32',
    });

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(async () => {
      await terminateProcessTree(child);
      finish(reject, new Error(`Firebase Rules emulators:exec attempt ${attempt} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code, signal) => {
      if (code === 0) finish(resolve);
      else finish(reject, new Error(`Firebase Rules emulators:exec attempt ${attempt} failed: exit code=${code}, signal=${signal || 'none'}`));
    });
  });
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
