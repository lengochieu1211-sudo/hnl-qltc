import { InventoryItem, WorkVolume, FloorPlan, DefectItem, ChecklistItem, MaterialNorm, RoomProgressItem, CrewRecord, TeamInfo } from '../types';

export const INITIAL_ROOM_PROGRESS: RoomProgressItem[] = [
  {
    id: 'ROOM-101',
    floorId: 'fp-1',
    roomName: 'Căn A1-01 (Phòng Khách)',
    assignedTeam: 'Đội Thạch Cao Số 1',
    workVolume: 65,
    volumeUnit: 'm²',
    x: 8,
    y: 12,
    width: 32,
    height: 38,
    frameStatus: 'Đã hoàn thành',
    boardStatus: 'Đã hoàn thành',
    frameInspectionStatus: 'Đạt nghiệm thu',
    boardInspectionStatus: 'Đạt nghiệm thu',
    inspectionStatus: 'Đạt nghiệm thu',
    inspectorName: 'KS. Nguyễn Văn Bình',
    notes: 'Khung xương C-line & Tấm 9mm hoàn thiện đúng tiêu chuẩn',
    updatedAt: '2026-08-06 14:00',
  },
  {
    id: 'ROOM-102',
    floorId: 'fp-1',
    roomName: 'Căn A1-02 (Phòng Bếp & WC)',
    assignedTeam: 'Đội Thạch Cao Số 1',
    workVolume: 42,
    volumeUnit: 'm²',
    x: 52,
    y: 12,
    width: 38,
    height: 38,
    frameStatus: 'Đã hoàn thành',
    boardStatus: 'Đang làm',
    frameInspectionStatus: 'Đạt nghiệm thu',
    boardInspectionStatus: 'Chưa nghiệm thu',
    inspectionStatus: 'Chưa nghiệm thu',
    inspectorName: 'KS. Trịnh Quốc An',
    notes: 'Khung xong 100%, đang bắn tấm chống ẩm Gyproc khu vực WC',
    updatedAt: '2026-08-06 15:30',
  },
  {
    id: 'ROOM-103',
    floorId: 'fp-1',
    roomName: 'Căn A1-03 (Phòng Ngủ Master)',
    assignedTeam: 'Đội Sơn Bả Số 2',
    workVolume: 55,
    volumeUnit: 'm²',
    x: 8,
    y: 58,
    width: 32,
    height: 35,
    frameStatus: 'Đang làm',
    boardStatus: 'Chưa làm',
    frameInspectionStatus: 'Chưa nghiệm thu',
    boardInspectionStatus: 'Chưa nghiệm thu',
    inspectionStatus: 'Chưa nghiệm thu',
    inspectorName: 'Đội trưởng Hùng',
    notes: 'Đang đi ty ren & gắn thanh C-line chính',
    updatedAt: '2026-08-06 16:10',
  },
  {
    id: 'ROOM-104',
    floorId: 'fp-1',
    roomName: 'Căn A1-04 (Hành Lang Chung)',
    assignedTeam: 'Đội Thạch Cao Số 1',
    workVolume: 80,
    volumeUnit: 'm²',
    x: 52,
    y: 58,
    width: 38,
    height: 35,
    frameStatus: 'Đã hoàn thành',
    boardStatus: 'Đã hoàn thành',
    frameInspectionStatus: 'Đạt nghiệm thu',
    boardInspectionStatus: 'Chưa đạt (Cần sửa)',
    inspectionStatus: 'Chưa đạt (Cần sửa)',
    inspectorName: 'KS. Nguyễn Văn Bình',
    notes: 'Phát hiện bắn thưa vít trần khu vực giáp tường, yêu cầu bổ sung vít',
    updatedAt: '2026-08-06 16:45',
  },
];

