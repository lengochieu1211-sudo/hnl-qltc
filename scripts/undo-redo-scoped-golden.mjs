import assert from 'node:assert/strict';
import fs from 'node:fs';
import { captureScopedUndoStep, applyScopedUndoStep } from '../src/utils/undoRedoScoped.ts';

const clone = (item) => structuredClone(item);
const room = (id, x) => ({ id, roomName: id, floorId: 'FL-1', x, y: 10, width: 20, height: 10, updatedAt: 1, revision: 1, assignedTeam: 'T1' });
const defect = (id) => ({ id, roomId: 'R1', description: id, updatedAt: 1 });
const state = (rooms, defs = []) => ({ roomProgressList: rooms, defects: defs, inventory: [], workVolumes: [], floorPlans: [], checklist: [], crewRecords: [], teams: [], materialNorms: [] });
const before = state([room('R1', 10)], [defect('D1')]);
const after = state([room('R1', 25)], before.defects);
const step = captureScopedUndoStep(before, after, 'p1');
assert(step && step.changes.length === 1 && step.changes[0].id === 'R1', 'Dragging one room creates one scoped history change');
const withRemoteDefect = { ...after, defects: [defect('D2'), ...before.defects] };
const undone = applyScopedUndoStep(withRemoteDefect, step, 'undo', 'p1');
assert(undone.ok && undone.state.roomProgressList[0].x === 10, 'Room position reverts');
assert.equal(undone.state.defects.length, 2, 'A second user Defect must survive Undo');
const redone = applyScopedUndoStep(undone.state, step, 'redo', 'p1');
assert(redone.ok && redone.state.roomProgressList[0].x === 25, 'Redo restores the room transform');
assert.equal(redone.state.defects.length, 2, 'Redo must preserve concurrent Defects');
assert(!applyScopedUndoStep({ ...withRemoteDefect, roomProgressList: [{ ...room('R1', 25), deleted: true, deletedAt: Date.now() }] }, step, 'undo', 'p1').ok, 'Cloud soft-delete marker on edited room must block Undo');
assert(!applyScopedUndoStep({ ...withRemoteDefect, roomProgressList: [room('R1', 50)] }, step, 'undo', 'p1').ok,
  'Conflict on the touched room must block Undo, never overwrite remote geometry');
assert(!applyScopedUndoStep(withRemoteDefect, step, 'undo', 'p2').ok,
  'Undo from another project must fail closed');
const beforeGroup = state([room('R1', 10), room('R2', 20)], before.defects);
const afterGroup = state([room('R1', 11), room('R2', 21)], before.defects);
const groupStep = captureScopedUndoStep(beforeGroup, afterGroup, 'p1');
assert(groupStep && groupStep.changes.length === 2, 'A multiroom drag batch creates one history step with two touched IDs');
const groupUndo = applyScopedUndoStep(afterGroup, groupStep, 'undo', 'p1');
assert(groupUndo.ok && groupUndo.state.roomProgressList.map(x=>x.x).join(',') === '10,20', 'Batch Undo restores both rooms atomically');
const added = state([room('R3', 5), ...beforeGroup.roomProgressList], before.defects);
const addStep = captureScopedUndoStep(beforeGroup, added, 'p1');
assert(addStep && addStep.changes.length === 1, 'Adding a room is reversible by ID');
const addUndo = applyScopedUndoStep({ ...added, defects: [defect('D3')] }, addStep, 'undo', 'p1');
assert(addUndo.ok && addUndo.state.roomProgressList.every(x=>x.id !== 'R3') && addUndo.state.defects[0].id === 'D3', 'Undo added room without deleting another user Defect');
const reordered = state([beforeGroup.roomProgressList[1], beforeGroup.roomProgressList[0]], before.defects);
const orderStep = captureScopedUndoStep(beforeGroup, reordered, 'p1');
assert(orderStep?.orders.length === 1 && orderStep.changes.length === 0, 'Pure order changes are included');
const orderUndo = applyScopedUndoStep(reordered, orderStep, 'undo', 'p1');
assert(orderUndo.ok && orderUndo.state.roomProgressList[0].id === 'R1', 'Undo returns room display order');
const remoteReordered = state([room('R2', 20),room('R1',10),room('R4',1)], before.defects);
assert(applyScopedUndoStep(remoteReordered, orderStep, 'undo', 'p1').ok, 'Unrelated remote additions are retained through history');
assert(!applyScopedUndoStep(beforeGroup, orderStep, 'undo', 'p1').ok, 'An incompatible order transition must block history');
assert.deepEqual(clone(before).roomProgressList, before.roomProgressList, 'Test states are immutable');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const floor = fs.readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');
const security = fs.readFileSync('src/utils/securityUtils.ts', 'utf8');
assert(app.includes('captureScopedUndoStep(prev, next, activeProjectIdRef.current)'), 'Mutation history uses per-record journal');
assert(app.includes('applyScopedUndoStep(present, step, direction, activeProjectIdRef.current)'), 'Undo/Redo checks project and conflicts');
assert(app.includes('result.changedCollections.forEach((key) => {') && !app.includes('markAllLocalCollectionsDirty();'), 'Undo only marks affected collections dirty');
assert(security.includes("return role === 'ADMIN';") && app.includes('canUseGlobalUndoRedo(currentUserRole)'), 'Global Undo remains ADMIN-only');
assert(floor.includes("if (onBatchSaveRooms && modifiedRooms.length > 1)") && floor.includes('onBatchSaveRooms(modifiedRooms)'), 'Drag/resize commits multiroom changes as one history step');
assert(floor.includes("applySelectedRoomTransform('rotate90')") && floor.includes('resizeRoomHighlightToBounds'), 'Rotate/resize routes preserve room geometry');

