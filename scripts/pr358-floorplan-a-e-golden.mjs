import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const path='src/components/FloorPlanDefectTab.tsx';
const candidate=fs.readFileSync(path,'utf8');
const qa=execFileSync('git',['show','0d6afbff0a053a95a441cc84d27631bdf1332c6a:'+path],{encoding:'utf8'});
const old=qa.split('\n'),newer=candidate.split('\n');
assert.equal(old.length,newer.length,'Candidate floor plan unexpectedly restructured');
const diffs=[];
for(let i=0;i<old.length;i++)if(old[i]!==newer[i])diffs.push({line:i+1,old:old[i],now:newer[i]});
assert.equal(diffs.length,2,'DEV Backup vs candidate code drift must be ONLY two HNL active-control color styles');
assert.deepEqual(diffs.map(x=>x.line),[6342,6347],'Only two reviewed compact display mode button styles differ');
assert(diffs.every(x=>x.now.includes('bg-indigo-600 text-white')),'HNL active buttons use primary color');
console.log('PASS A-E application SOURCE PARITY to DEV Backup P21.84, two active-button cosmetics only');
const section=(a,b)=>{const x=candidate.indexOf(a),y=candidate.indexOf(b,x+1);assert(x>=0&&y>x,'Missing section '+a);return candidate.slice(x,y)};
const drawing=section('// Pointer Down on Floor Plan','// Finish Polygon / Line Drawing');
for(const [label,pattern] of [
 ['A: pointer capture',/setPointerCapture\(e\.pointerId\)/],
 ['A: freehand path remains active',/if \(isFreehandDrawing\)/],
 ['A: pointer release',/releasePointerCapture\(e\.pointerId\)/],
 ['A: cancel never finalizes',/const handleCancelledDrawPointer[\s\S]+setFreehandPoints\(\[\]\)/],
]){assert(pattern.test(drawing),label);console.log('PASS '+label);}
assert(candidate.includes('onPointerCancel={handleCancelledDrawPointer}'),'A: separate canceled pointer handler');
assert(candidate.includes("touchAction: (isRoomCreationDrawing && (drawTool === 'freehand' || drawTool === '2point'))"),'A: touch-action none in all/highlight modes');
assert(candidate.includes('data-hnl-exclusive-room-draw="true"'),'A: protected drawing surface above room+defect');
assert(candidate.includes("viewMode === 'all' || viewMode === 'highlight'"),'A: combined room+defect view');
console.log('PASS A: touch/freehand source event and existing-room/Defect hit guard (source audit only)');
for(const key of ['room_object_snap_enabled','room_object_snap_midpoints','objectSnapEnabled','objectSnapMidpoints','getSavedRoomSnap','data-hnl-osnap-marker','getDraftKey(key)'])assert(candidate.includes(key),'Missing B: '+key);
assert(candidate.includes("useState(() => readSnapPref('room_object_snap_enabled'))"),'B: default off unless local setting true');
assert(candidate.includes('findRoomObjectSnap(point, displayedFloorRooms'),'B: snap against saved geometry read-only');
console.log('PASS B: endpoints/vertices/midpoints/marker/default-off/per-project-device OSNAP source');
for(const key of ['F3','F7','F8','F9','F10',"updateSnapPref('room_cad_polar', false, setCadPolar)","updateSnapPref('room_cad_ortho', false, setCadOrtho)",'getCadDrawingHotkey(e)'])assert(candidate.includes(key),'Missing C: '+key);
assert(!candidate.includes('data-hnl-cad-toolbar='),'C: no extra CAD toolbar');
console.log('PASS C: five CAD hotkeys and F8/F10 exclusivity without toolbar');
for(const key of ['fullscreenDisplayTriggerRef','fullscreenDisplayPopoverRef','placeFloorPlanDisplayPopover(', "document.addEventListener('pointerdown', dismissOutside, true)", "e.key === 'Escape' && isFullscreen && showFullscreenDisplaySettings",'data-hnl-fullscreen-display-popover','Bắt điểm phòng (OSNAP)'])assert(candidate.includes(key),'Missing D: '+key);
assert(!candidate.includes('top-[58px] left-2 right-2'),'D: old overlapping panel must be removed');
console.log('PASS D: popover anchored/clamped/outside/Escape without room selection loss source');
for(const key of ['Math.min(250, Math.max(50, value))','Math.min(175, Math.max(75, percent))','const savedRoomStrokeScale = roomHighlightStrokePercent / 100;','strokeWidth={4 * savedRoomStrokeScale}','vectorEffect="non-scaling-stroke"','defectLabelScale * defectLabelScalePercent / 100'])assert(candidate.includes(key),'Missing E: '+key);
assert.equal((candidate.match(/strokeWidth=\{\(isSelectedForDrag \? 2\.6 : 2\) \* savedRoomStrokeScale\}/g)||[]).length,3,'E: all visible room outline styles use same slider percentage');
for(const key of ['Zoom','Fit','Focus','Mini','Lớp','Full Screen'])assert(candidate.includes(key),'E: original nav control missing '+key);
console.log('PASS E: P21.82 stroke/label ranges and uniform rendered saved outlines, nav controls present (source)');
assert(!/updateDoc\(room/.test(candidate),'Must not write existing room fields from display preference');
console.log('PASS A–E focused static parity and source guard; NOT physical signed-in mobile Runtime Golden');
