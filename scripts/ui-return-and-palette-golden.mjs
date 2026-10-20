import assert from 'node:assert/strict';
import fs from 'node:fs';
import { quickGridHistoryShortcut } from '../src/utils/quickGridKeyboard.mjs';
const read = (name) => fs.readFileSync(name,'utf8');
const app = read('src/App.tsx');
const crew = read('src/components/CrewTabBase.tsx');
const volume = read('src/components/WorkVolumeTab.tsx');
const floorPlan = read('src/components/FloorPlanDefectTab.tsx');
const configSheet = read('src/components/SettingsAccordionCard.tsx');
const health = read('src/healthCenter/HealthCenterPanelBase.tsx');
const header = read('src/components/GoogleAuthHeader.tsx');
const warehouse = read('src/components/WarehouseTab.tsx');
const crewShare = read('src/components/CrewReportShareModal.tsx');
const voucher = read('src/components/WarehouseVoucherShareSheet.tsx');
const report = read('src/components/ExportPdfModal.tsx');
for (const marker of ['crew-detail','volume-detail','health-center','qlct_health_center_reopen_v1', 'qlct_crew_detail_return_v1', 'qlct_volume_detail_return_v1']) {
  assert.ok(app.includes(marker), `Missing contextual return in App: ${marker}`);
}
assert.ok(crew.includes("contextReturn: 'crew-detail'") && crew.includes('setSelectedTeamForDetail(team)'), 'Crew return restores the original modal');
assert.ok(volume.includes('onOpenRoomFromDetail') && volume.includes('setDetailVolumeTarget(item)'), 'Volume return restores selected breakdown');
assert.ok(!app.includes("window.setTimeout(() => window.dispatchEvent(new Event('qlct-health-center-return')), 60);\n    };\n    window.addEventListener('qlct-diagnostic-open-entity'") && app.includes("navigateToTab('config', true)"), 'Health return event cannot recursively redispatch or wipe multi-hop stack');
assert.ok(volume.includes('if (!isActive || !detailBreakdown) return'), 'Preserve volume filters until selected item breakdown is restored');
assert.match(crew, /w-full sm:w-auto min-h-10 bg-(?:green|emerald)-600 hover:bg-(?:green|emerald)-700/, 'Team Excel detail export stays bright green and fills mobile column');
assert.ok(configSheet.includes('qlct-health-center-navigate-out') && configSheet.includes('qlct-health-center-return'), 'Health Center feature sheet reopen');
assert.ok(health.includes('buildHealthCenterNavigationRequest') && health.includes('qlct_health_center_return_state'), 'Canonical diagnostic navigation and filter return');
assert.ok((header.match(/bg-slate-800 hover:bg-slate-700 text-slate-100/g) || []).length >= 2 && !header.includes('bg-teal-700 hover:bg-teal-800'), 'Project and Reports buttons share secondary slate palette');
assert.ok(warehouse.includes('data-hnl-warehouse-catalog-table="auto-width"') && warehouse.includes('data-hnl-table-row-height="32"') && warehouse.includes('% Nhập/ĐM') && warehouse.includes("warehouseCatalogTab === 'material'"), 'Compact catalog, read-only import ratio');
assert.ok(crewShare.includes('bg-sky-600') && crewShare.includes('bg-green-600') && report.includes('bg-green-600'), 'Crew/report format palette');
assert.ok(voucher.includes('bg-sky-600') && voucher.includes('bg-green-600'), 'Warehouse voucher format palette');

// Linked Căn/Defect/Health-Center screens must expose exactly one source-aware
// return control. A second fixed-position control previously covered mobile UI
// after dismissing the room/defect dialog with X.
assert.equal((app.match(/<ContextBackButton\b/g) || []).length, 1, 'App shows only one contextual back control');
assert.ok(!app.includes('data-hnl-context-floating-return'), 'no duplicate fixed mobile return overlay');
assert.ok(app.includes('data-hnl-cross-module-return="true"') && app.includes('sticky top-0 z-[65]'), 'single source-aware return stays visible on deep-scroll admin/config pages');
assert.ok(warehouse.includes('onHeaderBack={catalogHistory ? returnToCatalogHistoryParent : undefined}') && warehouse.includes('data-hnl-warehouse-catalog-scroll'), 'Warehouse nested history returns in the sticky sheet header and restores table scroll');
assert.ok(volume.includes('data-hnl-volume-detail-scrollbody="true"') && volume.includes('detailReturnViewRef'), 'Volume-to-room return restores scroll and focused room');
assert.ok(app.includes('onClick={handleContextReturn}'), 'single top return restores the originating module');
// FloorPlan direct Defect detail is a close action, not a cross-module back action.
// Preserve the contextual label only when the parent has a real return handler;
// avoid a second competing X alongside the sticky dismiss action.
const defectDetailHeader = floorPlan.slice(floorPlan.indexOf('{/* Defect Detail & Control Modal */}'), floorPlan.indexOf('{/* Overdue / Progress Banner */}'));
assert.ok(defectDetailHeader.includes('contextReturnLabel && onContextReturn && (') &&
  defectDetailHeader.includes('data-hnl-defect-context-back="true"') &&
  defectDetailHeader.includes('← Quay lại {contextReturnLabel}'),
  'Defect detail only shows a contextual return when a real source/return callback exists');
assert.ok(defectDetailHeader.includes('data-hnl-defect-detail-dismiss="primary"') &&
  defectDetailHeader.includes('aria-label="Đóng chi tiết Defect"') &&
  defectDetailHeader.includes('<X className="w-5 h-5" />') &&
  defectDetailHeader.includes('p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100') &&
  defectDetailHeader.includes('sticky top-0'),
  'Defect modal uses the same small top-right X button as Room instead of a text close button');
assert.ok(!defectDetailHeader.includes("'✕ Đóng'") &&
  !defectDetailHeader.includes('Đóng chi tiết</button>'),
  'Defect header must not show verbose local close text');