export const INITIAL_MATERIAL_NORMS: MaterialNorm[] = [
  {
    id: 'NORM-001',
    category: 'Tấm thạch cao',
    workCategory: 'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn',
    materialName: 'Tấm thạch cao tiêu chuẩn 9mm (1220x2440)',
    unit: 'Tấm',
    quotaQuantity: 500,
    unitNormPerM2: 0.35,
    notes: 'Quy cách 1.22m x 2.44m, dày 9mm Gyproc Vĩnh Tường',
  },
  {
    id: 'NORM-002',
    category: 'Khung xương',
    workCategory: 'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn',
    materialName: 'Khung xương trần chìm C-Line 4000mm',
    unit: 'Thanh',
    quotaQuantity: 1200,
    unitNormPerM2: 0.8,
    notes: 'Khung trần chìm C-Line mạ kẽm Vĩnh Tường 4m',
  },
  {
    id: 'NORM-003',
    category: 'Khung xương',
    workCategory: 'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn',
    materialName: 'Khung xương trần chìm U-Line 4000mm',
    unit: 'Thanh',
    quotaQuantity: 600,
    unitNormPerM2: 0.4,
    notes: 'Thanh phụ U-line 4m liên kết C-line',
  },
  {
    id: 'NORM-004',
    category: 'Phụ kiện & Vít',
    workCategory: 'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn',
    materialName: 'Vít tự khoan bắn tấm trần 25mm',
    unit: 'Hộp (1000 con)',
    quotaQuantity: 25,
    unitNormPerM2: 0.02,
    notes: 'Vít bắn thạch cao mạ đen 25mm',
  },
  {
    id: 'NORM-005',
    category: 'Tấm thạch cao',
    workCategory: 'Trần Thạch Cao Khung Chìm Tấm Chống Ẩm',
    materialName: 'Tấm chống ẩm Gyproc 12mm (1220x2440)',
    unit: 'Tấm',
    quotaQuantity: 150,
    unitNormPerM2: 0.35,
    notes: 'Dùng cho khu vực Bếp, Hành lang & WC',
  },
  {
    id: 'NORM-006',
    category: 'Sơn bả & Mối nối',
    workCategory: 'Sơn Bả Hoàn Thiện Trần / Vách',
    materialName: 'Bột trét xử lý mối nối Gyproc',
    unit: 'Bao (25kg)',
    quotaQuantity: 40,
    unitNormPerM2: 0.03,
    notes: 'Trét mối nối & dán keo lưới chống nứt',
  },
  {
    id: 'NORM-007',
    category: 'Phụ kiện & Vít',
    workCategory: 'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn',
    materialName: 'Thanh viền tường VT-Recco 25x25mm',
    unit: 'Thanh',
    quotaQuantity: 250,
    unitNormPerM2: 0.25,
    notes: 'Thanh góc viền tường mạ kẽm',
  },
];

// Built-in vector SVG blueprints for demo floor plans

