import * as XLSX from 'xlsx';
import { InventoryItem, WorkVolume, DefectItem, ChecklistItem, FloorPlan, RoomProgressItem, MaterialNorm, CrewRecord, TeamInfo } from '../types';
import { getDefectOverdueInfo } from './defectUtils';
import { isTeamMatch, calculateTeamStatistics } from './teamUtils';
import { computeTeamMaterialReconciliation } from './teamMaterialReconciliation';
import { calculateStockSummary, resolveNormMaterialId } from './inventoryUtils';
import { formatDateDDMMYYYY, formatDateTime } from './dateFormatter';
import { saveWorkbookFile } from './fileExport';
import { getCrewShiftCounts } from './crewUtils';
import { computeWorkVolumeDetailBreakdown } from './workVolumeComputation';
import {
  getStructureGroupName,
  normalizeStructureGroupConfig,
  resolveFloorStructureGroupId,
  type ProjectStructureConfig,
} from './structureGroupUtils';

function autoFitColumns(ws: XLSX.WorkSheet) {
  if (!ws || !ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const cols: Array<{ wch: number; hidden?: boolean }> = [];
  for (let C = range.s.c; C <= range.e.c; ++C) {
    let maxLen = 10;
    let isHidden = false;
    const headerCell = ws[XLSX.utils.encode_cell({ r: range.s.r, c: C })];
    if (headerCell && headerCell.v != null) {
      const headerStr = String(headerCell.v);
      if (headerStr.startsWith('__')) {
        isHidden = true;
      }
    }

    for (let R = range.s.r; R <= range.e.r; ++R) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.v != null) {
        const len = String(cell.v).length;
        if (len > maxLen) maxLen = len;
      }
    }
    cols[C] = { wch: Math.min(50, Math.max(maxLen + 4, 12)), hidden: isHidden };
  }
  ws['!cols'] = cols;
  ws['!autofilter'] = { ref: ws['!ref'] };
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
}

const inventoryIssuePurposeLabel = (item: InventoryItem): string => {
  if (item.type !== 'out') return '';
  if (item.issuePurpose === 'external-project') return 'Xuất ngoài dự án';
  if (item.issuePurpose === 'other') return 'Mục đích khác';
  if (item.issuePurpose === 'project-work' || item.sourceRoomId || item.sourceFloorId || item.sourceTeamId || item.sourceWorkCategoryId || item.sourceStructureGroupId) return 'Thi công trong dự án';
  return 'Chưa phân loại';
};

function prependProjectInfoSheet(wb: XLSX.WorkBook, projectName: string, projectLocation?: string) {
  const rows: Array<[string, string]> = [
    ['Tên công trình', String(projectName || 'Công trình')],
  ];
  if (String(projectLocation || '').trim()) rows.push(['Địa điểm', String(projectLocation).trim()]);
  const ws = XLSX.utils.aoa_to_sheet([['THÔNG TIN DỰ ÁN', 'GIÁ TRỊ'], ...rows]);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, 'Thong Tin Du An');
  wb.SheetNames = ['Thong Tin Du An', ...wb.SheetNames.filter((name) => name !== 'Thong Tin Du An')];
}


function appendWorkVolumeDetailSheet(
  wb: XLSX.WorkBook,
  params: {
    workVolumes: WorkVolume[];
    roomProgressList: RoomProgressItem[];
    floorPlans: FloorPlan[];
    structureConfig?: ProjectStructureConfig;
    teamFilter?: { id?: string; name?: string; leader?: string };
  },
  canFinancials: boolean,
) {
  if (!params.workVolumes?.length || !params.roomProgressList?.length) return;
  const structure = normalizeStructureGroupConfig(params.structureConfig);
  const rows: Array<Record<string, any>> = [];

  params.workVolumes.forEach((item) => {
    const detail = computeWorkVolumeDetailBreakdown(
      item,
      params.workVolumes,
      params.roomProgressList,
      params.floorPlans || [],
      params.teamFilter,
    );
    detail.rows.forEach((row) => {
      const floor = params.floorPlans.find((candidate) => candidate.id === row.floorId);
      const groupId = floor ? resolveFloorStructureGroupId(floor, structure) : structure.defaultGroupId;
      const remaining = Math.max(0, Number(row.assignedVolume || 0) - Number(row.actualVolume || 0));
      const record: Record<string, any> = {
        '__workVolumeId': item.id,
        '__workCategoryId': item.workCategoryId || item.id,
        '__structureGroupId': groupId,
        '__floorId': row.floorId,
        '__roomId': row.roomId,
        'Hạng Mục Công Việc': item.title,
        [structure.label || 'Khu / Khối']: structure.enabled ? getStructureGroupName(groupId, structure) : '',
        'Tầng': row.floorName,
        'Căn / Phòng': row.roomName,
        'Đội Thi Công': row.teamNames.length > 0 ? row.teamNames.join(', ') : 'Chưa gán đội',
        'Đơn Vị': item.unit,
        'KL Phân Bổ': row.assignedVolume,
        'KL Thực Hiện': row.actualVolume,
        'KL Còn Lại': remaining,
        'Tiến Độ (%)': row.progressPercent,
      };
      if (canFinancials) {
        record['Đơn Giá (VNĐ)'] = item.unitPrice || 0;
        record['Thành Tiền Thực Hiện (VNĐ)'] = (row.actualVolume || 0) * (item.unitPrice || 0);
      }
      rows.push(record);
    });
  });

  if (rows.length === 0) return;
  const ws = XLSX.utils.json_to_sheet(rows);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, 'Chi Tiet Khoi Luong');
}


export function exportWarehouseToExcel(inventory: InventoryItem[], materialNorms: MaterialNorm[], projectName: string, workVolumes?: WorkVolume[]) {
  exportWarehouseUpdateTemplate(materialNorms, workVolumes || [], inventory, projectName);
}

export function exportWorkVolumesToExcel(workVolumes: WorkVolume[], projectName: string, canViewFinancials: boolean = true) {
  exportWorkVolumesTemplate(workVolumes, projectName, canViewFinancials);
}

export function exportFloorPlanToExcel(
  roomProgressList: RoomProgressItem[],
  defects: DefectItem[],
  floorPlans: FloorPlan[],
  projectName: string
) {
  const wb = XLSX.utils.book_new();

  const roomData = roomProgressList.map((r, idx) => {
    const fp = floorPlans.find((f) => f.id === r.floorId);
    const subItemsSummary = (r.subItems && r.subItems.length > 0)
      ? r.subItems.map(s => `${s.name || (s as any).title || 'Hạng mục'}: ${s.status || s.inspectionStatus || 'Chưa làm'}`).join('; ')
      : '';

    return {
      'STT': idx + 1,
      'Mã Định Danh': r.id,
      'Tên Căn / Phòng': r.roomName,
      'Tầng': fp?.floorName || r.floorName || 'Mặt bằng',
      'Chi Tiết Hạng Mục Con': subItemsSummary || '-',
      'Khung Trần': r.frameStatus || '-',
      'Bắn Tấm': r.boardStatus || '-',
      'Nghiệm Thu': r.inspectionStatus || 'Chưa nghiệm thu',
      'Kỹ sư phụ trách': r.inspectorName || '',
      'Ghi Chú': r.notes || '',
    };
  });
  const wsRooms = XLSX.utils.json_to_sheet(roomData);
  autoFitColumns(wsRooms);
  XLSX.utils.book_append_sheet(wb, wsRooms, 'Tien Do Can Ho');

  const defectData = defects.map((d, idx) => {
    const overdue = getDefectOverdueInfo(d);
    const matchedRoom = roomProgressList.find(r => r.id === d.roomId || (r.floorId === d.floorId && r.roomName === d.roomId));
    const locationName = matchedRoom ? matchedRoom.roomName : (d.floorName || 'Mặt bằng');

    return {
      'STT': idx + 1,
      'Mã Defect': d.id,
      'Tầng': d.floorName,
      'Khu Vực / Phòng': locationName,
      'Trục Tọa Độ': d.axisGrid || '',
      'Vị Trí Cụ Thể': d.positionDetail || '',
      'Hạng Mục Lỗi': d.category,
      'Mô Tả Lỗi Chi Tiết': d.description,
      'Người Tạo': d.createdBy || 'QC',
      'Deadline Sửa': d.dueDate ? formatDateDDMMYYYY(d.dueDate) : '-',
      'Kiểm Soát Hạn (Overdue)': overdue.statusText,
      'Đội Trách Nhiệm': d.assignedTo || '-',
      'Trạng Thái': d.status,
      'Ngày Hoàn Thành': d.completedAt ? formatDateDDMMYYYY(d.completedAt) : 'Chưa hoàn thành',
      'Ảnh Trước Sửa': d.imageUrl ? 'Có ảnh' : 'Không',
      'Ảnh Sau Sửa': d.afterImageUrl ? 'Có ảnh' : 'Không',
      'Ngày Ghi Nhận': d.createdAt ? formatDateDDMMYYYY(d.createdAt) : '',
    };
  });
  const wsDefects = XLSX.utils.json_to_sheet(defectData);
  autoFitColumns(wsDefects);
  XLSX.utils.book_append_sheet(wb, wsDefects, 'Danh Sach Defect');

  const safeName = (projectName || 'Cong_Trinh').replace(/[^a-zA-Z0-9_ -]/g, '');
  return saveWorkbookFile(wb, `Mat_Bang_Thi_Cong_${safeName}_${Date.now()}.xlsx`);
}

