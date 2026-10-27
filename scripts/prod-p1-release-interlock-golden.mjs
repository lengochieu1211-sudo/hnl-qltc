/**
 * P6: dependency-free CI workflow regression. This only checks fail-closed
 * workflow wiring; it DOES NOT validate Firestore Rules correctness or deploy.
 * Run: node scripts/prod-p1-release-interlock-golden.mjs
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const workflow = readFileSync('.github/workflows/firebase-hosting-merge.yml', 'utf8');

function checkInterlock(source) {
  const p1Anchor = '      - name: P1 Firestore data-integrity release interlock (fail closed)';
  const runGate = '          node scripts/p1-release-safety-gate.mjs || { echo "REFUSING PROD:';
  const emulatorAnchor = '      - name: Firebase Rules compile and P1 negative/positive emulator gate';
  const runEmulator = '        run: npm run test:rules';
  const negativeProbe = '          HNL_P1_RULES_NEGATIVE_PROBE: "1"';
  const checkout = '      - uses: actions/checkout@v4';
  const setup = '      - uses: actions/setup-node@v4';
  const npmCi = '      - run: npm ci';
  const deployGateway = '      - name: Deploy exact-source HNL R2 Gateway PROD';
  const deployAI = '      - name: Deploy isolated HNL AI Gateway PROD';
  const deployRules = '      - name: Deploy Firestore + Storage rules from same candidate source';
  const deployHosting = '      - name: Deploy Hosting site hnlqltc';
  const required = [checkout, setup, p1Anchor, runGate, npmCi, emulatorAnchor, negativeProbe, runEmulator, deployGateway, deployAI, deployRules, deployHosting];
  for (const marker of required) {
    assert.equal(source.split(marker).length, 2, `Missing or duplicate workflow marker: ${marker}`);
  }
  const pos = (marker) => source.indexOf(marker);
  assert.ok(pos(checkout) < pos(p1Anchor), 'Source must be checked out before P1 gate');
  assert.ok(pos(setup) < pos(p1Anchor), 'Node runtime must be available before P1 gate');
  assert.ok(pos(p1Anchor) < pos(runGate) && pos(runGate) < pos(npmCi), 'P1 preflight must run before dependencies');
  assert.ok(pos(npmCi) < pos(emulatorAnchor), 'Rules emulator requires dependencies installed');
  assert.ok(pos(emulatorAnchor) < pos(negativeProbe) && pos(negativeProbe) < pos(runEmulator), 'P1 negative probe must be enabled on actual emulator runner');
  const allDeploy = [deployGateway, deployAI, deployRules, deployHosting].map(pos);
  assert.ok(pos(runEmulator) < Math.min(...allDeploy), 'Emulator must pass before any PROD deploy');
  assert.ok(pos(runGate) < Math.min(...allDeploy), 'Preflight must block all PROD deploy steps');
  assert.ok(source.includes('test "${GITHUB_REF}" = "refs/heads/main"'), 'PROD main-only confirmation was removed');
  assert.ok(source.includes('test "${GITHUB_SHA}" = "${{ inputs.expected_main_sha }}"'), 'PROD exact HEAD lock was removed');
}

checkInterlock(workflow);
const mutations = [
  workflow.replace('node scripts/p1-release-safety-gate.mjs ||', 'echo "skip" ||'),
  workflow.replace('HNL_P1_RULES_NEGATIVE_PROBE: "1"', 'HNL_P1_RULES_NEGATIVE_PROBE: "0"'),
  workflow.replace('      - name: Firebase Rules compile and P1 negative/positive emulator gate', '      - name: Firebase Rules compile check only'),
  workflow.replace('      - name: P1 Firestore data-integrity release interlock (fail closed)', '      - name: P1 gate disabled'),
];
for (const [index, mutant] of mutations.entries()) {
  assert.throws(() => checkInterlock(mutant), undefined, `Mutation ${index} must be rejected`);
}
// Structural regression: moving any deploy before the gate must be detected.
const moved = workflow.replace('      - name: Deploy exact-source HNL R2 Gateway PROD', '      - name: Deploy exact-source HNL R2 Gateway PROD-MOVED')
  .replace('      - run: npm ci', '      - name: Deploy exact-source HNL R2 Gateway PROD\n        run: echo INVALID\n\n      - run: npm ci');
assert.throws(() => checkInterlock(moved), undefined, 'Premature deploy mutation must be rejected');
console.log('P6 PROD P1 release interlock golden PASS: preflight before deploy + emulator P1 negative probe + 5 failure mutants');
