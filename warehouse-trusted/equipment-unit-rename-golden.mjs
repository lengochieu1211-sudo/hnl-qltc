import assert from 'node:assert/strict';
import {renameTrustedEquipmentUnit,equipmentCatalogIdServer} from './equipment-unit-rename.mjs';
import {warehouseKey} from './engine.mjs';
const project='copied-dev-project',root=`projects/${project}`,actor={uid:'admin',email:'admin@example.test',emailVerified:true};
const full=x=>`${root}/${x}`;
const equipment={itemKind:'equipment',materialName:'Máy khoan',unit:'Cái'};
const oldKey=warehouseKey(equipment),newKey=warehouseKey({...equipment,unit:'Bộ'});
const cid=equipmentCatalogIdServer(equipment.materialName);
class Db {
 constructor(){this.docs=new Map([
  [root,{ownerUid:actor.uid,ownerEmail:actor.email,migrationSandbox:true,migrationSource:'DEV_COPY'}],
  [full(`equipment_catalog/${cid}`),{id:cid,projectId:project,name:'Máy khoan',displayName:'Máy khoan',unit:'Cái',revision:3,updatedAt:1}],
  [full('inventory/i1'),{id:'i1',...equipment,type:'in',quantity:10,materialKey:oldKey,revision:1}],
  [full('inventory/o1'),{id:'o1',...equipment,type:'out',quantity:4,materialKey:oldKey,revision:1}],
  [full(`inventory_balances/${oldKey}`),{id:oldKey,projectId:project,...equipment,onHand:6,revision:2}],
 ]);}
 doc(key){return {key};}
 collection(key){return {key,collection:true};}
 async runTransaction(fn){const writes=[];const tx={
  get:async r=>r.collection?{docs:[...this.docs].filter(([k])=>k.startsWith(r.key+'/')&&!k.slice(r.key.length+1).includes('/')).map(([k,v])=>({id:k.slice(r.key.length+1),ref:{key:k},data:()=>structuredClone(v)}))}:(this.docs.has(r.key)?{exists:true,data:()=>structuredClone(this.docs.get(r.key))}:{exists:false,data:()=>undefined}),
  set:(ref,data,opts)=>writes.push({ref,data,opts}),
 }; const result=await fn(tx);for(const w of writes){this.docs.set(w.ref.key,w.opts?.merge?{...this.docs.get(w.ref.key),...structuredClone(w.data)}:structuredClone(w.data));}return result;}
}
const base={actor,projectId:project,kind:'equipment',materialName:'Máy khoan',fromUnit:'Cái',toUnit:'Bộ'};
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS',name);}
async function deny(d,opts,code){const before=structuredClone([...d.docs]);await assert.rejects(()=>renameTrustedEquipmentUnit({...base,db:d,...opts}),new RegExp(code));assert.deepEqual([...d.docs],before);}
await test('catalog + all vouchers + old tombstone + new balance atomic',async()=>{
 const d=new Db(),out=await renameTrustedEquipmentUnit({...base,db:d});
 assert.equal(out.vouchers,2);assert.equal(out.onHand,6);
 assert.equal(d.docs.get(full('inventory/i1')).materialKey,newKey);
 assert.equal(d.docs.get(full('inventory/o1')).unit,'Bộ');
 assert.equal(d.docs.get(full(`inventory_balances/${oldKey}`)).renamedTo,newKey);
 assert.equal(d.docs.get(full(`inventory_balances/${oldKey}`)).onHand,0);
 assert.equal(d.docs.get(full(`inventory_balances/${newKey}`)).onHand,6);
 assert.equal(d.docs.get(full(`equipment_catalog/${cid}`)).unit,'Bộ');
});
await test('metadata and revision atomic with unit rename',async()=>{
 const d=new Db();await renameTrustedEquipmentUnit({...base,db:d,equipmentMetadata:{displayName:'Máy khoan cầm tay',category:'Thiết bị',brand:'A',model:'B',specifications:'X',notes:'',expectedRevision:3}});
 assert.equal(d.docs.get(full(`equipment_catalog/${cid}`)).displayName,'Máy khoan cầm tay');
});
await test('revoked ADMIN blocked',async()=>{const d=new Db();d.docs.get(root).ownerUid='other';d.docs.get(root).ownerEmail='other@test.local';await deny(d,{},'WAREHOUSE_ROLE_DENIED');});
await test('unverified email blocked',()=>deny(new Db(),{actor:{...actor,emailVerified:false}},'WAREHOUSE_AUTH_OR_PROJECT_INACTIVE'));
await test('email EDITOR overrides UID ADMIN',async()=>{const d=new Db();d.docs.get(root).ownerUid='other';d.docs.get(root).ownerEmail='other@test.local';d.docs.set(full('members/admin@example.test'),{role:'EDITOR'});d.docs.set(full('members/admin'),{role:'ADMIN'});await deny(d,{},'WAREHOUSE_ROLE_DENIED');});
await test('no catalog blocked to avoid legacy ambiguous identity',async()=>{const d=new Db();d.docs.delete(full(`equipment_catalog/${cid}`));await deny(d,{},'WAREHOUSE_EQUIPMENT_CATALOG_PARITY');});
await test('catalog unit mismatch blocks all',async()=>{const d=new Db();d.docs.get(full(`equipment_catalog/${cid}`)).unit='Hộp';await deny(d,{},'WAREHOUSE_EQUIPMENT_CATALOG_PARITY');});
await test('stale metadata revision blocks all',()=>deny(new Db(),{equipmentMetadata:{displayName:'Máy khoan',expectedRevision:2}},'WAREHOUSE_EQUIPMENT_REVISION_CONFLICT'));
await test('deleted voucher blocks all',async()=>{const d=new Db();d.docs.get(full('inventory/o1')).deletedAt=1;await deny(d,{},'WAREHOUSE_EQUIPMENT_RESTORABLE_HISTORY');});
await test('inconsistent voucher unit blocks all',async()=>{const d=new Db();d.docs.get(full('inventory/o1')).unit='Hộp';await deny(d,{},'WAREHOUSE_EQUIPMENT_VOUCHER_PARITY');});
await test('unknown materialKey blocks all',async()=>{const d=new Db();d.docs.get(full('inventory/o1')).materialKey='foreign';await deny(d,{},'WAREHOUSE_EQUIPMENT_VOUCHER_PARITY');});
await test('negative derived stock blocks all',async()=>{const d=new Db();d.docs.get(full('inventory/o1')).quantity=11;await deny(d,{},'WAREHOUSE_EQUIPMENT_LEDGER_NEGATIVE');});
await test('wrong stored balance blocks all',async()=>{const d=new Db();d.docs.get(full(`inventory_balances/${oldKey}`)).onHand=9;await deny(d,{},'WAREHOUSE_EQUIPMENT_BALANCE_PARITY');});
await test('missing stored balance blocks all',async()=>{const d=new Db();d.docs.delete(full(`inventory_balances/${oldKey}`));await deny(d,{},'WAREHOUSE_EQUIPMENT_BALANCE_PARITY');});
await test('destination tombstone must not be reused',async()=>{const d=new Db();d.docs.set(full(`inventory_balances/${newKey}`),{id:newKey,onHand:0,renamedTo:'something'});await deny(d,{},'WAREHOUSE_EQUIPMENT_DESTINATION_OCCUPIED');});
await test('other unit balance for same equipment blocks all',async()=>{const d=new Db();d.docs.set(full('inventory_balances/old-unrelated'),{id:'old-unrelated',itemKind:'equipment',materialName:'Máy khoan',unit:'Hộp',onHand:2});await deny(d,{},'WAREHOUSE_EQUIPMENT_DESTINATION_OCCUPIED');});
await test('catalog label collision blocks all',async()=>{const d=new Db();d.docs.set(full('equipment_catalog/other'),{id:'other',name:'Máy cắt',displayName:'Máy khoan cầm tay'});await deny(d,{equipmentMetadata:{displayName:'Máy khoan cầm tay'}},'WAREHOUSE_EQUIPMENT_CATALOG_LABEL_COLLISION');});
await test('missing ledger blocked, no phantom stock',async()=>{const d=new Db();d.docs.delete(full('inventory/i1'));d.docs.delete(full('inventory/o1'));await deny(d,{},'WAREHOUSE_EQUIPMENT_LEDGER_MISSING');});
await test('malformed metadata fails before transaction',()=>deny(new Db(),{equipmentMetadata:{displayName:' '}},'WAREHOUSE_EQUIPMENT_METADATA_INVALID'));
await test('invalid project id blocks',()=>deny(new Db(),{projectId:'../../foo'},'WAREHOUSE_EQUIPMENT_INVALID_REQUEST'));
await test('slug collision from another equipment name is rejected',async()=>{const d=new Db();d.docs.set(full('inventory/collision'),{id:'collision',itemKind:'equipment',materialName:'Máy/khoan',unit:'Cái',type:'in',quantity:1,materialKey:oldKey});await deny(d,{},'WAREHOUSE_EQUIPMENT_KEY_ALIAS_COLLISION');});
await test('existing destination unit cannot be merged',async()=>{const d=new Db();d.docs.set(full('inventory/target'),{id:'target',itemKind:'equipment',materialName:'Máy khoan',unit:'Bộ',quantity:1,type:'in',revision:1,materialKey:newKey});await deny(d,{},'WAREHOUSE_EQUIPMENT_VOUCHER_PARITY');});
console.log(`EQUIPMENT TRUSTED GOLDEN ${count}/${count} PASS`);
