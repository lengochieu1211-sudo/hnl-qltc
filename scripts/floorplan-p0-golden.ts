import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

const sync = read('src/lib/floorPlanImageSync.ts');
check(sync.includes('fetchProjectUserRoleFromCloud'), 'Floor-plan upload must use project-scoped Cloud role verification.');
check(!sync.includes("from '../utils/securityUtils'") && !sync.includes('if (getCurrentUserRole'), 'Legacy global role cache must not authorize floor-plan upload.');
check(sync.includes('stageFloorPlanImageOutbox'), 'Floor-plan binary outbox staging is missing.');
check(sync.includes('FLOOR_PLAN_ROLE_VERIFICATION_UNAVAILABLE'), 'Unavailable role verification must fail closed and retry.');
check(sync.includes('latestPendingRevision > revision'), 'Two rapid replacements must keep the newest revision authoritative.');
check(sync.includes('imagePendingByUid'), 'Pending outbox must be uploader/account scoped.');
check(sync.includes("FLOOR_PLAN_CACHE_PREFIX = 'floor_plan_image_cache_v1'"), 'Persistent floor-plan offline cache prefix missing.');
check(sync.includes('FLOOR_PLAN_CACHE_REVISIONS_PER_FLOOR = 2'), 'Offline cache must retain two revisions per floor for atomic replacement fallback.');
check(sync.includes('navigator.storage?.estimate'), 'Offline cache must use storage quota-aware budgeting.');
check(sync.includes('validateFloorPlanCacheBlob'), 'Offline cache must validate cached blobs and discard corrupted entries.');
check(sync.includes('readFloorPlanCacheRecord(projectId, plan.id, revision)'), 'Floor-plan load must check exact local revision before Cloud.');
check(sync.includes('readLatestFloorPlanCacheRecord'), 'Floor-plan load must support a previous cached revision when the latest binary is unavailable.');
check(sync.includes('resolveFloorPlanImageForDisplay'), 'Local-first floor-plan display resolver missing.');
check(sync.includes('cacheFloorPlansForOffline'), 'Health Center offline prefetch operation missing.');
check(sync.includes('getFloorPlanImageCacheSnapshot'), 'Floor-plan cache diagnostics snapshot missing.');

// P0 atomic-publish invariant: floor-plan objects must be immutable once their path is
// published in Firestore. Reusing /original.ext lets an older/newer in-flight upload
// change bytes behind an existing metadata pointer before the pointer transaction wins.
const r2Storage = read('src/lib/r2Storage.ts');
check(r2Storage.includes('contentSha256 = await sha256Hex(await input.blob.arrayBuffer())'), 'R2 floor-plan upload must derive a deterministic content hash.');
check(r2Storage.includes('buildR2FloorPlanPaths(input.projectId, input.floorPlanId, input.blob.type, contentSha256)'), 'R2 floor-plan upload must use the content hash in its object path.');
check(r2Storage.includes('original.${version}.${ext}') && r2Storage.includes('thumb.${version}.${ext}'), 'R2 floor-plan original/thumb paths must be content-addressed.');

const firebaseStorage = read('src/lib/firebaseStorage.ts');
check(firebaseStorage.includes('contentSha256 = await sha256Hex(await input.blob.arrayBuffer())'), 'Firebase Storage floor-plan upload must mirror the immutable content-addressed invariant.');
check(firebaseStorage.includes('buildFloorPlanStoragePaths(input.projectId, input.floorPlanId, input.blob.type, contentSha256)'), 'Firebase Storage floor-plan upload must use the content hash in its object path.');
check(firebaseStorage.includes('original.${version}.${ext}') && firebaseStorage.includes('thumb.${version}.${ext}'), 'Firebase Storage floor-plan original/thumb paths must be content-addressed.');

const app = read('src/App.tsx');
const handlerStart = app.indexOf('const handleUpdateFloorPlanImage = async');
const handlerEnd = app.indexOf('\n  const handle', handlerStart + 10);
check(handlerStart >= 0 && handlerEnd > handlerStart, 'Async floor-plan replacement handler missing.');
const handler = app.slice(handlerStart, handlerEnd);
check(handler.indexOf('await stageFloorPlanImageOutbox') >= 0, 'Replacement must stage binary before state mutation.');
check(handler.indexOf('await stageFloorPlanImageOutbox') < handler.indexOf('updateAppData'), 'Outbox staging must happen before updateAppData.');
check(handler.includes("imageUploadState: 'pending'"), 'Replacement must mark pending upload state.');
check(handler.includes('storagePath: undefined'), 'Replacement must clear the old cloud object pointer.');
check(handler.includes('updatedAt: imageRevision'), 'Replacement must advance record updatedAt to defeat stale snapshots.');
check(app.includes('preservePendingFloorImage'), 'Realtime merge must preserve a newer pending local drawing.');
check(app.includes('resolveFloorPlanImageForDisplay(projectId, plan, { allowStaleCache: true })'), 'Floor-plan viewer must resolve local cache before/around Cloud hydration.');
const hydrateEffectStart = app.indexOf('// Hydrate cloud-backed floor-plan binaries');
const hydrateEffect = app.slice(hydrateEffectStart, hydrateEffectStart + 7000);
check(!hydrateEffect.includes('!cloudUserKey || !isOnline || projectRoleSource'), 'Offline floor-plan hydration must not be blocked by navigator online state.');
check(hydrateEffect.includes("projectRoleSource !== 'offline-cache'"), 'Offline verified role cache must be allowed to hydrate a persistent floor-plan cache.');
check(app.includes('imageDisplayRevision: resolution.revision'), 'Viewer must track the actual displayed cache revision separately from Cloud revision.');
check(app.includes('selectedHasStaleDisplay') && app.includes('isOnline && selectedHasStaleDisplay'), 'Reconnect must refresh a stale cached revision to the latest Cloud revision.');

const firebaseBase = read('src/lib/firebaseBase.ts');
check(firebaseBase.includes("'imageDisplayRevision', 'imageDisplaySource', 'imageOfflineStale'"), 'Transient floor-plan cache/display metadata must be stripped from Firestore writes.');

const ui = read('src/components/FloorPlanDefectTab.tsx');
check(ui.includes("floorPlanProcessingKind === 'pdf'"), 'Floor-plan processing UI must branch by file type.');
check(ui.includes('Đang tối ưu ảnh mặt bằng'), 'Normal image processing label missing.');
check(ui.includes('không có bước chuyển PDF'), 'Image path must explicitly avoid the misleading PDF message.');

const config = read('src/components/GoogleConfigTab.tsx');
for (const status of ['PENDING_OUTBOX', 'PENDING_LOCAL', 'MISSING_BINARY', 'CLOUD_POINTER_INCONSISTENT']) {
  check(config.includes(status), 'Diagnostic status missing: ' + status);
}
check(config.includes('getFloorPlanImageOutboxSnapshot'), 'Diagnostics must inspect the floor-plan outbox.');
check(config.includes('getFloorPlanImageCacheSnapshot'), 'Health diagnostics must inspect persistent floor-plan cache.');
check(config.includes('Tải mặt bằng để dùng offline'), 'Health Center must expose explicit offline floor-plan prefetch.');
check(config.includes('offlineReady') && config.includes('cachedRevision') && config.includes('cachedBytes'), 'Floor-plan diagnostics must report offline readiness and cached revision/bytes.');

console.log('Floor-plan P0 golden PASS');