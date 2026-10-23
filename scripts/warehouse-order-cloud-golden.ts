import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { warehouseOrderKey } from '../src/utils/warehouseCatalogOrder';
import { compareWarehouseOrderDisplayItems } from '../src/utils/catalogDisplayOrder';
import {
  ORDER_DATE_KEY, draftToOrderValue, orderDateValue, orderRowToDraft,
  normalizedDraftValue, cloudOrderRecord, loadPendingOrderChanges, savePendingOrderChanges,
  loadOrderExpectedDate, saveOrderExpectedDate, validOrderDate,
  ensureOrderLegacyBackup, loadOrderLegacyBackup,
} from '../src/utils/warehouseOrderSyncCore';

// One canonical accessory-last presentation rule for the order sheet,
// Quick Edit order tabs and exported purchase-order rows. No ID is remapped.
const orderSamples = [
  {key:'pk',kind:'material' as const,category:'Phụ kiện & Vít',name:'Bu lông M6',unit:'Bộ'},
  {key:'vt',kind:'material' as const,category:'Vật tư phụ khác',name:'Băng keo',unit:'Cuộn'},
  {key:'board',kind:'material' as const,category:'Tấm thạch cao',name:'Tấm chống ẩm',unit:'Tấm'},
  {key:'frame',kind:'material' as const,category:'Khung xương',name:'Thanh chính',unit:'Thanh'},
];
assert.deepEqual(orderSamples.slice().sort(compareWarehouseOrderDisplayItems).map(item=>item.key),
  ['frame','board','pk','vt'], 'All primary material categories precede accessory categories');
const equipmentSamples = [
  {key:'z',kind:'equipment' as const,category:'Máy',name:'Máy khoan',unit:'Cái'},
  {key:'a',kind:'equipment' as const,category:'Dụng cụ',name:'Thước',unit:'Cái'},
];
assert.deepEqual(equipmentSamples.slice().sort(compareWarehouseOrderDisplayItems).map(item=>item.key),
  ['a','z'], 'Equipment retains ordinary category/name order');
assert.deepEqual(orderSamples.map(item=>item.key),['pk','vt','board','frame'],
  'Display sort cannot mutate original order list or identities');

const key=warehouseOrderKey('material','Tấm trần chống ẩm','tấm');
const id=encodeURIComponent(key);
assert.equal(/^__.*__$/.test(encodeURIComponent(ORDER_DATE_KEY)),false, 'Firestore reserved document IDs are forbidden');
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
store.set('hnl-qltc-order-cloud-pending-v1:project-B:uidA',JSON.stringify({__HNL_WAREHOUSE_ORDER_EXPECTED_DATE__:{baseRevision:null,value:orderDateValue('2026-11-01')}}));
assert.deepEqual(loadPendingOrderChanges('project-B','uidA'),{[ORDER_DATE_KEY]:{baseRevision:null,value:orderDateValue('2026-11-01')}});

// Corrupt/stale pending values are discarded; they cannot wipe a valid cloud revision.
store.set('hnl-qltc-order-cloud-pending-v1:project-B:uidA',JSON.stringify({[key]:{baseRevision:0,value}}));
assert.deepEqual(loadPendingOrderChanges('project-B','uidA'),{});
store.set('hnl-qltc-order-cloud-pending-v1:project-B:uidA',JSON.stringify({__HNL_WAREHOUSE_ORDER_EXPECTED_DATE__:{baseRevision:null,value:orderDateValue('2026-11-01')}}));
assert.deepEqual(loadPendingOrderChanges('project-B','uidA'),{[ORDER_DATE_KEY]:{baseRevision:null,value:orderDateValue('2026-11-01')}});

