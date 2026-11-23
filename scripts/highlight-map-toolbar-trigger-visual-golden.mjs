import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const source = read('src/components/FloorPlanDefectTab.tsx');
const css = read('src/index.css');
const drawTools = source.slice(source.indexOf('/* Group 1: 3 Drawing Tools */'),source.indexOf('data-hnl-map-measure-display-row="true"'));
const measureStart = source.indexOf('data-hnl-map-calibration-inline="anchored-popover"');
const measureEnd = source.indexOf('data-hnl-map-calibration-popover="true"',measureStart);
const displayStart = source.indexOf('const renderMapDisplaySettings =');
const displayEnd = source.indexOf('data-hnl-map-display-popover="true"',displayStart);
assert(drawTools.length > 500 && measureStart > 0 && displayStart > 0 && measureEnd > measureStart && displayEnd > displayStart);
const drawing = drawTools.match(/className=\{`text-xs font-bold px-2\.5 py-1\.5 rounded-xl flex items-center gap-1\.5 transition-all shrink-0 cursor-pointer whitespace-nowrap/g) || [];
assert.equal(drawing.length,3, 'Keep three original drawing tool buttons unchanged');
const buttonVisual = 'text-xs font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all shrink-0 cursor-pointer whitespace-nowrap';
for (const [label,section] of [['Đo tỷ lệ',source.slice(measureStart,measureEnd)],['Hiển thị',source.slice(displayStart,displayEnd)]]) {
  assert(section.includes(buttonVisual), `${label} exterior must match 3 drawing tools`);
  assert(section.includes('rounded-xl') && section.includes('shadow-2xs') && section.includes('border-slate-200/90'), `${label} exterior normal border/background matches drawing tool`);
  assert(section.includes('open:bg-indigo-600') && section.includes('open:text-white') && section.includes('open:ring-2') && section.includes('open:ring-indigo-300'), `${label} open state matches drawing tool active style`);
  assert(!section.includes('min-h-11 sm:min-h-9'), `${label} must not have an oversized 44px/36px button`);
  assert(section.includes('group-open:rotate-180'), `${label} retains dropdown indicator`);
}
assert.match(source,/data-hnl-map-measure-display-row="true"\s+className="flex flex-wrap items-center gap-1\.5 px-2 py-1"/);
assert(source.includes('data-hnl-map-calibration-start="true"') && source.includes('setMetricCalibrationLaunch({floorId:activeFloor.id,token:Date.now()})'),'Do tỷ lệ dropdown retains activation');
assert(source.includes('data-hnl-map-display-popover="true"') && source.includes('renderMapDisplayControls(dark)'),'Hiển thị keeps existing dropdown controls');
assert(source.includes('removeAttribute(\'open\')'),'Popover mutual exclusivity unchanged');
assert.match(css,/\[data-hnl-map-measure-display-row="true"\] > details \{ width: auto !important; min-width: 0; \}/);
assert(css.includes('position: absolute !important;') && css.includes('right: 0 !important;') && css.includes('left: 0 !important;'),'Existing floating mobile popovers preserved');
console.log('HNL MAP TOOLBAR VISUAL GOLDEN PASS: 3 original drawing buttons + 2 compact style-matched popup triggers, mobile width and dropdown behavior preserved');
