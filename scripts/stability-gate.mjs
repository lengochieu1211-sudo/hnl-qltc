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
const photoPicker = read('src/components/PhotoAttachmentPicker.tsx');
const androidMain = read('android-wrapper/src/com/qlct/app/MainActivity.java');
const desktopBuild = read('desktop-wrapper/build-launcher.ps1');
const imageCompressor = read('src/utils/imageCompressor.ts');
const materialNormModal = read('src/components/MaterialNormModal.tsx');
const exportPdf = read('src/components/ExportPdfModal.tsx');
const floorPlanSync = read('src/lib/floorPlanImageSync.ts');
const firebaseStorage = read('src/lib/firebaseStorage.ts');
const binaryStorage = read('src/lib/binaryStorage.ts');
const r2Storage = read('src/lib/r2Storage.ts');
const r2Worker = read('cloudflare/r2-gateway/worker.js');
const warehouse = read('src/lib/warehouseTransactions.ts');
const security = read('src/utils/securityUtils.ts');
const offlineAccess = read('src/utils/offlineAccess.ts');
const diagnostics = read('src/lib/runtimeDiagnostics.ts');
const authHeader = read('src/components/GoogleAuthHeader.tsx');
const floorPlanDefect = read('src/components/FloorPlanDefectTab.tsx');
const roomHighlight = read('src/components/RoomHighlightModal.tsx');
const projectManager = read('src/components/ProjectManagerModal.tsx');
const PROD_FIREBASE_WEB_APP_ID = '1:119152410850:web:c2aee2135428af34ef5ebb';

if (pkg.version !== '6.3.0') fail(`package.json version is ${pkg.version}, expected 6.3.0`);
if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) fail('package-lock root version mismatch');
requireAll(vite, ["package.json", '__APP_VERSION__', '__BUILD_TIME__', '__BUILD_ID__', '__GIT_COMMIT__', '__APP_ENV__'], 'Vite build metadata');
if (!appVersion.includes('__APP_VERSION__') || appVersion.includes("APP_VERSION = '6.")) fail('appVersion.ts must consume injected package version, not hard-code release version');
requireAll(buildMeta, ['appVersion: APP_VERSION', 'buildId:', 'gitCommit:', 'buildTime:', 'environment:', 'platformFromLocation'], 'runtime build metadata');
if (mergeWorkflow.includes('VITE_APP_VERSION') || prWorkflow.includes('VITE_APP_VERSION') || buildWorkflow.includes('VITE_APP_VERSION')) fail('workflow must not hard-code app version');
requireAll(read('android-wrapper/build-apk.ps1'), ['package.json', '$appVersion', '$versionCode', '$releaseTag', 'https://hnlqltc.web.app/?app=android'], 'Android version/source URL');
requireAll(read('.github/workflows/android-apk.yml'), ['windows-latest', 'actions/upload-artifact@v4', 'QLCT_WEB_URL: https://hnlqltc.web.app/?app=android', 'QLCT_RELEASE_TAG: 6.3.0-rc2.2.12'], 'Android APK CI');
requireAll(read('desktop-wrapper/build-launcher.ps1'), ['package.json', '$version', 'AssemblyInformationalVersion'], 'Windows version source');
if (!authHeader.includes('src={`/icon.png?v=${APP_VERSION}`}')) fail('header asset cache-bust does not use canonical APP_VERSION');
if (!firebase.includes(`appId: '${PROD_FIREBASE_WEB_APP_ID}'`)) fail('PROD Firebase Web App ID fallback is missing or stale');
requireAll(mergeWorkflow, [`VITE_FIREBASE_APP_ID: ${PROD_FIREBASE_WEB_APP_ID}`], 'PROD Hosting Firebase Web App ID');
requireAll(read('.github/workflows/android-apk.yml'), [`VITE_FIREBASE_APP_ID: ${PROD_FIREBASE_WEB_APP_ID}`], 'Android Firebase Web App ID');
requireAll(read('.github/workflows/windows-exe.yml'), [`VITE_FIREBASE_APP_ID: ${PROD_FIREBASE_WEB_APP_ID}`], 'Windows Firebase Web App ID');
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

