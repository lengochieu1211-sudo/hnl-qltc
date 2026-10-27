import assert from 'node:assert/strict';
import {renameTrustedMaterialUnit} from './unit-rename.mjs';
import {warehouseKey} from './engine.mjs';
const project='copied-dev-project',root=`projects/${project}`;
const actor={uid:'admin',email:'admin@example.test',emailVerified:true};
const full=(key)=>`${root}/${key}`;
const material={itemKind:'material',materialId:'MAT-001',materialName:'Tấm',unit:'Tấm'};
const key=warehouseKey(material);
class Db {
  constructor(){this.docs=new Map([
    [root,{ownerUid:'admin',ownerEmail:actor.email,migrationSandbox:true,migrationSource:'DEV_COPY'}],
    [full('material_norms/n1'),{id:'n1',materialId:'MAT-001',materialName:'Tấm',unit:'Tấm',revision:1,updatedAt:1}],
    [full('material_norms/n2'),{id:'n2',materialId:'MAT-001',materialName:'Tấm',unit:'Tấm',revision:3,updatedAt:2}],
    [full('inventory/a'),{id:'a',...material,type:'in',quantity:20,materialKey:key,revision:1}],
    [full('inventory/b'),{id:'b',...material,type:'out',quantity:7,materialKey:key,revision:1}],
    [full(`inventory_balances/${key}`),{id:key,projectId:project,...material,onHand:13,revision:1}],
  ]);}
  doc(key){return {key};}
  collection(key){return {key,collection:true};}
  async runTransaction(fn){
    const writes=[];
    const tx={
      get:async(ref)=>{
        if(ref.collection){const docs=[...this.docs].filter(([k])=>k.startsWith(ref.key+'/') && !k.slice(ref.key.length+1).includes('/'))
          .map(([k,v])=>({id:k.slice(ref.key.length+1),ref:{key:k},data:()=>structuredClone(v)}));return {docs};}
        const v=this.docs.get(ref.key);
        return {exists:v!==undefined,data:()=>structuredClone(v)};
      },
      set:(ref, data, opts)=>writes.push({ref,data,opts}),
    };
    const result=await fn(tx);
    for(const {ref,data,opts} of writes){
      this.docs.set(ref.key,opts?.merge?{...this.docs.get(ref.key),...structuredClone(data)}:structuredClone(data));
    }
    return result;
  }
}
const args={actor,projectId:project,kind:'material',materialId:'MAT-001',materialName:'Tấm',fromUnit:'Tấm',toUnit:'Tấm mới'};
let total=0;
async function check(label,fn){await fn();total++;console.log('PASS',label);}
async function reject(d, patch,code){const before=structuredClone([...d.docs]);await assert.rejects(
  ()=>renameTrustedMaterialUnit({...args,db:d,...patch}),new RegExp(code));assert.deepEqual([...d.docs],before);}
