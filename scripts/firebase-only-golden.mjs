import fs from 'node:fs';

const read = (p) => fs.readFileSync(p,'utf8');
const app = read('src/App.tsx');
const firebase = read('src/lib/firebase.ts');
const firebaseBase = read('src/lib/firebaseBase.ts');
const projectManager = read('src/components/ProjectManagerModal.tsx');
const dataNormalizer = read('src/utils/dataNormalizer.ts');
const liveBackendGolden = read('scripts/dev-live-backend-golden.mjs');
const photo = read('src/lib/photoCloudSync.ts');
const photoStorage = read('src/utils/photoStorage.ts');
const photoPicker = read('src/components/PhotoAttachmentPicker.tsx');
const floorImage = read('src/lib/floorPlanImageSync.ts');
const rules = read('firestore.rules');
const storageRules = read('storage.rules');
const warehouse = read('src/lib/warehouseTransactions.ts');
const category = read('src/components/FloorPlanDefectTab.tsx');
const security = read('src/utils/securityUtils.ts');
const workflow = read('.github/workflows/firebase-hosting-pull-request.yml');
const windowsDevWorkflow = read('.github/workflows/windows-exe-dev.yml');
const androidDevWorkflow = read('.github/workflows/android-apk-dev.yml');

const scenarios = [];
function verify(id, name, condition, evidence) {
  if (!condition) { console.error(`FAIL G${id}: ${name}`); process.exitCode=1; scenarios.push({id,name,status:'FAIL',evidence}); }
  else { console.log(`PASS G${id}: ${name}`); scenarios.push({id,name,status:'SOURCE-VERIFIED',evidence}); }
}
function external(id,name,status,evidence){ console.log(`${status} G${id}: ${name}`); scenarios.push({id,name,status,evidence}); }

verify(1,'2 user sửa cùng project: revision guard', rules.includes('lifecycleUpdateIsMonotonic') && firebase.includes('runTransaction'), 'rules + Firestore transaction/revision path');
verify(2,'PC + điện thoại dùng cùng source/version core', read('src/config/appVersion.ts').includes('__APP_VERSION__') && read('android-wrapper/build-apk.ps1').includes('package.json') && read('desktop-wrapper/build-launcher.ps1').includes('package.json'), 'package.json canonical version');
verify(3,'Điện thoại offline sửa rồi reconnect', firebase.includes('persistentLocalCache()') && app.includes("projectRoleSource === 'offline-cache'") && app.includes('saveProjectDiffsToCloud'), 'Firestore persistence + verified role lease + diffs');
verify(4,'Mất mạng khi đang ở mặt bằng không blank', app.includes('loadProjectFromFirestoreCache(projectId)') && app.includes('if (!isProjectRoleResolved)'), 'role-gated official Firestore cache hydrate');
verify(5,'Reload browser offline', firebase.includes('getDocsFromCache') && app.includes('getRememberedVerifiedAuthIdentity()'), 'Firestore cache + remembered verified identity');
verify(6,'Xóa hạng mục không ghost trên mặt bằng', category.includes('operationalWorkCategoryCatalog') && category.includes('getOperationalRoomSubItems'), 'active WorkVolume catalog filter');
verify(7,'Restore hạng mục uses explicit lifecycle', rules.includes("request.resource.data.deleted == true") && app.includes('restoreTrashOperation'), 'soft-delete/restore flow');
verify(8,'Xóa căn soft-delete/tombstone path', rules.includes("isCoreBusinessCollection") && rules.includes('allow delete: if collectionName') && app.includes('trashDeletedItems'), 'core hard delete denied + trash capture');
verify(9,'Restore căn không overwrite newer edit', app.includes('Never overwrite a record another user edited after this delete operation'), 'restore timestamp guard');
verify(10,'Thêm defect + ảnh object storage', photo.includes('uploadProjectBinaryToCloud') && photo.includes('stagePhotoMetadataForCloud'), 'provider upload + Firestore metadata');
verify(11,'PC/tài khoản khác nhận và hiển thị ảnh realtime', photo.includes('photoSnapshotMergeQueue') && photoStorage.includes('__pendingWrite') && photoStorage.includes("raw.startsWith('r2:')") && photoStorage.includes("raw.startsWith('storage:')") && photoStorage.includes('projectIdHint') && photoPicker.includes('getPhotoDataUrl(p.id, p.cloudUrl || p.cloudFileId, true, projectId)'), 'serialized realtime metadata + server ack outbox + authenticated R2/Storage lazy binary resolver');
verify(12,'Viewer không ghi', rules.includes('canEdit(projectId)') && security.includes("if (FIREBASE_ONLY_RUNTIME) return 'VIEWER'"), 'Rules authoritative, local global role cannot grant');
verify(13,'Editor không đổi quyền', rules.includes('isCanonicalMemberRole') && rules.includes('allow create, update: if (') && read('src/components/SecurityModal.tsx').includes('saveProjectMemberToCloud'), 'membership admin rules');
verify(14,'Admin thêm user', rules.includes('isAdmin(projectId)') && read('src/lib/firebase.ts').includes('saveProjectMemberToCloud'), 'admin membership write');
const warehouseIntegrated = app.includes('commitWarehouseTransactionAtomic')
  && app.includes('updateWarehouseTransactionAtomic')
  && app.includes('softDeleteWarehouseTransactionAtomic');
