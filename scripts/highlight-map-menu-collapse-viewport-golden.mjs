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
assert(toolbar.includes('group-open/map-tools:hidden') && toolbar.includes('group-open/map-tools:inline'));
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
console.log('PASS HNL MAP MENU COLLAPSE + VIEWPORT + 5 BUTTON COLORS: source-only, no data writes');
