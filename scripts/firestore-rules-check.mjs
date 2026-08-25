import { spawnSync } from 'node:child_process';

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const projectId = 'com-example-qlct-61329';
const args = [
  '--yes',
  'firebase-tools@13.35.1',
  'emulators:exec',
  '--only',
  'firestore',
  '--project',
  projectId,
  'node scripts/firestore-rules-smoke.mjs',
];

const result = spawnSync(npxCommand, args, {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error('Unable to start Firebase Rules compile check:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