assert.equal((defectDetailHeader.match(/onClick={closeDefectDetail}/g) || []).length, 2,
  'Defect modal has conditional context-return and one icon dismiss, without duplicate X buttons');
assert.ok(floorPlan.includes('if (onContextReturn) onContextReturn()') && floorPlan.includes('Lưu &amp; Đóng'),
  'Defect modal must preserve existing contextual return and save/close action');

// All three business tables share the same compact 32px row size on PC and mobile;
// linked detail buttons remain intact, and the report export actions have one size.
assert.equal((warehouse.match(/data-hnl-table-row-height="32"/g) || []).length, 2, 'Warehouse catalog and material needs tables use 32px rows');
assert.equal((volume.match(/data-hnl-table-row-height="32"/g) || []).length, 1, 'Volume detail uses 32px rows');
assert.ok(warehouse.includes('data-hnl-warehouse-filter-layout="responsive-one-row"') && warehouse.includes('lg:grid-cols-[15rem_minmax(0,1fr)_auto]') && warehouse.includes('xl:grid-cols-[17rem_minmax(0,1fr)_auto]') && warehouse.includes('lg:flex-nowrap'), 'Desktop warehouse voucher type, search and date range share one line');
const primaryToolbar = warehouse.slice(warehouse.indexOf('data-hnl-warehouse-primary-toolbar="type-search-dates"'), warehouse.indexOf('data-hnl-warehouse-kind-sort="responsive-toolbar"'));
const primaryOrder = ["setFilterType('all')", "setFilterType('in')", "setFilterType('out')", 'data-hnl-warehouse-voucher-search="true"', 'data-hnl-warehouse-date-from="true"', 'data-hnl-warehouse-date-to="true"'].map((marker) => primaryToolbar.indexOf(marker));
assert.ok(primaryOrder.every((at) => at >= 0) && primaryOrder.every((at, idx) => idx === 0 || at > primaryOrder[idx - 1]), 'Warehouse voucher type → search → date range stays in that desktop order');
assert.ok(primaryToolbar.includes('aria-label="Xóa lọc ngày"') && primaryToolbar.includes("setWarehouseFromDate(''); setWarehouseToDate('');"), 'Clear date action remains accessible and resets both dates');

assert.ok(warehouse.includes('h-8 min-h-8 min-w-10') && volume.includes('h-8 min-h-8 rounded-md'), 'Linked catalog/volume entries have same 32px height on all viewports');
for (const format of ['text', 'pdf', 'xlsx']) {
  const start = report.indexOf('data-hnl-report-format="'+format+'"');
  assert.ok(start > 0, 'Report action '+format+' exists');
  const end = report.indexOf('</button>', start);
  const btn = report.slice(start, end);
  assert.ok(btn.includes('min-h-10') && btn.includes('text-xs font-bold') && !btn.includes('min-h-12') && !btn.includes('text-sm font-bold'), 'Report '+format+' uses compact 40px action and 12px text');
}

// 2026-10-17: four UI/Warehouse handoff requirements without changing cloud schema.
const floorHeaderStart = floorPlan.indexOf('title="Quản lý Khu/Khối, đổi tên');
const floorHeaderGroup = floorPlan.slice(floorHeaderStart - 750, floorHeaderStart);
assert.ok(floorHeaderStart > 0 && floorHeaderGroup.includes('sm:grid-flow-col') && !floorHeaderGroup.includes('sm:border-l'),
  'PC FloorPlan management action must not have a decorative left divider');
const volumeToolbar = volume.slice(volume.indexOf('data-hnl-volume-filter-sort="responsive-toolbar"') - 100, volume.indexOf('{hasStructureManageAccess && volSortBy !==', volume.indexOf('data-hnl-volume-filter-sort="responsive-toolbar"')));
assert.ok(volumeToolbar.includes('lg:flex-row') && volumeToolbar.includes('lg:items-center') && volumeToolbar.includes('data-hnl-volume-category-filters="true"') && volumeToolbar.includes('data-hnl-volume-sort-controls="true"') && volumeToolbar.includes('<QuickSortBar'),
  'WorkVolume type filters and quick sort must be siblings in one responsive desktop toolbar');
const warehouseToolbar = warehouse.slice(warehouse.indexOf('data-hnl-warehouse-kind-sort="responsive-toolbar"') - 100, warehouse.indexOf('{/* Transaction List */}'));
assert.ok(warehouseToolbar.includes('lg:flex-row') && warehouseToolbar.includes('lg:items-center') && warehouseToolbar.includes('data-hnl-warehouse-kind-filter={key}') && warehouseToolbar.includes('data-hnl-warehouse-sort-controls="true"') && warehouseToolbar.includes('<QuickSortBar'),
  'Warehouse kind filters and quick sort must be siblings in one responsive desktop toolbar');
assert.ok(warehouse.includes('data-hnl-add-material="true"') && warehouse.includes('data-hnl-new-material-name="true"') && warehouse.includes('data-hnl-select-existing-material="true"') && !warehouse.includes('Tên vật tư khác'),
  'Warehouse must replace legacy free-name field with explicit add/select material controls');
assert.ok(warehouse.includes("itemKind === 'material' && hasNormManageAccess && !isAddingMaterial") && warehouse.includes("setIsAddingMaterial(editingKind === 'material' && !matched)") && warehouse.includes('&& !editingKeepsIdentity'),
  'New material must remain ADMIN-only and preserve editing unlinked historical vouchers');
assert.ok(warehouse.includes('inventorySaveInFlightRef.current = true;\n      try {\n        createdMaterialId = await onCreateMaterialCatalog'),
  'New material catalog creation must be guarded against rapid duplicate submissions');
assert.ok(warehouse.includes('normalizeMaterialSearch(norm.materialName) === normalizeMaterialSearch(finalMaterialName)') && warehouse.includes('existingMaterial || exactNormMaterialIds.length > 0'),
  'New material flow must reject duplicate matching name/unit identities');

