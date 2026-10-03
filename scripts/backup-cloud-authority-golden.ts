import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reconcileBackupSnapshot } from '../src/utils/backupSnapshot';

const makeDefect = (id: string, updatedAt: number, description = id) => ({
  id,
  updatedAt,
  description,
  deleted: false,
});

const cloudDefects = Array.from({ length: 17 }, (_, index) =>
  makeDefect(`DEF-CLOUD-${index + 1}`, 1000 + index),
);
const staleLocalNine = cloudDefects.slice(0, 9).map((item) => ({ ...item }));

assert.throws(
  () =>
    reconcileBackupSnapshot(
      { defects: cloudDefects, tombstones: {}, updatedAt: 2000 },
      { defects: staleLocalNine, tombstones: {}, updatedAt: 1900 },
    ),
  /defects: 8 bản ghi.*chỉ có trên Firestore/i,
  'Cloud-only rows are ambiguous and must never be silently injected into a backup.',
);

const synced = reconcileBackupSnapshot(
  { defects: cloudDefects, tombstones: {}, updatedAt: 2000 },
  { defects: cloudDefects.map((item) => ({ ...item })), tombstones: {}, updatedAt: 1900 },
);
assert.equal(synced.defects.length, 17, 'A converged Cloud/live state must back up normally.');
assert.equal(synced.updatedAt, 2000, 'Backup reconciliation must preserve real data time, not export time.');

const historicalId = 'DEF-HISTORICAL-OLD';
const historicalCloud = [...staleLocalNine, makeDefect(historicalId, 1200, 'legacy historical row')];
const deletionAt = 5000;
const withTombstone = reconcileBackupSnapshot(
  { defects: historicalCloud, tombstones: {}, updatedAt: 2000 },
  {
    defects: staleLocalNine,
    tombstones: { [`defects_${historicalId}`]: deletionAt },
    updatedAt: deletionAt,
  },
);
assert.equal(
  withTombstone.defects.some((item: any) => item.id === historicalId),
  false,
  'A newer tombstone is explicit deletion evidence and must prevent historical-row resurrection.',
);
assert.equal(withTombstone.defects.length, 9);

const localOnly = makeDefect('DEF-LOCAL-PENDING', 9000, 'newer local unsynced');
const withLocalPending = reconcileBackupSnapshot(
  { defects: staleLocalNine, tombstones: {}, updatedAt: 2000 },
  { defects: [...staleLocalNine, localOnly], tombstones: {}, updatedAt: 9000 },
);
assert.equal(
  withLocalPending.defects.some((item: any) => item.id === localOnly.id),
  true,
  'A newer local edit not yet visible on the server must remain in the backup snapshot.',
);
assert.equal(withLocalPending.updatedAt, 9000);

const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(
  appSource,
  /fetchProjectFromCloud\(activeProjectId,\s*\{\s*serverOnly:\s*true\s*\}\)/,
  'Single-project backup must fetch the active project from the Firestore server.',
);
assert.match(
  appSource,
  /reconcileBackupSnapshot\(cloudPayload,\s*localSnapshot\)/,
  'Single-project backup must verify Cloud state against current live state.',
);
assert.match(
  appSource,
  /materialNorms:\s*backupSource\.materialNorms/,
  'Backup payload must use the verified snapshot rather than raw React state.',
);
assert.match(
  appSource,
  /defects:\s*backupSource\.defects/,
  'Defect backup must use the verified snapshot rather than raw React state.',
);
assert.match(
  appSource,
  /payload = await buildFirebaseOnlyCanonicalBackupSnapshot\(\)/,
  'All-project backup must use the same verified snapshot for the active project.',
);

console.log('Backup Cloud authority golden: PASS');
