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
check(sync.includes('readFloorPlanCacheRecordByStoragePointer'), 'Shared typical-floor asset cache reuse is missing.');
check(sync.includes('applyFloorPlanImageToMultipleFloors'), 'Multi-floor shared drawing apply operation is missing.');
check(sync.includes('isFloorPlanAutoCacheNetworkSuitable'), 'Smart background floor-plan cache network guard is missing.');
const bulkApplyStart = sync.indexOf('export async function applyFloorPlanImageToMultipleFloors');
const bulkApplyEnd = sync.indexOf('\nasync function downloadFallback', bulkApplyStart);
const bulkApply = sync.slice(bulkApplyStart, bulkApplyEnd);
check((bulkApply.match(/uploadFloorPlanBinaryToCloud\(/g) || []).length === 1, 'Bulk floor-plan apply must upload exactly one shared binary.');
check(bulkApply.includes("batch.set(doc(db, 'projects', projectId, 'floor_plans', plan.id)"), 'Bulk floor-plan apply must atomically publish per-floor metadata.');
check(bulkApply.includes('imageAssetId: assetId') && bulkApply.includes('imageAssetOwnerFloorId: ownerPlan.id'), 'Shared asset identity must be recorded on every target floor.');
check(bulkApply.includes("FLOOR_PLAN_BULK_TARGET_PENDING"), 'Bulk apply must fail closed when a target has a pending replacement.');

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
check(app.includes('// Smart offline cache:') && app.includes('cacheFloorPlansForOffline(projectId, cloudReadyPlans'), 'App must smart-prefetch remaining floor plans in the background.');
check(app.includes('priorityFloorPlanId: activeFloorViewId'), 'Smart cache must prioritize the floor currently being viewed.');
check(app.includes('isFloorPlanAutoCacheNetworkSuitable()'), 'Smart cache must pause on Data Saver/very slow network.');
check(app.includes('const handleUpdateFloorPlanImages = async'), 'App multi-floor image handler missing.');
check(app.includes('applyFloorPlanImageToMultipleFloors(projectId, targets, imageUrl)'), 'App must use the one-upload multi-floor operation.');

const firebaseBase = read('src/lib/firebaseBase.ts');
check(firebaseBase.includes("'imageDisplayRevision', 'imageDisplaySource', 'imageOfflineStale'"), 'Transient floor-plan cache/display metadata must be stripped from Firestore writes.');

const ui = read('src/components/FloorPlanDefectTab.tsx');
check(ui.includes("floorPlanProcessingKind === 'pdf'"), 'Floor-plan processing UI must branch by file type.');
check(ui.includes('Đang tối ưu ảnh mặt bằng'), 'Normal image processing label missing.');
check(ui.includes('không có bước chuyển PDF'), 'Image path must explicitly avoid the misleading PDF message.');
check(ui.includes('Thêm / Thay bản vẽ mặt bằng'), 'Floor-plan apply scope sheet is missing.');
check(ui.includes("floorPlanApplyMode === 'multiple'"), 'Floor-plan apply scope must support multiple floors.');
check(ui.includes('Chọn nhanh khoảng tầng') && ui.includes('Chọn tất cả'), 'Bulk floor picker must support range/all selection.');
check(ui.includes('1 file Cloud/R2 dùng chung'), 'Bulk floor UI must explain the single shared binary behavior.');
check(ui.includes('Defect, Căn/Phòng, highlight, tiến độ, checklist'), 'Bulk floor UI must warn that business data remains per-floor.');

const config = read('src/components/GoogleConfigTab.tsx');
for (const status of ['PENDING_OUTBOX', 'PENDING_LOCAL', 'MISSING_BINARY', 'CLOUD_POINTER_INCONSISTENT']) {
  check(config.includes(status), 'Diagnostic status missing: ' + status);
}
check(config.includes('getFloorPlanImageOutboxSnapshot'), 'Diagnostics must inspect the floor-plan outbox.');
check(config.includes('getFloorPlanImageCacheSnapshot'), 'Health diagnostics must inspect persistent floor-plan cache.');
check(config.includes('Cập nhật tất cả mặt bằng offline ngay'), 'Health Center must keep a manual force-refresh action for offline floor plans.');
check(config.includes('cacheByStoragePath'), 'Health Center offline readiness must recognize shared typical-floor assets.');
check(config.includes('offlineReady') && config.includes('cachedRevision') && config.includes('cachedBytes'), 'Floor-plan diagnostics must report offline readiness and cached revision/bytes.');

console.log('Floor-plan P0 golden PASS');
