import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/WarehouseTab.tsx', 'utf8');
assert.match(source, /data-hnl-catalog-open-voucher=\{entry\.id\}/, 'history link must use immutable voucher ID');
assert.match(source, /onClick=\{\(\) => openCatalogHistoryVoucher\(entry\)\}/, 'history link navigates to voucher');
assert.match(source, /inventory\.find\(item => item\.id === entry\.id && item\.deletedAt == null/, 'revalidate source voucher against current project inventory');
assert.match(source, /setSearchTerm\(current\.id\)/, 'find voucher by ID, not product name');
assert.match(source, /setInventoryKindFilter\('all'\)/, 'other kind filters must not hide it');
assert.match(source, /setWarehouseFromDate\(''\)/, 'date filters must not hide it');
assert.match(source, /setWarehouseToDate\(''\)/, 'date filters must not hide it');
assert.match(source, /setExpandedInventoryId\(current\.id\)/, 'highlight exact voucher card');
assert.match(source, /data-hnl-warehouse-voucher-id=\{item\.id\}/, 'target must exist');
assert.match(source, /target\.focus\(\{ preventScroll: true \}\)/, 'keyboard focus moves to correct voucher');
assert.match(source, /if \(!hasEditAccess\) return;[\s\S]*?if \(item\.warehouseTransferId\) \{[\s\S]*?canAmendTransfer\(item\)/, 'Edit remains permission and transfer gated');
assert.match(source, /\{hasEditAccess && onUpdateInventory && \(!item\.warehouseTransferId \|\| canAmendTransfer\(item\)\)/, 'VIEWER cannot edit');
assert.doesNotMatch(source.slice(source.indexOf('const openCatalogHistoryVoucher'),source.indexOf('const openCreateInventory')), /onUpdateInventory\(|onAddInventory\(|setDoc\(|updateDoc\(/, 'view/navigation must not write data');
console.log('WAREHOUSE CATALOG VOUCHER LINK GOLDEN PASS: exact ID, view-only navigation, existing edit RBAC');