// 2026-10-17: Voucher material/equipment create actions use exactly the same
// readable caption size, icon dimensions and tap height on PC/mobile.
const materialAddAction = warehouse.match(/<button\s+type="button"\s+data-hnl-add-material="true"[\s\S]*?<\/button>/)?.[0] || '';
const equipmentAddStart = warehouse.indexOf('Thêm thiết bị mới', warehouse.indexOf('data-hnl-add-material="true"'));
const equipmentAddAction = warehouse.slice(warehouse.lastIndexOf('<button', equipmentAddStart), warehouse.indexOf('</button>', equipmentAddStart) + '</button>'.length);
assert.ok(materialAddAction && equipmentAddStart > 0 && equipmentAddAction, 'Voucher add material/equipment actions exist');
for (const btn of [materialAddAction, equipmentAddAction]) {
  assert.ok(btn.includes('inline-flex min-h-8 items-center gap-1 text-[11px] font-bold'),
    'Voucher material/equipment add actions share min-h-8 and 11px caption');
  assert.ok(btn.includes('<Plus className="h-3.5 w-3.5" />'),
    'Voucher add action icons are the same size');
}

// PC V3.5: nested dialogs must escape the blurred, scrolling settings sheet.
const viewportPortal = read('src/components/ViewportModalPortal.tsx');
const projectDialogs = read('src/components/ProjectManagerModal.tsx');
const normDialogs = read('src/components/MaterialNormModal.tsx');
const mergeDialogs = read('src/components/ConflictMergeModal.tsx');
assert.ok(viewportPortal.includes('createPortal(children, document.body)') && viewportPortal.includes("typeof document === 'undefined'"),
  'Viewport portal uses document.body without breaking SSR');
for (const condition of ['showConflictModal && pendingImportData','multiProjectSyncState',
  'canBackup && deletingCloudBackupTarget','showJsonScopePicker','exportedFileInfo','importedFileInfo','pendingEncryptedPayload']) {
  const start = projectDialogs.indexOf('{' + condition + ' && (');
  const end = projectDialogs.indexOf('\n      )}', start);
  assert.ok(start >= 0 && end > start && projectDialogs.slice(start, end).includes('<ViewportModalPortal>') &&
    projectDialogs.slice(start, end).includes('</ViewportModalPortal>'), 'Unportaled project overlay: ' + condition);
}
assert.ok(projectDialogs.includes('data-hnl-viewport-overlay="json-export-scope"') && projectDialogs.includes('handleExportJsonForScope()') && projectDialogs.includes("inline ? 'w-full'"),
  'JSON scope has full-viewport overlay without changing export or inline project behavior');
assert.ok(mergeDialogs.includes('z-[320]') && normDialogs.includes('z-[330]'),
  'Nested merge and delete overlays have global stacking above their parents');
assert.ok(normDialogs.includes('<ViewportModalPortal>') && normDialogs.includes('onDeleteNorm(deletingNormTarget.id);'),
  'Material norm UI and existing ADMIN delete action preserved');
assert.ok(report.includes('<ViewportModalPortal>') && report.includes('max-h-[calc(100dvh-1rem)]') &&
  report.includes('data-hnl-report-fixed-header="true"') && report.includes('data-hnl-report-scrollbody="true"') &&
  !report.includes('sticky top-0 z-20') && report.includes('overflow-hidden border border-slate-100 shadow-2xl'),
  'Report header must remain outside the independently scrolling options; no sticky padding gap');
const actionMenuPortal = read('src/components/ActionMenuButton.tsx');
assert.ok(normDialogs.includes('data-hnl-overlay-stack="elevated"') &&
  actionMenuPortal.includes('elevatedModalMenu') && actionMenuPortal.includes('z-[360]') &&
  actionMenuPortal.includes('z-[170]') && actionMenuPortal.includes('z-[359]'),
  'Inside elevated modal, Add/Equipment action menu must receive clicks without affecting normal global menus');
// Keep report filter typography legible and consistent at 1024/1280/1440px and high DPI.
const reportFilterStart = report.indexOf('data-hnl-pc-v32-region="report-filters"');
const reportFilterEnd = report.indexOf('{/* Sorting for each report section.', reportFilterStart);
assert.ok(reportFilterStart > 0 && reportFilterEnd > reportFilterStart,
  'Report scope filters exist before report sorting');
const reportFilterUi = report.slice(reportFilterStart, reportFilterEnd);
assert.ok(!reportFilterUi.includes('text-[9.5px]') && !reportFilterUi.includes('text-[10px]'),
  'No tiny 9.5px or 10px typography inside report filters');
assert.equal((reportFilterUi.match(/<(?:select|input)\b[^\n]*?className="[^"]*text-xs/g) || []).length, 7,
  'All 3 Defect selects and 4 date inputs use the same 12px font');
for (const label of ['Defect tạo từ ngày', 'Defect tạo đến ngày', 'Xong từ', 'Xong đến']) {
  assert.ok(reportFilterUi.includes('text-[11px] font-bold text-slate-500">' + label),
    'Date field labels use the same readable 11px size: ' + label);
}
assert.ok(reportFilterUi.includes('text-xs font-extrabold text-slate-600">Defect trong phạm vi trên') &&
  reportFilterUi.includes('text-xs font-extrabold text-indigo-600 hover:text-indigo-800'),
  'Section title and clear-filter button use 12px');
assert.ok(reportFilterUi.includes('text-[11px] leading-relaxed text-slate-500'),
  'Explanatory footnote uses the same 11px typography with readable line-height');
// Compact PC actions and label hierarchies are opt-in; no PDF print/template changes.
const deepFormCss = read('src/styles/desktopWorkspaceCompact.css');
const warehouseVoucher = read('src/components/WarehouseTab.tsx');
for (const token of ['item-kind', 'voucher-type']) {
  assert.ok(warehouseVoucher.includes(`data-hnl-v35-voucher-toggle="${token}"`) &&
    deepFormCss.includes('[data-hnl-v35-voucher-toggle]'), `Voucher toggle ${token} compact PC-only`);
}
assert.ok(floorPlan.includes('data-hnl-pc-v35-actions="floor-manage-add"') &&
  deepFormCss.includes('[data-hnl-pc-v35-actions="floor-manage-add"]'),
  'Floor manager action bar compact while preserving floor-add modal and Android');
