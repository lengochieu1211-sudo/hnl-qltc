import fs from 'node:fs';
import { selectAuthoritativeRestorePhotos } from '../src/utils/backupRestoreMedia';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RESTORE JSON MEDIA GOLDEN FAIL: ${message}`);
  console.log(`PASS RESTORE JSON MEDIA: ${message}`);
}

const payload = {
  defects: [{ id: 'DEF-1' }, { id: 'DEF-2' }],
  crewRecords: [{ id: 'CREW-1' }],
};
const photos = [
  { id: 'P-D1', entityType: 'defect', entityId: 'DEF-1' },
  { id: 'P-D-OLD', entityType: 'defect', entityId: 'DEF-OLD' },
  { id: 'P-C1', entityType: 'crewRecord', entityId: 'CREW-1' },
  { id: 'P-C-OLD', entityType: 'crewRecord', entityId: 'CREW-OLD' },
  { id: 'P-CHAT', entityType: 'chat', entityId: 'CHAT-LEGACY' },
];

const selected = selectAuthoritativeRestorePhotos(photos, payload);
assert(selected.photos.map((photo) => photo.id).join(',') === 'P-D1,P-C1,P-CHAT', 'authoritative restore keeps only current Defect/Crew parents while preserving chat media');
assert(selected.skippedParentless.map((photo) => photo.id).join(',') === 'P-D-OLD,P-C-OLD', 'historical parentless Defect/Crew media is not restaged');

const projectManager = fs.readFileSync('src/components/ProjectManagerModal.tsx', 'utf8');
const photoSync = fs.readFileSync('src/lib/photoCloudSync.ts', 'utf8');
assert(projectManager.includes("action === 'OVERWRITE_FILE'\n            ? selectAuthoritativeRestorePhotos(rawCandidatePhotos, payload)"), 'OVERWRITE_FILE routes backup photos through authoritative parent filtering');
assert(projectManager.includes('photoIds: candidatePhotos.map'), 'JSON restore scopes Cloud media sync to the selected backup photo IDs');
assert(projectManager.includes('photoResult.lastErrorPhotoId') && projectManager.includes('photoResult.lastError'), 'restore reports exact failed photo ID and Cloud/R2 error detail');
assert(photoSync.includes('photoIds?: readonly string[]'), 'photo sync exposes an explicit scoped photo-ID option');
assert(photoSync.includes("allPhotos.filter((photo) => requestedPhotoIds.has(String(photo?.id || '')))"), 'scoped photo sync cannot sweep unrelated cached project photos');

console.log('RESTORE JSON MEDIA GOLDEN PASS');
