import assert from 'node:assert/strict';
import { COMMON_CATEGORIES, listWarehouseMaterialCategories, resolveWarehouseMaterialCategory } from '../src/utils/warehouseMaterialCategory.ts';
import fs from 'node:fs';
import { selectAuthoritativeRestorePhotos } from '../src/utils/backupRestoreMedia.ts';
import { warehouseVoucherIsoDate, matchesWarehouseVoucherDate, isWarehouseVoucherDateInRange } from '../src/utils/warehouseVoucherDateFilter.ts';

const read = path => fs.readFileSync(path, 'utf8');
const warehouse = read('src/components/WarehouseTab.tsx');
const photoStorage = read('src/utils/photoStorage.ts');
const photoPicker = read('src/components/PhotoAttachmentPicker.tsx');
const imageViewer = read('src/components/ImageViewerModal.tsx');
assert(imageViewer.includes("shareText = 'Ảnh hiện trường từ HNL QLTC'"), 'Defect and Crew image shares retain their existing default text');
assert(imageViewer.includes('text: shareText,'), 'Image viewer sends configurable caption to native/browser share');
assert.equal((photoPicker.match(/shareText=\{entityType === 'inventory' \? '' : undefined\}/g) || []).length, 2, 'Warehouse voucher photo viewers must share image without generic field-photo caption');
const cloudSync = read('src/lib/photoCloudSync.ts');
const r2 = read('src/lib/r2Storage.ts');
const rules = read('firestore.rules');
const app = read('src/App.tsx');

