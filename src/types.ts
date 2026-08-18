export type TransactionType = 'in' | 'out';

export interface InventoryItem {
  id: string;
  type: TransactionType; // 'in': Nhập kho, 'out': Xuất kho
  materialId?: string;
  materialName: string;
  unit: string;
  quantity: number;
  location: string;
  handler: string;
  date: string;
  notes?: string;
}

export type CategoryType = string;

export interface WorkVolume {
  id: string;
  workCategoryId?: string;
  title: string;
  floor: string;
  floorId?: string;
  floorIds?: string[];
  category: CategoryType;
  unit: string;
  planned: number;
  actual: number;
  unitPrice: number;
  status: 'Chưa thi công' | 'Đang thi công' | 'Đã hoàn thành';
  dueDate?: string; // Hạn định hoàn thành (YYYY-MM-DD)
  subItems?: string[]; // Hạng mục con / công đoạn lấy từ căn hộ
}

export interface FloorPlan {
  id: string;
  floorName: string;
  imageUrl: string;
  uploadedAt: string;
  order?: number;
  driveFileId?: string;
  driveUrl?: string;
  storageProvider?: 'google-drive-primary' | 'firestore-fallback' | string;
  cloudFileId?: string;
  imageMimeType?: string;
  imageFileSize?: number;
  imageRevision?: number;
  imageCloudRevision?: number;
  imageCloudSyncedAt?: number;
  updatedAt?: number;
  targetFrameDate?: string; // YYYY-MM-DD
  targetBoardDate?: string; // YYYY-MM-DD
}

export type DefectCategory = 
  | 'Khung trần'
  | 'Tấm thạch cao'
  | 'Vách thạch cao'
  | 'Hoàn thiện bả sơn'
  | 'Khe hở / mối nối'
  | 'Ty treo / phụ kiện'
  | 'Sai vị trí / sai cao độ'
  | 'Thiết bị liên quan'
  | 'Vệ sinh / bảo vệ thành phẩm'
  | 'Khung trần lệch/xô lệch'
  | 'Bắn thiếu vít / thưa vít tấm'
  | 'Hở khe / Nứt mối nối tấm'
  | 'Ty treo lỏng / Sai khoảng cách'
  | 'Tấm trần bị ẩm / ố vàng / móp'
  | 'Chừa thiếu lỗ điện/máy lạnh'
  | 'Khác';

export type DefectSeverity = 'Thấp' | 'Trung bình' | 'Nghiêm trọng';
export type DefectStatus = 'Mới phát hiện' | 'Đang sửa' | 'Đã khắc phục' | 'Đã nghiệm thu';

export interface DefectItem {
  id: string;
  floorId: string;
  floorName: string;
  roomId?: string;
  axisGrid?: string;
  positionDetail?: string;
  teamId?: string;
  category: DefectCategory;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  description: string;
  severity: DefectSeverity;
  assignedTo: string; // Người / Đội chịu trách nhiệm
  createdBy?: string; // Người tạo (QC, Giám sát,...)
  dueDate?: string; // Deadline sửa (YYYY-MM-DD)
  completedAt?: string; // Ngày hoàn thành sửa (YYYY-MM-DD)
  imageUrl?: string; // Ảnh trước khi sửa
  afterImageUrl?: string; // Ảnh sau khi sửa
  status: DefectStatus;
  createdAt: string; // Ngày tạo
}

export type ChecklistStatus = 'passed' | 'pending' | 'defect';

export interface ChecklistItem {
  id: string;
  floorId?: string;
  floorName: string;
  roomId?: string;
  teamId?: string;
  category: string;
  title: string;
  status: ChecklistStatus;
  dueDate?: string; // Hạn định thực hiện (YYYY-MM-DD)
  notes?: string;
  inspectedBy?: string;
  inspectedAt?: string;
}

export interface GoogleAuthStatus {
  authenticated: boolean;
  email?: string;
  name?: string;
  picture?: string;
}

export interface MaterialNorm {
  id: string;
  materialId?: string;
  category: string; // Chủng loại vật tư (Tấm thạch cao, Khung xương, Phụ kiện, Sơn bả...)
  workCategory?: string; // Hạng mục thi công căn hộ áp dụng (VD: Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn)
  workCategoryId?: string; // ID hạng mục thi công liên kết chính xác
  workCategories?: string[]; // Danh sách các hạng mục thi công áp dụng (chọn nhiều)
  workCategoryIds?: string[]; // Danh sách ID các hạng mục thi công áp dụng
  materialName: string; // Tên vật tư
  unit: string; // Tên đơn vị tính (Tấm, Thanh, Hộp, Bao, Bộ, m2...)
  quotaQuantity: number; // Số lượng định mức công trình
  unitNormPerM2?: number; // Định mức tiêu hao (VD: 0.35/m2)
  workCategoryNorms?: Record<string, number>; // Định mức riêng theo tên hạng mục
  workCategoryNormsById?: Record<string, number>; // Định mức riêng theo ID hạng mục
  notes?: string;
}

export type AcceptanceStatus = 'Chưa làm' | 'Đang làm' | 'Đã hoàn thành';
export type RoomInspectionResult = 'Chưa nghiệm thu' | 'Đạt nghiệm thu' | 'Chưa đạt (Cần sửa)';

export interface Point2D {
  x: number;
  y: number;
}

