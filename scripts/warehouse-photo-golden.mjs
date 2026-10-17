import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectAuthoritativeRestorePhotos } from '../src/utils/backupRestoreMedia.ts';

const read = path => fs.readFileSync(path, 'utf8');
const warehouse = read('src/components/WarehouseTab.tsx');
const photoStorage = read('src/utils/photoStorage.ts');
const photoPicker = read('src/components/PhotoAttachmentPicker.tsx');
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
// launch the full-screen viewer; only the separate pencil opens photo management.
assert(warehouse.includes('data-hnl-warehouse-photo-status={item.id}'), 'Each voucher exposes its photo status');
assert(/data-hnl-warehouse-photo-status=\{item\.id\}[\s\S]*?<PhotoAttachmentPicker[\s\S]*?readOnly compactViewerButton/.test(warehouse), 'Warehouse status button uses the Crew read-only, full-screen photo viewer');
assert(!warehouse.includes('data-hnl-warehouse-photo-edit={item.id}'), 'Do not expose a redundant external photo editing button');
assert(warehouse.includes('onClick={() => openEditInventory(item)}'), 'Chỉnh phiếu remains the only edit entry for existing vouchers');
assert(warehouse.includes('data-hnl-warehouse-form-photos="true"'), 'Voucher editor retains its integrated photo manager');
assert(/editingInventory \? \(\s*<PhotoAttachmentPicker/.test(warehouse), 'Existing voucher photos remain editable inside Chỉnh phiếu');
assert(warehouse.includes('readOnly={!hasEditAccess}'), 'Photo editor still respects role permissions');
assert(warehouse.includes('data-hnl-warehouse-catalog-table="auto-width"'), 'Warehouse catalog uses shared content-sized columns');
const workVolume = read('src/components/WorkVolumeTab.tsx');
assert(workVolume.includes('w-max min-w-full table-auto whitespace-nowrap'), 'Volume detail columns must expand without wrapping');
assert(warehouse.includes('photoVoucher.projectId === currentProjectId && hasEditAccess'), 'Photo management modal stays protected when role changes');
assert(photoPicker.includes("isWarehouseVoucher ? 'Chưa có ảnh' : 'Chưa có ảnh hiện trường'"), 'Show a specific no-photo indicator for inventory vouchers');
assert(photoPicker.includes('`${photos.length} ảnh${pendingCount > 0'), 'Show a clickable count-only warehouse photo label with pending Cloud status preserved');
assert(photoPicker.includes('refreshWarehousePhotoMetadataOnce'), 'Many warehouse cards share a single metadata refresh instead of hammering Firestore');
assert(warehouse.includes('Chỉnh phiếu'), 'Editing the voucher itself remains a distinct action');
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
assert(rules.includes("collectionName == 'photos' && editorCreatesActiveOnly()"), 'EDITOR may create photo metadata through current rule');
assert(rules.includes("|| collectionName == 'photos'"), 'EDITOR photo update remains authorized');

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
