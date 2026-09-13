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

function runAttempt(attempt, timeoutMs = 100000) {
  return new Promise((resolve) => {
    const { command, prefix } = resolveNpx();
    const firebaseArgs = [
      '--yes',
      'firebase-tools@13.35.1',
      'emulators:exec',
      '--only', 'auth,firestore,storage',
      '--project', demoProject,
      'node scripts/firebase-rules-behavior.mjs',
    ];

    console.log(`Firebase Rules emulator attempt ${attempt}/2`);
    const child = spawn(command, [...prefix, ...firebaseArgs], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env,
      shell: false,
      detached: process.platform !== 'win32',
    });

    let settled = false;
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!result.ok) await terminateProcessTree(child);
      resolve(result);
    };

    const timer = setTimeout(() => {
      void finish({ ok: false, reason: `timeout after ${timeoutMs / 1000}s` });
    }, timeoutMs);

    child.once('error', (error) => {
      void finish({ ok: false, reason: error.message });
    });

    child.once('exit', (code, signal) => {
      if (code === 0) void finish({ ok: true });
      else void finish({ ok: false, reason: `exit code=${code}, signal=${signal || 'none'}` });
    });
  });
}

let lastFailure = 'unknown failure';
for (let attempt = 1; attempt <= 2; attempt += 1) {
  const result = await runAttempt(attempt);
  if (result.ok) {
    console.log('Firestore + Storage Rules compile/behavior PASS');
    process.exit(0);
  }

  lastFailure = result.reason;
  console.error(`Firebase Rules emulator attempt ${attempt}/2 failed: ${lastFailure}`);
  if (attempt < 2) {
    await sleep(5000);
  }
}

throw new Error(`Firebase Rules compile/behavior failed after retry: ${lastFailure}`);
