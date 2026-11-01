import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../src/components/FloorPlanDefectTab.tsx', import.meta.url), 'utf8');
const utility = fs.readFileSync(new URL('../src/utils/floorPlanDisplayPopover.ts', import.meta.url), 'utf8');
const checks = [
  ['anchor menu to real trigger',source.includes('placeFloorPlanDisplayPopover(\n      trigger.getBoundingClientRect(), viewport.getBoundingClientRect()')],
  ['single top level display popover', (source.match(/data-hnl-fullscreen-display-popover=/g)||[]).length===1],
  ['legacy hard coded top-left placement removed', !source.includes('top-[58px] left-2 right-2')],
  ['outside click closes menu', source.includes("document.addEventListener('pointerdown', dismissOutside, true)")],
  ['escape closes menu without clearing drawing draft', source.includes("e.key === 'Escape' && isFullscreen && showFullscreenDisplaySettings")],
  ['resize and orientation close menu', source.includes("window.addEventListener('orientationchange', dismissOnResize)")],
  ['no overlap with selected room action bar', source.includes('!(isFullscreen && showFullscreenDisplaySettings) && (selectedRoomObject')],
  ['dimension clamp of popover', utility.includes('viewport.width - padding * 2') && utility.includes('viewport.height - top - 12')],
  ['OSNAP settings remain intact',source.includes('Bắt điểm phòng (OSNAP)')],
  ['freehand draw handler retained',source.includes('handlePointerDownImage') && source.includes('handlePointerMoveImage')],
];
for (const [name,ok] of checks){assert.ok(ok,name);console.log('PASS P21.84:',name)}
// Pure geometry helper is TS and has no dependencies. Load by transpiling its two types away.
let code=utility.replace(/\nexport function placeFloorPlanDisplayPopover\([\s\S]*?\): \{ left: number; top: number; width: number; maxHeight: number \} \{/,
  '\nexport function placeFloorPlanDisplayPopover(trigger, viewport) {');
code=code.replaceAll('const padding = 8;', 'const padding = 8;');
const {placeFloorPlanDisplayPopover: place}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
for(const [name,v,t] of [
  ['phone narrow',{left:0,top:0,width:345,height:690},{right:240,bottom:65}],
  ['PC wide',{left:0,top:0,width:1440,height:900},{right:1100,bottom:90}],
  ['landscape',{left:0,top:0,width:812,height:360},{right:680,bottom:50}],
  ['rotated viewport',{left:45,top:30,width:420,height:780},{right:230,bottom:105}],
]) {
 const x=place(t,v);
 assert.ok(x.left>=8&&x.left+x.width<=v.width-8,name+' horizontal bound');
 assert.ok(x.top>=8&&x.top+x.maxHeight<=v.height-1,name+' vertical bound');
 assert.ok(x.maxHeight<=v.height*.34+2,name+' height cap');
 console.log('PASS P21.84:',name,JSON.stringify(x));
}
console.log('PASS P21.84 fullscreen display popover responsive golden');