export const DEMO_FLOOR_PLANS: Record<string, string> = {
  'Tầng 1': 'data:image/svg+xml;utf8,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="100%" height="100%" style="background:#f1f5f9;">
      <rect x="20" y="20" width="760" height="560" fill="#ffffff" stroke="#334155" stroke-width="4"/>
      <!-- Grid ceiling lines -->
      <path d="M20,100 H780 M20,180 H780 M20,260 H780 M20,340 H780 M20,420 H780 M20,500 H780" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="4,4"/>
      <path d="M100,20 V580 M180,20 V580 M260,20 V580 M340,20 V580 M420,20 V580 M500,20 V580 M580,20 V580 M660,20 V580" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="4,4"/>
      <!-- Rooms -->
      <rect x="40" y="40" width="330" height="240" fill="#f8fafc" stroke="#475569" stroke-width="3"/>
      <text x="50" y="70" font-family="sans-serif" font-weight="bold" font-size="16" fill="#1e293b">PHÒNG KHÁCH (Lắp Khung C &amp; Bắn Tấm 9mm)</text>

      <rect x="410" y="40" width="350" height="240" fill="#f8fafc" stroke="#475569" stroke-width="3"/>
      <text x="420" y="70" font-family="sans-serif" font-weight="bold" font-size="16" fill="#1e293b">KHU VỰC BẾP &amp; SẢNH (Khung Chìm Chống Ẩm)</text>

      <rect x="40" y="320" width="400" height="240" fill="#f8fafc" stroke="#475569" stroke-width="3"/>
      <text x="50" y="350" font-family="sans-serif" font-weight="bold" font-size="16" fill="#1e293b">PHÒNG LÀM VIỆC (Trần Giật Cấp Hắt Đèn)</text>

      <rect x="480" y="320" width="280" height="240" fill="#f8fafc" stroke="#475569" stroke-width="3"/>
      <text x="490" y="350" font-family="sans-serif" font-weight="bold" font-size="16" fill="#1e293b">KHU WC (Tấm Chống Nước 12mm)</text>
      <!-- Ceiling lights/vents markers -->
      <circle cx="205" cy="160" r="18" fill="#e2e8f0" stroke="#0284c7" stroke-width="2"/>
      <circle cx="585" cy="160" r="18" fill="#e2e8f0" stroke="#0284c7" stroke-width="2"/>
      <circle cx="240" cy="440" r="18" fill="#e2e8f0" stroke="#0284c7" stroke-width="2"/>
      <text x="350" y="300" font-family="sans-serif" font-size="14" fill="#64748b" text-anchor="middle">MẶT BẰNG THI CÔNG TRẦN THẠCH CAO - TẦNG 1</text>
    </svg>
  `),
  'Tầng 2': 'data:image/svg+xml;utf8,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="100%" height="100%" style="background:#f1f5f9;">
      <rect x="20" y="20" width="760" height="560" fill="#ffffff" stroke="#334155" stroke-width="4"/>
      <path d="M20,120 H780 M20,240 H780 M20,360 H780 M20,480 H780" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="4,4"/>
      <path d="M160,20 V580 M300,20 V580 M440,20 V580 M580,20 V580 M720,20 V580" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="4,4"/>
      <rect x="50" y="50" width="320" height="230" fill="#f8fafc" stroke="#475569" stroke-width="3"/>
      <text x="60" y="80" font-family="sans-serif" font-weight="bold" font-size="16" fill="#1e293b">PHÒNG NGỦ MASTER - TẦNG 2</text>
      <rect x="410" y="50" width="340" height="230" fill="#f8fafc" stroke="#475569" stroke-width="3"/>
      <text x="420" y="80" font-family="sans-serif" font-weight="bold" font-size="16" fill="#1e293b">PHÒNG NGỦ 2</text>
      <rect x="50" y="310" width="700" height="240" fill="#f8fafc" stroke="#475569" stroke-width="3"/>
      <text x="60" y="340" font-family="sans-serif" font-weight="bold" font-size="16" fill="#1e293b">HÀNH LANG &amp; KHU VỰC CHUNG (Trần Khung Chìm Vĩnh Tường)</text>
      <text x="400" y="580" font-family="sans-serif" font-size="14" fill="#64748b" text-anchor="middle">MẶT BẰNG THI CÔNG TRẦN THẠCH CAO - TẦNG 2</text>
    </svg>
  `),
};