assert.ok(report.includes('data-hnl-report-typography="sort-order"') &&
  report.includes('data-hnl-report-typography="page-layout"') &&
  deepFormCss.includes('[data-hnl-report-typography="page-layout"]'),
  'Report scopes/sorting/page typography use a scoped PC font hierarchy');
console.log('REPORT FILTER TYPOGRAPHY GOLDEN PASS');

// PC V3.5: report sorting and PDF paper controls must match the readable
// scope filters above. These assertions are presentation-only; do not alter
// report sorting, selected values, export callbacks or RBAC semantics.
const reportSortStart = report.indexOf('{/* Sorting for each report section.');
const reportSortEnd = report.indexOf('{/* Report Content Checkboxes */}', reportSortStart);
assert.ok(reportSortStart >= reportFilterEnd && reportSortEnd > reportSortStart,
  'Report sorting panel must remain after scope filters');
const reportSortUi = report.slice(reportSortStart, reportSortEnd);
assert.equal((reportSortUi.match(/<select\b[^\n]*className="[^"\n]*text-xs font-semibold/g) || []).length, 7,
  'All seven per-section report sorting selectors use 12px text');
assert.equal((reportSortUi.match(/<span className="block text-\[11px\] font-bold text-slate-600">/g) || []).length, 7,
  'All seven per-section sorting field labels use 11px text');
assert.ok(reportSortUi.includes('px-3 py-2.5 text-xs font-extrabold') &&
  reportSortUi.includes('px-3 pb-3 text-[11px] leading-relaxed'),
  'Sorting section title is 12px and appendix-order explanation is 11px');
assert.ok(!reportSortUi.includes('text-[10px]') && !reportSortUi.includes('text-[9.5px]'),
  'Report sorting panel does not regress to tiny captions');
const reportPaperStart = report.indexOf('{/* Tùy chỉnh nâng cao */}', reportSortEnd);
const reportPaperEnd = report.indexOf('<label className="flex items-center gap-2 cursor-pointer select-none text-[11px] font-medium">', reportPaperStart);
const reportPaperUi = report.slice(reportPaperStart, reportPaperEnd);
assert.ok(reportPaperStart > reportSortEnd && reportPaperEnd > reportPaperStart,
  'PDF paper layout options must remain in the advanced group');
assert.equal((reportPaperUi.match(/<select\b[^\n]*|<select\s*\n/g) || []).length, 2,
  'Keep paper size and orientation selects');
