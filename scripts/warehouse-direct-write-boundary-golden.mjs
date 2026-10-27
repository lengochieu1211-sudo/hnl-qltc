import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertNoLegacyInventoryDiffs, assertNoLegacyInventoryRestore } from '../src/utils/warehouseDirectWriteBoundary.ts';
let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('PASS',name); };
const blocked = fn => assert.throws(fn,/WAREHOUSE_TRUSTED_DIRECT_LEDGER_WRITE_BLOCKED/);
test('regular PROD/legacy diff unaffected',()=> assert.doesNotThrow(()=>assertNoLegacyInventoryDiffs(false,{addedOrModified:{inventory:[{id:'i'}]}},'realtime-diff')));
test('trusted create/update diff denied',()=>blocked(()=>assertNoLegacyInventoryDiffs(true,{addedOrModified:{inventory:[{id:'i'}]}},'realtime-diff')));
test('trusted delete diff denied',()=>blocked(()=>assertNoLegacyInventoryDiffs(true,{deletedIds:{inventory:['i']}},'realtime-diff')));
test('trusted offline queued add denied',()=>blocked(()=>assertNoLegacyInventoryDiffs(true,{addedOrModified:{inventory:[{id:'i'}]}},'offline-queue')));
test('trusted offline queued remove denied',()=>blocked(()=>assertNoLegacyInventoryDiffs(true,{deletedIds:{inventory:[{id:'i'}]}},'offline-queue')));
test('unrelated defects allowed',()=>assert.doesNotThrow(()=>assertNoLegacyInventoryDiffs(true,{addedOrModified:{defects:[{id:'d'}]}},'realtime-diff')));
test('empty inventory arrays allowed',()=>assert.doesNotThrow(()=>assertNoLegacyInventoryDiffs(true,{addedOrModified:{inventory:[]},deletedIds:{inventory:[]}},'realtime-diff')));
test('trusted nonempty backup inventory denied',()=>blocked(()=>assertNoLegacyInventoryRestore(true,[{id:'i'}])));
test('legacy backup unchanged',()=>assert.doesNotThrow(()=>assertNoLegacyInventoryRestore(false,[{id:'i'}])));
test('empty trusted backup inventory allowed',()=>assert.doesNotThrow(()=>assertNoLegacyInventoryRestore(true,[])));
const base=readFileSync(new URL('../src/lib/firebaseBase.ts',import.meta.url),'utf8');
const client=readFileSync(new URL('../src/lib/warehouseTrustedClient.ts',import.meta.url),'utf8');
for (const marker of [
 "assertNoLegacyInventoryDiffs(WAREHOUSE_TRUSTED_WRITER_ENABLED, diffs, 'offline-queue')",
 "assertNoLegacyInventoryDiffs(WAREHOUSE_TRUSTED_WRITER_ENABLED, diffs, 'realtime-diff')",
 'assertNoLegacyInventoryRestore(WAREHOUSE_TRUSTED_WRITER_ENABLED, payloadData.inventory)',
]) assert.ok(base.includes(marker),`missing legacy write boundary: ${marker}`);
assert.ok(client.includes("export { WAREHOUSE_TRUSTED_WRITER_ENABLED } from './firebaseBase'"),'the client and generic writers must share ONE mode flag');
console.log(`PASS source integration checks; ${pass} pure tests passed (NOT Emulator)`);
