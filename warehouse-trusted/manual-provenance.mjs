/**
 * DEV trusted-writer reference boundary. Client-supplied provenance is NEVER
 * accepted as an authority for room, floor, norm or team reports.
 *
 * Intentionally fail-closed on IDs which cannot be checked by exact document
 * identity. Legacy aliases need their own reviewed migration, not a guess.
 * All reads run INSIDE the voucher transaction before any writes.
 */

const fail = code => { throw new Error(code); };
const active = row => row && row.deleted !== true && row.deletedAt == null;
const refValue = x => typeof x === 'string' && x.trim() === x && x.length > 0 && x.length <= 300 &&
  !x.includes('/') && x !== '.' && x !== '..' && !x.startsWith('__');
const normalizeName = x => String(x || '').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g,' ');
const normMatchesMaterial = (norm,item) => {
  if(item.itemKind === 'equipment') return false;
  if (!item.materialId || !norm.materialId || item.materialId !== norm.materialId) return false;
  return normalizeName(norm.materialName) === normalizeName(item.materialName) && norm.unit === item.unit;
};

export async function assertManualProvenance({ db,tx,root,item }) {
  if (!item || item.sourceType && item.sourceType !== 'manual') fail('WAREHOUSE_PROVENANCE_INVALID_SOURCE');
  // Deterministic room receipt IDs and keys belong EXCLUSIVELY to the
  // dedicated server automation. Manual writers must never claim them.
  if (item.sourceIssueKey !== undefined) fail('WAREHOUSE_PROVENANCE_SYSTEM_KEY_FORBIDDEN');
  const fields = ['sourceRoomId','sourceFloorId','sourceNormId','sourceWorkCategoryId','sourceTeamId','sourceStructureGroupId'];
  const supplied = fields.filter(k => item[k] !== undefined);
  if (!supplied.length) return;
  if (item.type !== 'out') fail('WAREHOUSE_PROVENANCE_OUT_ONLY');
  if (supplied.some(k => !refValue(item[k]))) fail('WAREHOUSE_PROVENANCE_INVALID_REF');
  if (item.sourceRoomId && !item.sourceFloorId)
    fail('WAREHOUSE_PROVENANCE_ROOM_FLOOR_REQUIRED');
  if (item.sourceNormId && !item.sourceWorkCategoryId)
    fail('WAREHOUSE_PROVENANCE_NORM_CATEGORY_REQUIRED');
  if (item.sourceStructureGroupId && !item.sourceFloorId)
    fail('WAREHOUSE_PROVENANCE_GROUP_FLOOR_REQUIRED');
  const lookups = [
    ['room','sourceRoomId','rooms'],['floor','sourceFloorId','floor_plans'],
    ['norm','sourceNormId','material_norms'],['work','sourceWorkCategoryId','work_volumes'],
    ['team','sourceTeamId','teams'],
  ].filter(([,field])=>item[field]);
  const snapshots=await Promise.all(lookups.map(async ([key,field,col])=>{
    const snap=await tx.get(db.doc(`${root}/${col}/${item[field]}`));
    return [key, snap.exists?snap.data():null];
  }));
  const records=Object.fromEntries(snapshots);
  for (const [key,row] of snapshots){
    if (!active(row)) fail('WAREHOUSE_PROVENANCE_REFERENCE_NOT_FOUND_'+key.toUpperCase());
  }
  if (records.room && (records.room.id !== item.sourceRoomId || records.room.floorId !== item.sourceFloorId))
    fail('WAREHOUSE_PROVENANCE_ROOM_FLOOR_MISMATCH');
  if (records.floor && records.floor.id !== item.sourceFloorId)
    fail('WAREHOUSE_PROVENANCE_FLOOR_ID_MISMATCH');
  if (records.norm && (records.norm.id !== item.sourceNormId || !normMatchesMaterial(records.norm,item)))
    fail('WAREHOUSE_PROVENANCE_NORM_MATERIAL_MISMATCH');
  if (records.work && (records.work.id !== item.sourceWorkCategoryId && records.work.workCategoryId !== item.sourceWorkCategoryId))
    fail('WAREHOUSE_PROVENANCE_CATEGORY_ID_MISMATCH');
  if (records.norm && records.work) {
    const refs = new Set([records.norm.workCategoryId,...(records.norm.workCategoryIds||[])].filter(Boolean));
    if (!refs.has(item.sourceWorkCategoryId) && !refs.has(records.work.id) &&
        !refs.has(records.work.workCategoryId))
      fail('WAREHOUSE_PROVENANCE_NORM_CATEGORY_MISMATCH');
  }
  if (records.room && records.work) {
    const known = new Set([
      records.room.workCategoryId,
      ...Object.keys(records.room.categoryVolumes||{}),
      ...(records.room.subItems||[]).map(s=>s?.workCategoryId),
    ].filter(Boolean));
    if (!known.has(item.sourceWorkCategoryId) && !known.has(records.work.id) &&
        !known.has(records.work.workCategoryId))
      fail('WAREHOUSE_PROVENANCE_ROOM_CATEGORY_MISMATCH');
  }
  if (records.team && records.team.id !== item.sourceTeamId)
    fail('WAREHOUSE_PROVENANCE_TEAM_ID_MISMATCH');
  if (records.room && records.team) {
    const assigned = new Set([records.room.teamId,...(records.room.subItems||[]).map(s=>s?.teamId)].filter(Boolean));
    // An explicit room team relationship is authoritative. Without any team
    // assignment the manual voucher must not fabricate an allocation.
    if (!assigned.has(item.sourceTeamId)) fail('WAREHOUSE_PROVENANCE_TEAM_ROOM_MISMATCH');
  }
  if (item.sourceStructureGroupId) {
    if (!records.floor?.structureGroupId || records.floor.structureGroupId !== item.sourceStructureGroupId)
      fail('WAREHOUSE_PROVENANCE_STRUCTURE_GROUP_MISMATCH');
  }
}