export const INITIAL_INVENTORY: InventoryItem[] = [
  {
    id: 'NK-001',
    type: 'in',
    materialName: 'Tấm thạch cao tiêu chuẩn 9mm (1220x2440)',
    unit: 'Tấm',
    quantity: 500,
    location: 'Kho Kho Vĩnh Tường - Tầng 1',
    handler: 'Nguyễn Văn Hùng (Thủ Kho)',
    date: '2026-08-01',
    notes: 'Hàng Vĩnh Tường chính hãng mới về',
  },
  {
    id: 'XK-001',
    type: 'out',
    materialName: 'Tấm thạch cao tiêu chuẩn 9mm (1220x2440)',
    unit: 'Tấm',
    quantity: 180,
    location: 'Thi công Tầng 1',
    handler: 'Trần Đình Nam (Đội trưởng 1)',
    date: '2026-08-02',
    notes: 'Bắn tấm trần phòng khách & sảnh tầng 1',
  },
  {
    id: 'NK-002',
    type: 'in',
    materialName: 'Khung xương trần chìm C-Line 4000mm',
    unit: 'Thanh',
    quantity: 400,
    location: 'Kho Tổng',
    handler: 'Nguyễn Văn Hùng',
    date: '2026-08-01',
    notes: 'Thép mạ kẽm dày 0.4mm',
  },
  {
    id: 'XK-002',
    type: 'out',
    materialName: 'Khung xương trần chìm C-Line 4000mm',
    unit: 'Thanh',
    quantity: 220,
    location: 'Thi công Tầng 1 & Tầng 2',
    handler: 'Lê Hoàng Anh',
    date: '2026-08-03',
    notes: 'Lắp khung xương tầng 1',
  },
  {
    id: 'NK-003',
    type: 'in',
    materialName: 'Tấm chống ẩm Gyproc 12mm',
    unit: 'Tấm',
    quantity: 150,
    location: 'Kho Tổng',
    handler: 'Nguyễn Văn Hùng',
    date: '2026-08-04',
    notes: 'Dùng riêng khu WC & Bếp',
  },
  {
    id: 'NK-004',
    type: 'in',
    materialName: 'Vít tự khoan bắn tấm trần 25mm',
    unit: 'Hộp (1000 con)',
    quantity: 30,
    location: 'Kho Tầng 1',
    handler: 'Nguyễn Văn Hùng',
    date: '2026-08-02',
    notes: 'Hộp 1.000 con',
  },
  {
    id: 'NK-005',
    type: 'in',
    materialName: 'Ty ren treo M6 & Nở sắt',
    unit: 'Bộ',
    quantity: 600,
    location: 'Kho Tầng 1',
    handler: 'Nguyễn Văn Hùng',
    date: '2026-08-01',
    notes: 'Ty treo khung trần chìm',
  },
];

export const INITIAL_WORK_VOLUMES: WorkVolume[] = [
  {
    id: 'HM-101',
    title: 'Thi công khung xương trần chìm Tầng 1',
    floor: 'Tầng 1',
    category: 'khung_tran',
    unit: 'm2',
    planned: 380,
    actual: 380,
    unitPrice: 110000,
    status: 'Đã hoàn thành',
  },
  {
    id: 'HM-102',
    title: 'Thi công bắn tấm thạch cao 9mm Tầng 1',
    floor: 'Tầng 1',
    category: 'ban_tam',
    unit: 'm2',
    planned: 380,
    actual: 310,
    unitPrice: 95000,
    status: 'Đang thi công',
  },
  {
    id: 'HM-103',
    title: 'Sơn bả bột trét & hoàn thiện trần Tầng 1',
    floor: 'Tầng 1',
    category: 'son_ba',
    unit: 'm2',
    planned: 380,
    actual: 0,
    unitPrice: 65000,
    status: 'Chưa thi công',
  },
  {
    id: 'HM-201',
    title: 'Thi công khung xương trần chìm Tầng 2',
    floor: 'Tầng 2',
    category: 'khung_tran',
    unit: 'm2',
    planned: 420,
    actual: 250,
    unitPrice: 110000,
    status: 'Đang thi công',
  },
  {
    id: 'HM-202',
    title: 'Thi công bắn tấm thạch cao 9mm Tầng 2',
    floor: 'Tầng 2',
    category: 'ban_tam',
    unit: 'm2',
    planned: 420,
    actual: 80,
    unitPrice: 95000,
    status: 'Đang thi công',
  },
];

