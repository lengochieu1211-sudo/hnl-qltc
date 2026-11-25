import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const floor = read('src/components/FloorPlanDefectTab.tsx');
const css = read('src/index.css');
const opening = floor.indexOf('<details data-hnl-map-tools-collapsible="true"');
const banner = floor.indexOf('{/* Active Drawing Tool Info Banner */}', opening);
assert(opening > 0 && banner > opening, 'Normal map toolbar must have a collapsible group');
const toolbar = floor.slice(opening, banner);
assert(toolbar.includes('/* Group 1: 3 Drawing Tools */'));
assert.match(toolbar,/className="group\/map-tools/);
assert.match(toolbar,/hnl-disclosure-chevron[^"\n]*group-open\/map-tools:rotate-180/, 'Toolbar disclosure arrow follows its own open state without swapping labels');
assert.equal((floor.match(/className=\{`group\/map-menu relative/g)||[]).length,1,
  'Display popover uses its own named group, not outer expanded state');
assert(toolbar.includes('className="group/map-menu relative'), 'Calibration popover has its own independent group');
assert.equal((floor.match(/group-open\/map-menu:rotate-180/g)||[]).length,2,
  'Both dropdown arrows respond only to their own open state');
assert(toolbar.includes('data-hnl-map-measure-display-row="true"'));
assert(toolbar.includes('data-hnl-map-calibration-inline="anchored-popover"'));
assert(toolbar.includes('renderMapDisplaySettings(false)'), 'Display belongs to the same disclosure');
assert(toolbar.indexOf('data-hnl-map-measure-display-row="true"') > toolbar.indexOf('Vẽ chữ nhật'));
assert.match(floor,/\(viewMode === 'highlight' \|\| viewMode === 'all' \|\| viewMode === 'defect'\) && \(\s*<details data-hnl-map-tools-collapsible/,
  'Defect and read-only views retain Display via a disclosure');
assert.match(toolbar,/\{canManageStructure && \(viewMode === 'highlight' \|\| viewMode === 'all'\) && \(\s*<div className="flex flex-wrap items-center gap-1\.5">/,
  '3 drawing modes still obey manage permission');
assert.match(toolbar,/\{canManageStructure && \(viewMode === 'highlight' \|\| viewMode === 'all'\) && \(\s*<details data-hnl-map-calibration-inline=/,
  'Calibration still obeys manage permission');
assert.match(floor,/const alignMapToolbarPopover = \(trigger: HTMLDetailsElement\) =>/);
assert.match(floor,/const panelWidth = panel\.getBoundingClientRect\(\)\.width;/);
assert.match(floor,/const minLeft = margin - rect\.left;/);
assert.match(floor,/const maxLeft = viewportWidth - margin - panelWidth - rect\.left;/);
assert.match(floor,/Math\.min\(maxLeft, Math\.max\(minLeft, desiredLeft\)\)/,
  'No clipping at left or right edge after viewport clamping');
assert.equal((floor.match(/alignMapToolbarPopover\(event\.currentTarget\)/g)||[]).length,2,
  'Both calibration and display must use identical popover positioning');
const display = floor.slice(floor.indexOf('const renderMapDisplaySettings'),floor.indexOf('  return (',floor.indexOf('const renderMapDisplaySettings')));
for (const trigger of [display,toolbar]) {
  for (const active of ['open:bg-indigo-600','open:text-white','open:font-black','open:ring-2','open:ring-indigo-300'])
    assert(trigger.includes(active), `Same three drawing buttons active style: ${active}`);
}
assert.match(floor,/data-hnl-map-display-popover="true"[^\n]*border-slate-200 bg-white text-slate-700/);
assert.match(floor,/data-hnl-map-calibration-popover="true"[^\n]*border-slate-200 bg-white[^\n]*text-slate-700/);
assert.match(floor,/data-hnl-map-calibration-start="true"[\s\S]*?bg-indigo-600 hover:bg-indigo-700/);
const clamp = css.slice(css.indexOf('/* DEV: all five toolbar buttons share one collapsible group.'));
assert(clamp.includes('left: var(--hnl-map-popover-left, 0px) !important;'));
assert(clamp.includes('position: absolute !important;') && clamp.includes('right: auto !important;'));
assert(!clamp.includes('right: 0 !important;'), 'No last-wins CSS forcing Display popup offscreen');
assert(floor.includes('setMetricCalibrationLaunch({floorId:activeFloor.id,token:Date.now()})'));
assert(floor.includes('renderMapDisplayControls(dark)'));
assert(floor.includes('renderMapDisplayControls(true)'), 'Fullscreen Display controls unchanged');
// Regression: Tailwind open:indigo bypassed HNL's .bg-indigo-600 => primary-blue remap.
// Source-only class checks previously passed while actual open buttons stayed purple.
assert.match(css, /\.bg-indigo-600 \{ background-color: var\(--hnl-primary-action\) !important; \}/,
  'Three drawing buttons map to shared HNL primary blue, not Tailwind indigo');
const selectedPopup = css.match(/\[data-hnl-map-measure-display-row="true"\] > details\[open\] \{([^}]+)\}/);
assert(selectedPopup, 'Both normal-mode popup triggers must override Tailwind open:indigo');
for (const entry of [
  'background-color: var(--hnl-primary-action) !important;',
  'color: #fff !important;',
  'border-color: var(--hnl-primary-action) !important;',
  '--tw-ring-color: color-mix(in srgb, var(--hnl-primary) 28%, transparent) !important;',
]) assert(selectedPopup[1].includes(entry), `Popup selected color must match 3 drawing tools: ${entry}`);
assert.match(floor,/data-hnl-map-measure-display-row="true"[\s\S]*data-hnl-map-calibration-inline="anchored-popover"/);
assert(floor.includes('data-hnl-map-display-inline="anchored-popover"'));
assert(!selectedPopup[1].includes('purple') && !selectedPopup[1].includes('#4f46e5'), 'No hardcoded purple');
// PR499 follow-up: the *actual* two-point calibration panel is a separate React
// component. Checking only the parent dropdown would miss its old teal-on-black
// panel, especially when fullscreen. Match Display's normal/fullscreen surfaces.
const calibrationPanel = read('src/components/FloorMetricCalibration.tsx');
assert.match(calibrationPanel, /data-hnl-metric-calibration-panel="true"/);
assert.match(calibrationPanel, /isFullscreen\s*\? 'border-slate-600 bg-slate-800 text-slate-100 shadow-2xl'\s*: 'border-slate-200 bg-white text-slate-700 shadow-xl'/,
  'Calibration popover must match Display backgrounds/borders in both viewing modes');
assert.doesNotMatch(calibrationPanel, /bg-slate-950\/95|border-teal-400\/50|bg-teal-700/,
  'Do not reintroduce the old teal-on-black calibration panel');
assert.match(calibrationPanel, /data-hnl-metric-calibration-close="true" aria-label="Đóng bảng Đo tỷ lệ"/);
assert.match(calibrationPanel, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); close\(\); \}\}/,
  'X button closes the two-point calibration panel without saving');
assert.match(calibrationPanel, /const close = \(\) => \{ setActive\(false\); onActiveChange\?\.\(false\); setPoints\(\[\]\); setNotice\(''\); \};/,
  'X button clears only unsaved points and notice');
assert.match(calibrationPanel, /onSave\(floor\.id,draft\);\s*close\(\);/,
  'Existing saved calibration path is unchanged');
assert.match(floor, /data-hnl-map-calibration-popover-close="true" aria-label="Đóng tùy chọn Đo tỷ lệ"/,
  'Normal inline calibration dropdown has its own X button');
assert.match(floor, /data-hnl-map-calibration-popover-close="true"[\s\S]{0,260}closest\('details'\)\?\.removeAttribute\('open'\)/,
  'Normal X only dismisses its dropdown without launching/saving calibration');
assert.match(floor, /data-hnl-fullscreen-display-popover="true"[\s\S]{0,350}border-slate-600 bg-slate-800 text-slate-100/,
  'Fullscreen calibration uses same base surface as fullscreen Display');
assert.match(floor, /data-hnl-map-display-popover="true"[\s\S]{0,350}border-slate-200 bg-white text-slate-700/,
  'Normal calibration uses same base surface as normal Display');
console.log('PASS HNL CALIBRATION PANEL PARITY: normal white and fullscreen slate-800 match Display, two X close actions, no saved data touched');
console.log('PASS HNL MAP MENU COLLAPSE + VIEWPORT + 5 BUTTON COLORS: source-only, no data writes');

assert.match(floor, /showFullscreenDisplaySettings \? 'bg-indigo-600 text-white font-black shadow-sm ring-2 ring-indigo-300 border-indigo-600'/, 'Fullscreen Display uses the same active color and ring as calibration');
assert(floor.includes('!(isFullscreen && showFullscreenDisplaySettings) && (selectedRoomObject'), 'Hide room operations while fullscreen Display is open; keep room selection');

// When measuring, X is the only cancel/close control; retain retry after an inactive notice.
assert.doesNotMatch(calibrationPanel, /Hủy đo/, 'No redundant cancel button in calibration panel');
assert.match(calibrationPanel, /\{canSave && !active && <button type="button" onClick=\{open\}[\s\S]*?>Chọn 2 điểm<\/button>/, 'Retry only when inactive and authorized');
assert.match(calibrationPanel, /disabled=\{!draft\} onClick=\{save\}[^>]*>Xác nhận lưu tỷ lệ<\/button>/);
assert.match(calibrationPanel, /onClick=\{\(\)=>setPoints\(\[\]\)\}[^>]*>Chọn lại<\/button>/);
assert.match(calibrationPanel, /event\.key === 'Escape'\) close\(\)/);
console.log('PASS: single X cancel, authorized inactive retry, reselect/save and Escape retained');
