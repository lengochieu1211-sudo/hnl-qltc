import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { warehouseOrderKey } from '../src/utils/warehouseCatalogOrder';
import {
  ORDER_DATE_KEY, draftToOrderValue, orderDateValue, orderRowToDraft,
  normalizedDraftValue, cloudOrderRecord, loadPendingOrderChanges, savePendingOrderChanges,
  loadOrderExpectedDate, saveOrderExpectedDate, validOrderDate,
  ensureOrderLegacyBackup, loadOrderLegacyBackup,
} from '../src/utils/warehouseOrderSyncCore';

const key=warehouseOrderKey('material','Tấm trần chống ẩm','tấm');
const id=encodeURIComponent(key);
assert.equal(validOrderDate('2026-10-22'),true);
assert.equal(validOrderDate('2026-02-30'),false);
assert.equal(validOrderDate('2026-13-01'),false);
assert.equal(validOrderDate('hello'),false);
const value=draftToOrderValue({quantity:12,kgPerUnit:0.03,quantityExpression:'=3*4',kgPerUnitExpression:'0,03'});
assert.equal(value.quantityExpression,'=3*4');
assert.equal(value.kgPerUnitExpression,'0,03');
assert.equal(value.quantity,12);
assert.equal(value.kgPerUnit,0.03);
assert.deepEqual(orderRowToDraft(value),{quantity:12,kgPerUnit:0.03,quantityExpression:'=3*4',kgPerUnitExpression:'0,03'});
assert.equal(normalizedDraftValue({...value,quantityExpression:'=1+2'})?.quantityExpression,'');
assert.equal(normalizedDraftValue({...value,quantity:NaN}),null);
assert.equal(normalizedDraftValue({...value,quantity:Infinity}),null);
assert.equal(normalizedDraftValue({...value,kgPerUnit:-1}),null);
assert.equal(normalizedDraftValue({...value,expectedDeliveryDate:'2026-02-30'}),null);
assert.deepEqual(orderDateValue('2026-10-30'),{quantity:0,kgPerUnit:null,quantityExpression:'',kgPerUnitExpression:'',expectedDeliveryDate:'2026-10-30'});
const row={...value,itemKey:key,projectId:'project-A',revision:3,updatedAt:10,updatedByUid:'user-A'};
assert.equal(cloudOrderRecord(row,id,'project-A')?.revision,3);
assert.equal(cloudOrderRecord(row,id,'project-B'),null);
assert.equal(cloudOrderRecord(row,encodeURIComponent('wrong'),'project-A'),null);
assert.equal(cloudOrderRecord({...row,revision:0},id,'project-A'),null);
const store=new Map<string,string>();
(globalThis as {localStorage?:unknown}).localStorage={
 getItem:(k:string)=>store.get(k)??null,
 setItem:(k:string,v:string)=>{store.set(k,v);},
};
assert.equal(ensureOrderLegacyBackup('project-A',{[key]:{quantity:12,kgPerUnit:0.03}}),true);
assert.equal(ensureOrderLegacyBackup('project-A',{[key]:{quantity:99,kgPerUnit:99}}),true);
assert.equal(loadOrderLegacyBackup('project-A')[key]?.quantity,12); // never overwrite backup
assert.equal(saveOrderExpectedDate('project-A','2026-10-30'),true);
assert.equal(loadOrderExpectedDate('project-A'),'2026-10-30');
assert.equal(loadOrderExpectedDate('project-B'),'');
assert.equal(saveOrderExpectedDate('project-A','2026-02-30'),false);
const pending={ [key]:{baseRevision:3,value},[ORDER_DATE_KEY]:{baseRevision:null,value:orderDateValue('2026-10-30')}};
assert.equal(savePendingOrderChanges('project-A','uidA',pending),true);
assert.deepEqual(loadPendingOrderChanges('project-A','uidA'),pending);
assert.deepEqual(loadPendingOrderChanges('project-A','uidB'),{}); // user-isolated recovery queue
assert.deepEqual(loadPendingOrderChanges('project-B','uidA'),{});
// Corrupt/stale pending values are discarded; they cannot wipe a valid cloud revision.
store.set('hnl-qltc-order-cloud-pending-v1:project-B:uidA',JSON.stringify({[key]:{baseRevision:0,value}}));
assert.deepEqual(loadPendingOrderChanges('project-B','uidA'),{});
const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
assert.match(rules,/match \/warehouse_order_drafts\/\{recordId\}/);
assert.match(rules,/allow delete: if false/);
assert.match(rules,/request\.resource\.data\.revision == resource\.data\.revision \+ 1/);
assert.match(rules,/d\.updatedByUid == request\.auth\.uid/);
assert.match(rules,/canonicalMemberRole\(projectId\) == 'EDITOR'/);
assert.match(rules,/allow create: if canWriteWarehouseOrder\(projectId\)/);
assert.equal((rules.match(/collectionName != 'warehouse_order_drafts'/g)||[]).length,4);
const ui=readFileSync(new URL('../src/components/WarehouseOrderSheet.tsx',import.meta.url),'utf8');
const cloud=readFileSync(new URL('../src/lib/warehouseOrderCloud.ts',import.meta.url),'utf8');
assert.match(ui,/pendingRef\.current\[key\]/);
assert.match(ui,/conflictsRef\.current\.add\(key\)/);
assert.match(ui,/Ngày dự kiến hàng về/);
assert.match(ui,/Dự kiến hàng về: /);
assert.match(cloud,/runTransaction\(/);
assert.match(cloud,/revision!==baseRevision/);
assert.match(cloud,/subscribeWarehouseOrderCloud/);
assert.match(ui,/savePendingOrderChanges/);
assert.match(ui,/saveWarehouseOrderDraft/);
// A late request/snapshot from another project or signed-in account must not
// change the current project's pending queue, conflict banner or local rows.
assert.match(ui,/const oldRows=\{\.\.\.loadOrderLegacyBackup\(projectId\),\.\.\.rowsRef\.current\}/);
assert.match(ui,/const syncEpochRef=useRef\(0\)/);
assert.match(ui,/const epoch=\+\+syncEpochRef\.current/);
assert.match(ui,/return \(\)=>\{syncEpochRef\.current\+\+;unsubscribe\(\);\}/);
assert.match(ui,/if\(syncEpochRef\.current!==epoch\)return;\s+remoteRef\.current=remote/);
assert.match(ui,/if\(syncEpochRef\.current!==epoch\)return;\s+committed=true;\s+if\(pendingRef\.current\[key\]===pending\)/);
assert.match(ui,/if\(syncEpochRef\.current!==epoch\)return;\s+inFlightRef\.current\.delete\(key\)/);
assert.match(ui,/queueMicrotask\(\(\)=>\{if\(syncEpochRef\.current===epoch\)flushPending\(\);\}\)/);
assert.match(ui,/let committed=false;/);
assert.match(ui,/if\(committed&&pendingRef\.current\[key\]!==pending/);
console.log('WAREHOUSE ORDER CLOUD/FORMULA/DATE REGRESSION PASS');
