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
for (const marker of ['crew-detail','volume-detail','health-center','data-hnl-context-floating-return','qlct_health_center_reopen_v1', 'qlct_crew_detail_return_v1', 'qlct_volume_detail_return_v1']) {
  assert.ok(app.includes(marker), `Missing contextual return in App: ${marker}`);
}
assert.ok(crew.includes("contextReturn: 'crew-detail'") && crew.includes('setSelectedTeamForDetail(team)'), 'Crew return restores the original modal');
assert.ok(volume.includes('onOpenRoomFromDetail') && volume.includes('setDetailVolumeTarget(item)'), 'Volume return restores selected breakdown');
assert.ok(!app.includes("window.setTimeout(() => window.dispatchEvent(new Event('qlct-health-center-return')), 60);\n    };\n    window.addEventListener('qlct-diagnostic-open-entity'") && app.includes("navigateToTab('config', true)"), 'Health return event cannot recursively redispatch or wipe multi-hop stack');
assert.ok(volume.includes('if (!isActive || !detailBreakdown) return'), 'Preserve volume filters until selected item breakdown is restored');
assert.match(crew, /w-full sm:w-auto min-h-10 bg-(?:green|emerald)-600 hover:bg-(?:green|emerald)-700/, 'Team Excel detail export stays bright green and fills mobile column');
assert.ok(configSheet.includes('qlct-health-center-navigate-out') && configSheet.includes('qlct-health-center-return'), 'Health Center feature sheet reopen');
assert.ok(health.includes('buildHealthCenterNavigationRequest') && health.includes('qlct_health_center_return_state'), 'Canonical diagnostic navigation and filter return');
assert.ok(header.includes('bg-blue-800 hover:bg-blue-900') && header.includes('bg-teal-700 hover:bg-teal-800'), 'Muted header colors');
assert.ok(warehouse.includes('py-0.5 text-xs') && warehouse.includes('% Nhập/ĐM') && warehouse.includes("warehouseCatalogTab === 'material'"), 'Compact catalog, read-only import ratio');
assert.ok(crewShare.includes('bg-sky-600') && crewShare.includes('bg-green-600') && report.includes('bg-green-600'), 'Crew/report format palette');
assert.ok(voucher.includes('bg-sky-600') && voucher.includes('bg-green-600'), 'Warehouse voucher format palette');
console.log('UI RETURN AND PALETTE GOLDEN: PASS');
