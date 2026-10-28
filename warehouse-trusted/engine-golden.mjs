import assert from 'node:assert/strict';
import {executeVoucher,warehouseKey,validatedVoucher} from './engine.mjs';
const actor={uid:'u-edit',email:'Editor@example.test',emailVerified:true};
const p='dev-project';
const path=(...parts)=>['projects',p,...parts].join('/');
class FakeDb {
  constructor(){this.docs=new Map();this.docs.set(path(),{id:p,ownerUid:'u-admin',ownerEmail:'admin@example.test'});this.docs.set(path('members','editor@example.test'),{role:'EDITOR',active:true});this.docs.set(path('members','u-edit'),{role:'ADMIN',active:true});}
  doc(key){return {key};}
  async runTransaction(fn) {
    const staged=[];
    const tx={
      get:async ref=>{const v=this.docs.get(ref.key);return {exists:v!==undefined,data:()=> structuredClone(v)};},
      set:(ref,data)=>staged.push({op:'set',ref,data}),
      update:(ref,data)=>staged.push({op:'update',ref,data}),
    };
    const result=await fn(tx);
    for(const {op,ref,data} of staged){if(op==='update')assert.ok(this.docs.has(ref.key));this.docs.set(ref.key,op==='update'?{...this.docs.get(ref.key),...structuredClone(data)}:structuredClone(data));}
    return result;
  }
}
const voucher=(id, type, quantity, overrides={})=>({id,type,quantity,materialName:'Tấm A',materialId:'material-a',unit:'tấm',location:'Kho',handler:'Thủ kho',date:'2026-10-26',...overrides});
let passed=0;
const test=async(label,func)=>{await func();passed++;console.log('PASS',label);};
const deny=async(fn,code)=>assert.rejects(async()=>fn(),new RegExp(code));
const db=new FakeDb();
const run=(action, transactionId, extra={})=>executeVoucher({db,actor,projectId:p,action,transactionId,...extra});
const runAdmin=(action,transactionId,extra={})=>executeVoucher({db,actor:{uid:'u-admin',email:'admin@example.test',emailVerified:true},projectId:p,action,transactionId,...extra});
const key=warehouseKey(voucher('a','in',10));
await test('cannot forge system fields',()=>deny(()=>Promise.resolve(validatedVoucher({...voucher('a','in',10),onHand:999},'a')),'WAREHOUSE_FORBIDDEN'));
await test('manual client cannot forge room-auto provenance on create',()=>deny(
  ()=>run('create','forged-auto',{item:voucher('forged-auto','in',12,{sourceType:'room-auto',sourceRoomId:'r-1',sourceIssueKey:'fake'})}),
  'WAREHOUSE_SYSTEM_SOURCE_REQUIRES_TRUSTED_AUTOMATION'));
await test('manual client cannot forge custom system provenance on create',()=>deny(
  ()=>run('create','forged-system',{item:voucher('forged-system','in',2,{sourceType:'warehouse-system'})}),
  'WAREHOUSE_SYSTEM_SOURCE_REQUIRES_TRUSTED_AUTOMATION'));
