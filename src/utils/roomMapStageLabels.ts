/** Read-only stage summaries for labels on the floor-plan. Never normalizes or writes cloud data. */
import type { AcceptanceStatus, RoomInspectionResult, RoomProgressItem } from '../types';

export interface RoomMapStageLabel {
  /** View-only React key; not a Firestore ID. */
  key: string;
  name: string;
  category?: string;
  status: AcceptanceStatus;
  inspectionStatus?: RoomInspectionResult;
  targetDate?: string;
}

type RoomMapSource = Pick<RoomProgressItem,
  'subItems' | 'workCategory' | 'frameStatus' | 'boardStatus' |
  'frameInspectionStatus' | 'boardInspectionStatus' | 'targetFrameDate' | 'targetBoardDate'
>;

/** Saved sub-items are authoritative; only rooms WITHOUT them use the two legacy fields. */
export const getRoomMapStageLabels = (room: RoomMapSource): RoomMapStageLabel[] => {
  if (Array.isArray(room.subItems) && room.subItems.length > 0) {
    return room.subItems.map((stage, index) => ({
      key: `sub-${String(stage.id || index)}-${index}`,
      name: typeof stage.name === 'string' && stage.name.trim()
        ? stage.name.trim()
        : `Hạng mục con ${index + 1}`,
      category: (typeof stage.category === 'string' && stage.category.trim()
        ? stage.category.trim()
        : room.workCategory?.trim()) || undefined,
      status: stage.status || 'Chưa làm',
      inspectionStatus: stage.inspectionStatus,
      targetDate: stage.targetDate,
    }));
  }
  const legacyCategory = room.workCategory?.trim() || undefined;
  return [
    {
      key: 'legacy-frame', name: 'Khung', category: legacyCategory,
      status: room.frameStatus || 'Chưa làm',
      inspectionStatus: room.frameInspectionStatus,
      targetDate: room.targetFrameDate,
    },
    {
      key: 'legacy-board', name: 'Tấm', category: legacyCategory,
      status: room.boardStatus || 'Chưa làm',
      inspectionStatus: room.boardInspectionStatus,
      targetDate: room.targetBoardDate,
    },
  ];
};

export const getRoomMapConstructionIcon = (status: AcceptanceStatus): string =>
  status === 'Đã hoàn thành' ? '✅' : status === 'Đang làm' ? '🚧' : '⏳';

export const getRoomMapInspectionIcon = (status?: RoomInspectionResult): string =>
  status === 'Đạt nghiệm thu' ? '🏆' : status === 'Chưa đạt (Cần sửa)' ? '⚠️' : '⏳';
