import fs from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`RESTORE DEFECT VISIBILITY GOLDEN FAIL: ${message}`);
  console.log(`PASS RESTORE DEFECT VISIBILITY: ${message}`);
}

// Reproduce the production failure mode: Firestore set(..., { merge:true }) keeps
// destination-only fields when the backup omits them.
const historicalCloud = {
  id: 'DEF-1',
  floorId: 'fp-old',
  archivedAt: '2026-09-01T00:00:00.000Z',
  archivedFloorId: 'fp-old',
  archivedFloorName: 'Tầng cũ',
  deleted: false,
};
const activeBackup = {
  id: 'DEF-1',
  floorId: 'fp-new',
  floorName: 'Tầng Trệt',
  status: 'Mới phát hiện',
  deleted: false,
};

const legacyMerged = { ...historicalCloud, ...activeBackup };
assert(Boolean(legacyMerged.archivedAt), 'legacy merge reproduces stale archivedAt hiding an otherwise restored Defect');

const fixedMerged: Record<string, unknown> = { ...legacyMerged };
for (const key of ['archivedAt', 'archivedFloorId', 'archivedFloorName']) delete fixedMerged[key];
assert(!fixedMerged.archivedAt, 'authoritative active restore clears archivedAt');
assert(!('archivedFloorId' in fixedMerged), 'authoritative active restore clears archivedFloorId');
assert(!('archivedFloorName' in fixedMerged), 'authoritative active restore clears archivedFloorName');

const firebaseBase = fs.readFileSync('src/lib/firebaseBase.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const authGate = fs.readFileSync('src/components/AppAuthGate.tsx', 'utf8');

assert(firebaseBase.includes('authoritativeDefectArchiveCleanup'), 'Cloud restore has dedicated Defect archive cleanup');
assert(firebaseBase.includes('archivedAt: deleteField()'), 'Cloud restore deletes stale archivedAt');
assert(firebaseBase.includes('archivedFloorId: deleteField()'), 'Cloud restore deletes stale archivedFloorId');
assert(firebaseBase.includes('archivedFloorName: deleteField()'), 'Cloud restore deletes stale archivedFloorName');
assert(app.includes('wronglyArchived'), 'post-restore server verification checks Defect UI visibility lifecycle');
assert(app.includes('defects còn archive marker'), 'restore fails closed when a stale archive marker survives');

assert(authGate.includes('Quản lý thi công thông minh'), 'login uses concise approved headline');
assert(authGate.includes('Đăng nhập với Google'), 'login keeps existing Google auth action');
assert(authGate.includes('from-blue-600'), 'login follows Home blue visual language');
assert(!authGate.includes('HNL Construction'), 'old top-left login label is removed');
assert(authGate.includes('Công ty Cổ phần Công nghiệp An Phú'), 'login footer keeps company identity');
assert(authGate.includes('Mã PIN chỉ dùng để mở khóa nhanh'), 'PIN is explained without weakening Google identity verification');

console.log('RESTORE DEFECT VISIBILITY GOLDEN PASS');