export const INITIAL_FLOOR_PLANS: FloorPlan[] = [
  {
    id: 'fp-1',
    floorName: 'Tầng 1',
    imageUrl: DEMO_FLOOR_PLANS['Tầng 1'],
    uploadedAt: '2026-08-02',
  },
  {
    id: 'fp-2',
    floorName: 'Tầng 2',
    imageUrl: DEMO_FLOOR_PLANS['Tầng 2'],
    uploadedAt: '2026-08-03',
  },
];

export const INITIAL_DEFECTS: DefectItem[] = [
  {
    id: 'DEF-101',
    floorId: 'fp-1',
    floorName: 'Tầng 1',
    category: 'Bắn thiếu vít / thưa vít tấm',
    x: 28,
    y: 25,
    description: 'Bắn vít khoảng cách thưa >35cm ở góc tấm trần phòng khách, tấm bị võng nhẹ',
    severity: 'Trung bình',
    assignedTo: 'Đội thi công bắn tấm 1',
    createdBy: 'Kỹ sư QC Nguyễn Văn Hải',
    dueDate: '2026-08-07',
    status: 'Mới phát hiện',
    createdAt: '2026-08-05 09:30',
  },
  {
    id: 'DEF-102',
    floorId: 'fp-1',
    floorName: 'Tầng 1',
    category: 'Khung trần lệch/xô lệch',
    x: 65,
    y: 30,
    description: 'Ty ren treo lỏng khiến dầm trần bị võng 12mm khu vực sảnh bếp',
    severity: 'Nghiêm trọng',
    assignedTo: 'Đội thợ khung trần Nam',
    createdBy: 'Giám sát Bùi Hoàng',
    dueDate: '2026-08-12',
    status: 'Đang sửa',
    createdAt: '2026-08-05 14:15',
  },
  {
    id: 'DEF-201',
    floorId: 'fp-2',
    floorName: 'Tầng 2',
    category: 'Chừa thiếu lỗ điện/máy lạnh',
    x: 35,
    y: 35,
    description: 'Chưa đục lỗ cấp nguồn đèn âm trần khu vực phòng ngủ 2',
    severity: 'Thấp',
    assignedTo: 'Đội điện nước',
    createdBy: 'Giám sát Nguyễn Văn Bình',
    dueDate: '2026-08-10',
    status: 'Mới phát hiện',
    createdAt: '2026-08-06 10:00',
  },
];

export const INITIAL_CHECKLIST: ChecklistItem[] = [
  // Tầng 1
  {
    id: 'CHK-101',
    floorName: 'Tầng 1',
    category: 'Thi công khung trần',
    title: 'Kiểm tra cao độ trần bằng máy Laze & khoảng cách ty treo (<= 1.0m)',
    status: 'passed',
    notes: 'Đã bắn độ cao chuẩn +2.85m, ty treo chắc chắn',
    inspectedBy: 'Kỹ sư Giám sát Nguyễn Văn Bình',
    inspectedAt: '2026-08-03 16:00',
  },
  {
    id: 'CHK-102',
    floorName: 'Tầng 1',
    category: 'Thi công khung trần',
    title: 'Kiểm tra liên kết khóa liên kết & khoảng cách thanh chính C-line (400mm)',
    status: 'passed',
    notes: 'Khoảng cách thanh C đạt chuẩn 40cm',
    inspectedBy: 'Kỹ sư Bình',
    inspectedAt: '2026-08-03 16:30',
  },
  {
    id: 'CHK-103',
    floorName: 'Tầng 1',
    category: 'Thi công bắn tấm trần',
    title: 'Kiểm tra khoảng cách bắn vít tấm thạch cao (20cm cạnh, 30cm giữa)',
    status: 'defect',
    notes: 'Phát hiện DEF-101 bắn thưa vít ở phòng khách',
    inspectedBy: 'Kỹ sư Bình',
    inspectedAt: '2026-08-05 09:40',
  },
  {
    id: 'CHK-104',
    floorName: 'Tầng 1',
    category: 'Thi công bắn tấm trần',
    title: 'Xử lý khe nối tấm thạch cao & băng keo dán mối nối',
    status: 'pending',
    notes: 'Đang đợi khắc phục bớt lỗi bắn tấm trước khi dán keo',
  },

  // Tầng 2
  {
    id: 'CHK-201',
    floorName: 'Tầng 2',
    category: 'Thi công khung trần',
    title: 'Kiểm tra cao độ trần & liên kết ty ren nở sắt Tầng 2',
    status: 'passed',
    notes: 'Khung xương hoàn thành 80%',
    inspectedBy: 'Kỹ sư Bình',
    inspectedAt: '2026-08-05 15:00',
  },
  {
    id: 'CHK-202',
    floorName: 'Tầng 2',
    category: 'Thi công bắn tấm trần',
    title: 'Kiểm tra tấm thạch cao không bị nứt móp, gãy góc trước khi bắn',
    status: 'defect',
    notes: 'Có lỗi DEF-201 chừa thiếu lỗ kỹ thuật',
    inspectedBy: 'Kỹ sư Bình',
    inspectedAt: '2026-08-06 10:15',
  },
];

