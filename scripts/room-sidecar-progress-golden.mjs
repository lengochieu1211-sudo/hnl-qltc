import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overlayMigratedRoomSubItems, validateRoomSidecarProgressPatch } from '../src/utils/roomSidecarProgressSafety.ts';
const baseRoom = {
  id: 'ROOM-1', roomName: 'test', subItemProgressMigrated: true,
  subItems: [
    { id: 'S1', name: 'KHUNG', status: 'Chưa làm', workVolume: 123, progressWeight: 50 },
    { id: 'S2', name: 'TẤM', status: 'Đang làm', workVolume: 456 },
  ],
};
const progress = [
  { id: 'S1', roomId: 'ROOM-1', projectId: 'P', status: 'Đã hoàn thành', revision: 2 },
  { id: 'S2', roomId: 'ROOM-1', projectId: 'P', status: 'Đang làm', revision: 3 },
];
const overlay = overlayMigratedRoomSubItems(baseRoom, 'P', progress);
assert.equal(overlay.subItems[0].status, 'Đã hoàn thành');
assert.equal(overlay.subItems[0].workVolume, 123);
assert.equal(overlay.subItems[0].name, 'KHUNG');
assert.equal(baseRoom.subItems[0].status, 'Chưa làm');
assert.equal('assignedTeam' in overlay.subItems[0], false, 'sidecar missing field must not fall back to embedded legacy');
assert.deepEqual(overlay.subItems.map(x=>x.id), ['S1','S2']);
const definitions = [
  { id: 'S1', projectId: 'P', roomId: 'ROOM-1', name: 'Khung mới do ADMIN đổi', order: 1,
    category: 'Trần', workVolume: 140, progressWeight: 60 },
  { id: 'S2', projectId: 'P', roomId: 'ROOM-1', name: 'Tấm mới', order: 0, workVolume: 480 },
];
const structuralOverlay = overlayMigratedRoomSubItems(baseRoom, 'P', progress, definitions);
assert.deepEqual(structuralOverlay.subItems.map(x => x.id), ['S2', 'S1']);
assert.equal(structuralOverlay.subItems[1].name, 'Khung mới do ADMIN đổi');
assert.equal(structuralOverlay.subItems[1].workVolume, 140);
assert.equal(structuralOverlay.subItems[1].status, 'Đã hoàn thành');
assert.equal(structuralOverlay.subItems[0].workVolume, 480);
assert.equal(baseRoom.subItems[0].name, 'KHUNG', 'realtime overlay must not mutate legacy source');
for (const bad of [
  definitions.slice(0,1),
  [definitions[0],definitions[0]],
  [{...definitions[0],id:'FORGED'},definitions[1]],
  [{...definitions[0],projectId:'OTHER'},definitions[1]],
  [{...definitions[0],roomId:'OTHER'},definitions[1]],
  [{...definitions[0],order:0},definitions[1]],
  [{...definitions[0],name:' '},definitions[1]],
  [{...definitions[0],workVolume:-2},definitions[1]],
]) assert.throws(() => overlayMigratedRoomSubItems(baseRoom,'P',progress,bad), /ROOM_SIDECAR_DEFINITION_PARITY/);
const legacyRoom = { ...baseRoom, subItemProgressMigrated: false };
assert.strictEqual(overlayMigratedRoomSubItems(legacyRoom, 'P', []), legacyRoom);
const mustThrow = (fn, code) => assert.throws(fn, e=>e.message.includes(code));
for (const bad of [
  [{...progress[0]}],
  [{...progress[0]}, {...progress[0]}],
  [{...progress[0], id:'FORGED'}, progress[1]],
  [{...progress[0], projectId:'OTHER'}, progress[1]],
  [{...progress[0], roomId:'OTHER'}, progress[1]],
]) mustThrow(()=>overlayMigratedRoomSubItems(baseRoom,'P',bad),'ROOM_SIDECAR_PARITY');
assert.deepEqual(validateRoomSidecarProgressPatch({ status:'Đang làm', assignedTeam:'Đội A' }),
  {status:'Đang làm',assignedTeam:'Đội A'});
for (const bad of [{name:'FORGED'},{workVolume:1},{id:'OTHER'},{status:'INVALID'},
  {status:undefined},{status:null},{targetDate:'tomorrow'}, {}, []]) {
  mustThrow(()=>validateRoomSidecarProgressPatch(bad),'ROOM_SIDECAR');
}
const rules = readFileSync('firestore.rules', 'utf8');
assert.match(rules,/match \/rooms\/\{roomId\}\/subitem_definitions\/\{subItemId\}/);
assert.match(rules,/match \/rooms\/\{roomId\}\/subitem_progress\/\{subItemId\}/);
assert.match(rules,/editorSubItemProgressUpdateSafe\(projectId, roomId, subItemId\)/);
assert.match(rules,/resource\.data\.get\('subItemProgressMigrated', false\) != true/);
assert.match(rules,/request\.resource\.data\.get\('subItems', \[\]\) == resource\.data\.get\('subItems', \[\]\)/);
console.log('P9 ROOM SIDECAR PRIVILEGE + PARITY GOLDEN: PASS (static/pure only; emulator REQUIRED)');
