import assert from 'node:assert/strict';
import {importWarehouseBatchAtomic} from './batch.mjs';
import {warehouseKey} from './engine.mjs';
const p='dev-copy-project',root=`projects/${p}`;
const admin={uid:'owner',email:'owner@example.test',emailVerified:true};
const editor={uid:'editor',email:'editor@example.test',emailVerified:true};
class Db{
  constructor(){this.docs=new Map([[root,{id:p,ownerUid:'owner',ownerEmail:admin.email}],[`${root}/members/${editor.email}`,{role:'EDITOR',active:true}]]);}
  doc(key){return {key};}
  async runTransaction(f){
    const staged=[];let wrote=false;
    const tx={
      get:async r=>{if(wrote)throw new Error('READ_AFTER_WRITE');const value=this.docs.get(r.key);return {exists:value!==undefined,data:()=>structuredClone(value)};},
      set:(ref,data)=>{wrote=true;staged.push({key:ref.key,data:structuredClone(data)});},
    };
    const out=await f(tx);
    for(const item of staged)this.docs.set(item.key,item.data);
    return out;
  }
}
const voucher=(id,type,quantity,extra={})=>({id,type,quantity,itemKind:'material',materialId:'m1',materialName:'Tấm',unit:'tấm',location:'kho',handler:'thủ kho',date:'2026-10-26',sourceType:'manual',...extra});
const op=(item,prior)=>({action:prior?'update':'create',transactionId:item.id,item,...(prior?{expectedRevision:prior}:{})});
const run=(db,operations,actor=admin)=>importWarehouseBatchAtomic({db,actor,projectId:p,operations});
const deny=(f,c)=>assert.rejects(f,new RegExp(c));
let n=0;const test=async(name,fn)=>{await fn();console.log('PASS',name);n++;};
const d=new Db(),key=warehouseKey(voucher('id','in',10));
const stock=()=>d.docs.get(`${root}/inventory_balances/${key}`)?.onHand;
await test('two IN vouchers commit in ONE transaction',async()=>{const r=await run(d,[op(voucher('a','in',10)),op(voucher('b','in',8))]);assert.equal(r.written,2);assert.equal(stock(),18);});
await test('net IN and OUT atomic, no temporary shortage',async()=>{await run(d,[op(voucher('c','out',21)),op(voucher('d','in',25))]);assert.equal(stock(),22);});
await test('batch rejected if aggregate would become negative',async()=>{const before=stock();await deny(()=>run(d,[op(voucher('e','out',12)),op(voucher('f','out',12))]),'WAREHOUSE_BATCH_INSUFFICIENT_STOCK');assert.equal(stock(),before);assert.equal(d.docs.has(`${root}/inventory/e`),false);});
await test('bad second row aborts entire batch',async()=>{const before=stock();await deny(()=>run(d,[op(voucher('g','in',1)),op(voucher('h','out',0))]),'WAREHOUSE_INVALID_QUANTITY');assert.equal(stock(),before);assert.equal(d.docs.has(`${root}/inventory/g`),false);});
await test('atomic update existing voucher and create new',async()=>{await run(d,[op(voucher('a','in',12),1),op(voucher('i','out',7))]);assert.equal(stock(),17);assert.equal(d.docs.get(`${root}/inventory/a`).revision,2);});
await test('stale update blocks other new voucher, no partial success',async()=>{const before=stock();await deny(()=>run(d,[op(voucher('a','in',13),1),op(voucher('j','in',8))]),'WAREHOUSE_BATCH_REVISION_CONFLICT');assert.equal(stock(),before);assert.equal(d.docs.has(`${root}/inventory/j`),false);});
await test('update replay does not double apply, new write still applies',async()=>{const before=stock();const r=await run(d,[op(voucher('a','in',12),1),op(voucher('k','in',2))]);assert.equal(r.duplicates,1);assert.equal(stock(),before+2);});
await test('repeating same new IDs does not change balance',async()=>{const before=stock();const r=await run(d,[op(voucher('a','in',12)),op(voucher('k','in',2))]);assert.equal(r.duplicates,2);assert.equal(stock(),before);});
await test('ID collision refuses all writes',async()=>{await deny(()=>run(d,[op(voucher('a','in',13)),op(voucher('l','in',3))]),'WAREHOUSE_BATCH_ID_COLLISION');assert.equal(d.docs.has(`${root}/inventory/l`),false);});
await test('cannot reuse deleted voucher ID',async()=>{d.docs.set(`${root}/inventory/deleted`,{...voucher('deleted','in',3),deleted:true,deletedAt:100});await deny(()=>run(d,[op(voucher('deleted','in',3))]),'WAREHOUSE_BATCH_TOMBSTONE');});
await test('EDITOR cannot import even valid vouchers',async()=>{await deny(()=>run(d,[op(voucher('m','in',3))],editor),'WAREHOUSE_ROLE_DENIED');assert.equal(d.docs.has(`${root}/inventory/m`),false);});
await test('unverified owner denied',()=>deny(()=>run(d,[op(voucher('n','in',3))],{...admin,emailVerified:false}),'WAREHOUSE_AUTH_OR_PROJECT_INACTIVE'));
await test('manual import cannot forge room-auto vouchers',()=>deny(()=>run(d,[op(voucher('o','out',2,{sourceType:'room-auto'}))]),'WAREHOUSE_SYSTEM_SOURCE_REQUIRES'));
await test('duplicate IDs in batch denied',()=>deny(()=>run(d,[op(voucher('x','in',1)),op(voucher('x','in',1))]),'WAREHOUSE_BATCH_DUPLICATE_ID'));
await test('31 vouchers denied before Cloud reads',()=>deny(()=>run(d,Array.from({length:31},(_,i)=>op(voucher(`z${i}`,'in',1)))),'WAREHOUSE_BATCH_INVALID_REQUEST'));
await test('mixed unit for same material key is rejected',async()=>{const before=stock();await deny(()=>run(d,[op(voucher('u1','in',1,{materialId:'new',unit:'tấm'})),op(voucher('u2','in',1,{materialId:'new',unit:'m2'}))]),'WAREHOUSE_BATCH_CONFLICTING_UNITS');assert.equal(stock(),before);});
await test('forged materialKey on historical record blocks import',async()=>{const old=d.docs.get(`${root}/inventory/a`);old.materialKey='id-other';await deny(()=>run(d,[op(voucher('a','in',14),2)]),'WAREHOUSE_BATCH_LEGACY_KEY_MISMATCH');old.materialKey=key;});
await test('system voucher cannot be overwritten by manual',async()=>{d.docs.set(`${root}/inventory/system`,{...voucher('system','in',10,{sourceType:'room-auto'}),revision:1,materialKey:key});await deny(()=>run(d,[op(voucher('system','in',11),1)]),'WAREHOUSE_BATCH_SYSTEM_VOUCHER_DENIED');});
console.log(`${n}/${n} atomic batch import simulated tests PASS — NOT Firebase Emulator`);