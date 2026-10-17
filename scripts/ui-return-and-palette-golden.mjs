import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (name) => fs.readFileSync(name,'utf8');
const app = read('src/App.tsx');
const crew = read('src/components/CrewTabBase.tsx');
const volume = read('src/components/WorkVolumeTab.tsx');
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
assert.ok(warehouse.includes('data-hnl-warehouse-filter-layout="responsive-one-row"') && warehouse.includes('lg:grid-cols-[minmax(0,1fr)_auto]') && warehouse.includes('lg:flex-nowrap'), 'Desktop warehouse search and date range share one line');
assert.ok(warehouse.includes('h-8 min-h-8 min-w-10') && volume.includes('h-8 min-h-8 rounded-md'), 'Linked catalog/volume entries have same 32px height on all viewports');
for (const format of ['text', 'pdf', 'xlsx']) {
  const start = report.indexOf('data-hnl-report-format="'+format+'"');
  assert.ok(start > 0, 'Report action '+format+' exists');
  const end = report.indexOf('</button>', start);
  const btn = report.slice(start, end);
  assert.ok(btn.includes('min-h-10') && btn.includes('text-xs font-bold') && !btn.includes('min-h-12') && !btn.includes('text-sm font-bold'), 'Report '+format+' uses compact 40px action and 12px text');
}

console.log('UI RETURN AND PALETTE GOLDEN: PASS');
