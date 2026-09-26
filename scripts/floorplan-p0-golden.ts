import fs from 'node:fs';
import { classifyFloorPlanBulkTarget } from '../src/utils/floorPlanBulkSafety';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

const sync = read('src/lib/floorPlanImageSync.ts');
check(sync.includes('fetchProjectUserRoleFromCloud'), 'Floor-plan upload must use project-scoped Cloud role verification.');
check(!sync.includes("from '../utils/securityUtils'") && !sync.includes('if (getCurrentUserRole'), 'Legacy global role cache must not authorize floor-plan upload.');
check(sync.includes('stageFloorPlanImageOutbox'), 'Floor-plan binary outbox staging is missing.');
check(sync.includes('FLOOR_PLAN_ROLE_VERIFICATION_UNAVAILABLE'), 'Unavailable role verification must fail closed and retry.');
check(sync.includes('latestPendingRevision > revision'), 'Two rapid replacements must keep the newest revision authoritative.');
check(sync.includes('runTransaction(db, async (transaction) =>'), 'Floor-plan image publication must atomically inspect/create the business row.');
check(sync.includes('FLOOR_PLAN_IDENTITY_MISSING'), 'Image publication must fail closed rather than create a nameless floor.');
check(sync.includes('if (!existingFloorName) identityPatch.floorName = planFloorName'), 'Image-first floor creation must backfill floorName.');
check(sync.includes('if (!existingGroupId && planGroupId) identityPatch.structureGroupId = planGroupId'), 'Image-first floor creation must backfill Khu/Khối identity.');
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
check(sync.includes('isFloorPlanCloudBinaryReady'), 'Background cache must distinguish authoritative Cloud-ready drawings from stale clone pointers.');
check(sync.includes('FLOOR_PLAN_CACHE_POINTER_INDEX_TTL_MS'), 'Shared floor-plan cache must index immutable storage pointers instead of rescanning IndexedDB per floor.');
check(sync.includes('FLOOR_PLAN_CACHE_TOUCH_INTERVAL_MS'), 'Shared floor-plan cache must throttle IndexedDB last-access writes.');
const bulkApplyStart = sync.indexOf('export async function applyFloorPlanImageToMultipleFloors');
const bulkApplyEnd = sync.indexOf('\nasync function downloadFallback', bulkApplyStart);
const bulkApply = sync.slice(bulkApplyStart, bulkApplyEnd);
check((bulkApply.match(/uploadFloorPlanBinaryToCloud\(/g) || []).length === 1, 'Bulk floor-plan apply must upload exactly one shared binary.');
check(bulkApply.includes("batch.set(doc(db, 'projects', projectId, 'floor_plans', plan.id)"), 'Bulk floor-plan apply must atomically publish per-floor metadata.');
check(bulkApply.includes('imageAssetId: assetId') && bulkApply.includes('imageAssetOwnerFloorId: ownerPlan.id'), 'Shared asset identity must be recorded on every target floor.');
check(bulkApply.includes("FLOOR_PLAN_BULK_TARGET_PENDING"), 'Bulk apply must fail closed when a target has a pending replacement.');
check(sync.includes('inspectFloorPlanBulkTargets'), 'Bulk apply must preflight legacy vs true pending targets.');
check(sync.includes('getFloorPlanImageOutboxSnapshot(projectId)'), 'Bulk preflight must inspect durable local outbox evidence.');
check(sync.includes('getDocFromServer'), 'Ambiguous pending markers must be checked against the authoritative server row.');
check(sync.includes("const serverPlan = { ...serverSnap.data(), id: plan.id } as FloorPlan;"), 'Server preflight must classify the authoritative row without inheriting stale local pending markers.');
check(!sync.includes("const serverPlan = { ...plan, ...serverSnap.data(), id: plan.id } as FloorPlan;"), 'Server preflight must not merge stale local pending metadata back into the authoritative row.');
check(
  classifyFloorPlanBulkTarget({ imageUrl: 'https://legacy.example/plan.jpg', imageRevision: 100, imageCloudRevision: 0 }).status === 'legacy-overwrite-safe',
  'Legacy revision-only rows must be replaceable in an explicit bulk operation.',
);
check(
  classifyFloorPlanBulkTarget({ imageUrl: 'data:image/png;base64,AA==', imageRevision: 100, imageCloudRevision: 0 }).status === 'blocked-pending',
  'A real local binary replacement must remain fail-closed.',
);
check(
  classifyFloorPlanBulkTarget({ imageUrl: 'https://legacy.example/plan.jpg', imageRevision: 100, imageCloudRevision: 0, imageUploadState: 'pending', imagePendingByUid: 'uid-a' }).status === 'blocked-pending',
  'An owned pending replacement must remain fail-closed.',
);
check(
  classifyFloorPlanBulkTarget({ imageUrl: 'cloud-floorplan:r2:path', imageRevision: 100, imageCloudRevision: 100, imageUploadState: 'pending', storageProvider: 'r2', storagePath: 'path' }).status === 'ready',
  'A stale pending marker must not block an already cloud-stable R2 revision.',
);
check(
  classifyFloorPlanBulkTarget({ imageUrl: 'https://legacy.example/plan.jpg', imageRevision: 100, imageCloudRevision: 0, imageUploadState: 'pending' }).status === 'needs-server-check',
  'Ambiguous pending metadata must be server-verified instead of guessed.',
);

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
check(app.includes('function restoreLocalFloorPlanIdentity'), 'Realtime floor-plan merge must protect a known local name/Khu-Khối from incomplete image-only snapshots.');
check((app.match(/restoreLocalFloorPlanIdentity\(cloudItem, localItem\)/g) || []).length >= 2, 'Both patch and initial realtime paths must preserve floor identity.');
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
check(app.includes('const stableStructureGroupId = normalizedStructure.enabled'), 'New floor creation must stamp an explicit stable Khu/Khối membership.');
check(app.includes('const duplicateStructureGroupId = normalizedStructure.enabled'), 'Duplicated floors must stamp the resolved source Khu/Khối explicitly.');
check(app.includes('const sourceCloudReady = isFloorPlanCloudBinaryReady(sourcePlan);'), 'Duplicate floor must detect whether the source drawing is truly Cloud-ready.');
check(app.includes('imageAssetOwnerFloorId: sharedAssetOwnerFloorId'), 'Cloud-ready duplicate floors must preserve shared immutable asset ownership.');
check(app.includes('imageRevision: sourceCloudReady ? sourceCloudRevision : now'), 'Cloud-ready duplicate floors must not manufacture a new pending image revision.');
check(app.includes('storagePath: sourceCloudReady ? sourcePlan.storagePath : undefined'), 'Non-ready duplicates must clear stale storage pointers instead of creating MISSING_BINARY rows.');
check(app.includes('floorPlans.filter((plan) => isFloorPlanCloudBinaryReady(plan))'), 'Smart cache must exclude stale legacy clone pointers from periodic prefetch.');
const bulkMetadataStart = bulkApply.indexOf('const metadata: Partial<FloorPlan>');
const bulkMetadataEnd = bulkApply.indexOf('metadataByFloorId[plan.id]', bulkMetadataStart);
const bulkMetadata = bulkApply.slice(bulkMetadataStart, bulkMetadataEnd);
check(!bulkMetadata.includes('floorName:'), 'Bulk shared drawing metadata must never overwrite floorName.');
check(!bulkMetadata.includes('structureGroupId:'), 'Bulk shared drawing metadata must never overwrite structureGroupId.');
check(!bulkMetadata.includes('order:'), 'Bulk shared drawing metadata must never overwrite floor ordering.');

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
check(ui.includes('Áp dụng cho ${preflight.readyIds.length} tầng'), 'Bulk floor UI must allow an explicit safe-subset apply when true pending targets exist.');
check(ui.includes('skippedPendingNames'), 'Bulk floor UI must name/track targets skipped because they are truly pending.');
check(ui.includes('openFloorPlanApplyScopeForManagedSelection'), 'Selected-floor management must expose the existing safe bulk drawing replacement flow.');
check(ui.includes('Thay bản vẽ'), 'Selected-floor management is missing the bulk replace drawing action.');
check(ui.includes('Dùng chung bản vẽ ·'), 'Floor management must show which floors share one immutable drawing asset.');
check(ui.includes('🖼️ Bản vẽ riêng'), 'Floor management must identify independent drawings.');
check(ui.includes('loading="lazy"') && ui.includes('decoding="async"'), 'Floor management thumbnails must avoid eager decoding every plan image.');
check(app.includes('onInspectFloorPlanBulkTargets={handleInspectFloorPlanBulkTargets}'), 'App must expose bulk preflight to the floor-plan UI.');
check(ui.includes('Defect, Căn/Phòng, highlight, tiến độ, checklist'), 'Bulk floor UI must warn that business data remains per-floor.');
check(ui.includes('getSuggestedNewFloorStructureGroupId'), 'Add-floor flows must prefill the currently relevant Khu/Khối instead of reusing a stale/default selection.');
check(ui.includes('setNewFloorStructureGroupId(getSuggestedNewFloorStructureGroupId())'), 'Manage-floor add actions must apply the stable Khu/Khối prefill.');
check(ui.includes('getFloorPlanScopeLabel(plan)'), 'Multi-floor shared drawing picker must disambiguate same-named floors by Khu/Khối.');
check(ui.includes("setSelectedStructureGroupId(sourceGroupId)"), 'Duplicate flow must align the active Khu/Khối filter so the new floor remains visible.');
check(ui.includes('onClick={() => handleConfirmDuplicateFloor()}'), 'Duplicate confirmation must have a direct click path and not depend only on form submit.');
check(ui.includes('aria-label={`Mở Defect ${shortDefectCode}`}'), 'Existing Defect real-position hit target is missing.');
check(ui.includes('style={{ left: `${x}%`, top: `${y}%`, touchAction: \'manipulation\' }}'), 'Defect hit target must be anchored to the real defect coordinate.');
check(ui.includes('z-50 pointer-events-auto w-7 h-7'), 'Defect hit target must stay above room drag controls with a touch-safe area.');
check(ui.includes('cursor-pointer z-50 pointer-events-auto transition-transform'), 'Defect label must stay above room drag controls.');
check(ui.includes('onPointerDown={(e) => e.stopPropagation()}'), 'Defect interaction must stop pointer propagation before room selection/drag.');
check(ui.includes('if (tryHandleDefectPlacementEvent(e)) return;'), 'Room/Defect overlays must give armed Defect placement priority over room selection.');
check(ui.includes('// Defect placement has the highest interaction priority on the drawing.') && ui.includes('if (tryHandleDefectPlacementEvent(e)) return;\n    if (!canManageStructure) return;'), 'Room move/resize handles must not steal an armed Defect placement.');
check(ui.includes('if (isDefectPinPlacementMode || relocatingDefectId) return;\n    if (!canManageStructure || e.touches.length !== 1) return;'), 'Room long-press menu must stay disabled while adding/moving a Defect.');
check(ui.includes('const [relocatingDefectId, setRelocatingDefectId]'), 'Explicit Defect relocation mode is missing.');
check(ui.includes('Đang di chuyển') && ui.includes('Hủy di chuyển'), 'Defect relocation mode must be visibly announced and cancellable.');
check(ui.includes('<span>Di chuyển ghim</span>'), 'Defect detail must expose an explicit move-pin action.');
check(ui.includes("setMapLayers((prev) => ({ ...prev, defects: true, roomRegions: true, roomLabels: true }))"), 'Moving a Defect must show room highlights so the target room is visible.');
check(ui.includes('const placement = getCandidateTeamsForDefect(') && ui.includes('const roomAtPoint = placement.roomAtPos;'), 'Defect relocation must resolve the destination room from pin geometry.');
check(ui.includes('placement.roomAtPosTeam || defect.assignedTo'), 'Defect relocation must prefer the destination room/team linkage before the Defect legacy assignment.');
check(ui.includes('...linkage,') && ui.includes('floorId: activeFloor.id') && ui.includes('floorName: activeFloor.floorName'), 'Defect relocation must persist coordinates/floor and recomputed room/team linkage.');
check(ui.includes("Defect đang khóa vị trí. Mở khóa trước khi di chuyển ghim."), 'Locked Defect relocation must fail closed.');



const pdf = read('src/utils/pdfToImage.ts');
check(pdf.includes('mobileLike ? 6_500_000 : 18_000_000'), 'PDF rendering must keep Android/Desktop canvas pixel allocations bounded.');
check(pdf.includes('canvasToJpegBlob(canvas, quality)'), 'PDF rendering must encode Blob-first instead of retaining a giant canvas Data URL allocation.');
check(pdf.includes('canvas.width = 1;') && pdf.includes('blobToDataUrl(jpegBlob)'), 'PDF rendering must release the large canvas before Base64 transport conversion.');
check(!ui.includes('getPdfDocumentInfo(file)') && !ui.includes('convertPdfToImage(file'), 'Floor-plan PDF import must not load the same PDF twice for page count + rendering.');
check(ui.includes('const pdf = await loadPdfDocument(file);') && ui.includes('renderPdfDocumentPageToImage(pdf'), 'Floor-plan PDF import must reuse one loaded PDF document.');
check(ui.includes("code: 'FLOOR_PLAN_FILE_READ_FAILED'"), 'PDF/image import failures must be visible in Runtime Diagnostics.');

const config = read('src/components/GoogleConfigTab.tsx');
const offlineMirrorCard = read('src/components/ProjectOfflineMirrorCard.tsx');
for (const status of ['PENDING_OUTBOX', 'PENDING_LOCAL', 'MISSING_BINARY', 'CLOUD_POINTER_INCONSISTENT']) {
  check(config.includes(status), 'Diagnostic status missing: ' + status);
}
check(config.includes('getFloorPlanImageOutboxSnapshot'), 'Diagnostics must inspect the floor-plan outbox.');
check(config.includes('getFloorPlanImageCacheSnapshot'), 'Health diagnostics must inspect persistent floor-plan cache.');
check(offlineMirrorCard.includes('cacheFloorPlansForOffline') && offlineMirrorCard.includes('Cập nhật riêng mặt bằng'), 'Sync & Backup offline card must keep a manual floor-plan refresh action.');
check(config.includes('cacheByStoragePath'), 'Health Center offline readiness must recognize shared typical-floor assets.');
check(config.includes('offlineReady') && config.includes('cachedRevision') && config.includes('cachedBytes'), 'Floor-plan diagnostics must report offline readiness and cached revision/bytes.');

console.log('Floor-plan P0 golden PASS');
