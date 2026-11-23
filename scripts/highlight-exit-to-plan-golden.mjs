import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const parent = readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');
const child = readFileSync('src/components/FloorHighlightDirectDraw.tsx', 'utf8');
// The exit request must be routed BEFORE the legacy Escape handler clears selection.
const captureGuard = parent.indexOf("if (e.key === 'Escape' && isShapeDrawing)");
const legacyClear = parent.indexOf("// Escape: Cancel/exit drawing/placement commands first");
assert.ok(captureGuard > 0 && legacyClear > captureGuard, 'Esc intercepts direct-highlight drawing before legacy room deselection');
assert.match(parent, /if \(!e\.repeat\) setCach2ExitToPlanRequestToken\(\(token\) => token \+ 1\)/);
assert.match(parent, /showFullscreenDisplaySettings, isShapeDrawing\]\)/, 'Esc captures current editor active state');
assert.match(parent, /exitToPlanRequestToken=\{cach2ExitToPlanRequestToken\}/);
assert.match(parent, /onExitToPlan=\{\(\) => \{\s*setCach2DrawLaunch\(null\);\s*setMetricCalibrationLaunch\(null\);\s*setSelectedRoomIds\(\[\]\);\s*setSelectedRoomForDragId\(null\);/);
assert.match(child, /data-hnl-direct-highlight-exit-to-plan="true"/, 'Visible exit button available for touch and desktop');
assert.match(child, /disabled=\{saving\} onClick=\{\(\) => exitDrawing\(true\)\}/);
assert.match(child, /exitToPlanRequestToken=0/);
assert.match(child, /if \(exitToPlanRequestToken\) exitDrawing\(true\);/);
const close = child.slice(child.indexOf('const exitDrawing ='), child.indexOf('const confirmSwitchWithDraft'));
assert.ok(close.indexOf('window.confirm(') > close.indexOf('draft.length') && close.indexOf('onExitToPlan?.()') > close.indexOf('window.confirm('),
  'Unsaved draft confirmation gates both closing and unselecting the room');
assert.match(close, /if \(saving \|\| !open\) return/);
assert.match(close, /onOpenChange\?\.\(false\)/, 'State is returned to non-drawing before clearing selection');
assert.match(child, /if \(next === currentTarget \|\| !confirmSwitchWithDraft\(\)\) return;/);
assert.match(child, /if \(next === currentCategory \|\| !confirmSwitchWithDraft\(\)\) return;/);
assert.doesNotMatch(child, /window\.addEventListener\('keydown', handleKey\)/, 'No duplicate child Escape handler bypassing confirmation');
assert.match(parent, /setCach2DrawLaunch\(null\)/);
console.log('HIGHLIGHT_EXIT_TO_PLAN_GOLDEN PASS: Esc capture, return button, draft confirm, room clear only after exit, no double Escape listener');