// All nine business lists participate in entity-scoped history. The warehouse
// list is deliberately restored by a different Firestore stock transaction.
const nineCollections = ['roomProgressList','inventory','workVolumes','floorPlans',
  'defects','checklist','crewRecords','teams','materialNorms'];
for (const collection of nineCollections) {
  const item = { id: 'CHECK-1', updatedAt: 1, revision: 3, label: collection };
  const baseline = Object.fromEntries(nineCollections.map((key) => [key, key === collection ? [item] : []]));
  const deleted = { ...baseline, [collection]: [] };
  const removeStep = captureScopedUndoStep(baseline, deleted, 'p1');
  assert.equal(removeStep?.changes.length, 1, collection + ': exactly one deleted ID is captured');
  assert.equal(removeStep?.changes[0].before?.id, 'CHECK-1', collection + ': snapshot for restore remains available');
  assert.equal(removeStep?.changes[0].after, null, collection + ': delete is represented as null');
}
const cloudRestore = fs.readFileSync('src/lib/scopedUndoCloud.ts', 'utf8');
assert(cloudRestore.includes("runTransaction(db, async (tx) =>") &&
  cloudRestore.includes("Number(server.revision || 0) + 1") &&
  cloudRestore.includes("Number(server.deletedAt || 0) !== localDeletion"),
  'Delete Undo must verify server tombstone and advance its revision transactionally');
assert(cloudRestore.includes("server.deletedByUid !== actor.uid") &&
  cloudRestore.includes('UNDO_CONCURRENT_EDIT') &&
  cloudRestore.includes("tx.delete(trashRef)"),
  'Delete Undo blocks another actor, concurrent linked edits and mismatched receipts');
assert(app.includes('restoreDeletedUndoOnCloud(pid, step, deletedTimes, receipt?.id)') &&
  app.includes('restoreWarehouseTransactionAtomic(pid, change.id)') &&
  app.includes('if (undoCloudBusyRef.current) return;'),
  'Undo routes warehouse to stock transactions and blocks concurrent history');
assert(cloudRestore.includes('redoDeletedHistoryOnCloud') &&
  cloudRestore.includes('REDO_SERVER_REVISION_CONFLICT') &&
  cloudRestore.includes('UNDO_DELETION_CONFLICT') &&
  cloudRestore.includes('tx.set(receiptRef, sanitizePayloadForCloud(receipt))'),
  'Redo delete requires a new revision, a live server conflict check and atomic Trash receipt');
assert(app.includes('redoDeletedHistoryOnCloud(pid, step, versions, redoAt, receipt)') &&
  app.includes('softDeleteWarehouseTransactionAtomic(pid, change.id, trashSettingsRef.current)'),
  'Redo routes all core and warehouse deletes through their safe cloud writers');
assert(app.includes('Firestore đã xác nhận khôi phục dữ liệu.') &&
  app.includes('Chưa hoàn tác được trên Cloud:'),
  'Delete Undo must not claim success before Cloud acknowledgement');
console.log('SCOPED UNDO/REDO GOLDEN PASS: remote Defects preserved, modified-room conflict blocked, batch transforms and project guard');
