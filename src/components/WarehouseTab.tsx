import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { 
  ArrowDownLeft, 
  ArrowUpRight, 
  Plus, 
  Search, 
  PackageCheck, 
  Layers, 
  Calendar, 
  User, 
  MapPin, 
  FileSpreadsheet,
  FileText,
  Trash2,
  Filter,
  Sliders,
  ArrowUpDown,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Download,
  Upload,
  Edit2,
  ChevronDown,
  PackageSearch
} from 'lucide-react';
import { InventoryItem, TransactionType, MaterialNorm, WorkVolume, RoomProgressItem, TeamInfo, FloorPlan } from '../types';
import { formatDateDDMMYYYY, formatExcelDate } from '../utils/dateFormatter';
import { formatDecimal, evaluateMathExpression, useFormatSettings, parseVietnameseNumber, parseExcelNumber } from '../utils/numberUtils';
import * as XLSX from 'xlsx';
import { exportWarehouseUpdateTemplate } from '../utils/excelExport';
import { confirmAsync } from '../utils/confirmAsync';
import { calculateStockSummary, resolveNormMaterialId } from '../utils/inventoryUtils';
import { compareDateValues, naturalCompare } from '../utils/sortUtils';
import { createEntityId } from '../utils/idUtils';
import { normalizeUnit } from '../utils/unitUtils';
import { assertSafeExcelImportFile, parseExcelNumberRecord, parseExcelStringArray, sameStringSet } from '../utils/excelImportUtils';
import { QuickSortBar } from './QuickSortBar';
import { SettingsFeatureSheet } from './SettingsFeatureSheet';
import { FIREBASE_ONLY_RUNTIME } from '../config/runtimeArchitecture';
import { computeMaterialNeeds } from '../utils/materialNeedEngine';
import { UserRole, canEditWarehouseData, canDeleteBusinessData, canImportData, canManageMaterialNorms } from '../utils/securityUtils';

type MaterialNeedSortKey = 'default' | 'material' | 'category' | 'remaining' | 'deficit' | 'stock';

interface WarehouseTabProps {
  inventory: InventoryItem[];
  userRole: UserRole;
  roleResolved: boolean;
  onAddInventory: (item: Omit<InventoryItem, 'id'> & { id?: string }) => void | Promise<void>;
  onUpdateInventory?: (id: string, item: Omit<InventoryItem, 'id'>) => void | Promise<void>;
  onDeleteInventory: (id: string) => void | Promise<void>;
  onDeleteMultipleInventory?: (ids: string[]) => void | Promise<void>;
  onSyncSheets?: () => void;
  materialNorms: MaterialNorm[];
  onOpenNormModal: () => void;
  onOpenExportPdf?: () => void;
  onExportExcel?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  workVolumes?: WorkVolume[];
  onImportInventory?: (inventory: InventoryItem[]) => void | Promise<void>;
  onImportNorms?: (norms: MaterialNorm[]) => void;
  onImportWorkVolumes?: (volumes: WorkVolume[]) => void;
  roomProgressList?: RoomProgressItem[];
  teams?: TeamInfo[];
  floorPlans?: FloorPlan[];
  defaultHandler?: string;
}

