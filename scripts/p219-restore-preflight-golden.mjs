import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertP21DemoFullProjectSaveBoundary } from '../src/utils/p21DemoWriterBoundary.ts';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url),'utf8');
const fb = readFileSync(new URL('../src/lib/firebaseBase.ts', import.meta.url),'utf8');
const update = app.slice(app.indexOf('  const updateAppData ='), app.indexOf('  const runScopedHistoryStep ='));
const restore = app.slice(app.indexOf('  const handleRestoreData ='), app.indexOf('  const handleRestoreAllStorageData ='));
const localStorageRestore = app.slice(app.indexOf('  const handleRestoreAllStorageData ='), app.indexOf('  const handleDriveSyncUp ='));
const fullCloudWriter = fb.slice(fb.indexOf('export async function saveProjectToCloud('),fb.indexOf('export function queueProjectDiffsToFirestoreOffline('));
let count=0;
function verify(name, fn) { fn(); ++count; console.log('PASS '+name); }
verify('room P21 prevents full restore', () => assert.throws(()=>assertP21DemoFullProjectSaveBoundary({roomSidecarDemo:true,trustedWarehouseDemo:false}),/GENERIC_FULL_PROJECT_SAVE_BLOCKED/));
verify('warehouse P21 prevents full restore', () => assert.throws(()=>assertP21DemoFullProjectSaveBoundary({roomSidecarDemo:false,trustedWarehouseDemo:true}),/GENERIC_FULL_PROJECT_SAVE_BLOCKED/));
verify('legacy restore remains available without demo flags', () => assert.doesNotThrow(()=>assertP21DemoFullProjectSaveBoundary({roomSidecarDemo:false,trustedWarehouseDemo:false})));
verify('restore preflight before UI restore flag',()=>assert.ok(restore.indexOf('assertP21DemoFullProjectSaveBoundary(p21LocalGates)')>0 && restore.indexOf('assertP21DemoFullProjectSaveBoundary(p21LocalGates)') < restore.indexOf('setIsRestoring(true)')));
verify('restore preflight before normalization',()=>assert.ok(restore.indexOf('assertP21DemoFullProjectSaveBoundary(p21LocalGates)') < restore.indexOf('normalizeImportedData(')));
verify('restore preflight before lock and local writes',()=>assert.ok(restore.indexOf('assertP21DemoFullProjectSaveBoundary(p21LocalGates)') < restore.indexOf('syncLockRef.current = true;')));
verify('whole storage restore preflight before any write',()=>assert.ok(localStorageRestore.indexOf('assertP21DemoFullProjectSaveBoundary(p21LocalGates)') < localStorageRestore.indexOf('setAsyncItem(')));
verify('whole storage restore preflight before lock',()=>assert.ok(localStorageRestore.indexOf('assertP21DemoFullProjectSaveBoundary(p21LocalGates)') < localStorageRestore.indexOf('syncLockRef.current = true')));
verify('full cloud writer preflight before auth',()=>assert.ok(fullCloudWriter.indexOf('assertP21DemoFullProjectSaveBoundary(p21DemoWriterGates)') < fullCloudWriter.indexOf('await ensureAuth()')));
verify('local mutation preflight before dirty state',()=>assert.ok(update.indexOf('p21DemoLocalMutationError(') < update.indexOf('hasUserEditedSinceHydrateRef.current = true;')));
verify('oversized Trash restore preflight before dirty state',()=>assert.ok(update.indexOf('predictedDeletes + predictedLinkedChanges > 150') < update.indexOf('hasUserEditedSinceHydrateRef.current = true;')));
verify('oversized Trash refusal before dirty state',()=>assert.ok(update.indexOf('return prev;\n      }\n      // Accepted only') < update.indexOf('hasUserEditedSinceHydrateRef.current = true;')));
verify('accepted mutation preserves prior timestamp behavior',()=>assert.ok(update.indexOf('const now = Date.now()') < update.indexOf('markLocalCollectionDirty(col)')));
console.log(`P21.9 RESTORE / DIRTY PRE-FLIGHT ${count}/${count} PASS – EMULATOR REHEARSAL ONLY`);
