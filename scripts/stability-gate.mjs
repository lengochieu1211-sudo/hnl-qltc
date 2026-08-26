import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const fail = (msg) => { console.error(`STABILITY GATE FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`PASS: ${msg}`);
const requireAll = (text, markers, label) => {
  for (const marker of markers) if (!text.includes(marker)) fail(`${label}: missing ${marker}`);
};

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const vite = read('vite.config.ts');
const appVersion = read('src/config/appVersion.ts');
const buildMeta = read('src/config/buildMetadata.ts');
const runtimeArch = read('src/config/runtimeArchitecture.ts');
const mergeWorkflow = read('.github/workflows/firebase-hosting-merge.yml');
const prWorkflow = read('.github/workflows/firebase-hosting-pull-request.yml');
const buildWorkflow = read('.github/workflows/build.yml');
const firebaseJson = read('firebase.json');
const firebase = read('src/lib/firebase.ts');
const app = read('src/App.tsx');
const realtime = read('src/config/realtimeCollections.ts');
const firestoreRules = read('firestore.rules');
const storageRules = read('storage.rules');
const sw = read('public/sw.js');
const swRegistration = read('src/serviceWorkerRegistration.ts');
const photoSync = read('src/lib/photoCloudSync.ts');
const photoStorage = read('src/utils/photoStorage.ts');
const floorPlanSync = read('src/lib/floorPlanImageSync.ts');
const firebaseStorage = read('src/lib/firebaseStorage.ts');
const warehouse = read('src/lib/warehouseTransactions.ts');
const security = read('src/utils/securityUtils.ts');
const offlineAccess = read('src/utils/offlineAccess.ts');
const diagnostics = read('src/lib/runtimeDiagnostics.ts');
const authHeader = read('src/components/GoogleAuthHeader.tsx');
const floorPlanDefect = read('src/components/FloorPlanDefectTab.tsx');
const roomHighlight = read('src/components/RoomHighlightModal.tsx');
const projectManager = read('src/components/ProjectManagerModal.tsx');

if (pkg.version !== '6.3.0') fail(`package.json version is ${pkg.version}, expected 6.3.0`);
if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) fail('package-lock root version mismatch');
requireAll(vite, ["package.json", '__APP_VERSION__', '__BUILD_TIME__', '__BUILD_ID__', '__GIT_COMMIT__', '__APP_ENV__'], 'Vite build metadata');
if (!appVersion.includes('__APP_VERSION__') || appVersion.includes("APP_VERSION = '6.")) fail('appVersion.ts must consume injected package version, not hard-code release version');
requireAll(buildMeta, ['appVersion: APP_VERSION', 'buildId:', 'gitCommit:', 'buildTime:', 'environment:', 'platformFromLocation'], 'runtime build metadata');
if (mergeWorkflow.includes('VITE_APP_VERSION') || prWorkflow.includes('VITE_APP_VERSION') || buildWorkflow.includes('VITE_APP_VERSION')) fail('workflow must not hard-code app version');
requireAll(read('android-wrapper/build-apk.ps1'), ['package.json', '$appVersion', '&v=$appVersion'], 'Android version source');
requireAll(read('desktop-wrapper/build-launcher.ps1'), ['package.json', '$version', 'AssemblyInformationalVersion'], 'Windows version source');
if (!authHeader.includes('src={`/icon.png?v=${APP_VERSION}`}')) fail('header asset cache-bust does not use canonical APP_VERSION');
pass('V6.3.0 single-source version/build metadata');

requireAll(runtimeArch, [
  "VITE_RUNTIME_BACKEND || 'firebase-only'",
  "VITE_ENABLE_LEGACY_DRIVE_WRITE || 'false'",
  "VITE_ENABLE_LEGACY_LOCAL_BUSINESS_CACHE_WRITE || 'false'",
  'LEGACY_DRIVE_READ_FALLBACK',
], 'runtime architecture');
if (!mergeWorkflow.includes('VITE_RUNTIME_BACKEND: firebase-only') || !prWorkflow.includes('VITE_RUNTIME_BACKEND: firebase-only')) fail('Firebase-only runtime is not enforced in deploy workflows');
if (!mergeWorkflow.includes('VITE_ENABLE_LEGACY_DRIVE_WRITE: "false"') || !prWorkflow.includes('VITE_ENABLE_LEGACY_DRIVE_WRITE: "false"')) fail('legacy Drive write is not fail-closed in deploy workflows');
if (!mergeWorkflow.includes('workflow_dispatch:') || !mergeWorkflow.includes('DEPLOY-PROD')) fail('PROD deploy must remain manual-gated');
if (!prWorkflow.includes('DEV Firebase isolation gate') || !prWorkflow.includes('!= "com-example-qlct-61329"')) fail('DEV workflow does not refuse PROD project');
pass('Firebase-only runtime + DEV/PROD release isolation');

const expectedPairs = [
  ['rooms','roomProgressList'], ['inventory','inventory'], ['defects','defects'],
  ['work_volumes','workVolumes'], ['floor_plans','floorPlans'], ['checklist','checklist'],
  ['crew_records','crewRecords'], ['teams','teams'], ['material_norms','materialNorms'],
];
for (const [cloud, state] of expectedPairs) {
  if (!realtime.includes(`cloudName: '${cloud}'`) || !realtime.includes(`stateKey: '${state}'`)) fail(`missing realtime mapping ${cloud}<->${state}`);
}
if ((realtime.match(/cloudName:/g) || []).length !== 9) fail('realtime registry must contain exactly 9 business collections');
requireAll(firebase, ['REALTIME_COLLECTIONS', 'persistentLocalCache()', 'getDocsFromCache', 'loadProjectFromFirestoreCache'], 'Firestore single-source/offline');
if (firebase.includes('memoryLocalCache()')) fail('Firestore runtime still explicitly selects memoryLocalCache');
requireAll(app, [
  'loadProjectFromFirestoreCache(projectId)',
  "projectRoleSource === 'offline-cache'",
  'getCachedVerifiedProjectRole(activeProjectId, identity)',
  'getRememberedVerifiedAuthIdentity()',
  "if (!isOnline || projectRoleSource !== 'cloud' || !projectRoleAllowed)",
  "businessDataSource === 'legacy-migration-fallback'",
], 'offline bootstrap');
requireAll(offlineAccess, ['construction_verified_project_role_v1_', 'construction_offline_verified_auth_v1', 'parsed.projectId', 'parsed.uid', 'parsed.email'], 'identity-bound offline lease');
pass('Firestore is business source + official offline cache with identity/project guard');


requireAll(firebase, ['queueProjectDiffsToFirestoreOffline', 'writeBatch(db)', '[Firestore offline queue]'], 'Firestore offline mutation queue');
requireAll(app, ['canQueueOfflineFirestoreWrite', 'queueProjectDiffsToFirestoreOffline', 'Promise.allSettled(queued.commitPromises)', 'firestorePendingWriteCount'], 'App durable offline autosave');
if (!app.includes('if (FIREBASE_ONLY_RUNTIME) return;') || !app.includes('Legacy data is migration input only')) fail('automatic legacy editor recovery is still active in Firebase-only runtime');
const offlineBanner = read('src/components/OfflineSyncBanner.tsx');
if (!offlineBanner.includes('hàng chờ Firestore bền vững') || offlineBanner.includes('construction_offline_pending')) fail('offline UI still depends on custom localStorage pending counter');
pass('offline mutation durability uses Firestore SDK pending writes, not React/localStorage-only state');


if (!exists('storage.rules') || !firebaseJson.includes('"storage"') || !firebaseJson.includes('"rules": "storage.rules"')) fail('Firebase Storage rules are not wired into firebase.json');
requireAll(firebaseStorage, ['uploadProjectBinary', 'uploadFloorPlanBinary', 'thumbnailPath', 'deleteObject', 'projects/${safeSegment(input.projectId)}/media/'], 'Firebase Storage client');
requireAll(photoSync, ['uploadProjectBinary', "storageProvider: 'firebase-storage'", 'storagePath:', 'thumbnailPath:', 'photoSnapshotMergeQueue'], 'photo Storage pipeline');
requireAll(floorPlanSync, ['uploadFloorPlanBinary', "storageProvider: 'firebase-storage'", 'storagePath:', 'thumbnailPath:'], 'floor-plan Storage pipeline');
if (photoSync.includes('uploadPhotoToPrimaryDrive(')) fail('photo runtime still has a Drive upload call');
if (floorPlanSync.includes('uploadFloorPlanToPrimaryDrive(')) fail('floor-plan runtime still has a Drive upload call');
if (!photoSync.includes('LEGACY_DRIVE_READ_FALLBACK') || !floorPlanSync.includes('LEGACY_DRIVE_READ_FALLBACK')) fail('legacy Drive read fallback missing before verified binary migration');
if (!photoStorage.includes('__pendingWrite')) fail('photo pending/server-ack metadata guard missing');
pass('new binaries use Firebase Storage; Drive remains read-only legacy fallback');

requireAll(firestoreRules, ['isCoreBusinessCollection', 'lifecycleUpdateIsMonotonic', 'allow delete: if false;', "role == 'EDITOR'", "role == 'ENGINEER'", 'inventory_balances'], 'Firestore Rules lifecycle/roles');
requireAll(storageRules, ['canEdit(projectId)', 'isAdmin(projectId)', 'identityMetadata', 'updateKeepsIdentity', 'allow delete: if isAdmin(projectId)', 'allow read, write: if false'], 'Storage Rules');
requireAll(security, ["if (FIREBASE_ONLY_RUNTIME) return 'VIEWER'", 'if (FIREBASE_ONLY_RUNTIME || !projectId) return'], 'client role hardening');
pass('Rules enforce role, monotonic lifecycle, soft-delete and Storage membership');

requireAll(warehouse, ['runTransaction', 'commitWarehouseTransactionAtomic', 'updateWarehouseTransactionAtomic', 'softDeleteWarehouseTransactionAtomic', 'INSUFFICIENT_STOCK', 'STRICT_STOCK_OFFLINE_BLOCKED', 'inventory_balances'], 'warehouse transaction engine');
requireAll(app, ['commitWarehouseTransactionAtomic', 'updateWarehouseTransactionAtomic', 'softDeleteWarehouseTransactionAtomic', 'const handleImportInventory = async'], 'warehouse UI integration');
const warehouseTab = read('src/components/WarehouseTab.tsx');
if (!warehouseTab.includes('FIREBASE_ONLY_RUNTIME') || !warehouseTab.includes('Không thể xuất vượt tồn kho')) fail('warehouse UI still offers a negative-stock override in Firebase-only runtime');
pass('warehouse transaction/derived-balance safety engine is wired into runtime');

if (!floorPlanDefect.includes('operationalWorkCategoryCatalog') || !floorPlanDefect.includes('getOperationalRoomSubItems')) fail('floor-plan ghost-category filter missing');
if (!roomHighlight.includes("const [workCategory, setWorkCategory] = useState('')") || !roomHighlight.includes('projectWorkCategoryTitles')) fail('room editor still seeds a deleted/hard-coded category');
if (!photoSync.includes('snapshotIsInitial = firstSnapshot') || !photoSync.includes('firstSnapshot = false')) fail('photo realtime initial snapshot race guard missing');
if (!floorPlanDefect.includes('photoLoadSeqRef') || !floorPlanDefect.includes('loadSeq === photoLoadSeqRef.current')) fail('Defect photo stale-read guard missing');
pass('known regression guards retained');

requireAll(projectManager, [
  'FIREBASE_ONLY_PROJECT_MANAGER_CLOUD_FIRST',
  'FIREBASE_ONLY_PULL_METADATA_ONLY',
  'FIREBASE_ONLY_TEMPLATE_CLONE_CLOUD_FIRST',
  "if (FIREBASE_ONLY_RUNTIME) {",
  "if (!FIREBASE_ONLY_RUNTIME) {",
], 'Project Manager Firebase-only source-of-truth guards');
if (!projectManager.includes('inventory: []') || !projectManager.includes('floorPlans: templateFloorPlans') || !projectManager.includes("imageUrl: ''") || !projectManager.includes('defects: []') || !projectManager.includes('crewRecords: []') || !projectManager.includes('teams: []')) {
  fail('Firebase-only template clone may copy operational/transaction/media datasets');
}
pass('Project Manager cloud-first sync/pull/create guards retained');

requireAll(projectManager, [
  'FIREBASE_ONLY_BACKUP_CLOUD_SOURCE',
  'hydrateFloorPlansForBackup',
  'refreshProjectPhotoMetadataFromCloud',
], 'Project Manager Firebase-only backup source/media verification');
requireAll(app, [
  'FIREBASE_ONLY_ALL_BACKUP_CLOUD_SOURCE',
  'hydrateFloorPlansForBackup',
  'refreshProjectPhotoMetadataFromCloud',
], 'App Firebase-only all-project backup source/media verification');
requireAll(photoSync, ['refreshProjectPhotoMetadataFromCloud', 'getDocsFromServer(', 'mergeCloudPhotoMetadata'], 'photo metadata backup server verification');
requireAll(firebase, ['fetchProjectFromCloud(projectId: string, options?: { serverOnly?: boolean })', 'options?.serverOnly', 'getDocsFromServer('], 'server-only project backup read support');
if (!app.includes('fetchProjectFromCloud(projectId, { serverOnly: true })') || !projectManager.includes('fetchProjectFromCloud(projectId, { serverOnly: true })')) fail('non-active Firebase-only backup projects are not server-verified');
requireAll(photoStorage, ['getProjectPhotosWithBinary(projectId: string, requireBinary = false)', 'requireBinary &&', 'từ chối tạo backup không đầy đủ'], 'photo backup binary completeness guard');
if (!app.includes('getProjectPhotosWithBinary(projectId, true)') || !projectManager.includes('getProjectPhotosWithBinary(activeId, true)') || !projectManager.includes('getProjectPhotosWithBinary(pId, true)')) fail('self-contained backup callers do not require every photo binary');
if (app.includes("FIREBASE_ONLY_ALL_BACKUP_CLOUD_SOURCE") && app.includes("const allStorageData = await getAllStorageData();")) {
  const markerIndex = app.indexOf('FIREBASE_ONLY_ALL_BACKUP_CLOUD_SOURCE');
  const legacyIndex = app.indexOf('const allStorageData = await getAllStorageData();', markerIndex);
  const firebaseBranchEnd = app.indexOf('const allStorageData = await getAllStorageData();', markerIndex + 1);
  if (legacyIndex >= 0 && firebaseBranchEnd === legacyIndex && legacyIndex - markerIndex < 4500) fail('Firebase-only all-project backup may still source business data from localforage');
}
pass('Firebase-only JSON backup is Cloud/live-state sourced and media-complete/fail-closed');


if (!sw.includes('new URL(self.location.href).searchParams.get(\'v\')') || !swRegistration.includes('APP_VERSION')) fail('service worker cache version is not derived from canonical app version');
requireAll(diagnostics, ['sanitizeDiagnosticValue', '[redacted]'], 'diagnostics redaction');
pass('service worker/version and diagnostics safety');

for (const required of [
  'scripts/firebase-only-golden.mjs',
  'scripts/firebase-only-legacy-audit.mjs',
  'scripts/firebase-rules-check.mjs',
  'scripts/firebase-rules-behavior.mjs',
  'docs/firebase-only/P0_SINGLE_SOURCE_OF_TRUTH_AUDIT.md',
  'docs/firebase-only/SINGLE_SOURCE_OF_TRUTH_MATRIX.csv',
]) if (!exists(required)) fail(`required migration/golden artifact missing: ${required}`);
pass('migration audit + Golden/Rules tooling present');

console.log('STABILITY GATE PASS – V6.3.0 Firebase-only RC architecture');
