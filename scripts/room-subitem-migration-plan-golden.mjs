import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { planRoomSubItemMigration } from './room-subitem-migration-plan.mjs';

const pid = 'DEMO-PROJ';
const room = (id = 'A101') => ({ id, updatedAt: 12, revision: 2, roomName: 'PRIVATE', subItems: [
  { id: 'frame', name: 'Khung', status: 'Đang làm', inspectionStatus: 'Chưa nghiệm thu', workVolume: 32, volumeUnit: 'm²', assignedTeam: 'PRIVATE', targetDate: '2026-11-01' },
  { id: 'board', name: 'Tấm', status: 'Chưa làm', workVolume: 32, progressWeight: 2 },
] });
let checks = 0;
function ok(name, test) { test(); checks += 1; console.log('PASS '+name); }
const input = { roomProgressList: [room(), room('A102')] };
const snapshot = JSON.stringify(input);
const success = planRoomSubItemMigration(input, { projectId: pid });
ok('strict no-cloud plan preserves all records', () => {
  assert.equal(success.status, 'PLAN_READY_FOR_SERVER_VALIDATION');
  assert.equal(success.counts.definitions, 4);
  assert.equal(success.counts.progress, 4);
  assert.equal(JSON.stringify(input), snapshot);
  const frameDef = success.definitions.find(d => d.data.roomId === 'A101' && d.data.id === 'frame');
  const frameProgress = success.progress.find(d => d.data.roomId === 'A101' && d.data.id === 'frame');
  assert.deepEqual(Object.keys(frameDef.data).sort(), ['id','name','order','projectId','roomId','volumeUnit','workVolume'].sort());
  assert.deepEqual(Object.keys(frameProgress.data).sort(), ['assignedTeam','id','inspectionStatus','projectId','roomId','status','targetDate'].sort());
});
ok('stable identity is scoped by project and room, no composite ID collisions', () => {
  assert.notEqual(success.definitions[0].path, success.definitions[2].path);
  assert.ok(success.definitions.every(r => r.path.startsWith(`projects/${pid}/rooms/`)));
  assert.equal(new Set(success.definitions.map(r=>r.path)).size, 4);
});
ok('deterministic across different export row order', () => {
  const reversed = planRoomSubItemMigration([...input.roomProgressList].reverse(), {projectId:pid});
  assert.equal(reversed.payloadDigest, success.payloadDigest);
});
for (const [name, input2, code] of [
  ['duplicate same-room subItem ID', [{...room(),subItems:[room().subItems[0],room().subItems[0]]}], 'DUPLICATE_SUBITEM_ID'],
  ['missing legacy subItem ID', [{...room(),subItems:[{name:'old',status:'Chưa làm'}]}], 'INVALID_SUBITEM_ID'],
  ['path escape subItem ID', [{...room(),subItems:[{id:'../bad',name:'x',status:'Chưa làm'}]}], 'INVALID_SUBITEM_ID'],
  ['invalid structural quantity', [{...room(),subItems:[{id:'x',name:'x',status:'Chưa làm',workVolume:-7}]}], 'INVALID_WORKVOLUME'],
  ['unsupported status', [{...room(),subItems:[{id:'x',name:'x',status:'unknown'}]}], 'INVALID_SUBITEM_STATUS'],
  ['duplicate room ID', [room(),room()], 'DUPLICATE_ROOM_ID'],
  ['cross-project snapshot', [{...room(),projectId:'OTHER'}], 'PROJECT_SCOPE_MISMATCH'],
  ['invalid subItems map', [{...room(),subItems:{a:1}}], 'INVALID_SUBITEM_ARRAY'],
  ['unknown custom subItem field never silently discarded', [{...room(),subItems:[{id:'x',name:'x',status:'Chưa làm',customRate:10}]}], 'UNRECOGNIZED_SUBITEM_FIELDS'],
  ['malformed keyed room value not made into empty room', {byRoomId:{A101:'corrupt'}}, 'INVALID_ROOM'],
]) {
  ok(`fail closed: ${name}`, () => { const result=planRoomSubItemMigration(input2,{projectId:pid}); assert.equal(result.status,'BLOCKED'); assert.ok(result.issues.some(i=>i.code===code)); assert.deepEqual(result.definitions,[]);assert.deepEqual(result.progress,[]); });
}
ok('preserve deleted room as tombstone, do not resurrect',()=>{ const r=planRoomSubItemMigration([room(),{...room('A999'),deletedAt:321}],{projectId:pid}); assert.equal(r.counts.deletedRooms,1);assert.equal(r.counts.definitions,2); });
ok('empty dataset fails instead of green parity',()=>{assert.equal(planRoomSubItemMigration([],{projectId:pid}).status,'BLOCKED');});
ok('legacy room missing revision is reportable, not silently rewritten',()=>{const r=planRoomSubItemMigration([{...room(),revision:undefined}],{projectId:pid});assert.equal(r.counts.warnings,1);});
ok('CLI never prints private content or exports blocked plan',()=>{
  const d=mkdtempSync(join(tmpdir(),'hnl-migrate-'));
  try {
    const file=join(d,'source.json'),out=join(d,'plan.json');
    writeFileSync(file,JSON.stringify({rooms:[room()]}));
    const good=spawnSync(process.execPath,['scripts/room-subitem-migration-plan.mjs','--project',pid,'--input',file],{cwd:resolve('.'),encoding:'utf8'});
    assert.equal(good.status,0,good.stderr);assert.doesNotMatch(good.stdout,/PRIVATE/);assert.doesNotMatch(good.stdout,/Khung/);
    writeFileSync(file,JSON.stringify({rooms:[{...room(),subItems:[{name:'bad',status:'Chưa làm'}]}]}));
    const bad=spawnSync(process.execPath,['scripts/room-subitem-migration-plan.mjs','--project',pid,'--input',file,'--output',out],{cwd:resolve('.'),encoding:'utf8'});
    assert.equal(bad.status,2);assert.equal(existsSync(out),false);
  } finally { rmSync(d,{recursive:true,force:true}); }
});
console.log(`ROOM SUBITEM MIGRATION GOLDEN: ${checks}/${checks} PASS (OFFLINE ONLY)`);
