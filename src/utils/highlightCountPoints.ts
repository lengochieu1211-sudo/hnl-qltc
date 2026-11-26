/** Optional stage-scoped count markers for ĐVT Cái.
 * Existing workVolume and highlight shapes remain unchanged unless the caller
 * explicitly confirms saving a point-count quantity. Never infer Cái from m².
 */
import type { RoomProgressItem, RoomSubItem } from '../types';
import { normalizeUnit } from './unitUtils.ts';

export type CountPoint = { id: string; x: number; y: number; count?: number };
export type CountMode = 'manual' | 'points';
export type CountRegionMode = 'main' | 'own' | 'none';
export const MAX_COUNT_MARKERS = 250;
export const MAX_COUNT_SUM = 100000;

export const isCountStage = (stage: RoomSubItem, room: RoomProgressItem): boolean =>
  normalizeUnit(stage.volumeUnit || room.categoryVolumeUnits?.[stage.category || room.workCategory || ''] || room.volumeUnit) === 'Cái';

export const totalCountPoints = (points: readonly CountPoint[]): number =>
  points.reduce((total, point) => total + (point.count ?? 1), 0);

const insideRoom = (room: RoomProgressItem, point: CountPoint): boolean => {
  if (room.width <= 0 || room.height <= 0 || room.isPolyline) return false;
  const px = room.x + room.width * point.x / 100;
  const py = room.y + room.height * point.y / 100;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  // Room polygon is authoritative: a marker must not fall into an empty corner
  // of a rotated/polygonal bounding rectangle.
  if (room.points && room.points.length >= 3) {
    let inside = false;
    for (let i=0,j=room.points.length-1;i<room.points.length;j=i++) {
      const a=room.points[i],b=room.points[j];
      if (((a.y>py)!==(b.y>py)) && px<((b.x-a.x)*(py-a.y))/(b.y-a.y)+a.x) inside=!inside;
    }
    return inside;
  }
  return true;
};

export const validCountPoints = (room: RoomProgressItem, points: unknown): points is CountPoint[] => {
  if (!Array.isArray(points) || points.length>MAX_COUNT_MARKERS) return false;
  const ids = new Set<string>();
  let sum=0;
  for (const raw of points) {
    if (!raw || typeof raw !== 'object') return false;
    const p=raw as CountPoint;
    if (typeof p.id!=='string' || p.id.trim().length<2 || p.id.length>100 || ids.has(p.id)) return false;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x<0 || p.x>100 || p.y<0 || p.y>100) return false;
    const count=p.count??1;
    if (!Number.isSafeInteger(count) || count<1 || count>MAX_COUNT_SUM) return false;
    if (!insideRoom(room,p)) return false;
    ids.add(p.id);sum+=count;
    if (sum>MAX_COUNT_SUM) return false;
  }
  return true;
};

export interface HighlightCountSaveRequest {
  roomId: string;
  stageId: string;
  expectedUpdatedAt: number;
  expectedRevision?: number;
  points: CountPoint[];
  mode: CountMode;
  regionMode: CountRegionMode;
  /** Explicit final quantity when manual. In points mode the sum is authoritative. */
  manualVolume?: number;
}

export const canSaveHighlightCount = (room: RoomProgressItem | undefined, request: HighlightCountSaveRequest): boolean => {
  if (!room || room.id!==request.roomId || room.deletedAt || room.positionLocked || room.isPolyline || room.subItemProgressMigrated) return false;
  if (room.updatedAt!==request.expectedUpdatedAt || room.revision!==request.expectedRevision || room.inspectionStatus==='Đạt nghiệm thu') return false;
  const matches=room.subItems?.filter(x=>x.id===request.stageId)||[];
  if(matches.length!==1 || room.quantityFormulaSettings?.['sub:'+request.stageId])return false;
  const stage=matches[0];
  if (!stage || !isCountStage(stage,room) || stage.status==='Đã hoàn thành' || stage.inspectionStatus==='Đạt nghiệm thu') return false;
  if (!['manual','points'].includes(request.mode) || !['main','own','none'].includes(request.regionMode)) return false;
  if (!validCountPoints(room,request.points)) return false;
  return request.mode!=='manual' || (request.manualVolume!==undefined && Number.isSafeInteger(request.manualVolume) && request.manualVolume>=0 && request.manualVolume<=MAX_COUNT_SUM);
};

/** A narrow immutable patch, preserving every other stage and every old quantity/field. */
export const applyHighlightCount = (room: RoomProgressItem, request: HighlightCountSaveRequest): RoomProgressItem => ({
  ...room,
  subItems: (room.subItems || []).map(stage=> stage.id===request.stageId ? {
    ...stage,
    highlightCountPoints: request.points.map(p=>({...p})),
    highlightCountMode: request.mode,
    highlightVolumeMode: 'manual', // Never mix legacy m² area auto with ĐVT Cái counting.
    highlightCountRegionMode: request.regionMode,
    ...(request.mode==='points' ? { workVolume: totalCountPoints(request.points), volumeUnit: 'Cái' }
      : {workVolume: request.manualVolume, volumeUnit:'Cái'}),
  } : stage),
});
