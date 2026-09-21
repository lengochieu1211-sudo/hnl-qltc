import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fail = (msg) => { console.error(`OFFLINE GOLDEN FAIL: ${msg}`); process.exit(1); };
const pass = (msg) => console.log(`PASS: ${msg}`);

// Firebase-only role decision model. A Cloud transport failure is not an authorization
// result; only an authoritative Cloud answer may change the identity/project role lease.
function resolveRole({ cloud, cached }) {
  if (cloud?.verification === 'verified') {
    return { resolved: true, source: 'cloud', role: cloud.allowed ? cloud.role : 'VIEWER', allowed: cloud.allowed };
  }
  if (cached) {
    return { resolved: true, source: 'offline-cache', role: cached.role, allowed: cached.allowed };
  }
  return { resolved: false, source: 'unresolved', role: 'VIEWER', allowed: false };
}

const editorCached = { role: 'EDITOR', allowed: true };
const legacyEngineerCached = { role: 'ENGINEER', allowed: true };
const adminCached = { role: 'ADMIN', allowed: true };
const viewerCached = { role: 'VIEWER', allowed: true };
const unavailable = { verification: 'unavailable', allowed: false, role: 'VIEWER' };

const editorOffline = resolveRole({ cloud: unavailable, cached: editorCached });
if (!editorOffline.resolved || editorOffline.role !== 'EDITOR' || editorOffline.source !== 'offline-cache') fail('EDITOR downgraded during network loss');
const legacyEngineerOffline = resolveRole({ cloud: unavailable, cached: legacyEngineerCached });
if (!legacyEngineerOffline.resolved || legacyEngineerOffline.role !== 'ENGINEER') fail('legacy ENGINEER compatibility lease broken before member migration');
const adminOffline = resolveRole({ cloud: unavailable, cached: adminCached });
if (!adminOffline.resolved || adminOffline.role !== 'ADMIN') fail('ADMIN downgraded during network loss');
const viewerOffline = resolveRole({ cloud: unavailable, cached: viewerCached });
if (!viewerOffline.resolved || viewerOffline.role !== 'VIEWER' || !viewerOffline.allowed) fail('VIEWER offline read lease invalid');
const noLeaseOffline = resolveRole({ cloud: unavailable, cached: null });
if (noLeaseOffline.resolved || noLeaseOffline.role !== 'VIEWER') fail('missing lease must fail closed');
const revokedOnline = resolveRole({ cloud: { verification: 'verified', allowed: false, role: 'EDITOR' }, cached: editorCached });
if (!revokedOnline.resolved || revokedOnline.role !== 'VIEWER' || revokedOnline.allowed) fail('authoritative revoke did not override cached editor role');
const promotedOnline = resolveRole({ cloud: { verification: 'verified', allowed: true, role: 'EDITOR' }, cached: viewerCached });
if (promotedOnline.role !== 'EDITOR' || promotedOnline.source !== 'cloud') fail('authoritative promotion did not override cached VIEWER');
pass('role decision matrix: EDITOR/ADMIN/VIEWER + legacy ENGINEER compatibility/offline/revoke/promote');

const offlineAccess = read('src/utils/offlineAccess.ts');
const verifiedBusinessSnapshot = read('src/lib/verifiedOfflineBusinessSnapshot.ts');
const firebase = read('src/lib/firebase.ts');
const app = read('src/App.tsx');

for (const marker of [
  'construction_offline_verified_auth_v1',
  'construction_verified_project_role_v1_',
  'parsed.uid',
  'parsed.email',
  'parsed.projectId',
  'clearRememberedVerifiedAuthIdentity',
  'VERIFIED_PROJECT_ROLE_MAX_AGE_MS = 24 * 60 * 60 * 1000',
  'Date.now() - verifiedAt > VERIFIED_PROJECT_ROLE_MAX_AGE_MS',
  'localStorage.removeItem(key)',
]) {
  if (!offlineAccess.includes(marker)) fail(`offline access store missing ${marker}`);
}
if (!firebase.includes("verification: 'verified' | 'unavailable'")) fail('role verification state missing');
if (!firebase.includes("getDocFromServer(doc(db, 'projects', projectId))")) fail('project role is not server-authoritative');
if (!firebase.includes("verification: 'unavailable'")) fail('network failure cannot be distinguished from deny');
if (!firebase.includes('clearRememberedVerifiedAuthIdentity();')) fail('explicit sign-out does not revoke remembered offline identity');
pass('project-scoped verified role lease expires after 24h + explicit sign-out revocation');

