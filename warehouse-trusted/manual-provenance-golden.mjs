import assert from 'node:assert/strict';
import {executeVoucher,warehouseKey} from './engine.mjs';
import {importWarehouseBatchAtomic} from './batch.mjs';
const projectId='verified-dev-copy';
const root=`projects/${projectId}`;
const actor={uid:'editor-1',email:'editor@example.test',emailVerified:true};
const admin={uid:'admin-1',email:'admin@example.test',emailVerified:true};
const read=(db,path)=>db.docs.get(path);
const item=(id,extra={})=>({id,type:'out',materialId:'mat-1',materialName:'Tấm 1',unit:'tấm',
  quantity:1,location:'A1',handler:'Đội 1',date:'2026-10-26',sourceType:'manual',
  sourceRoomId:'room-1',sourceFloorId:'floor-1',sourceNormId:'norm-1',
  sourceWorkCategoryId:'work-1',sourceTeamId:'team-1',sourceStructureGroupId:'group-1',...extra});
const key=warehouseKey(item('x'));
class FakeDb {
  constructor(){this.docs=new Map([
    [root,{id:projectId,ownerUid:'admin-1',ownerEmail:'admin@example.test'}],
    [`${root}/members/editor@example.test`,{role:'EDITOR',active:true}],
    [`${root}/members/admin@example.test`,{role:'ADMIN',active:true}],
    [`${root}/rooms/room-1`,{id:'room-1',floorId:'floor-1',workCategoryId:'work-1',teamId:'team-1'}],
    [`${root}/floor_plans/floor-1`,{id:'floor-1',structureGroupId:'group-1'}],
    [`${root}/material_norms/norm-1`,{id:'norm-1',materialId:'mat-1',materialName:'Tấm 1',unit:'tấm',workCategoryId:'work-1'}],
    [`${root}/work_volumes/work-1`,{id:'work-1',workCategoryId:'work-1',title:'Trần chìm'}],
    [`${root}/teams/team-1`,{id:'team-1',name:'Đội 1'}],
    [`${root}/inventory_balances/${key}`,{id:key,projectId,onHand:100,revision:1,unit:'tấm'}],
  ]);}
  doc(key){return {key};}
  async runTransaction(fn){
    const writes=[];let wrote=false;
    const tx={get:async ref=>{
      if(wrote) throw Error('READ_AFTER_WRITE');
      const data=this.docs.get(ref.key);return {exists:data!==undefined,data:()=>structuredClone(data)};
    },set:(ref,data,options)=>{wrote=true;writes.push([ref.key,structuredClone(data),options]);},
    update:(ref,data)=>{wrote=true;writes.push([ref.key,structuredClone(data),{merge:true}]);}};
    const result=await fn(tx);
    for(const [p,data,options] of writes)this.docs.set(p,options?.merge?{...read(this,p),...data}:data);
    return result;
  }
}
let count=0;
const test=async(name,fn)=>{await fn();console.log('PASS',name);count++;};
const deny=async(db,body,code)=>{
  const before=structuredClone([...db.docs]);
  await assert.rejects(body,new RegExp(code));
  assert.deepEqual([...db.docs],before,'Denied operation must leave all records unchanged');
};
const invoke=(db,row)=>executeVoucher({db,actor,projectId,action:'create',transactionId:row.id,item:row});
await test('valid referenced manual issue preserves stock and provenance',async()=>{
  const d=new FakeDb(),r=await invoke(d,item('a'));
  assert.equal(r.onHand,99);assert.equal(read(d,`${root}/inventory/a`).sourceRoomId,'room-1');
});
await test('manual may not claim a system deterministic sourceIssueKey',()=>{
  const d=new FakeDb();return deny(d,()=>invoke(d,item('b',{sourceIssueKey:'room-1|id-mat-1'})),'WAREHOUSE_PROVENANCE_SYSTEM_KEY_FORBIDDEN');
});
await test('manual cannot spoof legacy room-auto receipt ID',()=>{
  const d=new FakeDb();return deny(d,()=>invoke(d,item('AUTO-XK-FAKE')),'WAREHOUSE_PROVENANCE_SYSTEM_RECEIPT_FORBIDDEN');
});
await test('manual cannot spoof legacy room-auto notes marker',()=>{
  const d=new FakeDb();return deny(d,()=>invoke(d,item('spoof-note',{notes:'Tự động xuất kho dự toán tổng hợp cho [căn 1]'})),'WAREHOUSE_PROVENANCE_SYSTEM_RECEIPT_FORBIDDEN');
});
await test('unknown referenced room is blocked',()=>{const d=new FakeDb();return deny(d,()=>invoke(d,item('c',{sourceRoomId:'other'})),'WAREHOUSE_PROVENANCE_REFERENCE_NOT_FOUND_ROOM');});
await test('mismatching room floor is blocked',()=>{const d=new FakeDb();d.docs.get(`${root}/rooms/room-1`).floorId='another';return deny(d,()=>invoke(d,item('d')),'WAREHOUSE_PROVENANCE_ROOM_FLOOR_MISMATCH');});
await test('missing floor for room provenance is blocked',()=>{const d=new FakeDb();const row=item('e');delete row.sourceFloorId;return deny(d,()=>invoke(d,row),'WAREHOUSE_PROVENANCE_ROOM_FLOOR_REQUIRED');});
await test('missing linked norm is blocked',()=>{const d=new FakeDb();return deny(d,()=>invoke(d,item('f',{sourceNormId:'missing'})),'WAREHOUSE_PROVENANCE_REFERENCE_NOT_FOUND_NORM');});
await test('material ID mismatch against norm is blocked',()=>{const d=new FakeDb();return deny(d,()=>invoke(d,item('g',{materialId:'mat-2'})),'WAREHOUSE_PROVENANCE_NORM_MATERIAL_MISMATCH');});
await test('unit mismatch against norm is blocked',()=>{const d=new FakeDb();return deny(d,()=>invoke(d,item('h',{unit:'kg'})),'WAREHOUSE_PROVENANCE_NORM_MATERIAL_MISMATCH');});
await test('norm category mismatch blocks claimed allocation',()=>{const d=new FakeDb();d.docs.get(`${root}/material_norms/norm-1`).workCategoryId='other';return deny(d,()=>invoke(d,item('i')),'WAREHOUSE_PROVENANCE_NORM_CATEGORY_MISMATCH');});
await test('room category mismatch blocks claimed allocation',()=>{const d=new FakeDb();d.docs.get(`${root}/rooms/room-1`).workCategoryId='other';return deny(d,()=>invoke(d,item('j')),'WAREHOUSE_PROVENANCE_ROOM_CATEGORY_MISMATCH');});
await test('team not assigned to room is blocked',()=>{const d=new FakeDb();d.docs.get(`${root}/rooms/room-1`).teamId='other';return deny(d,()=>invoke(d,item('k')),'WAREHOUSE_PROVENANCE_TEAM_ROOM_MISMATCH');});
await test('group differs from floor is blocked',()=>{const d=new FakeDb();return deny(d,()=>invoke(d,item('l',{sourceStructureGroupId:'other'})),'WAREHOUSE_PROVENANCE_STRUCTURE_GROUP_MISMATCH');});
await test('IN voucher cannot claim room provenance',()=>{const d=new FakeDb();return deny(d,()=>invoke(d,item('m',{type:'in'})),'WAREHOUSE_PROVENANCE_OUT_ONLY');});
await test('unresolved work category rejected',()=>{const d=new FakeDb();return deny(d,()=>invoke(d,item('n',{sourceWorkCategoryId:'missing'})),'WAREHOUSE_PROVENANCE_REFERENCE_NOT_FOUND_WORK');});
await test('non-ASCII malformed ID rejected',()=>{const d=new FakeDb();return deny(d,()=>invoke(d,item('o',{sourceRoomId:'../other'})),'WAREHOUSE_PROVENANCE_INVALID_REF');});
await test('valid manual inventory issue without references remains compatible',async()=>{
  const d=new FakeDb(),row={...item('p')};
  for(const k of ['sourceRoomId','sourceFloorId','sourceNormId','sourceWorkCategoryId','sourceTeamId','sourceStructureGroupId'])delete row[k];
  const r=await invoke(d,row);assert.equal(r.onHand,99);
});
await test('batch rejects ALL vouchers if second references unknown room',async()=>{
  const d=new FakeDb(),before=read(d,`${root}/inventory_balances/${key}`).onHand;
  await deny(d,()=>importWarehouseBatchAtomic({db:d,actor:admin,projectId,operations:[
    {action:'create',transactionId:'q',item:item('q')},
    {action:'create',transactionId:'r',item:item('r',{sourceRoomId:'missing'})},
  ]}),'WAREHOUSE_PROVENANCE_REFERENCE_NOT_FOUND_ROOM');
  assert.equal(read(d,`${root}/inventory_balances/${key}`).onHand,before);
});
await test('batch imports two valid referenced vouchers atomically',async()=>{
  const d=new FakeDb();const result=await importWarehouseBatchAtomic({db:d,actor:admin,projectId,operations:[
    {action:'create',transactionId:'s',item:item('s')},
    {action:'create',transactionId:'t',item:item('t')},
  ]});assert.equal(result.written,2);assert.equal(read(d,`${root}/inventory_balances/${key}`).onHand,98);
});
console.log(`${count}/${count} trusted provenance simulation PASS — NOT FIREBASE EMULATOR`);
