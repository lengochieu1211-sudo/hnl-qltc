import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planDemoRoomSidecarSave } from '../src/utils/roomSidecarDemoSaveSafety.ts';

const source={
  id:'ROOM-1',floorId:'F1',roomName:'Căn A101',x:2,y:3,width:20,height:12,
  subItemProgressMigrated:true,notes:'Không sửa nguồn',updatedAt:1,
  subItems:[
    {id:'S1',name:'Khung',status:'Chưa làm',workVolume:21,category:'Trần'},
    {id:'S2',name:'Tấm',status:'Đang làm',workVolume:21,category:'Trần'},
  ],
};
const progress=[
  {id:'S1',roomId:'ROOM-1',projectId:'demo-project',status:'Chưa làm',revision:2},
  {id:'S2',roomId:'ROOM-1',projectId:'demo-project',status:'Đang làm',revision:1},
];
const defs=[
  {id:'S1',roomId:'ROOM-1',projectId:'demo-project',name:'Khung',order:0},
  {id:'S2',roomId:'ROOM-1',projectId:'demo-project',name:'Tấm',order:1},
];
let passed=0;
const check=(label,fn)=>{fn();passed++;console.log('PASS '+label)};
const edited={...source,subItems:[{...source.subItems[0],status:'Đang làm'},source.subItems[1]]};
check('single progress edit carries exact CAS definition',()=>{
 const p=planDemoRoomSidecarSave(source,edited,progress,defs);
 assert.deepEqual(p,[{id:'S1',changes:{status:'Đang làm'},expectedRevision:2,expectedDefinition:defs[0]}]);
});
check('no progress edit is no-op',()=>assert.deepEqual(planDemoRoomSidecarSave(source,source,progress,defs),[]));
check('top-level room notes edit refused',()=>assert.throws(()=>planDemoRoomSidecarSave(source,{...edited,notes:'FORGED'},progress,defs),/TOP_LEVEL/));
check('room geometry edit refused',()=>assert.throws(()=>planDemoRoomSidecarSave(source,{...edited,x:90},progress,defs),/TOP_LEVEL/));
check('room ID change refused',()=>assert.throws(()=>planDemoRoomSidecarSave(source,{...edited,id:'ROOM-X'},progress,defs),/IDENTITY_CHANGED/));
check('structural subitem edit refused',()=>assert.throws(()=>planDemoRoomSidecarSave(source,{...edited,subItems:[{...edited.subItems[0],workVolume:99},edited.subItems[1]]},progress,defs),/STRUCTURE_CHANGED/));
check('removed subitem refused',()=>assert.throws(()=>planDemoRoomSidecarSave(source,{...edited,subItems:[edited.subItems[0]]},progress,defs),/STRUCTURE_CHANGED/));
check('extra subitem refused',()=>assert.throws(()=>planDemoRoomSidecarSave(source,{...edited,subItems:[...edited.subItems,{id:'FORGED',name:'x',status:'Chưa làm'}]},progress,defs),/STRUCTURE_CHANGED/));
check('missing revision refused',()=>assert.throws(()=>planDemoRoomSidecarSave(source,edited,[{...progress[0],revision:undefined},progress[1]],defs),/UNVERIFIED_REVISION/));
check('missing definition refused',()=>assert.throws(()=>planDemoRoomSidecarSave(source,edited,progress,[defs[1]]),/UNVERIFIED_REVISION/));
check('not migrated refused',()=>assert.throws(()=>planDemoRoomSidecarSave({...source,subItemProgressMigrated:false},edited,progress,defs),/NOT_VERIFIED_MIGRATED/));
check('missing legacy subitems refused',()=>assert.throws(()=>planDemoRoomSidecarSave({...source,subItems:undefined},edited,progress,defs),/NOT_VERIFIED_MIGRATED/));
const bridge=readFileSync(new URL('../src/components/RoomSidecarDemoBridge.tsx',import.meta.url),'utf8');
const modal=readFileSync(new URL('../src/components/RoomHighlightModal.tsx',import.meta.url),'utf8');
const tab=readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx',import.meta.url),'utf8');
const mode=readFileSync(new URL('../src/lib/roomSidecarDemoMode.ts',import.meta.url),'utf8');
check('UI read must verify server before revealing migrated room',()=>{
 for(const s of ['getDocFromServer(', 'getDocsFromServer(', 'overlayMigratedRoomSubItems(', 'if (!current)', 'updateMigratedRoomSubItemsProgressAtomic(', 'structureReadOnly'])assert.ok(bridge.includes(s),s);
});
check('modal waits for async transaction success before close',()=>{
 assert.ok(modal.includes('await onSaveRoom(roomData)'));
 assert.ok(modal.includes('await onSaveRoom({'));
 assert.ok(modal.includes('Không thể lưu tiến độ'));
});
check('UI bridge wired to real room editing entrypoint',()=>assert.ok(tab.includes('<RoomSidecarDemoBridge')&&tab.includes('projectId={currentProjectId}')));
check('requires explicit local demo opt-in, never PROD',()=>{
 for(const s of ['P21_LOCAL_EMULATOR_ONLY',"APP_ENVIRONMENT === 'DEV'",'FIREBASE_EMULATOR_ENABLED',"startsWith('demo-')",'ROOM_SIDECAR_REFUSES_NONLOCAL_OR_PROD_FIREBASE'])assert.ok(mode.includes(s),s);
});
console.log(`P21.6 ROOM SIDECAR UI DEMO GOLDEN ${passed}/${passed} PASS — DEMO ONLY; NOT LIVE DEV/PROD`);
