/**
 * HNL QLTC — opt-in aggregate highlight geometry (room-local % coordinates).
 * This calculation is pure: never writes stored records, locks or acceptance data.
 * Historic rectangle highlights remain supported through their original fields.
 */
import type { HighlightRegionRect, HighlightRegionShape, Point2D, RoomProgressItem, RoomSubItem } from '../types';

const EPS = 1e-7;
const LIMIT = 24;
const POINT_LIMIT = 128;
const WHOLE: HighlightRegionRect = { x: 0, y: 0, width: 100, height: 100 };
type RoomGeometry = Pick<RoomProgressItem, 'x' | 'y' | 'width' | 'height' | 'points' | 'isPolyline'>;
type Polygon = Point2D[];
export interface HighlightTotalResult {
  valid: boolean;
  ratio: number;
  percent: number;
  totalArea: number;
  coveredArea: number;
  reason?: string;
}
const validNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const cross = (a: Point2D, b: Point2D, c: Point2D) => (b.x - a.x)*(c.y - a.y) - (b.y - a.y)*(c.x - a.x);
function signedArea(p: Polygon): number {
  return p.reduce((s, v, i) => { const n = p[(i+1)%p.length]; return s + v.x*n.y - n.x*v.y; }, 0) / 2;
}
function same(a: Point2D, b: Point2D): boolean { return Math.abs(a.x-b.x)<EPS && Math.abs(a.y-b.y)<EPS; }
function segmentsCross(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const x=cross(a,b,c), y=cross(a,b,d), z=cross(c,d,a), w=cross(c,d,b);
  const on=(p:Point2D,q:Point2D,r:Point2D)=>Math.abs(cross(p,q,r))<EPS && r.x>=Math.min(p.x,q.x)-EPS && r.x<=Math.max(p.x,q.x)+EPS && r.y>=Math.min(p.y,q.y)-EPS && r.y<=Math.max(p.y,q.y)+EPS;
  if ((x>EPS && y< -EPS || x< -EPS && y>EPS) && (z>EPS && w< -EPS || z< -EPS && w>EPS)) return true;
  return on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
}
function normalizePolygon(points: Point2D[]): Polygon | null {
  if (!Array.isArray(points) || points.length<3 || points.length>POINT_LIMIT+1) return null;
  const p: Polygon = [];
  for (const q of points) {
    if (!q || !validNumber(q.x) || !validNumber(q.y) || q.x < -EPS || q.x>100+EPS || q.y< -EPS || q.y>100+EPS) return null;
    const n={x:Math.max(0,Math.min(100,q.x)), y:Math.max(0,Math.min(100,q.y))};
    if (!p.length || !same(p[p.length-1],n)) p.push(n);
  }
  if (p.length>3 && same(p[0],p[p.length-1])) p.pop();
  if (p.length<3 || p.length>POINT_LIMIT || Math.abs(signedArea(p))<0.01) return null;
  // Reject self-intersection rather than producing an arbitrary area.
  for(let i=0;i<p.length;i++) for(let j=i+1;j<p.length;j++) {
    if(j===i+1 || (i===0&&j===p.length-1)) continue;
    if(segmentsCross(p[i],p[(i+1)%p.length],p[j],p[(j+1)%p.length])) return null;
  }
  return p;
}
const rectToPolygon = (r: HighlightRegionRect): Polygon | null => {
  if(!r || ![r.x,r.y,r.width,r.height].every(validNumber)) return null;
  const x=Math.max(0,Math.min(100,r.x)), y=Math.max(0,Math.min(100,r.y));
  const x2=Math.max(0,Math.min(100,r.x+r.width)),y2=Math.max(0,Math.min(100,r.y+r.height));
  if(x2-x<0.2||y2-y<0.2)return null;
  return [{x,y},{x:x2,y},{x:x2,y:y2},{x,y:y2}];
};
export function isHighlightPolygon(shape: HighlightRegionShape): shape is Extract<HighlightRegionShape, {kind:'polygon'}> {
  return 'kind' in shape && shape.kind === 'polygon';
}
export function validateHighlightShape(shape: HighlightRegionShape): boolean { return !!(isHighlightPolygon(shape) ? normalizePolygon(shape.points) : rectToPolygon(shape)); }
function asPolygons(shapes: HighlightRegionShape[]): Polygon[] | null {
  if (!Array.isArray(shapes) || shapes.length > LIMIT) return null;
  const p=shapes.map(sh=>isHighlightPolygon(sh)?normalizePolygon(sh.points):rectToPolygon(sh));
  return p.some(x=>!x)?null:p as Polygon[];
}
function getRoomPolygon(room: RoomGeometry): Polygon | null {
  if (room.isPolyline || !validNumber(room.x)||!validNumber(room.y)||!validNumber(room.width)||!validNumber(room.height)||room.width<=0||room.height<=0) return null;
  if(!room.points?.length)return rectToPolygon(WHOLE);
  if(room.points.length<3)return null;
  return normalizePolygon(room.points.map(p=>({x:(p.x-room.x)*100/room.width,y:(p.y-room.y)*100/room.height})));
}

