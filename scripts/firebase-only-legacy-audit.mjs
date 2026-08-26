import fs from 'node:fs';
import path from 'node:path';

const aliases = {
  floorPlans: ['floorPlans','floor_plans','floors','construction_floor_plans'],
  rooms: ['roomProgressList','roomProgress','room_progress','rooms','construction_room_progress'],
  defects: ['defects','defectList','defectsList','construction_defects'],
  workVolumes: ['workVolumes','work_volumes','volumes','construction_work_volumes'],
  checklist: ['checklist','checklists','checklistItems','construction_checklist'],
  crewRecords: ['crewRecords','crew_records','construction_crew_records'],
  inventory: ['inventory','inventoryList','construction_inventory'],
  materialNorms: ['materialNorms','material_norms','norms','construction_material_norms'],
  teams: ['teams','teamList','construction_teams'],
  photos: ['photos','photoAttachments','photo_attachments'],
};

function firstArray(obj, keys) {
  if (!obj || typeof obj !== 'object') return [];
  for (const k of keys) if (Array.isArray(obj[k])) return obj[k];
  if (obj.data && typeof obj.data === 'object') {
    for (const k of keys) if (Array.isArray(obj.data[k])) return obj.data[k];
  }
  if (obj.payload && typeof obj.payload === 'object') {
    for (const k of keys) if (Array.isArray(obj.payload[k])) return obj.payload[k];
  }
  return [];
}

function active(row) { return row && row.deleted !== true && row.deletedAt == null; }
function idSet(rows) { return new Set(rows.filter(active).map(x => String(x?.id || '')).filter(Boolean)); }
function duplicateIds(rows) {
  const seen = new Set(); const dup = [];
  for (const r of rows) { const id = String(r?.id || ''); if (!id) continue; if (seen.has(id)) dup.push(id); else seen.add(id); }
  return [...new Set(dup)];
}
function badTimestamp(v) {
  if (v == null || v === '') return false;
  if (typeof v === 'number') return !Number.isFinite(v) || v < 0;
  if (typeof v === 'string') return !Number.isFinite(Date.parse(v)) && !/^\d+$/.test(v);
  if (typeof v === 'object' && ('seconds' in v || '_seconds' in v)) return false;
  return true;
}

export function auditLegacyProject(input) {
  const collections = Object.fromEntries(Object.entries(aliases).map(([name, keys]) => [name, firstArray(input, keys)]));
  const floorIds = idSet(collections.floorPlans);
  const roomIds = idSet(collections.rooms);
  const categoryIds = idSet(collections.workVolumes);
  const defectIds = idSet(collections.defects);
  const crewIds = idSet(collections.crewRecords);
  const issues = [];
  const stats = {};

  for (const [name, rows] of Object.entries(collections)) {
    stats[name] = { total: rows.length, active: rows.filter(active).length, deleted: rows.filter(r => !active(r)).length };
    const missing = rows.filter(r => !r?.id).length;
    if (missing) issues.push({ code:'MISSING_ID', collection:name, count:missing });
    const dup = duplicateIds(rows);
    if (dup.length) issues.push({ code:'DUPLICATE_ID', collection:name, count:dup.length, ids:dup.slice(0,20) });
    const missingDeletedAt = rows.filter(r => !('deletedAt' in (r || {}))).length;
    if (missingDeletedAt) issues.push({ code:'LEGACY_MISSING_DELETED_AT', collection:name, count:missingDeletedAt, severity:'REVIEW' });
    const missingCreatedAt = rows.filter(r => !('createdAt' in (r || {}))).length;
    if (missingCreatedAt) issues.push({ code:'LEGACY_MISSING_CREATED_AT', collection:name, count:missingCreatedAt, severity:'REVIEW' });
    const badTimes = rows.filter(r => badTimestamp(r?.createdAt) || badTimestamp(r?.updatedAt) || badTimestamp(r?.deletedAt)).length;
    if (badTimes) issues.push({ code:'BAD_TIMESTAMP_TYPE', collection:name, count:badTimes });
  }

  const orphanRooms = collections.rooms.filter(r => active(r) && r.floorId && !floorIds.has(String(r.floorId)));
  if (orphanRooms.length) issues.push({ code:'ORPHAN_ROOM_FLOOR', collection:'rooms', count:orphanRooms.length, ids:orphanRooms.slice(0,20).map(x=>x.id) });
  const orphanDefectRoom = collections.defects.filter(d => active(d) && d.roomId && !roomIds.has(String(d.roomId)));
  if (orphanDefectRoom.length) issues.push({ code:'ORPHAN_DEFECT_ROOM', collection:'defects', count:orphanDefectRoom.length, ids:orphanDefectRoom.slice(0,20).map(x=>x.id) });
  const orphanDefectFloor = collections.defects.filter(d => active(d) && d.floorId && !d.archivedFloorId && !floorIds.has(String(d.floorId)));
  if (orphanDefectFloor.length) issues.push({ code:'ORPHAN_DEFECT_FLOOR', collection:'defects', count:orphanDefectFloor.length, ids:orphanDefectFloor.slice(0,20).map(x=>x.id) });

  const deletedCategoryIds = new Set(collections.workVolumes.filter(r => !active(r)).map(r => String(r?.id || '')).filter(Boolean));
  let deletedCategoryRefs = 0;
  for (const room of collections.rooms) {
    if (!active(room)) continue;
    if (room.workCategoryId && deletedCategoryIds.has(String(room.workCategoryId))) deletedCategoryRefs++;
    for (const sub of Array.isArray(room.subItems) ? room.subItems : []) if (sub?.workCategoryId && deletedCategoryIds.has(String(sub.workCategoryId))) deletedCategoryRefs++;
  }
  if (deletedCategoryRefs) issues.push({ code:'DELETED_CATEGORY_REFERENCED', collection:'rooms', count:deletedCategoryRefs, severity:'REVIEW' });

  const orphanPhotos = collections.photos.filter(p => {
    if (!active(p)) return false;
    if (p.entityType === 'defect') return !defectIds.has(String(p.entityId || ''));
    if (p.entityType === 'crewRecord') return !crewIds.has(String(p.entityId || ''));
    return false;
  });
  if (orphanPhotos.length) issues.push({ code:'ORPHAN_PHOTO', collection:'photos', count:orphanPhotos.length, ids:orphanPhotos.slice(0,20).map(x=>x.id) });

  const drivePhotos = collections.photos.filter(p => active(p) && (String(p.storageProvider || '').includes('drive') || String(p.cloudFileId || '').startsWith('drive:') || p.driveFileId));
  const storagePhotos = collections.photos.filter(p => active(p) && (p.storagePath || p.storageProvider === 'firebase-storage'));
  stats.binaryMigration = { legacyDriveReferences: drivePhotos.length, firebaseStorageReferences: storagePhotos.length };
  if (drivePhotos.length) issues.push({ code:'DRIVE_BINARY_MIGRATION_REQUIRED', collection:'photos', count:drivePhotos.length, severity:'BLOCKED_UNTIL_CHECKSUM' });

  const project = input?.project || input;
  if (!project?.ownerUid) issues.push({ code:'PROJECT_MISSING_OWNER_UID', collection:'project', count:1, severity:'REVIEW' });
  if (!project?.createdAt) issues.push({ code:'PROJECT_MISSING_CREATED_AT', collection:'project', count:1, severity:'REVIEW' });

  return { projectId: String(project?.projectId || project?.id || input?.projectId || 'unknown'), stats, issues };
}