if (warehouseIntegrated) {
  verify(15,'Nhập kho đồng thời atomic service wired to UI', warehouse.includes('runTransaction'), 'ledger + balance Firestore transaction');
  verify(16,'Xuất kho đồng thời / không âm wired to UI', warehouse.includes('INSUFFICIENT_STOCK') && warehouse.includes('nextOnHand < -1e-9'), 'online atomic balance check');
} else {
  external(15,'Nhập kho đồng thời atomic service','REVIEW','transaction engine exists but legacy inventory UI/autosave is not fully cut over yet');
  external(16,'Xuất kho đồng thời / không âm','REVIEW','strict transaction engine must replace every legacy inventory write path before runtime verification');
}
verify(17,'Offline OUT không giả đảm bảo tồn kho', warehouse.includes('STRICT_STOCK_OFFLINE_BLOCKED'), 'strict global stock invariant blocks offline OUT');
verify(18,'Import backup không dùng làm realtime source', app.includes('Import Firebase-only cần có mạng') && app.includes('await saveProjectToCloud'), 'manual import → Firestore, legacy local writes gated');
verify(19,'Reconnect không nhân đôi ID', firebase.includes('UPSERT-only') && warehouse.includes('duplicate: true'), 'immutable IDs / idempotent transaction IDs');
verify(20,'Legacy schema dry-run before migration', fs.existsSync('scripts/firebase-only-legacy-audit.mjs') && workflow.includes('DEV Firebase isolation gate'), 'migration audit + isolated DEV gate');
verify(21,'Khôi phục backup có thể phục hồi record đã xóa nhưng chỉ qua ADMIN explicit restore',
  app.includes('authoritativeBackupRestore: options?.authoritativeBackupRestore === true')
    && projectManager.includes("authoritativeBackupRestore: action === 'OVERWRITE_FILE'")
    && firebaseBase.includes("restoreRole.role !== 'ADMIN'")
    && firebaseBase.includes('!authoritativeBackupRestore && currentCloud')
    && firebaseBase.includes('Only IDs present in the backup are'),
  'OVERWRITE_FILE -> explicit authoritative restore; ADMIN verified; Smart Merge/newer-cloud guard unchanged otherwise');
verify(22,'Restore backup lớn chia Firestore batch an toàn và không che lỗi gốc',
  firebaseBase.includes('if (operationCount >= 100)')
    && firebaseBase.includes('Firestore Write Error:')
    && firebaseBase.includes('Lỗi lưu dự án lên đám mây ('),
  'full restore <=100 writes/batch; preserve Firestore code/message for diagnosis');
verify(23,'Authoritative Restore fail-closed nếu không đọc được lifecycle Cloud hiện tại',
  firebaseBase.includes('Firestore restore failed reading current')
    && firebaseBase.includes("restore-read-failed")
    && firebaseBase.includes('if (authoritativeBackupRestore)'),
  'không được nuốt permission/read error rồi ghi đè với revision giả định');

verify(24,'Restore work volume tách business lifecycle khỏi ADMIN-only financial batch',
  firebaseBase.includes('work_volumes/${String(item.id)}')
    && firebaseBase.includes('restore-financial-write-failed')
    && firebaseBase.includes('commitWorkVolumeRestoreFinancial')
    && firebaseBase.includes('financialBatch.commit()'),
  'permission-denied phải chỉ đúng work_volumes/<id> hoặc work_volume_financials/<id>, không gộp mơ hồ');
verify(25,'Restore dọn unitPrice legacy mà không làm mất đơn giá',
  firebaseBase.includes("const hasLegacyUnitPrice = cloudName === 'work_volumes'")
    && firebaseBase.includes('removeLegacyWorkVolumeUnitPrice')
    && firebaseBase.includes('unitPrice: deleteField()')
    && firebaseBase.includes('normalizeUnitPrice(currentCloud.unitPrice)')
    && (firebaseBase.match(/canWriteFinancials = true;/g) || []).length >= 2,
  'ADMIN verified -> preserve financial first -> delete only legacy business-field copy');
