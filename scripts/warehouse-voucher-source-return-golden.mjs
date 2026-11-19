import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(path, 'utf8');
const warehouse = read('src/components/WarehouseTab.tsx');
const crew = read('src/components/CrewTabBase.tsx');
const app = read('src/App.tsx');

// One visible, accessible action on the *focused voucher*, never a distant toolbar.
assert.match(warehouse, /expandedInventoryId === item\.id && catalogVoucherReturn\?\.projectId === currentProjectId/, 'catalog return button must be on expanded voucher');
assert.match(warehouse, /data-hnl-voucher-return-origin="catalog-history"/, 'catalog voucher renders its own Back');
assert.match(warehouse, /data-hnl-voucher-return-origin="crew-statistics"/, 'crew voucher renders its own Back');
assert.match(warehouse, /<ContextBackButton label="Thống kê Căn\/Phòng & Defect" onClick=\{onReturnFromSourceVoucher\}/, 'crew return label and action');
assert.match(warehouse, /<ContextBackButton label=\{catalogVoucherReturn\.history\.type === 'in' \? 'Chi tiết nhập kho' : 'Chi tiết xuất kho'\}/, 'catalog return matches in/out source');

// Catalog drilldown must preserve the old table and transaction view, dates, focus and filters.
for (const key of ['history: catalogHistory', 'start: catalogHistoryStart', 'end: catalogHistoryEnd', 'expandedDate: expandedHistoryDate', 'historyScrollTop:', 'sheetScrollTop:', 'transactionType: filterType', 'kindFilter: inventoryKindFilter']) {
  assert.ok(warehouse.includes(key), 'catalog source snapshot missing ' + key);
}
for (const cmd of ['setCatalogHistory(previous.history)', 'setCatalogHistoryStart(previous.start)', 'setCatalogHistoryEnd(previous.end)', 'setExpandedHistoryDate(previous.expandedDate)', 'setSearchTerm(previous.search)', 'setFilterType(previous.transactionType)', 'setInventoryKindFilter(previous.kindFilter)']) {
  assert.ok(warehouse.includes(cmd), 'catalog return state missing ' + cmd);
}
assert.match(warehouse, /data-hnl-catalog-voucher-history-list="true"/, 'restore history inner scroll');
assert.match(warehouse, /catalogHistoryViewportReturnRef\.current = \{/, 'save original history scroll and focus');
assert.match(warehouse, /target\?\.focus\(\{ preventScroll: true \}\)/, 'return focus to source voucher');
assert.match(warehouse, /pageScrollY: window\.scrollY/, 'capture outer Warehouse scroll before opening voucher');
assert.match(warehouse, /window\.scrollTo\(0, pending\.pageScrollY\)/, 'return must restore outer Warehouse scroll');
assert.match(warehouse, /previous\.projectId !== currentProjectId/, 'cross-project catalog return prevented');

// Crew detail return must persist on mobile remount and restore on PC without writing.
assert.match(crew, /rememberCrewDetailForReturn\(\);[\s\S]{0,140}onOpenWarehouseVoucher\(voucherId, origin\)/, 'crew UI snapshot sent to App before navigation');
assert.doesNotMatch(crew.slice(crew.indexOf('const openTeamWarehouseVoucher'), crew.indexOf('const openRoomOnFloorPlan')), /setSelectedTeamForDetail\(null\)/, 'PC team modal stays mounted behind Warehouse for exact Back');
assert.match(crew, /viewport: \{ scrollTop: body\?\.scrollTop \|\| 0, openMaterialKeys, openEquipmentKeys, pageScrollY: window\.scrollY \}/, 'capture crew body, equipment/material rows and page scroll');
assert.match(crew, /teamMaterialSortBy, teamMaterialSortOrder/, 'persist material sorting');
assert.match(crew, /data-hnl-crew-team-modal-body="true"/, 'crew scroll restoration target');
assert.match(crew, /data-hnl-team-material-voucher-details=\{line\.materialKey\}/, 'crew source material details restoration');
assert.match(crew, /tx\.sourceTeamId === selectedTeamForDetail\.id/, 'crew source only for exact team id');
assert.match(crew, /if \(!saved\?\.restore\) return/, 'no unconditional session restore');
assert.match(app, /navigateFromLink\('warehouse', 'crew-voucher'\)/, 'typed crew voucher return context');
assert.match(app, /frame\.kind === 'crew-detail' \|\| frame\.kind === 'crew-voucher'/, 'crew modal session restoration triggered on Back');
assert.match(app, /onReturnFromSourceVoucher=\{contextReturnFrames\.length > 0/, 'App only shows cross-module Back for recorded source');
assert.match(app, /setWarehouseVoucherFocus\(null\)/, 'clear single-use deep-link after either Back action');
assert.match(app, /setCrewVoucherReturnRequest\(previous => \(\{/, 'App retains mobile return request without sessionStorage');
assert.match(app, /onReturnFromSourceVoucher=\{contextReturnFrames\.length > 0[\s\S]{0,250}\? handleContextReturn/, 'card and header Back route through same handler');
assert.match(crew, /const handledVoucherReturnRef = useRef/, 'mobile return is idempotent per request token');
assert.match(crew, /voucherReturnRequest\.projectId !== projectId/, 'never restore a crew modal from another project');
assert.match(crew, /onVoucherReturnRestored\?\.\(voucherReturnRequest\.token\)/, 'consume App-held return request once');
assert.match(warehouse, /hasEditAccess && onUpdateInventory && \(!item\.warehouseTransferId \|\| canAmendTransfer\(item\)\)/, 'original voucher Edit RBAC and transfer guard unchanged');

// UI-only callbacks and no Firestore mutation.
const navigator = warehouse.slice(warehouse.indexOf('const returnFromCatalogVoucher'),warehouse.indexOf('const openCreateInventory'));
assert.doesNotMatch(navigator, /onUpdateInventory\(|onAddInventory\(|updateDoc\(|setDoc\(|deleteDoc\(/, 'Back must never write to database');
console.log('HNL SOURCE VOUCHER RETURN GOLDEN PASS: visible Back, catalog filters, crew mobile modal state, role and project guards');
