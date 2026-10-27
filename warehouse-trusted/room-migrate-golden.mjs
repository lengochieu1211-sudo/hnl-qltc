import assert from 'node:assert/strict';
import {migrateDevCopiedRoom,validateLegacyRoomForMigration} from './room-migrate.mjs';
import {planRoomSubItemMigration} from '../scripts/room-subitem-migration-plan.mjs';
const p='dev-copy-project',rid='r1',actor={uid:'admin-uid',email:'admin@example.test',emailVerified:true};
const root=`projects/${p}`;
const room={id:rid,projectId:p,revision:7,updatedAt:55,subItems:[
  {id:'s1',name:'Khung',status:'Đang làm',workVolume:25,assignedTeam:'A'},
  {id:'s2',name:'Tấm',status:'Chưa làm',workVolume:25,inspectionStatus:'Chưa nghiệm thu'},
]};
class Db{
  constructor(){this.docs=new Map([[root,{ownerUid:'admin-uid',ownerEmail:'admin@example.test',migrationSandbox:true,migrationSource:'DEV_COPY'}],[`${root}/rooms/${rid}`,structuredClone(room)]]);}
  doc(key){return {key};}
  collection(key){return {key,kind:'collection'};}
  async runTransaction(callback){
    const pending=[];const tx={
      get:async r=>r.kind==='collection'
        ? {empty:![...this.docs.keys()].some(k=>k.startsWith(r.key+'/'))}
        : {exists:this.docs.has(r.key),data:()=>structuredClone(this.docs.get(r.key))},
      create:(r,d)=>pending.push(['create',r.key,d]),
      update:(r,d)=>pending.push(['update',r.key,d]),
    };
    const res=await callback(tx);
    for(const [action,key,d] of pending){if(action==='create')assert.equal(this.docs.has(key),false);if(action==='update')assert.equal(this.docs.has(key),true);
      this.docs.set(key,action==='update'?{...this.docs.get(key),...structuredClone(d)}:structuredClone(d));}
    return res;
  }
}
let n=0;
const check=async(name,cb)=>{await cb();n++;console.log('PASS',name);};
const deny=(f,code)=>assert.rejects(f,new RegExp(code));
await check('P8 and P12 definitions/progress source identity parity',()=>{
  const p8=planRoomSubItemMigration({rooms:[room]},{projectId:p});
  const p12=validateLegacyRoomForMigration(room);
  assert.equal(p8.counts.definitions,p12.items.length);assert.equal(p8.counts.progress,p12.items.length);
  assert.deepEqual(p12.items.map(x=>x.id),['s1','s2']);
});
await check('migration approval required',()=>deny(()=>migrateDevCopiedRoom({db:new Db(),actor,projectId:p,roomId:rid}),'ROOM_MIGRATION_NOT_APPROVED'));
await check('only verified email ADMIN may migrate',()=>deny(()=>migrateDevCopiedRoom({db:new Db(),actor:{...actor,emailVerified:false},projectId:p,roomId:rid,approval:'MIGRATE-VERIFIED-DEV-COPY'}),'WAREHOUSE_AUTH_OR_PROJECT_INACTIVE'));
await check('only DEV-copy marked projects may migrate',async()=>{
  const d=new Db();d.docs.get(root).migrationSandbox=false;
  await deny(()=>migrateDevCopiedRoom({db:d,actor,projectId:p,roomId:rid,approval:'MIGRATE-VERIFIED-DEV-COPY'}),'ROOM_MIGRATION_NOT_ISOLATED_DEV_COPY');
});
await check('reject sidecar pre-existing partial rows before any write',async()=>{
  const d=new Db();d.docs.set(`${root}/rooms/${rid}/subitem_progress/s1`,{id:'s1'});
  await deny(()=>migrateDevCopiedRoom({db:d,actor,projectId:p,roomId:rid,approval:'MIGRATE-VERIFIED-DEV-COPY'}),'ROOM_MIGRATION_PREEXISTING_SIDECAR');
  assert.equal(d.docs.get(`${root}/rooms/${rid}`).subItemProgressMigrated,undefined);
});
await check('orphan sidecars for unknown IDs block migration',async()=>{
  const d=new Db();d.docs.set(`${root}/rooms/${rid}/subitem_definitions/orphan`,{id:'orphan'});
  await deny(()=>migrateDevCopiedRoom({db:d,actor,projectId:p,roomId:rid,approval:'MIGRATE-VERIFIED-DEV-COPY'}),'ROOM_MIGRATION_PREEXISTING_SIDECAR');
  assert.equal(d.docs.get(`${root}/rooms/${rid}`).subItemProgressMigrated,undefined);
});
await check('single transaction adds sidecars and marker with no embedded changes',async()=>{
  const d=new Db(),out=await migrateDevCopiedRoom({db:d,actor,projectId:p,roomId:rid,approval:'MIGRATE-VERIFIED-DEV-COPY'});
  assert.equal(out.progress,2);assert.equal(out.definitions,2);
  const next=d.docs.get(`${root}/rooms/${rid}`);
  assert.deepEqual(next.subItems,room.subItems);assert.equal(next.subItemProgressMigrated,true);
  assert.equal(next.revision,8);assert.ok(next.updatedAt>55);
  assert.equal(d.docs.get(`${root}/rooms/${rid}/subitem_progress/s1`).revision,1);
  assert.equal(d.docs.get(`${root}/rooms/${rid}/subitem_definitions/s2`).name,'Tấm');
  await deny(()=>migrateDevCopiedRoom({db:d,actor,projectId:p,roomId:rid,approval:'MIGRATE-VERIFIED-DEV-COPY'}),'ROOM_MIGRATION_ALREADY_DONE');
});
await check('unknown historical field aborts migration',()=>deny(()=>migrateDevCopiedRoom({db:(()=>{const d=new Db();d.docs.get(`${root}/rooms/${rid}`).subItems[0].unknownLegacy='valuable';return d})(),actor,projectId:p,roomId:rid,approval:'MIGRATE-VERIFIED-DEV-COPY'}),'ROOM_MIGRATION_UNSAFE_SUBITEM'));
await check('missing revision prevents unsafe progress copy',()=>deny(()=>migrateDevCopiedRoom({db:(()=>{const d=new Db();delete d.docs.get(`${root}/rooms/${rid}`).revision;return d})(),actor,projectId:p,roomId:rid,approval:'MIGRATE-VERIFIED-DEV-COPY'}),'ROOM_MIGRATION_UNVERSIONED_SOURCE'));
await check('deleted room cannot be migrated',()=>deny(()=>migrateDevCopiedRoom({db:(()=>{const d=new Db();d.docs.get(`${root}/rooms/${rid}`).deleted=true;return d})(),actor,projectId:p,roomId:rid,approval:'MIGRATE-VERIFIED-DEV-COPY'}),'ROOM_MIGRATION_INACTIVE'));
await check('project document cannot be substituted with another project',()=>deny(()=>migrateDevCopiedRoom({db:new Db(),actor,projectId:'../bad',roomId:rid,approval:'MIGRATE-VERIFIED-DEV-COPY'}),'ROOM_MIGRATION_NOT_APPROVED'));
console.log(`${n}/${n} DEV COPY ROOM MIGRATION SIMULATION PASS — NOT FIREBASE EMULATOR`);
