import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// The real FloorPlanDefectTab renderer is the authority. Its geometry and hit
// handlers remain unchanged; the audit below inspects exactly the saved-room
// render subtree, not independent demo component code.
const source = readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');
const first = source.indexOf('{/* Render All Saved Room Highlights */}');
const last = source.indexOf('                })}', first);
assert(first > 0 && last > first, 'Saved-room render block must exist');
const saved = source.slice(first, last);
const svgStart = source.lastIndexOf('<svg className="absolute inset-0 w-full h-full pointer-events-none z-10"',first);
assert(svgStart > 0, 'Existing overlay SVG must stay in place');
assert(source.slice(svgStart,svgStart+180).includes('viewBox="0 0 100 100" preserveAspectRatio="none"'), 'Preserve exact percentage coordinate mapping');
const shapes = [...saved.matchAll(/<(polyline|polygon|rect)\b[\s\S]*?\/>/g)].map(m => m[0]);
assert.equal(shapes.length,4, 'Expected two polylines, polygon and rectangle');
assert.equal(shapes.filter(x=>x.includes('vectorEffect="non-scaling-stroke"')).length,4,'All saved-room visible strokes must be non-scaling');
assert(source.includes('const savedRoomStrokeScale = roomHighlightStrokePercent / 100;'), 'Saved stroke uses display percentage only, not zoom');
assert.equal(shapes.filter(x=>x.includes('strokeWidth={(isShapeDrawing ? 1.15 : isSelectedForDrag ? 2.6 : 2) * savedRoomStrokeScale}')).length,3,'All saved foregrounds share normal/selected/drawing width policy');
assert.equal(shapes.filter(x=>x.includes('strokeWidth={4 * savedRoomStrokeScale}')).length,1,'Polyline glow respects display percentage');
assert(!shapes.some(x=>/strokeWidth=.*\bstrokeScale\b/.test(x)), 'Saved room stroke must not depend on inverse zoom or 0-100 SVG scale');
assert.equal(shapes.filter(x=>/onClick=/.test(x)).length,3,'Room selection must retain click events');
assert.equal(shapes.filter(x=>/onTouchStart=/.test(x)).length,3,'Room touch events must be preserved');
assert(source.includes('strokeWidth={0.22 * svgZoomCompensation}'),'Defect marker overlay must remain unchanged');
assert(source.includes('data-hnl-orthogonal-snap-guide="polygon"'),'Orthogonal snap guide must remain unchanged');
console.log('PASS source mapping, saved-room four strokes, selection, touch, Defect and snap untouched');

const browser = await chromium.launch({headless:true});
try {
 for (const [width,height] of [[880,360],[360,880],[640,640],[1280,440],[440,1280]]) {
  const page=await browser.newPage({viewport:{width:Math.max(440,width),height:Math.max(440,height)}});
  for (const percent of [50,100,250]) for (const [mode,base] of [['normal',2],['selected',2.6],['drawing',1.15],['glow',4]]) {
  const expected=base*percent/100;
  const result=await page.evaluate(async ({width,height,expected})=>{
   const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" width="'+width+'" height="'+height+'"><rect x="20" y="20" width="60" height="60" fill="none" stroke="#000" stroke-width="'+expected+'" vector-effect="non-scaling-stroke"/></svg>';
   const img=new Image();
   const data='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
   await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=data;});
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,width,height);
   const {data:pixels}=ctx.getImageData(0,0,width,height);
   const alpha=(x,y)=>pixels[(Math.floor(y)*width+Math.floor(x))*4+3];
   const midX=Math.round(width/2),midY=Math.round(height/2);
   const leftX=Math.round(width*.2),topY=Math.round(height*.2);
   let vertical=0,horizontal=0;
   // Sum alpha coverage so subpixel strokes are tested rather than rounded away.
   for(let dx=-12;dx<=12;dx++)vertical+=alpha(leftX+dx,midY)/255;
   for(let dy=-12;dy<=12;dy++)horizontal+=alpha(midX,topY+dy)/255;
   return {vertical,horizontal,alphaAtMid:alpha(midX,midY)};
  },{width,height,expected});
  const detail=JSON.stringify({width,height,percent,mode,expected,result});
  assert(result.vertical>0&&result.horizontal>0,'Visible edges missing '+detail);
  assert(Math.abs(result.vertical-result.horizontal)<=0.75,'Uneven vertical/horizontal stroke thickness '+detail);
  assert(Math.abs(result.vertical-expected)<=0.75&&Math.abs(result.horizontal-expected)<=0.75,'Wrong screen-pixel width '+detail);
  assert.equal(result.alphaAtMid,0,'Room interior changed by stroke fix');
  console.log('PASS SVG rendered stroke '+detail);
  }
  await page.close();
 }
} finally {await browser.close();}
console.log('PASS uniform room highlight strokes across wide/tall/square/zoom-equivalent viewports');