export const INITIAL_CREW_RECORDS: CrewRecord[] = [
  {
    id: 'crew-1',
    date: '2026-08-07',
    teamName: 'Đội Thạch Cao Hà Nội',
    leaderName: 'Đội trưởng Hùng',
    workerCount: 12,
    floorId: 'fp-1',
    floorName: 'Tầng 1',
    taskDescription: 'Bắn tấm thạch cao trần phòng ngủ và WC',
    notes: 'Tiến độ tốt, đủ vật tư tấm Gyproc và vít 4cm',
  },
  {
    id: 'crew-2',
    date: '2026-08-07',
    teamName: 'Đội Khung Xương Tiến Phát',
    leaderName: 'Đội trưởng Tiến',
    workerCount: 8,
    floorId: 'fp-2',
    floorName: 'Tầng 2',
    taskDescription: 'Lắp dựng khung xương chính C-line & thanh U gai',
    notes: 'Còn thiếu một số ty ren m8 bổ sung',
  },
  {
    id: 'crew-3',
    date: '2026-08-07',
    teamName: 'Đội Sơn Bả Hùng Cường',
    leaderName: 'Anh Cường',
    workerCount: 6,
    floorId: 'fp-1',
    floorName: 'Tầng 1',
    taskDescription: 'Bả matit lớp 1 mối nối tấm & góc trần',
    notes: 'Đã hoàn thành các căn trục A',
  }
];

export const INITIAL_TEAMS: TeamInfo[] = [
  { id: 'team-1', name: 'Đội Thạch Cao Hà Nội', leader: 'Đội trưởng Hùng', defaultCount: 12, phone: '0912345678', notes: 'Đội chính đóng tấm Gyproc' },
  { id: 'team-2', name: 'Đội Khung Xương Tiến Phát', leader: 'Đội trưởng Tiến', defaultCount: 8, phone: '0987654321', notes: 'Chuyên lắp ráp giàn khung xương chính' },
  { id: 'team-3', name: 'Đội Sơn Bả Hùng Cường', leader: 'Anh Cường', defaultCount: 6, phone: '0905556677', notes: 'Sơn bả trần thạch cao' },
  { id: 'team-4', name: 'Đội Trần Chìm Hải Phòng', leader: 'Anh Hải', defaultCount: 10, notes: 'Thi công trần giật cấp nghệ thuật' },
  { id: 'team-5', name: 'Đội Cơ Điện & Nước', leader: 'Anh Điện', defaultCount: 4, notes: 'Đi ống luồn dây điện âm trần' },
  { id: 'team-6', name: 'Đội Phụ Trợ & Dọn Dẹp', leader: 'Chị Hoa', defaultCount: 5, notes: 'Thu dọn phế thải thạch cao tấm vụn' },
];


