import { downloadOrShareFile } from './downloadUtils';
import * as XLSX from 'xlsx';
import { InventoryItem, WorkVolume, DefectItem, ChecklistItem, FloorPlan, RoomProgressItem, MaterialNorm, CrewRecord, TeamInfo } from '../types';
import { getDefectOverdueInfo } from './defectUtils';
import { isTeamMatch, calculateTeamStatistics } from './teamUtils';
import { calculateStockSummary } from './inventoryUtils';
import { formatDateDDMMYYYY } from './dateFormatter';

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
      'Kỹ Sư Giám Sát': r.inspectorName || '',
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
  XLSX.writeFile(wb, `Mat_Bang_Thi_Cong_${safeName}_${Date.now()}.xlsx`);
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
  XLSX.writeFile(wb, `Checklist_${safeName}_${Date.now()}.xlsx`);
}

export function exportAllToExcel(params: {
  projectName: string;
  inventory: InventoryItem[];
  materialNorms: MaterialNorm[];
  workVolumes: WorkVolume[];
  roomProgressList: RoomProgressItem[];
  defects: DefectItem[];
  checklist: ChecklistItem[];
  floorPlans: FloorPlan[];
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
      '__materialId': item.materialId || '',
      'Loại Phiếu': item.type === 'in' ? 'NHẬP KHO' : 'XUẤT KHO',
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

  // 2. Khoi luong thi cong
  if (mods.workVolumes && params.workVolumes && params.workVolumes.length > 0) {
    const volumeData = params.workVolumes.map((item, idx) => {
      const row: Record<string, any> = {
        'STT': idx + 1,
        '__recordId': item.id,
        '__workCategoryId': item.workCategoryId || item.id,
        '__floorIds': item.floorIds ? item.floorIds.join(',') : '',
        'Hạng Mục Công Việc': item.title,
        'Tầng': item.floor,
        'Nhóm Hạng Mục': item.category,
        'Đơn Vị': item.unit,
        'KL Định Mức': item.planned,
        'KL Thực Tế': item.actual,
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
  }

  // 3. Tien do can ho & defect
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
  XLSX.writeFile(wb, `Bao_Cao_Tong_Hop_${safeName}_${Date.now()}.xlsx`);
}

export function exportAllToExcelBase64(params: {
  projectName: string;
  inventory: InventoryItem[];
  materialNorms: MaterialNorm[];
  workVolumes: WorkVolume[];
  roomProgressList: RoomProgressItem[];
  defects: DefectItem[];
  checklist: ChecklistItem[];
  floorPlans: FloorPlan[];
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
      'Loại Phiếu': item.type === 'in' ? 'NHẬP KHO' : 'XUẤT KHO',
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
        '__floorIds': item.floorIds ? item.floorIds.join(',') : '',
        'Hạng Mục Công Việc': item.title,
        'Tầng': item.floor,
        'Nhóm Hạng Mục': item.category,
        'Đơn Vị': item.unit,
        'KL Định Mức': item.planned,
        'KL Thực Tế': item.actual,
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
      'Ca Làm Việc': item.shift === 'Hành chính' ? 'Sáng, Chiều' : item.shift === 'Tăng ca' ? 'Tối (Tăng ca)' : (item.shift || 'Sáng, Chiều'),
      'Vị Trí Làm Việc (Tầng)': item.floorName || '',
      'Nhiệm Vụ / Hạng Mục': item.taskDescription,
      'Ghi Chú': item.notes || '',
    }));
    const wsCrew = XLSX.utils.json_to_sheet(crewData);
    autoFitColumns(wsCrew);
    XLSX.utils.book_append_sheet(wb, wsCrew, 'Quan So Hang Ngay');
  }

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

  const data = sortedCrewRecords.map((item, idx) => {
    const team = teams.find(t => isTeamMatch(item.teamName, t, item.teamId));
    return {
      'STT': idx + 1,
      '__recordId': item.id,
      '__teamId': item.teamId || team?.id || '',
      'Ngày Ghi Nhận': item.date ? formatDateDDMMYYYY(item.date) : '',
      'Tên Đội Thi Công': item.teamName,
      'Trưởng Nhóm / Đội Trưởng': item.leaderName,
      'Quân Số (Người)': item.workerCount || ((item.workersInside || 0) + (item.workersOutside || 0)) || 0,
      'Ca Làm Việc': item.shift === 'Hành chính' ? 'Sáng, Chiều' : item.shift === 'Tăng ca' ? 'Tối (Tăng ca)' : (item.shift || 'Sáng, Chiều'),
      'Vị Trí Làm Việc (Tầng)': item.floorName || '',
      'Nhiệm Vụ / Hạng Mục': item.taskDescription || '',
      'Ghi Chú': item.notes || '',
    };
  });

  const ws = XLSX.utils.json_to_sheet(data);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, 'Nhat Ky Quan So');

  const safeName = (projectName || 'Cong_Trinh').replace(/[^a-zA-Z0-9_ -]/g, '');
  XLSX.writeFile(wb, `Nhat_Ky_Quan_So_${safeName}_${Date.now()}.xlsx`);
}

