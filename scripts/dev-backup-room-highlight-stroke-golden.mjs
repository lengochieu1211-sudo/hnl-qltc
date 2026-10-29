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
assert.equal(shapes.filter(x=>/strokeWidth=\{isSelectedForDrag \? 2\.6 : 2\}/.test(x)).length,3,'Highlight foreground widths must be uniform');
assert.equal(shapes.filter(x=>/strokeWidth=\{4\}/.test(x)).length,1,'Polyline glow width must be uniform');
assert(!shapes.some(x=>/strokeWidth=.*strokeScale/.test(x)), 'Saved room stroke must not depend on 0-100 SVG scale');
assert.equal(shapes.filter(x=>/onClick=/.test(x)).length,3,'Room selection must retain click events');
assert.equal(shapes.filter(x=>/onTouchStart=/.test(x)).length,3,'Room touch events must be preserved');
assert(source.includes('strokeWidth={0.22 * svgZoomCompensation}'),'Defect marker overlay must remain unchanged');
assert(source.includes('data-hnl-orthogonal-snap-guide="polygon"'),'Orthogonal snap guide must remain unchanged');
console.log('PASS source mapping, saved-room four strokes, selection, touch, Defect and snap untouched');

const browser = await chromium.launch({headless:true});
try {
 for (const [width,height] of [[880,360],[360,880],[640,640],[1280,440],[440,1280]]) {
  const page=await browser.newPage({viewport:{width:Math.max(440,width),height:Math.max(440,height)}});
  const result=await page.evaluate(async ({width,height})=>{
   const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" width="'+width+'" height="'+height+'"><rect x="20" y="20" width="60" height="60" fill="none" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
   const img=new Image();
   const data='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
   await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=data;});
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,width,height);
   const {data}=ctx.getImageData(0,0,width,height);
   const alpha=(x,y)=>data[(Math.floor(y)*width+Math.floor(x))*4+3];
   const midX=Math.round(width/2),midY=Math.round(height/2);
   const leftX=Math.round(width*.2),topY=Math.round(height*.2);
   let vertical=0,horizontal=0;
   for(let dx=-8;dx<=8;dx++)if(alpha(leftX+dx,midY)>120)vertical++;
   for(let dy=-8;dy<=8;dy++)if(alpha(midX,topY+dy)>120)horizontal++;
   return {vertical,horizontal,alphaAtMid:alpha(midX,midY)};
  },{width,height});
  assert(result.vertical>=1&&result.horizontal>=1, 'Visible edges missing '+JSON.stringify({width,height,result}));
  assert(Math.abs(result.vertical-result.horizontal)<=1,'Uneven vertical/horizontal stroke thickness '+JSON.stringify({width,height,result}));
  assert.equal(result.alphaAtMid,0,'Room interior changed by stroke fix');
  console.log('PASS SVG rendered stroke width '+width+'x'+height+': vertical='+result.vertical+'px, horizontal='+result.horizontal+'px');
  await page.close();
 }
} finally {await browser.close();}
console.log('PASS uniform room highlight strokes across wide/tall/square/zoom-equivalent viewports');
