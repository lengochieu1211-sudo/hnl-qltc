import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=(f)=>readFileSync(f,'utf8');
const floor=read('src/components/FloorPlanDefectTab.tsx');
const css=read('src/index.css');
assert.match(floor,/data-hnl-ios-fullscreen-toolbar/);
assert.match(floor,/data-hnl-map-display-inline="anchored-popover"/);
assert.match(floor,/hnl-cross-device-safe-overlay/);
assert.match(floor,/getCadDrawingHotkey/);
assert.match(floor,/getSavedRoomSnap/);
assert.match(floor,/handleCancelledDrawPointer/);
assert.match(css,/\.hnl-ios-safe-fullscreen-toolbar/);
assert.match(css,/\.hnl-ios-safe-modal/);
assert.match(css,/\.hnl-cross-device-safe-overlay/);
const excel=read('src/utils/warehouseVoucherExcel.ts');
assert.match(excel,/merge\(table\.length-1,0,1\)/);
assert.match(excel,/wch:38,hidden:true/);
const src=read('src/components/BottomNav.tsx');
assert.match(src,/DesktopAccountMenu/);
const chat=read('src/lib/chatService.ts');
// Chat is part of the 10-group release. Atomic new-client sends must coexist
// with legacy split-write clients until their installed versions are retired.
assert.match(chat,/writeBatch\(db\)/);
console.log('PROD SCOPED MOBILE LAYOUT + EXCEL GATES PASS');
