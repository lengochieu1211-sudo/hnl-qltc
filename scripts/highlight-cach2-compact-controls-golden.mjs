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
  assert.equal(floor.match(new RegExp(`if \\(isShapeDrawing\\) \\{ setCach2DrawTool\\('${mode}'\\); return; \\}`, 'g'))?.length, 2,
    `Both mobile/fullscreen and ordinary toolbars must delegate ${mode}`);
}
assert.match(floor, /selectedTool=\{cach2DrawTool\}/);
assert.match(draw, /const tool: DrawTool = selectedTool \?\? '2point'/);
assert.doesNotMatch(draw, /role="group" aria-label="Công cụ vẽ trực tiếp"/);
assert.match(floor, /(?:!isShapeDrawing && mapLayers\.roomRegions|mapLayers\.roomRegions && !isShapeDrawing)/, 'room resize handles must not cover or intercept active Highlight');
assert.match(draw, /setOpen\(true\); setShowOptions\(false\); setQuantityMode\('measure'\); onOpenChange\?\.\(true\); clearWork\(\)/, 'manual launch must turn off room handles');
assert.match(draw, /data-hnl-direct-highlight-options-toggle="true"/);
assert.match(draw, /aria-expanded=\{showOptions\}/);
assert.match(draw, /\{showOptions && <div className="space-y-1\.5"/, 'large panel must be collapsed by default');
assert.match(draw, /const \[showOptions, setShowOptions\] = useState\(false\)/);

// A room form starts collapsed, exposes a deliberate toggle, and retains
// the prior entry point for subItem/main geometry.
assert.match(room, /showCach2RoomPortal, setShowCach2RoomPortal\] = useState\(false\)/);
assert.match(room, /data-hnl-cach2-room-portal-toggle="true"/);
assert.match(room, /aria-expanded=\{showCach2RoomPortal\}/);
assert.match(room, /\{showCach2RoomPortal && <div id="hnl-cach2-room-portal-content"/);
assert.match(room, /launchCach2\(cat, 'main'\)/);
assert.match(room, /onStartDrawOnMap\(roomItem, category, target\)/);

// Screen geometry only: smaller marks, same editable pointer region,
// server-ack and CAS confirmation retained.
assert.match(draw, /r="0\.32" fill="#f59e0b"/);
assert.match(draw, /strokeWidth="0\.32" \/>/);
assert.match(draw, /onPointerDown=\{handleDown\}/);
assert.match(draw, /await onSaveShapes\(request\)/);
assert.match(draw, /window\.confirm\(`XÁC NHẬN/);
assert.match(read('src/App.tsx'), /await commitDirectHighlightCas\(projectId, request\)/);
console.log('HIGHLIGHT_CACH2_COMPACT_CONTROLS_GOLDEN PASS: both toolbars, no duplicate, compact panel, room disclosure, smaller visual marks, CAS guard');
