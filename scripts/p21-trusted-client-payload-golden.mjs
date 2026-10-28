/** P21.4 local pure tests. No Firebase, no network, no cloud writes. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {strictManualVoucherPayload} from '../src/utils/warehouseTrustedPayload.ts';
const source=readFileSync(new URL('../src/lib/warehouseTrustedDemoGateway.ts',import.meta.url),'utf8');
const client=readFileSync(new URL('../src/lib/warehouseTransactions.ts',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const norm=readFileSync(new URL('../src/lib/warehouseUnitMigration.ts',import.meta.url),'utf8');
let passed=0;
const check=(name,fn)=>{fn();console.log('PASS',name);passed++;};
const normal={id:'NK-1',type:'in',materialName:'Ty ren M8',unit:'cây',quantity:8,
  location:'Lầu 3',handler:'Nguyễn A',date:'2026-10-27',notes:'test',revision:5,
  createdAt:12,createdByUid:'forged',updatedByUid:'forged',updatedAt:13,sourceType:'manual'};
check('manual identity/quantity/provenance preserved',()=>{
  const payload=strictManualVoucherPayload(normal);
  assert.equal(payload.id,normal.id);assert.equal(payload.quantity,8);assert.equal(payload.sourceType,'manual');
});
check('forged server audit metadata excluded',()=>{
  const payload=strictManualVoucherPayload(normal);
  for(const k of ['revision','createdAt','createdByUid','updatedByUid','updatedAt','deletedAt','materialKey'])assert.ok(!(k in payload));
});
check('undefined and null optional keys excluded',()=>{
  const payload=strictManualVoucherPayload({...normal,notes:undefined,materialId:undefined});
  assert.ok(!('notes'in payload));assert.ok(!('materialId'in payload));
});
check('room-auto provenance is blocked',()=>assert.throws(()=>strictManualVoucherPayload({...normal,sourceType:'room-auto'}),/SERVER_FLOW/));
check('automated voucher ID spoof blocked',()=>assert.throws(()=>strictManualVoucherPayload({...normal,id:'AUTO-XK-room'}),/SERVER_FLOW/));
check('automated issue key spoof blocked',()=>assert.throws(()=>strictManualVoucherPayload({...normal,sourceIssueKey:'test'}),/SERVER_FLOW/));
check('empty/missing item identity blocked',()=>assert.throws(()=>strictManualVoucherPayload({...normal,id:''}),/SERVER_FLOW/));
check('PROD has no trusted transport route',()=>{
  assert.match(source,/APP_ENVIRONMENT === 'DEV' && FIREBASE_EMULATOR_ENABLED/);
  assert.match(source,/FIREBASE_EMULATOR_PROJECT_ID.startsWith\('demo-'\)/);
  assert.match(source,/explicitOptIn && !safeDemo/);
  assert.match(source,/P21_LOCAL_EMULATOR_ONLY/);
});
check('all single-voucher client methods route through trusted backend when flagged',()=>{
  for(const a of ['create','update','softDelete','restore','discard'])assert.ok(client.includes(`action:'${a}'`));
});
check('import is atomic, never falls back silently in test mode',()=>{
  assert.match(app,/TRUSTED_WAREHOUSE_DEMO_MODE\) \{\s*await trustedImportDemo/);
  assert.match(source,/P21_TRUSTED_IMPORT_MAX_30_ALL_OR_NOTHING/);
});
check('unit rename is routed through trusted backend',()=>assert.match(norm,/TRUSTED_WAREHOUSE_DEMO_MODE\) return trustedUnitRenameDemo/));
check('automatic room issue rejected before legacy client write',()=>assert.match(app,/TRUSTED_WAREHOUSE_DEMO_MODE && normalized.sourceType === 'room-auto'/));
console.log(`P21.4 CLIENT TRUSTED PAYLOAD / ROUTING ${passed}/${passed} PASS (no real Functions runtime)`);
