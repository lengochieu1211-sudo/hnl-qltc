import type { FloorPlan, RoomProgressItem, RoomSubItem, WorkVolume } from '../types';
import { getSubItemGroupWeight } from './teamUtils';
import {
  canonicalWorkCategoryId,
  getCanonicalRoomCategoryEntries,
  resolveAuthoritativeWorkVolumeRef,
  resolveWorkVolumeRef,
} from './linkageIntegrity';

function roomFloorName(room: RoomProgressItem, floorPlans: FloorPlan[]): string {
  return room.floorName || floorPlans.find((floor) => floor.id === room.floorId)?.floorName || '';
}

function subItemBelongsToCategory(
  sub: RoomSubItem,
  room: RoomProgressItem,
  categoryId: string,
  workVolumes: WorkVolume[],
  floorName: string,
): boolean {
  if (sub.workCategoryId) {
    const resolved = resolveAuthoritativeWorkVolumeRef({
      workVolumes,
      workCategoryId: sub.workCategoryId,
      floorId: room.floorId,
      floorName,
    });
    return resolved.state === 'resolved' && canonicalWorkCategoryId(resolved.work) === categoryId;
  }
  const legacyName = sub.category || (!sub.category && room.workCategoryId ? undefined : room.workCategory);
  if (!legacyName) return false;
  const resolved = resolveWorkVolumeRef({
    workVolumes,
    workCategoryName: legacyName,
    floorId: room.floorId,
    floorName,
  });
  return resolved.state === 'resolved' && canonicalWorkCategoryId(resolved.work) === categoryId;
}


export interface WorkVolumeRoomDetail {
  roomId: string;
  roomName: string;
  floorId: string;
  floorName: string;
  assignedVolume: number;
  actualVolume: number;
  progressPercent: number;
  teamIds: string[];
  teamNames: string[];
  hasDetailedStages: boolean;
}

export interface WorkVolumeDetailBreakdown {
  workVolumeId: string;
  workCategoryId: string;
  rows: WorkVolumeRoomDetail[];
  totalAssigned: number;
  totalActual: number;
}

export function computeWorkVolumeDetailBreakdown(
  item: WorkVolume,
  workVolumes: WorkVolume[],
  rooms: RoomProgressItem[],
  floorPlans: FloorPlan[] = [],
): WorkVolumeDetailBreakdown {
  const categoryId = canonicalWorkCategoryId(item);
  if (!categoryId) {
    return { workVolumeId: item.id, workCategoryId: '', rows: [], totalAssigned: 0, totalActual: 0 };
  }

  const activeRooms = rooms.filter((room) => room.deletedAt === undefined || room.deletedAt === null);
  const rows: WorkVolumeRoomDetail[] = [];

  activeRooms.forEach((room) => {
    const floorName = roomFloorName(room, floorPlans);
    const categoryEntry = getCanonicalRoomCategoryEntries(room, workVolumes)
      .find((entry) => entry.workCategoryId === categoryId);
    if (!categoryEntry) return;

    const assignedVolume = Math.max(0, Number(categoryEntry.quantity) || 0);
    const categorySubItems = (room.subItems || []).filter((sub) =>
      subItemBelongsToCategory(sub, room, categoryId, workVolumes, floorName),
    );

    let actualVolume = 0;
    if (assignedVolume > 0 && categorySubItems.length > 0) {
      const totalWeight = categorySubItems.reduce(
        (sum, sub) => sum + getSubItemGroupWeight(categorySubItems, sub),
        0,
      );
      const completedWeight = categorySubItems.reduce((sum, sub) => {
        if (sub.status !== 'Đã hoàn thành') return sum;
        return sum + getSubItemGroupWeight(categorySubItems, sub);
      }, 0);
      actualVolume = assignedVolume * (totalWeight > 0 ? Math.min(1, completedWeight / totalWeight) : 0);
    } else if (assignedVolume > 0) {
      const title = String(item.title || '').toLocaleLowerCase('vi-VN');
      const isFrame = title.includes('khung') || title.includes('xương');
      const isBoard = title.includes('tấm');
      if (isFrame) {
        if (room.frameStatus === 'Đã hoàn thành') actualVolume = assignedVolume;
      } else if (isBoard) {
        if (room.boardStatus === 'Đã hoàn thành') actualVolume = assignedVolume;
      } else if (room.inspectionStatus === 'Đạt nghiệm thu') {
        actualVolume = assignedVolume;
      }
    }

    const teamIds = Array.from(new Set([
      room.teamId,
      ...categorySubItems.map((sub) => sub.teamId),
    ].map((value) => String(value || '').trim()).filter(Boolean)));
    const teamNames = Array.from(new Set([
      room.assignedTeam,
      ...categorySubItems.map((sub) => sub.assignedTeam),
    ].map((value) => String(value || '').trim()).filter(Boolean)));

    const roundedActual = Math.round(actualVolume * 100) / 100;
    rows.push({
      roomId: room.id,
      roomName: room.roomName || room.id,
      floorId: room.floorId,
      floorName: floorName || room.floorId || 'Mặt bằng',
      assignedVolume,
      actualVolume: roundedActual,
      progressPercent: assignedVolume > 0 ? Math.min(100, Math.round((roundedActual / assignedVolume) * 100)) : 0,
      teamIds,
      teamNames,
      hasDetailedStages: categorySubItems.length > 0,
    });
  });

  return {
    workVolumeId: item.id,
    workCategoryId: categoryId,
    rows,
    totalAssigned: Math.round(rows.reduce((sum, row) => sum + row.assignedVolume, 0) * 100) / 100,
    totalActual: Math.round(rows.reduce((sum, row) => sum + row.actualVolume, 0) * 100) / 100,
  };
}

/**
 * Compute actual/status from Room/Stage data while keeping the WorkVolume catalog as
 * the master for planned/floor/category identity. planned=0 is a valid master value.
 */
export function computeDerivedWorkVolumes(
  workVolumes: WorkVolume[],
  rooms: RoomProgressItem[],
  floorPlans: FloorPlan[] = [],
): WorkVolume[] {
  return workVolumes.map((item) => {
    const categoryId = canonicalWorkCategoryId(item);
    if (!categoryId) return { ...item, actual: 0, status: 'Chưa thi công' };

    const detail = computeWorkVolumeDetailBreakdown(item, workVolumes, rooms, floorPlans);
    const actual = detail.rows.length > 0 ? detail.totalActual : 0;
    const planned = Number.isFinite(Number(item.planned)) ? Number(item.planned) : 0;
    const status: WorkVolume['status'] = actual > 0
      ? (planned > 0 && actual + 1e-9 >= planned ? 'Đã hoàn thành' : 'Đang thi công')
      : 'Chưa thi công';

    return { ...item, planned, actual, status };
  });
}
