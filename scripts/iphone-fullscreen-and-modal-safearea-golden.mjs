import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Read-only source regression: no Firebase credentials and no writes.
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const floor = read('src/components/FloorPlanDefectTab.tsx');
const css = read('src/index.css');
const check = (ok, label) => { assert.ok(ok, label); console.log('PASS iPhone/PC UI: ' + label); };
check(floor.includes('data-hnl-ios-fullscreen-toolbar="true"') && floor.includes('hnl-ios-safe-fullscreen-toolbar'), 'iPhone Full toolbar Safe Area');
check(floor.includes('className="flex min-w-0 flex-col gap-2 bg-slate-900/95'), 'restore original two-row Full map toolbar on mobile');
check(floor.includes('ref={fullscreenToolbarToolsRef} data-hnl-ios-fullscreen-scrolltools="true" className="flex min-w-0 w-full') && floor.includes('touch-pan-x') && floor.includes('scrollLeft = 0'), 'Full tool row starts at first floor button and can scroll');
check(floor.includes('data-hnl-ios-fullscreen-exit="true" className="order-first flex w-full shrink-0') && floor.includes('sm:order-last'), 'Original mobile Undo/Exit row always visible at top');
check(floor.includes('data-hnl-map-display-inline="anchored-popover"') && floor.includes('data-hnl-map-display-popover="true"') && floor.includes('absolute right-0 top-full'), 'PC Display menu floats without stretching drawing toolbar');
check(floor.includes('items-center justify-start gap-2'), 'PC drawing controls and Display menu stay adjacent');
check(floor.includes('hnl-cross-device-safe-overlay') && css.includes('.hnl-cross-device-safe-overlay'), 'Manage Floors modal supports iOS and Android safe-area insets');
check(css.includes('hnl-mobile-map-display-panel') && css.includes('left: max(12px') && css.includes('right: max(12px') && floor.includes('Đóng tùy chỉnh hiển thị'), 'phone Display menu within viewport and closable');
const crew = read('src/components/CrewTabBase.tsx');
check(crew.includes('grid grid-cols-2 sm:grid-cols-3') && crew.includes('col-span-2 sm:col-span-1') && crew.includes('break-words'), 'Crew category summary wraps on narrow Android and iPhone');
check(floor.includes('fullscreenDisplayTriggerRef') && floor.includes('renderMapDisplayControls(true)') && floor.includes('getSavedRoomSnap'), 'PROD Display and OSNAP preserved');
check(css.includes('@supports (-webkit-touch-callout: none)') && css.includes('padding-top: max(3.75rem, env(safe-area-inset-top, 0px)) !important'), 'iOS notch fallback');
check(css.includes('.hnl-ios-safe-modal > .hnl-ios-safe-dialog') && css.includes('padding-bottom: max(1rem, env(safe-area-inset-bottom, 0px))'), 'iOS bottom actions stay accessible');
for (const path of ['src/components/ExportPdfModal.tsx','src/components/CrewReportShareModal.tsx','src/components/CrewTabBase.tsx','src/components/WarehouseTab.tsx','src/components/WorkVolumeTab.tsx','src/components/MaterialNormModal.tsx','src/components/RoomHighlightModal.tsx','src/components/ChecklistTab.tsx','src/components/NotificationCenterModal.tsx','src/components/ConflictMergeModal.tsx','src/components/CatalogTemplatePickerModal.tsx']) {
 check(read(path).includes('hnl-ios-safe-modal'), path + ' scoped Safe Area');
}
check(read('src/components/ExportPdfModal.tsx').includes('grid grid-cols-1 gap-2 sm:grid-cols-2'), 'report date filters responsive');
const wh = read('src/components/WarehouseTab.tsx');
check(wh.includes('data-hnl-warehouse-catalog-scroll="true"') && wh.includes('w-max min-w-full table-auto whitespace-nowrap') && wh.includes('data-hnl-catalog-open-master'), 'original warehouse scroll preserved');
check(!wh.includes('sticky left-0 z-20 bg-slate-50') && !wh.includes('max-w-[13rem]') && !wh.includes('tên vật tư luôn được giữ bên trái'), 'warehouse names NOT frozen or truncated');
check(floor.includes('onCommitPositionLocks') && floor.includes('positionLocked'), 'position locks preserved');
console.log('HNL IPHONE/PC SAFE AREA & MAP UI GOLDEN PASS');
