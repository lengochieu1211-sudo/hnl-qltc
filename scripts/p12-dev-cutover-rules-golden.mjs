import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const r=spawnSync(process.execPath,['scripts/p12-build-dev-cutover-rules.mjs'],{encoding:'utf8'});
assert.equal(r.status,0,r.stderr);
const candidate=readFileSync('firestore.warehouse-cutover.dev.rules','utf8');
const existing=readFileSync('firestore.rules','utf8');
assert.notEqual(candidate,existing);
const balance=candidate.split('match /inventory_balances/{balanceId} {')[1].split('}')[0];
assert.match(balance,/allow create, update, delete: if false/);
assert.doesNotMatch(balance,/isEditor\(projectId\)/);
for(const type of ['create','update','delete']){
  const snippet=candidate.match(new RegExp(`allow ${type}: if collectionName != 'activityLogs'[^\\n]+`))?.[0];
  assert.ok(snippet?.includes("collectionName != 'inventory'"),`Generic inventory ${type} bypass`);
}
const room=candidate.split('function editorRoomOperationalUpdateOnly()')[1].split('function editorChecklistOperationalUpdateOnly()')[0];
const allowlist=room.match(/affectedKeys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/)?.[1];
assert.ok(allowlist);
assert.doesNotMatch(allowlist,/'subItems'/);
assert.match(existing,/allow update: if projectIsActive\(projectId\)/);
assert.match(existing,/editorBalanceUpdateMetadataSafe\(\)/);
assert.match(candidate,/NOT DEPLOYED/);
console.log('P12 DEV-COPY CUTOVER RULES STATIC SECURITY TRIAGE: PASS (NOT EMULATOR)');