await check('ADMIN atomic update norms + stock vouchers + derived balance in one transaction',async()=>{
  const d=new Db();const result=await renameTrustedMaterialUnit({...args,db:d});
  assert.equal(result.norms,2);assert.equal(result.vouchers,2);assert.equal(result.materialKey,key);
  assert.equal(d.docs.get(full('material_norms/n1')).unit,'Tấm mới');
  assert.equal(d.docs.get(full('inventory/a')).unit,'Tấm mới');
  assert.equal(d.docs.get(full('inventory/b')).unit,'Tấm mới');
  assert.equal(d.docs.get(full(`inventory_balances/${key}`)).unit,'Tấm mới');
  assert.equal(d.docs.get(full(`inventory_balances/${key}`)).onHand,13);
  assert.equal(d.docs.get(full('inventory/a')).materialId,'MAT-001');
  assert.equal(d.docs.get(full('inventory/b')).materialKey,key);
});
await check('email EDITOR denied even if uid member ADMIN',async()=>{
 const d=new Db();d.docs.set(full('members/editor@example.test'),{role:'EDITOR'});d.docs.set(full('members/editor'),{role:'ADMIN'});
 await reject(d,{actor:{uid:'editor',email:'editor@example.test',emailVerified:true}},'WAREHOUSE_ROLE_DENIED');
});
await check('unverified email cannot run',()=>reject(new Db(),{actor:{...actor,emailVerified:false}},'WAREHOUSE_AUTH_OR_PROJECT_INACTIVE'));
await check('equipment unsupported, no writes',()=>reject(new Db(),{kind:'equipment'},'WAREHOUSE_RENAME_INVALID_REQUEST'));
await check('legacy material without canonical identity blocked',()=>reject(new Db(),{materialId:'missing'},'WAREHOUSE_RENAME_CANONICAL_NORM_NOT_FOUND'));
await check('historical deleted voucher blocks restoration inconsistency',async()=>{
 const d=new Db();d.docs.get(full('inventory/b')).deleted=true;
 await reject(d,{},'WAREHOUSE_RENAME_RESTORABLE_HISTORY_EXISTS');
});
await check('balance differs from ledger aborts whole transaction',async()=>{
 const d=new Db();d.docs.get(full(`inventory_balances/${key}`)).onHand=99;
 await reject(d,{},'WAREHOUSE_RENAME_BALANCE_LEDGER_MISMATCH');
});
await check('forged balance material identity aborts before edits',async()=>{
 const d=new Db();d.docs.get(full(`inventory_balances/${key}`)).materialName='Wrong item';
 await reject(d,{},'WAREHOUSE_RENAME_BALANCE_LEDGER_MISMATCH');
});
await check('non-numeric balance cannot be silently coerced',async()=>{
 const d=new Db();d.docs.get(full(`inventory_balances/${key}`)).onHand='13';
 await reject(d,{},'WAREHOUSE_RENAME_BALANCE_LEDGER_MISMATCH');
});
await check('vouchers inconsistent unit block all',async()=>{
 const d=new Db();d.docs.get(full('inventory/b')).unit='kg';
 await reject(d,{},'WAREHOUSE_RENAME_VOUCHER_PARITY_FAILED');
});
await check('norm stale unit blocks all',async()=>{
 const d=new Db();d.docs.get(full('material_norms/n1')).unit='kg';
 await reject(d,{},'WAREHOUSE_RENAME_NORM_PARITY_FAILED');
});
await check('foreign same-name legacy voucher aborts',async()=>{
 const d=new Db();d.docs.set(full('inventory/legacy'),{id:'legacy',materialName:'Tấm',unit:'Tấm',type:'in',quantity:2});
 await reject(d,{},'WAREHOUSE_RENAME_LEGACY_OR_ALIAS_LEDGER');
});
await check('same-name other material at destination blocks',async()=>{
 const d=new Db();d.docs.set(full('material_norms/n3'),{id:'n3',materialId:'MAT-OTHER',materialName:'Tấm',unit:'Tấm mới'});
 await reject(d,{},'WAREHOUSE_RENAME_DESTINATION_IDENTITY_COLLISION');
});
await check('orphan balance blocks rename',async()=>{
 const d=new Db();d.docs.delete(full('inventory/a'));d.docs.delete(full('inventory/b'));
 await reject(d,{},'WAREHOUSE_RENAME_BALANCE_LEDGER_MISMATCH');
});
await check('empty inventory and no balance may rename norm without creating phantom stock',async()=>{
 const d=new Db();d.docs.delete(full('inventory/a'));d.docs.delete(full('inventory/b'));d.docs.delete(full(`inventory_balances/${key}`));
 const result=await renameTrustedMaterialUnit({...args,db:d});assert.equal(result.vouchers,0);
 assert.equal(d.docs.get(full('material_norms/n2')).unit,'Tấm mới');assert.equal(d.docs.has(full(`inventory_balances/${key}`)),false);
});
await check('id collision never merges another voucher even if name differs',async()=>{
 const d=new Db();d.docs.set(full('inventory/c'),{id:'c',itemKind:'material',materialId:'MAT-001',materialName:'Other',unit:'Tấm',type:'in',quantity:1});
 await reject(d,{},'WAREHOUSE_RENAME_VOUCHER_PARITY_FAILED');
});
await check('malformed voucher quantity denies without side effects',async()=>{
 const d=new Db();d.docs.get(full('inventory/b')).quantity=NaN;
 await reject(d,{},'WAREHOUSE_RENAME_LEDGER_INVALID');
});
await check('role revocation fails before writes',async()=>{
 const d=new Db();d.docs.get(root).ownerUid='someone-else';d.docs.get(root).ownerEmail='someone@example.test';
 await reject(d,{},'WAREHOUSE_ROLE_DENIED');
});
console.log(`${total}/${total} material unit rename simulated atomic tests PASS — NOT FIREBASE EMULATOR`);