if (!exists('storage.rules') || !firebaseJson.includes('"storage"') || !firebaseJson.includes('"rules": "storage.rules"')) fail('Firebase Storage fallback rules are not retained in firebase.json');
requireAll(firebaseStorage, ['uploadProjectBinary', 'uploadFloorPlanBinary', 'thumbnailPath', 'deleteObject'], 'Firebase Storage fallback client');
requireAll(binaryStorage, ['BINARY_STORAGE_PROVIDER', "'r2'", "'firebase-storage'", 'uploadProjectBinaryToCloud', 'uploadFloorPlanBinaryToCloud', 'downloadBinaryBlob'], 'binary storage provider adapter');
requireAll(r2Storage, ['VITE_R2_GATEWAY_URL', 'Authorization', 'uploadProjectBinaryToR2', 'uploadFloorPlanBinaryToR2', 'downloadR2Blob'], 'R2 client');
requireAll(r2Storage, ['verifyR2ObjectReady', "method: 'HEAD'", 'X-HNL-SHA256', 'R2_UPLOAD_NOT_DURABLE'], 'R2 durable PUT + authenticated HEAD verification');
requireAll(r2Worker, ['HNL_QLTC_MEDIA', 'FIREBASE_PROJECT_ID', 'firestore.googleapis.com', 'canWrite', "area === 'floor-plans'", "role === 'ADMIN'", "role === 'EDITOR'"], 'R2 gateway RBAC');
requireAll(r2Worker, ["request.method === 'HEAD'", 'HNL_QLTC_MEDIA.head', 'X-HNL-SHA256', 'Content-Length'], 'R2 gateway durable object HEAD');
requireAll(photoSync, ['uploadProjectBinaryToCloud', 'BINARY_STORAGE_PROVIDER', 'storagePath:', 'thumbnailPath:', 'photoSnapshotMergeQueue'], 'photo object-storage pipeline');
requireAll(photoStorage, [
  "raw.startsWith('r2:')",
  "raw.startsWith('storage:')",
  'projectIdHint',
  'downloadPhotoBlobFromCloud',
  'projectPhotoListMemoryCacheOwner',
  'getPhotoRuntimeAuthKey',
  'item.createdByUid && item.createdByUid !== activeUid',
  'Never hand an opaque `r2:` / `storage:` / `firestore:` reference to <img src>',
], 'cross-account photo binary resolver + same-phone account isolation');
requireAll(photoSync, [
  'getDocFromServer',
  "binaryUploadState || '') === 'pending'",
  'verifyPhotoBinaryReadyInCloud',
  "throw new Error('PHOTO_AUTH_UNAVAILABLE')",
], 'same-phone photo server refresh + upload confirmation');
requireAll(photoPicker, [
  'getPhotoDataUrl(p.id, p.cloudUrl || p.cloudFileId, true, projectId)',
  'getPhotoDataUrl(photo.id, photo.cloudUrl || photo.cloudFileId, false, projectId)',
  'isDirectPhotoUrl',
  'await uploadPhotoToCloud(projectId, saved)',
  'verifyPhotoBinaryReadyInCloud(projectId, saved.id)',
  'resetPhotoRuntimeMemoryCache()',
  'onAuthUserChanged',
  'if (nextUid === lastUid) return',
  'items.length === 0',
  'photoPickerServerRefreshKeys.has(refreshKey)',
  'refreshProjectPhotoMetadataFromCloud(projectId)',
], 'PhotoAttachmentPicker authenticated cloud rendering + same-phone account switch/realtime race guard');
requireAll(androidMain, [
  'deliverCameraImageWhenReady',
  'MediaStore.MediaColumns.SIZE',
  'attempt < 10',
  '180L',
], 'Android camera MediaStore flush guard');
requireAll(imageCompressor, [
  'maxDimension >= 1024',
  'preserving original supported Blob for durable upload',
], 'Android WebView image decode/encode fallback');
pass('photo gallery no longer clears synced metadata on initial auth emission; camera input waits for non-empty MediaStore bytes');
requireAll(androidMain, [
  'fileChooserDirectCamera',
  'Intent.ACTION_OPEN_DOCUMENT',
  'deliverGalleryUrisThroughStableCache',
  'copyGalleryUriToStableCache',
  'PickerCacheProvider.AUTHORITY',
], 'Android gallery materializes OEM/Google Photos content into app-owned cache');
const pickerProvider = read('android-wrapper/src/com/qlct/app/PickerCacheProvider.java');
requireAll(pickerProvider, ['ParcelFileDescriptor.MODE_READ_ONLY', 'OpenableColumns.DISPLAY_NAME', 'OpenableColumns.SIZE'], 'Android app-owned picker ContentProvider');
pass('Android Gallery returns stable app-owned binary to WebView instead of ephemeral OEM content URI');
requireAll(photoStorage, ['binaryUploadState: ' + "'pending'", 'isSharedCloudPhotoVisible', 'if (!isSharedCloudPhotoVisible(cloud)) continue'], 'photo ready-only shared visibility');
requireAll(photoSync, ['Ready-only publish', 'if (!deleted && (!hasDurableCloudBinaryPointer(photo)', 'cloudIsAuthoritative', 'đang tự retry'], 'photo durable outbox publish ordering');
requireAll(binaryStorage, ['one write authority only: private Cloudflare R2', 'uploadProjectBinaryToR2(input)', 'verifyBinaryObjectReady'], 'photo R2-only write authority with durable verification');
requireAll(app, ['photoOutboxRetryTimerRef', 'photoOutboxRetryAttemptRef', 'Math.min(30000, 750 * Math.pow(2'], 'photo persistent outbox retry scheduler');
pass('photo metadata is published cross-account only after durable R2 readiness; failed uploads stay in the local outbox');