for (const marker of [
  "projectRoleSource === 'offline-cache'",
  "projectRoleSource !== 'cloud'",
  'getCachedVerifiedProjectRole(activeProjectId, identity)',
  'getRememberedVerifiedAuthIdentity()',
  'setProjectRoleAllowed(res.allowed)',
  "if (!isOnline)",
]) {
  if (!app.includes(marker)) fail(`App offline bootstrap missing ${marker}`);
}
if (!app.includes("if (!isOnline || projectRoleSource !== 'cloud' || !projectRoleAllowed)")) fail('business realtime must stay detached while using offline role cache');
if (!app.includes("getProjectsList().filter((project) => getCachedVerifiedProjectRole(project.id, identity)?.allowed === true)")) fail('offline project discovery is not identity/role scoped');
if (!firebase.includes('persistentLocalCache()') || !firebase.includes('getDocsFromCache')) fail('official Firestore persistent cache hydrate missing');
if (!app.includes("businessDataSource === 'legacy-migration-fallback'")) fail('legacy local migration fallback is not explicitly read-only');
if (!app.includes('Legacy data is migration input only') || !app.includes('if (FIREBASE_ONLY_RUNTIME) return;')) fail('Firebase-only still auto-recovers legacy IndexedDB rows into live state');
for (const marker of [
  'hnl_verified_offline_business_v1:',
  'VERIFIED_PROJECT_ROLE_MAX_AGE_MS',
  'record.uid !== uid',
  'normalizeEmail(record.email) !== email',
  'Date.now() - capturedAt > VERIFIED_PROJECT_ROLE_MAX_AGE_MS',
]) {
  if (!verifiedBusinessSnapshot.includes(marker)) fail(`verified offline business snapshot missing ${marker}`);
}
for (const marker of [
  'loadVerifiedOfflineBusinessSnapshot',
  'saveVerifiedOfflineBusinessSnapshot',
  "businessDataSource === 'verified-offline-snapshot'",
  "setBusinessDataSource('verified-offline-snapshot')",
  "(firestoreCached?.found || useVerifiedOfflineSnapshot) ? initialState : null",
  "businessDataSource === 'verified-offline-snapshot' && !getCurrentRealFirebaseUser()",
  "businessDataSource === 'firestore-cache' || businessDataSource === 'cloud' || businessDataSource === 'verified-offline-snapshot'",
]) {
  if (!app.includes(marker)) fail(`App verified offline cold-start recovery/edit queue missing ${marker}`);
}
if (app.includes('Verified offline cold-start snapshot is read-only until Cloud reconnects.')) {
  fail('verified snapshot still blocks authorized offline edits');
}
const offlineBannerSource = read('src/components/OfflineSyncBanner.tsx');
if (!offlineBannerSource.includes('Snapshot + Firestore') || !offlineBannerSource.includes('Bản chụp offline đã xác minh') || !offlineBannerSource.includes('hàng chờ Firestore bền vững')) {
  fail('offline banner does not disclose writable verified snapshot + Firestore queue behavior');
}
pass('identity-bound verified snapshot prevents empty-tab cold restart and queues only authorized user diffs through Firestore');

pass('offline bootstrap uses Firestore persistent cache; legacy local business cache is read-only migration fallback');