export interface RoomSubItem {
  id: string;
  name: string; // Tên công đoạn / hạng mục con (VD: Thi công khung, Thi công tấm mặt 1, Thi công tấm mặt 2...)
  category?: string; // Hạng mục thi công tổng (VD: Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn)
  workCategoryId?: string;
  status: AcceptanceStatus; // Trạng thái thi công
  inspectionStatus?: RoomInspectionResult; // Trạng thái nghiệm thu
  targetDate?: string; // Hạn hoàn thành (YYYY-MM-DD)
  assignedTeam?: string; // Đội thi công phụ trách riêng cho hạng mục này
  teamId?: string;
  workVolume?: number; // Khối lượng riêng cho hạng mục này (VD: 45.5)
  volumeUnit?: string; // Đơn vị tính riêng (VD: m2, m, bộ)
  progressWeight?: number; // Trọng số tiến độ (VD: 25 cho 25%, 1 cho trọng số bình thường)
}

export interface RoomProgressItem {
  id: string;
  floorId: string; // ID mặt bằng tầng
  floorName?: string; // Tên tầng tương ứng
  roomName: string; // Tên phòng / Căn hộ (VD: Căn A101, Phòng Khách, WC 1...)
  workCategory?: string; // Loại hạng mục thi công (VD: Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn, Vách Thạch Cao Hai Mặt...)
  workCategoryId?: string;
  categoryVolumes?: Record<string, number>; // Khối lượng riêng theo từng hạng mục thi công đang có trong căn hộ
  subItems?: RoomSubItem[]; // Danh sách các hạng mục/công đoạn thi công & nghiệm thu chi tiết
  workVolume?: number; // Khối lượng thi công (VD: 45.5 m2)
  volumeUnit?: string; // Đơn vị tính (VD: m2, m, căn)
  x: number; // Tỷ lệ vị trí X trên MB (0-100%)
  y: number; // Tỷ lệ vị trí Y trên MB (0-100%)
  width: number; // Chiều rộng vùng highlight (0-100%)
  height: number; // Chiều cao vùng highlight (0-100%)
  points?: Point2D[]; // Các điểm tọa độ vẽ tự do (polygon freehand)
  isPolyline?: boolean; // Nếu true: Vẽ đường thẳng / đường gấp khúc hở, ngược lại vẽ Đa giác khép kín
  frameStatus: AcceptanceStatus; // Thi công Khung trần
  boardStatus: AcceptanceStatus; // Thi công Bắn tấm
  frameInspectionStatus?: RoomInspectionResult; // Nghiệm thu Khung trần riêng
  boardInspectionStatus?: RoomInspectionResult; // Nghiệm thu Tấm trần riêng
  inspectionStatus: RoomInspectionResult; // Trạng thái nghiệm thu tổng hợp
  inspectorName?: string; // Người nghiệm thu
  notes?: string; // Ghi chú nghiệm thu
  assignedTeam?: string; // Đội thi công phụ trách
  teamId?: string;
  targetFrameDate?: string; // YYYY-MM-DD
  targetBoardDate?: string; // YYYY-MM-DD
  color?: string; // Mã màu hex hoặc tên màu chọn riêng cho căn
  updatedAt: number;
}

export interface TeamInfo {
  id: string;
  name: string;
  leader: string;
  defaultCount: number;
  phone?: string;
  notes?: string;
}

export interface CrewFloorCategoryWork {
  categoryName: string;
  subItems: string[];
}

export interface CrewFloorWork {
  floorId: string;
  floorName: string;
  categories: CrewFloorCategoryWork[];
}

export interface CrewRecord {
  id: string;
  teamId?: string;
  date: string;
  teamName: string;
  leaderName: string;
  workerCount: number;
  workersInside?: number;
  workersOutside?: number;
  floorId?: string;
  floorName?: string;
  floorWorks?: CrewFloorWork[];
  taskDescription: string;
  shift?: string;
  notes?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  contractorName?: string;
  inspectorName?: string;
  createdAt: string | number;
  updatedAt?: string | number;
  ownerUid?: string;
  syncCode?: string;
  description?: string;
  isDefault?: boolean;
}

export interface SingleProjectBackup {
  schemaVersion: 3;
  backupType: 'single-project';
  project: ProjectInfo;
  data: {
    projectName?: string;
    contractorName?: string;
    inspectorName?: string;
    materialNorms: MaterialNorm[];
    inventory: InventoryItem[];
    workVolumes: WorkVolume[];
    floorPlans: FloorPlan[];
    defects: DefectItem[];
    roomProgressList: RoomProgressItem[];
    checklist: ChecklistItem[];
    crewRecords: CrewRecord[];
    teams: TeamInfo[];
    tombstones?: Record<string, number>;
    updatedAt?: number;
  };
  tombstones?: Record<string, number>;
  categoryUpdatedAt?: Record<string, number>;
}

export interface TeamRoomDetail {
  roomId: string;
  roomName: string;
  floorId: string;
  floorName: string;
  workCategoryId?: string;
  workCategoryName: string;
  unit: string;
  teamId: string;
  teamName: string;
  assignedVolume: number;
  frameVolume: number;
  boardVolume: number;
  inspectedVolume: number;
  progress: number;
  frameStatus: AcceptanceStatus;
  boardStatus: AcceptanceStatus;
  inspectionStatus: RoomInspectionResult;
  targetDate?: string;
  notes?: string;
}
