export interface RoomColorOption {
  id: string;
  name: string;
  hex: string;
  fill: string;
  stroke: string;
}

export const ROOM_COLOR_PALETTE: RoomColorOption[] = [
  { id: 'blue', name: 'Xanh Lam', hex: '#3b82f6', fill: 'rgba(59, 130, 246, 0.45)', stroke: '#2563eb' },
  { id: 'emerald', name: 'Xanh Lục', hex: '#10b981', fill: 'rgba(16, 185, 129, 0.45)', stroke: '#059669' },
  { id: 'amber', name: 'Cam Hổ Phách', hex: '#f59e0b', fill: 'rgba(245, 158, 11, 0.45)', stroke: '#d97706' },
  { id: 'purple', name: 'Tím Hoa Cà', hex: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.45)', stroke: '#7c3aed' },
  { id: 'rose', name: 'Hồng Phấn', hex: '#f43f5e', fill: 'rgba(244, 63, 94, 0.45)', stroke: '#e11d48' },
  { id: 'cyan', name: 'Xanh Ngọc', hex: '#06b6d4', fill: 'rgba(6, 182, 212, 0.45)', stroke: '#0891b2' },
  { id: 'orange', name: 'Cam Tươi', hex: '#f97316', fill: 'rgba(249, 115, 22, 0.45)', stroke: '#ea580c' },
  { id: 'indigo', name: 'Xanh Chàm', hex: '#6366f1', fill: 'rgba(99, 102, 241, 0.45)', stroke: '#4f46e5' },
  { id: 'sky', name: 'Xanh Mây', hex: '#0284c7', fill: 'rgba(2, 132, 199, 0.45)', stroke: '#0369a1' },
  { id: 'lime', name: 'Xanh Lá Mạ', hex: '#84cc16', fill: 'rgba(132, 204, 22, 0.45)', stroke: '#65a30d' },
  { id: 'violet', name: 'Tím Đậm', hex: '#a855f7', fill: 'rgba(168, 85, 247, 0.45)', stroke: '#9333ea' },
  { id: 'teal', name: 'Xanh Biển Ngọc', hex: '#14b8a6', fill: 'rgba(20, 184, 166, 0.45)', stroke: '#0d9488' },
];

/**
 * Get fill and stroke for a given room.
 * Default: unique color for each room based on index in ROOM_COLOR_PALETTE.
 */
export function getRoomColorStyle(
  room: { color?: string; frameStatus?: string; boardStatus?: string; inspectionStatus?: string },
  index: number,
  colorMode: 'palette' | 'status' = 'palette'
): { fill: string; stroke: string; hex: string } {
  if (colorMode === 'status') {
    const isCompleteBoth = room.frameStatus === 'Đã hoàn thành' && room.boardStatus === 'Đã hoàn thành';
    const isPassed = room.inspectionStatus === 'Đạt nghiệm thu';
    const isFailed = room.inspectionStatus === 'Chưa đạt (Cần sửa)';
    const isFrameDone = room.frameStatus === 'Đã hoàn thành';

    if (isFailed) return { fill: 'rgba(244, 63, 94, 0.45)', stroke: '#e11d48', hex: '#f43f5e' };
    if (isCompleteBoth && isPassed) return { fill: 'rgba(16, 185, 129, 0.45)', stroke: '#059669', hex: '#10b981' };
    if (isCompleteBoth) return { fill: 'rgba(59, 130, 246, 0.45)', stroke: '#2563eb', hex: '#3b82f6' };
    if (isFrameDone) return { fill: 'rgba(245, 158, 11, 0.45)', stroke: '#d97706', hex: '#f59e0b' };
    if (room.frameStatus === 'Đang làm') return { fill: 'rgba(168, 85, 247, 0.45)', stroke: '#9333ea', hex: '#a855f7' };
    return { fill: 'rgba(148, 163, 184, 0.38)', stroke: '#64748b', hex: '#94a3b8' };
  }

  // If user explicitly picked a color for this room
  if (room.color) {
    const found = ROOM_COLOR_PALETTE.find(
      (p) => p.hex.toLowerCase() === room.color?.toLowerCase() || p.id === room.color
    );
    if (found) {
      return { fill: found.fill, stroke: found.stroke, hex: found.hex };
    }
    if (room.color.startsWith('#')) {
      const hex = room.color;
      // Convert hex to rgba
      const r = parseInt(hex.slice(1, 3), 16) || 0;
      const g = parseInt(hex.slice(3, 5), 16) || 0;
      const b = parseInt(hex.slice(5, 7), 16) || 0;
      return {
        fill: `rgba(${r}, ${g}, ${b}, 0.45)`,
        stroke: hex,
        hex,
      };
    }
  }

  // Default mode: Each room gets its distinct color by index!
  const defaultOption = ROOM_COLOR_PALETTE[index % ROOM_COLOR_PALETTE.length];
  return { fill: defaultOption.fill, stroke: defaultOption.stroke, hex: defaultOption.hex };
}
