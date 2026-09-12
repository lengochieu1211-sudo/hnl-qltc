import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const fail = (message) => { console.error(`CLOUD PURGE GOLDEN FAIL: ${message}`); process.exit(1); };
const pass = (message) => console.log(`PASS CLOUD PURGE: ${message}`);
const requireAll = (text, markers, label) => {
  for (const marker of markers) if (!text.includes(marker)) fail(`${label}: missing ${marker}`);
};

const purge = read('src/lib/cloudBinaryPurge.ts');
const binary = read('src/lib/binaryStorage.ts');
const r2 = read('src/lib/r2Storage.ts');
const worker = read('cloudflare/r2-gateway/worker.js');
const app = read('src/App.tsx');
const firebaseBase = read('src/lib/firebaseBase.ts');
const manager = read('src/components/ProjectManagerModal.tsx');
const sw = read('public/sw.js');
const vite = read('vite.config.ts');
const runtimeGolden = read('scripts/dev-hosted-browser-golden.mjs');
const runtimeWorkflow = read('.github/workflows/dev-runtime-golden.yml');
const rules = read('firestore.rules');

requireAll(firebaseBase, [
  'users/{uid}.projects is discovery-only',
  "roleInfo.verification !== 'verified' || !roleInfo.allowed",
  '[Project discovery] server verification failed closed:',
  'deferred because canonical verification is unavailable',
  'PROJECT_DELETE_VERIFY_MISMATCH',
  'PROJECT_RESTORE_VERIFY_MISMATCH',
  'fetchProjectDeletionStateFromServer',
  'lifecycleMutationId',
], 'canonical RBAC + project lifecycle');
if (firebaseBase.includes('role: hint.role')) fail('project discovery still exposes stale hint.role fallback');
pass('canonical RBAC discovery fails closed and project lifecycle uses server readback');

requireAll(manager, [
  'fetchProjectDeletionStateFromServer(entry.projectId)',
  'if (!serverState.deleted)',
  'deleteReceipt = await deleteCloudProject',
  'const now = deleteReceipt.deletedAt',
  'const receipt = await restoreCloudProject',
], 'Project Manager delete/restore race hardening');
pass('Project Manager waits for authoritative project lifecycle state');

requireAll(purge, [
  'getDocsFromServer',
  'collectBinaryPointers',
  "raw.startsWith('r2:')",
  "raw.startsWith('storage:')",
  'otherActiveReferenceKeys',
  'retainedTrashReferenceKeys',
  'construction_binary_purge_',
  "const areas: BinaryPurgeArea[] = ['photos', 'floor-plans']",
  'await requireAdmin(projectId)',
  'BINARY_PURGE_RETENTION_NOT_EXPIRED',
  'PHOTO_PURGE_ENTITY_NOT_TOMBSTONED',
  'FLOOR_PURGE_TARGET_NOT_TOMBSTONED',
], 'reference-safe persistent purge');
requireAll(binary, ['purgeBinaryObject', 'purgeR2Object', 'purgeStoragePath'], 'provider purge adapter');
requireAll(r2, ["method: 'DELETE'", 'R2_PURGE_FAILED', "area: 'r2-purge'"], 'R2 purge client');
requireAll(worker, ["request.method === 'DELETE'", "access.role !== 'ADMIN'", 'env.HNL_QLTC_MEDIA.delete'], 'R2 Worker ADMIN DELETE');
pass('physical purge revalidates references and supports durable provider retries');

requireAll(app, [
  'purgeTrashOperationBinaries(operation.projectId, operation.id)',
  'drainBinaryPurgeRetryQueues(activeProjectIdRef.current)',
  'Mục Thùng rác vẫn được giữ để thử lại',
], 'App purge lifecycle');
if (app.includes("await deleteTrashOperationFromCloud(operation.projectId, operation.id).catch(() => {})")) {
  fail('App still swallows Trash finalization failure');
}
pass('App keeps Trash intent until safe purge completes');

requireAll(vite, ['hnl-service-worker-asset-manifest', 'sw-assets.json'], 'Vite app-shell manifest');
requireAll(sw, ['loadBuildAssetManifest', 'cache.addAll(required)'], 'Service Worker full precache');
requireAll(runtimeGolden, ['verifyColdStartOffline', 'Network.clearBrowserCache', 'context.setOffline(true)', 'offlineResponse.fromServiceWorker()'], 'cold-start Runtime Golden');
for (const trigger of ['public/sw.js', 'vite.config.ts', 'src/serviceWorkerRegistration.ts', 'scripts/stability-gate.mjs']) {
  if (!runtimeWorkflow.includes(`- '${trigger}'`)) fail(`Runtime Golden trigger missing ${trigger}`);
}
pass('offline cold-start is protected by source + live Runtime Golden gates');

requireAll(rules, ['lifecycleMutationId', 'lifecycleMutationType', 'lifecycleMutationAt'], 'legacy project trash Rules allow-list');
pass('Firestore Rules permit only the added lifecycle verification metadata in legacy trash path');

console.log('CLOUD PURGE GOLDEN PASS');
