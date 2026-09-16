import fs from 'node:fs';

const projectId = process.env.PROD_FIREBASE_PROJECT_ID || 'com-example-qlct-61329';
const token = process.env.GOOGLE_ACCESS_TOKEN || '';
if (!token) throw new Error('GOOGLE_ACCESS_TOKEN is required');
const dbId = '(default)';
const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(dbId)}/documents`;
const outFile = process.argv[2] || 'prod-live-legacy-audit-summary.json';

const decode = (v) => {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('bytesValue' in v) return '[bytes]';
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
};
const decodeFields = (fields = {}) => Object.fromEntries(Object.entries(fields).map(([k,v]) => [k, decode(v)]));
const escPath = (path) => path.split('/').map(encodeURIComponent).join('/');
const docId = (name) => String(name || '').split('/').pop() || '';

async function request(url) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${await res.text()}`);
  return res.json();
}

async function listCollection(path) {
  const out = [];
  let pageToken = '';
  do {
    const url = new URL(`${base}/${escPath(path)}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const json = await request(url.toString());
    for (const d of json.documents || []) out.push({ id: docId(d.name), ...decodeFields(d.fields || {}) });
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return out;
}

const active = (x) => x && x.deleted !== true && (x.deletedAt === undefined || x.deletedAt === null || x.deletedAt === '');
const norm = (x) => String(x ?? '').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ');
const floorIdsForWork = (w) => [...new Set([w?.floorId, ...(Array.isArray(w?.floorIds) ? w.floorIds : [])].map(x => String(x || '').trim()).filter(Boolean))];
const workApplies = (w, room) => {
  const ids = floorIdsForWork(w);
  const roomFloorId = String(room?.floorId || '').trim();
  if (ids.length) return Boolean(roomFloorId && ids.includes(roomFloorId));
  const wf = norm(w?.floor);
  if (!wf || ['tất cả','toàn nhà','công trình','all'].includes(wf)) return true;
  const rf = norm(room?.floorName);
  if (!rf) return false;
  return wf.split(/[,;\n]+/).map(norm).filter(Boolean).includes(rf);
};
const containsDriveRef = (obj) => {
  const s = JSON.stringify(obj || {});
  return /driveFileId|google-drive-primary|drive\.google\.com|"cloudFileId"\s*:\s*"drive:/i.test(s);
};

const projects = await listCollection('projects');
const canonicalCollections = ['rooms','inventory','defects','work_volumes','floor_plans','checklist','crew_records','teams','material_norms','work_volume_financials','photos','members'];
const summary = {
  generatedAt: new Date().toISOString(),
  firebaseProjectId: projectId,
  projectCount: projects.filter(active).length,
  schemaVersionHistogram: {},
  pendingSchemaMigrationProjects: 0,
  futureSchemaProjects: 0,
  projectMissingOwnerUid: 0,
  projectMissingCreatedAt: 0,
  totals: Object.fromEntries(canonicalCollections.map(k => [k, 0])),
  linkage: {
    roomsMissingFloorNameButHaveFloorId: 0,
    orphanRoomFloor: 0,
    orphanDefectRoom: 0,
    orphanDefectFloor: 0,
    orphanRoomWorkCategoryId: 0,
    roomWorkCategoryScopeMismatch: 0,
    orphanRoomTeamId: 0,
    orphanMaterialNormWorkCategoryId: 0,
    workVolumeInlineUnitPrice: 0,
    financialRows: 0,
    financialConflictCount: 0,
    legacyDriveReferenceDocuments: 0,
  },
  blockerCount: 0,
  reviewCount: 0,
};

for (const project of projects.filter(active)) {
  const schema = Number(project.dataSchemaVersion || 0) || 0;
  summary.schemaVersionHistogram[String(schema)] = (summary.schemaVersionHistogram[String(schema)] || 0) + 1;
  if (schema < 6) summary.pendingSchemaMigrationProjects++;
  if (schema > 6) summary.futureSchemaProjects++;
  if (!project.ownerUid) summary.projectMissingOwnerUid++;
  if (!project.createdAt) summary.projectMissingCreatedAt++;

  const data = {};
  for (const c of canonicalCollections) {
    data[c] = await listCollection(`projects/${project.id}/${c}`).catch(() => []);
    summary.totals[c] += data[c].length;
  }
  const floors = new Set(data.floor_plans.filter(active).map(x => String(x.id || '')).filter(Boolean));
  const rooms = data.rooms.filter(active);
  const roomIds = new Set(rooms.map(x => String(x.id || '')).filter(Boolean));
  const workVolumes = data.work_volumes.filter(active);
  const workById = new Map();
  for (const w of workVolumes) {
    for (const key of [w.id, w.workCategoryId]) if (key) workById.set(String(key), w);
    if (w.unitPrice !== undefined && w.unitPrice !== null) summary.linkage.workVolumeInlineUnitPrice++;
  }
  const teams = new Set(data.teams.filter(active).map(x => String(x.id || '')).filter(Boolean));
  const financial = new Map(data.work_volume_financials.filter(active).map(x => [String(x.id || ''), x]));
  summary.linkage.financialRows += financial.size;

  for (const w of workVolumes) {
    if (w.unitPrice === undefined || w.unitPrice === null) continue;
    const f = financial.get(String(w.id || ''));
    if (f && f.unitPrice !== undefined && Number(f.unitPrice) !== Number(w.unitPrice)) summary.linkage.financialConflictCount++;
  }

  for (const r of rooms) {
    if (r.floorId && !r.floorName) summary.linkage.roomsMissingFloorNameButHaveFloorId++;
    if (r.floorId && !floors.has(String(r.floorId))) summary.linkage.orphanRoomFloor++;
    const refs = [];
    if (r.workCategoryId) refs.push({ id: String(r.workCategoryId), teamId: r.teamId });
    for (const s of Array.isArray(r.subItems) ? r.subItems : []) if (s?.workCategoryId) refs.push({ id: String(s.workCategoryId), teamId: s.teamId });
    for (const ref of refs) {
      const w = workById.get(ref.id);
      if (!w) summary.linkage.orphanRoomWorkCategoryId++;
      else if (!workApplies(w, r)) summary.linkage.roomWorkCategoryScopeMismatch++;
      if (ref.teamId && !teams.has(String(ref.teamId))) summary.linkage.orphanRoomTeamId++;
    }
    if (r.teamId && !teams.has(String(r.teamId))) summary.linkage.orphanRoomTeamId++;
  }
  for (const d of data.defects.filter(active)) {
    if (d.roomId && !roomIds.has(String(d.roomId))) summary.linkage.orphanDefectRoom++;
    if (d.floorId && !d.archivedFloorId && !floors.has(String(d.floorId))) summary.linkage.orphanDefectFloor++;
  }
  for (const n of data.material_norms.filter(active)) {
    if (n.workCategoryId && !workById.has(String(n.workCategoryId))) summary.linkage.orphanMaterialNormWorkCategoryId++;
  }
  for (const c of canonicalCollections) {
    for (const row of data[c]) if (containsDriveRef(row)) summary.linkage.legacyDriveReferenceDocuments++;
  }
}

if (summary.futureSchemaProjects > 0) summary.blockerCount += summary.futureSchemaProjects;
if (summary.linkage.financialConflictCount > 0) summary.blockerCount += summary.linkage.financialConflictCount;
summary.reviewCount = summary.pendingSchemaMigrationProjects
  + summary.projectMissingOwnerUid
  + summary.projectMissingCreatedAt
  + summary.linkage.roomsMissingFloorNameButHaveFloorId
  + summary.linkage.orphanRoomFloor
  + summary.linkage.orphanDefectRoom
  + summary.linkage.orphanDefectFloor
  + summary.linkage.orphanRoomWorkCategoryId
  + summary.linkage.roomWorkCategoryScopeMismatch
  + summary.linkage.orphanRoomTeamId
  + summary.linkage.orphanMaterialNormWorkCategoryId
  + summary.linkage.legacyDriveReferenceDocuments;

fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
console.log(`PROD LIVE AUDIT: projects=${summary.projectCount}, pendingSchema=${summary.pendingSchemaMigrationProjects}, blockers=${summary.blockerCount}, review=${summary.reviewCount}`);
if (summary.blockerCount > 0) process.exit(3);
