import { spawnSync } from 'node:child_process';

const args = [
  '--yes',
  'firebase-tools@13.35.1',
  'emulators:exec',
  '--only', 'auth,firestore,storage',
  '--project', 'demo-hnl-qltc-rules',
  'node scripts/firebase-rules-behavior.mjs',
];
const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, FIREBASE_PROJECT_ID: 'demo-hnl-qltc-rules', GCLOUD_PROJECT: 'demo-hnl-qltc-rules' },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Firestore + Storage Rules compile/behavior PASS');