for (const marker of [
  'queueProjectDiffsToFirestoreOffline',
  'canQueueOfflineFirestoreWrite',
  "businessDataSource === 'firestore-cache'",
  "businessDataSource === 'cloud'",
  'Offline · ${queued.queuedRecords} thay đổi đã vào hàng chờ Firestore.',
  'Promise.allSettled(queued.commitPromises)',
]) {
  if (!app.includes(marker)) fail(`durable Firestore offline mutation queue missing ${marker}`);
}
if (!firebase.includes('writeBatch(db)') || !firebase.includes('[Firestore offline queue]')) fail('Firestore SDK offline batch queue helper missing');
if (app.includes("localStorage.setItem('construction_offline_pending'")) fail('custom localStorage offline pending queue resurrected');
const offlineBanner = read('src/components/OfflineSyncBanner.tsx');
if (!offlineBanner.includes('hàng chờ Firestore bền vững') || offlineBanner.includes("construction_offline_pending")) fail('offline banner still describes legacy localStorage pending behavior');
pass('offline edits enter Firestore persistent pending writes; no React-RAM/localStorage-only queue');


const offlineMirror = read('src/lib/projectOfflineMirror.ts');
const offlineMirrorSettings = read('src/lib/offlineMirrorSettings.ts');
const offlineMirrorCard = read('src/components/ProjectOfflineMirrorCard.tsx');
const photoCloudSync = read('src/lib/photoCloudSync.ts');
const googleConfigTab = read('src/components/GoogleConfigTab.tsx');

for (const marker of [
  "fetchProjectFromCloud(projectId, { serverOnly: true })",
  'refreshProjectPhotoMetadataFromCloud(projectId)',
  'getPhotoBlob(photo.id, false)',
  'downloadPhotoBlobFromCloud(projectId, photo.id',
  'cacheFloorPlansForOffline(projectId, floorPlans',
  'PHOTO_DOWNLOAD_CONCURRENCY = 3',
]) {
  if (!offlineMirror.includes(marker)) fail(`project offline mirror missing ${marker}`);
}
if (offlineMirror.includes('uploadPhotoToCloud') || offlineMirror.includes('setDoc(') || offlineMirror.includes('writeBatch(')) fail('offline mirror must remain read-only against Cloud');
for (const marker of [
  'hnl_project_offline_mirror_v1',
  'getCurrentRealFirebaseUser',
  'shouldAutoMirrorProjectBinaries',
  "hnl-offline-mirror-setting-changed",
]) {
  if (!offlineMirrorSettings.includes(marker)) fail(`offline mirror settings missing ${marker}`);
}
for (const marker of [
  'Dữ liệu offline trên thiết bị',
  'Giữ sẵn offline: Bật',
  'Đồng bộ offline ngay',
  'Cloud vẫn là nguồn chuẩn',
]) {
  if (!offlineMirrorCard.includes(marker)) fail(`offline mirror UI missing ${marker}`);
}
if (!googleConfigTab.includes('<ProjectOfflineMirrorCard activeProjectId={activeProjectId} floorPlans={floorPlans} />')) fail('offline mirror card is not integrated into Settings');
const syncCenterStart = googleConfigTab.indexOf('title="Trung tâm đồng bộ & sao lưu"');
const healthCenterStart = googleConfigTab.indexOf('title="HNL Health Center"');
const offlineCardStart = googleConfigTab.indexOf('<ProjectOfflineMirrorCard');
const bridgeCardStart = googleConfigTab.indexOf('<WindowsDesktopSyncBridgeCard');
if (!(syncCenterStart >= 0 && offlineCardStart > syncCenterStart && bridgeCardStart > syncCenterStart && healthCenterStart > bridgeCardStart)) fail('offline/Windows sync controls must stay in Sync & Backup Center before Health Center');
const healthCenterSource = googleConfigTab.slice(healthCenterStart);
if (healthCenterSource.includes('<ProjectOfflineMirrorCard') || healthCenterSource.includes('<WindowsDesktopSyncBridgeCard') || healthCenterSource.includes('Mặt bằng offline:')) fail('Health Center must remain diagnostic-only');
if (!photoCloudSync.includes('shouldAutoMirrorProjectBinaries(projectId)') || !photoCloudSync.includes('prefetchOfflineMirrorPhotos')) fail('realtime photo stream does not keep opted-in offline mirror warm');
pass('project Offline Mirror reuses Firestore persistent cache + photo IndexedDB + floor-plan cache without creating a second Cloud authority');

console.log('OFFLINE GOLDEN PASS');
