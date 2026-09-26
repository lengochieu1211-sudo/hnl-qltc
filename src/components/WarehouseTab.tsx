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
import { InventoryItem, InventoryIssuePurpose, InventoryItemKind, TransactionType, MaterialNorm, WorkVolume, RoomProgressItem, TeamInfo, FloorPlan } from '../types';
import { formatDateDDMMYYYY, formatExcelDate } from '../utils/dateFormatter';
import { formatDecimal, evaluateMathExpression, useFormatSettings, parseVietnameseNumber, parseExcelNumber } from '../utils/numberUtils';
import * as XLSX from 'xlsx';
import { exportWarehouseUpdateTemplate } from '../utils/excelExport';
import { confirmAsync } from '../utils/confirmAsync';
import { calculateStockSummary, resolveNormMaterialId } from '../utils/inventoryUtils';
import { compareDateValues, naturalCompare } from '../utils/sortUtils';
import { createEntityId } from '../utils/idUtils';
import { normalizeUnit } from '../utils/unitUtils';
import { canonicalWorkCategoryId, normalizeLinkText } from '../utils/linkageIntegrity';
import { assertSafeExcelImportFile, parseExcelNumberRecord, parseExcelStringArray, sameStringSet } from '../utils/excelImportUtils';
import { QuickSortBar } from './QuickSortBar';
import { SettingsFeatureSheet } from './SettingsFeatureSheet';
import { ExcelActionMenu } from './ExcelActionMenu';
import { QuickEditGridModal, type QuickGridColumn, type QuickGridRow } from './QuickEditGridModal';
import { FIREBASE_ONLY_RUNTIME } from '../config/runtimeArchitecture';
import { computeMaterialNeeds } from '../utils/materialNeedEngine';
import { UserRole, canEditWarehouseData, canDeleteBusinessData, canImportData, canManageMaterialNorms } from '../utils/securityUtils';
import {
  normalizeStructureGroupConfig,
  resolveFloorStructureGroupId,
  type ProjectStructureConfig,
} from '../utils/structureGroupUtils';

