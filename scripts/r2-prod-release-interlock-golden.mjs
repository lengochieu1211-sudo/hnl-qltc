/** P7 source-only regression check for independent R2 PROD release workflow.
 * No GitHub API, Cloudflare, Firebase credentials, or deployed resources touched.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const path = '.github/workflows/r2-worker-deploy.yml';
const source = readFileSync(path, 'utf8');
const p1 = 'scripts/p1-release-safety-gate.mjs';

function extractBlocks(yaml) {
  const blocks = [];
  for (const line of yaml.split('\n')) {
    const start = line.match(/^      - (?:name|uses): (.+)$/);
    if (start) blocks.push({ name: start[1], code: line + '\n' });
    else if (blocks.length) blocks[blocks.length - 1].code += line + '\n';
  }
  return blocks;
}
function validates(yaml) {
  if (!/^on:\s*\n\s+workflow_dispatch:/m.test(yaml)) return false;
  if (/\bpush:\s*\n|\bworkflow_call:\s*\n/m.test(yaml)) return false;
  if (!/^    environment: production\s*$/m.test(yaml)) return false;
  for (const name of ['confirmation', 'backup_confirmation', 'migration_confirmation', 'dev_certified_sha', 'expected_main_sha']) {
    if (!new RegExp(`^      ${name}:\\s*$`, 'm').test(yaml)) return false;
  }
  if (!/uses: actions\/checkout@v4\n        with:\n          fetch-depth: 0/.test(yaml)) return false;
  const blocks = extractBlocks(yaml);
  const index = phrase => blocks.findIndex(x => x.name.includes(phrase));
  const confirmations = index('Require explicit PROD R2 confirmation');
  const preflight = index('Require certified source and P1 data-integrity preflight');
  const token = index('Require Cloudflare deploy token');
  const account = index('Resolve Cloudflare Account ID automatically');
  const deploy = index('Deploy existing HNL QLTC R2 Worker');
  const smoke = index('Smoke Worker health');
  if ([confirmations, preflight, token, account, deploy, smoke].some(x => x < 0)) return false;
  if (!(confirmations < preflight && preflight < token && token < account && account < deploy && deploy < smoke)) return false;
  const c = blocks[confirmations].code;
  const g = blocks[preflight].code;
  const checks = [
    /DEPLOY-R2-PROD/, /refs\/heads\/main/, /BACKUP-VERIFIED/, /MIGRATION-PARITY-VERIFIED/,
    /inputs\.dev_certified_sha/, /inputs\.expected_main_sha/,
    /\^\[0-9a-f\]\{40\}\$/, /GITHUB_SHA/, /inputs\.expected_main_sha/,
  ];
  if (!checks.every(check => check.test(c))) return false;
  if (!/git rev-parse HEAD/.test(g) || !/git merge-base --is-ancestor/.test(g)) return false;
  if (!/node scripts\/p1-release-safety-gate\.mjs/.test(g)) return false;
  if (!/test -f scripts\/p1-release-safety-gate\.mjs/.test(g)) return false;
  if (!/test -f cloudflare\/r2-gateway\/worker\.js/.test(g)) return false;
  for (const block of blocks.slice(0, deploy)) {
    if (/continue-on-error:\s*true|if:\s*always\(\)/.test(block.code)) return false;
  }
  return true;
}
assert(validates(source), 'R2 PROD direct workflow is missing at least one release lock');
const mutations = [
  [ 'backup omitted', s => s.replace(/^.*test .*backup_confirmation.*\n/m, '') ],
  [ 'media parity omitted', s => s.replace(/^.*test .*migration_confirmation.*\n/m, '') ],
  [ 'incorrect SHA unlocked', s => s.replace(/^.*test .*GITHUB_SHA.*\n/m, '') ],
  [ 'wrong checkout depth', s => s.replace('fetch-depth: 0', 'fetch-depth: 1') ],
  [ 'P1 security gate removed', s => s.replace('node scripts/p1-release-safety-gate.mjs', 'echo skip-p1') ],
  [ 'DEV ancestry removed', s => s.replace(/^.*git merge-base --is-ancestor.*\n/m, '') ],
  [ 'remove branch check', s => s.replace(/^.*test .*GITHUB_REF.*\n/m, '') ],
  [ 'remove environment', s => s.replace('environment: production', 'environment: development') ],
  [ 'deploy before gate', s => s.replace('      - name: Require Cloudflare deploy token', '      - name: Deploy existing HNL QLTC R2 Worker\n        run: echo early\n\n      - name: Require Cloudflare deploy token') ],
  [ 'allow error bypass', s => s.replace('      - name: Require certified source', '      - name: Require certified source').replace('      - name: Require certified source and P1 data-integrity preflight\n', '      - name: Require certified source and P1 data-integrity preflight\n        continue-on-error: true\n') ],
];
for (const [name, mutate] of mutations) {
  const broken = mutate(source);
  assert.notEqual(broken, source, `Mutation did not change source: ${name}`);
  assert.equal(validates(broken), false, `Release interlock failed to detect: ${name}`);
}
// This does not certify Rules. It verifies the real static preflight remains
// fail-closed on the known vulnerable Rules copied from P6.
const gate = spawnSync(process.execPath, [p1], { encoding: 'utf8', timeout: 15000 });
assert.equal(gate.status, 2, `Expected static P1 safety gate to block current Rules, got ${gate.status}: ${gate.stderr}`);
assert.match(gate.stderr, /P1-ROOM/);
assert.match(gate.stderr, /P1-BALANCE/);
console.log(`P7 R2 PROD RELEASE INTERLOCK: PASS (${mutations.length} bypass regressions DENIED, known P1 Rules BLOCKED)`);
console.log('This is a local source-only check; GitHub workflow is NOT deployed, and Firebase Emulator/Golden remain required.');
