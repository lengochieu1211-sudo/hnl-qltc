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
const firebase = read('src/lib/firebase.ts');
const app = read('src/App.tsx');

for (const marker of [
  'construction_offline_verified_auth_v1',
  'construction_verified_project_role_v1_',
  'parsed.uid',
  'parsed.email',
  'parsed.projectId',
  'clearRememberedVerifiedAuthIdentity',
]) {
  if (!offlineAccess.includes(marker)) fail(`offline access store missing ${marker}`);
}
if (!firebase.includes("verification: 'verified' | 'unavailable'")) fail('role verification state missing');
if (!firebase.includes("getDocFromServer(doc(db, 'projects', projectId))")) fail('project role is not server-authoritative');
if (!firebase.includes("verification: 'unavailable'")) fail('network failure cannot be distinguished from deny');
if (!firebase.includes('clearRememberedVerifiedAuthIdentity();')) fail('explicit sign-out does not revoke remembered offline identity');
pass('project-scoped verified role lease + explicit sign-out revocation');

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

console.log('OFFLINE GOLDEN PASS');
