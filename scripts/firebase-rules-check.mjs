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
}

function runRulesBehavior(timeoutMs = 240000) {
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

    console.log('Starting isolated Firebase Rules emulators via emulators:exec');
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env,
      shell: false,
      detached: process.platform !== 'win32',
    });

    const timer = setTimeout(async () => {
      await terminateProcessTree(child);
      reject(new Error(`Firebase Rules emulators:exec timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        console.log('Firestore + Storage Rules compile/behavior PASS');
        resolve();
      } else {
        reject(new Error(`Firebase Rules emulators:exec failed: exit code=${code}, signal=${signal || 'none'}`));
      }
    });
  });
}

await runRulesBehavior();