export const WarehouseTab: React.FC<WarehouseTabProps> = ({
  inventory,
  userRole,
  roleResolved,
  onAddInventory,
  onUpdateInventory,
  onDeleteInventory,
  onDeleteMultipleInventory,
  onSyncSheets,
  materialNorms,
  onOpenNormModal,
  onOpenExportPdf,
  onExportExcel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  workVolumes,
  onImportInventory,
  onImportNorms,
  onImportWorkVolumes,
  roomProgressList = [],
  teams = [],
  floorPlans = [],
  defaultHandler = '',
}) => {
  const { t } = useLanguage();
  const hasEditAccess = roleResolved && canEditWarehouseData(userRole);
  const hasDeleteAccess = roleResolved && canDeleteBusinessData(userRole);
  const hasImportAccess = roleResolved && canImportData(userRole);
  const hasNormManageAccess = roleResolved && canManageMaterialNorms(userRole);
  const [filterType, setFilterType] = useState<'all' | 'in' | 'out'>('all');
  useFormatSettings();
  const [searchTerm, setSearchTerm] = useState('');
  const [inventorySortBy, setInventorySortBy] = useState<'date' | 'material' | 'location' | 'handler'>('date');
  const [inventorySortOrder, setInventorySortOrder] = useState<'asc' | 'desc'>('desc');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingInventory, setEditingInventory] = useState<InventoryItem | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [materialNeedFloorIds, setMaterialNeedFloorIds] = useState<string[]>([]);
  const [materialNeedRoomIds, setMaterialNeedRoomIds] = useState<string[]>([]);
  const [materialNeedTeamIds, setMaterialNeedTeamIds] = useState<string[]>([]);
  const [materialNeedWorkCategoryIds, setMaterialNeedWorkCategoryIds] = useState<string[]>([]);
  const [materialNeedSortBy, setMaterialNeedSortBy] = useState<MaterialNeedSortKey>('default');
  const [materialNeedSortOrder, setMaterialNeedSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isMaterialNeedExpanded, setIsMaterialNeedExpanded] = useState(false);
  const [showMaterialFloorPicker, setShowMaterialFloorPicker] = useState(false);
  const [showMaterialRoomPicker, setShowMaterialRoomPicker] = useState(false);
  const [showMaterialTeamPicker, setShowMaterialTeamPicker] = useState(false);
  const [showMaterialWorkCategoryPicker, setShowMaterialWorkCategoryPicker] = useState(false);


  const materialNeedFloors = useMemo(() => {
    const map = new Map<string, string>();

    // FloorPlan is the canonical source for display names. Room records can be
    // legacy/incomplete and must never overwrite a valid floor name with fp-* ID.
    floorPlans.forEach((floor) => {
      const id = String(floor.id || '').trim();
      const name = String(floor.floorName || '').trim();
      if (id) map.set(id, name || id);
    });

    roomProgressList.forEach((room) => {
      const id = String(room.floorId || '').trim();
      if (!id) return;
      const roomName = String(room.floorName || '').trim();
      const existing = map.get(id);
      const existingIsTechnicalId = !existing || existing === id || /^fp[-_]/i.test(existing);
      if (!existing || (existingIsTechnicalId && roomName && roomName !== id && !/^fp[-_]/i.test(roomName))) {
        map.set(id, roomName || existing || id);
      }
    });

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => naturalCompare(a.name, b.name));
  }, [floorPlans, roomProgressList]);

  const materialNeedRooms = useMemo(() => {
    const floorNameById = new Map(materialNeedFloors.map((floor) => [floor.id, floor.name]));
    const map = new Map<string, { id: string; name: string; floorId: string; floorName: string }>();
    roomProgressList.filter((room) => room.deletedAt === undefined || room.deletedAt === null).forEach((room) => {
      const id = String(room.id || '').trim();
      if (!id) return;
      const floorId = String(room.floorId || '').trim();
      const floorName = String(floorNameById.get(floorId) || room.floorName || floorId).trim();
      map.set(id, { id, name: String(room.roomName || id).trim() || id, floorId, floorName });
    });
    return Array.from(map.values()).sort((a, b) =>
      naturalCompare(a.floorName, b.floorName) || naturalCompare(a.name, b.name) || naturalCompare(a.id, b.id)
    );
  }, [materialNeedFloors, roomProgressList]);

  const materialNeedTeams = useMemo(() => teams
    .filter((team) => team.deletedAt === undefined || team.deletedAt === null)
    .slice()
    .sort((a, b) => naturalCompare(a.name, b.name) || naturalCompare(a.id, b.id)), [teams]);

  const materialNeedWorkCategories = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    (workVolumes || [])
      .filter((item) => item.deletedAt === undefined || item.deletedAt === null)
      .forEach((item) => {
        const id = String(item.workCategoryId || item.id || '').trim();
        if (!id) return;
        const name = String(item.title || id).trim() || id;
        if (!map.has(id)) map.set(id, { id, name });
      });
    return Array.from(map.values()).sort((a, b) => naturalCompare(a.name, b.name) || naturalCompare(a.id, b.id));
  }, [workVolumes]);

  const materialNeedResult = useMemo(() => computeMaterialNeeds({
    rooms: roomProgressList,
    materialNorms,
    inventory,
    workVolumes: workVolumes || [],
    teams,
    scope: {
      floorIds: materialNeedFloorIds.length > 0 ? materialNeedFloorIds : undefined,
      roomIds: materialNeedRoomIds.length > 0 ? materialNeedRoomIds : undefined,
      teamIds: materialNeedTeamIds.length > 0 ? materialNeedTeamIds : undefined,
      workCategoryIds: materialNeedWorkCategoryIds.length > 0 ? materialNeedWorkCategoryIds : undefined,
    },
  }), [roomProgressList, materialNorms, inventory, workVolumes, teams, materialNeedFloorIds, materialNeedRoomIds, materialNeedTeamIds, materialNeedWorkCategoryIds]);

  const materialNeedLines = useMemo(() => {
    return [...materialNeedResult.lines].sort((a, b) => {
      let comparison = 0;
      switch (materialNeedSortBy) {
        case 'material':
          comparison = naturalCompare(a.materialName, b.materialName);
          break;
        case 'category':
          comparison = naturalCompare(a.category, b.category);
          break;
        case 'remaining':
          comparison = a.remainingQty - b.remainingQty;
          break;
        case 'deficit':
          comparison = a.deficitQty - b.deficitQty;
          break;
        case 'stock':
          comparison = a.stockQty - b.stockQty;
          break;
        case 'default':
        default:
          return naturalCompare(a.category, b.category) || naturalCompare(a.materialName, b.materialName) || naturalCompare(a.materialKey, b.materialKey);
      }
      if (materialNeedSortOrder === 'desc') comparison = -comparison;
      if (comparison !== 0) return comparison;
      return naturalCompare(a.category, b.category) || naturalCompare(a.materialName, b.materialName) || naturalCompare(a.materialKey, b.materialKey);
    });
  }, [materialNeedResult.lines, materialNeedSortBy, materialNeedSortOrder]);

  const toggleMaterialNeedFloor = (id: string) => {
    setMaterialNeedFloorIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const toggleMaterialNeedRoom = (id: string) => {
    setMaterialNeedRoomIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const toggleMaterialNeedTeam = (id: string) => {
    setMaterialNeedTeamIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const toggleMaterialNeedWorkCategory = (id: string) => {
    setMaterialNeedWorkCategoryIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const materialNeedFloorSummary = materialNeedFloorIds.length === 0 ? 'Tất cả tầng' : materialNeedFloorIds.length === 1 ? (materialNeedFloors.find((item) => item.id === materialNeedFloorIds[0])?.name || '1 tầng') : `${materialNeedFloorIds.length} tầng`;
  const materialNeedRoomSummary = materialNeedRoomIds.length === 0 ? 'Tất cả căn' : materialNeedRoomIds.length === 1 ? (materialNeedRooms.find((item) => item.id === materialNeedRoomIds[0])?.name || '1 căn') : `${materialNeedRoomIds.length} căn`;
  const materialNeedTeamSummary = materialNeedTeamIds.length === 0 ? 'Tất cả đội' : materialNeedTeamIds.length === 1 ? (materialNeedTeams.find((item) => item.id === materialNeedTeamIds[0])?.name || '1 đội') : `${materialNeedTeamIds.length} đội`;
  const materialNeedWorkCategorySummary = materialNeedWorkCategoryIds.length === 0 ? 'Tất cả hạng mục đã khai' : materialNeedWorkCategoryIds.length === 1 ? (materialNeedWorkCategories.find((item) => item.id === materialNeedWorkCategoryIds[0])?.name || '1 hạng mục') : `${materialNeedWorkCategoryIds.length} hạng mục`;
  const hasMaterialAllocationFilter = materialNeedTeamIds.length > 0 || materialNeedWorkCategoryIds.length > 0;


  useEffect(() => {
    if (!hasEditAccess) {
      setShowAddForm(false);
      setEditingInventory(null);
    }
    if (!hasDeleteAccess) {
      setSelectedItemIds([]);
      setDeletingInventoryTarget(null);
    }
  }, [hasEditAccess, hasDeleteAccess]);

  // Drag and Drop state for Excel file
  const [isDraggingExcel, setIsDraggingExcel] = useState(false);

  const handleDragOverExcel = (e: React.DragOverEvent | any) => {
    e.preventDefault();
    setIsDraggingExcel(true);
  };

  const handleDragLeaveExcel = async () => {
    setIsDraggingExcel(false);
  };

  const handleDropExcel = (e: React.DragEvent) => {
    e.preventDefault();
    if (!hasImportAccess) { setIsDraggingExcel(false); return; }
    setIsDraggingExcel(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processWarehouseUpdateExcel(file);
    }
  };

  const handleFileChangeExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!hasImportAccess) { e.target.value = ''; return; }
    const file = e.target.files?.[0];
    if (!file) return;
    processWarehouseUpdateExcel(file);
    e.target.value = ''; // Reset input
  };

  const processWarehouseUpdateExcel = async (file: File) => {
    if (!hasImportAccess) { alert('Chỉ ADMIN được nhập dữ liệu kho/định mức/hạng mục hàng loạt từ Excel.'); return; }
    try { assertSafeExcelImportFile(file); } catch (error) {
      alert(`❌ ${error instanceof Error ? error.message : 'Tệp Excel không hợp lệ.'}`);
      return;
    }
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        let inCount = 0;
        let outCount = 0;
        let normsUpdatedCount = 0;
        let normsAddedCount = 0;
        let volumesUpdatedCount = 0;
        let volumesAddedCount = 0;

        let newInventory = [...inventory];
        const importedInventoryRows: InventoryItem[] = [];
        let newNorms = [...materialNorms];
        let newWorkVolumes = workVolumes ? [...workVolumes] : [];

        // 1. Sheet "Nhập kho"
        const inSheetName = workbook.SheetNames.find(
          name => {
            const n = name.toLowerCase();
            return (n.includes('nhap') || n.includes('nhập')) && !n.includes('xuat') && !n.includes('xuất');
          }
        );

        if (inSheetName) {
          const sheet = workbook.Sheets[inSheetName];
          const jsonData = XLSX.utils.sheet_to_json<any>(sheet);
          
          jsonData.forEach((row, rIdx) => {
            const materialNameRaw = row['Tên Vật Tư'] || row['Tên Vật Tư Thạch Cao'] || row['materialName'] || row['Vật tư'] || row['Vat tu'];
            if (!materialNameRaw) return;

            const materialNameStr = String(materialNameRaw).trim();
            const quantityNum = parseVietnameseNumber(row['Số Lượng'] || row['quantity'] || 0);
            if (isNaN(quantityNum) || quantityNum <= 0) return;

            const unitStr = String(row['Đơn Vị Tính'] || row['unit'] || 'Tấm').trim();
            const locationStr = String(row['Vị Trí Kho'] || row['Vị Trí Lưu Kho / Hạng Mục'] || row['location'] || '').trim();
            const handlerStr = String(row['Người Thực Hiện'] || row['handler'] || defaultHandler || '').trim();
            const rawDate = row['Ngày Thực Hiện'] || row['Ngày Lập Phiếu'] || row['date'];
            const dateStr = formatExcelDate(rawDate);
            const notesStr = String(row['Ghi Chú'] || row['notes'] || '').trim();
            const rawId = row['Mã Phiếu'] || row['id'] || row['ID'];
            const rawMaterialId = row['__materialId'] || row['Mã Vật Tư'] || row['materialId'] || row['Mã định mức'];
            const rawSourceType = row['__sourceType'] || row['sourceType'];
            const rawSourceRoomId = row['__sourceRoomId'] || row['sourceRoomId'];
            const rawSourceFloorId = row['__sourceFloorId'] || row['sourceFloorId'];
            const rawSourceTeamId = row['__sourceTeamId'] || row['sourceTeamId'];
            const rawSourceWorkCategoryId = row['__sourceWorkCategoryId'] || row['sourceWorkCategoryId'];
            const rawSourceNormId = row['__sourceNormId'] || row['sourceNormId'];
            const rawSourceIssueKey = row['__sourceIssueKey'] || row['sourceIssueKey'];

            const existingIdx = rawId ? newInventory.findIndex(i => i.id === String(rawId).trim()) : -1;
            
            const existingItem = existingIdx >= 0 ? newInventory[existingIdx] : undefined;
            const preservesExistingIdentity = Boolean(existingItem
              && existingItem.materialName.trim().toLocaleLowerCase('vi-VN') === materialNameStr.toLocaleLowerCase('vi-VN')
              && (normalizeUnit(existingItem.unit) || existingItem.unit) === (normalizeUnit(unitStr) || unitStr));

            const invItem: InventoryItem = {
              id: existingIdx >= 0 ? newInventory[existingIdx].id : (rawId ? String(rawId).trim() : createEntityId('INV-IN')),
              type: 'in',
              materialId: rawMaterialId ? String(rawMaterialId).trim() : (preservesExistingIdentity ? existingItem?.materialId : undefined),
              materialName: materialNameStr,
              unit: unitStr,
              quantity: quantityNum,
              location: locationStr,
              handler: handlerStr,
              date: dateStr,
              notes: notesStr,
              sourceType: rawSourceType ? String(rawSourceType).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceType : undefined),
              sourceRoomId: rawSourceRoomId ? String(rawSourceRoomId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceRoomId : undefined),
              sourceFloorId: rawSourceFloorId ? String(rawSourceFloorId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceFloorId : undefined),
              sourceTeamId: rawSourceTeamId ? String(rawSourceTeamId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceTeamId : undefined),
              sourceWorkCategoryId: rawSourceWorkCategoryId ? String(rawSourceWorkCategoryId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceWorkCategoryId : undefined),
              sourceNormId: rawSourceNormId ? String(rawSourceNormId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceNormId : undefined),
              sourceIssueKey: rawSourceIssueKey ? String(rawSourceIssueKey).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceIssueKey : undefined)
            };

            if (existingIdx >= 0) {
              newInventory[existingIdx] = invItem;
            } else {
              newInventory.unshift(invItem);
            }
            importedInventoryRows.push(invItem);
            inCount++;
          });
        }

        // 2. Sheet "Xuất kho"
        const outSheetName = workbook.SheetNames.find(
          name => {
            const n = name.toLowerCase();
            return n.includes('xuat') || n.includes('xuất');
          }
        );

        if (outSheetName) {
          const sheet = workbook.Sheets[outSheetName];
          const jsonData = XLSX.utils.sheet_to_json<any>(sheet);
          
          jsonData.forEach((row, rIdx) => {
            const materialNameRaw = row['Tên Vật Tư'] || row['Tên Vật Tư Thạch Cao'] || row['materialName'] || row['Vật tư'] || row['Vat tu'];
            if (!materialNameRaw) return;

            const materialNameStr = String(materialNameRaw).trim();
            const quantityNum = parseVietnameseNumber(row['Số Lượng'] || row['quantity'] || 0);
            if (isNaN(quantityNum) || quantityNum <= 0) return;

            const unitStr = String(row['Đơn Vị Tính'] || row['unit'] || 'Tấm').trim();
            const locationStr = String(row['Vị Trí Kho'] || row['Vị Trí Kho / Hạng Mục'] || row['Vị Trí Lưu Kho / Hạng Mục'] || row['location'] || 'Công trình').trim();
            const handlerStr = String(row['Người Thực Hiện'] || row['handler'] || 'Thủ kho').trim();
            const rawDate = row['Ngày Thực Hiện'] || row['Ngày Lập Phiếu'] || row['date'];
            const dateStr = formatExcelDate(rawDate);
            const notesStr = String(row['Ghi Chú'] || row['notes'] || '').trim();
            const rawId = row['Mã Phiếu'] || row['id'] || row['ID'];
            const rawMaterialId = row['__materialId'] || row['Mã Vật Tư'] || row['materialId'] || row['Mã định mức'];
            const rawSourceType = row['__sourceType'] || row['sourceType'];
            const rawSourceRoomId = row['__sourceRoomId'] || row['sourceRoomId'];
            const rawSourceFloorId = row['__sourceFloorId'] || row['sourceFloorId'];
            const rawSourceTeamId = row['__sourceTeamId'] || row['sourceTeamId'];
            const rawSourceWorkCategoryId = row['__sourceWorkCategoryId'] || row['sourceWorkCategoryId'];
            const rawSourceNormId = row['__sourceNormId'] || row['sourceNormId'];
            const rawSourceIssueKey = row['__sourceIssueKey'] || row['sourceIssueKey'];

            const existingIdx = rawId ? newInventory.findIndex(i => i.id === String(rawId).trim()) : -1;
            
            const existingItem = existingIdx >= 0 ? newInventory[existingIdx] : undefined;
            const preservesExistingIdentity = Boolean(existingItem
              && existingItem.materialName.trim().toLocaleLowerCase('vi-VN') === materialNameStr.toLocaleLowerCase('vi-VN')
              && (normalizeUnit(existingItem.unit) || existingItem.unit) === (normalizeUnit(unitStr) || unitStr));

            const invItem: InventoryItem = {
              id: existingIdx >= 0 ? newInventory[existingIdx].id : (rawId ? String(rawId).trim() : createEntityId('INV-OUT')),
              type: 'out',
              materialId: rawMaterialId ? String(rawMaterialId).trim() : (preservesExistingIdentity ? existingItem?.materialId : undefined),
              materialName: materialNameStr,
              unit: unitStr,
              quantity: quantityNum,
              location: locationStr,
              handler: handlerStr,
              date: dateStr,
              notes: notesStr,
              sourceType: rawSourceType ? String(rawSourceType).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceType : undefined),
              sourceRoomId: rawSourceRoomId ? String(rawSourceRoomId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceRoomId : undefined),
              sourceFloorId: rawSourceFloorId ? String(rawSourceFloorId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceFloorId : undefined),
              sourceTeamId: rawSourceTeamId ? String(rawSourceTeamId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceTeamId : undefined),
              sourceWorkCategoryId: rawSourceWorkCategoryId ? String(rawSourceWorkCategoryId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceWorkCategoryId : undefined),
              sourceNormId: rawSourceNormId ? String(rawSourceNormId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceNormId : undefined),
              sourceIssueKey: rawSourceIssueKey ? String(rawSourceIssueKey).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceIssueKey : undefined)
            };

            if (existingIdx >= 0) {
              newInventory[existingIdx] = invItem;
            } else {
              newInventory.unshift(invItem);
            }
            importedInventoryRows.push(invItem);
            outCount++;
          });
        }

        // 3. Sheet "Định Mức Vật Tư"
        const normSheetName = workbook.SheetNames.find(
          name => {
            const n = name.toLowerCase();
            return n.includes('dinh muc') || n.includes('định mức') || (n.includes('vat tu') && !n.includes('nhap') && !n.includes('xuat'));
          }
        );

        if (normSheetName) {
          const sheet = workbook.Sheets[normSheetName];
          const jsonData = XLSX.utils.sheet_to_json<any>(sheet);
          
          jsonData.forEach((row, rIdx) => {
            const materialNameRaw = row['Tên Vật Tư'] || row['materialName'] || row['Vật tư'] || row['Vat tu'];
            if (!materialNameRaw) return;

            const materialNameStr = String(materialNameRaw).trim();
            const categoryStr = String(row['Chủng Loại'] || row['Phân Loại'] || row['category'] || 'Vật tư thạch cao').trim();
            const workCategoryRaw = row['Tên Hạng Mục Thi Công'] || row['Hạng Mục Thi Công'] || row['Hạng mục thi công'] || row['Tên Hạng Mục'] || row['workCategory'];
            const workCategoryStr = workCategoryRaw ? String(workCategoryRaw).trim() : undefined;
            const unitStr = String(row['Đơn Vị Tính'] || row['unit'] || 'Tấm').trim();
            const quotaQuantityNum = parseVietnameseNumber(row['Hao phí định mức'] || row['quotaQuantity'] || 0);
            const unitNormPerM2Num = row['Định Mức / m2'] || row['Định Mức Hao Phí / m2'] || row['Định mức tiêu hao'] || row['unitNormPerM2'];
            const notesStr = String(row['Ghi Chú'] || row['notes'] || '').trim();

            const rawId = row['__normId'] || row['__recordId'] || row['Mã Định Mức'] || row['id'];
            const rawMaterialId = row['__materialId'] || row['Mã Vật Tư'] || row['materialId'];
            const rawWorkCategoryId = row['__workCategoryId'] || row['workCategoryId'];
            const importedWorkCategoryIds = parseExcelStringArray(row['__workCategoryIds'] || row['workCategoryIds'])
              || (rawWorkCategoryId ? [String(rawWorkCategoryId).trim()] : undefined);
            const importedWorkCategoryNormsById = parseExcelNumberRecord(row['__workCategoryNormsById'] || row['workCategoryNormsById']);
            const importedWorkCategories = workCategoryStr ? workCategoryStr.split(',').map(value => value.trim()).filter(Boolean) : undefined;
            const rawIdStr = rawId ? String(rawId).trim() : '';
            const normalizedImportedUnit = normalizeUnit(unitStr) || unitStr;
            const existingIdx = rawIdStr
              ? newNorms.findIndex(n => n.id === rawIdStr)
              : newNorms.findIndex(n => {
                  if (n.materialName.trim().toLocaleLowerCase('vi-VN') !== materialNameStr.toLocaleLowerCase('vi-VN')) return false;
                  if ((normalizeUnit(n.unit) || n.unit) !== normalizedImportedUnit) return false;
                  const existingIds = n.workCategoryIds?.length ? n.workCategoryIds : (n.workCategoryId ? [n.workCategoryId] : undefined);
                  if (importedWorkCategoryIds?.length) return sameStringSet(existingIds, importedWorkCategoryIds);
                  const existingNames = n.workCategories?.length ? n.workCategories : (n.workCategory ? [n.workCategory] : undefined);
                  return sameStringSet(existingNames, importedWorkCategories);
                });
            const existingNorm = existingIdx >= 0 ? newNorms[existingIdx] : undefined;
            const importedNormId = existingNorm?.id || rawIdStr || createEntityId('NORM');
            const importedMaterialId = rawMaterialId
              ? String(rawMaterialId).trim()
              : (existingNorm?.materialId || resolveNormMaterialId({ id: importedNormId, materialName: materialNameStr, unit: normalizedImportedUnit }));
            const finalWorkCategoryIds = importedWorkCategoryIds || existingNorm?.workCategoryIds;
            const finalWorkCategoryId = rawWorkCategoryId
              ? String(rawWorkCategoryId).trim()
              : (finalWorkCategoryIds?.[0] || existingNorm?.workCategoryId);

            const normData: MaterialNorm = {
              ...(existingNorm || {}),
              id: importedNormId,
              materialId: importedMaterialId,
              category: categoryStr,
              workCategory: workCategoryStr || existingNorm?.workCategory,
              workCategoryId: finalWorkCategoryId,
              workCategories: importedWorkCategories || existingNorm?.workCategories,
              workCategoryIds: finalWorkCategoryIds,
              workCategoryNormsById: importedWorkCategoryNormsById || existingNorm?.workCategoryNormsById,
              materialName: materialNameStr,
              unit: normalizedImportedUnit,
              quotaQuantity: quotaQuantityNum,
              unitNormPerM2: unitNormPerM2Num ? parseExcelNumber(unitNormPerM2Num) : undefined,
              normBasisUnit: normalizeUnit(row['ĐVT Khối Lượng Nguồn'] || row['Đơn Vị Khối Lượng Nguồn'] || row['normBasisUnit'] || '') || existingNorm?.normBasisUnit,
              notes: notesStr || undefined
            };

            if (existingIdx >= 0) {
              newNorms[existingIdx] = normData;
              normsUpdatedCount++;
            } else {
              newNorms.push(normData);
              normsAddedCount++;
            }
          });
        }

        // 4. Sheet "Hạng Mục Thi Công"
        const volumeSheetName = workbook.SheetNames.find(
          name => {
            const n = name.toLowerCase();
            return n.includes('khoi luong') || n.includes('khối lượng') || n.includes('hang muc') || n.includes('hạng mục');
          }
        );

        if (volumeSheetName && workVolumes) {
          const sheet = workbook.Sheets[volumeSheetName];
          const jsonData = XLSX.utils.sheet_to_json<any>(sheet);
          
          jsonData.forEach((row, rIdx) => {
            const titleRaw = row['Tên Hạng Mục Công Việc'] || row['Tên Hạng Mục Thi Công'] || row['Hạng Mục Công Việc'] || row['Tên Hạng Mục'] || row['Hạng mục'] || row['title'];
            if (!titleRaw) return;

            const titleStr = String(titleRaw).trim();
            const floorStr = String(row['Tầng / Khu Vực'] || row['Tầng'] || row['floor'] || 'Tầng 1').trim();
            const categoryStr = String(row['Nhóm Hạng Mục'] || row['Phân Loại'] || row['category'] || 'khung_tran').trim() as any;
            const unitStr = String(row['Đơn Vị Tính'] || row['Đơn Vị'] || row['unit'] || 'm2').trim();
            const plannedNum = parseExcelNumber(row['KL Định Mức'] || row['KL Kế Hoạch'] || row['planned'] || 0);
            const unitPriceNum = parseExcelNumber(row['Đơn Giá (VNĐ)'] || row['Đơn Giá'] || row['unitPrice'] || 0);
            const rawVolId = row['__workCategoryId'] || row['__recordId'] || row['Mã Hạng Mục'] || row['id'];
            const rawRecordId = row['__recordId'] || row['id'];
            const rawFloorId = row['__floorId'] || row['floorId'];
            const importedFloorIds = parseExcelStringArray(row['__floorIds'] || row['floorIds'])
              || (rawFloorId ? [String(rawFloorId).trim()] : undefined);
            const dueDate = formatExcelDate(row['Ngày Hạn Định'] || row['Hạn Định'] || row['dueDate']);
            const rawVolIdStr = rawVolId ? String(rawVolId).trim() : '';
            const rawRecordIdStr = rawRecordId ? String(rawRecordId).trim() : '';
            const existingIdx = rawVolIdStr || rawRecordIdStr
              ? newWorkVolumes.findIndex(w => (w.workCategoryId && w.workCategoryId === rawVolIdStr) || w.id === rawRecordIdStr || w.id === rawVolIdStr)
              : newWorkVolumes.findIndex(w => w.title.toLocaleLowerCase('vi-VN') === titleStr.toLocaleLowerCase('vi-VN') && w.floor.toLocaleLowerCase('vi-VN') === floorStr.toLocaleLowerCase('vi-VN'));
            const existingVolume = existingIdx >= 0 ? newWorkVolumes[existingIdx] : undefined;
            const recordId = existingVolume?.id || rawRecordIdStr || rawVolIdStr || createEntityId('HM');

            const volumeData: WorkVolume = {
              ...(existingVolume || {} as WorkVolume),
              id: recordId,
              workCategoryId: existingVolume?.workCategoryId || rawVolIdStr || recordId,
              title: titleStr,
              floor: floorStr,
              floorId: rawFloorId ? String(rawFloorId).trim() : (importedFloorIds?.[0] || existingVolume?.floorId),
              floorIds: importedFloorIds || existingVolume?.floorIds,
              category: categoryStr,
              unit: normalizeUnit(unitStr) || unitStr,
              planned: plannedNum,
              // actual/status are derived by App.handleImportWorkVolumes and never imported as master data.
              actual: existingVolume?.actual || 0,
              unitPrice: unitPriceNum,
              status: existingVolume?.status || 'Chưa thi công',
              dueDate: dueDate || existingVolume?.dueDate,
            };

            if (existingIdx >= 0) {
              newWorkVolumes[existingIdx] = volumeData;
              volumesUpdatedCount++;
            } else {
              newWorkVolumes.push(volumeData);
              volumesAddedCount++;
            }
          });
        }

        const totalItemsFound = inCount + outCount + normsUpdatedCount + normsAddedCount + volumesUpdatedCount + volumesAddedCount;

        if (totalItemsFound === 0) {
          alert(
            `⚠️ Không tìm thấy dữ liệu hợp lệ trong các trang Excel của bạn!\n\n` +
            `• Danh sách Sheet tìm thấy trong file: [${workbook.SheetNames.join(', ')}]\n` +
            `• Yêu cầu tên Sheet (không phân biệt hoa thường):\n` +
            `  - Nhập kho: chứa chữ 'nhap' hoặc 'nhập'\n` +
            `  - Xuất kho: chứa chữ 'xuat' hoặc 'xuất'\n` +
            `  - Định Mức Vật Tư: chứa chữ 'dinh muc' hoặc 'định mức'\n` +
            `  - Hạng Mục Thi Công: chứa chữ 'khoi luong', 'khối lượng', 'hang muc' hoặc 'hạng mục'\n\n` +
            `Vui lòng kiểm tra lại tên Sheet và đảm bảo có đúng tiêu đề cột dữ liệu.`
          );
          return;
        }

        // Summary message
        const confirmMsg = 
          `📊 Kết quả phân tích tệp Excel Kho & Vật Tư:\n\n` +
          `📥 NHẬP KHO: ${inCount} phiếu nhập\n` +
          `📤 XUẤT KHO: ${outCount} phiếu xuất\n` +
          `📋 ĐỊNH MỨC VẬT TƯ: ${normsUpdatedCount} cập nhật, ${normsAddedCount} mới\n` +
          `🏗️ HẠNG MỤC THI CÔNG: ${volumesUpdatedCount} cập nhật, ${volumesAddedCount} mới\n\n` +
          `Bạn có đồng ý áp dụng các thay đổi này vào hệ thống không?`;

        const confirmUpdate = await confirmAsync(confirmMsg);
        if (confirmUpdate) {
          if (onImportInventory && (inCount > 0 || outCount > 0)) {
            await onImportInventory(importedInventoryRows);
          }
          if (onImportNorms && (normsUpdatedCount > 0 || normsAddedCount > 0)) {
            onImportNorms(newNorms);
          }
          if (onImportWorkVolumes && workVolumes && (volumesUpdatedCount > 0 || volumesAddedCount > 0)) {
            onImportWorkVolumes(newWorkVolumes);
          }
          alert('🎉 Đã cập nhật thành công dữ liệu kho, nhập/xuất, định mức và hạng mục!');
        }
      } catch (err: any) {
        alert(`❌ Lỗi đọc hoặc xử lý tệp Excel: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Form state
  const [type, setType] = useState<TransactionType>('in');
  const [materialName, setMaterialName] = useState(materialNorms[0]?.materialName || '');
  const [customMaterial, setCustomMaterial] = useState('');
  const [materialPickerSearch, setMaterialPickerSearch] = useState('');
  const [unit, setUnit] = useState(materialNorms[0]?.unit || 'Tấm');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [quantityStr, setQuantityStr] = useState<string>('');
  const [location, setLocation] = useState('');
  const [handler, setHandler] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [quickAddMessage, setQuickAddMessage] = useState('');
  const materialSearchRef = useRef<HTMLInputElement>(null);

  const liveQuantityCalc = useMemo(() => {
    if (/[+\-*/xX×:÷]/.test(quantityStr)) {
      return evaluateMathExpression(quantityStr);
    }
    return null;
  }, [quantityStr]);

  const normalizeMaterialSearch = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi-VN')
    .trim();

  const normalizedMaterialPickerSearch = normalizeMaterialSearch(materialPickerSearch);
  const filteredMaterialNorms = useMemo(() => {
    if (!normalizedMaterialPickerSearch) return materialNorms;
    return materialNorms.filter((item) => {
      const haystack = [item.materialName, item.category, item.unit]
        .map(normalizeMaterialSearch)
        .join(' ');
      return haystack.includes(normalizedMaterialPickerSearch);
    });
  }, [materialNorms, normalizedMaterialPickerSearch]);


  // Delete confirmation state
  const [deletingInventoryTarget, setDeletingInventoryTarget] = useState<InventoryItem | null>(null);

  // Auto update material selection when materialNorms change
  React.useEffect(() => {
    if (materialNorms.length > 0) {
      const matched = materialNorms.find((m) => m.materialName === materialName);
      if (!matched) {
        setMaterialName(materialNorms[0].materialName);
        setUnit(materialNorms[0].unit);
      }
    }
  }, [materialNorms]);

  // Map material norms by ID or name for quick lookup
  const normMap = useMemo(() => {
    const map: Record<string, MaterialNorm> = {};
    materialNorms.forEach((n) => {
      if (n.materialId) map[n.materialId] = n;
      map[n.materialName.trim().toLowerCase()] = n;
    });
    return map;
  }, [materialNorms]);

  // Calculate stock balance per material using unified calculateStockSummary helper
  const stockSummaries = useMemo(() => {
    return calculateStockSummary(inventory, materialNorms);
  }, [inventory, materialNorms]);

  const stockBalance = useMemo(() => {
    const balances: Record<string, { materialId?: string; displayName: string; inQty: number; outQty: number; balance: number; unit: string; normQuantity: number }> = {};
    stockSummaries.forEach(s => {
      const data = {
        materialId: s.materialId,
        displayName: s.materialName,
        inQty: s.totalIn,
        outQty: s.totalOut,
        balance: s.currentStock,
        unit: s.unit,
        normQuantity: s.normQuantity
      };
      if (s.materialId) {
        balances[s.materialId] = data;
        balances[s.materialId.toLowerCase()] = data;
      }
      balances[s.materialName.trim().toLowerCase()] = data;
    });
    return balances;
  }, [stockSummaries]);

  // Calculate low stock warnings based on remaining demand (Nhu cầu còn lại = Quota - OutQty)
  const lowStockItems = useMemo(() => {
    const items: Array<{
      name: string;
      balance: number;
      quota?: number;
      remainingDemand?: number;
      deficit?: number;
      unit: string;
      status: 'out' | 'low';
    }> = [];

    stockSummaries.forEach((s) => {
      const quota = s.normQuantity;
      const name = s.materialName;
      
      if (quota && quota > 0) {
        const remainingDemand = Math.max(0, quota - s.totalOut);
        if (s.currentStock <= 0) {
          items.push({
            name,
            balance: s.currentStock,
            quota,
            remainingDemand,
            deficit: remainingDemand - s.currentStock,
            unit: s.unit,
            status: 'out',
          });
        } else if (s.currentStock < remainingDemand) {
          items.push({
            name,
            balance: s.currentStock,
            quota,
            remainingDemand,
            deficit: remainingDemand - s.currentStock,
            unit: s.unit,
            status: 'low',
          });
        }
      } else {
        // No quota defined
        if (s.currentStock <= 0) {
          items.push({
            name,
            balance: s.currentStock,
            unit: s.unit,
            status: 'out',
          });
        }
      }
    });

    return items;
  }, [stockSummaries]);

  // Calculate material quota import warnings (exceeded or near-complete)
  const quotaWarnings = useMemo(() => {
    const warnings: Array<{
      name: string;
      inQty: number;
      quota: number;
      unit: string;
      status: 'exceeded' | 'near-complete';
      percent: number;
    }> = [];

    stockSummaries.forEach((s) => {
      const quota = s.normQuantity;
      const name = s.materialName;
      
      if (quota && quota > 0) {
        const percent = Math.round((s.totalIn / quota) * 100);
        if (s.totalIn > quota) {
          warnings.push({
            name,
            inQty: s.totalIn,
            quota,
            unit: s.unit,
            status: 'exceeded',
            percent,
          });
        } else if (s.totalIn >= quota * 0.9) {
          warnings.push({
            name,
            inQty: s.totalIn,
            quota,
            unit: s.unit,
            status: 'near-complete',
            percent,
          });
        }
      }
    });

    return warnings;
  }, [stockSummaries]);

  // Live warning for the form
  const formQuotaWarning = useMemo(() => {
    if (type !== 'in' || !quantity) return null;
    const targetName = customMaterial.trim() || materialName.trim();
    if (!targetName) return null;

    const normalizedTargetUnit = normalizeUnit(unit) || unit;
    const matchedSummary = stockSummaries.find((summary) =>
      summary.materialName.trim().toLocaleLowerCase('vi-VN') === targetName.toLocaleLowerCase('vi-VN') &&
      (normalizeUnit(summary.unit) || summary.unit) === normalizedTargetUnit
    );
    const quota = Number(matchedSummary?.normQuantity || 0);
    if (!(quota > 0)) return null;

    const currentInQty = Number(matchedSummary?.totalIn || 0);
    const projectedInQty = currentInQty + Number(quantity);
    const percent = Math.round((projectedInQty / quota) * 100);

    if (projectedInQty > quota) {
      return {
        status: 'exceeded',
        text: `Cảnh báo: Tổng lượng nhập sau phiếu này sẽ đạt ${formatDecimal(projectedInQty)} ${unit} (vượt định mức ${formatDecimal(quota)} ${unit}). Vượt nhu cầu theo định mức: +${formatDecimal(projectedInQty - quota)} ${unit}!`,
        currentInQty,
        quota,
        projectedInQty,
        percent,
      };
    } else if (projectedInQty >= quota * 0.9) {
      return {
        status: 'near-complete',
        text: `Lưu ý: Tổng lượng nhập sau phiếu này sẽ đạt ${formatDecimal(projectedInQty)} ${unit} (${percent}% định mức ${formatDecimal(quota)} ${unit}). Đang gần đủ định mức, vui lòng kiểm tra kỹ nếu đây là đơn hàng cuối!`,
        currentInQty,
        quota,
        projectedInQty,
        percent,
      };
    }

    return null;
  }, [type, quantity, materialName, customMaterial, stockSummaries, unit]);

  const filteredInventory = useMemo(() => {
    const list = inventory.filter((item) => {
      const q = searchTerm.trim().toLocaleLowerCase('vi-VN');
      const matchesType = filterType === 'all' || item.type === filterType;
      const matchesSearch = !q ||
        item.materialName.toLocaleLowerCase('vi-VN').includes(q) ||
        item.location.toLocaleLowerCase('vi-VN').includes(q) ||
        item.handler.toLocaleLowerCase('vi-VN').includes(q) ||
        item.id.toLocaleLowerCase('vi-VN').includes(q);
      return matchesType && matchesSearch;
    });

    return list.sort((a, b) => {
      let result = 0;
      switch (inventorySortBy) {
        case 'material':
          result = naturalCompare(a.materialName, b.materialName);
          break;
        case 'location':
          result = naturalCompare(a.location, b.location);
          break;
        case 'handler':
          result = naturalCompare(a.handler, b.handler);
          break;
        case 'date':
        default:
          result = compareDateValues(a.date, b.date);
          break;
      }
      if (inventorySortOrder === 'desc') result = -result;
      if (result !== 0) return result;
      // Stable deterministic tie-breaker across PC/phone.
      return naturalCompare(a.id, b.id);
    });
  }, [inventory, filterType, searchTerm, inventorySortBy, inventorySortOrder]);

  const openCreateInventory = () => {
    if (!hasEditAccess) return;
    setEditingInventory(null);
    setType('in');
    setCustomMaterial('');
    setMaterialPickerSearch('');
    setQuantity('');
    setQuantityStr('');
    setLocation('');
    setHandler(String(defaultHandler || '').trim());
    setNotes('');
    setQuickAddMessage('');
    setDate(new Date().toISOString().split('T')[0]);
    setShowAddForm(true);
  };

  const openEditInventory = (item: InventoryItem) => {
    if (!hasEditAccess) return;
    setEditingInventory(item);
    setType(item.type);
    const matched = materialNorms.find((m) => item.materialId && (m.materialId === item.materialId || m.id === item.materialId))
      || materialNorms.find((m) => m.materialName === item.materialName && (normalizeUnit(m.unit) || m.unit) === (normalizeUnit(item.unit) || item.unit));
    setMaterialName(matched?.materialName || item.materialName);
    setCustomMaterial(matched ? '' : item.materialName);
    setMaterialPickerSearch('');
    setUnit(item.unit);
    setQuantity(item.quantity);
    setQuantityStr(String(item.quantity));
    setLocation(item.location || '');
    setHandler(item.handler || '');
    setDate(item.date || new Date().toISOString().split('T')[0]);
    setNotes(item.notes || '');
    setShowAddForm(true);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!hasEditAccess) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const keepOpen = !editingInventory && submitter?.value === 'continue';
    const finalMaterialName = customMaterial.trim() ? customMaterial.trim() : materialName;
    
    let finalQuantity = Number(quantity);
    const parsedQuantity = evaluateMathExpression(quantityStr);
    if (parsedQuantity !== null) {
      finalQuantity = parsedQuantity;
    }

    if (!finalMaterialName || !finalQuantity || finalQuantity <= 0) {
      alert('Vui lòng nhập tên vật tư và số lượng hợp lệ (> 0)!');
      return;
    }

    const normalizedFinalUnit = normalizeUnit(unit) || unit;
    const matchedStockSummary = stockSummaries.find((summary) =>
      summary.materialName.trim().toLocaleLowerCase('vi-VN') === finalMaterialName.trim().toLocaleLowerCase('vi-VN') &&
      (normalizeUnit(summary.unit) || summary.unit) === normalizedFinalUnit
    );

    if (type === 'out') {
      const currentStock = matchedStockSummary?.currentStock || 0;
      if (finalQuantity > currentStock) {
        const excess = finalQuantity - currentStock;
        if (FIREBASE_ONLY_RUNTIME) {
          // V6.3.0 Firebase-only: stock is transaction-ledger based. Never offer a
          // client-side override that could create a negative derived balance; the
          // Firestore transaction service enforces the same invariant server-side.
          window.alert(
            `Không thể xuất vượt tồn kho.\n` +
            `- Vật tư: ${finalMaterialName}\n` +
            `- Tồn kho hiện tại: ${formatDecimal(currentStock)} ${unit}\n` +
            `- Số lượng yêu cầu: ${formatDecimal(finalQuantity)} ${unit}\n` +
            `- Vượt tồn kho: ${formatDecimal(excess)} ${unit}`
          );
          return;
        }

        const confirmIssue = window.confirm(
          `⚠️ CẢNH BÁO XUẤT VƯỢT TỒN KHO:\n` +
          `- Vật tư: ${finalMaterialName}\n` +
          `- Tồn kho hiện tại: ${formatDecimal(currentStock)} ${unit}\n` +
          `- Số lượng bạn xuất: ${formatDecimal(finalQuantity)} ${unit}\n` +
          `- Vượt tồn kho: ${formatDecimal(excess)} ${unit}\n\n` +
          `Bạn có chắc chắn muốn tiếp tục tạo phiếu xuất kho này không?`
        );
        if (!confirmIssue) return;
      }
    }

    const exactNormMaterialIds = Array.from(new Set(materialNorms
      .filter((norm) => norm.materialName.trim().toLocaleLowerCase('vi-VN') === finalMaterialName.trim().toLocaleLowerCase('vi-VN')
        && (normalizeUnit(norm.unit) || norm.unit) === normalizedFinalUnit)
      .map(resolveNormMaterialId)
      .filter(Boolean) as string[]));
    const editingKeepsIdentity = Boolean(editingInventory
      && editingInventory.materialName.trim().toLocaleLowerCase('vi-VN') === finalMaterialName.trim().toLocaleLowerCase('vi-VN')
      && (normalizeUnit(editingInventory.unit) || editingInventory.unit) === normalizedFinalUnit);

    const payload = {
      type,
      materialId: exactNormMaterialIds.length === 1
        ? exactNormMaterialIds[0]
        : (exactNormMaterialIds.length === 0 && editingKeepsIdentity ? editingInventory?.materialId : undefined),
      materialName: finalMaterialName,
      unit: normalizedFinalUnit,
      quantity: finalQuantity,
      location,
      handler,
      date,
      notes,
    };

    try {
      if (editingInventory && onUpdateInventory) {
        await onUpdateInventory(editingInventory.id, payload);
      } else {
        await onAddInventory(payload);
      }

      if (keepOpen) {
        setEditingInventory(null);
        setCustomMaterial('');
        setMaterialPickerSearch('');
        setMaterialName('');
        setUnit(materialNorms[0]?.unit || 'Tấm');
        setQuantity('');
        setQuantityStr('');
        setQuickAddMessage(`Đã lưu ${finalMaterialName}. Chọn vật tư tiếp theo để nhập cùng phiên.`);
        requestAnimationFrame(() => materialSearchRef.current?.focus());
      } else {
        setShowAddForm(false);
        setEditingInventory(null);
        setCustomMaterial('');
        setMaterialPickerSearch('');
        setQuickAddMessage('');
        setNotes('');
        alert(editingInventory ? 'Đã cập nhật phiếu kho thành công!' : `Đã thêm phiếu ${type === 'in' ? 'NHẬP KHO' : 'XUẤT KHO'} thành công!`);
      }
    } catch (err: any) {
      alert(`Không thể ghi giao dịch kho: ${err?.message || String(err)}`);
    }
  };

  return (
    <div className="p-4 space-y-4 pb-24 w-full max-w-6xl mx-auto">
      {/* Title & Action Row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-blue-600" />
            {t('warehouse_title')}
          </h2>
          <p className="text-xs text-slate-500">{t('warehouse_subtitle')}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            onClick={onOpenNormModal}
            className="flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-2.5 py-2 rounded-xl text-xs font-bold active:scale-95 transition-all"
            title={hasNormManageAccess ? 'Cập nhật chủng loại vật tư, ĐVT, định mức' : 'Xem định mức vật tư (chỉ ADMIN được sửa)'}
          >
            <Sliders className="w-3.5 h-3.5 text-indigo-600" />
            <span>{hasNormManageAccess ? t('norms_button') : 'Xem định mức'}</span>
          </button>
          {hasEditAccess && (
            <button
              onClick={openCreateInventory}
              className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-xl text-xs font-bold shadow-md active:scale-95 transition-all"
            >
              <Plus className="w-4 h-4" />
              Tạo phiếu
            </button>
          )}
        </div>
      </div>

      {/* Excel Multi-Sheet Import / Export & Template Card */}
      <div
        onDragOver={hasImportAccess ? handleDragOverExcel : undefined}
        onDragLeave={hasImportAccess ? handleDragLeaveExcel : undefined}
        onDrop={hasImportAccess ? handleDropExcel : undefined}
        className={`bg-white border rounded-2xl p-3.5 space-y-2.5 transition-all shadow-3xs ${
          isDraggingExcel
            ? 'border-emerald-500 bg-emerald-50/50 scale-[1.01]'
            : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-xs text-slate-800">
                Tải Excel &amp; Nhập dữ liệu Xuất &amp; Nhập kho
              </h3>
              <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                Mẫu Excel gồm các trang: <strong>Nhập kho</strong>, <strong>Xuất kho</strong>, <strong>Định Mức Vật Tư</strong> (có cột Tên Hạng Mục Thi Công) &amp; <strong>Tồn Kho</strong>. Chỉnh sửa và tải lên để cập nhật hàng loạt.
              </p>
            </div>
          </div>
          <span className="text-[9px] font-extrabold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md uppercase shrink-0">
            4 TRANG
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => exportWarehouseUpdateTemplate(materialNorms, workVolumes || [], inventory)}
            className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold py-2 px-3 rounded-xl transition-all text-xs active:scale-95 cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Tải Excel để chỉnh sửa</span>
          </button>

          {hasImportAccess ? (
            <label className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-3 rounded-xl cursor-pointer transition-all shadow-3xs active:scale-95 text-xs text-center">
              <Upload className="w-4 h-4 text-white shrink-0" />
              <span>Nhập lại từ Excel</span>
              <input type="file" accept=".xlsx, .xls" onChange={handleFileChangeExcel} className="hidden" />
            </label>
          ) : (
            <div className="flex items-center justify-center gap-1.5 bg-slate-50 text-slate-400 border border-slate-200 font-bold py-2 px-3 rounded-xl text-xs text-center" title="Chỉ ADMIN được nhập dữ liệu hàng loạt">
              <Upload className="w-4 h-4 shrink-0" /><span>Chỉ ADMIN được nhập</span>
            </div>
          )}
        </div>
      </div>

      {/* Gợi ý vật tư tổng hợp */}
      <section className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 shadow-sm">
        <div className="flex flex-col gap-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setIsMaterialNeedExpanded((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setIsMaterialNeedExpanded((value) => !value);
              }
            }}
            className="flex cursor-pointer items-start justify-between gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
            aria-expanded={isMaterialNeedExpanded}
            aria-controls="material-need-details"
          >
            <div className="min-w-0">
              <h3 className="text-sm font-extrabold text-slate-900">Gợi ý vật tư tổng hợp</h3>
              <p className="text-[11px] leading-relaxed text-slate-600">
                {materialNeedFloorSummary} · {materialNeedRoomSummary} · {materialNeedWorkCategorySummary} · {materialNeedTeamSummary} · {materialNeedResult.lines.length} loại vật tư
              </p>
            </div>
            <span aria-hidden="true" className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-xl text-indigo-600 transition-all group-hover:bg-indigo-50">
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isMaterialNeedExpanded ? 'rotate-180' : ''}`} />
            </span>
          </div>

          <SettingsFeatureSheet
            open={isMaterialNeedExpanded}
            onClose={() => {
              setIsMaterialNeedExpanded(false);
              setShowMaterialFloorPicker(false);
              setShowMaterialRoomPicker(false);
              setShowMaterialTeamPicker(false);
              setShowMaterialWorkCategoryPicker(false);
            }}
            sheetKey="material-need-details"
            icon={PackageSearch}
            iconClassName="text-indigo-600"
            title="Gợi ý vật tư tổng hợp"
            description="Theo tầng · Theo căn · Theo hạng mục đã khai · Theo đội"
            bodyClassName="space-y-3"
          >
            <div id="material-need-details" className="flex min-w-0 flex-col gap-3">
              <p className="text-[11px] text-slate-600">
                Có thể chọn một hoặc nhiều tầng, căn, hạng mục thi công đã khai và đội. Không chọn nghĩa là Tất cả. Một Material Need Engine duy nhất tính từ dữ liệu gốc rồi mới lọc/tổng hợp để chống double-count.
              </p>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="relative">
                  <button type="button" onClick={() => setShowMaterialFloorPicker((value) => !value)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-left text-xs font-semibold">
                    <span className="truncate">{materialNeedFloorSummary}</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                  {showMaterialFloorPicker && (
                    <div className="mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs font-semibold hover:bg-slate-50">
                        <input type="checkbox" checked={materialNeedFloorIds.length === 0} onChange={() => setMaterialNeedFloorIds([])} /> Tất cả tầng
                      </label>
                      {materialNeedFloors.map((floor) => (
                        <label key={floor.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs hover:bg-slate-50">
                          <input type="checkbox" checked={materialNeedFloorIds.includes(floor.id)} onChange={() => toggleMaterialNeedFloor(floor.id)} /> {floor.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button type="button" onClick={() => setShowMaterialRoomPicker((value) => !value)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-left text-xs font-semibold">
                    <span className="truncate">{materialNeedRoomSummary}</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                  {showMaterialRoomPicker && (
                    <div className="mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs font-semibold hover:bg-slate-50">
                        <input type="checkbox" checked={materialNeedRoomIds.length === 0} onChange={() => setMaterialNeedRoomIds([])} /> Tất cả căn
                      </label>
                      {materialNeedRooms.map((room) => (
                        <label key={room.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs hover:bg-slate-50">
                          <input type="checkbox" checked={materialNeedRoomIds.includes(room.id)} onChange={() => toggleMaterialNeedRoom(room.id)} />
                          <span className="min-w-0"><span className="font-semibold">{room.name}</span>{room.floorName ? <span className="text-slate-500"> · {room.floorName}</span> : null}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button type="button" onClick={() => setShowMaterialWorkCategoryPicker((value) => !value)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-left text-xs font-semibold">
                    <span className="truncate">{materialNeedWorkCategorySummary}</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                  {showMaterialWorkCategoryPicker && (
                    <div className="mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs font-semibold hover:bg-slate-50">
                        <input type="checkbox" checked={materialNeedWorkCategoryIds.length === 0} onChange={() => setMaterialNeedWorkCategoryIds([])} /> Tất cả hạng mục đã khai
                      </label>
                      {materialNeedWorkCategories.map((item) => (
                        <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs hover:bg-slate-50">
                          <input type="checkbox" checked={materialNeedWorkCategoryIds.includes(item.id)} onChange={() => toggleMaterialNeedWorkCategory(item.id)} /> {item.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button type="button" onClick={() => setShowMaterialTeamPicker((value) => !value)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-left text-xs font-semibold">
                    <span className="truncate">{materialNeedTeamSummary}</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                  {showMaterialTeamPicker && (
                    <div className="mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs font-semibold hover:bg-slate-50">
                        <input type="checkbox" checked={materialNeedTeamIds.length === 0} onChange={() => setMaterialNeedTeamIds([])} /> Tất cả đội
                      </label>
                      {materialNeedTeams.map((team) => (
                        <label key={team.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs hover:bg-slate-50">
                          <input type="checkbox" checked={materialNeedTeamIds.includes(team.id)} onChange={() => toggleMaterialNeedTeam(team.id)} /> {team.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {(materialNeedFloorIds.length > 0 || materialNeedRoomIds.length > 0 || materialNeedTeamIds.length > 0 || materialNeedWorkCategoryIds.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {materialNeedFloorIds.map((id) => {
                    const floor = materialNeedFloors.find((item) => item.id === id);
                    return <button key={`floor-${id}`} type="button" onClick={() => toggleMaterialNeedFloor(id)} className="rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-bold text-indigo-700">{floor?.name || id} ×</button>;
                  })}
                  {materialNeedRoomIds.map((id) => {
                    const room = materialNeedRooms.find((item) => item.id === id);
                    return <button key={`room-${id}`} type="button" onClick={() => toggleMaterialNeedRoom(id)} className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-bold text-sky-700">{room?.name || id} ×</button>;
                  })}
                  {materialNeedWorkCategoryIds.map((id) => {
                    const item = materialNeedWorkCategories.find((category) => category.id === id);
                    return <button key={`work-category-${id}`} type="button" onClick={() => toggleMaterialNeedWorkCategory(id)} className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-bold text-violet-700">{item?.name || id} ×</button>;
                  })}
                  {materialNeedTeamIds.map((id) => {
                    const team = materialNeedTeams.find((item) => item.id === id);
                    return <button key={`team-${id}`} type="button" onClick={() => toggleMaterialNeedTeam(id)} className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700">{team?.name || id} ×</button>;
                  })}
                </div>
              )}

              <QuickSortBar<MaterialNeedSortKey>
                itemCount={materialNeedLines.length}
                options={[
                  { key: 'material', label: 'Vật tư', kind: 'alpha', defaultOrder: 'asc' },
                  { key: 'category', label: 'Nhóm vật tư', kind: 'alpha', defaultOrder: 'asc' },
                  { key: 'remaining', label: 'Còn cần', kind: 'number', defaultOrder: 'desc' },
                  { key: 'deficit', label: 'Thiếu', kind: 'number', defaultOrder: 'desc' },
                  { key: 'stock', label: 'Tồn kho', kind: 'number', defaultOrder: 'desc' },
                ]}
                activeKey={materialNeedSortBy}
                order={materialNeedSortOrder}
                onChange={(key, order) => { setMaterialNeedSortBy(key); setMaterialNeedSortOrder(order); }}
                onToggleOrder={() => setMaterialNeedSortOrder((order) => order === 'asc' ? 'desc' : 'asc')}
                onReset={() => { setMaterialNeedSortBy('default'); setMaterialNeedSortOrder('asc'); }}
                summary={`${materialNeedLines.length} loại vật tư`}
              />

              {materialNeedLines.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">Chưa có nhu cầu vật tư xác định cho phạm vi đã chọn.</div>
              ) : (
                <div className="max-h-[52vh] overflow-auto overscroll-contain rounded-xl border border-indigo-100 bg-white sm:max-h-[28rem]">
                  <table className="min-w-[720px] w-full text-[11px]">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Vật tư</th><th className="p-2 text-right">Tổng cần</th><th className="p-2 text-right">Đã xuất</th>{hasMaterialAllocationFilter && <th className="p-2 text-right">Chưa phân bổ</th>}<th className="p-2 text-right">Còn cần</th><th className="p-2 text-right">Tồn kho</th><th className="p-2 text-right">Thiếu</th></tr></thead>
                    <tbody>
                      {materialNeedLines.map((line) => (
                        <tr key={line.materialKey} className="border-t border-slate-100">
                          <td className="p-2"><div className="font-bold text-slate-800">{line.materialName}</div><div className="text-[10px] text-slate-500">{line.category} · {line.unit}</div></td>
                          <td className="p-2 text-right font-semibold">{formatDecimal(line.estimatedQty)}</td>
                          <td className="p-2 text-right text-emerald-700">{formatDecimal(line.alreadyIssued)}</td>
                          {hasMaterialAllocationFilter && <td className="p-2 text-right text-amber-700">{formatDecimal(line.unallocatedIssued)}</td>}
                          <td className="p-2 text-right font-bold text-indigo-700">{formatDecimal(line.remainingQty)}</td>
                          <td className="p-2 text-right">{formatDecimal(line.stockQty)}</td>
                          <td className={`p-2 text-right font-bold ${line.deficitQty > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{formatDecimal(line.deficitQty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {materialNeedResult.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
                  <div className="font-bold mb-1">Thiếu liên kết/định mức — hệ thống đang fail-closed:</div>
                  <ul className="list-disc pl-4 space-y-0.5">{materialNeedResult.warnings.slice(0, 8).map((w, idx) => <li key={`${w.code}-${idx}`}>{w.message}</li>)}</ul>
                </div>
              )}
            </div>
          </SettingsFeatureSheet>
        </div>
      </section>

      {lowStockItems.length > 0 && (
        <div className="bg-amber-50/75 border border-amber-200 rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center gap-1.5 text-amber-800">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 animate-pulse" />
            <span className="text-xs font-extrabold uppercase tracking-wider">
              🚨 Cảnh Báo Vật Tư Thiếu So Với Nhu Cầu ({lowStockItems.length})
            </span>
          </div>
          <p className="text-[11px] text-amber-700 leading-normal">
            Hệ thống phát hiện các vật tư dưới đây có tồn kho thấp hơn nhu cầu còn lại theo định mức. Vui lòng lên kế hoạch nhập bổ sung!
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1 pt-1">
            {lowStockItems.map((item, idx) => {
              const isOut = item.status === 'out';
              return (
                <div 
                  key={`${item.name}-${idx}`} 
                  className={`flex items-center justify-between p-2 rounded-xl text-xs font-medium border ${
                    isOut 
                      ? 'bg-rose-50 border-rose-100 text-rose-800' 
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <p className="font-bold truncate">{item.name}</p>
                    <p className="text-[10px] opacity-80">
                      Tồn thực tế: <strong className="font-extrabold">{formatDecimal(item.balance)}</strong> {item.unit}
                      {item.remainingDemand !== undefined ? ` / Nhu cầu còn lại: ${formatDecimal(item.remainingDemand)} ${item.unit}` : ''}
                    </p>
                  </div>
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md shrink-0 ml-1 ${
                    isOut 
                      ? 'bg-rose-100 text-rose-800 uppercase' 
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {isOut ? 'HẾT HÀNG' : `Thiếu: ${formatDecimal(item.deficit)} ${item.unit}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cảnh báo định mức nhập kho */}
      {quotaWarnings.length > 0 && (
        <div className="bg-indigo-50/75 border border-indigo-200 rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center gap-1.5 text-indigo-800">
            <AlertTriangle className="w-5 h-5 text-indigo-600 shrink-0" />
            <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-900">
              ⚠️ Cảnh báo định mức nhập kho ({quotaWarnings.length})
            </span>
          </div>
          <p className="text-[11px] text-indigo-700 leading-normal">
            Hệ thống phát hiện các vật tư đã nhập gần đủ hoặc vượt quá định mức (lố định mức) yêu cầu thiết kế. Vui lòng đối chiếu kỹ khi làm việc với nhà cung cấp hoặc đặt đơn cuối!
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1 pt-1">
            {quotaWarnings.map((item, idx) => {
              const isExceeded = item.status === 'exceeded';
              return (
                <div 
                  key={`${item.name}-${idx}`} 
                  className={`flex items-center justify-between p-2 rounded-xl text-xs font-medium border ${
                    isExceeded 
                      ? 'bg-rose-50 border-rose-200 text-rose-800' 
                      : 'bg-indigo-50 border-indigo-100 text-indigo-800'
                  }`}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <p className="font-bold truncate">{item.name}</p>
                    <p className="text-[10px] opacity-80">
                      Tổng đã nhập: <strong className="font-extrabold">{formatDecimal(item.inQty)}</strong> / Định mức: {formatDecimal(item.quota)} {item.unit}
                    </p>
                  </div>
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md shrink-0 ml-1 text-center ${
                    isExceeded 
                      ? 'bg-rose-100 text-rose-700 uppercase' 
                      : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    {isExceeded ? `LỐ ${item.percent - 100}%` : `${item.percent}%`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}


      {/* Stock Summary Balance Cards */}
      <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-bold text-slate-800">
              Bảng tổng tồn kho vs định mức
            </span>
          </div>
          <button
            onClick={onOpenNormModal}
            className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold underline"
          >
            Quản lý chủng loại &amp; ĐVT
          </button>
        </div>

        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {stockSummaries.map((item) => {
            const quota = item.normQuantity;
            const category = item.category;

            return (
              <div key={item.materialId || item.materialName} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 text-xs space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {category && (
                      <span className="inline-block px-1.5 py-0.2 bg-indigo-100 text-indigo-700 text-[9px] font-bold rounded uppercase mb-0.5">
                        {category}
                      </span>
                    )}
                    <p className="font-bold text-slate-800 truncate">{item.materialName}</p>
                    <p className="text-[10px] text-slate-500">
                      Nhập: <span className="text-emerald-600 font-bold">{formatDecimal(item.totalIn)}</span> | 
                      Xuất: <span className="text-amber-600 font-bold">{formatDecimal(item.totalOut)}</span> {item.unit}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-bold ${
                      item.currentStock <= 0 
                        ? 'bg-rose-100 text-rose-800' 
                        : item.currentStock <= 20 
                          ? 'bg-amber-100 text-amber-800' 
                          : 'bg-blue-100 text-blue-800'
                    }`}>
                      Tồn: {formatDecimal(item.currentStock)} {item.unit}
                    </span>
                    {quota > 0 && (
                      <p className="text-[10px] text-slate-500 mt-0.5 font-semibold">
                        Định mức: <strong className="text-indigo-600">{formatDecimal(quota)}</strong> {item.unit}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>


      {/* Filter and Search controls */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Tìm vật tư, vị trí kho, người giao..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white text-xs pl-9 pr-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 shadow-sm"
          />
        </div>

        <div className="flex items-center justify-between gap-1 text-xs">
          <div className="flex bg-slate-200 p-1 rounded-xl w-full">
            <button
              onClick={() => setFilterType('all')}
              className={`flex-1 py-1 rounded-lg text-center font-semibold transition-all ${
                filterType === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Tất cả ({inventory.length})
            </button>
            <button
              onClick={() => setFilterType('in')}
              className={`flex-1 py-1 rounded-lg text-center font-semibold transition-all ${
                filterType === 'in' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600'
              }`}
            >
              Nhập kho
            </button>
            <button
              onClick={() => setFilterType('out')}
              className={`flex-1 py-1 rounded-lg text-center font-semibold transition-all ${
                filterType === 'out' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-600'
              }`}
            >
              Xuất kho
            </button>
          </div>
        </div>

        <QuickSortBar
          itemCount={filteredInventory.length}
          options={[
            { key: 'date', label: 'Ngày', kind: 'date', defaultOrder: 'desc' },
            { key: 'material', label: 'Vật tư', kind: 'alpha' },
            { key: 'location', label: 'Vị trí / Tầng', kind: 'alpha' },
            { key: 'handler', label: 'Người thực hiện', kind: 'alpha' },
          ]}
          activeKey={inventorySortBy}
          order={inventorySortOrder}
          onChange={(key, order) => { setInventorySortBy(key); setInventorySortOrder(order); }}
          onToggleOrder={() => setInventorySortOrder((order) => order === 'asc' ? 'desc' : 'asc')}
          onReset={() => { setInventorySortBy('date'); setInventorySortOrder('desc'); }}
        />
      </div>

      {/* Transaction List */}
      <div className="space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
          <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
            Nhật ký nhập/xuất ({filteredInventory.length})
          </h3>
        </div>

        {hasDeleteAccess && filteredInventory.length > 0 && (
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs gap-2">
            <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filteredInventory.length > 0 && filteredInventory.every(item => selectedItemIds.includes(item.id))}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedItemIds(prev => Array.from(new Set([...prev, ...filteredInventory.map(item => item.id)])));
                  } else {
                    setSelectedItemIds(prev => prev.filter(id => !filteredInventory.some(item => item.id === id)));
                  }
                }}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
              <span>Chọn tất cả trên trang ({filteredInventory.length})</span>
            </label>

            <div className="flex items-center gap-3 justify-end">
              {hasDeleteAccess && selectedItemIds.some(id => filteredInventory.some(item => item.id === id)) && (
                <button
                  type="button"
                  onClick={async () => {
                    const idsToDelete = selectedItemIds.filter(id => filteredInventory.some(item => item.id === id));
                    if (await confirmAsync(`Bạn có chắc muốn xóa ${idsToDelete.length} phiếu kho đã chọn?`)) {
                      try {
                        if (onDeleteMultipleInventory) {
                          await onDeleteMultipleInventory(idsToDelete);
                        } else {
                          for (const id of idsToDelete) await onDeleteInventory(id);
                        }
                        setSelectedItemIds(prev => prev.filter(id => !idsToDelete.includes(id)));
                      } catch (err: any) {
                        alert(`Không thể xóa giao dịch kho: ${err?.message || String(err)}`);
                      }
                    }
                  }}
                  className="text-rose-600 hover:text-rose-700 font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Xóa đã chọn ({selectedItemIds.filter(id => filteredInventory.some(item => item.id === id)).length})
                </button>
              )}
            </div>
          </div>
        )}

        {filteredInventory.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 text-center text-slate-400 text-xs border border-dashed border-slate-300">
            Không tìm thấy lịch sử giao dịch kho phù hợp
          </div>
        ) : (
          filteredInventory.map((item) => (
            <div
              key={item.id}
              className={`bg-white rounded-2xl p-3.5 border transition-all duration-150 space-y-2 hover:border-slate-300 ${
                selectedItemIds.includes(item.id)
                  ? 'border-indigo-300 bg-indigo-50/10 shadow-xs'
                  : 'border-slate-200 shadow-sm'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {hasDeleteAccess && <input
                  type="checkbox"
                  checked={selectedItemIds.includes(item.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedItemIds(prev => [...prev, item.id]);
                    } else {
                      setSelectedItemIds(prev => prev.filter(id => id !== item.id));
                    }
                  }}
                  className="mt-1 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                />}

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`p-1.5 rounded-lg shrink-0 ${
                          item.type === 'in'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {item.type === 'in' ? (
                          <ArrowDownLeft className="w-4 h-4" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4" />
                        )}
                      </span>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 mr-1.5">
                          [{item.id}]
                        </span>
                        <span
                          className={`text-[10px] uppercase font-extrabold px-1.5 py-0.5 rounded ${
                            item.type === 'in'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {item.type === 'in' ? 'NHẬP KHO' : 'XUẤT KHO'}
                        </span>
                        <h4 className="text-xs font-bold text-slate-900 mt-0.5 leading-snug">
                          {item.materialName}
                        </h4>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-sm font-extrabold text-slate-900">
                        {item.type === 'in' ? '+' : '-'}{formatDecimal(item.quantity)}
                      </div>
                      <div className="text-[11px] text-slate-500 font-medium">{item.unit}</div>
                    </div>
                  </div>

                  {/* Details footer */}
                  <div className="grid grid-cols-2 gap-1 pt-2 border-t border-slate-100 text-[11px] text-slate-600 mt-2">
                    <div className="flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="truncate">{item.location}</span>
                    </div>
                    <div className="flex items-center gap-1 justify-end truncate">
                      <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                      <span>{formatDateDDMMYYYY(item.date)}</span>
                    </div>
                    <div className="flex items-center gap-1 truncate col-span-2 text-slate-500">
                      <User className="w-3 h-3 text-slate-400 shrink-0" />
                      <span>{item.handler}</span>
                      {item.notes && <span className="italic ml-1">({item.notes})</span>}
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-1">
                    {hasEditAccess && onUpdateInventory && (
                      <button
                        type="button"
                        onClick={() => openEditInventory(item)}
                        className="text-[11px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-semibold"
                      >
                        <Edit2 className="w-3 h-3" /> Chỉnh phiếu
                      </button>
                    )}
                    {hasDeleteAccess && (
                      <button
                        type="button"
                        onClick={() => setDeletingInventoryTarget(item)}
                        className="text-[11px] text-rose-500 hover:text-rose-700 flex items-center gap-1 font-semibold"
                      >
                        <Trash2 className="w-3 h-3" /> Xóa phiếu
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Delete Inventory Confirmation Modal */}
      {hasDeleteAccess && deletingInventoryTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full space-y-4 border border-slate-100 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Xác nhận xóa Phiếu Kho</h3>
              <p className="text-xs text-slate-500 mt-1">
                Bạn có chắc chắn muốn xóa phiếu <strong className="text-slate-800">[{deletingInventoryTarget.id}] - {deletingInventoryTarget.materialName} ({formatDecimal(deletingInventoryTarget.quantity)} {deletingInventoryTarget.unit})</strong> không?
              </p>
              <p className="text-[11px] text-indigo-600 mt-1 font-medium">💡 Thao tác này có thể Hoàn tác.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeletingInventoryTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await onDeleteInventory(deletingInventoryTarget.id);
                    setDeletingInventoryTarget(null);
                  } catch (err: any) {
                    alert(`Không thể xóa giao dịch kho: ${err?.message || String(err)}`);
                  }
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs shadow"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Form Modal */}
      {hasEditAccess && showAddForm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <PackageCheck className="w-5 h-5 text-blue-600" />
                {editingInventory ? 'Chỉnh Sửa Phiếu Kho' : 'Tạo phiếu Nhập / Xuất kho'}
              </h3>
              <button
                onClick={() => { setShowAddForm(false); setEditingInventory(null); }}
                className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center font-bold text-slate-500 hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              {/* Type Toggle */}
              <div>
                <label className="block text-slate-700 font-bold mb-1">Loại Phiếu</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setType('in')}
                    className={`py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all ${
                      type === 'in'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    <ArrowDownLeft className="w-4 h-4" /> NHẬP KHO
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('out')}
                    className={`py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all ${
                      type === 'out'
                        ? 'bg-amber-600 text-white shadow'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4" /> XUẤT KHO
                  </button>
                </div>
              </div>

              {/* Material Search + Select */}
              <div className="space-y-1.5">
                <label className="block text-slate-700 font-bold">Chọn vật tư</label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    ref={materialSearchRef}
                    type="search"
                    value={materialPickerSearch}
                    onChange={(e) => setMaterialPickerSearch(e.target.value)}
                    placeholder="Tìm theo tên, nhóm hoặc đơn vị..."
                    className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pl-9 pr-3 text-slate-800"
                    autoComplete="off"
                  />
                  {normalizedMaterialPickerSearch && filteredMaterialNorms.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-30 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                      {filteredMaterialNorms.slice(0, 20).map((m) => (
                        <button
                          type="button"
                          key={m.id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setMaterialName(m.materialName);
                            setUnit(m.unit);
                            setCustomMaterial('');
                            setMaterialPickerSearch('');
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-indigo-50 border-b border-slate-100 last:border-b-0"
                        >
                          <div className="text-xs font-bold text-slate-800">{m.materialName}</div>
                          <div className="text-[10px] text-slate-500">{m.category || 'Vật tư'} · {m.unit}</div>
                        </button>
                      ))}
                      {filteredMaterialNorms.length > 20 && (
                        <div className="px-3 py-2 text-[10px] text-slate-500 bg-slate-50">
                          Còn {filteredMaterialNorms.length - 20} kết quả. Nhập thêm ký tự để lọc nhanh hơn.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <select
                  value={materialName}
                  onChange={(e) => {
                    setMaterialName(e.target.value);
                    const matched = materialNorms.find((m) => m.materialName === e.target.value);
                    if (matched) {
                      setUnit(matched.unit);
                      setCustomMaterial('');
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800"
                >
                  <option value="">— Chọn vật tư —</option>
                  {filteredMaterialNorms.map((m) => (
                    <option key={m.id} value={m.materialName}>
                      [{m.category}] {m.materialName} ({m.unit})
                    </option>
                  ))}
                </select>
                {normalizedMaterialPickerSearch && filteredMaterialNorms.length === 0 && (
                  <p className="text-[10px] text-amber-700">Không tìm thấy vật tư phù hợp. Có thể nhập tên mới ở ô bên dưới.</p>
                )}
              </div>

              {/* Custom Material Option */}
              <div>
                <label className="block text-slate-500 font-medium mb-1">Hoặc Nhập Tên Vật Tư Khác</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Đèn âm trần 12W, Keo bọt nở..."
                  value={customMaterial}
                  onChange={(e) => setCustomMaterial(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl p-2.5"
                />
              </div>

              {/* Quantity & Unit */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-700 font-bold mb-1 flex items-center justify-between">
                    <span>Số Lượng *</span>
                    {liveQuantityCalc !== null && (
                      <span className="text-blue-600 bg-blue-50 px-1 py-0.5 rounded text-[9px] font-extrabold animate-pulse" title="Kết quả tính toán">
                        = {formatDecimal(liveQuantityCalc)}
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={quantityStr}
                    onChange={(e) => {
                      const typedVal = e.target.value;
                      setQuantityStr(typedVal);
                      const parsed = evaluateMathExpression(typedVal);
                      setQuantity(parsed !== null ? parsed : (typedVal === '' ? '' : Number(typedVal)));
                    }}
                    onBlur={() => {
                      const parsed = evaluateMathExpression(quantityStr);
                      if (parsed !== null) {
                        setQuantity(parsed);
                        setQuantityStr(formatDecimal(parsed));
                      }
                    }}
                    className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-slate-900 focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Đơn vị tính</label>
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2.5"
                    required
                  />
                </div>
              </div>

              {formQuotaWarning && (
                <div className={`p-2.5 rounded-xl border text-[11px] font-medium leading-relaxed ${
                  formQuotaWarning.status === 'exceeded'
                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : 'bg-indigo-50 border-indigo-200 text-indigo-800'
                }`}>
                  <div className="flex items-start gap-1">
                    <span className="shrink-0">{formQuotaWarning.status === 'exceeded' ? '🚨' : '💡'}</span>
                    <p>{formQuotaWarning.text}</p>
                  </div>
                </div>
              )}

              {/* Location & Handler */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Vị trí kho / tầng</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Ví dụ: Kho tầng trệt, Kho A..."
                    className="w-full border border-slate-200 rounded-xl p-2.5"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Người Giao / Nhận</label>
                  <input
                    type="text"
                    value={handler}
                    onChange={(e) => setHandler(e.target.value)}
                    placeholder={defaultHandler ? 'Lấy từ Kỹ sư phụ trách · có thể sửa' : 'Nhập người giao / nhận'}
                    className="w-full border border-slate-200 rounded-xl p-2.5"
                    required
                  />
                </div>
              </div>

              {/* Date & Notes */}
              <div>
                <label className="block text-slate-700 font-bold mb-1">Ngày Thực Hiện</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Ghi chú chi tiết</label>
                <textarea
                  placeholder="Ghi chú xuất cho tổ đội nào, hóa đơn đi kèm..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl p-2.5"
                />
              </div>

              {quickAddMessage && !editingInventory && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800">
                  {quickAddMessage}
                </div>
              )}

              {/* Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="py-3 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold text-slate-700"
                >
                  Hủy
                </button>
                {!editingInventory && (
                  <button
                    type="submit"
                    name="submitMode"
                    value="continue"
                    className="py-3 rounded-xl font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 active:scale-95 transition-all"
                  >
                    Lưu & thêm tiếp
                  </button>
                )}
                <button
                  type="submit"
                  name="submitMode"
                  value="close"
                  className={`py-3 rounded-xl font-bold text-white shadow-md active:scale-95 transition-all ${
                    type === 'in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  {editingInventory ? 'Lưu thay đổi' : 'Lưu & đóng'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
