
import assert from 'node:assert/strict';
import { translateRoomGroupToCanvas, fitRoomRectToCanvas } from '../src/utils/roomHighlightGeometry.ts';
import { reorderExistingByIds } from '../src/utils/auditDataSafety.ts';
let seed=0xA57F1991;
const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/2**32;};
const near=(a,b,e=.111)=>Math.abs(a-b)<=e;
const errs=[];
for(let i=0;i<3000;i++){
 const rooms=[];
 const cnt=1+Math.floor(rand()*4);
 for(let j=0;j<cnt;j++){
   const w=1+rand()*25,h=1+rand()*25, x=rand()*(100-w),y=rand()*(100-h);
   rooms.push({id:String(j),x,y,width:w,height:h,points:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]});
 }
 const dx=(rand()-.5)*350,dy=(rand()-.5)*350;
 const moved=translateRoomGroupToCanvas(rooms,dx,dy);
 if(!moved)throw new Error('unexpected null valid geometry');
 for(let j=0;j<cnt;j++){
   for(let k=0;k<4;k++){
    const p=moved[j].points[k],b=rooms[j].points[k];
    const diffX=p.x-b.x,diffY=p.y-b.y;
    if(!(p.x >= -.001 && p.x<=100.001 && p.y>=-.001 && p.y<=100.001))errs.push({i,j,k,reason:'outbound',p});
    if(!near(diffX, moved[0].points[0].x-rooms[0].points[0].x,0.11) || !near(diffY,moved[0].points[0].y-rooms[0].points[0].y,0.11))errs.push({i,j,k,reason:'relative-distortion',diffX,diffY});
   }
  }
}
console.log('property-tested 3000 randomized group moves, failures',errs.length,errs.slice(0,8));
if(errs.length)process.exitCode=1;

for(let i=0;i<5000;i++){
 const w=rand()*130,h=rand()*130,x=(rand()-.2)*140,y=(rand()-.2)*140;
 const r=fitRoomRectToCanvas(x,y,w,h);
 if(!(r.x>=0 && r.y>=0 && r.width>0 && r.height>0 && r.x+r.width<=100+1e-8 && r.y+r.height<=100+1e-8)){
  errs.push({i,reason:'fractional-rectangle-overflow',r,x,y,w,h});
 }
}
const special = fitRoomRectToCanvas(99.9,99.9,0.15,0.15);
assert.ok(special.x+special.width<=100 && special.y+special.height<=100);
for(let i=0;i<1000;i++){
 const current=Array.from({length:1+Math.floor(rand()*20)},(_,j)=>({id:`id-${j}`,value:j}));
 const shuffled=[...current].sort(()=>rand()-.5).slice(0,Math.floor(rand()*current.length));
 const requested=[...shuffled,{id:'id-stale-deleted'},...(shuffled.length?[shuffled[0]]:[])];
 const res=reorderExistingByIds(current,requested);
 assert.equal(res.length,current.length,'no record dropped or added');
 assert.equal(new Set(res.map(x=>x.id)).size,current.length,'no duplicate records');
 assert.ok(res.every(x=>current.includes(x)),'preserve current object identity');
}
console.log('Property golden:', {groupMoves:3000, rectangles:5001, staleReorders:1000, failures:errs.length});
if(errs.length){console.error(errs.slice(0,8));process.exitCode=1;}
