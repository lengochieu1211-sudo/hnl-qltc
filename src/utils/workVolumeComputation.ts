import type { FloorPlan, RoomProgressItem, RoomSubItem, WorkVolume } from '../types';
import { getSubItemGroupWeight } from './teamUtils';
import {
  canonicalWorkCategoryId,
  getCanonicalRoomCategoryEntries,
  resolveWorkVolumeRef,
  workVolumeAppliesToFloor,
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
    const resolved = resolveWorkVolumeRef({
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

/**
 * Compute actual/status from Room/Stage data while keeping the WorkVolume catalog as
 * the master for planned/floor/category identity. planned=0 is a valid master value.
 */
export function computeDerivedWorkVolumes(
  workVolumes: WorkVolume[],
  rooms: RoomProgressItem[],
  floorPlans: FloorPlan[] = [],
): WorkVolume[] {
  const activeRooms = rooms.filter((room) => room.deletedAt === undefined || room.deletedAt === null);

  return workVolumes.map((item) => {
    const categoryId = canonicalWorkCategoryId(item);
    if (!categoryId) return { ...item, actual: 0, status: 'Chưa thi công' };

    let totalActual = 0;
    let hasLinkedRoom = false;

    activeRooms.forEach((room) => {
      const floorName = roomFloorName(room, floorPlans);
      if (!workVolumeAppliesToFloor(item, room.floorId, floorName)) return;

      const categoryEntry = getCanonicalRoomCategoryEntries(room, workVolumes)
        .find((entry) => entry.workCategoryId === categoryId);
      if (!categoryEntry) return;
      hasLinkedRoom = true;

      const roomVolume = Number(categoryEntry.quantity) || 0;
      if (roomVolume <= 0) return;

      const categorySubItems = (room.subItems || []).filter((sub) =>
        subItemBelongsToCategory(sub, room, categoryId, workVolumes, floorName),
      );

      if (categorySubItems.length > 0) {
        const totalWeight = categorySubItems.reduce(
          (sum, sub) => sum + getSubItemGroupWeight(categorySubItems, sub),
          0,
        );
        const completedWeight = categorySubItems.reduce((sum, sub) => {
          // Acceptance is evidence of inspection, not a substitute for construction completion.
          if (sub.status !== 'Đã hoàn thành') return sum;
          return sum + getSubItemGroupWeight(categorySubItems, sub);
        }, 0);
        totalActual += roomVolume * (totalWeight > 0 ? Math.min(1, completedWeight / totalWeight) : 0);
        return;
      }

      // Legacy rooms without detailed stages still use their explicit construction
      // statuses. Overall inspection may confirm completion only when there is no
      // detailed unfinished stage that could be overridden.
      const title = String(item.title || '').toLocaleLowerCase('vi-VN');
      const isFrame = title.includes('khung') || title.includes('xương');
      const isBoard = title.includes('tấm');
      if (isFrame) {
        if (room.frameStatus === 'Đã hoàn thành') totalActual += roomVolume;
      } else if (isBoard) {
        if (room.boardStatus === 'Đã hoàn thành') totalActual += roomVolume;
      } else if (room.inspectionStatus === 'Đạt nghiệm thu') {
        totalActual += roomVolume;
      }
    });

    const actual = hasLinkedRoom ? Math.round(totalActual * 100) / 100 : 0;
    const planned = Number.isFinite(Number(item.planned)) ? Number(item.planned) : 0;
    const status: WorkVolume['status'] = actual > 0
      ? (planned > 0 && actual + 1e-9 >= planned ? 'Đã hoàn thành' : 'Đang thi công')
      : 'Chưa thi công';

    return { ...item, planned, actual, status };
  });
}
