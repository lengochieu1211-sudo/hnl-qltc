import './highlight-exit-to-plan-golden.mjs';
import './highlight-toolbar-metric-summary-golden.mjs';
import './highlight-popover-substage-unit-golden.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(path,'utf8');
const floor = read('src/components/FloorPlanDefectTab.tsx');
const draw = read('src/components/FloorHighlightDirectDraw.tsx');
const room = read('src/components/RoomHighlightModal.tsx');

// One contextual tool selector: all three modes in both map toolbars;
// no second selector obscuring the plan and no room creation during Cách 2.
assert.match(floor, /const \[cach2DrawTool, setCach2DrawTool\] = useState/);
for(const mode of ['2point','polygon','freehand']) {
  assert.equal(floor.match(new RegExp(`if \\(isShapeDrawing\\) \\{ selectCach2ToolbarTool\\('${mode}'\\); return; \\}`, 'g'))?.length, 2,
    `Both mobile/fullscreen and ordinary toolbars must delegate ${mode}`);
}
assert.match(floor, /selectedTool=\{cach2DrawTool\}/);
assert.match(floor, /if \(cach2DrawTool === tool\) setCach2CloseRequestToken\(\(token\) => token \+ 1\)/,
  'Repeated tap must request closing, not reselect another mode');
assert.match(floor, /closeRequestToken=\{cach2CloseRequestToken\}/,
  'Parent toolbar must propagate close request to Cách 2 editor');
assert.match(draw, /if \(\(draft\.length \|\| corners\.length \|\| freehand\.length \|\| measurePath\.length\) &&/,
  'Must warn before discarding uncommitted drawing');
assert.match(draw, /setOpen\(false\); onOpenChange\?\.\(false\)/,
  'Close selected Highlight tool without auto-launching calibration');
assert.equal((floor.match(/aria-pressed=\{isShapeDrawing \? cach2DrawTool ===/g) || []).length, 6,
  'Three tools in both normal and fullscreen need accessible selected states');
assert.doesNotMatch(floor, /setMetricCalibrationLaunch\(\{floorId:[^}]+\}\);?\s*return;/,
  'Highlight mode toggling cannot trigger measurement calibration');

const reclickHandler = floor.slice(floor.indexOf('const selectCach2ToolbarTool ='), floor.indexOf('const [selectedRoomForEdit'));
assert.match(reclickHandler,/cach2ToolSwitchGuardRef\.current\?\.\(\) !== false/);
assert.doesNotMatch(reclickHandler, /setMetricCalibrationLaunch/,
  'A re-click must never transfer focus into Đo tỷ lệ');
assert.equal((floor.match(/title="Chọn 2 điểm chuẩn để đo tỷ lệ"/g) || []).length, 2,
  'Both ordinary and fullscreen calibration tooltips must be compact');
assert.doesNotMatch(floor, /border-teal-300 bg-teal-50|border-teal-500 bg-slate-800/,
  'Calibration tool must not retain the differently colored teal button');
assert.match(draw, /closeRequestToken=0/);
assert.match(draw, /Tắt vẽ Highlight và bỏ phần chưa lưu\?/);
assert.match(draw, /const tool: DrawTool = selectedTool \?\? '2point'/);
assert.doesNotMatch(draw, /role="group" aria-label="Công cụ vẽ trực tiếp"/);
assert.match(floor, /(?:!isShapeDrawing && mapLayers\.roomRegions|mapLayers\.roomRegions && !isShapeDrawing)/, 'room resize handles must not cover or intercept active Highlight');
assert.match(draw, /setOpen\(true\); setShowOptions\(false\); setQuantityMode\('measure'\); onOpenChange\?\.\(true\); clearWork\(\)/, 'manual launch must turn off room handles');
assert.match(draw, /data-hnl-direct-highlight-options-toggle="true"/);
assert.match(draw, /aria-expanded=\{showOptions\}/);
assert.match(draw, /\{showOptions && <div className="space-y-1\.5"/, 'large panel must be collapsed by default');
assert.match(draw, /const \[showOptions, setShowOptions\] = useState\(false\)/);

// Room draws only through the existing inline main/subitem map buttons;
// removing the separate collapsible drawer does not remove drawing.
assert.doesNotMatch(room, /showCach2RoomPortal/);
assert.doesNotMatch(room, /data-hnl-cach2-room-portal-toggle="true"/);
assert.match(room, /data-hnl-main-quantity-map=\{catName\}/);
assert.match(room, /launchCach2\(catName, item\.id\)/);
assert.doesNotMatch(room, /launchCach2\(cat, 'main'\)/);
assert.match(room, /onStartDrawOnMap\(roomItem, category, target\)/);

// Screen geometry only: smaller marks, same editable pointer region,
// server-ack and CAS confirmation retained.
assert.match(draw, /r="0\.32" fill="#f59e0b"/);
assert.match(draw, /strokeWidth="1\.5" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" \/>/);
assert.match(draw, /onPointerDown=\{handleDown\}/);
assert.match(draw, /await onSaveShapes\(request\)/);
assert.match(draw, /window\.confirm\(`XÁC NHẬN/);
assert.match(read('src/App.tsx'), /await commitDirectHighlightCas\(projectId, request\)/);
console.log('HIGHLIGHT_CACH2_COMPACT_CONTROLS_GOLDEN PASS: both toolbars, no duplicate, compact panel, inline room map only, smaller visual marks, CAS guard');

await import('./highlight-hl01-hl06-golden.mjs');
