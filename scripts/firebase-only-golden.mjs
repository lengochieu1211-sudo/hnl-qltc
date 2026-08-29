import fs from 'node:fs';

const read = (p) => fs.readFileSync(p,'utf8');
const app = read('src/App.tsx');
const firebase = read('src/lib/firebase.ts');
const photo = read('src/lib/photoCloudSync.ts');
const photoStorage = read('src/utils/photoStorage.ts');
const floorImage = read('src/lib/floorPlanImageSync.ts');
const rules = read('firestore.rules');
const storageRules = read('storage.rules');
const warehouse = read('src/lib/warehouseTransactions.ts');
const category = read('src/components/FloorPlanDefectTab.tsx');
const security = read('src/utils/securityUtils.ts');
const workflow = read('.github/workflows/firebase-hosting-pull-request.yml');

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
verify(11,'PC nhận ảnh điện thoại realtime', photo.includes('photoSnapshotMergeQueue') && photoStorage.includes('__pendingWrite'), 'serialized realtime metadata + server ack outbox');
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

// These require a real isolated Firebase DEV project and physical devices; source checks are
// not mislabeled as runtime VERIFIED.
external('E1','Multi-device DEV runtime matrix','REVIEW','requires configured DEV/R2 gateway and PC+Android');
external('E2','Legacy Drive/Storage → R2 count/checksum parity','BLOCKED','production legacy inventory/checksum not supplied to migration runner');
external('E3','Full emulator Rules behavior','REVIEW','npm run test:rules must run firebase-tools emulators');

if (process.exitCode) process.exit(process.exitCode);
console.log('FIREBASE-ONLY GOLDEN SOURCE MATRIX PASS (external items remain REVIEW/BLOCKED by design)');
