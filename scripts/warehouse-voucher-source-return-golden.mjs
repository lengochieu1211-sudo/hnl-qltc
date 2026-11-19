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
assert.match(warehouse, /pageY: window\.scrollY/, 'capture Warehouse scroll before jumping to voucher');
assert.match(warehouse, /window\.scrollTo\(\{ top: pending\.pageY, behavior: 'instant' \}\)/, 'restore Warehouse scroll behind source sheet');
assert.match(warehouse, /target\?\.focus\(\{ preventScroll: true \}\)/, 'return focus to source voucher');
assert.match(warehouse, /previous\.projectId !== currentProjectId/, 'cross-project catalog return prevented');

// Crew detail return must persist on mobile remount and restore on PC without writing.
assert.match(crew, /rememberCrewDetailForReturn\(\);[\s\S]{0,270}onOpenWarehouseVoucher\(voucherId\)/, 'crew source snapshot remembered before opening voucher');
const openTeamVoucher = crew.slice(crew.indexOf('const openTeamWarehouseVoucher'), crew.indexOf('const openRoomOnFloorPlan'));
assert.doesNotMatch(openTeamVoucher, /setSelectedTeamForDetail\(null\)/, 'keep team modal mounted on PC when viewing voucher');
assert.match(crew, /viewport: \{ scrollTop: body\?\.scrollTop \|\| 0, openMaterialKeys, openEquipmentKeys, pageY: window\.scrollY \}/, 'persist crew body scroll + opened material rows + source page');
assert.match(crew, /activeSubTab, selectedDate, teamListSortBy, teamListSortOrder/, 'persist source Crew list tab and filters');
assert.match(crew, /setActiveSubTab\(saved\.activeSubTab === 'teams' \? 'teams' : 'logs'\)/, 'mobile restores Crew list tab rather than defaulting to logs');
assert.match(crew, /selectedTeamForDetail\?\.id === team\.id && detailModalTab === saved\.tab/, 'desktop keeps original modal as-is');
assert.match(crew, /teamMaterialSortBy, teamMaterialSortOrder/, 'persist material sorting');
assert.match(crew, /data-hnl-crew-team-modal-body="true"/, 'crew scroll restoration target');
assert.match(crew, /data-hnl-team-material-voucher-details=\{line\.materialKey\}/, 'crew source material details restoration');
assert.match(crew, /data-hnl-team-equipment-voucher-details=\{line\.equipmentKey\}/, 'crew source equipment details restoration');
assert.match(crew, /tx\.sourceTeamId === selectedTeamForDetail\.id/, 'crew source only for exact team id');
assert.match(crew, /if \(!saved\?\.restore\) return/, 'no unconditional session restore');
assert.match(app, /navigateFromLink\('warehouse', 'crew-voucher', 'crew'\)/, 'source is explicitly Crew even while another navigation is pending');
assert.match(app, /if \(frame\.kind === 'crew-voucher'\) setWarehouseVoucherFocus\(null\)/, 'all Back paths discard single-use voucher request');
assert.match(app, /if \(!preserveContextReturn\) \{\s*setContextReturnFrames\(\[\]\);\s*setWarehouseVoucherFocus\(null\)/, 'normal module navigation cannot re-open an obsolete source voucher');
assert.match(app, /frame\.kind === 'crew-detail' \|\| frame\.kind === 'crew-voucher'/, 'crew modal session restoration triggered on Back');
assert.match(app, /onReturnFromSourceVoucher=\{contextReturnFrames\.length > 0/, 'App only shows cross-module Back for recorded source');
assert.match(app, /setWarehouseVoucherFocus\(null\); handleContextReturn\(\)/, 'clear single-use deep-link after return');
assert.match(warehouse, /hasEditAccess && onUpdateInventory && \(!item\.warehouseTransferId \|\| canAmendTransfer\(item\)\)/, 'original voucher Edit RBAC and transfer guard unchanged');

// UI-only callbacks and no Firestore mutation.
const navigator = warehouse.slice(warehouse.indexOf('const returnFromCatalogVoucher'),warehouse.indexOf('const openCreateInventory'));
assert.doesNotMatch(navigator, /onUpdateInventory\(|onAddInventory\(|updateDoc\(|setDoc\(|deleteDoc\(/, 'Back must never write to database');
console.log('HNL SOURCE VOUCHER RETURN GOLDEN PASS: visible Back, catalog filters, crew mobile modal state, role and project guards');