await test('explicit manual source is accepted by trusted voucher validator',async()=>{
  assert.equal(validatedVoucher(voucher('manual','in',1,{sourceType:'manual'}),'manual').sourceType,'manual');
});
await test('historical room-auto voucher cannot be converted to manual by EDITOR update',async()=>{
  const temp=new FakeDb();
  const previous={...voucher('historic-auto','out',1,{sourceType:'room-auto',sourceRoomId:'room-9'}),
    materialKey:key,revision:1,deleted:false,deletedAt:null};
  temp.docs.set(path('inventory','historic-auto'),previous);
  temp.docs.set(path('inventory_balances',key),{id:key,projectId:p,onHand:5,revision:1,materialName:'Tấm A',unit:'tấm'});
  await deny(()=>executeVoucher({db:temp,actor,projectId:p,action:'update',transactionId:'historic-auto',
    item:voucher('historic-auto','out',1,{sourceType:'manual'}),expectedRevision:1}),
    'WAREHOUSE_SYSTEM_SOURCE_REQUIRES_TRUSTED_AUTOMATION');
  assert.deepEqual(temp.docs.get(path('inventory','historic-auto')),previous);
  assert.equal(temp.docs.get(path('inventory_balances',key)).onHand,5);
});
await test('canonical email membership overrides UID ADMIN',()=>{db.docs.get(path('members','editor@example.test')).active=false;return deny(()=>run('create','a',{item:voucher('a','in',10)}),'WAREHOUSE_ROLE_DENIED');});
await test('create IN only with active editor',async()=>{db.docs.get(path('members','editor@example.test')).active=true;const r=await run('create','a',{item:voucher('a','in',10)});assert.equal(r.onHand,10);assert.equal(db.docs.get(path('inventory_balances',key)).onHand,10);});
await test('duplicate same-ID same-content is idempotent',async()=>{const r=await run('create','a',{item:voucher('a','in',10)});assert.equal(r.duplicate,true);assert.equal(r.onHand,10);assert.equal(db.docs.get(path('inventory_balances',key)).onHand,10);});
await test('duplicate ID conflicting quantity forbidden',()=>deny(()=>run('create','a',{item:voucher('a','in',50)}),'WAREHOUSE_ID_COLLISION'));
await test('OUT limited by current stock',()=>deny(()=>run('create','bad',{item:voucher('bad','out',11)}),'WAREHOUSE_INSUFFICIENT_STOCK'));
await test('OUT consumes stock exactly',async()=>{const r=await run('create','b',{item:voucher('b','out',4)});assert.equal(r.onHand,6);});
await test('update rejects stale revision',()=>deny(()=>run('update','b',{item:voucher('b','out',3),expectedRevision:99}),'WAREHOUSE_REVISION_CONFLICT'));
await test('edit reverses old and applies new',async()=>{const r=await run('update','b',{item:voucher('b','out',3),expectedRevision:1});assert.equal(r.onHand,7);});
await test('edit material identity moves two balances',async()=>{await run('create','supply-b',{item:voucher('supply-b','in',5,{materialName:'Tấm B',materialId:'material-b'})});const r=await run('update','b',{item:voucher('b','out',3,{materialName:'Tấm B',materialId:'material-b'}),expectedRevision:2});assert.equal(r.onHand,2);assert.equal(db.docs.get(path('inventory_balances',key)).onHand,10);});
await test('editor cannot soft-delete voucher',()=>deny(()=>run('softDelete','a'),'WAREHOUSE_ROLE_DENIED'));
await test('delete voucher subtracts prior signed delta',async()=>{await runAdmin('softDelete','a');assert.equal(db.docs.get(path('inventory_balances',key)).onHand,0);});
await test('deleted voucher ID may never be reused',()=>deny(()=>run('create','a',{item:voucher('a','in',10)}),'WAREHOUSE_DELETED_ID_REUSE_BLOCKED'));
await test('editor cannot restore',()=>deny(()=>run('restore','a'),'WAREHOUSE_ROLE_DENIED'));
await test('admin restore honors original balance',async()=>{const r=await executeVoucher({db,actor:{uid:'u-admin',email:'admin@example.test',emailVerified:true},projectId:p,action:'restore',transactionId:'a'});assert.equal(r.onHand,10);});
await test('restore second time is idempotent',async()=>{const r=await executeVoucher({db,actor:{uid:'u-admin',email:'admin@example.test',emailVerified:true},projectId:p,action:'restore',transactionId:'a'});assert.equal(r.duplicate,true);assert.equal(r.onHand,10);});
await test('cannot soft-delete IN if later OUT consumed stock',async()=>{await run('create','c',{item:voucher('c','out',8)});await deny(()=>runAdmin('softDelete','a'),'WAREHOUSE_INSUFFICIENT_STOCK');});
await test('unknown action blocked',()=>deny(()=>run('tamper','a'),'WAREHOUSE_INVALID_REQUEST'));
await test('unverified EMAIL owner is denied',()=>deny(()=>executeVoucher({db,actor:{uid:'u-admin',email:'admin@example.test',emailVerified:false},projectId:p,action:'softDelete',transactionId:'b'}),'WAREHOUSE_AUTH_OR_PROJECT_INACTIVE'));
await test('unverified EDITOR denied even with role',()=>deny(()=>executeVoucher({db,actor:{...actor,emailVerified:false},projectId:p,action:'create',transactionId:'unverified',item:voucher('unverified','in',1)}),'WAREHOUSE_AUTH_OR_PROJECT_INACTIVE'));
await test('inactive project rejected',async()=>{const project=db.docs.get(path());project.deleted=true;await deny(()=>run('create','deleted-project',{item:voucher('deleted-project','in',1)}),'WAREHOUSE_AUTH_OR_PROJECT_INACTIVE');project.deleted=false;});
await test('trash discard is ADMIN only, stock untouched and idempotent',async()=>{await runAdmin('softDelete','c');const old=db.docs.get(path('inventory_balances',key)).onHand;await deny(()=>run('discard','c'),'WAREHOUSE_ROLE_DENIED');await runAdmin('discard','c');assert.equal(db.docs.get(path('inventory_balances',key)).onHand,old);assert.equal(db.docs.get(path('inventory','c')).trashRecoverable,false);const retry=await runAdmin('discard','c');assert.equal(retry.duplicate,true);});
await test('discarded voucher cannot be restored',()=>deny(()=>runAdmin('restore','c'),'WAREHOUSE_TRASH_EXPIRED'));
await test('huge quantity is rejected before Firestore write',()=>deny(()=>run('create','huge',{item:voucher('huge','in',1e16)}),'WAREHOUSE_INVALID_QUANTITY'));
await test('numeric overflow in aggregate rejected',async()=>{const k=warehouseKey(voucher('overflow','in',1));const balance=db.docs.get(path('inventory_balances',k));balance.onHand=1e15;await deny(()=>run('create','overflow',{item:voucher('overflow','in',1e12)}),'WAREHOUSE_BALANCE_RANGE_EXCEEDED');balance.onHand=10;});
await test('lost HTTP response: identical update replay is read-only and returns current balance',async()=>{
  const temp=new FakeDb();
  const invoke=(action, transactionId, extra={})=>executeVoucher({db:temp,actor,projectId:p,action,transactionId,...extra});
  await invoke('create','replay-in',{item:voucher('replay-in','in',20)});
  await invoke('create','replay-out',{item:voucher('replay-out','out',4)});
  const next=voucher('replay-out','out',5);
  const first=await invoke('update','replay-out',{item:next,expectedRevision:1});
  const before=temp.docs.get(path('inventory_balances',key));
  const second=await invoke('update','replay-out',{item:next,expectedRevision:1});
  assert.equal(first.onHand,15);
  assert.equal(second.onHand,15);
  assert.equal(second.duplicate,true);
  assert.deepEqual(temp.docs.get(path('inventory_balances',key)),before);
  assert.equal(temp.docs.get(path('inventory','replay-out')).revision,2);
});
await test('lost HTTP response: conflicting retry never double-changes stock',async()=>{
  const temp=new FakeDb();
  const invoke=(action, transactionId, extra={})=>executeVoucher({db:temp,actor,projectId:p,action,transactionId,...extra});
  await invoke('create','replay-in',{item:voucher('replay-in','in',20)});
  await invoke('create','replay-out',{item:voucher('replay-out','out',4)});
  await invoke('update','replay-out',{item:voucher('replay-out','out',5),expectedRevision:1});
  await deny(()=>invoke('update','replay-out',{item:voucher('replay-out','out',6),expectedRevision:1}), 'WAREHOUSE_REVISION_CONFLICT');
  assert.equal(temp.docs.get(path('inventory_balances',key)).onHand,15);
});
await test('forged legacy materialKey refuses the whole transaction without mutations',async()=>{
  const temp=new FakeDb();
  const invoke=(action, transactionId, extra={})=>executeVoucher({db:temp,actor,projectId:p,action,transactionId,...extra});
  await invoke('create','key-in',{item:voucher('key-in','in',20)});
  const before=temp.docs.get(path('inventory_balances',key));
  temp.docs.get(path('inventory','key-in')).materialKey='id-other-material';
  await deny(()=>invoke('update','key-in',{item:voucher('key-in','in',25),expectedRevision:1}), 'WAREHOUSE_VOUCHER_KEY_MISMATCH_RECONCILE_FIRST');
  assert.deepEqual(temp.docs.get(path('inventory_balances',key)),before);
});
console.log(`${passed} warehouse trusted writer simulated transaction tests passed — NOT FIREBASE EMULATOR`);
