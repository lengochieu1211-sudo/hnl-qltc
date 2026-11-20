import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(path, 'utf8');
const warehouse = read('src/components/WarehouseTab.tsx');
const crew = read('src/components/CrewTabBase.tsx');
const app = read('src/App.tsx');
const detail = read('src/components/WarehouseVoucherDetailSheet.tsx');

// The direct voucher sheet owns the only visible Back: it replaces the earlier
// card Back and the cross-module sticky header is hidden while the sheet is open.
assert.match(warehouse, /directVoucherId && !voucherShareOpen && !showAddForm && !transferEditItem/, 'read-only sheet only when no original editor active');
assert.match(warehouse, /const directVoucherCanEdit = Boolean\(directVoucher && hasEditAccess/, 'only verified project editors can open original warehouse editor');
assert.match(warehouse, /handledDirectVoucherEditorKeyRef\.current = directVoucherEditorKey;[\s\S]{0,230}openEditInventory\(directVoucher\)/, 'source voucher opens existing editor on first navigation');
assert.match(warehouse, /data-hnl-original-voucher-editor=\{directVoucherId && editingInventory\?\.id === directVoucherId/, 'original edit form exposes exact opened voucher ID');
assert.match(warehouse, /editingInventory && \(!onUpdateInventory \|\| editingInventory\.deletedAt != null/, 'edit refuses missing update handler or deleted voucher (no accidental insert)');
assert.match(warehouse, /directVoucherId && editingInventory\?\.id === directVoucherId \?[\s\S]{0,120}<ContextBackButton label=\{directVoucherBackLabel\} onClick=\{closeOriginalVoucherForm\}/, 'one Back from original edit form');
assert.match(warehouse, /if \(directVoucherId && editingInventory\?\.id === directVoucherId\) closeDirectVoucher\(\)/, 'after successful edit return to original source');
assert.match(warehouse, /directVoucher\.warehouseTransferId \? canAmendTransfer\(directVoucher\)/, 'two-project transfers do not bypass atomic amendment permissions');
assert.match(warehouse, /directVoucherFromCrew \? 'Thống kê đội'/, 'crew back label');
assert.match(warehouse, /directVoucherFromCatalog[\s\S]{0,150}catalogVoucherReturn\?\.history\.type/, 'catalog Back type label');
assert.match(detail, /<ContextBackButton label=\{backLabel\} onClick=\{onBack\}/, 'one Back in direct voucher sheet');
assert.equal((detail.match(/<ContextBackButton\b/g) || []).length, 1, 'only one Back in detail sheet');
assert.equal((warehouse.match(/<ContextBackButton\b/g) || []).length, 2, 'one Back in original editor, one in transfer correction; never rendered together');
assert.doesNotMatch(warehouse, /data-hnl-voucher-return-origin="crew-statistics"|onReturnFromSourceVoucher/, 'no duplicate Crew Back');
assert.match(app, /!\(activeTab === 'warehouse' && warehouseVoucherFocus\?\.projectId === activeProjectId\)/, 'hide App header Back under direct voucher modal');
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
assert.match(app, /onContextReturn=\{handleContextReturn\}/, 'Crew voucher returns via one modal Back to App contextual stack');
assert.match(crew, /const handledVoucherReturnRef = useRef/, 'mobile return is idempotent per request token');
assert.match(crew, /voucherReturnRequest\.projectId !== projectId/, 'never restore a crew modal from another project');
assert.match(crew, /onVoucherReturnRestored\?\.\(voucherReturnRequest\.token\)/, 'consume App-held return request once');
assert.match(warehouse, /hasEditAccess && onUpdateInventory && \(!item\.warehouseTransferId \|\| canAmendTransfer\(item\)\)/, 'original voucher Edit RBAC and transfer guard unchanged');
assert.match(warehouse, /readOnly compactViewerButton/, 'receipt photos retain read-only viewer unless using separate authorized attachment workflow');
assert.match(crew, /line\.voucherIds\?\.length === 1/, 'single material voucher directly clickable');
assert.match(crew, /line\.voucherCount === 1 && line\.vouchers\.length === 1/, 'single equipment voucher directly clickable');
assert.match(warehouse, /initialVoucherId=\{singleVoucherExportId \|\| undefined\}/, 'exact voucher export preset forwarded');
assert.match(warehouse, /data-hnl-journal-open-voucher=\{item\.id\}/, 'journal voucher opens a direct document');
assert.match(detail, /role="dialog" aria-modal="true"/, 'read-only modal is accessible');
assert.match(detail, /readOnly compactViewerButton/, 'receipt photos remain read-only');
assert.doesNotMatch(detail, /onDeleteInventory|onUpdateInventory|onAddInventory|setDoc\(|updateDoc\(|deleteDoc\(/, 'direct voucher must not write ledger data');
const share = read('src/components/WarehouseVoucherShareSheet.tsx');
assert.match(share, /initialVoucher=inventory\.find\(item=>item\.id===initialVoucherId && item\.deletedAt==null\)/, 'exact voucher export source ID');
assert.match(share, /useState<Pick>\(initialVoucher\?'one':'all'\)/, 'one-voucher export needs no second selection');

// UI-only callbacks and no Firestore mutation.
const navigator = warehouse.slice(warehouse.indexOf('const returnFromCatalogVoucher'),warehouse.indexOf('const openCreateInventory'));
assert.doesNotMatch(navigator, /onUpdateInventory\(|onAddInventory\(|updateDoc\(|setDoc\(|deleteDoc\(/, 'Back must never write to database');
console.log('HNL SOURCE VOUCHER RETURN GOLDEN PASS: one Back per context, catalog filters, crew mobile modal state, role and project guards');
