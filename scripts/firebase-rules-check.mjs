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

// Keep the retry budget strictly below the 5-minute GitHub Actions step timeout.
// A previous unrelated change raised one attempt from 75s to 180s, which meant the
// first flaky Storage-emulator startup could consume most of the step and prevent
// the retry strategy from ever completing. 75s is the last CI-proven bound.
const ATTEMPT_TIMEOUT_MS = 75000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const TERMINATION_GRACE_MS = 5000;
const WORKFLOW_STEP_BUDGET_MS = 5 * 60 * 1000;
const WORKFLOW_SAFETY_MARGIN_MS = 30 * 1000;

const worstCaseRetryBudgetMs =
  MAX_ATTEMPTS * (ATTEMPT_TIMEOUT_MS + TERMINATION_GRACE_MS)
  + (MAX_ATTEMPTS - 1) * RETRY_DELAY_MS;

if (worstCaseRetryBudgetMs > WORKFLOW_STEP_BUDGET_MS - WORKFLOW_SAFETY_MARGIN_MS) {
  throw new Error(
    `Firebase Rules retry budget ${worstCaseRetryBudgetMs}ms exceeds the safe GitHub step budget`,
  );
}

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

  const deadline = Date.now() + TERMINATION_GRACE_MS;
  while (child.exitCode === null && Date.now() < deadline) await sleep(100);

  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

function runRulesBehaviorAttempt(attempt, timeoutMs = ATTEMPT_TIMEOUT_MS) {
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
    let timingOut = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(async () => {
      timingOut = true;
      await terminateProcessTree(child);
      finish(reject, new Error(`Firebase Rules emulators:exec attempt ${attempt} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code, signal) => {
      // During timeout cleanup SIGTERM/SIGKILL is expected; let the timer path
      // report the deterministic timeout instead of racing with the exit event.
      if (timingOut) return;
      if (code === 0) finish(resolve);
      else finish(reject, new Error(`Firebase Rules emulators:exec attempt ${attempt} failed: exit code=${code}, signal=${signal || 'none'}`));
    });
  });
}

let lastError;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  try {
    await runRulesBehaviorAttempt(attempt);
    console.log('Firestore + Storage Rules compile/behavior PASS');
    process.exitCode = 0;
    lastError = undefined;
    break;
  } catch (error) {
    lastError = error;
    console.warn(`Firebase Rules emulator attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error?.message || error}`);
    if (attempt < MAX_ATTEMPTS) {
      console.log('Retrying with a clean Firebase emulator process...');
      await sleep(RETRY_DELAY_MS);
    }
  }
}

if (lastError) throw lastError;