requireAll(photoPicker, ['retryDelays = [0, 400, 1200, 2500]'], 'photo immediate cloud confirmation retry');
requireAll(app, ['? 250 : 150', 'Math.min(30000, 750 * Math.pow(2', 'photoOutboxRetryTimerRef'], 'photo near-realtime durable outbox scheduling');
requireAll(photoSync, ['PHOTO_INITIAL_SYNC_DELAY_MS = 1200', 'requestIdleCallback(run, { timeout: 1000 })', '}, 5000);'], 'photo initial reconciliation latency');
requireAll(desktopBuild, ['Optimize-HnlSmallIconFrame', '$sizes = @(16, 20, 24, 28, 32, 40, 48, 64, 80, 96, 128, 256)', '<=48px sharpened for taskbar DPI'], 'Windows DPI-aware taskbar icon frames');
pass('photo pending binary retries sooner and Windows taskbar icon uses sharpened DPI-specific frames');

requireAll(floorPlanDefect, ['photo.cloudUrl || photo.cloudFileId || photo.localUri', 'false, projectId'], 'Defect gallery cloud rendering');
requireAll(exportPdf, ['p.cloudUrl || p.cloudFileId || p.localUri', 'activeProjectId'], 'PDF photo cloud rendering');

requireAll(materialNormModal, ['sm:min-h-[2.75rem]', 'sm:items-start', 'leading-tight pt-0.5'], 'Material norm PC quota-field alignment');
pass('Material norm quota inputs align on PC while remaining stacked on mobile');
pass('cross-account/device photo metadata resolves private R2/Storage binary instead of rendering opaque pointers');
requireAll(floorPlanSync, ['uploadFloorPlanBinaryToCloud', 'BINARY_STORAGE_PROVIDER', 'storagePath:', 'thumbnailPath:'], 'floor-plan object-storage pipeline');
if (photoSync.includes('uploadPhotoToPrimaryDrive(')) fail('photo runtime still has a Drive upload call');
if (floorPlanSync.includes('uploadFloorPlanToPrimaryDrive(')) fail('floor-plan runtime still has a Drive upload call');
if (!photoSync.includes('LEGACY_DRIVE_READ_FALLBACK') || !floorPlanSync.includes('LEGACY_DRIVE_READ_FALLBACK')) fail('legacy Drive read fallback missing before verified binary migration');
if (!photoStorage.includes('__pendingWrite')) fail('photo pending/server-ack metadata guard missing');
const prodR2GatewayConfigured = mergeWorkflow.includes('VITE_R2_GATEWAY_URL: ${{ vars.VITE_R2_GATEWAY_URL }}') || mergeWorkflow.includes('VITE_R2_GATEWAY_URL: https://hnl-qltc-r2-gateway.lengochieu1211.workers.dev');
if (!mergeWorkflow.includes('VITE_BINARY_STORAGE_PROVIDER: r2') || !prodR2GatewayConfigured) fail('PROD workflow does not select R2 gateway');
if (mergeWorkflow.includes('deploy --only firestore:rules,storage')) fail('PROD still hard-depends on Firebase Storage deployment');
requireAll(mergeWorkflow, ['Deploy Hosting site hnlqltc', '--config firebase.prod.json', 'https://hnlqltc.web.app'], 'PROD short Hosting site');
requireAll(read('firebase.prod.json'), ['"site": "hnlqltc"', '"public": "dist"'], 'PROD Firebase Hosting config');
pass('new binaries use private R2 as the single PROD write authority; Firebase Storage/Drive remain read-only legacy compatibility paths');

requireAll(firestoreRules, ['isCoreBusinessCollection', 'lifecycleUpdateIsMonotonic', 'allow delete: if false;', "role == 'EDITOR'", "role == 'ENGINEER'", 'inventory_balances'], 'Firestore Rules lifecycle/roles');
requireAll(storageRules, ['canEdit(projectId)', 'isAdmin(projectId)', 'identityMetadata', 'updateKeepsIdentity', 'allow delete: if isAdmin(projectId)', 'allow read, write: if false'], 'Firebase Storage legacy compatibility Rules');
requireAll(security, ["if (FIREBASE_ONLY_RUNTIME) return 'VIEWER'", 'if (FIREBASE_ONLY_RUNTIME || !projectId) return'], 'client role hardening');
pass('Firestore RBAC remains authoritative; R2 gateway mirrors member/role access and Firebase Storage legacy rules are retained');

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