export function exportMaterialNormTemplate(materialNorms?: MaterialNorm[]) {
  const wb = XLSX.utils.book_new();

  const templateData = (materialNorms || []).map((n, idx) => ({
    'STT': idx + 1,
    '__normId': n.id,
    '__materialId': n.materialId || n.id,
    'Phân Loại': n.category,
    'Tên Hạng Mục Thi Công': n.workCategory || (n.workCategories ? n.workCategories.join(', ') : ''),
    'Tên Vật Tư': n.materialName,
    'Đơn Vị Tính': n.unit,
    'Số Lượng Định Mức': n.quotaQuantity,
    'Định Mức Tiêu Hao (1m2)': n.unitNormPerM2 || 0,
    'Ghi Chú': n.notes || ''
  }));

  const ws = XLSX.utils.json_to_sheet(templateData);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, 'Dinh Muc Vat Tu');
  XLSX.writeFile(wb, 'Danh_Sach_Dinh_Muc_Vat_Tu.xlsx');
}

export function exportWorkVolumesTemplate(workVolumes?: WorkVolume[], projectName?: string, canViewFinancials: boolean = true) {
  const wb = XLSX.utils.book_new();
  const data = (workVolumes || []).map((item, idx) => {
    const row: Record<string, any> = {
      'STT': idx + 1,
      '__recordId': item.id,
      '__workCategoryId': item.workCategoryId || item.id,
      '__floorIds': item.floorIds ? item.floorIds.join(',') : '',
      'Tên Hạng Mục Công Việc': item.title,
      'Tầng / Khu Vực': item.floor,
      'Nhóm Hạng Mục': item.category,
      'Đơn Vị Tính': item.unit,
      'KL Định Mức': item.planned,
      'KL Thực Tế': item.actual,
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
  XLSX.writeFile(wb, `Khoi_Luong_Thi_Cong_${safeName}.xlsx`);
}

export function exportTeamStatisticsToExcel(params: {
  teams: TeamInfo[];
  roomProgressList: RoomProgressItem[];
  defects: DefectItem[];
  crewRecords: CrewRecord[];
  floorPlans: FloorPlan[];
  projectName?: string;
  selectedTeamName?: string;
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
    floorPlans: params.floorPlans
  });

  // If a single team is selected ("Xuất Excel Đội Này"), export 5 detailed sheets
  if (params.selectedTeamName && activeTeams.length === 1) {
    const team = activeTeams[0];
    const stat = teamStatsMap[team.id] || calculateTeamStatistics({
      teams: [team],
      roomProgressList: params.roomProgressList,
      defects: params.defects,
      crewRecords: params.crewRecords,
      floorPlans: params.floorPlans
    })[team.id];

    // Sheet 1: 01-Tong quan
    const overviewRows = [
      { 'THÔNG TIN BÁO CÁO': 'CÔNG TRÌNH', 'GIÁ TRỊ': projectNameStr },
      { 'THÔNG TIN BÁO CÁO': 'ĐỘI THI CÔNG', 'GIÁ TRỊ': team.name },
      { 'THÔNG TIN BÁO CÁO': 'ĐỘI TRƯỞNG', 'GIÁ TRỊ': team.leader || '-' },
      { 'THÔNG TIN BÁO CÁO': 'SỐ ĐIỆN THOẠI', 'GIÁ TRỊ': team.phone || '-' },
      { 'THÔNG TIN BÁO CÁO': 'NGÀY XUẤT', 'GIÁ TRỊ': new Date().toLocaleDateString('vi-VN') },
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
          'Hạng Mục': catName,
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
    const teamDefects = (params.defects || []).filter(d => isTeamMatch(d.assignedTo, team, d.teamId));
    const defectRows: any[] = teamDefects.map((d, idx) => ({
      'STT': idx + 1,
      '__defectId': d.id,
      'Ngày Tạo': d.createdAt ? new Date(d.createdAt).toLocaleDateString('vi-VN') : '',
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

    const safeProj = projectNameStr.replace(/[^a-zA-Z0-9_ -]/g, '');
    const safeTeam = team.name.replace(/[^a-zA-Z0-9_ -]/g, '');
    XLSX.writeFile(wb, `ThongKeDoiThiCong_${safeProj}_${safeTeam}_${Date.now()}.xlsx`);
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
  XLSX.writeFile(wb, `Thong_Ke_Doi_Thi_Cong_${safeName}_${Date.now()}.xlsx`);
}

export function exportWarehouseUpdateTemplate(
  materialNorms: MaterialNorm[],
  workVolumes: WorkVolume[],
  inventory?: InventoryItem[],
  projectName?: string
) {
  const wb = XLSX.utils.book_new();

  // 1. Sheet "Nhập Kho"
  const inItems = (inventory || []).filter(i => i.type === 'in');
  const inSource = inItems.map((item, idx) => ({
    'STT': idx + 1,
    'Mã Phiếu': item.id,
    '__materialId': item.materialId || '',
    'Tên Vật Tư': item.materialName,
    'Đơn Vị Tính': item.unit,
    'Số Lượng': item.quantity,
    'Vị Trí Kho': item.location || 'Kho chính',
    'Người Thực Hiện': item.handler || '-',
    'Ngày Thực Hiện': item.date ? formatDateDDMMYYYY(item.date) : '',
    'Ghi Chú': item.notes || ''
  }));
  const wsIn = XLSX.utils.json_to_sheet(inSource);
  autoFitColumns(wsIn);
  XLSX.utils.book_append_sheet(wb, wsIn, 'Nhập Kho');

  // 2. Sheet "Xuất Kho"
  const outItems = (inventory || []).filter(i => i.type === 'out');
  const outSource = outItems.map((item, idx) => ({
    'STT': idx + 1,
    'Mã Phiếu': item.id,
    '__materialId': item.materialId || '',
    'Tên Vật Tư': item.materialName,
    'Đơn Vị Tính': item.unit,
    'Số Lượng': item.quantity,
    'Vị Trí Kho / Hạng Mục': item.location || 'Công trình Tầng 1',
    'Người Thực Hiện': item.handler || '-',
    'Ngày Thực Hiện': item.date ? formatDateDDMMYYYY(item.date) : '',
    'Ghi Chú': item.notes || ''
  }));
  const wsOut = XLSX.utils.json_to_sheet(outSource);
  autoFitColumns(wsOut);
  XLSX.utils.book_append_sheet(wb, wsOut, 'Xuất Kho');

  // 3. Sheet "Định Mức Vật Tư"
  const templateNormData = (materialNorms || []).map((n, idx) => {
    const workCatStr = n.workCategory || (n.workCategories && n.workCategories.length > 0 ? n.workCategories.join(', ') : '');
    return {
      'STT': idx + 1,
      '__normId': n.id,
      '__materialId': n.materialId || n.id,
      'Chủng Loại': n.category || 'Vật tư thạch cao',
      'Tên Hạng Mục Thi Công': workCatStr || '',
      'Tên Vật Tư': n.materialName,
      'Đơn Vị Tính': n.unit || 'Tấm',
      'Số Lượng Định Mức': n.quotaQuantity || 0,
      'Định Mức Hao Phí / m2': n.unitNormPerM2 || 0,
      'Ghi Chú': n.notes || ''
    };
  });

  const wsNorms = XLSX.utils.json_to_sheet(templateNormData);
  autoFitColumns(wsNorms);
  XLSX.utils.book_append_sheet(wb, wsNorms, 'Định Mức Vật Tư');

  // 4. Sheet "Tồn Kho Hiện Tại" (Calculated using unified calculateStockSummary)
  const stockSummaries = calculateStockSummary(inventory || [], materialNorms || []);
  const stockData = stockSummaries.map((s, idx) => ({
    'STT': idx + 1,
    '__materialId': s.materialId || '',
    'Chủng Loại': s.category,
    'Tên Vật Tư': s.materialName,
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
  XLSX.writeFile(wb, `Quan_Ly_Kho_Vat_Tu_${safeName}.xlsx`);
}
