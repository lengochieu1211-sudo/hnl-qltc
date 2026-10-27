import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const gate = spawnSync(process.execPath, ['scripts/p1-release-safety-gate.mjs'], { encoding: 'utf8' });
const combined = (gate.stdout || '') + (gate.stderr || '');
// Today's source is intentionally NOT safe to release. This golden asserts the
// fail-closed detector itself, not that Firestore behavior is secure.
assert.equal(gate.status, 2, `Known P1 Rules gaps must block readiness. Got ${gate.status}\n${combined}`);
assert.match(combined, /P1-ROOM:/);
assert.match(combined, /P1-BALANCE:/);
assert.match(combined, /P1 RELEASE BLOCKED:/);
assert.match(combined, /P3 nested subItem merge guard remains wired/);
assert.match(combined, /opt-in negative Rules emulator probes exist/);
const rules = readFileSync('firestore.rules', 'utf8');
assert.match(rules, /function editorRoomOperationalUpdateOnly\(/);
assert.match(rules, /match \/inventory_balances\/\{balanceId\}/);
console.log('P1 RELEASE FAIL-CLOSED DETECTOR GOLDEN: PASS (Rules remain UNSAFE / PROD BLOCKED)');
