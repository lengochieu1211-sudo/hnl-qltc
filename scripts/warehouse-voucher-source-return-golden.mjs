import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(path, 'utf8');
const warehouse = read('src/components/WarehouseTab.tsx');
const crew = read('src/components/CrewTabBase.tsx');
const app = read('src/App.tsx');

// Exactly one Back action per navigation context: the App header for Crew,
// the voucher card for Warehouse catalog history (no cross-module App frame).
assert.match(warehouse, /expandedInventoryId === item\.id && catalogVoucherReturn\?\.projectId === currentProjectId/, 'catalog return button must be on expanded voucher');
assert.match(warehouse, /data-hnl-voucher-return-origin="catalog-history"/, 'catalog voucher renders a single Back');
assert.match(warehouse, /<ContextBackButton label=\{catalogVoucherReturn\.history\.type === 'in' \? 'Chi tiết nhập kho' : 'Chi tiết xuất kho'\}/, 'catalog return matches in/out source');
assert.equal((warehouse.match(/<ContextBackButton\b/g) || []).length, 1, 'Warehouse card has exactly one conditional Back button');
assert.doesNotMatch(warehouse, /data-hnl-voucher-return-origin="crew-statistics"|onReturnFromSourceVoucher/, 'Crew voucher must not render a duplicate lower Back');
assert.match(app, /data-hnl-cross-module-return="true"/, 'App retains shared header Back');
assert.match(app, /frame\.kind === 'crew-voucher'/, 'Crew navigation returns from header through contextual stack');
assert.equal((app.match(/<ContextBackButton\b/g) || []).length, 1, 'App header has exactly one shared Back control');

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
assert.match(app, /contextReturnFrames\.length > 0 && contextReturnFrames\[contextReturnFrames\.length - 1\]\.projectId === activeProjectId/, 'App only shows header Back for recorded same-project source');
assert.match(app, /setWarehouseVoucherFocus\(null\)/, 'clear single-use deep-link after either Back action');
assert.match(app, /token: \+\+warehouseVoucherFocusSequenceRef\.current/, 'a second source voucher must have a new focus token');
assert.match(app, /token: \+\+crewVoucherReturnSequenceRef\.current/, 'a second Back must have a new return token');
assert.match(warehouse, /crewVoucherWarehouseOriginRef\.current = \{/, 'capture original Warehouse filters before temporary voucher search');
const crewReturnRestore = warehouse.slice(
  warehouse.indexOf('if (focusVoucher || !crewVoucherWarehouseOriginRef.current) return'),
  warehouse.indexOf('  useEffect(() => {\n    if (!isActive || !showWarehouseCatalog || !crewVoucherCatalogScrollRestoreRef.current)')
);
for (const action of ['setSearchTerm(previous.search)', 'setWarehouseFromDate(previous.fromDate)',
  'setWarehouseToDate(previous.toDate)', 'setFilterType(previous.transactionType)',
  'setInventoryKindFilter(previous.kindFilter)', 'setExpandedInventoryId(previous.expandedVoucherId)']) {
  assert.ok(crewReturnRestore.includes(action), 'Crew Back must restore Warehouse state: ' + action);
}
assert.match(crewReturnRestore, /previous\.projectId !== currentProjectId/, 'Crew Back must never restore another project');
assert.match(warehouse, /crewVoucherCatalogReopenRef\.current = previous\.showCatalog && !isActive/, 'do not reopen catalog portal over Crew on PC');
assert.match(warehouse, /if \(focusVoucher \|\| !crewVoucherWarehouseOriginRef\.current\) return/, 'restore only after App clears source focus');
assert.match(app, /setCrewVoucherReturnRequest\(\{[\s\S]{0,120}token: \+\+crewVoucherReturnSequenceRef\.current/, 'App retains mobile return request without sessionStorage');
assert.match(app, /<ContextBackButton[\s\S]{0,900}onClick=\{handleContextReturn\}/, 'Crew voucher returns through the single App header Back');
assert.match(crew, /const handledVoucherReturnRef = useRef/, 'mobile return is idempotent per request token');
assert.match(crew, /voucherReturnRequest\.projectId !== projectId/, 'never restore a crew modal from another project');
assert.match(crew, /onVoucherReturnRestored\?\.\(voucherReturnRequest\.token\)/, 'consume App-held return request once');
assert.match(warehouse, /hasEditAccess && onUpdateInventory && \(!item\.warehouseTransferId \|\| canAmendTransfer\(item\)\)/, 'original voucher Edit RBAC and transfer guard unchanged');

// UI-only callbacks and no Firestore mutation.
const navigator = warehouse.slice(warehouse.indexOf('const returnFromCatalogVoucher'),warehouse.indexOf('const openCreateInventory'));
assert.doesNotMatch(navigator, /onUpdateInventory\(|onAddInventory\(|updateDoc\(|setDoc\(|deleteDoc\(/, 'Back must never write to database');
console.log('HNL SOURCE VOUCHER RETURN GOLDEN PASS: one Back per context, catalog filters, crew mobile modal state, role and project guards');
