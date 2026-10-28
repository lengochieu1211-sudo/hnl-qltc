/**
 * HNL QLTC P11 — NO-WRITE, offline DEV room sidecar parity audit.
 * Compare an ADMIN-exported, SAME-INSTANT, complete room snapshot and seeded
 * definitions/progress before marking a room migrated. No Firebase credentials,
 * no live writes; no private room/team names appear in CLI output.
 * Usage: node scripts/room-sidecar-seed-parity.mjs --project DEV_PROJECT --input LOCAL_PRIVATE_SNAPSHOT.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planRoomSubItemMigration } from './room-subitem-migration-plan.mjs';

const sorted = value => JSON.stringify(value, (key,item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item);
const recordMap=(rows,type)=>{
  if (!Array.isArray(rows)) throw new Error('INVALID_SIDECAR_SNAPSHOT_'+type);
  const map=new Map();
  for(const row of rows){
    const path=row?.path;
    if(typeof path!=='string' || !path || map.has(path) || typeof row?.data !== 'object' || !row.data || Array.isArray(row.data))
      throw new Error('INVALID_SIDECAR_ROW_'+type);
    map.set(path,row.data);
  }
  return map;
};
const equality=(expected,actual,fields)=>fields.every(k=>sorted(expected[k])===sorted(actual[k]));
export function auditRoomSidecarSeedParity(snapshot,projectId) {
  if(!snapshot || typeof snapshot!=='object'||Array.isArray(snapshot)) throw new Error('INVALID_AUDIT_SNAPSHOT');
  const plan=planRoomSubItemMigration(snapshot.rooms,{projectId});
  if(plan.status!=='PLAN_READY_FOR_SERVER_VALIDATION') return {status:'BLOCKED',reason:'SOURCE_ROOM_PLAN_INVALID',counts:plan.counts};
  const definitions=recordMap(snapshot.definitions,'DEFINITION');
  const progress=recordMap(snapshot.progress,'PROGRESS');
  const errors=[];
  const check=(expected,actual,fields,type)=>{
    if(actual.size!==expected.length) errors.push(type+'_COUNT_MISMATCH');
    for(const entry of expected){
      const result=actual.get(entry.path);
      if(!result) {errors.push(type+'_MISSING');continue;}
      if(!equality(entry.data,result,fields))errors.push(type+'_DATA_MISMATCH');
      if(type==='PROGRESS' && (!Number.isSafeInteger(result.revision) || result.revision<1))
        errors.push('PROGRESS_UNVERSIONED');
    }
    const allowed=new Set(expected.map(entry=>entry.path));
    if([...actual.keys()].some(key=>!allowed.has(key)))errors.push(type+'_UNEXPECTED_PATH');
  };
  check(plan.definitions,definitions,['id','projectId','roomId','order','name','category','workCategoryId','workVolume','volumeUnit','progressWeight'],'DEFINITION');
  check(plan.progress,progress,['id','projectId','roomId','status','inspectionStatus','targetDate','assignedTeam','teamId'],'PROGRESS');
  const marked=snapshot.rooms.some(room=>room?.subItemProgressMigrated===true);
  if(marked)errors.push('ROOM_ALREADY_MARKED_MIGRATED');
  return {
    status:errors.length?'BLOCKED':'SEED_PARITY_PASS_OFFLINE_ONLY',
    counts:{rooms:plan.counts.activeRooms,definitions:definitions.size,progress:progress.size,errors:errors.length},
    errorCodes:[...new Set(errors)].sort(),
    planDigest:plan.payloadDigest,
    // This does NOT establish server provenance, Cloud snapshot atomicity,
    // replay safety, permissions or migration marker readiness.
    note:'Offline parity only. Mandatory fresh server re-read, Rules Emulator and ADMIN migration transaction before any marker flip.',
  };
}
function main(){
  const args=process.argv.slice(2);
  if(args.length!==4 || args[0]!=='--project'||args[2]!=='--input'){
    console.error('Usage: node scripts/room-sidecar-seed-parity.mjs --project ID --input LOCAL_PRIVATE_SNAPSHOT.json');return 1;
  }
  try{
    const snapshot=JSON.parse(readFileSync(resolve(args[3]),'utf8'));
    const result=auditRoomSidecarSeedParity(snapshot,args[1]);
    console.log(JSON.stringify(result,null,2));
    return result.status==='BLOCKED'?2:0;
  }catch(err){console.error('PARITY_ABORTED:',String(err.message||err).split('\n')[0]);return 1;}
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1]))process.exitCode=main();
