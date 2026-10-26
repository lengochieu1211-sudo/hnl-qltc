import assert from 'node:assert/strict';
import {reconcileTrustedWarehouseBalance} from './reconcile.mjs';
import {warehouseKey} from './engine.mjs';
const pid='dev-copy',root=`projects/${pid}`,actor={uid:'admin',email:'admin@example.test',emailVerified:true};
const item=(id,type,quantity)=>({id,type,quantity,materialId:'board-1',materialName:'Tấm',unit:'m²'});
const key=warehouseKey(item('a','in',4));
class Db{
  constructor(){this.docs=new Map([
    [root,{ownerUid:'admin',ownerEmail:'admin@example.test',migrationSandbox:true,migrationSource:'DEV_COPY'}],
    [`${root}/inventory/a`,item('a','in',9)],
    [`${root}/inventory/b`,item('b','out',4)],
    [`${root}/inventory_balances/${key}`,{id:key,projectId:pid,onHand:99,revision:1}],
  ]);}
  doc(key){return {key};}
  collection(key){return {key,kind:'collection'};}
  async runTransaction(cb){const staged=[];const tx={get:async r=>r.kind==='collection'
    ?{docs:[...this.docs.entries()].filter(([path])=>path.startsWith(r.key+'/')).map(([path,data])=>({id:path.split('/').at(-1),data:()=>structuredClone(data)}))}
    :{exists:this.docs.has(r.key),data:()=>structuredClone(this.docs.get(r.key))},
    set:(r,data)=>staged.push([r,data])};
    const result=await cb(tx);
    for(const [r,data] of staged)this.docs.set(r.key,structuredClone(data));
    return result;
  }
}
let passes=0;const ok=async(name,fn)=>{await fn();passes++;console.log('PASS',name)};
const deny=(fn,msg)=>assert.rejects(fn,new RegExp(msg));
const invoke=(db,a=actor)=>reconcileTrustedWarehouseBalance({db,actor:a,projectId:pid,materialKey:key});
await ok('recompute from active vouchers only',async()=>{const db=new Db();const r=await invoke(db);assert.equal(r.onHand,5);assert.equal(db.docs.get(`${root}/inventory_balances/${key}`).revision,2)});
await ok('voucher rows remain unchanged',async()=>{const db=new Db(),before=structuredClone(db.docs.get(`${root}/inventory/a`));await invoke(db);assert.deepEqual(db.docs.get(`${root}/inventory/a`),before)});
await ok('EDITOR cannot repair',async()=>{const db=new Db();db.docs.get(root).ownerUid='other';db.docs.get(root).ownerEmail='other@example.test';db.docs.set(`${root}/members/admin@example.test`,{role:'EDITOR',active:true});await deny(()=>invoke(db),'WAREHOUSE_ROLE_DENIED')});
await ok('unverified identity blocked',async()=>deny(()=>invoke(new Db(),{...actor,emailVerified:false}),'WAREHOUSE_AUTH_OR_PROJECT_INACTIVE'));
await ok('real DEV projects without copy marker never modified',async()=>{const db=new Db();db.docs.get(root).migrationSandbox=false;await deny(()=>invoke(db),'WAREHOUSE_RECONCILE_NOT_ISOLATED_DEV_COPY');assert.equal(db.docs.get(`${root}/inventory_balances/${key}`).onHand,99)});
await ok('orphan inventory ID rejected',async()=>{const db=new Db();db.docs.get(`${root}/inventory/a`).id='imposter';await deny(()=>invoke(db),'WAREHOUSE_RECONCILE_INVALID_LEDGER')});
await ok('large ledger bounded',async()=>{const db=new Db();for(let i=0;i<502;i++)db.docs.set(`${root}/inventory/x${i}`,{...item(`x${i}`,'in',1)});await deny(()=>invoke(db),'WAREHOUSE_RECONCILE_LEDGER_TOO_LARGE')});
await ok('negative true ledger rejected without writes',async()=>{const db=new Db();db.docs.get(`${root}/inventory/b`).quantity=19;await deny(()=>invoke(db),'WAREHOUSE_RECONCILE_INVALID_TOTAL');assert.equal(db.docs.get(`${root}/inventory_balances/${key}`).onHand,99)});
await ok('renamed tombstone never revived',async()=>{const db=new Db();db.docs.get(`${root}/inventory_balances/${key}`).renamedTo='other';await deny(()=>invoke(db),'WAREHOUSE_RECONCILE_INVALID_BALANCE')});
await ok('deleted vouchers ignored',async()=>{const db=new Db();db.docs.get(`${root}/inventory/b`).deleted=true;const r=await invoke(db);assert.equal(r.onHand,9)});
await ok('no active ledger refuses to overwrite balance',async()=>{const db=new Db();db.docs.get(`${root}/inventory/a`).deleted=true;db.docs.get(`${root}/inventory/b`).deleted=true;await deny(()=>invoke(db),'WAREHOUSE_RECONCILE_NO_ACTIVE_LEDGER')});
await ok('tampered voucher key cannot bless a wrong balance',async()=>{
  const db=new Db();
  db.docs.get(`${root}/inventory/a`).materialKey='id-another-material';
  await deny(()=>invoke(db),'WAREHOUSE_RECONCILE_VOUCHER_KEY_MISMATCH');
  assert.equal(db.docs.get(`${root}/inventory_balances/${key}`).onHand,99);
});
await ok('non-target forged voucher key fails closed',async()=>{
  const db=new Db();
  db.docs.set(`${root}/inventory/c`,{...item('c','in',2),materialId:'other-id',materialKey:key});
  await deny(()=>invoke(db),'WAREHOUSE_RECONCILE_VOUCHER_KEY_MISMATCH');
  assert.equal(db.docs.get(`${root}/inventory_balances/${key}`).onHand,99);
});
console.log(`${passes}/${passes} TRUSTED LEDGER RECONCILE SIMULATION PASS — NOT FIREBASE EMULATOR`);