import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(path, 'utf8');
const draw = read('src/components/FloorHighlightDirectDraw.tsx');
const floor = read('src/components/FloorPlanDefectTab.tsx');
const room = read('src/components/RoomHighlightModal.tsx');
const calibration = read('src/components/FloorMetricCalibration.tsx');

// Room selection must not produce a second floating "Đo vẽ KL" launch action.
assert.match(draw, /if \(!open\) return null;/);
assert.match(draw, /launch.roomId !== room.id/);
assert.match(draw, /setOpen\(true\)/);
assert.match(room, /if \(!itemsInCat\.length\) \{ launchCach2\(catName, 'main'\); return; \}/);
assert.match(room, /data-hnl-main-highlight-stage-picker=\{catName\}/);
assert.match(room, /launchCach2\(catName, target\)/);
assert.match(room, /onClick=\{\(\) => launchCach2\(catName, item.id\)\}/);

// Keep only inline main/child map launchers; remove the duplicate collapsible child launcher.
assert.doesNotMatch(room, /showCach2RoomPortal/);
assert.doesNotMatch(room, /Vẽ riêng hạng mục con/);
assert.match(room, /aria-label=\{\`Vẽ vùng highlight cho \$\{item.name\}\`\}/);
assert.doesNotMatch(room, /Đo tỷ lệ 2 điểm → chọn hạng mục/);
assert.doesNotMatch(room, /data-hnl-open-cach2-main=/);

// One underlying floor calibration state, invoked by the ordinary or fullscreen toolbar.
assert.match(floor, /data-hnl-cach2-calibrate-toolbar="true"/);
assert.match(floor, /data-hnl-metric-calibrate-fullscreen="true"/);
assert.match(floor, /setMetricCalibrationLaunch\(\{floorId:activeFloor.id,token:Date.now\(\)\}\)/);
assert.match(floor, /<FloorMetricCalibration/);
assert.match(calibration, /onSave\(floor.id,draft,preview\.token\)/);
assert.doesNotMatch(draw+room, /onSave\(floor.id,draft,preview\.token\)/);
console.log('PASS: map toolbar calibration only; main/subitem target picker preserves existing stage IDs');