assert(photoStorage.includes("'crewRecord' | 'defect' | 'chat' | 'inventory'"), 'Warehouse must be a distinct photo entity type');
assert(photoStorage.includes("'warehouse_receipt'"), 'Warehouse media must have its own photo category');
assert(photoPicker.includes("'crewRecord' | 'defect' | 'chat' | 'inventory'"), 'Photo viewer and uploader must accept warehouse vouchers');
assert(photoPicker.includes("'defect_before' | 'defect_after' | 'warehouse_receipt'"), 'Picker must filter warehouse attachments from other categories');
assert(warehouse.includes('data-hnl-warehouse-photo-modal="true"'), 'Warehouse must have a photo gallery');
assert(warehouse.includes('data-hnl-warehouse-photo-voucher={item.id}'), 'Existing voucher must expose a photo action');
// Warehouse vouchers reuse Crew's read-only image-count chip. Opening the chip must
// launch the full-screen viewer; photo editing stays inside the protected Chỉnh phiếu form.
assert(warehouse.includes('data-hnl-warehouse-photo-status={item.id}'), 'Each voucher exposes its photo status');
assert(/data-hnl-warehouse-photo-status=\{item\.id\}[\s\S]*?<PhotoAttachmentPicker[\s\S]*?readOnly compactViewerButton/.test(warehouse), 'Warehouse status button uses the Crew read-only, full-screen photo viewer');
assert(!warehouse.includes('data-hnl-warehouse-photo-edit={item.id}'), 'Do not expose a redundant external photo editing button');
assert(warehouse.includes('onClick={() => openEditInventory(item)}'), 'Chỉnh phiếu remains the only edit entry for existing vouchers');
assert(warehouse.includes('data-hnl-warehouse-form-photos="true"'), 'Voucher editor retains its integrated photo manager');
assert(/editingInventory \? \(\s*<PhotoAttachmentPicker/.test(warehouse), 'Existing voucher photos remain editable inside Chỉnh phiếu');
assert(warehouse.includes('readOnly={!hasEditAccess}'), 'Photo editor still respects role permissions');
assert(warehouse.includes('data-hnl-warehouse-catalog-table="auto-width"'), 'Warehouse catalog uses shared content-sized columns');
// Date search must remain read-only and compose with existing voucher name, ID, kind and direction filters.
assert(warehouse.includes('matchesWarehouseVoucherDate(item.date, q)'), 'Search matches voucher calendar dates');
assert(warehouse.includes('isWarehouseVoucherDateInRange(item.date, warehouseFromDate, warehouseToDate)'), 'Date range composes with journal filters');
assert(warehouse.includes('data-hnl-warehouse-date-from="true"') && warehouse.includes('data-hnl-warehouse-date-to="true"'), 'Mobile/desktop date inputs are present');
assert(warehouse.includes('Xóa lọc ngày'), 'Date range can be cleared without clearing search text');
assert.equal(warehouseVoucherIsoDate('2026-10-17'), '2026-10-17');
assert.equal(warehouseVoucherIsoDate('17/10/2026'), '2026-10-17');
assert.equal(warehouseVoucherIsoDate('31/02/2026'), '', 'Invalid dates must not match');
for (const text of ['17/10/2026', '17-10-2026', '2026-10-17', '10/2026', '2026']) {
  assert(matchesWarehouseVoucherDate('2026-10-17', text), `Date search does not match ${text}`);
}
assert(!matchesWarehouseVoucherDate('2026-10-16', '17/10/2026'));
assert(isWarehouseVoucherDateInRange('2026-10-17', '2026-10-01', '2026-10-17'));
assert(!isWarehouseVoucherDateInRange('2026-10-17', '2026-10-18', ''));
assert(!isWarehouseVoucherDateInRange('2026-10-17', '2026-10-20', '2026-10-10'));
assert(isWarehouseVoucherDateInRange('17/10/2026', '2026-10-17', '2026-10-17'));
assert(!matchesWarehouseVoucherDate('2026-10-17', '2'), 'Do not treat a one-digit material code as a year query');
assert(!matchesWarehouseVoucherDate('2026-10-17', '20'), 'Do not treat a two-digit material code as a year query');
assert(!matchesWarehouseVoucherDate('2026-10-17', '202'), 'Do not fuzzy-match an incomplete year');
assert(!matchesWarehouseVoucherDate('2026-10-17', '2025'), 'Year search must be exact');
assert(matchesWarehouseVoucherDate('2026-10-17', '10/2026'), 'Month/year should be exact');
assert(!matchesWarehouseVoucherDate('2026-10-17', '11/2026'), 'Different month must not match');
assert(warehouse.includes("setWarehouseFromDate('');") && warehouse.includes("setWarehouseToDate('');") && warehouse.includes("setSearchTerm('');"), 'Project switch should clear hidden voucher filters');
const shareSheet = read('src/components/WarehouseVoucherShareSheet.tsx');
assert(shareSheet.includes('isWarehouseVoucherDateInRange(x.date, start, end)'), 'Sharing and voucher list must share date normalization');
assert(shareSheet.includes('Bộ lọc chia sẻ độc lập'), 'Sharing scope must be clear to the user');
const crew = read('src/components/CrewTabBase.tsx');
const floorPlan = read('src/components/FloorPlanDefectTab.tsx');
const roomModal = read('src/components/RoomHighlightModal.tsx');
assert(crew.includes("qlct_pending_defect_navigation") && crew.includes("qlct-defect-navigation-request"), 'Team Defect click must notify already-mounted desktop FloorPlan');
assert(floorPlan.includes("window.addEventListener('qlct-defect-navigation-request'"), 'FloorPlan must observe the Defect navigation event');
assert(crew.includes('rememberCrewDetailForReturn();') && crew.includes("contextReturn: 'crew-detail'"), 'Team-origin context must persist until return');
assert(app.includes('onContextReturn={contextReturnFrames.length > 0'), 'Parent navigation stack must own the modal return');
assert(floorPlan.includes('data-hnl-defect-context-back="true"') && floorPlan.includes('sticky top-0'), 'Defect back button must remain visible during scroll');
assert(roomModal.includes('data-hnl-room-context-back="true"'), 'Room modal must have visible contextual return');
assert(photoPicker.includes('return selected.slice(savedNow.length)'), 'Partial photo uploads must retain only unsaved files');
assert(warehouse.includes('data-hnl-warehouse-photo-retry="true"'), 'Failed voucher-photo subset must have an explicit retry action');
assert(warehouse.includes('Ảnh được lưu ngay khi thêm, sửa hoặc xóa'), 'Independent photo-save behavior must be disclosed');


const workVolume = read('src/components/WorkVolumeTab.tsx');
assert(workVolume.includes('w-max min-w-full table-auto whitespace-nowrap'), 'Volume detail columns must expand without wrapping');
assert(warehouse.includes('photoVoucher.projectId === currentProjectId && hasEditAccess'), 'Photo management modal stays protected when role changes');
assert(photoPicker.includes("isWarehouseVoucher ? 'Chưa có ảnh' : 'Chưa có ảnh hiện trường'"), 'Show a specific no-photo indicator for inventory vouchers');
assert(photoPicker.includes('`${photos.length} ảnh${pendingCount > 0'), 'Show a clickable count-only warehouse photo label with pending Cloud status preserved');
assert(photoPicker.includes('refreshWarehousePhotoMetadataOnce'), 'Many warehouse cards share a single metadata refresh instead of hammering Firestore');
assert(warehouse.includes('onClick={() => openEditInventory(item)}') && warehouse.includes('<Edit2 className="w-3 h-3" /> Sửa'), 'Voucher edit is a separate, clearly labeled action');
assert(warehouse.includes('onClick={() => setDeletingInventoryTarget(item)}') && warehouse.includes('<Trash2 className="w-3 h-3" /> Xóa'), 'Voucher delete retains explicit action and consistent label');
assert(warehouse.includes('entityType="inventory" entityId={photoVoucher.id} category="warehouse_receipt"'), 'Gallery photos must bind to stable voucher ID');
assert(warehouse.includes('entityType="inventory" entityId={editingInventory.id} category="warehouse_receipt"'), 'Edit form must show existing voucher photos');
assert(warehouse.includes('readOnly={!hasEditAccess}'), 'VIEWER must have no upload or deletion controls');
assert(warehouse.includes('photoVoucher.projectId === currentProjectId'), 'Switching projects must not show photos under the new project ID');
assert(warehouse.includes('maxPhotos={10}'), 'Warehouse attachment count is capped to ten');
assert(warehouse.includes("const savedVoucherId = editingInventory?.id || createEntityId(type === 'in' ? 'NK' : 'XK')"), 'ID must be assigned before committing new warehouse voucher');
const saveStart = warehouse.indexOf('const savedVoucherId = editingInventory?.id');
const commit = warehouse.indexOf('await onAddInventory({ ...payload, id: savedVoucherId });', saveStart);
const photoOpen = warehouse.indexOf('setPhotoVoucher({ projectId: currentProjectId, id: savedVoucherId, type, materialName: finalMaterialName, initialFiles: [...pendingVoucherPhotos] });', commit);
const errorCatch = warehouse.indexOf('} catch (err: any) {', photoOpen);
assert(saveStart !== -1 && commit > saveStart && photoOpen > commit && errorCatch > photoOpen, 'Upload flow is unavailable until the stock transaction successfully commits');
// Only staged images should open the post-save photo modal. A photo-free voucher
// must return to the warehouse list (or continue mode) without a surprise modal.
const conditionalPhotoOpen = warehouse.indexOf('if (pendingVoucherPhotos.length > 0) {', commit);
assert(conditionalPhotoOpen > commit && conditionalPhotoOpen < photoOpen, 'Photo step only opens for staged photos after committing the voucher');
assert(/if \(pendingVoucherPhotos\.length > 0\) \{\s*setPhotoVoucher\(/.test(warehouse), 'Photo-free warehouse save must not open the gallery');
assert(warehouse.includes('data-hnl-warehouse-photo-actions="crew-sized"'), 'New warehouse voucher should use Crew-sized photo actions');
assert(warehouse.includes('<Camera className="h-3.5 w-3.5" /> Chụp ảnh'), 'Camera action must use Crew-sized icon and matching camera glyph');
assert(warehouse.includes('<Images className="h-3.5 w-3.5" /> Thư viện'), 'Library action must use Crew-sized icon');
assert(warehouse.includes('px-2.5 py-1 text-xs font-semibold'), 'Warehouse photo actions use the same compact padding/label scale as Crew');
assert(warehouse.includes('inventorySaveInFlightRef.current'), 'Duplicate submit attempts must not create duplicate vouchers');
assert(warehouse.includes('data-hnl-warehouse-staged-photos="true"'), 'New form supports optional camera/gallery draft selection before saving');
assert(warehouse.includes('setPendingVoucherPhotos([]);'), 'Photo drafts are cleared only after committing or deliberate cancel');
assert(warehouse.includes('initialFiles={photoVoucher.initialFiles}'), 'Staged files are handed to the existing photo picker only after voucher commit');
assert(photoPicker.includes('void processSelectedFiles(initialFiles)'), 'Staged files must reuse the existing R2/cloud-ready photo processing');
assert(!warehouse.includes('deleteEntityPhotos('), 'Soft deleting warehouse vouchers cannot eagerly delete recoverable photos');
assert(app.includes('commitWarehouseTransactionAtomic(activeProjectIdRef.current, normalized)'), 'Creation remains atomic, enforcing stock rules');
assert(app.includes('const newId = item.id || createEntityId'), 'App must preserve the explicit pre-allocated transaction ID');
assert(cloudSync.includes("binaryUploadState: 'ready'"), 'Photo metadata must not publish before durable binary verification');
assert(r2.includes('safeSegment(input.entityType)'), 'R2 path namespacing must use photo entity type');
assert(rules.includes('match /photos/{photoId}') && rules.includes('editorCreatesActiveOnly()'), 'EDITOR may create photo metadata through current rule');
assert(rules.includes('editorPhotoMetadataUpdateOnly(projectId, photoId)'), 'EDITOR photo update remains authorized only through namespace/identity guard');
assert(rules.includes('function editorPhotoMetadataUpdateOnly('), 'Photo metadata Rule must enforce entity/pointer identity');

const photoRows = [
  {id:'W1',entityType:'inventory',entityId:'NK-A'},
  {id:'W2',entityType:'inventory',entityId:'XK-B'},
  {id:'W-OLD',entityType:'inventory',entityId:'NK-OTHER-PROJECT'},
  {id:'C1',entityType:'crewRecord',entityId:'C-A'},
  {id:'D1',entityType:'defect',entityId:'D-A'},
  {id:'CHAT',entityType:'chat',entityId:'CHAT-A'},
];
const payload = {inventory:[{id:'NK-A'},{id:'XK-B'}],crewRecords:[{id:'C-A'}],defects:[{id:'D-A'}]};
const selected = selectAuthoritativeRestorePhotos(photoRows,payload);
assert.deepEqual(selected.photos.map(p=>p.id),['W1','W2','C1','D1','CHAT'], 'Import may keep only photos whose voucher/crew/defect parent exists');
assert.deepEqual(selected.skippedParentless.map(p=>p.id),['W-OLD'], 'Import rejects orphan images from an old warehouse voucher');
assert.deepEqual(selectAuthoritativeRestorePhotos(photoRows,{}).photos.map(p=>p.id),['CHAT'], 'Empty overwrite must not reanimate warehouse/crew/defect images');
const legacyAudit = read('scripts/firebase-only-legacy-audit.mjs');
assert(legacyAudit.includes("if (p.entityType === 'inventory') return !inventoryIds.has"), 'Audit recognizes missing inventory photo parent');
assert(legacyAudit.includes('new Set(collections.inventory.map'), 'Soft-deleted voucher photos must remain recoverable in legacy audit');
console.log('WAREHOUSE PHOTO GOLDEN PASS – stage-first/commit-before-upload, ID, RBAC, R2, restore, no ledger mutation');

// Voucher inline material creation must share the category vocabulary with Norms,
// without introducing a second collection or allowing unnamed categories.
const existingCategories = listWarehouseMaterialCategories([
  { category: 'Khung xương' },
  { category: '  Vật tư điện   ' },
  { category: 'vật tư điện' },
  { category: 'Sơn bả & Mối nối' },
]);
assert(COMMON_CATEGORIES.every((cat) => existingCategories.includes(cat)), 'Built-in categories match Material Norm editor');
assert.equal(existingCategories.filter((cat) => cat === 'Vật tư điện').length, 1, 'Catalog categories dedupe with stable labels');
assert.equal(resolveWarehouseMaterialCategory('Khung xương', '', existingCategories), 'Khung xương');
assert.equal(resolveWarehouseMaterialCategory('__new__', '  KHUNG  XUONG  ', existingCategories), 'Khung xương', 'New alias reuses original category label');
assert.equal(resolveWarehouseMaterialCategory('__new__', '  Vật tư sơn   điện  ', existingCategories), 'Vật tư sơn điện');
assert.equal(resolveWarehouseMaterialCategory('__new__', '  ', existingCategories), null, 'Blank new category is rejected');
assert.equal(resolveWarehouseMaterialCategory('', '', existingCategories), null, 'Missing selection is rejected');
assert.equal(resolveWarehouseMaterialCategory('Nhóm không tồn tại', '', existingCategories), null, 'Stale/fabricated category is rejected');
assert(warehouse.includes('data-hnl-warehouse-material-category="true"'), 'Voucher has category selector');
assert(warehouse.includes('data-hnl-warehouse-new-category="true"'), 'Voucher shows custom category field');
assert(warehouse.includes("materialCategorySelection === '__new__'"), 'Custom category field is gated by explicit new selection');
assert(warehouse.includes('const finalMaterialCategory = resolveWarehouseMaterialCategory('), 'Catalog category is validated prior to save');
assert(warehouse.includes('category: finalMaterialCategory,'), 'Material catalog reuses selected/resolved category');
assert(warehouse.includes('if (!hasNormManageAccess)'), 'Only norm-managing ADMIN may create material catalog items');
assert(warehouse.includes('if (existingMaterial || exactNormMaterialIds.length > 0)'), 'Existing name + unit prevents duplicate material IDs');
assert(warehouse.includes('customMaterial.trim() && !editingKeepsLegacyMaterialIdentity'), 'Legacy voucher edit must not be forced to create a category');
console.log('WAREHOUSE MATERIAL CATEGORY GOLDEN PASS – existing/new selection, canonical names, RBAC, non-duplication');
