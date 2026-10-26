/**
 * P12 – DEV COPY ONLY. Server-authoritative, single-room atomic migration.
 * Reads legacy room and all targeted sidecars inside ONE Firestore transaction;
 * the migration marker is committed together with definitions/progress.
 * Never rewrites embedded legacy subItems, IDs, images or unrelated fields.
 * Never auto-runs; caller must explicitly approve and project must be a marked DEV copy.
 */
import { createHash } from 'node:crypto';
import { assertWarehouseRole } from './security.mjs';

const DEFINITION = ['name','category','workCategoryId','workVolume','volumeUnit','progressWeight'];
const PROGRESS = ['status','inspectionStatus','targetDate','assignedTeam','teamId'];
const ALLOWED = new Set(['id',...DEFINITION,...PROGRESS]);
const WORK = new Set(['Chưa làm','Đang làm','Đã hoàn thành']);
const INSPECT = new Set(['Chưa nghiệm thu','Đạt nghiệm thu','Chưa đạt (Cần sửa)']);
const validId = x => typeof x === 'string' && x !== '.' && x !== '..' && x !== ''
  && x.trim() === x && !x.includes('/') && !/^__.*__$/.test(x) && Buffer.byteLength(x,'utf8')<=1500;
const fail = code => {throw new Error(code);};
const take = (source,fields) => Object.fromEntries(fields.filter(k=>Object.hasOwn(source,k)).map(k=>[k,source[k]]));
const canonical = obj => JSON.stringify(obj, (_key,item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item);
const digest = obj => createHash('sha256').update(canonical(obj)).digest('hex');
export function validateLegacyRoomForMigration(room) {
  if (!room || typeof room !== 'object' || Array.isArray(room) || room.deleted === true || room.deletedAt != null)
    fail('ROOM_MIGRATION_INACTIVE');
  if (room.subItemProgressMigrated === true) fail('ROOM_MIGRATION_ALREADY_DONE');
  if (!validId(room.id) || !Array.isArray(room.subItems) || !room.subItems.length || room.subItems.length > 60)
    fail('ROOM_MIGRATION_INVALID_SOURCE');
  if (!Number.isSafeInteger(room.revision) || room.revision < 0 || !Number.isFinite(room.updatedAt))
    fail('ROOM_MIGRATION_UNVERSIONED_SOURCE');
  const seen = new Set();
  const items = room.subItems.map((sub,order) => {
    if (!sub || typeof sub !== 'object' || Array.isArray(sub) || !validId(sub.id) || seen.has(sub.id))
      fail('ROOM_MIGRATION_INVALID_SUBITEM_ID');
    seen.add(sub.id);
    if (Object.keys(sub).some(k=>!ALLOWED.has(k)) || typeof sub.name!=='string' || !sub.name.trim() || sub.name.length>500 ||
        !WORK.has(sub.status) || (sub.inspectionStatus !== undefined && !INSPECT.has(sub.inspectionStatus)))
      fail('ROOM_MIGRATION_UNSAFE_SUBITEM');
    for (const k of ['category','workCategoryId','volumeUnit','targetDate','assignedTeam','teamId']) {
      if (Object.hasOwn(sub,k) && (typeof sub[k]!=='string' || sub[k].length>1000)) fail('ROOM_MIGRATION_UNSAFE_SUBITEM');
    }
    for (const k of ['workVolume','progressWeight']) {
      if (sub[k]!==undefined && (typeof sub[k]!=='number'||!Number.isFinite(sub[k])||sub[k]<0)) fail('ROOM_MIGRATION_UNSAFE_SUBITEM');
    }
    if (sub.targetDate!==undefined && sub.targetDate!=='' && !/^\d{4}-\d{2}-\d{2}$/.test(sub.targetDate))
      fail('ROOM_MIGRATION_UNSAFE_SUBITEM');
    return {id:sub.id,definition:{order,...take(sub,DEFINITION)},progress:take(sub,PROGRESS)};
  });
  return {items,sourceHash:digest(room.subItems)};
}
const ref = (db,...segments) => db.doc(segments.join('/'));
const read = async (tx,r) => {const s=await tx.get(r);return {exists:s.exists,data:s.exists?s.data():null};};
export async function migrateDevCopiedRoom({db,actor,projectId,roomId,approval}) {
  if (!db || !actor || !validId(projectId) || !validId(roomId) || approval !== 'MIGRATE-VERIFIED-DEV-COPY')
    fail('ROOM_MIGRATION_NOT_APPROVED');
  const root=`projects/${projectId}`;
  const email=String(actor.email||'').trim().toLowerCase();
  return db.runTransaction(async tx=>{
    const [project,emailMembership,uidMembership,room] = await Promise.all([
      read(tx,ref(db,root)),read(tx,ref(db,root,'members',email)),
      read(tx,ref(db,root,'members',actor.uid)),read(tx,ref(db,root,'rooms',roomId)),
    ]);
    if (!project.exists || !room.exists) fail('ROOM_MIGRATION_SOURCE_MISSING');
    assertWarehouseRole({project:project.data,emailMembership:emailMembership.exists?emailMembership.data:null,
      uidMembership:uidMembership.exists?uidMembership.data:null,actor,permission:'ADMIN'});
    if (project.data.migrationSandbox !== true || project.data.migrationSource !== 'DEV_COPY')
      fail('ROOM_MIGRATION_NOT_ISOLATED_DEV_COPY');
    if (room.data.id !== roomId || (room.data.projectId && room.data.projectId!==projectId))
      fail('ROOM_MIGRATION_SOURCE_ID_MISMATCH');
    const {items,sourceHash}=validateLegacyRoomForMigration(room.data);
    // Full collection checks prevent an orphan/extra sidecar from slipping past
    // per-subitem reads and becoming an incorrectly marked migrated room.
    const [existingDefinitions,existingProgress]=await Promise.all([
      tx.get(db.collection(`${root}/rooms/${roomId}/subitem_definitions`)),
      tx.get(db.collection(`${root}/rooms/${roomId}/subitem_progress`)),
    ]);
    if (!existingDefinitions.empty || !existingProgress.empty)
      fail('ROOM_MIGRATION_PREEXISTING_SIDECAR');
    const sidecars=await Promise.all(items.map(async item=>{
      const base=[root,'rooms',roomId];
      const d=ref(db,...base,'subitem_definitions',item.id);
      const p=ref(db,...base,'subitem_progress',item.id);
      const [ds,ps]=await Promise.all([read(tx,d),read(tx,p)]);
      if (ds.exists || ps.exists) fail('ROOM_MIGRATION_PARTIAL_OR_PRIOR_SEED');
      return {item,d,p};
    }));
    // Reads must finish before any writes to satisfy Firestore transaction semantics.
    const now=Math.max(Date.now(),Number(room.data.updatedAt||0)+1);
    for(const {item,d,p} of sidecars){
      const identity={id:item.id,projectId,roomId};
      tx.create(d,{...identity,...item.definition});
      tx.create(p,{...identity,...item.progress,revision:1,updatedAt:now,updatedByUid:actor.uid});
    }
    tx.update(ref(db,root,'rooms',roomId),{
      subItemProgressMigrated:true,subItemProgressMigratedAt:now,
      subItemProgressMigratedByUid:actor.uid,subItemProgressSourceHash:sourceHash,
      subItemProgressSourceRevision:room.data.revision,
      updatedAt:now,updatedByUid:actor.uid,revision:room.data.revision+1,
    });
    return {roomId,definitions:items.length,progress:items.length,sourceHash,revision:room.data.revision+1};
  },{maxAttempts:5});
}