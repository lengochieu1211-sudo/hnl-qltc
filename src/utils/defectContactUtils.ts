import { DefectItem, TeamInfo } from '../types';
import { formatDateDDMMYYYY } from './dateFormatter';
import { getDefectShortCode } from './defectUtils';

export function resolveDefectTeam(defect: Pick<DefectItem, 'teamId' | 'assignedTo'>, teams: TeamInfo[]): TeamInfo | undefined {
  if (defect.teamId) {
    const byId = teams.find((team) => team.id === defect.teamId);
    if (byId) return byId;
  }

  const assigned = String(defect.assignedTo || '').trim().toLocaleLowerCase('vi-VN');
  if (!assigned) return undefined;
  return teams.find((team) => String(team.name || '').trim().toLocaleLowerCase('vi-VN') === assigned);
}

export function buildDefectShareText(defect: DefectItem): string {
  const lines = [
    `HNL QLTC – Defect [${getDefectShortCode(defect.id)}]`,
    `Tầng: ${defect.floorName || 'Chưa cập nhật'}`,
    `Loại lỗi: ${defect.category}`,
    `Mức độ: ${defect.severity}`,
    `Mô tả: ${defect.description || 'Chưa cập nhật'}`,
    `Phụ trách: ${defect.assignedTo || 'Chưa gán'}`,
    `Hạn sửa: ${defect.dueDate ? formatDateDDMMYYYY(defect.dueDate) : 'Chưa đặt'}`,
    `Trạng thái: ${defect.status}`,
  ];
  return lines.join('\n');
}