type Seg={a:Point2D;b:Point2D};
function edges(p:Polygon):Seg[]{return p.map((a,i)=>({a,b:p[(i+1)%p.length]}));}
function crossingX(a:Seg,b:Seg):number | null {
  const r={x:a.b.x-a.a.x,y:a.b.y-a.a.y}, s={x:b.b.x-b.a.x,y:b.b.y-b.a.y};
  const den=r.x*s.y-r.y*s.x;
  if(Math.abs(den)<EPS)return null;
  const qp={x:b.a.x-a.a.x,y:b.a.y-a.a.y};
  const t=(qp.x*s.y-qp.y*s.x)/den, u=(qp.x*r.y-qp.y*r.x)/den;
  if(t< -EPS||t>1+EPS||u< -EPS||u>1+EPS)return null;
  return a.a.x+t*r.x;
}
type Span=[number,number];
function spansAtX(poly:Polygon,x:number):Span[]{
  const hits:number[]=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    if((a.x<=x&&b.x>x)||(b.x<=x&&a.x>x))hits.push(a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x));
  }
  hits.sort((a,b)=>a-b);
  const out:Span[]=[];
  for(let i=0;i+1<hits.length;i+=2)if(hits[i+1]-hits[i]>EPS)out.push([hits[i],hits[i+1]]);
  return out;
}
function union(spans:Span[]):Span[]{
  const sorted=spans.slice().sort((a,b)=>a[0]-b[0]);const out:Span[]=[];
  for(const s of sorted){const last=out[out.length-1];if(!last||s[0]>last[1]+EPS)out.push([...s]);else last[1]=Math.max(last[1],s[1]);}
  return out;
}
function intersection(a:Span[],b:Span[]):Span[]{
  const result:Span[]=[];
  for(const x of a)for(const y of b){const low=Math.max(x[0],y[0]),high=Math.min(x[1],y[1]);if(high-low>EPS)result.push([low,high]);}
  return union(result);
}
/** Exact polygon area from a vertical arrangement: edge crossings partition the
 * x-axis into strips where interval topology stays fixed. The interval length
 * is linear within each strip, so midpoint integration is exact. */
function intersectUnionArea(groups:Polygon[][]):number {
  if(groups.some(g=>!g.length))return 0;
  const lines=groups.flat().flatMap(edges);
  if(lines.length>1600)throw new Error('Vùng vẽ quá phức tạp (giới hạn 1600 cạnh).');
  const xs=lines.flatMap(s=>[s.a.x,s.b.x]);
  for(let i=0;i<lines.length;i++) for(let j=i+1;j<lines.length;j++) {
    const x=crossingX(lines[i],lines[j]);if(x!==null)xs.push(x);
  }
  xs.sort((a,b)=>a-b);
  let area=0,last=NaN;
  for(const edge of xs){if(!Number.isNaN(last)&&edge-last>EPS){
      const mid=(last+edge)/2;
      let spans=union(groups[0].flatMap(p=>spansAtX(p,mid)));
      for(let i=1;i<groups.length&&spans.length;i++)spans=intersection(spans,union(groups[i].flatMap(p=>spansAtX(p,mid))));
      area+=spans.reduce((sum,[a,b])=>sum+(b-a),0)*(edge-last);
    }last=edge;
  }
  return area;
}
/** All areas share the same denominator: the effective TOTAL region intersected
 * with the room, not a category subtotal. Return invalid instead of NaN. */
export function calculateHighlightTotalRatio(args:{
  room:RoomGeometry;
  total?:HighlightRegionShape[];
  main?:HighlightRegionShape[];
  sub?:HighlightRegionShape[];
}):HighlightTotalResult {
  const invalid=(reason:string):HighlightTotalResult=>({valid:false,ratio:0,percent:0,totalArea:0,coveredArea:0,reason});
  const room=getRoomPolygon(args.room);
  if(!room)return invalid('Biên căn/phòng chưa hợp lệ hoặc là đường mở.');
  const total=asPolygons(args.total?.length?args.total:[WHOLE]);
  const main=asPolygons(args.main?.length?args.main:[WHOLE]);
  const sub=asPolygons(args.sub?.length?args.sub:[WHOLE]);
  if(!total||!main||!sub)return invalid('Vùng vẽ chứa hình không hợp lệ hoặc vượt giới hạn.');
  try {
    const totalArea=intersectUnionArea([[room],total]);
    if(totalArea<EPS)return invalid('Vùng tổng không giao với căn/phòng.');
    const coveredArea=intersectUnionArea([[room],total,main,sub]);
    const ratio=Math.max(0,Math.min(1,coveredArea/totalArea));
    return {valid:true,ratio,percent:Math.round(ratio*10000)/100,totalArea,coveredArea};
  }catch(error){return invalid(error instanceof Error?error.message:'Không tính được diện tích vùng.');}
}
export function getHighlightStageShapes(stage:Pick<RoomSubItem,'highlightRegions'|'highlightShapes'|'highlightVolumeMode'>):HighlightRegionShape[]{
  if(stage.highlightShapes?.length)return stage.highlightShapes;
  if(stage.highlightRegions?.length)return stage.highlightRegions;
  return stage.highlightVolumeMode==='area'?[WHOLE]:[];
}
export function highlightShapeToPolygon(shape:HighlightRegionShape):Point2D[] | null {
  return isHighlightPolygon(shape)?normalizePolygon(shape.points):rectToPolygon(shape);
}
export function getHighlightShapeFloorPoints(room:Pick<RoomProgressItem,'x'|'y'|'width'|'height'>,shape:HighlightRegionShape):Point2D[]|null{
  const pts=highlightShapeToPolygon(shape);
  return pts?.map(p=>({x:room.x+room.width*p.x/100,y:room.y+room.height*p.y/100}))||null;
}
