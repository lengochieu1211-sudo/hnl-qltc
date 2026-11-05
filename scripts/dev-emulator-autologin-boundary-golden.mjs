import assert from 'node:assert/strict';
import fs from 'node:fs';

const gate = fs.readFileSync('src/components/AppAuthGate.tsx', 'utf8');
const firebase = fs.readFileSync('src/lib/firebaseBase.ts', 'utf8');
const workflow = fs.readFileSync('.github/workflows/dev-emulator-autologin-golden.yml', 'utf8');
const browser = fs.readFileSync('scripts/dev-emulator-autologin-browser-golden.mjs', 'utf8');

for (const token of [
  'FIREBASE_EMULATOR_ENABLED && (',
  'data-hnl-dev-emulator-auth="true"',
  'data-hnl-dev-test-role={role}',
  'signInWithEmulatorTestAccount(role)',
]) assert(gate.includes(token), `Missing Auth Gate emulator-only marker: ${token}`);
assert(firebase.includes("if (!FIREBASE_EMULATOR_ENABLED || APP_ENVIRONMENT !== 'DEV')"),
  'Emulator login must remain disabled outside local DEV Emulator');
assert(firebase.includes('getCurrentRealFirebaseUser'), 'Real Firebase identity requirement must remain');
assert(workflow.includes('branches: [dev]') && !workflow.includes('branches: [main]'),
  'Test workflow may only trigger on DEV');
assert(workflow.includes('--project demo-hnl-qltc-dev'), 'Test must run on demo-* emulator project');
assert(!workflow.includes('firebase deploy') && !workflow.includes('hosting:clone'), 'Test must never deploy');
assert(browser.includes("'isolated-emulator'"), 'Browser test must require explicit emulator opt-in');
assert(browser.includes("VITE_USE_FIREBASE_EMULATORS: 'true'"), 'Browser test must pin Auth Emulator');
console.log('PASS: DEV-only emulator auth surface, no production login bypass, no deploy');
