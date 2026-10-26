import assert from 'node:assert/strict';
import {issueTrustedRoomMaterials,stableIssueId} from './room-auto.mjs';
import {warehouseKey} from './engine.mjs';
const projectId='copied-dev-project',root=`projects/${projectId}`;
const actor={uid:'editor-1',email:'editor@test.dev',emailVerified:true};
const unit='tấm';
const mat={itemKind:'material',materialId:'mat-1',materialName:'Tấm 1',unit};
const key=warehouseKey(mat);
const voucher=(id,type,quantity,extra={})=>({id,type,...mat,quantity,location:'Kho',handler:'Đội 1',date:'2026-10-26',...extra});
const path=(collection,id)=>`${root}/${collection}/${id}`;
class FakeDb{
  constructor(){this.docs=new Map([
    [root,{id:projectId,ownerUid:'admin',ownerEmail:'admin@test.dev'}],
    [path('members',actor.email),{role:'EDITOR',active:true}],
    [path('rooms','room-1'),{id:'room-1',floorId:'floor-1',floorName:'Tầng 1',roomName:'A101',workCategoryId:'work-1',categoryVolumes:{'work-1':10},volumeUnit:'m2',revision:2,updatedAt:9876}],
    [path('floor_plans','floor-1'),{id:'floor-1',floorName:'Tầng 1'}],
    [path('work_volumes','work-1'),{id:'work-1',title:'Trần',unit:'m2'}],
    [path('material_norms','norm-1'),{id:'norm-1',workCategoryId:'work-1',...mat,unitNormPerM2:2,normBasisUnit:'m2'}],
    [path('inventory','stock-1'),voucher('stock-1','in',100)],
    [path('inventory_balances',key),{id:key,projectId,onHand:100,revision:1,unit}],
  ]);this.calls=0;}
  doc(key){return {key};}
  collection(key){return {limit:n=>({query:key,limit:n})};}
  async runTransaction(fn){
    const pending=[];let writing=false;this.calls++;
    const tx={get:async ref=>{
      if(writing)throw new Error('READ_AFTER_WRITE');
      if(ref.query){const all=[...this.docs].filter(([k])=>k.startsWith(ref.query+'/')&&k.split('/').length===ref.query.split('/').length+1).slice(0,ref.limit).map(([key,value])=>({id:key.split('/').at(-1),data:()=>structuredClone(value)}));return {docs:all};}
      const value=this.docs.get(ref.key);return {exists:value!==undefined,data:()=>structuredClone(value)};
    },set:(ref,data)=>{writing=true;pending.push([ref.key,structuredClone(data)]);}};
    const result=await fn(tx);for(const [p,d] of pending)this.docs.set(p,d);return result;
  }
}
const call=(db,overrides={})=>issueTrustedRoomMaterials({db,actor,projectId,roomId:'room-1',expectedRoomRevision:2,expectedRoomUpdatedAt:9876,...overrides});
const get=(db,col,id)=>db.docs.get(path(col,id));
const deny=async(db,change,code)=>{const before=[...db.docs].map(([k,v])=>[k,structuredClone(v)]);await assert.rejects(call(db,change),new RegExp(code));assert.deepEqual([...db.docs],before,'No partial state mutation');};
let n=0;const test=async(name,fn)=>{await fn();n++;console.log('PASS',name);};
const stable=stableIssueId('room-1|'+key);
await test('server computes 20 units from room volume x factor; cannot submit quantity',async()=>{
  const d=new FakeDb(),r=await call(d);assert.deepEqual([r.count,r.issued,r.duplicate],[1,20,false]);
  assert.equal(get(d,'inventory',stable).quantity,20);assert.equal(get(d,'inventory_balances',key).onHand,80);
});
await test('replay is idempotent; no new voucher or balance revision',async()=>{
  const d=new FakeDb();await call(d);const before=structuredClone([...d.docs]);const r=await call(d);
  assert.equal(r.duplicate,true);assert.deepEqual([...d.docs],before);
});
await test('manual room issue already allocated reduces server computed remainder',async()=>{
  const d=new FakeDb();d.docs.set(path('inventory','manual'),voucher('manual','out',7,{sourceRoomId:'room-1',sourceFloorId:'floor-1',issuePurpose:'project-work'}));
  get(d,'inventory_balances',key).onHand=93;const r=await call(d);assert.equal(r.issued,13);assert.equal(get(d,'inventory',stable).quantity,13);
});
await test('reissue only remainder after norm factor increases, preserving ID',async()=>{
  const d=new FakeDb();await call(d);get(d,'material_norms','norm-1').unitNormPerM2=3;
  const r=await call(d);assert.equal(r.issued,10);assert.equal(get(d,'inventory',stable).quantity,30);
  assert.equal(get(d,'inventory_balances',key).onHand,70);
});
await test('insufficient stock stops entire transaction',async()=>{
  const d=new FakeDb();d.docs.set(path('inventory','stock-1'),voucher('stock-1','in',5));get(d,'inventory_balances',key).onHand=5;
  return deny(d,{},'WAREHOUSE_ROOM_INSUFFICIENT_STOCK');
});
await test('server refuses forged client quantity and unauthorized request fields',async()=>{
  const d=new FakeDb();await call(d,{quantity:999}); // engine deliberately ignores this property, never uses its value
  // Pure engine ignores extra keys; callable boundary strips/rejects them, tested statically separately.
  assert.equal(get(d,'inventory',stable)?.quantity,20);
});
await test('member revocation blocks before any voucher write',async()=>{
  const d=new FakeDb();d.docs.get(path('members',actor.email)).active=false;
  return deny(d,{},'WAREHOUSE_ROLE_DENIED');
});
await test('stale displayed room revision aborts',()=>deny(new FakeDb(),{expectedRoomRevision:1},'WAREHOUSE_AUTO_ROOM_REVISION_CHANGED'));
await test('stale room timestamp aborts',()=>deny(new FakeDb(),{expectedRoomUpdatedAt:90},'WAREHOUSE_AUTO_ROOM_REVISION_CHANGED'));
await test('multi-category room never issues partial material',async()=>{
  const d=new FakeDb();get(d,'rooms','room-1').categoryVolumes['work-2']=4;
  return deny(d,{},'WAREHOUSE_ROOM_CANONICAL_CATEGORY_REQUIRED');
});
await test('unknown norm material ID blocks; no legacy aliases guessed',async()=>{
  const d=new FakeDb();delete get(d,'material_norms','norm-1').materialId;
  return deny(d,{},'WAREHOUSE_ROOM_UNSAFE_NORM');
});
await test('double-defined material norm aborts',async()=>{
  const d=new FakeDb();d.docs.set(path('material_norms','norm-2'),{...get(d,'material_norms','norm-1'),id:'norm-2'});
  return deny(d,{},'WAREHOUSE_ROOM_MULTIPLE_NORMS_PER_MATERIAL');
});
await test('legacy receipt with no sourceRoomId blocks instead of double export',async()=>{
  const d=new FakeDb();d.docs.set(path('inventory','legacy'),voucher('legacy','out',10,{notes:'Tự động xuất kho dự toán tổng hợp cho [A101]',location:'Tầng 1 - A101'}));
  get(d,'inventory_balances',key).onHand=90;return deny(d,{},'WAREHOUSE_ROOM_LEGACY_ISSUES_REVIEW_FIRST');
});
await test('deleted stable receipt ID cannot be revived',async()=>{
  const d=new FakeDb();d.docs.set(path('inventory',stable),voucher(stable,'out',5,{deleted:true,deletedAt:40,sourceRoomId:'room-1'}));
  return deny(d,{},'WAREHOUSE_AUTO_DELETED_RECEIPT_RESERVED');
});
await test('balance ledger parity violation aborts',async()=>{
  const d=new FakeDb();get(d,'inventory_balances',key).onHand=300;
  return deny(d,{},'WAREHOUSE_ROOM_LEDGER_BALANCE_MISMATCH');
});
await test('unsupported norm basis unit blocks',async()=>{
  const d=new FakeDb();get(d,'material_norms','norm-1').normBasisUnit='m';
  return deny(d,{},'WAREHOUSE_ROOM_UNSAFE_NORM');
});
await test('mismatching saved room categoryVolumeUnit fails before stock update',async()=>{
  const d=new FakeDb();get(d,'rooms','room-1').categoryVolumeUnits={'work-1':'m'};
  return deny(d,{},'WAREHOUSE_ROOM_VOLUME_UNIT_MISMATCH');
});
await test('removes stale old sourceTeamId when authoritative room has no verifiable team',async()=>{
  const d=new FakeDb();await call(d);get(d,'inventory',stable).sourceTeamId='unverified-old-team';
  get(d,'material_norms','norm-1').unitNormPerM2=3;
  await call(d);assert.equal(get(d,'inventory',stable).sourceTeamId,undefined);
});
await test('unknown floor blocks',async()=>{
  const d=new FakeDb();d.docs.delete(path('floor_plans','floor-1'));
  return deny(d,{},'WAREHOUSE_ROOM_FLOOR_MISMATCH');
});
await test('failed second material atomicity: does not issue first',async()=>{
  const d=new FakeDb();const mat2={itemKind:'material',materialId:'mat-2',materialName:'Khung 2',unit:'thanh'}, key2=warehouseKey(mat2);
  d.docs.set(path('material_norms','norm-2'),{id:'norm-2',workCategoryId:'work-1',...mat2,unitNormPerM2:5,normBasisUnit:'m2'});
  d.docs.set(path('inventory','stock-2'),voucher('stock-2','in',2,{...mat2}));
  d.docs.set(path('inventory_balances',key2),{id:key2,projectId,onHand:2,revision:1,unit:'thanh'});
  return deny(d,{},'WAREHOUSE_ROOM_INSUFFICIENT_STOCK');
});
await test('unresolved team display alias blocks unallocated issue',async()=>{
  const d=new FakeDb();get(d,'rooms','room-1').assignedTeam='Đội không rõ ID';
  return deny(d,{},'WAREHOUSE_ROOM_AMBIGUOUS_TEAM');
});
await test('canonical team ID is read and preserved in receipt',async()=>{
  const d=new FakeDb();get(d,'rooms','room-1').teamId='team-1';
  d.docs.set(path('teams','team-1'),{id:'team-1',name:'Đội 1'});
  await call(d);assert.equal(get(d,'inventory',stable).sourceTeamId,'team-1');
});
await test('missing team fails entire issue',async()=>{
  const d=new FakeDb();get(d,'rooms','room-1').teamId='team-ghost';
  return deny(d,{},'WAREHOUSE_ROOM_TEAM_NOT_FOUND');
});
await test('two canonical materials are issued atomically with distinct units',async()=>{
  const d=new FakeDb();const mat2={itemKind:'material',materialId:'mat-2',materialName:'Khung 2',unit:'thanh'};
  const key2=warehouseKey(mat2);
  d.docs.set(path('material_norms','norm-2'),{id:'norm-2',workCategoryId:'work-1',...mat2,unitNormPerM2:1,normBasisUnit:'m2'});
  d.docs.set(path('inventory','stock-2'),voucher('stock-2','in',50,{...mat2}));
  d.docs.set(path('inventory_balances',key2),{id:key2,projectId,onHand:50,revision:1,unit:'thanh'});
  const r=await call(d);assert.equal(r.count,2);
  assert.equal(get(d,'inventory',stableIssueId(`room-1|${key2}`)).quantity,10);
  assert.equal(get(d,'inventory_balances',key).onHand,80);
  assert.equal(get(d,'inventory_balances',key2).onHand,40);
});
await test('existing manual issues exceeding norm stop unsafe auto reconciliation',async()=>{
  const d=new FakeDb();d.docs.set(path('inventory','manual-big'),voucher('manual-big','out',21,{sourceRoomId:'room-1',sourceFloorId:'floor-1'}));
  get(d,'inventory_balances',key).onHand=79;
  return deny(d,{},'WAREHOUSE_ROOM_PREVIOUS_OVERISSUE');
});
await test('canonical UI room ID cannot escape project path',async()=>{
  await assert.rejects(call(new FakeDb(),{roomId:'../other'}),/WAREHOUSE_ROOM_INVALID_REQUEST/);
});
console.log(`${n}/${n} canonical room auto-issue FakeDb PASS (NOT Firebase Emulator)`);
