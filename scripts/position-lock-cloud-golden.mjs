import assert from 'node:assert/strict';
import fs from 'node:fs';
const lock = fs.readFileSync('src/lib/positionLockCloud.ts', 'utf8');
const floor = fs.readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const pkgLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
assert.equal(pkg.version, pkgLock.version, 'package and lockfile versions must remain consistent');
assert(lock.includes('runTransaction(db, async (tx) =>') && lock.includes('await tx.get(ref)'),
  'Position lock must be a server transaction, not an optimistic local upsert');
assert(lock.includes("kind === 'room' ? 'rooms' : 'defects'") &&
  lock.includes('revision: change.revision') && lock.includes('updatedByUid: actor.uid'),
  'Only canonical Cloud rows with monotonic revisions can be locked');
assert(lock.includes('POSITION_LOCK_CONCURRENT_CHANGE') &&
  lock.includes('POSITION_LOCK_ROLE_NOT_VERIFIED') &&
  lock.includes('POSITION_LOCK_REQUIRES_ONLINE'), 'Race, role and offline changes must fail closed');
assert(lock.includes("if (row.updatedAt !== undefined && typeof row.updatedAt !== 'number')") &&
  lock.includes('row.deleted === true') &&
  lock.includes("ids.size !== entries.length"), 'Legacy timestamp, deleted records and duplicate ID guards must remain');
assert(lock.includes('tx.update(refs[change.index], {') &&
  !lock.includes('inventory_balances') && !lock.includes('warehouseTransactions'),
  'Lock must never modify warehouse balances or other collections');
assert(!floor.includes("room.positionLocked === undefined && legacy.has(room.id)") &&
  !floor.includes("defect.positionLocked === undefined && legacy.has(defect.id)"), 'Legacy device-only lock must not override Cloud');
assert(!floor.includes("localStorage.setItem(getDraftKey('construction_floorplan_locked_rooms')") &&
  !floor.includes("localStorage.setItem(getDraftKey('construction_floorplan_locked_defects')"), 'Shared locks must not be written as per-device authority');
assert(floor.includes("await onCommitPositionLocks('room', entries, locked)") &&
  floor.includes("await onCommitPositionLocks('defect', [{ id: defectId") &&
  floor.includes("setCopyNotification('Chưa lưu được khóa phòng:"),
  'Both lock toggles need awaited Cloud acknowledgement and failure notification');
assert(app.includes('onCommitPositionLocks={handleCommitPositionLocks}') &&
  app.includes('POSITION_LOCK_PENDING_LOCAL_EDIT') &&
  app.includes('queueCloudSave(() => commitPositionLocksOnCloud('),
  'App must serialize lock commits and reject unsaved local record collisions');
assert(rules.includes("function lifecycleUpdateIsMonotonic()") &&
  rules.includes("coreIdentityUpdateIsValid(recordId)"), 'Existing Firebase Rules monotonic update guards remain intact');
console.log('POSITION LOCK SOURCE GOLDEN PASS: Cloud auth, transaction, conflict, offline, two UI paths, storage and stock isolation');