export function exportChecklistToExcel(checklist: ChecklistItem[], projectName: string) {
  const wb = XLSX.utils.book_new();

  const data = checklist.map((item, idx) => ({
    'STT': idx + 1,
    '__recordId': item.id,
    '__floorId': item.floorId || '',
    '__roomId': item.roomId || '',
    '__teamId': item.teamId || '',
    'Tầng / Khu Vực': item.floorName,
    'Phân Loại Hạng Mục': item.category,
    'Nội Dung Tiêu Chí Kiểm Tra': item.title,
    'Trạng Thái': item.status === 'passed' ? 'ĐẠT' : item.status === 'defect' ? 'DEFECT' : 'CHỜ NGHIỆM THU',
    'Người Giám Sát': item.inspectedBy || '',
    'Ghi Chú': item.notes || '',
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, 'Checklist Nghiem Thu');

  const safeName = (projectName || 'Cong_Trinh').replace(/[^a-zA-Z0-9_ -]/g, '');
  return saveWorkbookFile(wb, `Checklist_${safeName}_${Date.now()}.xlsx`);
}

export function exportAllToExcel(params: {
  projectName: string;
  projectLocation?: string;
  inventory: InventoryItem[];
  materialNorms: MaterialNorm[];
  workVolumes: WorkVolume[];
  roomProgressList: RoomProgressItem[];
  defects: DefectItem[];
  checklist: ChecklistItem[];
  floorPlans: FloorPlan[];
  structureConfig?: ProjectStructureConfig;
  workVolumeTeamFilter?: { id?: string; name?: string; leader?: string };
  includeWorkVolumeDetails?: boolean;
  crewRecords?: CrewRecord[];
  canViewFinancials?: boolean;
  selectedModules?: {
    inventory?: boolean;
    workVolumes?: boolean;
    floorPlan?: boolean;
    checklist?: boolean;
    crew?: boolean;
  };
}) {
  const wb = XLSX.utils.book_new();
  const mods = params.selectedModules || { inventory: true, workVolumes: true, floorPlan: true, checklist: true, crew: true };
  const canFinancials = params.canViewFinancials !== false;

  // 1. Kho vat tu
  if (mods.inventory && params.inventory && params.inventory.length > 0) {
    const inventoryData = params.inventory.map((item, idx) => ({
      'STT': idx + 1,
      'Mã Phiếu': item.id,
      '__itemKind': item.itemKind === 'equipment' ? 'equipment' : 'material',
      '__materialId': item.materialId || '',
      '__sourceType': item.sourceType || '',
      '__issuePurpose': item.issuePurpose || '',
      '__sourceStructureGroupId': item.sourceStructureGroupId || '',
      '__sourceRoomId': item.sourceRoomId || '',
      '__sourceFloorId': item.sourceFloorId || '',
      '__sourceTeamId': item.sourceTeamId || '',
      '__sourceWorkCategoryId': item.sourceWorkCategoryId || '',
      '__sourceNormId': item.sourceNormId || '',
      '__sourceIssueKey': item.sourceIssueKey || '',
      'Loại Phiếu': item.type === 'in' ? 'NHẬP KHO' : 'XUẤT KHO',
      'Mục đích xuất': inventoryIssuePurposeLabel(item),
      'Loại Hàng': item.itemKind === 'equipment' ? 'Thiết bị' : 'Vật tư',
      'Tên Vật Tư / Thiết Bị': item.materialName,
      'Đơn Vị Tính': item.unit,
      'Số Lượng': item.quantity,
      'Vị Trí Lưu Kho / Hạng Mục': item.location || 'Kho chính',
      'Người Thực Hiện': item.handler || '-',
      'Ngày Lập Phiếu': item.date ? formatDateDDMMYYYY(item.date) : '',
    }));
    const wsInventory = XLSX.utils.json_to_sheet(inventoryData);
    autoFitColumns(wsInventory);
    XLSX.utils.book_append_sheet(wb, wsInventory, 'Kho Vat Tu');
  }

  // 2. Khoi luong thi cong
  if (mods.workVolumes && params.workVolumes && params.workVolumes.length > 0) {
    const volumeData = params.workVolumes.map((item, idx) => {
      const row: Record<string, any> = {
        'STT': idx + 1,
        '__recordId': item.id,
        '__workCategoryId': item.workCategoryId || item.id,
        '__floorId': item.floorId || item.floorIds?.[0] || '',
      '__floorIds': item.floorIds ? item.floorIds.join(',') : '',
        'Hạng Mục Công Việc': item.title,
        'Tầng': item.floor,
        'Nhóm Hạng Mục': item.category,
        'Đơn Vị': item.unit,
        'KL Định Mức': item.planned,
        'KL Thực Tế (chỉ xem - không import)': item.actual,
      };

      if (canFinancials) {
        row['Đơn Giá (VNĐ)'] = item.unitPrice || 0;
        row['Thành Tiền (VNĐ)'] = (item.actual || 0) * (item.unitPrice || 0);
      }

      row['Tiến Độ (%)'] = item.planned > 0 ? Math.round(((item.actual || 0) / item.planned) * 100) : 0;
      row['Trạng Thái'] = item.status || 'Chưa thi công';
      row['Hạn Hoàn Thành'] = item.dueDate ? formatDateDDMMYYYY(item.dueDate) : '';

      return row;
    });
    const wsVolumes = XLSX.utils.json_to_sheet(volumeData);
    autoFitColumns(wsVolumes);
    XLSX.utils.book_append_sheet(wb, wsVolumes, 'Khoi Luong Thi Cong');
    if (params.includeWorkVolumeDetails !== false) appendWorkVolumeDetailSheet(wb, {
      workVolumes: params.workVolumes,
      roomProgressList: params.roomProgressList,
      floorPlans: params.floorPlans,
      structureConfig: params.structureConfig,
      teamFilter: params.workVolumeTeamFilter,
    }, canFinancials);
  }

  // 3. Tien do can ho & defect
  if (mods.floorPlan) {
    if (params.roomProgressList && params.roomProgressList.length > 0) {
      const activeWorkCategoryNames = new Set(
        (params.workVolumes || [])
          .filter((item) => !item.deletedAt)
          .map((item) => String(item.title || '').trim())
          .filter(Boolean)
      );
      const isActiveCategory = (name: unknown) => {
        const normalized = String(name || '').trim();
        if (!normalized) return false;
        return activeWorkCategoryNames.size === 0 || activeWorkCategoryNames.has(normalized);
      };
      const roomData = params.roomProgressList.map((r, idx) => {
        const fp = params.floorPlans?.find((f) => f.id === r.floorId);
        const activeSubItems = (r.subItems || []).filter((s) => isActiveCategory(s.category || r.workCategory || ''));
        const subItemsSummary = activeSubItems.length > 0
          ? activeSubItems.map(s => `${s.name || (s as any).title || 'Hạng mục'}: ${s.status || s.inspectionStatus || 'Chưa làm'}`).join('; ')
          : '';

        return {
          'STT': idx + 1,
          'Mã Định Danh': r.id,
          'Tên Căn / Phòng': r.roomName,
          'Tầng': fp?.floorName || r.floorName || 'Mặt bằng',
          'Chi Tiết Hạng Mục Con': subItemsSummary || '-',
          'Khung Trần': r.frameStatus || '-',
          'Bắn Tấm': r.boardStatus || '-',
          'Nghiệm Thu': r.inspectionStatus || 'Chưa nghiệm thu',
          'Giám Sát': r.inspectorName || '',
          'Ghi Chú': r.notes || '',
        };
      });
      const wsRooms = XLSX.utils.json_to_sheet(roomData);
      autoFitColumns(wsRooms);
      XLSX.utils.book_append_sheet(wb, wsRooms, 'Tien Do Can Ho');
    }

    if (params.defects && params.defects.length > 0) {
      const defectData = params.defects.map((d, idx) => {
        const overdue = getDefectOverdueInfo(d);
        const matchedRoom = params.roomProgressList?.find(r => r.id === d.roomId || (r.floorId === d.floorId && r.roomName === d.roomId));
        const locationName = matchedRoom ? matchedRoom.roomName : (d.floorName || 'Mặt bằng');

        return {
          'STT': idx + 1,
          'Mã Defect': d.id,
          'Tầng': d.floorName,
          'Khu Vực / Phòng': locationName,
          'Trục Tọa Độ': d.axisGrid || '',
          'Vị Trí Cụ Thể': d.positionDetail || '',
          'Hạng Mục Lỗi': d.category,
          'Mô Tả Chi Tiết': d.description,
          'Người Tạo': d.createdBy || 'QC',
          'Deadline Sửa': d.dueDate ? formatDateDDMMYYYY(d.dueDate) : '-',
          'Kiểm Soát Hạn (Overdue)': overdue.statusText,
          'Mức Độ': d.severity || 'Trung bình',
          'Đội Trách Nhiệm': d.assignedTo || '-',
          'Trạng Thái': d.status,
          'Ngày Hoàn Thành': d.completedAt ? formatDateDDMMYYYY(d.completedAt) : 'Chưa hoàn thành',
          'Ảnh Trước Sửa': d.imageUrl ? 'Có ảnh' : 'Không',
          'Ảnh Sau Sửa': d.afterImageUrl ? 'Có ảnh' : 'Không',
          'Ngày Ghi Nhận': d.createdAt ? formatDateDDMMYYYY(d.createdAt) : '',
        };
      });
      const wsDefects = XLSX.utils.json_to_sheet(defectData);
      autoFitColumns(wsDefects);
      XLSX.utils.book_append_sheet(wb, wsDefects, 'Danh Sach Defect');
    }
  }

  // 4. Checklist
  if (mods.checklist && params.checklist && params.checklist.length > 0) {
    const checklistData = params.checklist.map((item, idx) => ({
      'STT': idx + 1,
      '__recordId': item.id,
      'Tầng': item.floorName,
      'Nhóm Hạng Mục': item.category,
      'Tiêu Chí Kiểm Tra': item.title,
      'Kết Quả': item.status === 'passed' ? 'ĐẠT' : item.status === 'defect' ? 'DEFECT' : 'CHỜ',
      'Giám Sát': item.inspectedBy || '',
      'Ghi Chú': item.notes || '',
    }));
    const wsChecklist = XLSX.utils.json_to_sheet(checklistData);
    autoFitColumns(wsChecklist);
    XLSX.utils.book_append_sheet(wb, wsChecklist, 'Checklist');
  }

  // 5. Quân Số / Đội Thi Công
  if (mods.crew && params.crewRecords && params.crewRecords.length > 0) {
    const sortedCrewRecords = [...params.crewRecords].sort((a, b) => {
      const dateCompare = (a.date || '').localeCompare(b.date || '');
      if (dateCompare !== 0) return dateCompare;
      return (a.teamName || '').localeCompare(b.teamName || '');
    });
    const crewData = sortedCrewRecords.map((item, idx) => ({
      'STT': idx + 1,
      '__recordId': item.id,
      '__teamId': item.teamId || '',
      'Ngày Ghi Nhận': item.date ? formatDateDDMMYYYY(item.date) : '',
      'Tên Đội Thi Công': item.teamName,
      'Trưởng Nhóm / Đội Trưởng': item.leaderName,
      'Quân Số (Người)': item.workerCount || ((item.workersInside || 0) + (item.workersOutside || 0)) || 0,
      'Ca Sáng (Người)': getCrewShiftCounts(item).morning,
      'Ca Chiều (Người)': getCrewShiftCounts(item).afternoon,
      'Ca Tối (Người)': getCrewShiftCounts(item).evening,
      'Ca Làm Việc': item.shift === 'Hành chính' ? 'Sáng, Chiều' : item.shift === 'Tăng ca' ? 'Tối (Tăng ca)' : (item.shift || 'Sáng, Chiều'),
      'Vị Trí Làm Việc (Tầng)': item.floorName || '',
      'Nhiệm Vụ / Hạng Mục': item.taskDescription,
      'Ghi Chú': item.notes || '',
    }));
    const wsCrew = XLSX.utils.json_to_sheet(crewData);
    autoFitColumns(wsCrew);
    XLSX.utils.book_append_sheet(wb, wsCrew, 'Quan So Hang Ngay');
  }

  const safeName = (params.projectName || 'Cong_Trinh').replace(/[^a-zA-Z0-9_ -]/g, '');
  if (wb.SheetNames.length === 0) {
    alert('Không có dữ liệu nào được chọn để xuất báo cáo.');
    return;
  }
  prependProjectInfoSheet(wb, params.projectName, params.projectLocation);
  return saveWorkbookFile(wb, `Bao_Cao_Tong_Hop_${safeName}_${Date.now()}.xlsx`);
}

export function exportAllToExcelBase64(params: {
  projectName: string;
  projectLocation?: string;
  inventory: InventoryItem[];
  materialNorms: MaterialNorm[];
  workVolumes: WorkVolume[];
  roomProgressList: RoomProgressItem[];
  defects: DefectItem[];
  checklist: ChecklistItem[];
  floorPlans: FloorPlan[];
  structureConfig?: ProjectStructureConfig;
  workVolumeTeamFilter?: { id?: string; name?: string; leader?: string };
  includeWorkVolumeDetails?: boolean;
  crewRecords?: CrewRecord[];
  canViewFinancials?: boolean;
  selectedModules?: {
    inventory?: boolean;
    workVolumes?: boolean;
    floorPlan?: boolean;
    checklist?: boolean;
    crew?: boolean;
  };
}): string {
  const wb = XLSX.utils.book_new();
  const mods = params.selectedModules || { inventory: true, workVolumes: true, floorPlan: true, checklist: true, crew: true };
  const canFinancials = params.canViewFinancials !== false;

  if (mods.inventory && params.inventory && params.inventory.length > 0) {
    const inventoryData = params.inventory.map((item, idx) => ({
      'STT': idx + 1,
      'Mã Phiếu': item.id,
      '__materialId': item.materialId || '',
      '__sourceType': item.sourceType || '',
      '__issuePurpose': item.issuePurpose || '',
      '__sourceStructureGroupId': item.sourceStructureGroupId || '',
      '__sourceRoomId': item.sourceRoomId || '',
      '__sourceFloorId': item.sourceFloorId || '',
      '__sourceTeamId': item.sourceTeamId || '',
      '__sourceWorkCategoryId': item.sourceWorkCategoryId || '',
      '__sourceNormId': item.sourceNormId || '',
      '__sourceIssueKey': item.sourceIssueKey || '',
      'Loại Phiếu': item.type === 'in' ? 'NHẬP KHO' : 'XUẤT KHO',
      'Mục đích xuất': inventoryIssuePurposeLabel(item),
      'Tên Vật Tư': item.materialName,
      'Đơn Vị Tính': item.unit,
      'Số Lượng': item.quantity,
      'Vị Trí Lưu Kho / Hạng Mục': item.location || 'Kho chính',
      'Người Thực Hiện': item.handler || '-',
      'Ngày Lập Phiếu': item.date ? formatDateDDMMYYYY(item.date) : '',
    }));
    const wsInventory = XLSX.utils.json_to_sheet(inventoryData);
    autoFitColumns(wsInventory);
    XLSX.utils.book_append_sheet(wb, wsInventory, 'Kho Vat Tu');
  }

  if (mods.workVolumes && params.workVolumes && params.workVolumes.length > 0) {
    const volumeData = params.workVolumes.map((item, idx) => {
      const row: Record<string, any> = {
        'STT': idx + 1,
        '__recordId': item.id,
        '__workCategoryId': item.workCategoryId || item.id,
        '__floorId': item.floorId || item.floorIds?.[0] || '',
      '__floorIds': item.floorIds ? item.floorIds.join(',') : '',
        'Hạng Mục Công Việc': item.title,
        'Tầng': item.floor,
        'Nhóm Hạng Mục': item.category,
        'Đơn Vị': item.unit,
        'KL Định Mức': item.planned,
        'KL Thực Tế (chỉ xem - không import)': item.actual,
      };
      if (canFinancials) {
        row['Đơn Giá (VNĐ)'] = item.unitPrice || 0;
        row['Thành Tiền (VNĐ)'] = (item.actual || 0) * (item.unitPrice || 0);
      }
      row['Tiến Độ (%)'] = item.planned > 0 ? Math.round(((item.actual || 0) / item.planned) * 100) : 0;
      row['Trạng Thái'] = item.status || 'Chưa thi công';
      row['Hạn Hoàn Thành'] = item.dueDate ? formatDateDDMMYYYY(item.dueDate) : '';
      return row;
    });
    const wsVolumes = XLSX.utils.json_to_sheet(volumeData);
    autoFitColumns(wsVolumes);
    XLSX.utils.book_append_sheet(wb, wsVolumes, 'Khoi Luong Thi Cong');
    if (params.includeWorkVolumeDetails !== false) appendWorkVolumeDetailSheet(wb, {
      workVolumes: params.workVolumes,
      roomProgressList: params.roomProgressList,
      floorPlans: params.floorPlans,
      structureConfig: params.structureConfig,
      teamFilter: params.workVolumeTeamFilter,
    }, canFinancials);
  }

  if (mods.floorPlan) {
    if (params.roomProgressList && params.roomProgressList.length > 0) {
      const roomData = params.roomProgressList.map((r, idx) => {
        const fp = params.floorPlans?.find((f) => f.id === r.floorId);
        const subItemsSummary = (r.subItems && r.subItems.length > 0)
          ? r.subItems.map(s => `${s.name || (s as any).title || 'Hạng mục'}: ${s.status || s.inspectionStatus || 'Chưa làm'}`).join('; ')
          : '';

        return {
          'STT': idx + 1,
          'Mã Định Danh': r.id,
          'Tên Căn / Phòng': r.roomName,
          'Tầng': fp?.floorName || r.floorName || 'Mặt bằng',
          'Chi Tiết Hạng Mục Con': subItemsSummary || '-',
          'Khung Trần': r.frameStatus || '-',
          'Bắn Tấm': r.boardStatus || '-',
          'Nghiệm Thu': r.inspectionStatus || 'Chưa nghiệm thu',
          'Giám Sát': r.inspectorName || '',
          'Ghi Chú': r.notes || '',
        };
      });
      const wsRooms = XLSX.utils.json_to_sheet(roomData);
      autoFitColumns(wsRooms);
      XLSX.utils.book_append_sheet(wb, wsRooms, 'Tien Do Can Ho');
    }

    if (params.defects && params.defects.length > 0) {
      const defectData = params.defects.map((d, idx) => {
        const overdue = getDefectOverdueInfo(d);
        const matchedRoom = params.roomProgressList?.find(r => r.id === d.roomId || (r.floorId === d.floorId && r.roomName === d.roomId));
        const locationName = matchedRoom ? matchedRoom.roomName : (d.floorName || 'Mặt bằng');

        return {
          'STT': idx + 1,
          'Mã Defect': d.id,
          'Tầng': d.floorName,
          'Khu Vực / Phòng': locationName,
          'Trục Tọa Độ': d.axisGrid || '',
          'Vị Trí Cụ Thể': d.positionDetail || '',
          'Hạng Mục Lỗi': d.category,
          'Mô Tả Chi Tiết': d.description,
          'Người Tạo': d.createdBy || 'QC',
          'Deadline Sửa': d.dueDate ? formatDateDDMMYYYY(d.dueDate) : '-',
          'Kiểm Soát Hạn (Overdue)': overdue.statusText,
          'Mức Độ': d.severity || 'Trung bình',
          'Đội Trách Nhiệm': d.assignedTo || '-',
          'Trạng Thái': d.status,
          'Ngày Hoàn Thành': d.completedAt ? formatDateDDMMYYYY(d.completedAt) : 'Chưa hoàn thành',
          'Ảnh Trước Sửa': d.imageUrl ? 'Có ảnh' : 'Không',
          'Ảnh Sau Sửa': d.afterImageUrl ? 'Có ảnh' : 'Không',
          'Ngày Ghi Nhận': d.createdAt ? formatDateDDMMYYYY(d.createdAt) : '',
        };
      });
      const wsDefects = XLSX.utils.json_to_sheet(defectData);
      autoFitColumns(wsDefects);
      XLSX.utils.book_append_sheet(wb, wsDefects, 'Danh Sach Defect');
    }
  }

  if (mods.checklist && params.checklist && params.checklist.length > 0) {
    const checklistData = params.checklist.map((item, idx) => ({
      'STT': idx + 1,
      '__recordId': item.id,
      'Tầng': item.floorName,
      'Nhóm Hạng Mục': item.category,
      'Tiêu Chí Kiểm Tra': item.title,
      'Kết Quả': item.status === 'passed' ? 'ĐẠT' : item.status === 'defect' ? 'DEFECT' : 'CHỜ',
      'Giám Sát': item.inspectedBy || '',
      'Ghi Chú': item.notes || '',
    }));
    const wsChecklist = XLSX.utils.json_to_sheet(checklistData);
    autoFitColumns(wsChecklist);
    XLSX.utils.book_append_sheet(wb, wsChecklist, 'Checklist');
  }

  if (mods.crew && params.crewRecords && params.crewRecords.length > 0) {
    const sortedCrewRecords = [...params.crewRecords].sort((a, b) => {
      const dateCompare = (a.date || '').localeCompare(b.date || '');
      if (dateCompare !== 0) return dateCompare;
      return (a.teamName || '').localeCompare(b.teamName || '');
    });
    const crewData = sortedCrewRecords.map((item, idx) => ({
      'STT': idx + 1,
      '__recordId': item.id,
      '__teamId': item.teamId || '',
      'Ngày Ghi Nhận': item.date ? formatDateDDMMYYYY(item.date) : '',
      'Tên Đội Thi Công': item.teamName,
      'Trưởng Nhóm / Đội Trưởng': item.leaderName,
      'Quân Số (Người)': item.workerCount || ((item.workersInside || 0) + (item.workersOutside || 0)) || 0,
      'Ca Sáng (Người)': getCrewShiftCounts(item).morning,
      'Ca Chiều (Người)': getCrewShiftCounts(item).afternoon,
      'Ca Tối (Người)': getCrewShiftCounts(item).evening,
      'Ca Làm Việc': item.shift === 'Hành chính' ? 'Sáng, Chiều' : item.shift === 'Tăng ca' ? 'Tối (Tăng ca)' : (item.shift || 'Sáng, Chiều'),
      'Vị Trí Làm Việc (Tầng)': item.floorName || '',
      'Nhiệm Vụ / Hạng Mục': item.taskDescription,
      'Ghi Chú': item.notes || '',
    }));
    const wsCrew = XLSX.utils.json_to_sheet(crewData);
    autoFitColumns(wsCrew);
    XLSX.utils.book_append_sheet(wb, wsCrew, 'Quan So Hang Ngay');
  }

  prependProjectInfoSheet(wb, params.projectName, params.projectLocation);
  return XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
}

export function exportCrewToExcel(crewRecords: CrewRecord[], projectName: string) {
  exportCrewRecordsToExcel(crewRecords, [], projectName);
}

export function exportCrewRecordsToExcel(crewRecords: CrewRecord[], teams: TeamInfo[], projectName: string) {
  const wb = XLSX.utils.book_new();

  const sortedCrewRecords = [...crewRecords].sort((a, b) => {
    const dateCompare = (a.date || '').localeCompare(b.date || '');
    if (dateCompare !== 0) return dateCompare;
    return (a.teamName || '').localeCompare(b.teamName || '');
  });

  const mainData = sortedCrewRecords.map((item, idx) => {
    const team = teams.find(t => isTeamMatch(item.teamName, t, item.teamId));
    return {
      'STT': idx + 1,
      '__recordId': item.id,
      '__teamId': item.teamId || team?.id || '',
      '__floorId': item.floorId || '',
      '__structureGroupId': item.structureGroupId || '',
      'Ngày Ghi Nhận': item.date ? formatDateDDMMYYYY(item.date) : '',
      'Tên Đội Thi Công': item.teamName,
      'Trưởng Nhóm / Đội Trưởng': item.leaderName,
      'Quân Số (Người)': item.workerCount || ((item.workersInside || 0) + (item.workersOutside || 0)) || 0,
      'Ca Sáng (Người)': getCrewShiftCounts(item).morning,
      'Ca Chiều (Người)': getCrewShiftCounts(item).afternoon,
      'Ca Tối (Người)': getCrewShiftCounts(item).evening,
      'Ca Làm Việc': item.shift === 'Hành chính' ? 'Sáng, Chiều' : item.shift === 'Tăng ca' ? 'Tối (Tăng ca)' : (item.shift || 'Sáng, Chiều'),
      'Vị Trí Làm Việc (Tầng)': item.floorName || '',
      'Nhiệm Vụ / Hạng Mục': item.taskDescription || '',
      'Ghi Chú': item.notes || '',
    };
  });

  const wsMain = XLSX.utils.json_to_sheet(mainData);
  autoFitColumns(wsMain);
  wsMain['!cols'] = (wsMain['!cols'] || []).map((col, index) =>
    [1, 2, 3, 4].includes(index) ? { ...col, hidden: true } : col
  );
  wsMain['!autofilter'] = { ref: `A1:O${Math.max(2, mainData.length + 1)}` };
  XLSX.utils.book_append_sheet(wb, wsMain, 'Nhat Ky Quan So');

  const detailData = sortedCrewRecords.flatMap((record) => {
    const floorWorks = record.floorWorks || [];
    if (floorWorks.length === 0) {
      return [{
        '__recordId': record.id,
        '__floorId': record.floorId || '',
        'Ngày Ghi Nhận': record.date ? formatDateDDMMYYYY(record.date) : '',
        'Tên Đội Thi Công': record.teamName,
        'Tầng / Khu Vực': record.floorName || '',
        'Hạng Mục Chính': '',
        'Hạng Mục Phụ / Công Đoạn': record.taskDescription || '',
      }];
    }
    return floorWorks.flatMap((floorWork) => {
      const categories = floorWork.categories || [];
      if (categories.length === 0) {
        return [{
          '__recordId': record.id,
          '__floorId': floorWork.floorId || '',
          'Ngày Ghi Nhận': record.date ? formatDateDDMMYYYY(record.date) : '',
          'Tên Đội Thi Công': record.teamName,
          'Tầng / Khu Vực': floorWork.floorName || '',
          'Hạng Mục Chính': '',
          'Hạng Mục Phụ / Công Đoạn': '',
        }];
      }
      return categories.map((category) => ({
        '__recordId': record.id,
        '__floorId': floorWork.floorId || '',
        'Ngày Ghi Nhận': record.date ? formatDateDDMMYYYY(record.date) : '',
        'Tên Đội Thi Công': record.teamName,
        'Tầng / Khu Vực': floorWork.floorName || '',
        'Hạng Mục Chính': category.categoryName || '',
        'Hạng Mục Phụ / Công Đoạn': (category.subItems || []).join('; '),
      }));
    });
  });
  const wsDetail = XLSX.utils.json_to_sheet(detailData);
  autoFitColumns(wsDetail);
  wsDetail['!cols'] = (wsDetail['!cols'] || []).map((col, index) =>
    [0, 1].includes(index) ? { ...col, hidden: true } : col
  );
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Chi Tiet Cong Viec');

  const teamData = teams.map((team) => ({
    '__teamId': team.id,
    'Tên Đội Thi Công': team.name,
    'Trưởng Nhóm / Đội Trưởng': team.leader,
    'Quân số định biên': team.defaultCount,
    'Số Điện Thoại': team.phone || '',
    'Ghi Chú': team.notes || '',
  }));
  const wsTeams = XLSX.utils.json_to_sheet(teamData);
  autoFitColumns(wsTeams);
  if (wsTeams['!cols']?.[0]) wsTeams['!cols'][0] = { ...wsTeams['!cols'][0], hidden: true };
  XLSX.utils.book_append_sheet(wb, wsTeams, 'Danh Muc Doi');

  const wsGuide = XLSX.utils.aoa_to_sheet([
    ['HNL QLTC - Nhật ký quân số'],
    ['1', 'Nhat Ky Quan So: chỉnh ngày, đội, quân số theo ca và ghi chú.'],
    ['2', 'Chi Tiet Cong Viec: chỉnh Tầng, Hạng Mục Chính và Hạng Mục Phụ/Công Đoạn của đúng __recordId.'],
    ['3', 'Các cột __recordId/__teamId/__floorId là khóa kỹ thuật; không xóa nếu muốn cập nhật đúng bản ghi hiện có.'],
    ['4', 'Ảnh hiện trường không nằm trong Excel và không bị thay đổi khi nhập lại nhật ký.'],
    ['5', 'Nhập lại luôn có bước kiểm tra trước khi ghi.'],
  ]);
  wsGuide['!cols'] = [{ wch: 8 }, { wch: 105 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, 'Huong Dan');

  const safeName = (projectName || 'Cong_Trinh').replace(/[^a-zA-Z0-9_ -]/g, '');
  return saveWorkbookFile(wb, `Nhat_Ky_Quan_So_${safeName}_${Date.now()}.xlsx`);
}

export function exportMaterialNormTemplate(materialNorms?: MaterialNorm[]) {
  const wb = XLSX.utils.book_new();

  const templateData = (materialNorms || []).map((n, idx) => ({
    'STT': idx + 1,
    '__normId': n.id,
    '__materialId': resolveNormMaterialId(n) || '',
    '__workCategoryId': n.workCategoryId || '',
    '__workCategoryIds': JSON.stringify(n.workCategoryIds || []),
    '__workCategoryNormsById': JSON.stringify(n.workCategoryNormsById || {}),
    'Phân Loại': n.category,
    'Tên Hạng Mục Thi Công': n.workCategory || (n.workCategories ? n.workCategories.join(', ') : ''),
    'Tên Vật Tư': n.materialName,
    'Đơn Vị Tính': n.unit,
    'Số Lượng Định Mức': n.quotaQuantity,
    'Định Mức Tiêu Hao (1m2)': n.unitNormPerM2 || 0,
    'ĐVT Khối Lượng Nguồn': n.normBasisUnit || 'm²',
    'Ghi Chú': n.notes || ''
  }));

  const ws = XLSX.utils.json_to_sheet(templateData);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, 'Dinh Muc Vat Tu');
  return saveWorkbookFile(wb, 'Danh_Sach_Dinh_Muc_Vat_Tu.xlsx');
}

export function exportWorkVolumesTemplate(workVolumes?: WorkVolume[], projectName?: string, canViewFinancials: boolean = true) {
  const wb = XLSX.utils.book_new();
  const data = (workVolumes || []).map((item, idx) => {
    const row: Record<string, any> = {
      'STT': idx + 1,
      '__recordId': item.id,
      '__workCategoryId': item.workCategoryId || item.id,
      '__floorId': item.floorId || item.floorIds?.[0] || '',
      '__floorIds': item.floorIds ? item.floorIds.join(',') : '',
      'Tên Hạng Mục Công Việc': item.title,
      'Tầng / Khu Vực': item.floor,
      'Nhóm Hạng Mục': item.category,
      'Đơn Vị Tính': item.unit,
      'KL Định Mức': item.planned,
      'KL Thực Tế (chỉ xem - không import)': item.actual,
    };
    if (canViewFinancials) {
      row['Đơn Giá (VNĐ)'] = item.unitPrice || 0;
    }
    row['Ngày Hạn Định'] = item.dueDate ? formatDateDDMMYYYY(item.dueDate) : '';
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(data);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, 'Khoi Luong Thi Cong');
  const safeName = (projectName || 'Cong_Trinh').replace(/[^a-zA-Z0-9_ -]/g, '');
  return saveWorkbookFile(wb, `Khoi_Luong_Thi_Cong_${safeName}.xlsx`);
}

export function exportTeamStatisticsToExcel(params: {
  teams: TeamInfo[];
  roomProgressList: RoomProgressItem[];
  defects: DefectItem[];
  crewRecords: CrewRecord[];
  floorPlans: FloorPlan[];
  projectName?: string;
  selectedTeamName?: string;
  workVolumes?: WorkVolume[];
  inventory?: InventoryItem[];
  materialNorms?: MaterialNorm[];
}) {
  const wb = XLSX.utils.book_new();
  const projectNameStr = params.projectName || 'Cong_Trinh';

  const targetTeams = params.selectedTeamName
    ? params.teams.filter(t => isTeamMatch(params.selectedTeamName, t))
    : params.teams;

  const activeTeams = targetTeams.length > 0 ? targetTeams : params.teams;
  const teamStatsMap = calculateTeamStatistics({
    teams: params.teams,
    roomProgressList: params.roomProgressList,
    defects: params.defects,
    crewRecords: params.crewRecords,
    floorPlans: params.floorPlans,
    workVolumes: params.workVolumes || []
  });

  // If a single team is selected ("Xuất Excel Đội Này"), export detailed operational sheets
  if (params.selectedTeamName && activeTeams.length === 1) {
    const team = activeTeams[0];
    const stat = teamStatsMap[team.id] || calculateTeamStatistics({
      teams: [team],
      roomProgressList: params.roomProgressList,
      defects: params.defects,
      crewRecords: params.crewRecords,
      floorPlans: params.floorPlans,
      workVolumes: params.workVolumes || []
    })[team.id];

    // Sheet 1: 01-Tong quan
    const overviewRows = [
      { 'THÔNG TIN BÁO CÁO': 'CÔNG TRÌNH', 'GIÁ TRỊ': projectNameStr },
      { 'THÔNG TIN BÁO CÁO': 'ĐỘI THI CÔNG', 'GIÁ TRỊ': team.name },
      { 'THÔNG TIN BÁO CÁO': 'ĐỘI TRƯỞNG', 'GIÁ TRỊ': team.leader || '-' },
      { 'THÔNG TIN BÁO CÁO': 'SỐ ĐIỆN THOẠI', 'GIÁ TRỊ': team.phone || '-' },
      { 'THÔNG TIN BÁO CÁO': 'NGÀY XUẤT', 'GIÁ TRỊ': formatDateDDMMYYYY(new Date().toISOString().slice(0, 10)) },
      { 'THÔNG TIN BÁO CÁO': '', 'GIÁ TRỊ': '' },
      { 'THÔNG TIN BÁO CÁO': 'CHỈ TIÊU THỐNG KÊ', 'GIÁ TRỊ': 'KẾT QUẢ' },
      { 'THÔNG TIN BÁO CÁO': 'Số tầng phụ trách', 'GIÁ TRỊ': Object.keys(stat.floorGroupMap || {}).length },
      { 'THÔNG TIN BÁO CÁO': 'Số phòng / khu vực phụ trách', 'GIÁ TRỊ': stat.totalAssignedRoomsCount },
      { 'THÔNG TIN BÁO CÁO': 'Số phòng hoàn thành (nghiệm thu)', 'GIÁ TRỊ': stat.completedRoomsCount },
      { 'THÔNG TIN BÁO CÁO': 'Tổng công tích lũy (Công)', 'GIÁ TRỊ': stat.totalMandays },
      { 'THÔNG TIN BÁO CÁO': 'Số ngày làm việc', 'GIÁ TRỊ': stat.daysWorked },
      { 'THÔNG TIN BÁO CÁO': 'Quân số trung bình (Người/ngày)', 'GIÁ TRỊ': stat.avgWorkers },
      { 'THÔNG TIN BÁO CÁO': 'Quân số cao nhất (Người)', 'GIÁ TRỊ': stat.maxWorkers },
      { 'THÔNG TIN BÁO CÁO': 'Quân số thấp nhất (Người)', 'GIÁ TRỊ': stat.minWorkers },
      { 'THÔNG TIN BÁO CÁO': 'Tổng defect phát sinh', 'GIÁ TRỊ': stat.totalDefectsCount },
      { 'THÔNG TIN BÁO CÁO': 'Defect đang mở (cần sửa)', 'GIÁ TRỊ': stat.openDefectsCount },
      { 'THÔNG TIN BÁO CÁO': 'Defect đã khắc phục', 'GIÁ TRỊ': stat.resolvedDefectsCount },
      { 'THÔNG TIN BÁO CÁO': 'Defect đã nghiệm thu', 'GIÁ TRỊ': stat.closedDefectsCount },
    ];
    const ws1 = XLSX.utils.json_to_sheet(overviewRows);
    autoFitColumns(ws1);
    XLSX.utils.book_append_sheet(wb, ws1, '01-Tong quan');

    // Sheet 2: 02-Khoi luong theo tang
    const floorRows: any[] = [];
    let fIdx = 1;
    Object.entries(stat.floorGroupMap || {}).forEach(([fName, fg]) => {
      Object.entries(fg.categoryDetails || {}).forEach(([catName, det]) => {
        floorRows.push({
          'STT': fIdx++,
          'Tầng': fName,
          'Hạng Mục': det.categoryName || catName,
          'ĐVT': det.unit || 'm²',
          'Số Phòng/Khu Vực': fg.rooms.length,
          'KL Phụ Trách': det.totalVol,
          'KL Xong Khung': det.doneFrameVol,
          'KL Xong Tấm': det.doneBoardVol,
          'KL Nghiệm Thu': det.doneInspectedVol,
          'KL Còn Lại': Math.max(0, Math.round((det.totalVol - det.doneInspectedVol) * 100) / 100)
        });
      });
    });
    if (floorRows.length === 0) {
      floorRows.push({
        'STT': 1, 'Tầng': 'Chưa có dữ liệu', 'Hạng Mục': '-', 'ĐVT': '-', 'Số Phòng/Khu Vực': 0, 'KL Phụ Trách': 0, 'KL Xong Khung': 0, 'KL Xong Tấm': 0, 'KL Nghiệm Thu': 0, 'KL Còn Lại': 0
      });
    }
    const ws2 = XLSX.utils.json_to_sheet(floorRows);
    autoFitColumns(ws2);
    XLSX.utils.book_append_sheet(wb, ws2, '02-Khoi luong theo tang');

    // Sheet 3: 03-Chi tiet phong
    const roomRows: any[] = (stat.teamRoomDetails || []).map((det, idx) => ({
      'STT': idx + 1,
      '__roomId': det.roomId,
      '__floorId': det.floorId,
      '__teamId': det.teamId,
      'Tầng': det.floorName,
      'Phòng/Khu Vực': det.roomName,
      'Hạng Mục Đội Phụ Trách': det.workCategoryName,
      'ĐVT': det.unit,
      'KL Phụ Trách': det.assignedVolume,
      'KL Xong Khung': det.frameVolume,
      'KL Xong Tấm': det.boardVolume,
      'KL Nghiệm Thu': det.inspectedVolume,
      'Tiến Độ (%)': `${det.progress}%`,
      'Trạng Thái Khung': det.frameStatus,
      'Trạng Thái Tấm': det.boardStatus,
      'Trạng Thái Nghiệm Thu': det.inspectionStatus,
      'Hạn Hoàn Thành': det.targetDate || '-',
      'Ghi Chú': det.notes || ''
    }));
    if (roomRows.length === 0) {
      roomRows.push({
        'STT': 1, '__roomId': '', '__floorId': '', '__teamId': '', 'Tầng': '-', 'Phòng/Khu Vực': '-', 'Hạng Mục Đội Phụ Trách': '-', 'ĐVT': '-', 'KL Phụ Trách': 0, 'KL Xong Khung': 0, 'KL Xong Tấm': 0, 'KL Nghiệm Thu': 0, 'Tiến Độ (%)': '0%', 'Trạng Thái Khung': '-', 'Trạng Thái Tấm': '-', 'Trạng Thái Nghiệm Thu': '-', 'Hạn Hoàn Thành': '-', 'Ghi Chú': ''
      });
    }
    const ws3 = XLSX.utils.json_to_sheet(roomRows);
    autoFitColumns(ws3);
    XLSX.utils.book_append_sheet(wb, ws3, '03-Chi tiet phong');

    // Sheet 4: 04-Defect
    const teamDefects = (params.defects || []).filter(d => !d.archivedAt && isTeamMatch(d.assignedTo, team, d.teamId));
    const defectRows: any[] = teamDefects.map((d, idx) => ({
      'STT': idx + 1,
      '__defectId': d.id,
      'Ngày Tạo': d.createdAt ? formatDateDDMMYYYY(d.createdAt) : '',
      'Tầng': d.floorName,
      'Mô Tả Lỗi': d.description,
      'Mức Độ': d.severity,
      'Trạng Thái': d.status,
      'Ngày Khắc Phục': d.completedAt || '-',
      'Ghi Chú': d.assignedTo
    }));
    if (defectRows.length === 0) {
      defectRows.push({
        'STT': 1, '__defectId': '', 'Ngày Tạo': '-', 'Tầng': '-', 'Mô Tả Lỗi': 'Không có defect phát sinh', 'Mức Độ': '-', 'Trạng Thái': '-', 'Ngày Khắc Phục': '-', 'Ghi Chú': ''
      });
    }
    defectRows.push(
      { 'STT': '', '__defectId': '', 'Ngày Tạo': 'TỔNG DEFECT', 'Tầng': teamDefects.length, 'Mô Tả Lỗi': `Đang mở: ${stat.openDefectsCount} | Đã khắc phục: ${stat.resolvedDefectsCount} | Đã nghiệm thu: ${stat.closedDefectsCount}`, 'Mức Độ': '', 'Trạng Thái': '', 'Ngày Khắc Phục': '', 'Ghi Chú': '' }
    );
    const ws4 = XLSX.utils.json_to_sheet(defectRows);
    autoFitColumns(ws4);
    XLSX.utils.book_append_sheet(wb, ws4, '04-Defect');

    // Sheet 5: 05-Nhat ky quan so
    const teamLogs = (params.crewRecords || []).filter(l => isTeamMatch(l.teamName, team, l.teamId));
    const sortedLogs = [...teamLogs].sort((a, b) => a.date.localeCompare(b.date));
    const logRows: any[] = sortedLogs.map((l, idx) => ({
      'STT': idx + 1,
      '__recordId': l.id,
      'Ngày': l.date,
      'Tầng/Khu Vực': l.floorName || 'Công trình',
      'Quân Số (Người)': l.workerCount || ((l.workersInside || 0) + (l.workersOutside || 0)) || 0,
      'Ca Sáng (Người)': getCrewShiftCounts(l).morning,
      'Ca Chiều (Người)': getCrewShiftCounts(l).afternoon,
      'Ca Tối (Người)': getCrewShiftCounts(l).evening,
      'Nhiệm Vụ / Công Việc': l.taskDescription,
      'Ghi Chú': l.notes || ''
    }));
    if (logRows.length === 0) {
      logRows.push({
        'STT': 1, '__recordId': '', 'Ngày': '-', 'Tầng/Khu Vực': '-', 'Quân Số (Người)': 0, 'Nhiệm Vụ / Công Việc': 'Chưa có nhật ký', 'Ghi Chú': ''
      });
    }
    logRows.push(
      { 'STT': '', '__recordId': '', 'Ngày': 'TỔNG CỘNG', 'Tầng/Khu Vực': `Số ngày: ${stat.daysWorked}`, 'Quân Số (Người)': `Tổng công: ${stat.totalMandays}`, 'Nhiệm Vụ / Công Việc': `Trung bình: ${stat.avgWorkers} | Cao nhất: ${stat.maxWorkers} | Thấp nhất: ${stat.minWorkers}`, 'Ghi Chú': '' }
    );
    const ws5 = XLSX.utils.json_to_sheet(logRows);
    autoFitColumns(ws5);
    XLSX.utils.book_append_sheet(wb, ws5, '05-Nhat ky quan so');

    // Sheet 6: material issued vs constructed-volume norm.
    const materialLines = computeTeamMaterialReconciliation({
      team,
      stats: stat,
      inventory: params.inventory || [],
      materialNorms: params.materialNorms || [],
      workVolumes: params.workVolumes || [],
    });
    const materialRows: any[] = materialLines.length > 0
      ? materialLines.map((line, idx) => ({
          'STT': idx + 1,
          '__materialId': line.materialId || '',
          'Tên Vật Tư': line.materialName,
          'Nhóm Vật Tư': line.category,
          'ĐVT': line.unit,
          'ĐM Theo KL Giao': line.expectedAssignedQty,
          'ĐM Theo KL Đã Thi Công': line.expectedConstructedQty,
          'Đã Xuất Cho Đội': line.issuedQty,
          'Chênh Lệch Xuất - ĐM Thi Công': line.varianceQty,
          'Tỷ Lệ Xuất / ĐM Thi Công (%)': line.issuedVsConstructedPercent ?? '',
        }))
      : [{
          'STT': 1,
          '__materialId': '',
          'Tên Vật Tư': 'Chưa có dữ liệu vật tư/định mức để đối chiếu',
          'Nhóm Vật Tư': '',
          'ĐVT': '',
          'ĐM Theo KL Giao': 0,
          'ĐM Theo KL Đã Thi Công': 0,
          'Đã Xuất Cho Đội': 0,
          'Chênh Lệch Xuất - ĐM Thi Công': 0,
          'Tỷ Lệ Xuất / ĐM Thi Công (%)': '',
        }];
    const ws6 = XLSX.utils.json_to_sheet(materialRows);
    autoFitColumns(ws6);
    XLSX.utils.book_append_sheet(wb, ws6, '06-Vat tu doi chieu');

    const safeProj = projectNameStr.replace(/[^a-zA-Z0-9_ -]/g, '');
    const safeTeam = team.name.replace(/[^a-zA-Z0-9_ -]/g, '');
    return saveWorkbookFile(wb, `ThongKeDoiThiCong_${safeProj}_${safeTeam}_${Date.now()}.xlsx`);
    return;
  }

  // Multi-team overview sheet
  const summaryData = activeTeams.map((team, idx) => {
    const stat = teamStatsMap[team.id];
    return {
      'STT': idx + 1,
      '__teamId': team.id,
      'Tên Đội Thi Công': team.name,
      'Đội Trưởng': team.leader,
      'Số Điện Thoại': team.phone || '',
      'Số Phòng Phụ Trách': stat?.totalAssignedRoomsCount || 0,
      'Số Phòng Hoàn Thành': stat?.completedRoomsCount || 0,
      'Tổng Công Tích Lũy (Công)': stat?.totalMandays || 0,
      'Số Ngày Làm Việc': stat?.daysWorked || 0,
      'Quân Số Trung Bình (Người/Ngày)': stat?.avgWorkers || 0,
      'Quân Số Cao Nhất': stat?.maxWorkers || 0,
      'Quân Số Thấp Nhất': stat?.minWorkers || 0,
      'Tổng Defect': stat?.totalDefectsCount || 0,
      'Defect Đang Mở': stat?.openDefectsCount || 0,
      'Defect Đã Khắc Phục': stat?.resolvedDefectsCount || 0,
      'Ghi Chú': team.notes || '',
    };
  });

  const wsSummary = XLSX.utils.json_to_sheet(summaryData);
  autoFitColumns(wsSummary);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Tong Quan Cac Doi');

  const safeName = projectNameStr.replace(/[^a-zA-Z0-9_ -]/g, '');
  return saveWorkbookFile(wb, `Thong_Ke_Doi_Thi_Cong_${safeName}_${Date.now()}.xlsx`);
}

export function exportWarehouseUpdateTemplate(
  materialNorms: MaterialNorm[],
  workVolumes: WorkVolume[],
  inventory?: InventoryItem[],
  projectName?: string,
  context?: {
    floorPlans?: FloorPlan[];
    roomProgressList?: RoomProgressItem[];
    teams?: TeamInfo[];
    structureConfig?: ProjectStructureConfig;
  },
) {
  const wb = XLSX.utils.book_new();
  const exportStructure = normalizeStructureGroupConfig(context?.structureConfig);

  // 1. Sheet "Nhập Kho"
  const inItems = (inventory || []).filter((item) => item.type === 'in');
  const inSource = inItems.map((item, idx) => ({
    'STT': idx + 1,
    'Mã Phiếu': item.id,
    '__materialId': item.materialId || '',
    '__sourceType': item.sourceType || '',
    '__issuePurpose': item.issuePurpose || '',
    '__sourceStructureGroupId': item.sourceStructureGroupId || '',
    '__sourceRoomId': item.sourceRoomId || '',
    '__sourceFloorId': item.sourceFloorId || '',
    '__sourceTeamId': item.sourceTeamId || '',
    '__sourceWorkCategoryId': item.sourceWorkCategoryId || '',
    '__sourceNormId': item.sourceNormId || '',
    '__sourceIssueKey': item.sourceIssueKey || '',
    'Tên Vật Tư': item.materialName,
    'Đơn Vị Tính': item.unit,
    'Số Lượng': item.quantity,
    'Vị Trí Kho': item.location || 'Kho chính',
    'Người Thực Hiện': item.handler || '-',
    'Ngày Thực Hiện': item.date ? formatDateDDMMYYYY(item.date) : '',
    'Ghi Chú': item.notes || '',
  }));
  const wsIn = XLSX.utils.json_to_sheet(inSource);
  autoFitColumns(wsIn);
  XLSX.utils.book_append_sheet(wb, wsIn, 'Nhập Kho');

  // 2. Sheet "Xuất Kho"
  const outItems = (inventory || []).filter((item) => item.type === 'out');
  const outSource = outItems.map((item, idx) => {
    const floor = item.sourceFloorId ? context?.floorPlans?.find((fp) => fp.id === item.sourceFloorId) : undefined;
    const room = item.sourceRoomId ? context?.roomProgressList?.find((entry) => entry.id === item.sourceRoomId) : undefined;
    const team = item.sourceTeamId ? context?.teams?.find((entry) => entry.id === item.sourceTeamId) : undefined;
    const work = item.sourceWorkCategoryId
      ? workVolumes.find((entry) => (entry.workCategoryId || entry.id) === item.sourceWorkCategoryId || entry.id === item.sourceWorkCategoryId)
      : undefined;
    const groupId = item.sourceStructureGroupId || (floor ? resolveFloorStructureGroupId(floor, exportStructure) : '');
    return {
      'STT': idx + 1,
      'Mã Phiếu': item.id,
      '__itemKind': item.itemKind === 'equipment' ? 'equipment' : 'material',
      '__materialId': item.materialId || '',
      '__sourceType': item.sourceType || '',
      '__issuePurpose': item.issuePurpose || '',
      '__sourceStructureGroupId': item.sourceStructureGroupId || '',
      '__sourceRoomId': item.sourceRoomId || '',
      '__sourceFloorId': item.sourceFloorId || '',
      '__sourceTeamId': item.sourceTeamId || '',
      '__sourceWorkCategoryId': item.sourceWorkCategoryId || '',
      '__sourceNormId': item.sourceNormId || '',
      '__sourceIssueKey': item.sourceIssueKey || '',
      'Mục đích xuất': inventoryIssuePurposeLabel(item),
      [exportStructure.label || 'Khu / Khối']: item.issuePurpose === 'project-work' && groupId
        ? getStructureGroupName(groupId, exportStructure)
        : '',
      'Tầng': floor?.floorName || '',
      'Căn / Phòng': room?.roomName || '',
      'Đội thi công': team?.name || '',
      'Hạng mục thi công': work?.title || '',
      'Loại Hàng': item.itemKind === 'equipment' ? 'Thiết bị' : 'Vật tư',
      'Tên Vật Tư / Thiết Bị': item.materialName,
      'Đơn Vị Tính': item.unit,
      'Số Lượng': item.quantity,
      'Vị Trí Kho / Hạng Mục': item.location || 'Công trình',
      'Người Thực Hiện': item.handler || '-',
      'Ngày Thực Hiện': item.date ? formatDateDDMMYYYY(item.date) : '',
      'Ghi Chú': item.notes || '',
    };
  });
  const wsOut = XLSX.utils.json_to_sheet(outSource);
  autoFitColumns(wsOut);
  XLSX.utils.book_append_sheet(wb, wsOut, 'Xuất Kho');

  // 3. Sheet "Định Mức Vật Tư"
  const templateNormData = (materialNorms || []).map((n, idx) => {
    const workCatStr = n.workCategory || (n.workCategories && n.workCategories.length > 0 ? n.workCategories.join(', ') : '');
    return {
      'STT': idx + 1,
      '__normId': n.id,
      '__materialId': resolveNormMaterialId(n) || '',
      '__workCategoryId': n.workCategoryId || '',
      '__workCategoryIds': JSON.stringify(n.workCategoryIds || []),
      '__workCategoryNormsById': JSON.stringify(n.workCategoryNormsById || {}),
      'Chủng Loại': n.category || 'Vật tư thạch cao',
      'Tên Hạng Mục Thi Công': workCatStr || '',
      'Tên Vật Tư': n.materialName,
      'Đơn Vị Tính': n.unit || 'Tấm',
      'Số Lượng Định Mức': n.quotaQuantity || 0,
      'Định Mức Hao Phí / m2': n.unitNormPerM2 || 0,
      'ĐVT Khối Lượng Nguồn': n.normBasisUnit || 'm²',
      'Ghi Chú': n.notes || ''
    };
  });

  const wsNorms = XLSX.utils.json_to_sheet(templateNormData);
  autoFitColumns(wsNorms);
  XLSX.utils.book_append_sheet(wb, wsNorms, 'Định Mức Vật Tư');

  // 4. Sheet "Hạng Mục Thi Công (Chỉ xem)" — reference-only here; edit it in WorkVolume.
  const workVolumeData = (workVolumes || []).map((item, idx) => ({
    'STT': idx + 1,
    '__recordId': item.id,
    '__workCategoryId': item.workCategoryId || item.id,
    '__floorId': item.floorId || item.floorIds?.[0] || '',
    '__floorIds': item.floorIds ? item.floorIds.join(',') : '',
    'Tên Hạng Mục Công Việc': item.title,
    'Tầng / Khu Vực': item.floor,
    'Nhóm Hạng Mục': item.category,
    'Đơn Vị Tính': item.unit,
    'KL Định Mức': item.planned,
    'KL Thực Tế (chỉ xem - không import)': item.actual,
    'Đơn Giá (VNĐ)': item.unitPrice || 0,
    'Ngày Hạn Định': item.dueDate ? formatDateDDMMYYYY(item.dueDate) : '',
  }));
  const wsWorkVolumes = XLSX.utils.json_to_sheet(workVolumeData);
  autoFitColumns(wsWorkVolumes);
  XLSX.utils.book_append_sheet(wb, wsWorkVolumes, 'Hạng Mục Thi Công (Chỉ xem)');

  // 5. Sheet "Tồn Kho Hiện Tại" (Calculated using unified calculateStockSummary)
  const stockSummaries = calculateStockSummary(inventory || [], materialNorms || []);
  const stockData = stockSummaries.map((s, idx) => ({
    'STT': idx + 1,
    '__itemKind': s.itemKind,
    '__materialId': s.materialId || '',
    'Loại Hàng': s.itemKind === 'equipment' ? 'Thiết bị' : 'Vật tư',
    'Chủng Loại': s.category,
    'Tên Vật Tư / Thiết Bị': s.materialName,
    'Đơn Vị Tính': s.unit,
    'Tổng Nhập Kho': s.totalIn,
    'Tổng Xuất Kho': s.totalOut,
    'Tồn Kho Thực Tế': s.currentStock,
    'Nhu Cầu Định Mức': s.normQuantity,
    'Nhu Cầu Còn Lại': s.remainingNeed,
    'Trạng Thái Tồn Kho': s.status
  }));

  const wsStock = XLSX.utils.json_to_sheet(stockData);
  autoFitColumns(wsStock);
  XLSX.utils.book_append_sheet(wb, wsStock, 'Tồn Kho Hiện Tại');

  const safeName = (projectName || 'Cong_Trinh').replace(/[^a-zA-Z0-9_ -]/g, '');
  return saveWorkbookFile(wb, `Quan_Ly_Kho_Vat_Tu_${safeName}.xlsx`);
}
