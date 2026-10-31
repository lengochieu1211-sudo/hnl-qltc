import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findRoomObjectSnap } from '../src/utils/roomHighlightObjectSnap.ts';
import { placeFloorPlanDisplayPopover } from '../src/utils/floorPlanDisplayPopover.ts';

const src = readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx', import.meta.url), 'utf8');
const check = (condition, message) => { assert.ok(condition, message); console.log('PASS UI PARITY: ' + message); };
for (const label of ['⚙️', 'Hiển thị', 'Mỗi phòng một màu', 'Tên phòng đầy đủ', 'Nét highlight', 'Chữ căn/phòng', 'Chữ Defect', 'Bắt điểm phòng (OSNAP)', 'Bắt điểm giữa cạnh', 'Mặc định 100%'])
  check(src.includes(label), `PROD display control ${label}`);
check(src.includes('renderMapDisplaySettings(false)') && src.includes('renderMapDisplayControls(true)'), 'shared ordinary + fullscreen controls');
check(src.includes('fullscreenDisplayViewportRef') && src.includes('placeFloorPlanDisplayPopover'), 'anchored fullscreen settings panel');
check(src.includes('data-hnl-ios-fullscreen-toolbar="true"') && src.includes('env(safe-area-inset-top)'), 'iOS fullscreen Safe Area preserved');
check(src.includes('data-hnl-ios-fullscreen-exit="true" className="flex shrink-0') && src.includes('data-hnl-ios-fullscreen-scrolltools="true" className="flex min-w-0 flex-1'), 'iOS fullscreen exit pinned at right while old one-row tools scroll');
check(src.includes('roomLabelScalePercent / 100') && src.includes('defectLabelScale * defectLabelScalePercent / 100'), 'label scale is visual only');
check(src.includes("getDraftKey(key)") && src.includes("readMapLabelPercent('construction_room_label_scale_percent')") && src.includes("readMapLabelPercent('construction_defect_label_scale_percent')"), 'saved preferences isolated by project/device');
check(src.includes('isRoomCreationDrawing && drawTool !== \'polygon\'') && src.includes('getSavedRoomSnap') && src.includes('data-hnl-exclusive-room-draw="true"'), 'OSNAP only for explicit drawing');
const room = {id:'r-1', x:10, y:20, width:20, height:30};
const verts = findRoomObjectSnap({x:10.25,y:20.15},[room],{width:400,height:500},{tolerancePx:12});
check(verts?.kind==='vertex' && verts.point.x===10 && verts.point.y===20,'vertex OSNAP with pixel tolerance');
check(findRoomObjectSnap({x:20.1,y:20.1},[room],{width:400,height:500},{tolerancePx:12,midpoints:false})===null,'midpoint OFF by default');
const mid=findRoomObjectSnap({x:20.1,y:20.1},[room],{width:400,height:500},{tolerancePx:12,midpoints:true});
check(mid?.kind==='midpoint' && mid.point.x===20 && mid.point.y===20,'midpoint OSNAP when enabled');
check(findRoomObjectSnap({x:75,y:75},[room],{width:400,height:500},{tolerancePx:12})===null,'no forced snap beyond tolerance');
check(room.x===10 && room.y===20 && room.width===20 && room.height===30,'existing room geometry unchanged');
const pop=placeFloorPlanDisplayPopover({right:380,bottom:100},{left:0,top:0,width:390,height:844});
check(pop.left>=0 && pop.left+pop.width<=390 && pop.top>=0 && pop.maxHeight>0,'popover fits iPhone portrait viewport');
console.log('HNL MAP DISPLAY PROD-PARITY DEV GOLDEN PASS');