type MaterialNeedSortKey = 'default' | 'material' | 'category' | 'unit' | 'remaining' | 'deficit' | 'stock';
type WarehouseCatalogSortKey = 'name' | 'category' | 'unit' | 'totalIn' | 'totalOut' | 'normQuantity' | 'currentStock';

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
  structureConfig: ProjectStructureConfig;
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
  structureConfig,
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
  const [itemKind, setItemKind] = useState<InventoryItemKind>('material');
  const [isNewEquipment, setIsNewEquipment] = useState(false);
  const [showWarehouseCatalog, setShowWarehouseCatalog] = useState(false);
  const [warehouseCatalogTab, setWarehouseCatalogTab] = useState<InventoryItemKind>('material');
  const [warehouseCatalogSearch, setWarehouseCatalogSearch] = useState('');
  const [warehouseCatalogSortBy, setWarehouseCatalogSortBy] = useState<WarehouseCatalogSortKey>('name');
  const [warehouseCatalogSortOrder, setWarehouseCatalogSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [showQuickEdit, setShowQuickEdit] = useState(false);
  const [quickEditMode, setQuickEditMode] = useState<'norms' | 'in' | 'out' | 'stock'>('norms');
  const normalizedStructureConfig = useMemo(() => normalizeStructureGroupConfig(structureConfig), [structureConfig]);
  const [materialNeedStructureGroupIds, setMaterialNeedStructureGroupIds] = useState<string[]>([]);
  const [materialNeedFloorIds, setMaterialNeedFloorIds] = useState<string[]>([]);
  const [materialNeedRoomIds, setMaterialNeedRoomIds] = useState<string[]>([]);
  const [materialNeedTeamIds, setMaterialNeedTeamIds] = useState<string[]>([]);
  const [materialNeedWorkCategoryIds, setMaterialNeedWorkCategoryIds] = useState<string[]>([]);
  const [materialNeedSearchTerm, setMaterialNeedSearchTerm] = useState('');
  const [materialNeedSortBy, setMaterialNeedSortBy] = useState<MaterialNeedSortKey>('default');
  const [materialNeedSortOrder, setMaterialNeedSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isMaterialNeedExpanded, setIsMaterialNeedExpanded] = useState(false);
  const [showMaterialStructureGroupPicker, setShowMaterialStructureGroupPicker] = useState(false);
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

  const materialNeedStructureGroups = useMemo(
    () => normalizedStructureConfig.enabled ? normalizedStructureConfig.groups : [],
    [normalizedStructureConfig],
  );

  const materialNeedGroupFloorIdSet = useMemo(() => {
    if (!normalizedStructureConfig.enabled || materialNeedStructureGroupIds.length === 0) return null;
    const selected = new Set(materialNeedStructureGroupIds);
    return new Set(
      floorPlans
        .filter((floor) => selected.has(resolveFloorStructureGroupId(floor, normalizedStructureConfig)))
        .map((floor) => floor.id),
    );
  }, [floorPlans, materialNeedStructureGroupIds, normalizedStructureConfig]);

  const materialNeedVisibleFloors = useMemo(
    () => materialNeedGroupFloorIdSet
      ? materialNeedFloors.filter((floor) => materialNeedGroupFloorIdSet.has(floor.id))
      : materialNeedFloors,
    [materialNeedFloors, materialNeedGroupFloorIdSet],
  );

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
    return Array.from(map.values())
      .filter((room) => !materialNeedGroupFloorIdSet || materialNeedGroupFloorIdSet.has(room.floorId))
      .sort((a, b) =>
        naturalCompare(a.floorName, b.floorName) || naturalCompare(a.name, b.name) || naturalCompare(a.id, b.id)
      );
  }, [materialNeedFloors, roomProgressList, materialNeedGroupFloorIdSet]);

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

  const materialNeedStructureGroupIdsKey = materialNeedStructureGroups.map((group) => group.id).sort().join('|');
  const materialNeedVisibleFloorIdsKey = materialNeedVisibleFloors.map((floor) => floor.id).sort().join('|');
  const materialNeedRoomIdsKey = materialNeedRooms.map((room) => room.id).sort().join('|');
  const materialNeedTeamIdsKey = materialNeedTeams.map((team) => team.id).sort().join('|');
  const materialNeedWorkCategoryIdsKey = materialNeedWorkCategories.map((item) => item.id).sort().join('|');

  useEffect(() => {
    const available = new Set(materialNeedStructureGroups.map((group) => group.id));
    setMaterialNeedStructureGroupIds((current) => current.filter((id) => available.has(id)));
  }, [materialNeedStructureGroupIdsKey]);

  useEffect(() => {
    const available = new Set(materialNeedVisibleFloors.map((floor) => floor.id));
    setMaterialNeedFloorIds((current) => current.filter((id) => available.has(id)));
  }, [materialNeedVisibleFloorIdsKey]);

  useEffect(() => {
    const available = new Set(materialNeedRooms.map((room) => room.id));
    setMaterialNeedRoomIds((current) => current.filter((id) => available.has(id)));
  }, [materialNeedRoomIdsKey]);

  useEffect(() => {
    const available = new Set(materialNeedTeams.map((team) => team.id));
    setMaterialNeedTeamIds((current) => current.filter((id) => available.has(id)));
  }, [materialNeedTeamIdsKey]);

  useEffect(() => {
    const available = new Set(materialNeedWorkCategories.map((item) => item.id));
    setMaterialNeedWorkCategoryIds((current) => current.filter((id) => available.has(id)));
  }, [materialNeedWorkCategoryIdsKey]);

  const effectiveMaterialNeedFloorIds = useMemo(() => {
    if (materialNeedFloorIds.length > 0) return materialNeedFloorIds;
    if (materialNeedGroupFloorIdSet) return Array.from(materialNeedGroupFloorIdSet);
    return [];
  }, [materialNeedFloorIds, materialNeedGroupFloorIdSet]);

  const materialNeedResult = useMemo(() => {
    // An explicitly selected Khu/Khối with zero linked floors is an empty scope,
    // never "all floors". This prevents a stale/deleted group from failing open.
    if (materialNeedGroupFloorIdSet && materialNeedGroupFloorIdSet.size === 0) {
      return { lines: [], warnings: [], failClosed: false };
    }
    return computeMaterialNeeds({
      rooms: roomProgressList,
      materialNorms,
      inventory,
      workVolumes: workVolumes || [],
      teams,
      scope: {
        floorIds: effectiveMaterialNeedFloorIds.length > 0 ? effectiveMaterialNeedFloorIds : undefined,
        roomIds: materialNeedRoomIds.length > 0 ? materialNeedRoomIds : undefined,
        teamIds: materialNeedTeamIds.length > 0 ? materialNeedTeamIds : undefined,
        workCategoryIds: materialNeedWorkCategoryIds.length > 0 ? materialNeedWorkCategoryIds : undefined,
      },
    });
  }, [roomProgressList, materialNorms, inventory, workVolumes, teams, materialNeedGroupFloorIdSet, effectiveMaterialNeedFloorIds, materialNeedRoomIds, materialNeedTeamIds, materialNeedWorkCategoryIds]);

  const materialNeedLines = useMemo(() => {
    const query = materialNeedSearchTerm.trim().toLocaleLowerCase('vi-VN');
    const lines = query
      ? materialNeedResult.lines.filter((line) => [line.materialName, line.category, line.unit, line.materialKey]
          .some((value) => String(value || '').toLocaleLowerCase('vi-VN').includes(query)))
      : materialNeedResult.lines;
    return [...lines].sort((a, b) => {
      let comparison = 0;
      switch (materialNeedSortBy) {
        case 'material':
          comparison = naturalCompare(a.materialName, b.materialName);
          break;
        case 'category':
          comparison = naturalCompare(a.category, b.category);
          break;
        case 'unit':
          comparison = naturalCompare(a.unit, b.unit);
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
  }, [materialNeedResult.lines, materialNeedSearchTerm, materialNeedSortBy, materialNeedSortOrder]);

  const toggleMaterialNeedStructureGroup = (id: string) => {
    setMaterialNeedStructureGroupIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
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
  const materialNeedStructureGroupSummary = !normalizedStructureConfig.enabled || materialNeedStructureGroupIds.length === 0
    ? `Tất cả ${normalizedStructureConfig.label}`
    : materialNeedStructureGroupIds.length === 1
      ? (materialNeedStructureGroups.find((item) => item.id === materialNeedStructureGroupIds[0])?.name || `1 ${normalizedStructureConfig.label}`)
      : `${materialNeedStructureGroupIds.length} ${normalizedStructureConfig.label}`;
  const materialNeedFloorSummary = materialNeedFloorIds.length === 0 ? (materialNeedGroupFloorIdSet ? `${materialNeedVisibleFloors.length} tầng trong phạm vi` : 'Tất cả tầng') : materialNeedFloorIds.length === 1 ? (materialNeedFloors.find((item) => item.id === materialNeedFloorIds[0])?.name || '1 tầng') : `${materialNeedFloorIds.length} tầng`;
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

        let newInventory = [...inventory];
        const importedInventoryRows: InventoryItem[] = [];
        let newNorms = [...materialNorms];

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
            const materialNameRaw = row['Tên Vật Tư / Thiết Bị'] || row['Tên Vật Tư'] || row['Tên Thiết Bị'] || row['Tên Vật Tư Thạch Cao'] || row['materialName'] || row['Vật tư'] || row['Thiết bị'] || row['Vat tu'];
            if (!materialNameRaw) return;

            const materialNameStr = String(materialNameRaw).trim();
            const rawItemKind = String(row['__itemKind'] || row['Loại Hàng'] || row['Loại hàng'] || row['itemKind'] || '').trim().toLocaleLowerCase('vi-VN');
            const importedItemKind: InventoryItemKind = rawItemKind.includes('thiết') || rawItemKind === 'equipment' ? 'equipment' : 'material';
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
            const rawIssuePurpose = row['__issuePurpose'] || row['Mục đích xuất'] || row['issuePurpose'];
            const rawSourceStructureGroupId = row['__sourceStructureGroupId'] || row['sourceStructureGroupId'];
            const rawSourceRoomId = row['__sourceRoomId'] || row['sourceRoomId'];
            const rawSourceFloorId = row['__sourceFloorId'] || row['sourceFloorId'];
            const rawSourceTeamId = row['__sourceTeamId'] || row['sourceTeamId'];
            const rawSourceWorkCategoryId = row['__sourceWorkCategoryId'] || row['sourceWorkCategoryId'];
            const rawSourceNormId = row['__sourceNormId'] || row['sourceNormId'];
            const rawSourceIssueKey = row['__sourceIssueKey'] || row['sourceIssueKey'];

            const existingIdx = rawId ? newInventory.findIndex(i => i.id === String(rawId).trim()) : -1;
            
            const existingItem = existingIdx >= 0 ? newInventory[existingIdx] : undefined;
            const preservesExistingIdentity = Boolean(existingItem
              && (existingItem.itemKind === 'equipment' ? 'equipment' : 'material') === importedItemKind
              && existingItem.materialName.trim().toLocaleLowerCase('vi-VN') === materialNameStr.toLocaleLowerCase('vi-VN')
              && (normalizeUnit(existingItem.unit) || existingItem.unit) === (normalizeUnit(unitStr) || unitStr));

            const invItem: InventoryItem = {
              id: existingIdx >= 0 ? newInventory[existingIdx].id : (rawId ? String(rawId).trim() : createEntityId('INV-IN')),
              type: 'in',
              itemKind: importedItemKind,
              materialId: importedItemKind === 'material' ? (rawMaterialId ? String(rawMaterialId).trim() : (preservesExistingIdentity ? existingItem?.materialId : undefined)) : undefined,
              materialName: materialNameStr,
              unit: unitStr,
              quantity: quantityNum,
              location: locationStr,
              handler: handlerStr,
              date: dateStr,
              notes: notesStr,
              sourceType: rawSourceType ? String(rawSourceType).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceType : undefined),
              issuePurpose: rawIssuePurpose
                ? (String(rawIssuePurpose).trim() === 'external-project' || String(rawIssuePurpose).trim().toLocaleLowerCase('vi-VN').includes('ngoài dự án')
                    ? 'external-project'
                    : String(rawIssuePurpose).trim() === 'other' || String(rawIssuePurpose).trim().toLocaleLowerCase('vi-VN').includes('khác')
                      ? 'other'
                      : 'project-work')
                : (existingIdx >= 0 ? newInventory[existingIdx].issuePurpose : undefined),
              sourceStructureGroupId: rawSourceStructureGroupId ? String(rawSourceStructureGroupId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceStructureGroupId : undefined),
              sourceRoomId: rawSourceRoomId ? String(rawSourceRoomId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceRoomId : undefined),
              sourceFloorId: rawSourceFloorId ? String(rawSourceFloorId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceFloorId : undefined),
              sourceTeamId: rawSourceTeamId ? String(rawSourceTeamId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceTeamId : undefined),
              sourceWorkCategoryId: importedItemKind === 'material' ? (rawSourceWorkCategoryId ? String(rawSourceWorkCategoryId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceWorkCategoryId : undefined)) : undefined,
              sourceNormId: importedItemKind === 'material' ? (rawSourceNormId ? String(rawSourceNormId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceNormId : undefined)) : undefined,
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
            const materialNameRaw = row['Tên Vật Tư / Thiết Bị'] || row['Tên Vật Tư'] || row['Tên Thiết Bị'] || row['Tên Vật Tư Thạch Cao'] || row['materialName'] || row['Vật tư'] || row['Thiết bị'] || row['Vat tu'];
            if (!materialNameRaw) return;

            const materialNameStr = String(materialNameRaw).trim();
            const rawItemKind = String(row['__itemKind'] || row['Loại Hàng'] || row['Loại hàng'] || row['itemKind'] || '').trim().toLocaleLowerCase('vi-VN');
            const importedItemKind: InventoryItemKind = rawItemKind.includes('thiết') || rawItemKind === 'equipment' ? 'equipment' : 'material';
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
            const rawIssuePurpose = row['__issuePurpose'] || row['Mục đích xuất'] || row['issuePurpose'];
            const rawSourceStructureGroupId = row['__sourceStructureGroupId'] || row['sourceStructureGroupId'];
            const rawSourceRoomId = row['__sourceRoomId'] || row['sourceRoomId'];
            const rawSourceFloorId = row['__sourceFloorId'] || row['sourceFloorId'];
            const rawSourceTeamId = row['__sourceTeamId'] || row['sourceTeamId'];
            const rawSourceWorkCategoryId = row['__sourceWorkCategoryId'] || row['sourceWorkCategoryId'];
            const rawSourceNormId = row['__sourceNormId'] || row['sourceNormId'];
            const rawSourceIssueKey = row['__sourceIssueKey'] || row['sourceIssueKey'];

            const existingIdx = rawId ? newInventory.findIndex(i => i.id === String(rawId).trim()) : -1;
            
            const existingItem = existingIdx >= 0 ? newInventory[existingIdx] : undefined;
            const preservesExistingIdentity = Boolean(existingItem
              && (existingItem.itemKind === 'equipment' ? 'equipment' : 'material') === importedItemKind
              && existingItem.materialName.trim().toLocaleLowerCase('vi-VN') === materialNameStr.toLocaleLowerCase('vi-VN')
              && (normalizeUnit(existingItem.unit) || existingItem.unit) === (normalizeUnit(unitStr) || unitStr));

            const invItem: InventoryItem = {
              id: existingIdx >= 0 ? newInventory[existingIdx].id : (rawId ? String(rawId).trim() : createEntityId('INV-OUT')),
              type: 'out',
              itemKind: importedItemKind,
              materialId: importedItemKind === 'material' ? (rawMaterialId ? String(rawMaterialId).trim() : (preservesExistingIdentity ? existingItem?.materialId : undefined)) : undefined,
              materialName: materialNameStr,
              unit: unitStr,
              quantity: quantityNum,
              location: locationStr,
              handler: handlerStr,
              date: dateStr,
              notes: notesStr,
              sourceType: rawSourceType ? String(rawSourceType).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceType : undefined),
              issuePurpose: rawIssuePurpose
                ? (String(rawIssuePurpose).trim() === 'external-project' || String(rawIssuePurpose).trim().toLocaleLowerCase('vi-VN').includes('ngoài dự án')
                    ? 'external-project'
                    : String(rawIssuePurpose).trim() === 'other' || String(rawIssuePurpose).trim().toLocaleLowerCase('vi-VN').includes('khác')
                      ? 'other'
                      : 'project-work')
                : (existingIdx >= 0 ? newInventory[existingIdx].issuePurpose : undefined),
              sourceStructureGroupId: rawSourceStructureGroupId ? String(rawSourceStructureGroupId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceStructureGroupId : undefined),
              sourceRoomId: rawSourceRoomId ? String(rawSourceRoomId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceRoomId : undefined),
              sourceFloorId: rawSourceFloorId ? String(rawSourceFloorId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceFloorId : undefined),
              sourceTeamId: rawSourceTeamId ? String(rawSourceTeamId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceTeamId : undefined),
              sourceWorkCategoryId: importedItemKind === 'material' ? (rawSourceWorkCategoryId ? String(rawSourceWorkCategoryId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceWorkCategoryId : undefined)) : undefined,
              sourceNormId: importedItemKind === 'material' ? (rawSourceNormId ? String(rawSourceNormId).trim() : (existingIdx >= 0 ? newInventory[existingIdx].sourceNormId : undefined)) : undefined,
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

        // Sheet "Hạng Mục Thi Công (Chỉ xem)" is intentionally reference-only.
        // Hạng mục/Khối lượng has one authoritative editing surface: WorkVolumeTab.
        // Do not mutate WorkVolume from Kho/Định mức Excel.

        const totalItemsFound = inCount + outCount + normsUpdatedCount + normsAddedCount;

        if (totalItemsFound === 0) {
          alert(
            `⚠️ Không tìm thấy dữ liệu hợp lệ trong các trang Excel của bạn!\n\n` +
            `• Danh sách Sheet tìm thấy trong file: [${workbook.SheetNames.join(', ')}]\n` +
            `• Yêu cầu tên Sheet (không phân biệt hoa thường):\n` +
            `  - Nhập kho: chứa chữ 'nhap' hoặc 'nhập'\n` +
            `  - Xuất kho: chứa chữ 'xuat' hoặc 'xuất'\n` +
            `  - Định Mức Vật Tư: chứa chữ 'dinh muc' hoặc 'định mức'\n` +
            `  - Hạng Mục Thi Công (Chỉ xem): bảng tham chiếu, không nhập ngược từ module Kho/Định mức\n\n` +
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
          `🏗️ HẠNG MỤC THI CÔNG: chỉ tham chiếu, không sửa từ file này\n\n` +
          `Bạn có đồng ý áp dụng các thay đổi này vào hệ thống không?`;

        const confirmUpdate = await confirmAsync(confirmMsg);
        if (confirmUpdate) {
          if (onImportInventory && (inCount > 0 || outCount > 0)) {
            await onImportInventory(importedInventoryRows);
          }
          if (onImportNorms && (normsUpdatedCount > 0 || normsAddedCount > 0)) {
            onImportNorms(newNorms);
          }
          alert('🎉 Đã cập nhật thành công dữ liệu kho/định mức. Hạng mục thi công chỉ được chỉnh tại mục Khối lượng.');
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
  const [issuePurpose, setIssuePurpose] = useState<InventoryIssuePurpose>('project-work');
  const [issueStructureGroupId, setIssueStructureGroupId] = useState('');
  const [issueFloorId, setIssueFloorId] = useState('');
  const [issueRoomId, setIssueRoomId] = useState('');
  const [issueTeamId, setIssueTeamId] = useState('');
  const [issueWorkCategoryId, setIssueWorkCategoryId] = useState('');
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

  // Warehouse catalog is intentionally derived from authoritative data instead of adding
  // another mutable collection. Materials come from norms; equipment becomes reusable after
  // its first real warehouse transaction. This keeps multi-user/offline stock as one ledger.
  const equipmentCatalog = useMemo(() => {
    const byKey = new Map<string, { name: string; unit: string; lastDate: string }>();
    inventory
      .filter((item) => item.itemKind === 'equipment')
      .forEach((item) => {
        const name = String(item.materialName || '').trim();
        const unitValue = normalizeUnit(item.unit) || String(item.unit || '').trim();
        if (!name || !unitValue) return;
        const key = `${normalizeMaterialSearch(name)}|${normalizeMaterialSearch(unitValue)}`;
        const existing = byKey.get(key);
        if (!existing || compareDateValues(existing.lastDate, item.date) < 0) {
          byKey.set(key, { name, unit: unitValue, lastDate: item.date || '' });
        }
      });
    return Array.from(byKey.values()).sort((a, b) =>
      compareDateValues(b.lastDate, a.lastDate) || naturalCompare(a.name, b.name),
    );
  }, [inventory]);

  const filteredEquipmentCatalog = useMemo(() => {
    if (!normalizedMaterialPickerSearch) return equipmentCatalog;
    return equipmentCatalog.filter((item) =>
      normalizeMaterialSearch(`${item.name} ${item.unit}`).includes(normalizedMaterialPickerSearch),
    );
  }, [equipmentCatalog, normalizedMaterialPickerSearch]);

  const warehouseCatalogRows = useMemo(() => {
    const q = normalizeMaterialSearch(warehouseCatalogSearch);
    if (warehouseCatalogTab === 'equipment') {
      return equipmentCatalog
        .filter((item) => !q || normalizeMaterialSearch(`${item.name} ${item.unit}`).includes(q))
        .map((item) => ({ key: `equipment:${item.name}:${item.unit}`, name: item.name, unit: item.unit, category: 'Thiết bị', hasNorm: false }));
    }
    const byKey = new Map<string, { key: string; name: string; unit: string; category: string; hasNorm: boolean }>();
    materialNorms.forEach((norm) => {
      const key = `${normalizeMaterialSearch(norm.materialName)}|${normalizeMaterialSearch(normalizeUnit(norm.unit) || norm.unit)}`;
      if (!byKey.has(key)) byKey.set(key, { key: `material:${key}`, name: norm.materialName, unit: normalizeUnit(norm.unit) || norm.unit, category: norm.category || 'Vật tư', hasNorm: true });
    });
    return Array.from(byKey.values())
      .filter((item) => !q || normalizeMaterialSearch(`${item.name} ${item.category} ${item.unit}`).includes(q))
      .sort((a, b) => naturalCompare(a.name, b.name));
  }, [warehouseCatalogTab, warehouseCatalogSearch, equipmentCatalog, materialNorms]);


  const issueFloorOptions = useMemo(() => {
    return floorPlans
      .filter((floor) => !issueStructureGroupId || resolveFloorStructureGroupId(floor, normalizedStructureConfig) === issueStructureGroupId)
      .slice()
      .sort((a, b) => naturalCompare(a.floorName, b.floorName));
  }, [floorPlans, issueStructureGroupId, normalizedStructureConfig]);

  const issueRoomOptions = useMemo(() => {
    return roomProgressList
      .filter((room) => !issueFloorId || room.floorId === issueFloorId)
      .filter((room) => {
        if (!issueStructureGroupId) return true;
        const floor = floorPlans.find((item) => item.id === room.floorId);
        return Boolean(floor && resolveFloorStructureGroupId(floor, normalizedStructureConfig) === issueStructureGroupId);
      })
      .slice()
      .sort((a, b) => naturalCompare(a.roomName, b.roomName));
  }, [roomProgressList, issueFloorId, issueStructureGroupId, floorPlans, normalizedStructureConfig]);

  const issueWorkCategoryOptions = useMemo(() => {
    const list = (workVolumes || []).filter((item) => item.deletedAt === undefined || item.deletedAt === null);
    if (!issueFloorId) return list.slice().sort((a, b) => naturalCompare(a.title, b.title));
    return list.filter((item) => {
      const ids = Array.isArray(item.floorIds) ? item.floorIds : [];
      return !item.floorId && ids.length === 0
        ? true
        : item.floorId === issueFloorId || ids.includes(issueFloorId);
    }).sort((a, b) => naturalCompare(a.title, b.title));
  }, [workVolumes, issueFloorId]);

  const activeIssueGroupIdsKey = normalizedStructureConfig.groups.map((group) => group.id).sort().join('|');
  const activeIssueTeamIdsKey = teams.filter((team) => team.deletedAt === undefined || team.deletedAt === null).map((team) => team.id).sort().join('|');
  const activeIssueWorkCategoryIdsKey = issueWorkCategoryOptions.map((item) => item.workCategoryId || item.id).sort().join('|');

  useEffect(() => {
    if (!showAddForm || issuePurpose !== 'project-work') return;
    const linkedRoom = issueRoomId ? roomProgressList.find((room) => room.id === issueRoomId && (room.deletedAt === undefined || room.deletedAt === null)) : undefined;
    if (issueRoomId && !linkedRoom) {
      setIssueRoomId('');
    }
    const authoritativeFloorId = linkedRoom?.floorId || issueFloorId;
    if (linkedRoom?.floorId && linkedRoom.floorId !== issueFloorId) {
      setIssueFloorId(linkedRoom.floorId);
      setIssueWorkCategoryId('');
    }
    if (!authoritativeFloorId) return;
    const floor = floorPlans.find((item) => item.id === authoritativeFloorId);
    if (!floor) {
      setIssueFloorId('');
      setIssueRoomId('');
      setIssueWorkCategoryId('');
      return;
    }
    if (normalizedStructureConfig.enabled) {
      const groupId = resolveFloorStructureGroupId(floor, normalizedStructureConfig);
      if (issueStructureGroupId !== groupId) setIssueStructureGroupId(groupId);
    }
  }, [showAddForm, issuePurpose, issueRoomId, issueFloorId, roomProgressList, floorPlans, normalizedStructureConfig, activeIssueGroupIdsKey]);

  useEffect(() => {
    if (!showAddForm || issuePurpose !== 'project-work' || !issueStructureGroupId) return;
    if (!normalizedStructureConfig.groups.some((group) => group.id === issueStructureGroupId)) {
      setIssueStructureGroupId('');
      setIssueFloorId('');
      setIssueRoomId('');
      setIssueWorkCategoryId('');
    }
  }, [showAddForm, issuePurpose, issueStructureGroupId, activeIssueGroupIdsKey]);

  useEffect(() => {
    if (!issueTeamId) return;
    const activeTeams = new Set(teams.filter((team) => team.deletedAt === undefined || team.deletedAt === null).map((team) => team.id));
    if (!activeTeams.has(issueTeamId)) setIssueTeamId('');
  }, [issueTeamId, activeIssueTeamIdsKey]);

  useEffect(() => {
    if (!issueWorkCategoryId) return;
    const available = new Set(issueWorkCategoryOptions.map((item) => item.workCategoryId || item.id));
    if (!available.has(issueWorkCategoryId)) setIssueWorkCategoryId('');
  }, [issueWorkCategoryId, activeIssueWorkCategoryIdsKey]);


  // Delete confirmation state
  const [deletingInventoryTarget, setDeletingInventoryTarget] = useState<InventoryItem | null>(null);

  // Auto update material selection when materialNorms change
  React.useEffect(() => {
    if (itemKind !== 'material') return;
    if (materialNorms.length > 0) {
      const matched = materialNorms.find((m) => m.materialName === materialName);
      if (!matched) {
        setMaterialName(materialNorms[0].materialName);
        setUnit(materialNorms[0].unit);
      }
    }
  }, [itemKind, materialNorms]);

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

  const warehouseCatalogStockRows = useMemo(() => {
    const rows = warehouseCatalogRows.map((item) => {
      const normalizedName = normalizeMaterialSearch(item.name);
      const normalizedUnit = normalizeMaterialSearch(normalizeUnit(item.unit) || item.unit);
      const expectedKind: InventoryItemKind = warehouseCatalogTab === 'equipment' ? 'equipment' : 'material';
      const summary = stockSummaries.find((stock) =>
        stock.itemKind === expectedKind &&
        normalizeMaterialSearch(stock.materialName) === normalizedName &&
        normalizeMaterialSearch(normalizeUnit(stock.unit) || stock.unit) === normalizedUnit
      );
      return {
        ...item,
        totalIn: Number(summary?.totalIn || 0),
        totalOut: Number(summary?.totalOut || 0),
        normQuantity: expectedKind === 'material' ? Number(summary?.normQuantity || 0) : null,
        currentStock: Number(summary?.currentStock || 0),
      };
    });

    const direction = warehouseCatalogSortOrder === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      if (warehouseCatalogSortBy === 'name') {
        return direction * naturalCompare(a.name, b.name);
      }
      if (warehouseCatalogSortBy === 'category') {
        return direction * (naturalCompare(a.category, b.category) || naturalCompare(a.name, b.name));
      }
      if (warehouseCatalogSortBy === 'unit') {
        return direction * (naturalCompare(a.unit, b.unit) || naturalCompare(a.name, b.name));
      }
      const aValue = Number(a[warehouseCatalogSortBy] ?? 0);
      const bValue = Number(b[warehouseCatalogSortBy] ?? 0);
      if (aValue !== bValue) return direction * (aValue - bValue);
      return naturalCompare(a.name, b.name);
    });
  }, [warehouseCatalogRows, warehouseCatalogTab, warehouseCatalogSortBy, warehouseCatalogSortOrder, stockSummaries]);

  const stockBalance = useMemo(() => {
    const balances: Record<string, { materialId?: string; displayName: string; inQty: number; outQty: number; balance: number; unit: string; normQuantity: number }> = {};
    stockSummaries.forEach(s => {
      if (s.itemKind === 'equipment') return;
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
      if (s.itemKind === 'equipment') return;
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
    if (itemKind !== 'material' || type !== 'in' || !quantity) return null;
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
  }, [itemKind, type, quantity, materialName, customMaterial, stockSummaries, unit]);

  const filteredInventory = useMemo(() => {
    const list = inventory.filter((item) => {
      const q = searchTerm.trim().toLocaleLowerCase('vi-VN');
      const matchesType = filterType === 'all' || item.type === filterType;
      const matchesSearch = !q ||
        (item.itemKind === 'equipment' ? 'thiết bị' : 'vật tư').includes(q) ||
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

  const openCreateInventory = (kind: InventoryItemKind = 'material') => {
    if (!hasEditAccess) return;
    setEditingInventory(null);
    setItemKind(kind);
    setType('in');
    setCustomMaterial('');
    setIsNewEquipment(kind === 'equipment' && equipmentCatalog.length === 0);
    setMaterialPickerSearch('');
    if (kind === 'equipment') {
      setMaterialName(equipmentCatalog[0]?.name || '');
      setUnit(equipmentCatalog[0]?.unit || 'Cái');
    } else {
      setMaterialName(materialNorms[0]?.materialName || '');
      setUnit(materialNorms[0]?.unit || 'Tấm');
    }
    setQuantity('');
    setQuantityStr('');
    setLocation('');
    setHandler(String(defaultHandler || '').trim());
    setNotes('');
    setIssuePurpose('project-work');
    setIssueStructureGroupId('');
    setIssueFloorId('');
    setIssueRoomId('');
    setIssueTeamId('');
    setIssueWorkCategoryId('');
    setQuickAddMessage('');
    setDate(new Date().toISOString().split('T')[0]);
    setShowAddForm(true);
  };

  const openEditInventory = (item: InventoryItem) => {
    if (!hasEditAccess) return;
    setEditingInventory(item);
    const editingKind: InventoryItemKind = item.itemKind === 'equipment' ? 'equipment' : 'material';
    setItemKind(editingKind);
    setIsNewEquipment(false);
    setType(item.type);
    const matched = editingKind === 'material'
      ? (materialNorms.find((m) => item.materialId && (m.materialId === item.materialId || m.id === item.materialId))
        || materialNorms.find((m) => m.materialName === item.materialName && (normalizeUnit(m.unit) || m.unit) === (normalizeUnit(item.unit) || item.unit)))
      : undefined;
    setMaterialName(matched?.materialName || item.materialName);
    setCustomMaterial(editingKind === 'material' && !matched ? item.materialName : '');
    setMaterialPickerSearch('');
    setUnit(item.unit);
    setQuantity(item.quantity);
    setQuantityStr(String(item.quantity));
    setLocation(item.location || '');
    setHandler(item.handler || '');
    setDate(item.date || new Date().toISOString().split('T')[0]);
    setNotes(item.notes || '');
    setIssuePurpose(item.issuePurpose || (item.sourceRoomId || item.sourceFloorId || item.sourceTeamId || item.sourceWorkCategoryId || item.sourceStructureGroupId ? 'project-work' : 'other'));
    const linkedRoom = item.sourceRoomId
      ? roomProgressList.find((room) => room.id === item.sourceRoomId && (room.deletedAt === undefined || room.deletedAt === null))
      : undefined;
    const resolvedIssueFloorId = linkedRoom?.floorId || item.sourceFloorId || '';
    const resolvedIssueFloor = resolvedIssueFloorId ? floorPlans.find((fp) => fp.id === resolvedIssueFloorId) : undefined;
    const resolvedIssueStructureGroupId = resolvedIssueFloor && normalizedStructureConfig.enabled
      ? resolveFloorStructureGroupId(resolvedIssueFloor, normalizedStructureConfig)
      : (normalizedStructureConfig.groups.some((group) => group.id === item.sourceStructureGroupId) ? String(item.sourceStructureGroupId || '') : '');
    setIssueStructureGroupId(resolvedIssueStructureGroupId);
    setIssueFloorId(resolvedIssueFloor ? resolvedIssueFloorId : '');
    setIssueRoomId(linkedRoom ? linkedRoom.id : '');
    setIssueTeamId(teams.some((team) => team.id === item.sourceTeamId && (team.deletedAt === undefined || team.deletedAt === null)) ? String(item.sourceTeamId) : '');
    setIssueWorkCategoryId(item.sourceWorkCategoryId || '');
    setShowAddForm(true);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!hasEditAccess) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const keepOpen = !editingInventory && submitter?.value === 'continue';
    const finalMaterialName = itemKind === 'equipment'
      ? (isNewEquipment ? customMaterial.trim() : materialName.trim())
      : (customMaterial.trim() ? customMaterial.trim() : materialName.trim());
    
    let finalQuantity = Number(quantity);
    const parsedQuantity = evaluateMathExpression(quantityStr);
    if (parsedQuantity !== null) {
      finalQuantity = parsedQuantity;
    }

    if (!finalMaterialName || !finalQuantity || finalQuantity <= 0) {
      alert(`Vui lòng nhập tên ${itemKind === 'equipment' ? 'thiết bị' : 'vật tư'} và số lượng hợp lệ (> 0)!`);
      return;
    }

    const normalizedFinalUnit = normalizeUnit(unit) || unit;
    const matchedStockSummary = stockSummaries.find((summary) =>
      summary.itemKind === itemKind &&
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
            `- ${itemKind === 'equipment' ? 'Thiết bị' : 'Vật tư'}: ${finalMaterialName}\n` +
            `- Tồn kho hiện tại: ${formatDecimal(currentStock)} ${unit}\n` +
            `- Số lượng yêu cầu: ${formatDecimal(finalQuantity)} ${unit}\n` +
            `- Vượt tồn kho: ${formatDecimal(excess)} ${unit}`
          );
          return;
        }

        const confirmIssue = window.confirm(
          `⚠️ CẢNH BÁO XUẤT VƯỢT TỒN KHO:\n` +
          `- ${itemKind === 'equipment' ? 'Thiết bị' : 'Vật tư'}: ${finalMaterialName}\n` +
          `- Tồn kho hiện tại: ${formatDecimal(currentStock)} ${unit}\n` +
          `- Số lượng bạn xuất: ${formatDecimal(finalQuantity)} ${unit}\n` +
          `- Vượt tồn kho: ${formatDecimal(excess)} ${unit}\n\n` +
          `Bạn có chắc chắn muốn tiếp tục tạo phiếu xuất kho này không?`
        );
        if (!confirmIssue) return;
      }
    }

    const exactNormMaterialIds = itemKind === 'material' ? Array.from(new Set(materialNorms
      .filter((norm) => norm.materialName.trim().toLocaleLowerCase('vi-VN') === finalMaterialName.trim().toLocaleLowerCase('vi-VN')
        && (normalizeUnit(norm.unit) || norm.unit) === normalizedFinalUnit)
      .map(resolveNormMaterialId)
      .filter(Boolean) as string[])) : [];
    const editingKeepsIdentity = Boolean(itemKind === 'material' && editingInventory
      && editingInventory.itemKind !== 'equipment'
      && editingInventory.materialName.trim().toLocaleLowerCase('vi-VN') === finalMaterialName.trim().toLocaleLowerCase('vi-VN')
      && (normalizeUnit(editingInventory.unit) || editingInventory.unit) === normalizedFinalUnit);

    const linkedIssueRoom = issueRoomId
      ? roomProgressList.find((room) => room.id === issueRoomId && (room.deletedAt === undefined || room.deletedAt === null))
      : undefined;
    const finalIssueFloorId = linkedIssueRoom?.floorId || issueFloorId;
    const finalIssueFloor = finalIssueFloorId ? floorPlans.find((floor) => floor.id === finalIssueFloorId) : undefined;
    const finalIssueStructureGroupId = finalIssueFloor && normalizedStructureConfig.enabled
      ? resolveFloorStructureGroupId(finalIssueFloor, normalizedStructureConfig)
      : (normalizedStructureConfig.groups.some((group) => group.id === issueStructureGroupId) ? issueStructureGroupId : '');
    const finalIssueTeamId = teams.some((team) => team.id === issueTeamId && (team.deletedAt === undefined || team.deletedAt === null))
      ? issueTeamId
      : '';
    const finalIssueWorkCategoryId = issueWorkCategoryOptions.some((item) => (item.workCategoryId || item.id) === issueWorkCategoryId)
      ? issueWorkCategoryId
      : '';

    const payload = {
      type,
      itemKind,
      materialId: exactNormMaterialIds.length === 1
        ? exactNormMaterialIds[0]
        : (exactNormMaterialIds.length === 0 && editingKeepsIdentity ? editingInventory?.materialId : undefined),
      materialName: finalMaterialName,
      unit: normalizedFinalUnit,
      quantity: finalQuantity,
      location: location.trim(),
      handler: handler.trim(),
      date,
      notes,
      ...(type === 'out' ? {
        issuePurpose,
        sourceType: 'manual',
        ...(issuePurpose === 'project-work' && finalIssueStructureGroupId ? { sourceStructureGroupId: finalIssueStructureGroupId } : {}),
        ...(issuePurpose === 'project-work' && finalIssueFloor ? { sourceFloorId: finalIssueFloor.id } : {}),
        ...(issuePurpose === 'project-work' && linkedIssueRoom ? { sourceRoomId: linkedIssueRoom.id } : {}),
        ...(issuePurpose === 'project-work' && finalIssueTeamId ? { sourceTeamId: finalIssueTeamId } : {}),
        ...(itemKind === 'material' && issuePurpose === 'project-work' && finalIssueWorkCategoryId ? { sourceWorkCategoryId: finalIssueWorkCategoryId } : {}),
      } : {}),
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
        setUnit(itemKind === 'equipment' ? 'Cái' : (materialNorms[0]?.unit || 'Tấm'));
        setQuantity('');
        setQuantityStr('');
        setIsNewEquipment(false);
        setQuickAddMessage(`Đã lưu ${finalMaterialName}. Chọn ${itemKind === 'equipment' ? 'thiết bị' : 'vật tư'} tiếp theo để nhập cùng phiên.`);
        requestAnimationFrame(() => materialSearchRef.current?.focus());
      } else {
        setShowAddForm(false);
        setEditingInventory(null);
        setCustomMaterial('');
        setMaterialPickerSearch('');
        setQuickAddMessage('');
        setNotes('');
        alert(editingInventory ? 'Đã cập nhật phiếu kho thành công!' : `Đã thêm phiếu ${type === 'in' ? 'nhập kho' : 'xuất kho'} thành công!`);
      }
    } catch (err: any) {
      alert(`Không thể ghi giao dịch kho: ${err?.message || String(err)}`);
    }
  };

  const warehouseQuickNormRows = useMemo<QuickGridRow[]>(() => materialNorms.map((norm) => ({
    __rowKey: norm.id,
    __normId: norm.id,
    materialName: norm.materialName,
    category: norm.category,
    unit: norm.unit,
    workCategories: (norm.workCategories?.length ? norm.workCategories : (norm.workCategory ? [norm.workCategory] : [])).join('; '),
    unitNorm: norm.unitNormPerM2 ?? '',
    quotaQuantity: norm.quotaQuantity ?? 0,
    notes: norm.notes || '',
  })), [materialNorms]);

  const warehouseQuickInventoryRows = useMemo<QuickGridRow[]>(() => inventory.map((item) => {
    const floor = item.sourceFloorId ? floorPlans.find((entry) => entry.id === item.sourceFloorId) : undefined;
    const room = item.sourceRoomId ? roomProgressList.find((entry) => entry.id === item.sourceRoomId) : undefined;
    const team = item.sourceTeamId ? teams.find((entry) => entry.id === item.sourceTeamId) : undefined;
    const work = item.sourceWorkCategoryId ? (workVolumes || []).find((entry) => (entry.workCategoryId || entry.id) === item.sourceWorkCategoryId || entry.id === item.sourceWorkCategoryId) : undefined;
    const groupId = item.sourceStructureGroupId || (floor ? resolveFloorStructureGroupId(floor, normalizedStructureConfig) : '');
    return {
      __rowKey: item.id,
      __recordId: item.id,
      __type: item.type,
      date: item.date,
      materialName: item.materialName,
      unit: item.unit,
      quantity: item.quantity,
      category: materialNorms.find((norm) => resolveNormMaterialId(norm) === item.materialId || (norm.materialName === item.materialName && norm.unit === item.unit))?.category || '',
      structureGroup: groupId ? normalizedStructureConfig.groups.find((group) => group.id === groupId)?.name || '' : '',
      floorName: floor?.floorName || '',
      roomName: room?.roomName || '',
      teamName: team?.name || '',
      workCategory: work?.title || '',
      location: item.location || '',
      handler: item.handler || '',
      notes: item.notes || '',
    };
  }), [inventory, floorPlans, roomProgressList, teams, workVolumes, materialNorms, normalizedStructureConfig]);

  const warehouseQuickStockRows = useMemo<QuickGridRow[]>(() => stockSummaries.map((item, index) => ({
    __rowKey: `stock-${item.materialId || item.materialName}-${index}`,
    materialName: item.materialName,
    category: item.category,
    unit: item.unit,
    totalIn: item.totalIn,
    totalOut: item.totalOut,
    currentStock: item.currentStock,
    normQuantity: item.normQuantity,
    remainingNeed: item.remainingNeed,
  })), [stockSummaries]);

  const warehouseMaterialOptions = useMemo(() => Array.from(new Set([
    ...materialNorms.map((norm) => norm.materialName),
    ...inventory.map((item) => item.materialName),
  ].filter(Boolean))), [materialNorms, inventory]);
  const warehouseFloorOptions = useMemo(() => floorPlans.map((floor) => floor.floorName), [floorPlans]);
  const warehouseTeamOptions = useMemo(() => teams.map((team) => team.name), [teams]);
  const warehouseWorkOptions = useMemo(() => (workVolumes || []).map((work) => work.title), [workVolumes]);
  const warehouseRoomOptions = useMemo(() => roomProgressList.map((room) => room.roomName), [roomProgressList]);

  const warehouseQuickColumns = useMemo<QuickGridColumn[]>(() => {
    if (quickEditMode === 'norms') return [
      { key: 'materialName', label: 'Tên vật tư', editable: hasNormManageAccess, required: true, width: 220 },
      { key: 'category', label: 'Nhóm', editable: hasNormManageAccess, required: true, width: 150 },
      { key: 'unit', label: 'ĐVT', editable: hasNormManageAccess, required: true, width: 90 },
      { key: 'workCategories', label: 'Liên kết hạng mục thi công', editable: hasNormManageAccess, width: 260 },
      { key: 'unitNorm', label: 'Định mức / ĐVT', editable: hasNormManageAccess, type: 'number', width: 130, validate: (value) => Number(value || 0) < 0 ? 'Không được âm' : null },
      { key: 'quotaQuantity', label: 'Khối lượng định mức', editable: hasNormManageAccess, type: 'number', width: 150, validate: (value) => Number(value || 0) < 0 ? 'Không được âm' : null },
      { key: 'notes', label: 'Ghi chú / Tiêu chuẩn kỹ thuật', editable: hasNormManageAccess, width: 300 },
    ];
    if (quickEditMode === 'stock') return [
      { key: 'materialName', label: 'Tên vật tư', editable: false, width: 220 },
      { key: 'category', label: 'Nhóm', editable: false, width: 150 },
      { key: 'unit', label: 'ĐVT', editable: false, width: 90 },
      { key: 'totalIn', label: 'Tổng nhập', editable: false, type: 'number', width: 110 },
      { key: 'totalOut', label: 'Tổng xuất', editable: false, type: 'number', width: 110 },
      { key: 'currentStock', label: 'Tồn kho', editable: false, type: 'number', width: 110 },
      { key: 'normQuantity', label: 'Nhu cầu định mức', editable: false, type: 'number', width: 135 },
      { key: 'remainingNeed', label: 'Còn cần', editable: false, type: 'number', width: 110 },
    ];
    const base: QuickGridColumn[] = [
      { key: 'date', label: 'Ngày', editable: hasImportAccess, type: 'date', required: true, width: 135 },
      { key: 'materialName', label: 'Tên vật tư', editable: hasImportAccess, type: 'select', options: warehouseMaterialOptions, required: true, width: 220 },
      { key: 'unit', label: 'ĐVT', editable: hasImportAccess, required: true, width: 90 },
      { key: 'quantity', label: 'Số lượng', editable: hasImportAccess, type: 'number', required: true, width: 110, validate: (value) => Number(value) <= 0 ? 'Phải lớn hơn 0' : null },
    ];
    if (quickEditMode === 'out') {
      base.push(
        { key: 'structureGroup', label: normalizedStructureConfig.label || 'Khu/Khối', editable: hasImportAccess, type: 'select', options: normalizedStructureConfig.groups.map((group) => group.name), width: 150 },
        { key: 'floorName', label: 'Tầng', editable: hasImportAccess, type: 'select', options: warehouseFloorOptions, width: 150 },
        { key: 'roomName', label: 'Căn / Phòng', editable: hasImportAccess, type: 'select', options: warehouseRoomOptions, width: 170 },
        { key: 'teamName', label: 'Đội thi công', editable: hasImportAccess, type: 'select', options: warehouseTeamOptions, width: 180 },
        { key: 'workCategory', label: 'Hạng mục thi công', editable: hasImportAccess, type: 'select', options: warehouseWorkOptions, width: 230 },
      );
    } else {
      base.push({ key: 'location', label: 'Vị trí kho', editable: hasImportAccess, width: 170 });
    }
    base.push(
      { key: 'handler', label: 'Người thực hiện', editable: hasImportAccess, width: 170 },
      { key: 'notes', label: 'Ghi chú', editable: hasImportAccess, width: 260 },
    );
    return base;
  }, [quickEditMode, hasNormManageAccess, hasImportAccess, warehouseMaterialOptions, warehouseFloorOptions, warehouseRoomOptions, warehouseTeamOptions, warehouseWorkOptions, normalizedStructureConfig]);

  const warehouseActiveQuickRows = quickEditMode === 'norms'
    ? warehouseQuickNormRows
    : quickEditMode === 'stock'
      ? warehouseQuickStockRows
      : warehouseQuickInventoryRows.filter((row) => row.__type === quickEditMode);

  const saveWarehouseQuickRows = async (rows: QuickGridRow[], dirtyCellKeys: Set<string>) => {
    if (quickEditMode === 'stock') return;
    const dirtyRowKeys = new Set(Array.from(dirtyCellKeys).map((key) => key.split('::')[0]));
    const dirtyRows = rows.filter((row) => dirtyRowKeys.has(row.__rowKey));
    if (!dirtyRows.length) return;

    if (quickEditMode === 'norms') {
      if (!hasNormManageAccess || !onImportNorms) return;
      const byId = new Map(materialNorms.map((norm) => [norm.id, norm] as const));
      dirtyRows.forEach((row) => {
        const existing = byId.get(String(row.__normId || row.__rowKey));
        const id = existing?.id || createEntityId('norm');
        const workNames = String(row.workCategories || '').split(/[;\n]+/).map((item) => item.trim()).filter(Boolean);
        const workIds = workNames.map((name) => (workVolumes || []).find((work) => normalizeLinkText(work.title) === normalizeLinkText(name)))
          .filter((work): work is WorkVolume => Boolean(work))
          .map((work) => canonicalWorkCategoryId(work));
        byId.set(id, {
          ...(existing || {} as MaterialNorm),
          id,
          materialId: existing?.materialId || createEntityId('material'),
          materialName: String(row.materialName || '').trim(),
          category: String(row.category || '').trim(),
          unit: normalizeUnit(String(row.unit || '').trim()) || String(row.unit || '').trim(),
          workCategory: workNames[0],
          workCategoryId: workIds[0],
          workCategories: workNames.length ? workNames : undefined,
          workCategoryIds: workIds.length ? Array.from(new Set(workIds)) : undefined,
          quotaQuantity: Math.max(0, Number(row.quotaQuantity || 0)),
          unitNormPerM2: Math.max(0, Number(row.unitNorm || 0)),
          normBasisUnit: existing?.normBasisUnit || 'm²',
          notes: String(row.notes || '').trim() || undefined,
        });
      });
      const confirmed = await confirmAsync(`Lưu ${dirtyRows.length} thay đổi Danh mục & Định mức vật tư?`);
      if (!confirmed) return;
      onImportNorms(Array.from(byId.values()));
      return;
    }

    if (!hasImportAccess || !onImportInventory) return;
    const upserts: InventoryItem[] = dirtyRows.map((row) => {
      const existing = inventory.find((item) => item.id === String(row.__recordId || row.__rowKey));
      const materialNameValue = String(row.materialName || '').trim();
      const norm = materialNorms.find((item) => item.materialName === materialNameValue && normalizeUnit(item.unit) === normalizeUnit(String(row.unit || '')));
      const floor = floorPlans.find((item) => item.floorName === String(row.floorName || ''));
      const room = roomProgressList.find((item) => item.roomName === String(row.roomName || '') && (!floor || item.floorId === floor.id));
      const team = teams.find((item) => item.name === String(row.teamName || ''));
      const work = (workVolumes || []).find((item) => item.title === String(row.workCategory || ''));
      const group = normalizedStructureConfig.groups.find((item) => item.name === String(row.structureGroup || ''));
      const type = quickEditMode as TransactionType;
      const id = existing?.id || createEntityId(type === 'in' ? 'INV-IN' : 'INV-OUT');
      return {
        ...(existing || {} as InventoryItem),
        id,
        type,
        itemKind: existing?.itemKind || 'material',
        materialId: norm ? resolveNormMaterialId(norm) : existing?.materialId,
        materialName: materialNameValue,
        unit: normalizeUnit(String(row.unit || '').trim()) || String(row.unit || '').trim(),
        quantity: Math.max(0, Number(row.quantity || 0)),
        date: String(row.date || '').trim(),
        location: type === 'in' ? String(row.location || existing?.location || 'Kho chính').trim() : String(existing?.location || 'Công trình'),
        handler: String(row.handler || existing?.handler || defaultHandler || '').trim(),
        notes: String(row.notes || '').trim() || undefined,
        issuePurpose: type === 'out' ? (existing?.issuePurpose || 'project-work') : existing?.issuePurpose,
        sourceStructureGroupId: type === 'out' ? (group?.id || (floor ? resolveFloorStructureGroupId(floor, normalizedStructureConfig) : existing?.sourceStructureGroupId)) : existing?.sourceStructureGroupId,
        sourceFloorId: type === 'out' ? (floor?.id || existing?.sourceFloorId) : existing?.sourceFloorId,
        sourceRoomId: type === 'out' ? (room?.id || existing?.sourceRoomId) : existing?.sourceRoomId,
        sourceTeamId: type === 'out' ? (team?.id || existing?.sourceTeamId) : existing?.sourceTeamId,
        sourceWorkCategoryId: type === 'out' ? (work ? canonicalWorkCategoryId(work) : existing?.sourceWorkCategoryId) : existing?.sourceWorkCategoryId,
      };
    });
    const confirmed = await confirmAsync(`Lưu ${upserts.length} phiếu ${quickEditMode === 'in' ? 'Nhập kho' : 'Xuất kho'}? Tồn kho sẽ được tính lại từ sổ giao dịch.`);
    if (!confirmed) return;
    await onImportInventory(upserts);
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
            type="button"
            onClick={() => { setWarehouseCatalogTab('material'); setWarehouseCatalogSearch(''); setShowWarehouseCatalog(true); }}
            className="flex items-center gap-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-2 rounded-xl text-xs font-bold active:scale-95 transition-all"
            title="Xem danh mục và tồn kho vật tư, thiết bị của dự án"
          >
            <Layers className="w-3.5 h-3.5 text-blue-600" />
            <span>Danh mục kho</span>
          </button>
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

      <SettingsFeatureSheet
        open={showWarehouseCatalog}
        onClose={() => setShowWarehouseCatalog(false)}
        sheetKey="warehouse-catalog"
        icon={Layers}
        iconClassName="text-blue-600"
        title="Danh mục kho"
        description="Tổng hợp vật tư và thiết bị theo Nhập, Xuất, Tồn kho; vật tư hiển thị thêm Khối lượng định mức."
        bodyClassName="space-y-3"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
            {(['material', 'equipment'] as InventoryItemKind[]).map((kind) => (
              <button
                type="button"
                key={kind}
                onClick={() => {
                  setWarehouseCatalogTab(kind);
                  setWarehouseCatalogSearch('');
                  setWarehouseCatalogSortBy('name');
                  setWarehouseCatalogSortOrder('asc');
                }}
                className={`rounded-lg px-3 py-2 text-xs font-bold transition ${warehouseCatalogTab === kind ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:bg-white/70'}`}
              >
                {kind === 'material' ? 'Vật tư' : 'Thiết bị'}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={warehouseCatalogSearch}
                onChange={(event) => setWarehouseCatalogSearch(event.target.value)}
                placeholder={warehouseCatalogTab === 'equipment' ? 'Tìm thiết bị...' : 'Tìm vật tư...'}
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-xs text-slate-800"
              />
            </div>
            {hasEditAccess && warehouseCatalogTab === 'equipment' && (
              <button
                type="button"
                onClick={() => { setShowWarehouseCatalog(false); openCreateInventory('equipment'); setIsNewEquipment(true); setMaterialName(''); setCustomMaterial(''); }}
                className="inline-flex shrink-0 items-center justify-center gap-1 rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" /> Thêm thiết bị mới
              </button>
            )}
          </div>

          <QuickSortBar<WarehouseCatalogSortKey>
            itemCount={warehouseCatalogStockRows.length}
            options={[
              { key: 'name', label: warehouseCatalogTab === 'equipment' ? 'Tên thiết bị' : 'Tên vật tư', kind: 'alpha', defaultOrder: 'asc' },
              { key: 'category', label: 'Nhóm', kind: 'alpha', defaultOrder: 'asc' },
              { key: 'unit', label: 'ĐVT', kind: 'alpha', defaultOrder: 'asc' },
              { key: 'totalIn', label: 'Nhập', kind: 'number', defaultOrder: 'desc' },
              { key: 'totalOut', label: 'Xuất', kind: 'number', defaultOrder: 'desc' },
              ...(warehouseCatalogTab === 'material'
                ? [{ key: 'normQuantity' as const, label: 'Khối lượng định mức', kind: 'number' as const, defaultOrder: 'desc' as const }]
                : []),
              { key: 'currentStock', label: 'Tồn kho', kind: 'number', defaultOrder: 'desc' },
            ]}
            activeKey={warehouseCatalogSortBy}
            order={warehouseCatalogSortOrder}
            onChange={(key, order) => { setWarehouseCatalogSortBy(key); setWarehouseCatalogSortOrder(order); }}
            onToggleOrder={() => setWarehouseCatalogSortOrder((order) => order === 'asc' ? 'desc' : 'asc')}
            onReset={() => { setWarehouseCatalogSortBy('name'); setWarehouseCatalogSortOrder('asc'); }}
            summary={`${warehouseCatalogStockRows.length} ${warehouseCatalogTab === 'equipment' ? 'thiết bị' : 'vật tư'}`}
          />

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[minmax(180px,1.6fr)_120px_52px_64px_64px_104px_76px] gap-2 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600">
                <span>Tên {warehouseCatalogTab === 'equipment' ? 'thiết bị' : 'vật tư'}</span>
                <span>Nhóm</span>
                <span>ĐVT</span>
                <span className="text-right">Nhập</span>
                <span className="text-right">Xuất</span>
                <span className="text-right leading-tight">Khối lượng định mức</span>
                <span className="text-right">Tồn kho</span>
              </div>
              <div className="max-h-[46vh] divide-y divide-slate-100 overflow-y-auto">
                {warehouseCatalogStockRows.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-slate-500">
                    {warehouseCatalogTab === 'equipment' ? 'Chưa có thiết bị. Thiết bị sẽ được lưu vào danh mục sau giao dịch đầu tiên.' : 'Không có vật tư phù hợp.'}
                  </div>
                ) : warehouseCatalogStockRows.map((item) => (
                  <div key={item.key} className="grid grid-cols-[minmax(180px,1.6fr)_120px_52px_64px_64px_104px_76px] items-center gap-2 px-3 py-2.5 text-xs">
                    <div className="min-w-0 whitespace-normal break-words font-bold leading-snug text-slate-800">{item.name}</div>
                    <span className="min-w-0 whitespace-normal break-words text-slate-500">{item.category}</span>
                    <span className="break-words text-slate-600">{item.unit}</span>
                    <span className="text-right font-semibold text-emerald-700">{formatDecimal(item.totalIn)}</span>
                    <span className="text-right font-semibold text-amber-700">{formatDecimal(item.totalOut)}</span>
                    <span className="text-right font-semibold text-indigo-700">
                      {warehouseCatalogTab === 'material' ? formatDecimal(item.normQuantity || 0) : '—'}
                    </span>
                    <span className="text-right font-extrabold text-blue-700">{formatDecimal(item.currentStock)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {warehouseCatalogTab === 'equipment' && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              Thiết bị được dùng lại ở các phiếu nhập/xuất nhưng không tham gia Định mức vật tư hoặc Gợi ý vật tư.
            </p>
          )}
        </div>
      </SettingsFeatureSheet>

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
                Mẫu Excel gồm các trang: <strong>Nhập kho</strong>, <strong>Xuất kho</strong>, <strong>Định Mức Vật Tư</strong> (có cột Tên Hạng Mục Thi Công) &amp; <strong>Hạng Mục Thi Công</strong> &amp; <strong>Tồn Kho</strong>. Tồn Kho chỉ đọc; chỉnh dữ liệu nguồn rồi tải lên để cập nhật hàng loạt.
              </p>
            </div>
          </div>
          <span className="text-[9px] font-extrabold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md uppercase shrink-0">
            5 TRANG
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => { setQuickEditMode('norms'); setShowQuickEdit(true); }}
            className="flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-extrabold py-2 px-3 rounded-xl transition-all text-xs active:scale-95 cursor-pointer"
          >
            ▦ <span>Bảng chỉnh nhanh</span>
          </button>
          <ExcelActionMenu
            onExportEdit={() => exportWarehouseUpdateTemplate(materialNorms, workVolumes || [], inventory, undefined, {
              floorPlans,
              roomProgressList,
              teams,
              structureConfig: normalizedStructureConfig,
            })}
            onImportFile={hasImportAccess ? handleFileChangeExcel : undefined}
            onDownloadTemplate={() => exportWarehouseUpdateTemplate(materialNorms, workVolumes || [], [], undefined, {
              floorPlans,
              roomProgressList,
              teams,
              structureConfig: normalizedStructureConfig,
            })}
            exportLabel="Xuất dữ liệu Kho để chỉnh sửa"
            importLabel="Nhập dữ liệu Kho đã chỉnh sửa"
            templateLabel="Tải mẫu Kho / Định mức"
          />
        </div>
      </div>

      <QuickEditGridModal
        open={showQuickEdit}
        title="Bảng chỉnh nhanh · Kho vật tư"
        subtitle={quickEditMode === 'stock' ? 'Tồn kho là số tính từ Tổng nhập - Tổng xuất và luôn chỉ đọc.' : 'Chỉnh trực tiếp theo cột/dòng; dữ liệu chỉ ghi khi bấm Lưu.'}
        tabs={[
          { key: 'norms', label: 'Danh mục & Định mức' },
          { key: 'in', label: 'Nhập kho' },
          { key: 'out', label: 'Xuất kho' },
          { key: 'stock', label: 'Tồn kho 🔒' },
        ]}
        activeTab={quickEditMode}
        onTabChange={(key) => setQuickEditMode(key as 'norms' | 'in' | 'out' | 'stock')}
        columns={warehouseQuickColumns}
        rows={warehouseActiveQuickRows}
        canEdit={quickEditMode === 'stock' ? false : quickEditMode === 'norms' ? hasNormManageAccess : hasImportAccess}
        canAddRows={quickEditMode === 'norms' ? hasNormManageAccess : quickEditMode === 'in' || quickEditMode === 'out' ? hasImportAccess : false}
        createEmptyRow={(index) => quickEditMode === 'norms' ? ({
          __rowKey: `new-norm-${Date.now()}-${index}`,
          __new: true,
          __normId: '',
          materialName: '',
          category: '',
          unit: '',
          workCategories: '',
          unitNorm: 0,
          quotaQuantity: 0,
          notes: '',
        }) : ({
          __rowKey: `new-${quickEditMode}-${Date.now()}-${index}`,
          __new: true,
          __recordId: '',
          __type: quickEditMode,
          date: new Date().toISOString().slice(0, 10),
          materialName: warehouseMaterialOptions[0] || '',
          unit: materialNorms.find((norm) => norm.materialName === warehouseMaterialOptions[0])?.unit || '',
          quantity: 1,
          structureGroup: '',
          floorName: '',
          roomName: '',
          teamName: '',
          workCategory: '',
          location: quickEditMode === 'in' ? 'Kho chính' : '',
          handler: defaultHandler,
          notes: '',
        })}
        onClose={() => setShowQuickEdit(false)}
        onSave={saveWarehouseQuickRows}
      />

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
                {normalizedStructureConfig.enabled ? `${materialNeedStructureGroupSummary} · ` : ''}{materialNeedFloorSummary} · {materialNeedRoomSummary} · {materialNeedWorkCategorySummary} · {materialNeedTeamSummary} · {materialNeedLines.length} loại vật tư
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
              setShowMaterialStructureGroupPicker(false);
              setShowMaterialFloorPicker(false);
              setShowMaterialRoomPicker(false);
              setShowMaterialTeamPicker(false);
              setShowMaterialWorkCategoryPicker(false);
            }}
            sheetKey="material-need-details"
            icon={PackageSearch}
            iconClassName="text-indigo-600"
            title="Gợi ý vật tư tổng hợp"
            description={normalizedStructureConfig.enabled ? `Theo ${normalizedStructureConfig.label} · Tầng · Căn · Hạng mục · Đội` : 'Theo tầng · Theo căn · Theo hạng mục đã khai · Theo đội'}
            bodyClassName="space-y-3"
          >
            <div id="material-need-details" className="flex min-w-0 flex-col gap-3">
              <p className="text-[11px] text-slate-600">
                Có thể chọn {normalizedStructureConfig.enabled ? `${normalizedStructureConfig.label}, ` : ''}một hoặc nhiều tầng, căn, hạng mục thi công đã khai và đội. Không chọn nghĩa là Tất cả. Một Material Need Engine duy nhất tính từ dữ liệu gốc rồi mới lọc/tổng hợp để chống double-count.
              </p>

              <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${normalizedStructureConfig.enabled ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
                {normalizedStructureConfig.enabled && (
                  <div className="relative">
                    <button type="button" onClick={() => { setShowMaterialStructureGroupPicker((value) => !value); setShowMaterialFloorPicker(false); setShowMaterialRoomPicker(false); setShowMaterialWorkCategoryPicker(false); setShowMaterialTeamPicker(false); }} className="flex w-full items-center justify-between rounded-xl border border-indigo-200 bg-white p-2.5 text-left text-xs font-semibold">
                      <span className="truncate">{materialNeedStructureGroupSummary}</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                    </button>
                    {showMaterialStructureGroupPicker && (
                      <div className="absolute left-0 right-0 z-40 mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs font-semibold hover:bg-slate-50">
                          <input type="checkbox" checked={materialNeedStructureGroupIds.length === 0} onChange={() => setMaterialNeedStructureGroupIds([])} /> Tất cả {normalizedStructureConfig.label}
                        </label>
                        {materialNeedStructureGroups.map((group) => (
                          <label key={group.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs hover:bg-slate-50">
                            <input type="checkbox" checked={materialNeedStructureGroupIds.includes(group.id)} onChange={() => toggleMaterialNeedStructureGroup(group.id)} /> {group.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="relative">
                  <button type="button" onClick={() => { setShowMaterialFloorPicker((value) => !value); setShowMaterialStructureGroupPicker(false); setShowMaterialRoomPicker(false); setShowMaterialWorkCategoryPicker(false); setShowMaterialTeamPicker(false); }} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-left text-xs font-semibold">
                    <span className="truncate">{materialNeedFloorSummary}</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                  {showMaterialFloorPicker && (
                    <div className="absolute left-0 right-0 z-40 mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs font-semibold hover:bg-slate-50">
                        <input type="checkbox" checked={materialNeedFloorIds.length === 0} onChange={() => setMaterialNeedFloorIds([])} /> Tất cả tầng
                      </label>
                      {materialNeedVisibleFloors.map((floor) => (
                        <label key={floor.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-xs hover:bg-slate-50">
                          <input type="checkbox" checked={materialNeedFloorIds.includes(floor.id)} onChange={() => toggleMaterialNeedFloor(floor.id)} /> {floor.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button type="button" onClick={() => { setShowMaterialRoomPicker((value) => !value); setShowMaterialStructureGroupPicker(false); setShowMaterialFloorPicker(false); setShowMaterialWorkCategoryPicker(false); setShowMaterialTeamPicker(false); }} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-left text-xs font-semibold">
                    <span className="truncate">{materialNeedRoomSummary}</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                  {showMaterialRoomPicker && (
                    <div className="absolute left-0 right-0 z-40 mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
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
                  <button type="button" onClick={() => { setShowMaterialWorkCategoryPicker((value) => !value); setShowMaterialStructureGroupPicker(false); setShowMaterialFloorPicker(false); setShowMaterialRoomPicker(false); setShowMaterialTeamPicker(false); }} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-left text-xs font-semibold">
                    <span className="truncate">{materialNeedWorkCategorySummary}</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                  {showMaterialWorkCategoryPicker && (
                    <div className="absolute left-0 right-0 z-40 mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
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
                  <button type="button" onClick={() => { setShowMaterialTeamPicker((value) => !value); setShowMaterialStructureGroupPicker(false); setShowMaterialFloorPicker(false); setShowMaterialRoomPicker(false); setShowMaterialWorkCategoryPicker(false); }} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-left text-xs font-semibold">
                    <span className="truncate">{materialNeedTeamSummary}</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                  {showMaterialTeamPicker && (
                    <div className="absolute left-0 right-0 z-40 mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
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

              {(materialNeedStructureGroupIds.length > 0 || materialNeedFloorIds.length > 0 || materialNeedRoomIds.length > 0 || materialNeedTeamIds.length > 0 || materialNeedWorkCategoryIds.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {materialNeedStructureGroupIds.map((id) => {
                    const group = materialNeedStructureGroups.find((item) => item.id === id);
                    return <button key={`group-${id}`} type="button" onClick={() => toggleMaterialNeedStructureGroup(id)} className="rounded-full bg-fuchsia-100 px-2 py-1 text-[10px] font-bold text-fuchsia-700">{group?.name || id} ×</button>;
                  })}
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

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={materialNeedSearchTerm}
                    onChange={(event) => setMaterialNeedSearchTerm(event.target.value)}
                    placeholder="Tìm vật tư, nhóm vật tư, đơn vị..."
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                {(materialNeedSearchTerm || materialNeedStructureGroupIds.length > 0 || materialNeedFloorIds.length > 0 || materialNeedRoomIds.length > 0 || materialNeedTeamIds.length > 0 || materialNeedWorkCategoryIds.length > 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setMaterialNeedSearchTerm('');
                      setMaterialNeedStructureGroupIds([]);
                      setMaterialNeedFloorIds([]);
                      setMaterialNeedRoomIds([]);
                      setMaterialNeedTeamIds([]);
                      setMaterialNeedWorkCategoryIds([]);
                    }}
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-extrabold text-indigo-700 hover:bg-indigo-50"
                  >
                    Đặt lại bộ lọc
                  </button>
                )}
              </div>

              <QuickSortBar<MaterialNeedSortKey>
                itemCount={materialNeedLines.length}
                options={[
                  { key: 'material', label: 'Vật tư', kind: 'alpha', defaultOrder: 'asc' },
                  { key: 'category', label: 'Nhóm vật tư', kind: 'alpha', defaultOrder: 'asc' },
                  { key: 'unit', label: 'ĐVT', kind: 'alpha', defaultOrder: 'asc' },
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
                  <table className="min-w-[900px] w-full text-[11px]">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Vật tư</th><th className="p-2 text-left">Nhóm vật tư</th><th className="p-2 text-left">ĐVT</th><th className="p-2 text-right">Tổng cần</th><th className="p-2 text-right">Đã xuất</th>{hasMaterialAllocationFilter && <th className="p-2 text-right">Chưa phân bổ</th>}<th className="p-2 text-right">Còn cần</th><th className="p-2 text-right">Tồn kho</th><th className="p-2 text-right">Thiếu</th></tr></thead>
                    <tbody>
                      {materialNeedLines.map((line) => (
                        <tr key={line.materialKey} className="border-t border-slate-100">
                          <td className="p-2 font-bold text-slate-800">{line.materialName}</td>
                          <td className="p-2 text-slate-500">{line.category}</td>
                          <td className="p-2 text-slate-600">{line.unit}</td>
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
            <span className="text-xs font-bold">
              Cảnh báo vật tư thiếu so với nhu cầu ({lowStockItems.length})
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
                      ? 'bg-rose-100 text-rose-800' 
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {isOut ? 'Hết hàng' : `Thiếu: ${formatDecimal(item.deficit)} ${item.unit}`}
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
            <span className="text-xs font-bold text-indigo-900">
              Cảnh báo định mức nhập kho ({quotaWarnings.length})
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
                      ? 'bg-rose-100 text-rose-700' 
                      : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    {isExceeded ? `Vượt ${item.percent - 100}%` : `${item.percent}%`}
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
              Bảng tổng tồn kho
            </span>
          </div>
        </div>

        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {stockSummaries.map((item) => {
            const quota = item.normQuantity;
            const category = item.category;

            return (
              <div key={item.materialId || item.materialName} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 text-xs space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {(category || item.itemKind === 'equipment') && (
                      <span className="inline-block px-1.5 py-0.2 bg-indigo-100 text-indigo-700 text-[9px] font-bold rounded mb-0.5">
                        {item.itemKind === 'equipment' ? 'Thiết bị' : category}
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
          <h3 className="text-xs font-bold text-slate-600">
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          {filteredInventory.map((item) => (
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
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            item.type === 'in'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {item.type === 'in' ? 'Nhập kho' : 'Xuất kho'}
                        </span>
                        {item.itemKind === 'equipment' && (
                          <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                            Thiết bị
                          </span>
                        )}
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
          ))}
          </div>
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
        <div className="fixed inset-y-0 right-0 left-0 lg:left-[84px] bg-slate-900/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-2xl lg:max-w-[1100px] rounded-t-3xl sm:rounded-2xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-200">
            <div className="shrink-0 flex items-center justify-between border-b border-slate-100 px-5 lg:px-6 pt-5 lg:pt-6 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <PackageCheck className="w-5 h-5 text-blue-600" />
                {editingInventory ? 'Chỉnh sửa phiếu kho' : 'Tạo phiếu nhập / xuất kho'}
              </h3>
              <button
                onClick={() => { setShowAddForm(false); setEditingInventory(null); }}
                className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center font-bold text-slate-500 hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 lg:px-6 pb-5 lg:pb-6 pt-4 grid grid-cols-1 lg:grid-cols-6 gap-3 text-xs">
              {/* Warehouse item kind */}
              <div className="lg:col-span-6">
                <label className="block text-slate-700 font-bold mb-1">Loại hàng</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['material', 'equipment'] as InventoryItemKind[]).map((kind) => (
                    <button
                      type="button"
                      key={kind}
                      disabled={Boolean(editingInventory)}
                      onClick={() => {
                        if (editingInventory || itemKind === kind) return;
                        setItemKind(kind);
                        setCustomMaterial('');
                        setMaterialPickerSearch('');
                        setIssueWorkCategoryId('');
                        if (kind === 'equipment') {
                          setIsNewEquipment(equipmentCatalog.length === 0);
                          setMaterialName(equipmentCatalog[0]?.name || '');
                          setUnit(equipmentCatalog[0]?.unit || 'Cái');
                        } else {
                          setIsNewEquipment(false);
                          setMaterialName(materialNorms[0]?.materialName || '');
                          setUnit(materialNorms[0]?.unit || 'Tấm');
                        }
                      }}
                      className={`rounded-xl border py-2 font-bold transition ${itemKind === kind ? 'border-blue-600 bg-blue-600 text-white shadow' : 'border-slate-200 bg-slate-100 text-slate-600'} disabled:cursor-not-allowed disabled:opacity-70`}
                    >
                      {kind === 'material' ? 'Vật tư' : 'Thiết bị'}
                    </button>
                  ))}
                </div>
                {editingInventory && <p className="mt-1 text-[10px] text-slate-500">Không đổi loại hàng khi sửa giao dịch để giữ nguyên lịch sử tồn kho.</p>}
              </div>

              {/* Type Toggle */}
              <div className="lg:col-span-6">
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
                    <ArrowDownLeft className="w-4 h-4" /> Nhập kho
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
                    <ArrowUpRight className="w-4 h-4" /> Xuất kho
                  </button>
                </div>
              </div>

              {/* Material / Equipment Search + Select */}
              <div className="space-y-1.5 lg:col-span-6">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-slate-700 font-bold">{itemKind === 'equipment' ? 'Tên thiết bị' : 'Tên vật tư'}</label>
                  {itemKind === 'equipment' && hasEditAccess && (
                    <button
                      type="button"
                      onClick={() => { setIsNewEquipment(true); setMaterialName(''); setCustomMaterial(''); setMaterialPickerSearch(''); }}
                      className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 hover:text-blue-900"
                    >
                      <Plus className="h-3.5 w-3.5" /> Thêm thiết bị mới
                    </button>
                  )}
                </div>

                {itemKind === 'material' ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-end">
                    <div className="relative">
                      <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
                      <input
                        ref={materialSearchRef}
                        type="search"
                        value={materialPickerSearch}
                        onChange={(e) => setMaterialPickerSearch(e.target.value)}
                        placeholder="Tìm vật tư theo tên, nhóm hoặc đơn vị..."
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
                              onClick={() => { setMaterialName(m.materialName); setUnit(m.unit); setCustomMaterial(''); setMaterialPickerSearch(''); }}
                              className="w-full px-3 py-2 text-left hover:bg-indigo-50 border-b border-slate-100 last:border-b-0"
                            >
                              <div className="text-xs font-bold text-slate-800">{m.materialName}</div>
                              <div className="text-[10px] text-slate-500">{m.category || 'Vật tư'} · {m.unit}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <select
                      value={materialName}
                      onChange={(e) => {
                        setMaterialName(e.target.value);
                        const matched = materialNorms.find((m) => m.materialName === e.target.value);
                        if (matched) { setUnit(matched.unit); setCustomMaterial(''); }
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800"
                    >
                      <option value="">— Chọn vật tư —</option>
                      {filteredMaterialNorms.map((m) => <option key={m.id} value={m.materialName}>[{m.category}] {m.materialName} ({m.unit})</option>)}
                    </select>
                    {normalizedMaterialPickerSearch && filteredMaterialNorms.length === 0 && (
                      <p className="text-[10px] text-amber-700 lg:col-span-2">Không tìm thấy vật tư phù hợp. Có thể nhập tên mới ở ô “Tên vật tư khác”.</p>
                    )}
                  </div>
                ) : isNewEquipment ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input
                      ref={materialSearchRef}
                      type="text"
                      value={customMaterial}
                      onChange={(e) => setCustomMaterial(e.target.value)}
                      placeholder="Ví dụ: Máy hàn, Máy cắt bàn, Giàn giáo..."
                      className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-slate-800"
                      autoFocus
                    />
                    {equipmentCatalog.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setIsNewEquipment(false); setCustomMaterial(''); setMaterialName(equipmentCatalog[0]?.name || ''); setUnit(equipmentCatalog[0]?.unit || 'Cái'); }}
                        className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2.5 font-bold text-slate-600 hover:bg-slate-200"
                      >
                        Chọn thiết bị có sẵn
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-end">
                    <div className="relative">
                      <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
                      <input
                        ref={materialSearchRef}
                        type="search"
                        value={materialPickerSearch}
                        onChange={(e) => setMaterialPickerSearch(e.target.value)}
                        placeholder="Tìm thiết bị..."
                        className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pl-9 pr-3 text-slate-800"
                        autoComplete="off"
                      />
                    </div>
                    <select
                      value={`${materialName}|||${unit}`}
                      onChange={(e) => {
                        const selected = equipmentCatalog.find((item) => `${item.name}|||${item.unit}` === e.target.value);
                        if (selected) { setMaterialName(selected.name); setUnit(selected.unit); setCustomMaterial(''); setMaterialPickerSearch(''); }
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800"
                    >
                      <option value="|||">— Chọn thiết bị —</option>
                      {filteredEquipmentCatalog.map((item) => <option key={`${item.name}|${item.unit}`} value={`${item.name}|||${item.unit}`}>{item.name} ({item.unit})</option>)}
                    </select>
                    {normalizedMaterialPickerSearch && filteredEquipmentCatalog.length === 0 && (
                      <button type="button" onClick={() => { setIsNewEquipment(true); setCustomMaterial(materialPickerSearch.trim()); setMaterialPickerSearch(''); }} className="text-left text-[10px] font-bold text-blue-700 lg:col-span-2">
                        Không có thiết bị này · + Thêm thiết bị mới
                      </button>
                    )}
                  </div>
                )}
              </div>

              {type === 'out' && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3 space-y-3 lg:col-span-6">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">Mục đích xuất</label>
                    <select
                      value={issuePurpose}
                      onChange={(e) => {
                        const next = e.target.value as InventoryIssuePurpose;
                        setIssuePurpose(next);
                        if (next !== 'project-work') {
                          setIssueStructureGroupId('');
                          setIssueFloorId('');
                          setIssueRoomId('');
                          setIssueTeamId('');
                          setIssueWorkCategoryId('');
                        }
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white p-2.5 font-semibold text-slate-800"
                    >
                      <option value="project-work">Thi công trong dự án</option>
                      <option value="external-project">Xuất ngoài dự án</option>
                      <option value="other">Mục đích khác</option>
                    </select>
                  </div>

                  {issuePurpose === 'project-work' && (
                    <>
                      <p className="text-[10px] text-slate-500">
                        Phạm vi dưới đây không bắt buộc nhập đủ. {itemKind === 'equipment' ? 'Thiết bị có thể ghi nhận Khu/Khối, Tầng, Căn/Phòng và Đội nhận; thiết bị không tham gia định mức.' : 'Chọn càng chi tiết thì thống kê vật tư theo Khu/Khối, Tầng, Căn/Phòng, Đội và Hạng mục càng chính xác.'}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {normalizedStructureConfig.enabled && (
                          <label className="space-y-1">
                            <span className="block text-[10px] font-bold text-slate-600">{normalizedStructureConfig.label} <span className="font-medium text-slate-400">(không bắt buộc)</span></span>
                            <select
                              value={issueStructureGroupId}
                              onChange={(e) => {
                                setIssueStructureGroupId(e.target.value);
                                setIssueFloorId('');
                                setIssueRoomId('');
                                setIssueWorkCategoryId('');
                              }}
                              className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-semibold"
                            >
                              <option value="">— Chưa phân bổ —</option>
                              {normalizedStructureConfig.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                            </select>
                          </label>
                        )}

                        <label className="space-y-1">
                          <span className="block text-[10px] font-bold text-slate-600">Tầng <span className="font-medium text-slate-400">(không bắt buộc)</span></span>
                          <select
                            value={issueFloorId}
                            onChange={(e) => {
                              const floorId = e.target.value;
                              setIssueFloorId(floorId);
                              setIssueRoomId('');
                              setIssueWorkCategoryId('');
                              const floor = floorPlans.find((item) => item.id === floorId);
                              if (floor && normalizedStructureConfig.enabled) setIssueStructureGroupId(resolveFloorStructureGroupId(floor, normalizedStructureConfig));
                            }}
                            className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-semibold"
                          >
                            <option value="">— Chưa phân bổ —</option>
                            {issueFloorOptions.map((floor) => <option key={floor.id} value={floor.id}>{floor.floorName}</option>)}
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="block text-[10px] font-bold text-slate-600">Căn / Phòng <span className="font-medium text-slate-400">(không bắt buộc)</span></span>
                          <select
                            value={issueRoomId}
                            onChange={(e) => {
                              const roomId = e.target.value;
                              setIssueRoomId(roomId);
                              setIssueWorkCategoryId('');
                              const room = roomProgressList.find((item) => item.id === roomId);
                              if (room?.floorId) {
                                setIssueFloorId(room.floorId);
                                const floor = floorPlans.find((item) => item.id === room.floorId);
                                if (floor && normalizedStructureConfig.enabled) setIssueStructureGroupId(resolveFloorStructureGroupId(floor, normalizedStructureConfig));
                              }
                            }}
                            className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-semibold"
                          >
                            <option value="">— Chưa phân bổ —</option>
                            {issueRoomOptions.map((room) => <option key={room.id} value={room.id}>{room.roomName}</option>)}
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="block text-[10px] font-bold text-slate-600">Đội thi công <span className="font-medium text-slate-400">(không bắt buộc)</span></span>
                          <select value={issueTeamId} onChange={(e) => setIssueTeamId(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-semibold">
                            <option value="">— Chưa phân bổ —</option>
                            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                          </select>
                        </label>

                        {itemKind === 'material' && (
                          <label className="space-y-1 sm:col-span-2">
                            <span className="block text-[10px] font-bold text-slate-600">Hạng mục thi công <span className="font-medium text-slate-400">(không bắt buộc, nên chọn khi đối chiếu định mức)</span></span>
                            <select value={issueWorkCategoryId} onChange={(e) => setIssueWorkCategoryId(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-semibold">
                              <option value="">— Chưa phân bổ —</option>
                              {issueWorkCategoryOptions.map((item) => <option key={item.id} value={item.workCategoryId || item.id}>{item.title}</option>)}
                            </select>
                          </label>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Legacy/custom material remains material-only; equipment uses a reusable catalog instead of “Tên khác”. */}
              {itemKind === 'material' && (
                <div className="lg:col-span-3">
                  <label className="block text-slate-500 font-medium mb-1">Tên vật tư khác</label>
                  <input
                    type="text"
                    placeholder="Ví dụ: Đèn âm trần 12W, Keo bọt nở..."
                    value={customMaterial}
                    onChange={(e) => setCustomMaterial(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl p-2.5"
                  />
                </div>
              )}

              {/* Quantity & Unit */}
              <div className="grid grid-cols-2 gap-2 lg:col-span-3">
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
                <div className={`p-2.5 rounded-xl border text-[11px] font-medium leading-relaxed lg:col-span-6 ${
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
              <div className="grid grid-cols-2 gap-2 lg:col-span-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Vị trí kho / tầng <span className="font-medium text-slate-400">(không bắt buộc)</span></label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Ví dụ: Kho tầng trệt, Kho A..."
                    className="w-full border border-slate-200 rounded-xl p-2.5"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Người Giao / Nhận <span className="font-medium text-slate-400">(không bắt buộc)</span></label>
                  <input
                    type="text"
                    value={handler}
                    onChange={(e) => setHandler(e.target.value)}
                    placeholder={defaultHandler ? 'Lấy từ Kỹ sư phụ trách · có thể sửa' : 'Nhập người giao / nhận'}
                    className="w-full border border-slate-200 rounded-xl p-2.5"
                  />
                </div>
              </div>

              {/* Date & Notes */}
              <div className="lg:col-span-2">
                <label className="block text-slate-700 font-bold mb-1">Ngày Thực Hiện</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5"
                  required
                />
              </div>

              <div className="lg:col-span-4">
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
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800 lg:col-span-6">
                  {quickAddMessage}
                </div>
              )}

              {/* Buttons */}
              <div className="sticky bottom-0 z-10 -mx-5 lg:-mx-6 -mb-5 lg:-mb-6 mt-1 grid grid-cols-1 sm:grid-cols-3 gap-2 border-t border-slate-100 bg-white px-5 lg:px-6 py-4 lg:col-span-6">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold text-slate-700"
                >
                  Hủy
                </button>
                {!editingInventory && (
                  <button
                    type="submit"
                    name="submitMode"
                    value="continue"
                    className="py-2.5 rounded-xl font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 active:scale-95 transition-all"
                  >
                    Lưu & thêm tiếp
                  </button>
                )}
                <button
                  type="submit"
                  name="submitMode"
                  value="close"
                  className={`py-2.5 rounded-xl font-bold text-white shadow-md active:scale-95 transition-all ${
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