assert.equal((reportPaperUi.match(/className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold"/g) || []).length, 2,
  'Both PDF paper controls use 12px text');
assert.equal((reportPaperUi.match(/text-\[11px\] font-semibold text-slate-600/g) || []).length, 2,
  'Both paper-control labels use 11px text');
assert.ok(!reportPaperUi.includes('text-[10px]'), 'PDF paper layout has no tiny captions');
console.log('REPORT SORTING / PDF LAYOUT TYPOGRAPHY GOLDEN PASS');
// HNL QLTC common drawing standard (19/10/2026): Căn/Phòng rectangles
// must be square-cornered in draft SVG, drag preview, and saved SVG overlay.
// This is presentation-only: x/y/width/height and selection handlers are intact.
const floorSvgDrawing = floorPlan.slice(
  floorPlan.indexOf('{/* SVG OVERLAY FOR HIGHLIGHT SHAPES & LIVE DRAWINGS */}'),
  floorPlan.indexOf('{/* INTERACTIVE DRAG & RESIZE HANDLES OVERLAY */}')
);
assert.equal((floorSvgDrawing.match(/<rect\b/g) || []).length, 3,
  'Pending draft, two-point preview, and saved room each render a rectangle');
assert.ok(!/\brx\s*=|\bry\s*=/.test(floorSvgDrawing),
  'Rectangular room overlays have four square corners');
assert.ok(floorPlan.includes('bg-amber-400/30 backdrop-blur-[1px]') &&
  !floorPlan.includes('bg-amber-400/30 rounded-xl'),
  'HTML dragging rectangle stays square-cornered like the saved SVG');
console.log('FLOORPLAN RECTANGLE FOUR SQUARE CORNERS GOLDEN PASS');





console.log('PC DEEP VIEWPORT OVERLAY GOLDEN PASS');

console.log('UI RETURN AND PALETTE GOLDEN: PASS');

// When CI runs the UI regression gate, exercise the modern PC module-level layout too.
await import('./desktop-workspace-v2-golden.mjs');

// Quick Edit Undo/Redo keyboard contract: only staged drafts, not native text editing.
const quickGridCode = read('src/components/QuickEditGridModal.tsx');
const key = (key, extra={}) => quickGridHistoryShortcut({key, ctrlKey:true, targetTagName:'TD', ...extra});
assert.equal(key('z'), 'undo');
assert.equal(key('Z'), 'undo');
assert.equal(key('y'), 'redo');
assert.equal(key('z', {shiftKey:true}), 'redo');
assert.equal(key('z', {ctrlKey:false, metaKey:true}), 'undo');
assert.equal(key('z', {ctrlKey:false}), null);
assert.equal(key('z', {altKey:true}), null);
assert.equal(key('y', {targetTagName:'INPUT'}), null, 'Do not steal search/toolbar input undo');
assert.equal(key('z', {targetTagName:'INPUT', inGridCell:true}), 'undo', 'Cell inputs use grid draft undo');
assert.equal(key('y', {targetTagName:'INPUT', inGridCell:true}), 'redo', 'Cell inputs use grid draft redo');
assert.equal(key('z', {targetTagName:'TEXTAREA'}), null);
assert.equal(key('z', {isContentEditable:true}), null);
assert.equal(key('z', {isComposing:true}), null);
assert.ok(quickGridCode.includes('onKeyDown={handleGridHistoryKeyDown}') &&
  quickGridCode.includes("action === 'undo' && undoStack.length") &&
  quickGridCode.includes("action === 'redo' && redoStack.length") &&
  quickGridCode.includes('inGridCell: Boolean(target?.closest?'), 'Quick Edit wires safe keyboard history to its draft state');
assert.ok(quickGridCode.includes('rows === lastHydratedRowsRef.current') &&
  quickGridCode.includes('lastHydratedRowsRef.current = rows'),
  'Undoing to a clean draft must not erase the Redo stack unless canonical rows changed');
console.log('QUICK GRID CTRL+Z / CTRL+Y HISTORY GOLDEN PASS');

// PC V3.5 — deep action groups must be compact ONLY in modern PC, without
// changing callbacks, form semantics, mobile selection cards or access rights.
const deepCompactCss = read('src/styles/desktopWorkspaceCompact.css');
for (const [path, names] of [
  ['src/components/RoomHighlightModal.tsx', ['room-save', 'room-preset']],
  ['src/components/MaterialNormModal.tsx', ['norm-save']],
  ['src/components/WarehouseTab.tsx', ['warehouse-save']],
  ['src/components/WorkVolumeTab.tsx', ['volume-save']],
  ['src/components/CrewTabBase.tsx', ['crew-save']],
  ['src/components/ChecklistTab.tsx', ['checklist-save']],
  ['src/components/FloorPlanDefectTab.tsx', ['defect-save', 'floor-add']],
  ['src/components/ProjectManagerModal.tsx', ['drive-sync']],
  ['src/components/GoogleConfigTab.tsx', ['trash-record']],
]) {
  const ui = read(path);
  for (const name of names) {
    assert.ok(ui.includes('data-hnl-pc-v35-actions="' + name + '"'), path + ': action marker ' + name);
    assert.ok(deepCompactCss.includes('[data-hnl-pc-v35-actions="' + name + '"]'), 'Scoped PC CSS: ' + name);
  }
}
// PR #298 already normalized these two buttons; never duplicate selectors.
assert.ok(read('src/components/NotificationCenterModal.tsx').includes('data-hnl-notification-open-chat="true"') &&
  read('src/components/GoogleConfigTab.tsx').includes('data-hnl-project-settings-save="true"') &&
  deepCompactCss.includes('[data-hnl-notification-open-chat="true"]') &&
  deepCompactCss.includes('[data-hnl-project-settings-save="true"]'),
  'Existing PC project-save and notification-chat sizing from PR #298 remains intact');
assert.ok(deepCompactCss.includes('@media (min-width: 1024px)') &&
  deepCompactCss.includes('html[data-hnl-pc-workspace="modern"]') &&
  deepCompactCss.includes('flex: 0 0 auto') && deepCompactCss.includes('width: auto'),
  'Deep modal actions must not stretch and must not recolor classic/mobile buttons');
assert.ok(deepCompactCss.includes('[data-hnl-report-export-actions="true"] [role="group"][aria-label="Nội dung, PDF và Excel"]'),
  'PDF/Excel/text report actions retain three independent compact buttons');
const warehouseGridUi = read('src/components/WarehouseTab.tsx');
assert.match(warehouseGridUi, /data-hnl-pc-v3-inner="warehouse-catalog-grid"[^>]*>\s*<div data-hnl-warehouse-catalog-scroll="true"/,
  'Warehouse table outline and scroll viewport are separate layers');
assert.ok(warehouseGridUi.includes("document.querySelector<HTMLElement>('[data-hnl-warehouse-catalog-scroll=\"true\"]')") &&
  warehouseGridUi.includes('data-hnl-catalog-in-history') &&
  warehouseGridUi.includes('data-hnl-catalog-out-history') &&
  warehouseGridUi.includes('data-hnl-catalog-open-master'),
  'Warehouse nested entry/return still restores position on the original scroll marker');
assert.ok(deepCompactCss.includes('max-height: min(58vh, 680px)') &&
  deepCompactCss.includes('scrollbar-gutter: stable') &&
  read('src/components/MaterialNormModal.tsx').includes('hasManageAccess') &&
  read('src/components/GoogleConfigTab.tsx').includes("disabled={userRole !== 'ADMIN'}"),
  'Scroll boundaries and ADMIN-only mutations remain guarded');
console.log('PC V3.5 DEEP ACTION COMPACT + WAREHOUSE SCROLL FRAME GOLDEN PASS');

// When returning from Material Norm / Equipment Master, the catalogue sheet
// remounts: restoring only the sheet body loses the table's own scroll position.
// Protect both axes and keep the original focus/key and history return behavior.
assert.ok(warehouseGridUi.includes('const catalogTableScrollReturnRef = useRef<{ top: number; left: number } | null>(null)') &&
  warehouseGridUi.includes('top: scrollTable?.scrollTop ?? 0') &&
  warehouseGridUi.includes('left: scrollTable?.scrollLeft ?? 0') &&
  warehouseGridUi.includes('table.scrollTop = tableScroll.top') &&
  warehouseGridUi.includes('table.scrollLeft = tableScroll.left') &&
  warehouseGridUi.includes('catalogTableScrollReturnRef.current = null'),
  'Warehouse master detail return must restore its independent vertical/horizontal table scroll');
// Screenshot regression: Item kind and voucher type share one six-column PC row,
// while non-PC / classic still use the original stacked touch layout.
for (const [token, group] of [['item-kind', 'item-kind'], ['voucher-type', 'voucher-type']]) {
  assert.match(warehouseGridUi, new RegExp(`data-hnl-v35-voucher-group="${group}" className="lg:col-span-3 min-w-0"`),
    `${group} must occupy half of the same PC voucher row`);
  assert.ok(warehouseGridUi.includes(`data-hnl-v35-voucher-toggle="${token}"`), `${token} retains original buttons`);
}
const voucherScreenCss = read('src/styles/desktopWorkspaceCompact.css');
assert.ok(voucherScreenCss.includes('/* HNL PC V3.5 warehouse voucher layout') &&
  voucherScreenCss.includes('[data-hnl-v35-voucher-group]') &&
  voucherScreenCss.includes('[data-hnl-v35-voucher-product-header="true"]') &&
  voucherScreenCss.includes('@media (min-width: 1024px)'),
  'Voucher selector cards and nearby add-item control are desktop-only');
assert.ok(warehouseGridUi.includes('data-hnl-v35-voucher-product-header="true"') &&
  warehouseGridUi.includes('setItemKind(kind)') && warehouseGridUi.includes("setType('in')") &&
  warehouseGridUi.includes("setType('out')") && warehouseGridUi.includes('hasNormManageAccess') &&
  warehouseGridUi.includes('setIsNewEquipment(true)') && warehouseGridUi.includes('data-hnl-pc-v35-actions="warehouse-save"'),
  'Original item switching, issue type, permissions, new-equipment and save handlers must remain');
console.log('PC V3.5 WAREHOUSE VOUCHER ONE-ROW SELECTOR GOLDEN PASS');

console.log('WAREHOUSE MASTER RETURN SCROLL POSITION GOLDEN PASS');


// PC V3.5 entry-trigger completion after PR #302: keep modern-PC launch cards
// compact without changing the touch layouts, card state or portaled sheets.
const entryCompactCss = read('src/styles/desktopWorkspaceCompact.css');
const settingsAccordionCode = read('src/components/SettingsAccordionCard.tsx');
const managerCode = read('src/components/ProjectManagerModal.tsx');
const floorCode = read('src/components/FloorPlanDefectTab.tsx');
const warehouseCode = read('src/components/WarehouseTab.tsx');
assert.ok(settingsAccordionCode.includes('data-hnl-settings-sheet-card={sheetKey}') &&
  settingsAccordionCode.includes('<SettingsFeatureSheet') &&
  entryCompactCss.includes('html[data-hnl-pc-workspace="modern"] [data-hnl-settings-sheet-card]') &&
  entryCompactCss.includes('width: 100%;') &&
  !entryCompactCss.includes('width: min(100%, 600px);'),
  'Settings entry navigation remains aligned full-width; only nested action buttons compact');
for (const marker of ['manage-structure', 'add-structure-group']) {
  assert.ok(floorCode.includes(`data-hnl-pc-v35-trigger="${marker}"`) &&
    entryCompactCss.includes(`[data-hnl-pc-v35-trigger="${marker}"]`),
    `Floor structure action ${marker} has scoped compact treatment`);
}
assert.ok(warehouseCode.includes('data-hnl-primary-action="warehouse-create"') &&
  entryCompactCss.includes('[data-hnl-primary-action="warehouse-create"]') &&
  warehouseCode.includes('data-hnl-pc-v35-actions="warehouse-save"'),
  'Warehouse Create and already-patched voucher footer remain separate controls');
for (const marker of ['json-export', 'json-import', 'json-paste-restore', 'autosave-permission', 'autosave-link']) {
  assert.ok(managerCode.includes(`data-hnl-pc-v35-trigger="${marker}"`) &&
    entryCompactCss.includes(`[data-hnl-pc-v35-trigger="${marker}"]`),
    `Backup or AutoSave PC action ${marker} is opt-in compact`);
}
assert.ok(entryCompactCss.includes('@media (min-width: 1024px)') &&
  entryCompactCss.includes('html[data-hnl-pc-workspace="modern"]') &&
  settingsAccordionCode.includes('onClick={(event) => {') &&
  settingsAccordionCode.includes('setSheetOpen(!openRef.current)') &&
  settingsAccordionCode.includes('aria-haspopup="dialog"'),
  'Mobile/classic and Settings sheet open/history/keyboard behaviors remain unchanged');
console.log('HNL PC V3.5 ENTRY CARDS + DEEP ACTIONS AUDIT GOLDEN PASS');
// Section 02: command buttons inside nested Sync/Health sheets, not the
// Settings launch rows, are the opt-in compact targets on modern desktop.
assert.ok(managerCode.includes('data-hnl-pc-v35-actions="json-transfer"') &&
  managerCode.includes('data-hnl-pc-v35-trigger="cloud-resync"') &&
  managerCode.includes('data-hnl-pc-v35-actions="drive-sync"') &&
  entryCompactCss.includes('[data-hnl-pc-v35-actions="json-transfer"]') &&
  entryCompactCss.includes('[data-hnl-pc-v35-trigger="cloud-resync"]') &&
  entryCompactCss.includes('[data-hnl-health-export-actions="true"]') &&
  health.includes('data-hnl-health-export-actions="true"') &&
  entryCompactCss.includes('[data-hnl-settings-sheet="system-sync-card"]'),
  'Data & Sync nested JSON, Drive, cloud and Health export commands are compact');
assert.ok(entryCompactCss.includes('/* PC V3.5 Data & Sync follow-up:') &&
  entryCompactCss.includes('min-width: 1024px') &&
  entryCompactCss.includes('white-space: normal;') &&
  configSheet.includes('data-hnl-settings-sheet-card={sheetKey}') &&
  !managerCode.includes('data-hnl-pc-v35-trigger="cloud-resync"\n                        onClick'),
  'Only scoped modern-PC action appearance changes, not event callbacks or mobile choices');
console.log('HNL PC V3.5 DATA & SYNC ENTRY ALIGNMENT + NESTED ACTIONS PASS');


// PC V3.5 screenshot follow-up: Settings choice groups inside portaled sheets
// must size to their content. Buttons remain unchanged on mobile/classic.
const configChoiceUi = read('src/components/GoogleConfigTab.tsx');
const configChoiceCss = read('src/styles/desktopWorkspaceCompact.css');
for (const sheet of ['formatting-settings-card', 'image-quality-card']) {
  assert.ok(configChoiceUi.includes(`id="${sheet}"`) &&
    configChoiceCss.includes(`[data-hnl-settings-sheet="${sheet}"]`),
    `Settings feature sheet ${sheet} must have a stable, CSS-scoped identity`);
}
for (const choice of ['number-format', 'date-format', 'image-quality']) {
  assert.ok(configChoiceUi.includes(`data-hnl-pc-v35-choice-grid="${choice}"`) &&
    configChoiceUi.includes(`data-hnl-pc-v35-choice-card="${choice}"`) &&
    configChoiceCss.includes(`[data-hnl-pc-v35-choice-grid="${choice}"]`) &&
    configChoiceCss.includes(`[data-hnl-pc-v35-choice-card="${choice}"]`),
    `Settings choice group ${choice} must be compact only on PC`);
}
assert.ok(configChoiceUi.includes("handleNumberFormatChange('dot_comma')") &&
  configChoiceUi.includes("handleNumberFormatChange('comma_dot')") &&
  configChoiceUi.includes('handleDateFormatChange(opt.id as DateFormatPreset)') &&
  configChoiceUi.includes('handleImageQualityChange(group.kind, preset)') &&
  configChoiceCss.includes('@media (min-width: 1024px)') &&
  configChoiceCss.includes('html[data-hnl-pc-workspace="modern"]'),
  'Formatting and image-quality handlers preserved with modern-PC-only scope');
console.log('PC V3.5 SETTINGS FORMAT / IMAGE QUALITY COMPACT GOLDEN PASS');


// Screenshot follow-up: smaller, vertically centered preference feature-sheets
// and compact two-button floor view toggles, without changing their behavior.
const uiSheetCss = read('src/styles/desktopWorkspaceCompact.css');
const floorView = read('src/components/FloorPlanDefectTab.tsx');
for (const key of ['formatting-settings-card', 'image-quality-card']) {
  assert.ok(uiSheetCss.includes(`[data-hnl-settings-sheet="${key}"]`),
    `Scoped compact geometry missing for ${key}`);
}
assert.ok(uiSheetCss.includes('PC V3.5 follow-up after real Windows screenshot review.') &&
  uiSheetCss.includes('top: 50dvh;') && uiSheetCss.includes('max-height: calc(100dvh - 48px);') &&
  uiSheetCss.includes('[data-hnl-pc-v35-choice-grid="date-format"]') &&
  uiSheetCss.includes('repeat(4, minmax(0, 1fr))') &&
  uiSheetCss.includes('[data-hnl-pc-v35-choice-card="image-quality"]'),
  'Desktop preference sheets must fit their content with readable choices');
assert.ok(floorView.includes('data-hnl-pc-v35-view-modes="floorplan"') &&
  uiSheetCss.includes('[data-hnl-pc-v35-view-modes="floorplan"]') &&
  uiSheetCss.includes('display: inline-flex;') &&
  floorView.includes("currentMode === 'highlight' ? 'all' : 'highlight'") &&
  floorView.includes("currentMode === 'defect' ? 'all' : 'defect'") &&
  floorView.includes('setIsDefectPinPlacementMode(false);'),
  'Floorplan desktop compact toggle must retain both original view/reset handlers');
console.log('HNL PC V3.5 PREFERENCE SHEETS + FLOORPLAN TOGGLE FOLLOW-UP GOLDEN PASS');


// View-mode selector and Section 02 share one modern-PC row. Classic/mobile
// still use the original stacking and both mode handlers remain unchanged.
const floorRowSource = read('src/components/FloorPlanDefectTab.tsx');
const floorRowCss = read('src/styles/desktopWorkspaceCompact.css');
assert.ok(floorRowSource.includes('data-hnl-pc-v35-section-row="floor-drawing" className="flex flex-col gap-4"') &&
  floorRowSource.indexOf('data-hnl-pc-v35-section-row="floor-drawing"') < floorRowSource.indexOf('data-hnl-pc-v35-view-modes="floorplan"') &&
  floorRowSource.indexOf('data-hnl-pc-v35-view-modes="floorplan"') < floorRowSource.indexOf('data-hnl-v3-section="02"') &&
  floorRowSource.includes('</div>{/* End floor drawing section header + view controls */}') &&
  floorRowCss.includes('[data-hnl-pc-v35-section-row="floor-drawing"]') &&
  floorRowCss.includes('display: flex;') && floorRowCss.includes('flex-direction: row;') &&
  floorRowCss.includes('order: 1;') &&
  floorRowCss.includes('@media (min-width: 1024px)') &&
  floorRowSource.includes("currentMode === 'highlight' ? 'all' : 'highlight'") &&
  floorRowSource.includes("currentMode === 'defect' ? 'all' : 'defect'"),
  'PC modern section 02 aligns view controls right without affecting classic/mobile mode toggles');
console.log('PC V3.5 FLOOR DRAWING HEADING + MODE TOGGLES GOLDEN PASS');


// PC V3.6: compact room status controls are presentation-only. The original
// bulk and item status handlers, save semantics and acceptance guard remain.
const roomStatusSource = read('src/components/RoomHighlightModal.tsx');
const roomStatusCss = read('src/styles/desktopWorkspaceCompact.css');
assert.equal((roomStatusSource.match(/data-hnl-pc-v36-room-status="bulk"/g) || []).length, 2,
  'Both bulk progress and inspection rows must have a compact PC marker');
assert.equal((roomStatusSource.match(/data-hnl-pc-v36-room-status="item"/g) || []).length, 2,
  'Both item progress and inspection rows must have a compact PC marker');
assert.equal((roomStatusSource.match(/grid grid-cols-3 gap-1(?:\.5)?(?: mb-1\.5)?/g) || []).length >= 4, true,
  'Original responsive three-column classes remain for classic/mobile');
assert.ok(roomStatusSource.includes("handleUpdateSubItem(item.id, { status: st })") &&
  roomStatusSource.includes("handleUpdateSubItem(item.id, { inspectionStatus: st })") &&
  roomStatusSource.includes("disabled={st === 'Đạt nghiệm thu' && item.status !== 'Đã hoàn thành'}") &&
  roomStatusSource.includes("applyProgressPatch(s, { status: st })") &&
  roomStatusSource.includes("applyProgressPatch(s, { inspectionStatus: st })"),
  'Room status/acceptance handlers and safety guard are unchanged');
const statusLayoutCss = roomStatusCss.slice(roomStatusCss.indexOf('/* PC V3.6: Căn/Phòng'));
assert.ok(statusLayoutCss.startsWith('/* PC V3.6: Căn/Phòng') &&
  statusLayoutCss.includes('@media (min-width: 1024px)') &&
  statusLayoutCss.includes('html[data-hnl-pc-workspace="modern"]') &&
  statusLayoutCss.includes('[data-hnl-pc-v36-room-status] > button') &&
  statusLayoutCss.includes('width: fit-content;') &&
  statusLayoutCss.includes('flex-wrap: wrap;') &&
  statusLayoutCss.includes('min-height: 32px;'),
  'Room status compact geometry must remain modern PC only with full-width fallbacks intact');
console.log('PC V3.6 ROOM PROGRESS/INSPECTION COMPACT GOLDEN PASS');

// PC V3.6: Crew and warehouse thumbnails use fixed square frames only in
// modern desktop. Defect, Classic, mobile and photo cloud semantics stay intact.
const photoPickerSource = read('src/components/PhotoAttachmentPicker.tsx');
const warehousePhotoSource = read('src/components/WarehouseTab.tsx');
const thumbnailCss = read('src/styles/desktopWorkspaceCompact.css');
assert.ok(photoPickerSource.includes("entityType === 'crewRecord' || entityType === 'inventory' ? 'crew-warehouse' : undefined") &&
  photoPickerSource.includes('className="w-full h-full object-cover"') &&
  photoPickerSource.includes("entityType: 'crewRecord' | 'defect' | 'chat' | 'inventory'"),
  'The thumbnail marker applies only to Crew and Warehouse; Defect stays unchanged');
assert.ok(warehousePhotoSource.includes('data-hnl-pc-v36-photo-thumbnails="warehouse-draft"') &&
  warehousePhotoSource.includes('URL.createObjectURL(file)') &&
  warehousePhotoSource.includes('URL.revokeObjectURL(url)') &&
  warehousePhotoSource.includes('data-hnl-warehouse-staged-photos="true"'),
  'Warehouse staged photos remain local and revocable; only layout is tagged');
const thumbnailCssBlock = thumbnailCss.slice(thumbnailCss.indexOf('/* PC V3.6: Crew and warehouse photo previews'));
assert.ok(thumbnailCssBlock.startsWith('/* PC V3.6: Crew and warehouse photo previews') &&
  thumbnailCssBlock.includes('@media (min-width: 1024px)') &&
  thumbnailCssBlock.includes('html[data-hnl-pc-workspace="modern"]') &&
  thumbnailCssBlock.includes('grid-template-columns: repeat(auto-fill, 104px);') &&
  thumbnailCssBlock.includes('height: 104px;') &&
  thumbnailCssBlock.includes('aspect-ratio: 1 / 1;') &&
  thumbnailCssBlock.includes('object-fit: cover;'),
  'Photo thumbnail frames have fixed square geometry and crop without distortion');
console.log('PC V3.6 PHOTO THUMBNAIL GOLDEN PASS');


// PC V3.7: real Windows EXE screenshots show the *outside* room-card status
// badges stretched across each work item. Previous V3.6 fix targeted only
// RoomHighlightModal; this marker is deliberately limited to FloorPlanDefectTab.
const outsideRoomCards = read('src/components/FloorPlanDefectTab.tsx');
const outsideRoomCss = read('src/styles/desktopWorkspaceCompact.css');
assert.equal((outsideRoomCards.match(/data-hnl-pc-v37-room-card-status="outer"/g) || []).length, 3,
  'Outer room cards: subitem status pair and both legacy fallback pairs must be scoped');
assert.equal((outsideRoomCards.match(/className="grid grid-cols-2 gap-1 text-\[10px\]"/g) || []).length, 3,
  'Classic/mobile keep the original grid for the three outside-card pairs');
const outsideRule = outsideRoomCss.slice(outsideRoomCss.indexOf('/* PC V3.7: Outside room-card statuses'));
assert.ok(outsideRule.startsWith('/* PC V3.7: Outside room-card statuses') &&
  outsideRule.includes('@media (min-width: 1024px)') &&
  outsideRule.includes('html[data-hnl-pc-workspace="modern"]') &&
  outsideRule.includes('[data-hnl-pc-v37-room-card-status="outer"] > :is(span, button)') &&
  outsideRule.includes('display: flex;') &&
  outsideRule.includes('flex-wrap: wrap;') &&
  outsideRule.includes('width: max-content;') &&
  outsideRule.includes('max-width: 100%;') &&
  outsideRule.includes('flex: 0 0 auto;') &&
  outsideRule.includes('white-space: normal;'),
  'PC Modern outer room-card badges must fit text, not stretch to half-card width');
assert.ok(outsideRoomCards.includes('handleCycleFrame(e, room)') &&
  outsideRoomCards.includes('handleCycleFrameInspection(e, room)') &&
  outsideRoomCards.includes('handleCycleBoard(e, room)') &&
  outsideRoomCards.includes('handleCycleBoardInspection(e, room)') &&
  outsideRoomCards.includes("sub.status === 'Đã hoàn thành'") &&
  outsideRoomCards.includes("sub.inspectionStatus === 'Đạt nghiệm thu'"),
  'Existing outside-room statuses and fallback click handlers remain unchanged');
console.log('PC V3.7 OUTER ROOM CARD STATUS GOLDEN PASS');
