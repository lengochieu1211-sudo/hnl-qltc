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

const reconciled = reconcileBackupSnapshot(
  { defects: cloudDefects, tombstones: {}, updatedAt: 2000 },
  { defects: staleLocalNine, tombstones: {}, updatedAt: 1900 },
);
assert.equal(reconciled.defects.length, 17, 'Cloud rows missing from stale local state must be preserved.');
assert.deepEqual(
  new Set(reconciled.defects.map((item: any) => item.id)),
  new Set(cloudDefects.map((item) => item.id)),
  'Reconciled backup must retain every Cloud defect ID.',
);
assert.equal(reconciled.updatedAt, 2000, 'Backup reconciliation must preserve real data time, not export time.');

const tombstonedId = 'DEF-CLOUD-17';
const deletionAt = 5000;
const withTombstone = reconcileBackupSnapshot(
  { defects: cloudDefects, tombstones: {}, updatedAt: 2000 },
  {
    defects: staleLocalNine,
    tombstones: { [`defects_${tombstonedId}`]: deletionAt },
    updatedAt: deletionAt,
  },
);
assert.equal(
  withTombstone.defects.some((item: any) => item.id === tombstonedId),
  false,
  'A newer local tombstone must prevent Cloud backup reconciliation from resurrecting an intentional delete.',
);

const localOnly = makeDefect('DEF-LOCAL-PENDING', 9000, 'newer local unsynced');
const withLocalPending = reconcileBackupSnapshot(
  { defects: cloudDefects, tombstones: {}, updatedAt: 2000 },
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
  'Single-project backup must reconcile Cloud authority with current local state.',
);
assert.match(
  appSource,
  /materialNorms:\s*backupSource\.materialNorms/,
  'Backup payload must use the reconciled snapshot rather than raw React state.',
);
assert.match(
  appSource,
  /defects:\s*backupSource\.defects/,
  'Defect backup must use the reconciled snapshot rather than raw React state.',
);
assert.match(
  appSource,
  /payload = await buildFirebaseOnlyCanonicalBackupSnapshot\(\)/,
  'All-project backup must use the same canonical snapshot for the active project.',
);

console.log('Backup Cloud authority golden: PASS');
