#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const rules = fs.readFileSync('firestore.rules', 'utf8');
const chat = fs.readFileSync('src/lib/chatService.ts', 'utf8');
const tests = fs.readFileSync('scripts/firebase-rules-behavior.mjs', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json','utf8'));
assert.equal(pkg.version,lock.version);
assert.equal(pkg.name,lock.name);
assert.equal(pkg.version,lock.packages[''].version);
assert.equal(pkg.name,lock.packages[''].name);
assert.deepEqual(pkg.dependencies,lock.packages[''].dependencies,'dependency manifest must match lockfile');
assert.match(rules,/function positionLockUpdateIsSafe\(projectId, collectionName\)/);
assert.match(rules,/&& positionLockUpdateIsSafe\(projectId, collectionName\)/);
assert.match(rules,/resource\.data\.get\('positionLocked', false\) != true/);
for (const name of ['floorId','x','y','width','height','points','isPolyline','cadSource','roomId','axisGrid','positionDetail']) {
  assert(rules.includes(`'${name}'`),`protected location/geometry field missing: ${name}`);
}
assert.match(rules,/changed\.hasOnly\(\['positionLocked', 'revision', 'updatedAt', 'updatedByUid'\]\)/);
assert.match(tests,/legacy ADMIN cannot move locked Room/);
assert.match(tests,/legacy EDITOR cannot move locked Defect/);
assert.match(tests,/ADMIN cannot resize and unlock Room in one update/);
assert.match(tests,/EDITOR cannot simultaneously unlock and move Defect/);
assert.match(tests,/ADMIN can update Room progress while geometry stays locked/);
assert.match(tests,/EDITOR can update Defect status while location stays locked/);
assert.match(chat,/lastMessageId:\s*messageId/);
assert.match(chat,/const batch = writeBatch\(db\);/);
assert.match(chat,/await batch\.commit\(\);\s*await removeChatOutbox/);
assert.match(fs.readFileSync('scripts/runtime-golden-evidence-gate.mjs','utf8'),/prod_rollback_version_captured/);
console.log('THREE BLOCKERS SOURCE GOLDEN PASS (source only, not Firebase emulator or real-device certified)');
