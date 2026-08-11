import { downloadOrShareFile } from './downloadUtils';
import * as XLSX from 'xlsx';
import { InventoryItem, WorkVolume, DefectItem, ChecklistItem, FloorPlan, RoomProgressItem, MaterialNorm, CrewRecord, TeamInfo } from '../types';
import { getDefectOverdueInfo } from './defectUtils';
import { saveWorkbookFile } from './fileExport';

function autoFitColumns(ws: XLSX.WorkSheet) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const cols: Array<{ wch: number }> = [];
  for (let C = range.s.c; C <= range.e.c; ++C) {
    let maxLen = 10;
    for (let R = range.s.r; R <= range.e.r; ++R) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.v != null) {
        const len = String(cell.v).length;
        if (len > maxLen) maxLen = len;
      }
    }
    cols[C] = { wch: Math.min(50, Math.max(maxLen + 4, 12)) };
  }
  ws['!cols'] = cols;
}

export function exportWarehouseToExcel(inventory: InventoryItem[], materialNorms: MaterialNorm[], projectName: string, workVolumes?: WorkVolume[]) {
  exportWarehouseUpdateTemplate(materialNorms, workVolumes || [], inventory, projectName);
}

export function exportWorkVolumesToExcel(workVolumes: WorkVolume[], projectName: string) {
  const wb = XLSX.utils.book_new();

  const data = workVolumes.map((item, idx) => ({
    'STT': idx + 1,
    'Tên Hạng Mục Thi Công': item.title,
    'Tầng / Khu Vực': item.floor,
    'Nhóm Hạng Mục': item.category,
    'Đơn Vị Tính': item.unit,
    'KL Định Mức': item.planned,
    'KL Thực Tế': item.actual,
    'Đơn Giá (VNĐ)': item.unitPrice,
    'Thành Tiền (VNĐ)': item.actual * item.unitPrice,
    'Tỷ Lệ Hoàn Thành (%)': item.planned > 0 ? Math.round((item.actual / item.planned) * 100) : 0,
    'Trạng Thái': item.status,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, 'Khoi Luong Thi Cong');

  const safeName = (projectName || 'Cong_Trinh').replace(/[^a-zA-Z0-9_ -]/g, '');
  saveWorkbookFile(wb, `Khoi_Luong_Thi_Cong_${safeName}_${Date.now()}.xlsx`);
}

export function exportFloorPlanToExcel(
  roomProgressList: RoomProgressItem[],
  defects: DefectItem[],
  floorPlans: FloorPlan[],
  projectName: string
) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Tien Do Can Ho
  const roomData = roomProgressList.map((r, idx) => {
    const fp = floorPlans.find((f) => f.id === r.floorId);
    return {
      'STT': idx + 1,
      'Mã Định Danh': r.id,
      'Tên Căn / Phòng': r.roomName,
      'Tầng': fp?.floorName || 'Mặt bằng',
      'Khung Trần': r.frameStatus,
      'Bắn Tấm': r.boardStatus,
      'Nghiệm Thu': r.inspectionStatus,
      'Kỹ Sư Giám Sát': r.inspectorName || '',
      'Ghi Chú': r.notes || '',
    };
  });
  const wsRooms = XLSX.utils.json_to_sheet(roomData);
  autoFitColumns(wsRooms);
  XLSX.utils.book_append_sheet(wb, wsRooms, 'Tien Do Can Ho');

  // Sheet 2: Defect Mat Bang
  const defectData = defects.map((d, idx) => {
    const overdue = getDefectOverdueInfo(d);
    return {
      'STT': idx + 1,
      'Mã Defect': d.id,
      'Tầng': d.floorName,
      'Hạng Mục Lỗi': d.category,
      'Mô Tả Lỗi Chi Tiết': d.description,
      'Người Tạo': d.createdBy || 'QC',
      'Deadline Sửa': d.dueDate || '-',
      'Kiểm Soát Hạn (Overdue)': overdue.statusText,
      'Đội Trách Nhiệm': d.assignedTo,
      'Trạng Thái': d.status,
      'Ngày Hoàn Thành': d.completedAt || 'Chưa hoàn thành',
      'Ảnh Trước Sửa': d.imageUrl ? 'Có ảnh' : 'Không',
      'Ảnh Sau Sửa': d.afterImageUrl ? 'Có ảnh' : 'Không',
      'Ngày Ghi Nhận': d.createdAt ? new Date(d.createdAt).toLocaleString('vi-VN') : '',
    };
  });
  const wsDefects = XLSX.utils.json_to_sheet(defectData);
  autoFitColumns(wsDefects);
  XLSX.utils.book_append_sheet(wb, wsDefects, 'Danh Sach Defect');

  const safeName = (projectName || 'Cong_Trinh').replace(/[^a-zA-Z0-9_ -]/g, '');
  saveWorkbookFile(wb, `Mat_Bang_Thi_Cong_${safeName}_${Date.now()}.xlsx`);
}

export function exportChecklistToExcel(checklist: ChecklistItem[], projectName: string) {
  const wb = XLSX.utils.book_new();

  const data = checklist.map((item, idx) => ({
    'STT': idx + 1,
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
  saveWorkbookFile(wb, `Checklist_${safeName}_${Date.now()}.xlsx`);
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

  // 1. Kho vat tu
  if (mods.inventory && params.inventory && params.inventory.length > 0) {
    const inventoryData = params.inventory.map((item, idx) => ({
      'STT': idx + 1,
      'Loại Phiếu': item.type === 'in' ? 'NHẬP KHO' : 'XUẤT KHO',
      'Tên Vật Tư': item.materialName,
      'Đơn Vị Tính': item.unit,
      'Số Lượng': item.quantity,
      'Vị Trí Lưu Kho / Hạng Mục': item.location || 'Kho chính',
      'Người Thực Hiện': item.handler || '-',
      'Ngày Lập Phiếu': item.date,
    }));
    const wsInventory = XLSX.utils.json_to_sheet(inventoryData);
    autoFitColumns(wsInventory);
    XLSX.utils.book_append_sheet(wb, wsInventory, 'Kho Vat Tu');
  }

  // 2. Khoi luong thi cong
  if (mods.workVolumes && params.workVolumes && params.workVolumes.length > 0) {
    const volumeData = params.workVolumes.map((item, idx) => ({
      'STT': idx + 1,
      'Hạng Mục Công Việc': item.title,
      'Tầng': item.floor,
      'Nhóm Hạng Mục': item.category,
      'Đơn Vị': item.unit,
      'KL Định Mức': item.planned,
      'KL Thực Tế': item.actual,
      'Đơn Giá (VNĐ)': item.unitPrice,
      'Thành Tiền (VNĐ)': item.actual * item.unitPrice,
      'Tiến Độ (%)': item.planned > 0 ? Math.round((item.actual / item.planned) * 100) : 0,
      'Trạng Thái': item.status,
    }));
    const wsVolumes = XLSX.utils.json_to_sheet(volumeData);
    autoFitColumns(wsVolumes);
    XLSX.utils.book_append_sheet(wb, wsVolumes, 'Khoi Luong Thi Cong');
  }

  // 3. Tien do can ho & defect
  if (mods.floorPlan) {
    if (params.roomProgressList && params.roomProgressList.length > 0) {
      const roomData = params.roomProgressList.map((r, idx) => {
        const fp = params.floorPlans?.find((f) => f.id === r.floorId);
        return {
          'STT': idx + 1,
          'Mã Định Danh': r.id,
          'Tên Căn / Phòng': r.roomName,
          'Tầng': fp?.floorName || 'Mặt bằng',
          'Khung Trần': r.frameStatus,
          'Bắn Tấm': r.boardStatus,
          'Nghiệm Thu': r.inspectionStatus,
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
        return {
          'STT': idx + 1,
          'Mã Defect': d.id,
          'Tầng': d.floorName,
          'Hạng Mục Lỗi': d.category,
          'Mô Tả Chi Tiết': d.description,
          'Người Tạo': d.createdBy || 'QC',
          'Deadline Sửa': d.dueDate || '-',
          'Kiểm Soát Hạn (Overdue)': overdue.statusText,
          'Mức Độ': d.severity,
          'Đội Trách Nhiệm': d.assignedTo,
          'Trạng Thái': d.status,
          'Ngày Hoàn Thành': d.completedAt || 'Chưa hoàn thành',
          'Ảnh Trước Sửa': d.imageUrl ? 'Có ảnh' : 'Không',
          'Ảnh Sau Sửa': d.afterImageUrl ? 'Có ảnh' : 'Không',
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
    const crewData = params.crewRecords.map((item, idx) => {
      const floorText = item.floorWorks && item.floorWorks.length > 0
        ? item.floorWorks.map(fw => fw.floorName).join(', ')
        : (item.floorName || '');
      const taskText = item.floorWorks && item.floorWorks.length > 0
        ? item.floorWorks.map(fw => `[${fw.floorName}]: ` + fw.categories.map(c => `${c.categoryName} (${c.subItems.join(', ')})`).join('; ')).join(' | ')
        : item.taskDescription;
      return {
        'STT': idx + 1,
        'Ngày Ghi Nhận': item.date,
        'Tên Đội Thi Công': item.teamName,
        'Trưởng Nhóm / Đội Trưởng': item.leaderName,
        'Quân Số (Người)': item.workerCount,
        'Ca Làm Việc': item.shift === 'Hành chính' ? 'Sáng, Chiều' : item.shift === 'Tăng ca' ? 'Tối (Tăng ca)' : (item.shift || 'Sáng, Chiều'),
        'Vị Trí Làm Việc (Tầng)': floorText,
        'Nhiệm Vụ / Hạng Mục': taskText,
        'Ghi Chú': item.notes || '',
      };
    });
    const wsCrew = XLSX.utils.json_to_sheet(crewData);
    autoFitColumns(wsCrew);
    XLSX.utils.book_append_sheet(wb, wsCrew, 'Quan So Hang Ngay');
  }

  const safeName = (params.projectName || 'Cong_Trinh').replace(/[^a-zA-Z0-9_ -]/g, '');
  saveWorkbookFile(wb, `Bao_Cao_Tong_Hop_${safeName}_${Date.now()}.xlsx`);
}

// Generates Base64 excel string for WebViews/APKs where file downloading is blocked
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

  // 1. Kho vat tu
  if (mods.inventory && params.inventory && params.inventory.length > 0) {
    const inventoryData = params.inventory.map((item, idx) => ({
      'STT': idx + 1,
      'Loại Phiếu': item.type === 'in' ? 'NHẬP KHO' : 'XUẤT KHO',
      'Tên Vật Tư': item.materialName,
      'Đơn Vị Tính': item.unit,
      'Số Lượng': item.quantity,
      'Vị Trí Lưu Kho / Hạng Mục': item.location || 'Kho chính',
      'Người Thực Hiện': item.handler || '-',
      'Ngày Lập Phiếu': item.date,
    }));
    const wsInventory = XLSX.utils.json_to_sheet(inventoryData);
    autoFitColumns(wsInventory);
    XLSX.utils.book_append_sheet(wb, wsInventory, 'Kho Vat Tu');
  }

  // 2. Khoi luong thi cong
  if (mods.workVolumes && params.workVolumes && params.workVolumes.length > 0) {
    const volumeData = params.workVolumes.map((item, idx) => ({
      'STT': idx + 1,
      'Hạng Mục Công Việc': item.title,
      'Tầng': item.floor,
      'Nhóm Hạng Mục': item.category,
      'Đơn Vị': item.unit,
      'KL Định Mức': item.planned,
      'KL Thực Tế': item.actual,
      'Đơn Giá (VNĐ)': item.unitPrice,
      'Thành Tiền (VNĐ)': item.actual * item.unitPrice,
      'Tiến Độ (%)': item.planned > 0 ? Math.round((item.actual / item.planned) * 100) : 0,
      'Trạng Thái': item.status,
    }));
    const wsVolumes = XLSX.utils.json_to_sheet(volumeData);
    autoFitColumns(wsVolumes);
    XLSX.utils.book_append_sheet(wb, wsVolumes, 'Khoi Luong Thi Cong');
  }

  // 3. Tien do can ho & defect
  if (mods.floorPlan) {
    if (params.roomProgressList && params.roomProgressList.length > 0) {
      const roomData = params.roomProgressList.map((r, idx) => {
        const fp = params.floorPlans?.find((f) => f.id === r.floorId);
        return {
          'STT': idx + 1,
          'Mã Định Danh': r.id,
          'Tên Căn / Phòng': r.roomName,
          'Tầng': fp?.floorName || 'Mặt bằng',
          'Khung Trần': r.frameStatus,
          'Bắn Tấm': r.boardStatus,
          'Nghiệm Thu': r.inspectionStatus,
          'Giám Sát': r.inspectorName || '',
          'Ghi Chú': r.notes || '',
        };
      });
      const wsRooms = XLSX.utils.json_to_sheet(roomData);
      autoFitColumns(wsRooms);
      XLSX.utils.book_append_sheet(wb, wsRooms, 'Tien Do Can Ho');
    }

    if (params.defects && params.defects.length > 0) {
      const defectData = params.defects.map((d, idx) => ({
        'STT': idx + 1,
        'Mã Defect': d.id,
        'Tầng': d.floorName,
        'Hạng Mục Lỗi': d.category,
        'Mô Tả Chi Tiết': d.description,
        'Mức Độ': d.severity,
        'Đội Trách Nhiệm': d.assignedTo,
        'Trạng Thái': d.status,
      }));
      const wsDefects = XLSX.utils.json_to_sheet(defectData);
      autoFitColumns(wsDefects);
      XLSX.utils.book_append_sheet(wb, wsDefects, 'Danh Sach Defect');
    }
  }

  // 4. Checklist
  if (mods.checklist && params.checklist && params.checklist.length > 0) {
    const checklistData = params.checklist.map((item, idx) => ({
      'STT': idx + 1,
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
    const crewData = params.crewRecords.map((item, idx) => {
      const floorText = item.floorWorks && item.floorWorks.length > 0
        ? item.floorWorks.map(fw => fw.floorName).join(', ')
        : (item.floorName || '');
      const taskText = item.floorWorks && item.floorWorks.length > 0
        ? item.floorWorks.map(fw => `[${fw.floorName}]: ` + fw.categories.map(c => `${c.categoryName} (${c.subItems.join(', ')})`).join('; ')).join(' | ')
        : item.taskDescription;
      return {
        'STT': idx + 1,
        'Ngày Ghi Nhận': item.date,
        'Tên Đội Thi Công': item.teamName,
        'Trưởng Nhóm / Đội Trưởng': item.leaderName,
        'Quân Số (Người)': item.workerCount,
        'Ca Làm Việc': item.shift === 'Hành chính' ? 'Sáng, Chiều' : item.shift === 'Tăng ca' ? 'Tối (Tăng ca)' : (item.shift || 'Sáng, Chiều'),
        'Vị Trí Làm Việc (Tầng)': floorText,
        'Nhiệm Vụ / Hạng Mục': taskText,
        'Ghi Chú': item.notes || '',
      };
    });
    const wsCrew = XLSX.utils.json_to_sheet(crewData);
    autoFitColumns(wsCrew);
    XLSX.utils.book_append_sheet(wb, wsCrew, 'Quan So Hang Ngay');
  }

  return XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
}

export function exportCrewToExcel(crewRecords: CrewRecord[], projectName: string) {
  const wb = XLSX.utils.book_new();

  const data = crewRecords.map((item, idx) => {
    const floorText = item.floorWorks && item.floorWorks.length > 0
      ? item.floorWorks.map(fw => fw.floorName).join(', ')
      : (item.floorName || '');
    const taskText = item.floorWorks && item.floorWorks.length > 0
      ? item.floorWorks.map(fw => `[${fw.floorName}]: ` + fw.categories.map(c => `${c.categoryName} (${c.subItems.join(', ')})`).join('; ')).join(' | ')
      : item.taskDescription;
    return {
      'STT': idx + 1,
      'Ngày Ghi Nhận': item.date,
      'Tên Đội Thi Công': item.teamName,
      'Trưởng Nhóm / Đội Trưởng': item.leaderName,
      'Quân Số (Người)': item.workerCount,
      'Ca Làm Việc': item.shift === 'Hành chính' ? 'Sáng, Chiều' : item.shift === 'Tăng ca' ? 'Tối (Tăng ca)' : (item.shift || 'Sáng, Chiều'),
      'Vị Trí Làm Việc (Tầng)': floorText,
      'Nhiệm Vụ / Hạng Mục': taskText,
      'Ghi Chú': item.notes || '',
    };
  });

  const ws = XLSX.utils.json_to_sheet(data);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, 'Quan So Hang Ngay');

  const safeName = (projectName || 'Cong_Trinh').replace(/[^a-zA-Z0-9_ -]/g, '');
  saveWorkbookFile(wb, `Quan_So_Hang_Ngay_${safeName}_${Date.now()}.xlsx`);
}

export function exportMaterialNormTemplate(materialNorms?: MaterialNorm[]) {
  const wb = XLSX.utils.book_new();
  const normsSource = materialNorms && materialNorms.length > 0 ? materialNorms : [
    {
      category: 'Tấm thạch cao',
      materialName: 'Tấm thạch cao tiêu chuẩn Gyproc 9mm',
      unit: 'Tấm',
      quotaQuantity: 500,
      unitNormPerM2: 0.35,
      notes: 'Quy cách 1220x2440mm, độ dày 9mm'
    },
    {
      category: 'Khung xương',
      materialName: 'Thanh xương cá Vĩnh Tường BASI',
      unit: 'Thanh',
      quotaQuantity: 300,
      unitNormPerM2: 0.8,
      notes: 'Độ dày 0.4mm'
    },
    {
      category: 'Phụ kiện & Vít',
      materialName: 'Vít thạch cao đen 3cm',
      unit: 'Hộp (1000 con)',
      quotaQuantity: 15,
      unitNormPerM2: 0.02,
      notes: 'Hộp giấy đóng gói'
    },
    {
      category: 'Sơn bả & Mối nối',
      materialName: 'Bột trét thạch cao Gyproc',
      unit: 'Bao (25kg)',
      quotaQuantity: 40,
      unitNormPerM2: 0.05,
      notes: 'Sản xuất tại Việt Nam'
    }
  ];

  const templateData = normsSource.map((n, idx) => ({
    'STT': idx + 1,
    'Phân Loại': 'category' in n ? n.category : (n as any)['Phân Loại'],
    'Tên Vật Tư': 'materialName' in n ? n.materialName : (n as any)['Tên Vật Tư'],
    'Đơn Vị Tính': 'unit' in n ? n.unit : (n as any)['Đơn Vị Tính'],
    'Số Lượng Định Mức': 'quotaQuantity' in n ? n.quotaQuantity : (n as any)['Số Lượng Định Mức'],
    'Định Mức Tiêu Hao (1m2)': 'unitNormPerM2' in n ? n.unitNormPerM2 : (n as any)['Định Mức Tiêu Hao (1m2)'] || 0,
    'Ghi Chú': 'notes' in n ? (n.notes || '') : (n as any)['Ghi Chú'] || ''
  }));

  const ws = XLSX.utils.json_to_sheet(templateData);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, 'Dinh Muc Vat Tu');
  saveWorkbookFile(wb, 'Danh_Sach_Dinh_Muc_Vat_Tu.xlsx');
}

export function exportWorkVolumesTemplate(workVolumes?: WorkVolume[]) {
  const wb = XLSX.utils.book_new();
  const data = (workVolumes && workVolumes.length > 0 ? workVolumes : [
    {
      'Tên Hạng Mục Công Việc': 'Thi công khung trần chìm Tầng 1',
      'Tầng / Khu Vực': 'Tầng 1',
      'Nhóm Hạng Mục': 'khung_tran',
      'Đơn Vị Tính': 'm2',
      'KL Định Mức': 350,
      'KL Thực Tế': 120,
      'Đơn Giá (VNĐ)': 110000,
    },
    {
      'Tên Hạng Mục Công Việc': 'Bắn tấm thạch cao Tầng 2',
      'Tầng / Khu Vực': 'Tầng 2',
      'Nhóm Hạng Mục': 'ban_tam',
      'Đơn Vị Tính': 'm2',
      'KL Định Mức': 280,
      'KL Thực Tế': 280,
      'Đơn Giá (VNĐ)': 95000,
    }
  ]).map((item, idx) => ({
    'STT': idx + 1,
    'Tên Hạng Mục Công Việc': 'title' in item ? item.title : (item as any)['Tên Hạng Mục Công Việc'],
    'Tầng / Khu Vực': 'floor' in item ? item.floor : (item as any)['Tầng / Khu Vực'],
    'Nhóm Hạng Mục': 'category' in item ? item.category : ((item as any)['Nhóm Hạng Mục'] || (item as any)['Phân Loại']),
    'Đơn Vị Tính': 'unit' in item ? item.unit : (item as any)['Đơn Vị Tính'],
    'KL Định Mức': 'planned' in item ? item.planned : ((item as any)['KL Định Mức'] || (item as any)['KL Kế Hoạch']),
    'KL Thực Tế': 'actual' in item ? item.actual : ((item as any)['KL Thực Tế'] || (item as any)['KL Thực Hiện']),
    'Đơn Giá (VNĐ)': 'unitPrice' in item ? item.unitPrice : (item as any)['Đơn Giá (VNĐ)'],
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, 'Khoi Luong Thi Cong');
  saveWorkbookFile(wb, 'Mau_Khoi_Luong_Thi_Cong.xlsx');
}

export function exportTeamStatisticsToExcel(params: {
  teams: TeamInfo[];
  roomProgressList: RoomProgressItem[];
  defects: DefectItem[];
  crewRecords: CrewRecord[];
  floorPlans: FloorPlan[];
  projectName?: string;
  selectedTeamName?: string; // If provided, exports focus on a single team or highlights it
}) {
  const wb = XLSX.utils.book_new();

  const isTeamMatch = (assignedName?: string, team?: TeamInfo) => {
    if (!assignedName || !team) return false;
    const a = assignedName.trim().toLowerCase();
    const b = team.name.trim().toLowerCase();
    return a === b || a.includes(b) || b.includes(a);
  };

  const targetTeams = params.selectedTeamName
    ? params.teams.filter(t => isTeamMatch(t.name, { name: params.selectedTeamName } as TeamInfo))
    : params.teams;

  const activeTeams = targetTeams.length > 0 ? targetTeams : params.teams;

  // Sheet 1: Tong Quan Doi Thi Cong
  const summaryData = activeTeams.map((team, idx) => {
    const teamRooms = (params.roomProgressList || []).filter(r => isTeamMatch(r.assignedTeam, team));
    const teamDefects = (params.defects || []).filter(d => isTeamMatch(d.assignedTo, team));
    const teamLogs = (params.crewRecords || []).filter(l => isTeamMatch(l.teamName, team));

    const totalVolume = teamRooms.reduce((sum, r) => sum + (r.workVolume || 0), 0);
    const completedFrameVol = teamRooms.filter(r => r.frameStatus === 'Đã hoàn thành').reduce((sum, r) => sum + (r.workVolume || 0), 0);
    const completedBoardVol = teamRooms.filter(r => r.boardStatus === 'Đã hoàn thành').reduce((sum, r) => sum + (r.workVolume || 0), 0);

    const completedRooms = teamRooms.filter(r => r.inspectionStatus === 'Đạt nghiệm thu');
    const openDefects = teamDefects.filter(d => d.status === 'Mới phát hiện' || d.status === 'Đang sửa');
    const resolvedDefects = teamDefects.filter(d => d.status === 'Đã khắc phục' || d.status === 'Đã nghiệm thu');
    const totalWorkdays = teamLogs.reduce((sum, l) => sum + (l.workerCount || 0), 0);

    const loggedFloors = Array.from(new Set([
      ...teamRooms.map(r => r.floorName || params.floorPlans.find(f => f.id === r.floorId)?.floorName || ''),
      ...teamLogs.map(l => l.floorName || '')
    ].filter(Boolean)));

    return {
      'STT': idx + 1,
      'Tên Đội Thi Công': team.name,
      'Đội Trưởng': team.leader,
      'Số Điện Thoại': team.phone || '',
      'Định Biên (Thợ)': team.defaultCount,
      'Số Căn Phụ Trách': teamRooms.length,
      'Tổng Khối Lượng (m²)': totalVolume,
      'KL Xong Khung (m²)': completedFrameVol,
      'KL Xong Tấm (m²)': completedBoardVol,
      'Căn Đạt Nghiệm Thu': `${completedRooms.length}/${teamRooms.length}`,
      'Tỷ Lệ Hoàn Thành (%)': teamRooms.length > 0 ? Math.round((completedRooms.length / teamRooms.length) * 100) : 0,
      'Tầng Thi Công': loggedFloors.join(', ') || 'Chưa ghi nhận',
      'Defect Tồn Đọng': openDefects.length,
      'Defect Đã Khắc Phục': resolvedDefects.length,
      'Tổng Defect': teamDefects.length,
      'Tổng Công Thực Hiện': totalWorkdays,
      'Số Lượt Nhật Ký': teamLogs.length,
      'Ghi Chú': team.notes || '',
    };
  });

  const wsSummary = XLSX.utils.json_to_sheet(summaryData);
  autoFitColumns(wsSummary);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Tong Quan Doi Thi Cong');

  // Sheet 2: Chi Tiet Can Ho & Khoi Luong
  const roomDetailData: any[] = [];
  let roomIdx = 1;

  activeTeams.forEach(team => {
    const teamRooms = (params.roomProgressList || []).filter(r => isTeamMatch(r.assignedTeam, team));
    teamRooms.forEach(r => {
      const fp = params.floorPlans.find(f => f.id === r.floorId);
      roomDetailData.push({
        'STT': roomIdx++,
        'Tên Đội Thi Công': team.name,
        'Tầng / Mặt Bằng': r.floorName || fp?.floorName || 'Mặt bằng',
        'Tên Căn / Phòng': r.roomName,
        'Khối Lượng Thi Công': r.workVolume !== undefined ? r.workVolume : 0,
        'Đơn Vị Tính': r.volumeUnit || 'm²',
        'Thi Công Khung': r.frameStatus,
        'Thi Công Bắn Tấm': r.boardStatus,
        'Trạng Thái Nghiệm Thu': r.inspectionStatus,
        'Kỹ Sư Giám Sát': r.inspectorName || '',
        'Hạn Bắn Tấm': r.targetBoardDate || '',
        'Ghi Chú': r.notes || '',
      });
    });
  });

  if (roomDetailData.length > 0) {
    const wsRooms = XLSX.utils.json_to_sheet(roomDetailData);
    autoFitColumns(wsRooms);
    XLSX.utils.book_append_sheet(wb, wsRooms, 'Chi Tiet Can Ho & Khoi Luong');
  }

  // Sheet 3: Danh Sách Defect Theo Đội
  const defectDetailData: any[] = [];
  let defectIdx = 1;

  activeTeams.forEach(team => {
    const teamDefects = (params.defects || []).filter(d => isTeamMatch(d.assignedTo, team));
    teamDefects.forEach(d => {
      defectDetailData.push({
        'STT': defectIdx++,
        'Tên Đội Trách Nhiệm': team.name,
        'Tầng / Khu Vực': d.floorName,
        'Hạng Mục Lỗi': d.category,
        'Mô Tả Chi Tiết Defect': d.description,
        'Mức Độ': d.severity,
        'Trạng Thái': d.status,
        'Ngày Tạo': d.createdAt ? new Date(d.createdAt).toLocaleDateString('vi-VN') : '',
      });
    });
  });

  if (defectDetailData.length > 0) {
    const wsDefects = XLSX.utils.json_to_sheet(defectDetailData);
    autoFitColumns(wsDefects);
    XLSX.utils.book_append_sheet(wb, wsDefects, 'Danh Sach Defect');
  }

  // Sheet 4: Lich Su Nhat Ky Quan So
  const logDetailData: any[] = [];
  let logIdx = 1;

  activeTeams.forEach(team => {
    const teamLogs = (params.crewRecords || []).filter(l => isTeamMatch(l.teamName, team));
    teamLogs.forEach(l => {
      logDetailData.push({
        'STT': logIdx++,
        'Ngày Ghi Nhận': l.date,
        'Tên Đội Thi Công': team.name,
        'Đội Trưởng': l.leaderName,
        'Quân Số (Người)': l.workerCount,
        'Tầng Thi Công': l.floorName,
        'Ca Làm Việc': l.shift || 'Sáng, Chiều',
        'Nhiệm Vụ': l.taskDescription,
        'Ghi Chú': l.notes || '',
      });
    });
  });

  if (logDetailData.length > 0) {
    const wsLogs = XLSX.utils.json_to_sheet(logDetailData);
    autoFitColumns(wsLogs);
    XLSX.utils.book_append_sheet(wb, wsLogs, 'Lich Su Nhat Ky');
  }

  // Save File
  const safeName = (params.projectName || 'Cong_Trinh').replace(/[^a-zA-Z0-9_ -]/g, '');
  const prefix = params.selectedTeamName ? `Thong_Ke_${params.selectedTeamName.replace(/[^a-zA-Z0-9_ -]/g, '')}` : 'Thong_Ke_Doi_Thi_Cong';
  saveWorkbookFile(wb, `${prefix}_${safeName}_${Date.now()}.xlsx`);
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
  const inSource = inItems.length > 0 ? inItems.map((item, idx) => ({
    'STT': idx + 1,
    'Mã Phiếu': item.id,
    'Tên Vật Tư': item.materialName,
    'Đơn Vị Tính': item.unit,
    'Số Lượng': item.quantity,
    'Vị Trí Kho': item.location || 'Kho chính',
    'Người Thực Hiện': item.handler || '-',
    'Ngày Thực Hiện': item.date,
    'Ghi Chú': item.notes || ''
  })) : [
    {
      'STT': 1,
      'Mã Phiếu': 'INV-IN-001',
      'Tên Vật Tư': 'Tấm thạch cao tiêu chuẩn Gyproc 9mm',
      'Đơn Vị Tính': 'Tấm',
      'Số Lượng': 200,
      'Vị Trí Kho': 'Kho Tầng 1',
      'Người Thực Hiện': 'Nguyễn Văn Hùng (Thủ kho)',
      'Ngày Thực Hiện': '2026-08-11',
      'Ghi Chú': 'Nhập kho đợt 1'
    },
    {
      'STT': 2,
      'Mã Phiếu': 'INV-IN-002',
      'Tên Vật Tư': 'Thanh xương cá Vĩnh Tường BASI',
      'Đơn Vị Tính': 'Thanh',
      'Số Lượng': 150,
      'Vị Trí Kho': 'Kho Tầng 1',
      'Người Thực Hiện': 'Nguyễn Văn Hùng (Thủ kho)',
      'Ngày Thực Hiện': '2026-08-11',
      'Ghi Chú': 'Nhập kho đợt 1'
    }
  ];
  const wsIn = XLSX.utils.json_to_sheet(inSource);
  autoFitColumns(wsIn);
  XLSX.utils.book_append_sheet(wb, wsIn, 'Nhập Kho');

  // 2. Sheet "Xuất Kho"
  const outItems = (inventory || []).filter(i => i.type === 'out');
  const outSource = outItems.length > 0 ? outItems.map((item, idx) => ({
    'STT': idx + 1,
    'Mã Phiếu': item.id,
    'Tên Vật Tư': item.materialName,
    'Đơn Vị Tính': item.unit,
    'Số Lượng': item.quantity,
    'Vị Trí Kho / Hạng Mục': item.location || 'Công trình Tầng 1',
    'Người Thực Hiện': item.handler || '-',
    'Ngày Thực Hiện': item.date,
    'Ghi Chú': item.notes || ''
  })) : [
    {
      'STT': 1,
      'Mã Phiếu': 'INV-OUT-001',
      'Tên Vật Tư': 'Tấm thạch cao tiêu chuẩn Gyproc 9mm',
      'Đơn Vị Tính': 'Tấm',
      'Số Lượng': 50,
      'Vị Trí Kho / Hạng Mục': 'Trần thạch cao Tầng 1',
      'Người Thực Hiện': 'Trần Văn Minh (Đội 1)',
      'Ngày Thực Hiện': '2026-08-11',
      'Ghi Chú': 'Xuất cho đội thi công'
    },
    {
      'STT': 2,
      'Mã Phiếu': 'INV-OUT-002',
      'Tên Vật Tư': 'Thanh xương cá Vĩnh Tường BASI',
      'Đơn Vị Tính': 'Thanh',
      'Số Lượng': 30,
      'Vị Trí Kho / Hạng Mục': 'Trần thạch cao Tầng 1',
      'Người Thực Hiện': 'Trần Văn Minh (Đội 1)',
      'Ngày Thực Hiện': '2026-08-11',
      'Ghi Chú': 'Xuất cho đội thi công'
    }
  ];
  const wsOut = XLSX.utils.json_to_sheet(outSource);
  autoFitColumns(wsOut);
  XLSX.utils.book_append_sheet(wb, wsOut, 'Xuất Kho');

  // 3. Sheet "Định Mức Vật Tư"
  const normsSource = materialNorms && materialNorms.length > 0 ? materialNorms : [
    {
      category: 'Tấm thạch cao',
      workCategory: 'Trần thạch cao khung chìm',
      materialName: 'Tấm thạch cao tiêu chuẩn Gyproc 9mm',
      unit: 'Tấm',
      quotaQuantity: 500,
      unitNormPerM2: 0.35,
      notes: 'Quy cách 1220x2440mm, độ dày 9mm'
    }
  ];

  const templateNormData = normsSource.map((n, idx) => {
    const workCatStr = n.workCategory || (n.workCategories && n.workCategories.length > 0 ? n.workCategories.join(', ') : '');
    return {
      'STT': idx + 1,
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

  // 4. Sheet "Tồn Kho Hiện Tại"
  if (inventory && inventory.length > 0) {
    const stockMap: Record<string, { inQty: number; outQty: number; unit: string }> = {};
    inventory.forEach(item => {
      const name = item.materialName.trim();
      if (!stockMap[name]) stockMap[name] = { inQty: 0, outQty: 0, unit: item.unit };
      if (item.type === 'in') stockMap[name].inQty += item.quantity;
      else stockMap[name].outQty += item.quantity;
    });

    const stockData = Object.entries(stockMap).map(([name, val], idx) => {
      const norm = materialNorms?.find(n => n.materialName.trim().toLowerCase() === name.toLowerCase());
      const balance = val.inQty - val.outQty;
      return {
        'STT': idx + 1,
        'Chủng Loại': norm?.category || 'Vật tư',
        'Tên Vật Tư': name,
        'Đơn Vị Tính': val.unit,
        'Tổng Nhập Kho': val.inQty,
        'Tổng Xuất Kho': val.outQty,
        'Tồn Kho Thực Tế': balance,
        'Định Mức Thiết Kế': norm?.quotaQuantity || 0,
        'Trạng Thái': balance <= 0 ? 'Hết hàng' : balance <= 15 ? 'Cảnh báo ít' : 'Đủ hàng'
      };
    });

    const wsStock = XLSX.utils.json_to_sheet(stockData);
    autoFitColumns(wsStock);
    XLSX.utils.book_append_sheet(wb, wsStock, 'Tồn Kho Hiện Tại');
  }

  const safeName = (projectName || 'Cong_Trinh').replace(/[^a-zA-Z0-9_ -]/g, '');
  saveWorkbookFile(wb, `Quan_Ly_Kho_Vat_Tu_${safeName}.xlsx`);
}


