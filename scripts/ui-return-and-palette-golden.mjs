import assert from 'node:assert/strict';
import fs from 'node:fs';
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

console.log('UI RETURN AND PALETTE GOLDEN: PASS');

// When CI runs the UI regression gate, exercise the modern PC module-level layout too.
await import('./desktop-workspace-v2-golden.mjs');
