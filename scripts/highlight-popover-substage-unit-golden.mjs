import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placeFloorPlanDisplayPopover } from '../src/utils/floorPlanDisplayPopover.ts';
const read = x => readFileSync(x,'utf8');
const floor = read('src/components/FloorPlanDefectTab.tsx');
const draw = read('src/components/FloorHighlightDirectDraw.tsx');
const metric = read('src/components/FloorMetricCalibration.tsx');
const room = read('src/components/RoomHighlightModal.tsx');
const hook = read('src/hooks/useFloorPlanToolPopover.ts');

// Same anchor strategy as Hiển thị, *never* normal-flow docked panels in fullscreen.
assert.match(draw, /data-hnl-direct-highlight-layout=\{isFullscreen \? 'fullscreen-docked' : 'plan-floating'\}/);
assert.match(draw, /\? 'absolute left-2 top-16 z-\[85\]/);
assert.doesNotMatch(draw, /\? 'relative mx-2 mb-1 self-start/);
assert.match(draw, /style=\{isFullscreen \? fullscreenPopover : undefined\}/);
assert.match(draw, /useFloorPlanToolPopover\(open, isFullscreen, imageContainer/);
for (const tool of ['freehand','polygon','2point']) {
  assert.match(floor,new RegExp(`data-hnl-fullscreen-highlight-tool="${tool}"`));
}
assert.match(metric,/useFloorPlanToolPopover\(active \|\| !!notice, isFullscreen, imageContainer/);
assert.match(metric,/style=\{isFullscreen \? fullscreenPopover : undefined\}/);
assert.match(floor,/isFullscreen=\{isFullscreen\}/);
assert.match(hook,/placeFloorPlanDisplayPopover\(anchor, view\)/);
assert.match(hook,/ResizeObserver/);
const pos = placeFloorPlanDisplayPopover({right:450,bottom:96},{left:0,top:0,width:1500,height:900});
assert.equal(pos.top,104);assert.ok(pos.left>=8&&pos.width===304);

// Reuse existing saved child ID when choosing a main category; never silently add another stage.
assert.match(room,/data-hnl-main-highlight-stage-picker=\{catName\}/);
assert.match(room,/itemsInCat\.map\(stage => <option key=\{stage\.id\} value=\{stage\.id\}>\{stage\.name\}/);
assert.match(room,/launchCach2\(catName, target\)/);
assert.match(room,/stage\.id === mapPickerTarget/);
assert.match(room,/mapPickerTarget === 'new'/);
assert.match(room,/setSubItems\(prev => \[\.\.\.prev, \{/);
assert.match(room,/id: createEntityId\('sub-custom'\), name, category: catName/);
assert.match(room,/matched\.id/);
assert.match(room,/Hạng mục đã tồn tại: chọn lại vùng cũ, không tạo trùng ID/);
assert.match(room,/handleUpdateSubItem\(selected\.id, \{name:nextName\}\)/);
assert.match(room,/Tên mới \(giữ nguyên ID\)/);
assert.match(room,/Nhấn Lưu trước, sau đó chọn Mặt bằng của hạng mục con/);
assert.match(room,/roomDraftDirtyRef\.current = true/);
assert.match(room,/Đổi ĐVT không tự quy đổi KL đã lưu/);
assert.match(room,/value=\{!item\.volumeUnit \? '__main__'/);
assert.match(room,/Theo ĐVT chính \(\{getCategorySourceUnit\(catName\)\}\)/);
assert.match(room,/data-hnl-sub-unit-custom-editor="true"/);
assert.match(room, /\['m²','m','md','m³','Cái','Thanh'\]\.map\(unit/);
assert.match(room, /<option value="__custom__">\{item\.volumeUnit\} \(đã lưu\)<\/option>/);
assert.doesNotMatch(room, /Nhập đơn vị khác…/);
assert.match(room,/volumeUnit: next === '__main__' \? '' : next/);
assert.match(room,/data-hnl-sub-unit-spacing="true"/);
assert.match(room,/item\.inspectionStatus === 'Đạt nghiệm thu'/);
assert.match(draw,/await onSaveShapes\(request\)/);
console.log('HIGHLIGHT POPOVER/STAGE REUSE/UNIT GOLDEN PASS: PC overlay, anchor, stable IDs, custom units, draft guards, CAS unchanged');