const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
assert.match(rules,/match \/warehouse_order_drafts\/\{recordId\}/);
assert.match(rules,/allow delete: if false/);
assert.match(rules,/request\.resource\.data\.revision == resource\.data\.revision \+ 1/);
assert.match(rules,/d\.updatedByUid == request\.auth\.uid/);
assert.match(rules,/canonicalMemberRole\(projectId\) == 'EDITOR'/);
assert.match(rules,/allow create: if canWriteWarehouseOrder\(projectId\)/);
assert.equal((rules.match(/collectionName != 'warehouse_order_drafts'/g)||[]).length,4);
const ui=readFileSync(new URL('../src/components/WarehouseOrderSheet.tsx',import.meta.url),'utf8');
const sync=readFileSync(new URL('../src/hooks/useWarehouseOrderSync.ts',import.meta.url),'utf8');
const warehouse=readFileSync(new URL('../src/components/WarehouseTab.tsx',import.meta.url),'utf8');
const center=readFileSync(new URL('../src/components/WarehouseOrderSyncPanel.tsx',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const manager=readFileSync(new URL('../src/components/ProjectManagerModal.tsx',import.meta.url),'utf8');
const cloud=readFileSync(new URL('../src/lib/warehouseOrderCloud.ts',import.meta.url),'utf8');
assert.match(sync,/pendingRef\.current\[key\]/);
assert.match(sync,/conflictsRef\.current\.add\(key\)/);
assert.match(ui,/sort\(compareWarehouseOrderDisplayItems\)/,
  'Order screen and report must use accessory-last sort');
assert.equal((ui.match(/sort\(compareWarehouseOrderDisplayItems\)/g)||[]).length,2,
  'Both screen and exported selected rows must use accessory-last sort');
assert.match(warehouse,/warehouseOrderItems\.filter\(\(item\) => item\.kind === kind\)\.sort\(compareWarehouseOrderDisplayItems\)/,
  'Quick Edit order tab must preserve accessory-last default order');
assert.match(ui,/Ngày dự kiến hàng về/);
assert.match(ui,/Dự kiến hàng về: /);
assert.match(cloud,/runTransaction\(/);
assert.match(cloud,/revision!==baseRevision/);
assert.match(cloud,/subscribeWarehouseOrderCloud/);
assert.match(sync,/savePendingOrderChanges/);
assert.match(sync,/saveWarehouseOrderDraft/);
// A late request/snapshot from another project or signed-in account must not
// change the current project's pending queue, conflict banner or local rows.
assert.match(sync,/const oldRows=\{\.\.\.loadOrderLegacyBackup\(projectId\),\.\.\.rowsRef\.current\}/);
assert.match(sync,/const syncEpochRef=useRef\(0\)/);
assert.match(sync,/const epoch=\+\+syncEpochRef\.current/);
assert.match(sync,/return \(\)=>\{syncEpochRef\.current\+\+;unsubscribe\(\);\}/);
assert.match(sync,/if\(syncEpochRef\.current!==epoch\)return;\s+remoteRef\.current=remote/);
assert.match(sync,/if\(syncEpochRef\.current!==epoch\)return;\s+committed=true;\s+if\(pendingRef\.current\[key\]===pending\)/);
assert.match(sync,/if\(syncEpochRef\.current!==epoch\)return;\s+inFlightRef\.current\.delete\(key\)/);
assert.match(sync,/queueMicrotask\(\(\)=>\{if\(syncEpochRef\.current===epoch\)flushPending\(\);\}\)/);
assert.match(sync,/let committed=false;/);
assert.match(sync,/if\(committed&&pendingRef\.current\[key\]!==pending/);
// Only the App owns one Cloud watcher/queue, even when the order sheet is closed.
assert.match(app,/useWarehouseOrderSync\(activeProjectId/);
assert.match(app,/orderSync=\{warehouseOrderSync\}/);
assert.match(app,/warehouseOrderSync=\{warehouseOrderSync\}/);
const voucherBrowserFixture=readFileSync(new URL('./fixtures/warehouse-catalog/main.tsx',import.meta.url),'utf8');
assert.match(voucherBrowserFixture,/orderSync=\{orderSyncFixture\}/,
  'Warehouse voucher browser fixture must provide the mandatory order-sync contract');

assert.doesNotMatch(ui,/subscribeWarehouseOrderCloud|saveWarehouseOrderCloudRow|persistPending\(/);
assert.doesNotMatch(manager,/WarehouseOrderSyncPanel sync=\{warehouseOrderSync\}/);
assert.match(center,/data-hnl-health-center-warehouse-order="integrated"/);
const diagnostics = readFileSync(new URL('../src/components/GoogleConfigTab.tsx',import.meta.url),'utf8');
assert.match(diagnostics,/title="Trung tâm kiểm tra dữ liệu \(Health Center\)"/);
assert.match(diagnostics,/Trạng thái hệ thống & đồng bộ/);
assert.match(diagnostics,/warehouseOrderSync && \(\s*<WarehouseOrderSyncPanel/);
assert.ok(!center.includes('<WarehouseOrderSyncPanel '), 'Do not duplicate WarehouseOrderSyncPanel in ProjectManagerModal');
assert.match(center,/sync\.flushPending/);
assert.match(center,/sync\.importLocalDraft/);
assert.match(center,/sync\.acceptCloudConflicts/);
assert.match(center,/saveError\?'Không lưu được bản nháp'/, 'Failed local drafts must not look synced');
assert.match(center,/cloudError\|\|cloudState==='error'\?'Lỗi đồng bộ'/, 'Cloud transaction failures must be visible even when subscription is ready');
assert.match(center,/saveError\?'Không lưu được bản nháp':cloudError\|\|cloudState==='error'\?'Lỗi đồng bộ':\s*conflicts\.length\?'Có xung đột'/, 'Cloud errors must take precedence over simultaneous row conflicts while failed local saves remain highest priority');
assert.match(center,/cloudState==='offline'\?'Ngoại tuyến'/, 'Offline status must remain visible');
assert.match(center,/aria-live="polite"/, 'Sync status changes should be announced accessibly');

assert.match(sync,/\[projectId,updateLocal,actorUid,accessAllowed\]/);
assert.match(sync,/if\(!canEdit\|\|!accessAllowed\|\|!readyRef\.current/);
console.log('WAREHOUSE ORDER CLOUD/FORMULA/DATE REGRESSION PASS');