function selfTest() {
  const sample = {
    id:'proj-self-test', ownerUid:'u1', createdAt:1,
    floorPlans:[{id:'F1',createdAt:1,updatedAt:2,deletedAt:null}],
    roomProgressList:[{id:'R1',floorId:'F1',createdAt:1,updatedAt:2,deletedAt:null},{id:'R2',floorId:'MISSING',createdAt:1,updatedAt:2,deletedAt:null}],
    workVolumes:[{id:'W1',createdAt:1,updatedAt:2,deletedAt:null},{id:'W2',createdAt:1,updatedAt:3,deleted:true,deletedAt:3}],
    defects:[{id:'D1',roomId:'R1',floorId:'F1',createdAt:1,updatedAt:2,deletedAt:null},{id:'D2',roomId:'NO',floorId:'F1',createdAt:1,updatedAt:2,deletedAt:null}],
    crewRecords:[{id:'C1',createdAt:1,updatedAt:2,deletedAt:null}],
    inventory:[{id:'I1',createdAt:1,updatedAt:2,deletedAt:null}], checklist:[], materialNorms:[], teams:[],
    photos:[{id:'P1',entityType:'defect',entityId:'D1',storageProvider:'google-drive-primary',driveFileId:'x',createdAt:1,updatedAt:2,deletedAt:null}],
  };
  const result = auditLegacyProject(sample);
  const codes = new Set(result.issues.map(i=>i.code));
  for (const expected of ['ORPHAN_ROOM_FLOOR','ORPHAN_DEFECT_ROOM','DRIVE_BINARY_MIGRATION_REQUIRED']) {
    if (!codes.has(expected)) throw new Error(`self-test missing ${expected}`);
  }
  console.log('LEGACY MIGRATION AUDIT SELF-TEST PASS');
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();
else if (args[0]) {
  const inputPath = path.resolve(args[0]);
  const data = JSON.parse(fs.readFileSync(inputPath,'utf8'));
  const candidates = Array.isArray(data?.projects) ? data.projects : [data];
  const report = { generatedAt:new Date().toISOString(), sourceFile:inputPath, projects:candidates.map(auditLegacyProject) };
  const out = args[1] ? path.resolve(args[1]) : `${inputPath}.migration-audit.json`;
  fs.writeFileSync(out, JSON.stringify(report,null,2));
  console.log(`Legacy migration dry-run audit written: ${out}`);
} else {
  console.error('Usage: node scripts/firebase-only-legacy-audit.mjs --self-test | <backup.json> [report.json]');
  process.exit(2);
}
