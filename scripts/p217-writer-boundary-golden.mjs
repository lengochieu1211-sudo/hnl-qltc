import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertP21DemoWriterBoundary } from '../src/utils/p21DemoWriterBoundary.ts';

const off = { roomSidecarDemo: false, trustedWarehouseDemo: false };
const room = { roomSidecarDemo: true, trustedWarehouseDemo: false };
const stock = { roomSidecarDemo: false, trustedWarehouseDemo: true };
const both = { roomSidecarDemo: true, trustedWarehouseDemo: true };
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
const changed = (collection) => ({ addedOrModified: { [collection]: [{ id: 'X' }] }, deletedIds: {} });
const removed = (collection) => ({ addedOrModified: {}, deletedIds: { [collection]: [{ id: 'X' }] } });
check('legacy behavior untouched when demo flags are off', () => {
  assert.doesNotThrow(() => assertP21DemoWriterBoundary(changed('rooms'), off));
  assert.doesNotThrow(() => assertP21DemoWriterBoundary(changed('inventory'), off));
});
check('room demo refuses generic added/updated room', () => assert.throws(
  () => assertP21DemoWriterBoundary(changed('rooms'), room), /ROOM_DIRECT_WRITE_BLOCKED/
));
check('room demo refuses generic room tombstone', () => assert.throws(
  () => assertP21DemoWriterBoundary(removed('rooms'), room), /ROOM_DIRECT_WRITE_BLOCKED/
));
check('trusted warehouse refuses generic voucher create/update', () => assert.throws(
  () => assertP21DemoWriterBoundary(changed('inventory'), stock), /WAREHOUSE_DIRECT_WRITE_BLOCKED/
));
check('trusted warehouse refuses generic voucher delete', () => assert.throws(
  () => assertP21DemoWriterBoundary(removed('inventory'), stock), /WAREHOUSE_DIRECT_WRITE_BLOCKED/
));
check('mixed batch containing restricted room is rejected atomically', () => assert.throws(
  () => assertP21DemoWriterBoundary({
    addedOrModified: { rooms: [{ id: 'R' }], defects: [{ id: 'D' }] },
    deletedIds: {},
  }, both), /ROOM_DIRECT_WRITE_BLOCKED/
));
check('mixed batch containing inventory is rejected atomically', () => assert.throws(
  () => assertP21DemoWriterBoundary({
    addedOrModified: { defects: [{ id: 'D' }] },
    deletedIds: { inventory: [{ id: 'V' }] },
  }, both), /WAREHOUSE_DIRECT_WRITE_BLOCKED/
));
check('sidecar demo still permits unrelated collections', () => assert.doesNotThrow(
  () => assertP21DemoWriterBoundary(changed('defects'), both)
));
check('empty arrays are not mutations', () => assert.doesNotThrow(
  () => assertP21DemoWriterBoundary({ addedOrModified: { rooms: [], inventory: [] }, deletedIds: { rooms: [], inventory: [] } }, both)
));
const firebaseBase = readFileSync(new URL('../src/lib/firebaseBase.ts', import.meta.url), 'utf8');
const offline = firebaseBase.slice(firebaseBase.indexOf('export function queueProjectDiffsToFirestoreOffline('), firebaseBase.indexOf('export async function saveProjectDiffsToCloud('));
const online = firebaseBase.slice(firebaseBase.indexOf('export async function saveProjectDiffsToCloud('), firebaseBase.indexOf('export interface ProjectCrewReportData'));
check('offline preflight runs before any mutation batch', () => {
  assert.ok(offline.indexOf('assertP21DemoWriterBoundary(diffs, p21DemoWriterGates)') >= 0);
  assert.ok(offline.indexOf('assertP21DemoWriterBoundary(diffs, p21DemoWriterGates)') < offline.indexOf('writeBatch(db)'));
});
check('online preflight runs before auth/root write and any batch', () => {
  const i = online.indexOf('assertP21DemoWriterBoundary(diffs, p21DemoWriterGates)');
  assert.ok(i >= 0 && i < online.indexOf('await ensureAuth()') && i < online.indexOf('setDoc(metadataRef,'));
});
check('flags are opt-in tokens, not implicit live activation', () => {
  assert.ok(firebaseBase.includes("VITE_P21_ROOM_SIDECAR_DEMO || ''"));
  assert.ok(firebaseBase.includes("VITE_P21_TRUSTED_WAREHOUSE_DEMO || ''"));
  assert.ok(firebaseBase.includes("=== 'P21_LOCAL_EMULATOR_ONLY'"));
});
console.log(`P21.7 WRITER BOUNDARY ${passed}/${passed} PASS — ISOLATED ONLY; NOT CERTIFIED`);