verify(26,'Backup JSON v4 export/import giữ tương thích v3 và financial isolation',
  projectManager.includes('schemaVersion: 4')
    && projectManager.includes('Number(exportedData.schemaVersion || 0) >= 3')
    && projectManager.includes('sharedSettings: normalized.sharedSettings')
    && app.includes('await saveProjectSharedSettings(pid, settingsToRestore)')
    && dataNormalizer.includes('declaredSchemaVersion >= 3')
    && dataNormalizer.includes("obj.backupType === 'primary-drive-project'")
    && liveBackendGolden.includes('Backup v4 WorkVolume round-trip PASS')
    && liveBackendGolden.includes('Restore legacy work_volumes permission-denied regression PASS'),
  'v3 remains readable; v4 is labeled/detected correctly; live DEV round-trip verifies WorkVolume price isolation');

verify(27,'Backup v4 sharedSettings không rơi ở CREATE/SMART MERGE và không rollback settings mới hơn',
  projectManager.includes("sharedSettingsRestoreMode?: 'create' | 'replace' | 'merge-newer'")
    && projectManager.includes("action === 'SMART_MERGE'")
    && projectManager.includes("? 'merge-newer'")
    && projectManager.includes("? 'create'")
    && app.includes("options?.sharedSettingsRestoreMode === 'merge-newer'")
    && app.includes('fetchProjectSharedSettingsSnapshot(pid, true)')
    && app.includes('incomingSettingsTime <= currentSettingsTime')
    && dataNormalizer.includes('Preserve backup v4 project-scoped shared settings through the merge payload')
    && dataNormalizer.includes('merged.sharedSettings = { ...incomingData.sharedSettings }'),
  'CREATE/new-copy restore settings; SMART MERGE only applies newer settings; OVERWRITE remains explicit authoritative restore');

verify(28,'Windows/Android DEV rebuild khi JSON restore Golden thay đổi',
  windowsDevWorkflow.includes("'scripts/firebase-only-golden.mjs'")
    && windowsDevWorkflow.includes("'scripts/structure-group-golden.ts'")
    && androidDevWorkflow.includes("'scripts/firebase-only-golden.mjs'")
    && androidDevWorkflow.includes("'scripts/structure-group-golden.ts'"),
  'platform DEV workflows follow the JSON restore regression gates so EXE/APK cannot stay stale after a Golden-only fix');

verify(29,'Windows/Android DEV rebuild khi FloorPlan Golden thay đổi',
  windowsDevWorkflow.includes("'scripts/floorplan-p0-golden.ts'")
    && androidDevWorkflow.includes("'scripts/floorplan-p0-golden.ts'"),
  'platform DEV workflows follow floor-plan regression gates so shared drawing/fullscreen navigation fixes cannot ship with stale EXE/APK');

verify(30,'Dự án hoàn thành có Archive riêng, không xóa Firestore/R2',
  firebaseBase.includes('export async function setProjectArchivedState')
    && firebaseBase.includes('archivedAt: archived ? now : null')
    && firebaseBase.includes("roleInfo.role !== 'ADMIN'")
    && !firebaseBase.includes('deleteProjectPhotos(projectId)'),
  'ADMIN-only root metadata archive; business collections/media remain untouched');

verify(31,'Dự án đã Archive không vào Home/Chat danh sách hoạt động',
  app.includes('const activeRemoteProjects = remoteProjects.filter')
    && app.includes('Number(project.archivedAt || 0) <= 0')
    && app.includes('archivedAt: Number(remoteProject.archivedAt || 0) || undefined'),
  'discovery keeps archive metadata in cache while active navigation filters archived projects');

verify(32,'Project Manager tách Đang hoạt động và Đã lưu trữ',
  projectManager.includes("const [projectViewMode, setProjectViewMode] = useState<'active' | 'archived'>('active')")
    && projectManager.includes('Đã lưu trữ ({archivedProjectCount})')
    && projectManager.includes('handleArchiveProject(proj, false)')
    && projectManager.includes('handleArchiveProject(proj, true)'),
  'archived projects remain recoverable from a dedicated list without loading them into normal navigation');

// These require a real isolated Firebase DEV project and physical devices; source checks are
// not mislabeled as runtime VERIFIED.
external('E1','Multi-device DEV runtime matrix','REVIEW','requires configured DEV/R2 gateway and PC+Android');
external('E2','Legacy Drive/Storage → R2 count/checksum parity','BLOCKED','production legacy inventory/checksum not supplied to migration runner');
external('E3','Full emulator Rules behavior','REVIEW','npm run test:rules must run firebase-tools emulators');

if (process.exitCode) process.exit(process.exitCode);
console.log('FIREBASE-ONLY GOLDEN SOURCE MATRIX PASS (external items remain REVIEW/BLOCKED by design)');
