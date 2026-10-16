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
  Images,
  Edit2,
  ChevronDown,
  PackageSearch
} from 'lucide-react';
import { InventoryItem, InventoryIssuePurpose, InventoryItemKind, TransactionType, MaterialNorm, WorkVolume, RoomProgressItem, TeamInfo, FloorPlan } from '../types';
import { formatDateDDMMYYYY, formatExcelDate } from '../utils/dateFormatter';
import { formatDecimal, evaluateMathExpression, hasMathExpression, useFormatSettings, parseVietnameseNumber, parseExcelNumber } from '../utils/numberUtils';
import { confirmAsync } from '../utils/confirmAsync';
import { calculateStockSummary, resolveNormMaterialId } from '../utils/inventoryUtils';
import { compareDateValues, naturalCompare } from '../utils/sortUtils';
import { createEntityId } from '../utils/idUtils';
import { normalizeUnit, areSameUnit } from '../utils/unitUtils';
import { canonicalWorkCategoryId, normalizeLinkText } from '../utils/linkageIntegrity';
import { assertSafeExcelImportFile, parseExcelNumberRecord, parseExcelStringArray, parseExcelStringRecord, readExcelFormulaByHeaders, sameStringSet } from '../utils/excelImportUtils';
import { QuickSortBar } from './QuickSortBar';
import { compareMaterialGroupPriority } from '../utils/catalogDisplayOrder';
import { equipmentIdentityKey, EquipmentUnitMigrationRequiredError, saveEquipmentCatalogBatch, subscribeEquipmentCatalog, type EquipmentCatalogRecord, type EquipmentCatalogInput } from '../lib/equipmentCatalog';
import type { WarehouseUnitRenameInput } from '../lib/warehouseUnitMigration';
import { SettingsFeatureSheet } from './SettingsFeatureSheet';
import { WarehouseVoucherShareSheet } from './WarehouseVoucherShareSheet';
import { PhotoAttachmentPicker } from './PhotoAttachmentPicker';
import { DataManagementMenu } from './DataManagementMenu';
import type { QuickGridColumn, QuickGridRow } from './QuickEditGridModal';
const LazyQuickEditGridModal = React.lazy(() => import('./QuickEditGridModal').then((m) => ({ default: m.QuickEditGridModal })));
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
  isActive?: boolean;
  quickEditEnabled?: boolean;
  currentProjectId?: string;
  projectName?: string;
  projectLocation?: string;
  contractorName?: string;
  inventory: InventoryItem[];
  userRole: UserRole;
  roleResolved: boolean;
  onAddInventory: (item: Omit<InventoryItem, 'id'> & { id?: string }) => void | Promise<void>;
  onUpdateInventory?: (id: string, item: Omit<InventoryItem, 'id'>) => void | Promise<void>;
  onDeleteInventory: (id: string) => void | Promise<void>;
  onDeleteMultipleInventory?: (ids: string[]) => void | Promise<void>;
  onSyncSheets?: () => void;
  materialNorms: MaterialNorm[];
  returnToCatalogToken?: number;
  onOpenNormModal: (tab?: 'material' | 'equipment', target?: { name: string; unit: string }, fromWarehouseCatalog?: boolean) => void;
  onOpenExportPdf?: () => void;
  onExportExcel?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  workVolumes?: WorkVolume[];
  onImportInventory?: (inventory: InventoryItem[]) => void | Promise<void>;
  onImportNorms?: (norms: MaterialNorm[]) => void;
  onCreateMaterialCatalog?: (input: { materialName: string; unit: string; category: string }) => string | null | Promise<string | null>;
  onRenameWarehouseUnit?: (input: Omit<WarehouseUnitRenameInput, 'projectId'>) => Promise<{ norms: number; vouchers: number }>;
  onImportWorkVolumes?: (volumes: WorkVolume[]) => void;
  roomProgressList?: RoomProgressItem[];
  teams?: TeamInfo[];
  floorPlans?: FloorPlan[];
  structureConfig: ProjectStructureConfig;
  defaultHandler?: string;
}

/** Select photos before creating a voucher, but never publish orphan photo metadata. */
const WarehouseVoucherPhotoDraft: React.FC<{ files: File[]; onChange: (files: File[]) => void }> = ({ files, onChange }) => {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const previews = files.map((file) => { try { return URL.createObjectURL(file); } catch { return ''; } });
    setUrls(previews);
    return () => previews.forEach((url) => { if (url) URL.revokeObjectURL(url); });
  }, [files]);
  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const chosen = Array.from(list);
    if (files.length + chosen.length > 10) { window.alert('Mỗi phiếu chỉ được tối đa 10 ảnh.'); return; }
    const invalid = chosen.find((f) =>
      (f.type ? !['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif'].includes(f.type.toLowerCase())
        : !/\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name)) || f.size > 25 * 1024 * 1024
    );
    if (invalid) { window.alert(`Ảnh ${invalid.name} không hợp lệ (JPG/PNG/WebP, tối đa 25 MB/ảnh).`); return; }
    onChange([...files, ...chosen]);
  };
  return (
    <div className="space-y-2" data-hnl-warehouse-staged-photos="true">
      <p className="text-[11px] font-bold text-sky-800">ẢNH GIAO NHẬN VẬT TƯ / THIẾT BỊ ({files.length}/10) · Không bắt buộc</p>
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700">
          <Images className="h-4 w-4" /> Chụp ảnh
          <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </label>
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700">
          <Images className="h-4 w-4" /> Thư viện
          <input type="file" className="hidden" accept="image/*" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </label>
      </div>
      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {files.map((file, i) => (
            <div key={`${file.name}-${file.lastModified}-${i}`} className="relative overflow-hidden rounded-lg border border-slate-200 bg-white">
              {urls[i] ? <img alt={`Ảnh giao nhận ${i + 1}`} src={urls[i]} className="h-20 w-full object-cover" /> : <div className="flex h-20 items-center justify-center text-xs text-slate-400">Ảnh {i + 1}</div>}
              <button type="button" aria-label={`Bỏ ảnh ${i + 1}`} onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 rounded-full bg-rose-600 px-2 py-1 text-[10px] font-bold text-white">✕</button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-slate-600">Ảnh chỉ tạm lưu trên thiết bị khi chưa lưu phiếu. Sau khi giao dịch tồn kho thành công, ảnh sẽ được thêm vào phiếu đúng mã và đồng bộ Cloud/R2.</p>
    </div>
  );
};

export const WarehouseTab: React.FC<WarehouseTabProps> = ({
  isActive = true,
  quickEditEnabled = true,
  currentProjectId = '',
  projectName = '',
  projectLocation = '',
  contractorName = '',
  inventory,
  userRole,
  roleResolved,
  onAddInventory,
  onUpdateInventory,
  onDeleteInventory,
  onDeleteMultipleInventory,
  onSyncSheets,
  materialNorms,
  returnToCatalogToken = 0,
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
  onCreateMaterialCatalog,
  onRenameWarehouseUnit,
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
  const [inventoryKindFilter, setInventoryKindFilter] = useState<'all' | InventoryItemKind>('all');
  useFormatSettings();
  const [searchTerm, setSearchTerm] = useState('');
  const [inventorySortBy, setInventorySortBy] = useState<'date' | 'material' | 'location' | 'handler'>('date');
  const [inventorySortOrder, setInventorySortOrder] = useState<'asc' | 'desc'>('desc');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingInventory, setEditingInventory] = useState<InventoryItem | null>(null);
  const [itemKind, setItemKind] = useState<InventoryItemKind>('material');
  const [isNewEquipment, setIsNewEquipment] = useState(false);
  const [expandedInventoryId, setExpandedInventoryId] = useState<string | null>(null);
  const [copiedInventoryId, setCopiedInventoryId] = useState<string | null>(null);
  const [showWarehouseCatalog, setShowWarehouseCatalog] = useState(false);
  const [voucherShareOpen, setVoucherShareOpen] = useState(false);
  // Draft images remain in-memory, never in R2/Firestore until the ledger commits.
  const [pendingVoucherPhotos, setPendingVoucherPhotos] = useState<File[]>([]);
  const [photoVoucher, setPhotoVoucher] = useState<(Pick<InventoryItem, 'id' | 'type' | 'materialName'> & { projectId: string; initialFiles?: File[] }) | null>(null);
  useEffect(() => {
    setPhotoVoucher(null);
    setPendingVoucherPhotos([]);
    setShowAddForm(false);
    setEditingInventory(null);
  }, [currentProjectId]);
  const inventorySaveInFlightRef = useRef(false);
  const [catalogHistory, setCatalogHistory] = useState<{
    kind: InventoryItemKind; name: string; displayName: string; unit: string;
    type: TransactionType; expectedTotal: number;
  } | null>(null);
  const [catalogHistoryStart, setCatalogHistoryStart] = useState('');
  const [catalogHistoryEnd, setCatalogHistoryEnd] = useState('');
  const [expandedHistoryDate, setExpandedHistoryDate] = useState<string | null>(null);
  const [warehouseCatalogTab, setWarehouseCatalogTab] = useState<InventoryItemKind>('material');
  const [warehouseCatalogSearch, setWarehouseCatalogSearch] = useState('');
  const [warehouseCatalogSortBy, setWarehouseCatalogSortBy] = useState<WarehouseCatalogSortKey>('name');
  const [warehouseCatalogSortOrder, setWarehouseCatalogSortOrder] = useState<'asc' | 'desc'>('asc');
  const previousReturnTokenRef = useRef(returnToCatalogToken);
  const catalogScrollReturnTopRef = useRef<number | null>(null);
  const catalogReturnItemKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (returnToCatalogToken === previousReturnTokenRef.current) return;
    previousReturnTokenRef.current = returnToCatalogToken;
    setCatalogHistory(null);
    setShowWarehouseCatalog(true);
  }, [returnToCatalogToken]);
  useEffect(() => {
    if (!showWarehouseCatalog || catalogScrollReturnTopRef.current == null) return;
    const id = window.requestAnimationFrame(() => {
      const body = document.querySelector<HTMLElement>('[data-hnl-settings-sheet-scrollbody="warehouse-catalog"]');
      if (body) body.scrollTop = catalogScrollReturnTopRef.current ?? 0;
      const focusKey = catalogReturnItemKeyRef.current;
      const name = Array.from(document.querySelectorAll<HTMLElement>('[data-hnl-catalog-open-master]'))
        .find(node => node.dataset.hnlCatalogOpenMaster === focusKey);
      name?.focus({preventScroll: true});
      catalogScrollReturnTopRef.current = null;
      catalogReturnItemKeyRef.current = null;
    });
    return () => window.cancelAnimationFrame(id);
  }, [showWarehouseCatalog, returnToCatalogToken]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [showQuickEdit, setShowQuickEdit] = useState(false);
  const [quickEditMode, setQuickEditMode] = useState<'norms' | 'equipment' | 'in' | 'out' | 'stock'>('norms');
  const [equipmentMaster, setEquipmentMaster] = useState<EquipmentCatalogRecord[]>([]);
  const [equipmentMasterReady, setEquipmentMasterReady] = useState(false);
  useEffect(() => {
    setEquipmentMasterReady(false);
    setEquipmentMaster([]);
    if (!currentProjectId || !roleResolved) return;
    return subscribeEquipmentCatalog(currentProjectId, rows => {
      setEquipmentMaster(rows);
      setEquipmentMasterReady(true);
    }, error => {
      setEquipmentMasterReady(false);
      console.warn('[Equipment catalog] Read denied/unavailable; editing disabled', error);
    });
  }, [currentProjectId, roleResolved]);
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
    if (!isActive) return;
    const available = new Set(materialNeedStructureGroups.map((group) => group.id));
    setMaterialNeedStructureGroupIds((current) => current.filter((id) => available.has(id)));
  }, [isActive, materialNeedStructureGroupIdsKey]);

  useEffect(() => {
    if (!isActive) return;
    const available = new Set(materialNeedVisibleFloors.map((floor) => floor.id));
    setMaterialNeedFloorIds((current) => current.filter((id) => available.has(id)));
  }, [isActive, materialNeedVisibleFloorIdsKey]);

  useEffect(() => {
    if (!isActive) return;
    const available = new Set(materialNeedRooms.map((room) => room.id));
    setMaterialNeedRoomIds((current) => current.filter((id) => available.has(id)));
  }, [isActive, materialNeedRoomIdsKey]);

  useEffect(() => {
    if (!isActive) return;
    const available = new Set(materialNeedTeams.map((team) => team.id));
    setMaterialNeedTeamIds((current) => current.filter((id) => available.has(id)));
  }, [isActive, materialNeedTeamIdsKey]);

  useEffect(() => {
    if (!isActive) return;
    const available = new Set(materialNeedWorkCategories.map((item) => item.id));
    setMaterialNeedWorkCategoryIds((current) => current.filter((id) => available.has(id)));
  }, [isActive, materialNeedWorkCategoryIdsKey]);

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
          return compareMaterialGroupPriority(a.category, b.category) || naturalCompare(a.category, b.category) || naturalCompare(a.materialName, b.materialName) || naturalCompare(a.materialKey, b.materialKey);
      }
      if (materialNeedSortOrder === 'desc') comparison = -comparison;
      if (comparison !== 0) return comparison;
      return compareMaterialGroupPriority(a.category, b.category) || naturalCompare(a.category, b.category) || naturalCompare(a.materialName, b.materialName) || naturalCompare(a.materialKey, b.materialKey);
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
    if (!isActive) return;
    if (!hasEditAccess) {
      setShowAddForm(false);
      setEditingInventory(null);
    }
    if (!hasDeleteAccess) {
      setSelectedItemIds([]);
      setDeletingInventoryTarget(null);
    }
  }, [isActive, hasEditAccess, hasDeleteAccess]);

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
    if (!hasImportAccess) { alert('Chỉ ADMIN (Quản trị) được nhập dữ liệu Kho / Định mức / Hạng mục hàng loạt từ Excel.'); return; }
    try { assertSafeExcelImportFile(file); } catch (error) {
      alert(`❌ ${error instanceof Error ? error.message : 'Tệp Excel không hợp lệ.'}`);
      return;
    }
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const XLSX = await import('xlsx');
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        let inCount = 0;
        let outCount = 0;
        let normsUpdatedCount = 0;
        let normsAddedCount = 0;

        let newInventory = [...inventory];
        const importedInventoryRows: InventoryItem[] = [];
        let newNorms = [...materialNorms];
        const validMaterialIds = new Set<string>([
          ...materialNorms.map((norm) => resolveNormMaterialId(norm)),
          ...inventory.map((item) => String(item.materialId || '').trim()).filter(Boolean),
        ]);
        const validNormIds = new Set<string>(materialNorms.map((norm) => norm.id));
        const validRoomIds = new Set<string>(roomProgressList.map((room) => room.id));
        const validFloorIds = new Set<string>(floorPlans.map((floor) => floor.id));
        const validTeamIds = new Set<string>(teams.map((team) => team.id));
        const validWorkCategoryIds = new Set<string>((workVolumes || []).flatMap((work) => [work.id, canonicalWorkCategoryId(work)]).filter(Boolean));
        const validStructureGroupIds = new Set<string>(normalizedStructureConfig.groups.map((group) => group.id));
        const assertKnownReference = (
          rawValue: unknown,
          existingValue: unknown,
          validIds: Set<string>,
          label: string,
          rowNumber: number,
        ) => {
          const id = String(rawValue ?? '').trim();
          if (!id || id === String(existingValue ?? '').trim()) return;
          if (!validIds.has(id)) throw new Error(`Dòng ${rowNumber}: ${label} không tồn tại trong dự án hiện tại: ${id}.`);
        };

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
            const quantityFormula = readExcelFormulaByHeaders(sheet, XLSX.utils, rIdx + 1, ['Số Lượng', 'quantity']);
            const quantityFormulaValue = quantityFormula ? evaluateMathExpression(quantityFormula) : null;
            if (quantityFormula && quantityFormulaValue === null) throw new Error(`Dòng ${rIdx + 2}: công thức Số Lượng không an toàn hoặc không hợp lệ.`);
            const quantityNum = quantityFormulaValue !== null
              ? quantityFormulaValue
              : parseVietnameseNumber(row['Số Lượng'] || row['quantity'] || 0);
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

            const rawIdStr = String(rawId || '').trim();
            const existingIdx = rawIdStr ? newInventory.findIndex(i => i.id === rawIdStr) : -1;
            if (rawIdStr && existingIdx < 0) throw new Error(`Dòng ${rIdx + 2}: Mã Phiếu không tồn tại trong dự án hiện tại: ${rawIdStr}. Hãy để trống ID cho phiếu mới.`);
            
            const existingItem = existingIdx >= 0 ? newInventory[existingIdx] : undefined;
            if (existingItem && existingItem.type !== 'in') throw new Error(`Dòng ${rIdx + 2}: Mã Phiếu ${rawIdStr} không phải phiếu Nhập kho.`);
            const preservesExistingIdentity = Boolean(existingItem
              && (existingItem.itemKind === 'equipment' ? 'equipment' : 'material') === importedItemKind
              && existingItem.materialName.trim().toLocaleLowerCase('vi-VN') === materialNameStr.toLocaleLowerCase('vi-VN')
              && (normalizeUnit(existingItem.unit) || existingItem.unit) === (normalizeUnit(unitStr) || unitStr));
            assertKnownReference(rawMaterialId, existingItem?.materialId, validMaterialIds, '__materialId', rIdx + 2);
            assertKnownReference(rawSourceStructureGroupId, existingItem?.sourceStructureGroupId, validStructureGroupIds, '__sourceStructureGroupId', rIdx + 2);
            assertKnownReference(rawSourceRoomId, existingItem?.sourceRoomId, validRoomIds, '__sourceRoomId', rIdx + 2);
            assertKnownReference(rawSourceFloorId, existingItem?.sourceFloorId, validFloorIds, '__sourceFloorId', rIdx + 2);
            assertKnownReference(rawSourceTeamId, existingItem?.sourceTeamId, validTeamIds, '__sourceTeamId', rIdx + 2);
            assertKnownReference(rawSourceWorkCategoryId, existingItem?.sourceWorkCategoryId, validWorkCategoryIds, '__sourceWorkCategoryId', rIdx + 2);
            assertKnownReference(rawSourceNormId, existingItem?.sourceNormId, validNormIds, '__sourceNormId', rIdx + 2);

            const invItem: InventoryItem = {
              id: existingIdx >= 0 ? newInventory[existingIdx].id : createEntityId('INV-IN'),
              type: 'in',
              itemKind: importedItemKind,
              materialId: importedItemKind === 'material' ? (rawMaterialId ? String(rawMaterialId).trim() : (preservesExistingIdentity ? existingItem?.materialId : undefined)) : undefined,
              materialName: materialNameStr,
              unit: unitStr,
              quantity: quantityNum,
              inputExpressions: (() => {
                const next = { ...(existingItem?.inputExpressions || {}) };
                delete next.quantity;
                if (quantityFormula) next.quantity = quantityFormula;
                return Object.keys(next).length ? next : undefined;
              })(),
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
            const quantityFormula = readExcelFormulaByHeaders(sheet, XLSX.utils, rIdx + 1, ['Số Lượng', 'quantity']);
            const quantityFormulaValue = quantityFormula ? evaluateMathExpression(quantityFormula) : null;
            if (quantityFormula && quantityFormulaValue === null) throw new Error(`Dòng ${rIdx + 2}: công thức Số Lượng không an toàn hoặc không hợp lệ.`);
            const quantityNum = quantityFormulaValue !== null
              ? quantityFormulaValue
              : parseVietnameseNumber(row['Số Lượng'] || row['quantity'] || 0);
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

            const rawIdStr = String(rawId || '').trim();
            const existingIdx = rawIdStr ? newInventory.findIndex(i => i.id === rawIdStr) : -1;
            if (rawIdStr && existingIdx < 0) throw new Error(`Dòng ${rIdx + 2}: Mã Phiếu không tồn tại trong dự án hiện tại: ${rawIdStr}. Hãy để trống ID cho phiếu mới.`);
            
            const existingItem = existingIdx >= 0 ? newInventory[existingIdx] : undefined;
            if (existingItem && existingItem.type !== 'out') throw new Error(`Dòng ${rIdx + 2}: Mã Phiếu ${rawIdStr} không phải phiếu Xuất kho.`);
            const preservesExistingIdentity = Boolean(existingItem
              && (existingItem.itemKind === 'equipment' ? 'equipment' : 'material') === importedItemKind
              && existingItem.materialName.trim().toLocaleLowerCase('vi-VN') === materialNameStr.toLocaleLowerCase('vi-VN')
              && (normalizeUnit(existingItem.unit) || existingItem.unit) === (normalizeUnit(unitStr) || unitStr));
            assertKnownReference(rawMaterialId, existingItem?.materialId, validMaterialIds, '__materialId', rIdx + 2);
            assertKnownReference(rawSourceStructureGroupId, existingItem?.sourceStructureGroupId, validStructureGroupIds, '__sourceStructureGroupId', rIdx + 2);
            assertKnownReference(rawSourceRoomId, existingItem?.sourceRoomId, validRoomIds, '__sourceRoomId', rIdx + 2);
            assertKnownReference(rawSourceFloorId, existingItem?.sourceFloorId, validFloorIds, '__sourceFloorId', rIdx + 2);
            assertKnownReference(rawSourceTeamId, existingItem?.sourceTeamId, validTeamIds, '__sourceTeamId', rIdx + 2);
            assertKnownReference(rawSourceWorkCategoryId, existingItem?.sourceWorkCategoryId, validWorkCategoryIds, '__sourceWorkCategoryId', rIdx + 2);
            assertKnownReference(rawSourceNormId, existingItem?.sourceNormId, validNormIds, '__sourceNormId', rIdx + 2);

            const invItem: InventoryItem = {
              id: existingIdx >= 0 ? newInventory[existingIdx].id : createEntityId('INV-OUT'),
              type: 'out',
              itemKind: importedItemKind,
              materialId: importedItemKind === 'material' ? (rawMaterialId ? String(rawMaterialId).trim() : (preservesExistingIdentity ? existingItem?.materialId : undefined)) : undefined,
              materialName: materialNameStr,
              unit: unitStr,
              quantity: quantityNum,
              inputExpressions: (() => {
                const next = { ...(existingItem?.inputExpressions || {}) };
                delete next.quantity;
                if (quantityFormula) next.quantity = quantityFormula;
                return Object.keys(next).length ? next : undefined;
              })(),
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
            const importedInputExpressions = parseExcelStringRecord(row['__inputExpressions'] || row['inputExpressions']);
            const generalNormFormula = readExcelFormulaByHeaders(sheet, XLSX.utils, rIdx + 1, ['Định Mức / m2', 'Định Mức Hao Phí / m2', 'Định mức tiêu hao', 'unitNormPerM2']);
            const generalNormFormulaValue = generalNormFormula ? evaluateMathExpression(generalNormFormula) : null;
            if (generalNormFormula && generalNormFormulaValue === null) throw new Error(`Dòng ${rIdx + 2}: công thức Định Mức / đơn vị không an toàn hoặc không hợp lệ.`);
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
            if (rawIdStr && !existingNorm) throw new Error(`Dòng ${rIdx + 2}: __normId không tồn tại trong dự án hiện tại: ${rawIdStr}. Hãy để trống ID cho định mức mới.`);
            const unknownCategoryIds = (importedWorkCategoryIds || []).filter((id) => !validWorkCategoryIds.has(id));
            if (unknownCategoryIds.length) throw new Error(`Dòng ${rIdx + 2}: __workCategoryIds không tồn tại: ${unknownCategoryIds.join(', ')}.`);
            const unknownNormMapIds = importedWorkCategoryNormsById
              ? Object.keys(importedWorkCategoryNormsById).filter((id) => !validWorkCategoryIds.has(id))
              : [];
            if (unknownNormMapIds.length) throw new Error(`Dòng ${rIdx + 2}: __workCategoryNormsById chứa ID không tồn tại: ${unknownNormMapIds.join(', ')}.`);
            assertKnownReference(rawMaterialId, existingNorm?.materialId, validMaterialIds, '__materialId', rIdx + 2);
            const importedNormId = existingNorm?.id || createEntityId('NORM');
            const importedMaterialId = rawMaterialId
              ? String(rawMaterialId).trim()
              : (existingNorm?.materialId || resolveNormMaterialId({ id: importedNormId, materialName: materialNameStr, unit: normalizedImportedUnit }));
            const finalWorkCategoryIds = importedWorkCategoryIds || existingNorm?.workCategoryIds;
            const finalWorkCategoryId = rawWorkCategoryId
              ? String(rawWorkCategoryId).trim()
              : (finalWorkCategoryIds?.[0] || existingNorm?.workCategoryId);

            const nextInputExpressions = { ...(importedInputExpressions || existingNorm?.inputExpressions || {}) };
            delete nextInputExpressions.unitNormPerM2;
            if (generalNormFormula) nextInputExpressions.unitNormPerM2 = generalNormFormula;

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
              unitNormPerM2: generalNormFormulaValue !== null ? generalNormFormulaValue : (unitNormPerM2Num ? parseExcelNumber(unitNormPerM2Num) : undefined),
              inputExpressions: Object.keys(nextInputExpressions).length ? nextInputExpressions : undefined,
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
            `  - Hạng Mục Thi Công (Chỉ xem): bảng tham chiếu, không nhập ngược từ phân hệ Kho / Định mức\n\n` +
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
  const isNewMaterialDefinition = itemKind === 'material' && Boolean(customMaterial.trim())
    && !materialNorms.some((norm) => normalizeLinkText(norm.materialName) === normalizeLinkText(customMaterial));
  const [customMaterialCategory, setCustomMaterialCategory] = useState('Vật tư khác');
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
    const byKey = new Map<string, { name: string; displayName: string; unit: string; lastDate: string }>();
    equipmentMaster.forEach(item => {
      const key = `${normalizeMaterialSearch(item.name)}|${normalizeMaterialSearch(item.unit)}`;
      byKey.set(key, { name: item.name, displayName: item.displayName || item.name, unit: item.unit, lastDate: '' });
    });
    inventory
      .filter((item) => item.itemKind === 'equipment')
      .forEach((item) => {
        const name = String(item.materialName || '').trim();
        const unitValue = normalizeUnit(item.unit) || String(item.unit || '').trim();
        if (!name || !unitValue) return;
        const key = `${normalizeMaterialSearch(name)}|${normalizeMaterialSearch(unitValue)}`;
        const existing = byKey.get(key);
        if (!existing || compareDateValues(existing.lastDate, item.date) < 0) {
          const alias = equipmentMaster.find(master => equipmentIdentityKey(master.name) === equipmentIdentityKey(name));
          byKey.set(key, { name, displayName: alias?.displayName || name, unit: unitValue, lastDate: item.date || '' });
        }
      });
    return Array.from(byKey.values()).sort((a, b) =>
      compareDateValues(b.lastDate, a.lastDate) || naturalCompare(a.name, b.name),
    );
  }, [inventory, equipmentMaster]);

  const filteredEquipmentCatalog = useMemo(() => {
    if (!normalizedMaterialPickerSearch) return equipmentCatalog;
    return equipmentCatalog.filter((item) =>
      normalizeMaterialSearch(`${item.name} ${item.displayName} ${item.unit}`).includes(normalizedMaterialPickerSearch),
    );
  }, [equipmentCatalog, normalizedMaterialPickerSearch]);

  const warehouseCatalogRows = useMemo(() => {
    const q = normalizeMaterialSearch(warehouseCatalogSearch);
    if (warehouseCatalogTab === 'equipment') {
      return equipmentCatalog
        .filter((item) => !q || normalizeMaterialSearch(`${item.name} ${item.displayName} ${item.unit}`).includes(q))
        .map((item) => ({
          key: `equipment:${item.name}:${item.unit}`, name: item.displayName || item.name, sourceName: item.name, unit: item.unit,
          category: equipmentMaster.find(master => equipmentIdentityKey(master.name) === equipmentIdentityKey(item.name))?.category || 'Thiết bị',
          hasNorm: false,
        }));
    }
    const byKey = new Map<string, { key: string; name: string; unit: string; category: string; hasNorm: boolean }>();
    materialNorms.forEach((norm) => {
      const key = `${normalizeMaterialSearch(norm.materialName)}|${normalizeMaterialSearch(normalizeUnit(norm.unit) || norm.unit)}`;
      if (!byKey.has(key)) byKey.set(key, { key: `material:${key}`, name: norm.materialName, unit: normalizeUnit(norm.unit) || norm.unit, category: norm.category || 'Vật tư', hasNorm: true });
    });
    return Array.from(byKey.values())
      .filter((item) => !q || normalizeMaterialSearch(`${item.name} ${item.category} ${item.unit}`).includes(q))
      .sort((a, b) => compareMaterialGroupPriority(a.category, b.category)
        || naturalCompare(a.category, b.category) || naturalCompare(a.name, b.name));
  }, [warehouseCatalogTab, warehouseCatalogSearch, equipmentCatalog, equipmentMaster, materialNorms]);


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
    if (!isActive || itemKind !== 'material') return;
    if (materialNorms.length > 0) {
      const matched = materialNorms.find((m) => m.materialName === materialName);
      if (!matched) {
        setMaterialName(materialNorms[0].materialName);
        setUnit(materialNorms[0].unit);
      }
    }
  }, [isActive, itemKind, materialNorms]);

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
        normalizeMaterialSearch(stock.materialName) === normalizeMaterialSearch('sourceName' in item ? item.sourceName : item.name) &&
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
        return warehouseCatalogTab === 'material'
          ? compareMaterialGroupPriority(a.category, b.category) || direction * naturalCompare(a.name, b.name)
          : direction * naturalCompare(a.name, b.name);
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

  // Drill-down reads only the already verified inventory for the active project.
  // Same identity/unit/type keys as the stock ledger; never merge legacy Cái/Bộ.
  const catalogHistoryRows = useMemo(() => {
    if (!catalogHistory) return [];
    const key = normalizeMaterialSearch(catalogHistory.name);
    const unitKey = normalizeMaterialSearch(normalizeUnit(catalogHistory.unit) || catalogHistory.unit);
    return inventory.filter((entry) =>
      entry.deletedAt == null
      && (entry.itemKind === 'equipment' ? 'equipment' : 'material') === catalogHistory.kind
      && entry.type === catalogHistory.type
      && normalizeMaterialSearch(entry.materialName) === key
      && normalizeMaterialSearch(normalizeUnit(entry.unit) || entry.unit) === unitKey
    ).sort((a, b) => compareDateValues(b.date, a.date) || a.id.localeCompare(b.id));
  }, [catalogHistory, inventory]);
  const catalogHistoryDates = useMemo(() => {
    const grouped = new Map<string, InventoryItem[]>();
    catalogHistoryRows.forEach((entry) => {
      if (catalogHistoryStart && entry.date < catalogHistoryStart) return;
      if (catalogHistoryEnd && entry.date > catalogHistoryEnd) return;
      const date = String(entry.date || 'Không có ngày');
      grouped.set(date, [...(grouped.get(date) || []), entry]);
    });
    return Array.from(grouped.entries()).sort(([a], [b]) => compareDateValues(b, a));
  }, [catalogHistoryRows, catalogHistoryStart, catalogHistoryEnd]);
  const activeCatalogHistoryDate = expandedHistoryDate === null ? catalogHistoryDates[0]?.[0] : expandedHistoryDate;
  const catalogHistoryTotal = catalogHistoryRows.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
  useEffect(() => {
    if (!showWarehouseCatalog || !catalogHistory) return;
    const scrollBody = document.querySelector('[data-hnl-settings-sheet-scrollbody="warehouse-catalog"]');
    if (scrollBody instanceof HTMLElement) scrollBody.scrollTop = 0;
  }, [showWarehouseCatalog, catalogHistory]);

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
      const matchesKind = inventoryKindFilter === 'all'
        || (item.itemKind === 'equipment' ? 'equipment' : 'material') === inventoryKindFilter;
      const matchesSearch = !q ||
        (item.itemKind === 'equipment' ? 'thiết bị' : 'vật tư').includes(q) ||
        item.materialName.toLocaleLowerCase('vi-VN').includes(q) ||
        item.location.toLocaleLowerCase('vi-VN').includes(q) ||
        item.handler.toLocaleLowerCase('vi-VN').includes(q) ||
        item.id.toLocaleLowerCase('vi-VN').includes(q);
      return matchesType && matchesKind && matchesSearch;
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
  }, [inventory, filterType, inventoryKindFilter, searchTerm, inventorySortBy, inventorySortOrder]);

  const openCreateInventory = (kind: InventoryItemKind = 'material') => {
    if (!hasEditAccess) return;
    setEditingInventory(null);
    setPendingVoucherPhotos([]);
    setItemKind(kind);
    setType('in');
    setCustomMaterial('');
    setCustomMaterialCategory('Vật tư khác');
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
    setPendingVoucherPhotos([]);
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
    setCustomMaterialCategory('Vật tư khác');
    setMaterialPickerSearch('');
    setUnit(item.unit);
    setQuantity(item.quantity);
    setQuantityStr(item.inputExpressions?.quantity || String(item.quantity));
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
    if (!hasEditAccess || inventorySaveInFlightRef.current) return;
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
    // When editing a voucher, its old signed quantity is already included in
    // current stock. Exclude that transaction before validating a replacement.
    // The Firestore atomic update remains authoritative across users/devices.
    const availableStockSummaries = editingInventory
      ? calculateStockSummary(inventory.filter((row) => row.id !== editingInventory.id), materialNorms)
      : stockSummaries;
    const matchedStockSummary = availableStockSummaries.find((summary) =>
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
    let createdMaterialId: string | null = null;
    if (itemKind === 'material' && exactNormMaterialIds.length === 0 && customMaterial.trim()) {
      if (!hasNormManageAccess) {
        alert('Vật tư mới chưa có trong Danh mục vật tư. Tài khoản hiện tại không có quyền tạo danh mục; hãy chọn vật tư có sẵn hoặc nhờ ADMIN (Quản trị) thêm trước.');
        return;
      }
      if (!onCreateMaterialCatalog) {
        alert('Không thể tạo Danh mục vật tư lúc này. Vui lòng thử lại sau.');
        return;
      }
      const category = customMaterialCategory.trim() || 'Vật tư khác';
      createdMaterialId = await onCreateMaterialCatalog({
        materialName: finalMaterialName,
        unit: normalizedFinalUnit,
        category,
      });
      if (!createdMaterialId) {
        alert('Không thể thêm vật tư mới vào Danh mục vật tư. Phiếu kho chưa được ghi.');
        return;
      }
    }
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
      materialId: createdMaterialId
        || (exactNormMaterialIds.length === 1
          ? exactNormMaterialIds[0]
          : (exactNormMaterialIds.length === 0 && editingKeepsIdentity ? editingInventory?.materialId : undefined)),
      materialName: finalMaterialName,
      unit: normalizedFinalUnit,
      quantity: finalQuantity,
      inputExpressions: (() => {
        const next = { ...(editingInventory?.inputExpressions || {}) };
        delete next.quantity;
        if (hasMathExpression(quantityStr) && parsedQuantity !== null) next.quantity = quantityStr.trim();
        return Object.keys(next).length ? next : undefined;
      })(),
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

    const savedVoucherId = editingInventory?.id || createEntityId(type === 'in' ? 'NK' : 'XK');
    inventorySaveInFlightRef.current = true;
    try {
      if (editingInventory && onUpdateInventory) {
        await onUpdateInventory(editingInventory.id, payload);
      } else {
        await onAddInventory({ ...payload, id: savedVoucherId });
      }
      // Receipt photos use the exact committed ledger document ID across all devices.
      if (!editingInventory && currentProjectId) {
        setPhotoVoucher({ projectId: currentProjectId, id: savedVoucherId, type, materialName: finalMaterialName, initialFiles: [...pendingVoucherPhotos] });
        setPendingVoucherPhotos([]);
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
    } finally {
      inventorySaveInFlightRef.current = false;
    }
  };

  const warehouseQuickNormRows = useMemo<QuickGridRow[]>(() => {
    if (!showQuickEdit) return [];
    return materialNorms.flatMap((norm) => {
    const linkedIds = new Set<string>([
      ...(norm.workCategoryIds || []),
      ...(norm.workCategoryId ? [norm.workCategoryId] : []),
      ...Object.keys(norm.workCategoryNormsById || {}),
    ].map((value) => String(value || '').trim()).filter(Boolean));
    const linkedNames = norm.workCategories?.length
      ? norm.workCategories
      : (norm.workCategory ? [norm.workCategory] : []);
    linkedNames.forEach((name) => {
      const work = (workVolumes || []).find((item) => normalizeLinkText(item.title) === normalizeLinkText(name));
      if (work) linkedIds.add(canonicalWorkCategoryId(work));
    });

    const rows = Array.from(linkedIds).map((workCategoryId, index) => {
      const work = (workVolumes || []).find((item) => canonicalWorkCategoryId(item) === workCategoryId || item.id === workCategoryId);
      const legacyName = linkedNames[index] || '';
      const specific = norm.workCategoryNormsById?.[workCategoryId];
      const hasSpecific = specific !== undefined && specific !== null && Number.isFinite(Number(specific));
      return {
        __rowKey: `${norm.id}--${workCategoryId}`,
        __normId: norm.id,
        __workCategoryId: workCategoryId,
        __groupKey: norm.id,
        __groupPrimary: index === 0,
        materialName: norm.materialName,
        category: norm.category,
        unit: norm.unit,
        workCategory: work?.title || legacyName,
        normSource: hasSpecific ? 'Riêng theo hạng mục' : 'Dùng định mức chung',
        specificNorm: hasSpecific
          ? (norm.inputExpressions?.[`workCategoryNorm:${workCategoryId}`] || Number(specific))
          : '',
        generalNorm: norm.inputExpressions?.unitNormPerM2 || norm.unitNormPerM2 || '',
        quotaQuantity: norm.quotaQuantity ?? 0,
        notes: norm.notes || '',
      };
    });

    if (rows.length > 0) return rows;
    return [{
      __rowKey: `${norm.id}--general`,
      __normId: norm.id,
      __workCategoryId: '',
      __groupKey: norm.id,
      __groupPrimary: true,
      materialName: norm.materialName,
      category: norm.category,
      unit: norm.unit,
      workCategory: '',
      normSource: 'Định mức chung',
      specificNorm: '',
      generalNorm: norm.inputExpressions?.unitNormPerM2 || norm.unitNormPerM2 || '',
      quotaQuantity: norm.quotaQuantity ?? 0,
      notes: norm.notes || '',
    }];
  });
  }, [showQuickEdit, materialNorms, workVolumes]);

  const warehouseQuickInventoryRows = useMemo<QuickGridRow[]>(() => {
    if (!showQuickEdit) return [];
    return inventory.map((item) => {
    const floor = item.sourceFloorId ? floorPlans.find((entry) => entry.id === item.sourceFloorId) : undefined;
    const room = item.sourceRoomId ? roomProgressList.find((entry) => entry.id === item.sourceRoomId) : undefined;
    const team = item.sourceTeamId ? teams.find((entry) => entry.id === item.sourceTeamId) : undefined;
    const work = item.sourceWorkCategoryId ? (workVolumes || []).find((entry) => (entry.workCategoryId || entry.id) === item.sourceWorkCategoryId || entry.id === item.sourceWorkCategoryId) : undefined;
    const groupId = item.sourceStructureGroupId || (floor ? resolveFloorStructureGroupId(floor, normalizedStructureConfig) : '');
    return {
      __rowKey: item.id,
      __recordId: item.id,
      __type: item.type,
      itemKind: item.itemKind === 'equipment' ? 'equipment' : 'material',
      date: item.date,
      materialName: item.materialName,
      unit: item.unit,
      quantity: item.inputExpressions?.quantity || item.quantity,
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
  });
  }, [showQuickEdit, inventory, floorPlans, roomProgressList, teams, workVolumes, materialNorms, normalizedStructureConfig]);

  const warehouseQuickEquipmentRows = useMemo<QuickGridRow[]>(() => {
    if (!showQuickEdit) return [];
    // Inventory may contain Cái and Bộ vouchers for the same legacy name, but
    // metadata has ONE canonical equipment ID. Never give Quick Edit duplicate
    // __rowKey values (selection/dirty edits are keyed by this identity).
    const seenEquipmentIdentityKeys = new Set<string>();
    return equipmentCatalog.flatMap(item => {
      const key = equipmentIdentityKey(item.name);
      if (!key || seenEquipmentIdentityKeys.has(key)) return [];
      seenEquipmentIdentityKeys.add(key);
      const master = equipmentMaster.find(x => equipmentIdentityKey(x.name) === key);
      return [{
        __rowKey: master?.id || `historical-${key}`,
        __catalogId: master?.id || '',
        __catalogRevision: master?.revision,
        name: master?.name || item.name,
        displayName: master?.displayName || item.name,
        // Existing master unit is authoritative; unregistered legacy names use
        // one actual voucher unit, never a fabricated 1:1 conversion.
        unit: master?.unit || item.unit,
        category: master?.category || 'Thiết bị',
        brand: master?.brand || '', model: master?.model || '',
        specifications: master?.specifications || '', notes: master?.notes || '',
      }];
    });
  }, [showQuickEdit, equipmentCatalog, equipmentMaster]);

  const warehouseQuickStockRows = useMemo<QuickGridRow[]>(() => showQuickEdit ? stockSummaries.map((item, index) => ({
    __rowKey: `stock-${item.materialId || item.materialName}-${index}`,
    itemKind: item.itemKind,
    materialName: item.materialName,
    category: item.category,
    unit: item.unit,
    totalIn: item.totalIn,
    totalOut: item.totalOut,
    currentStock: item.currentStock,
    normQuantity: item.itemKind === 'material' ? item.normQuantity : '',
    remainingNeed: item.itemKind === 'material' ? item.remainingNeed : '',
  })) : [], [showQuickEdit, stockSummaries]);

  const warehouseMaterialOptions = useMemo(() => showQuickEdit ? Array.from(new Set([
    ...materialNorms.map((norm) => norm.materialName),
    ...inventory.map((item) => item.materialName),
  ].filter(Boolean))) : [], [showQuickEdit, materialNorms, inventory]);
  const warehouseFloorOptions = useMemo(() => showQuickEdit ? floorPlans.map((floor) => floor.floorName) : [], [showQuickEdit, floorPlans]);
  const warehouseTeamOptions = useMemo(() => showQuickEdit ? teams.map((team) => team.name) : [], [showQuickEdit, teams]);
  const warehouseWorkOptions = useMemo(() => showQuickEdit ? (workVolumes || []).map((work) => work.title) : [], [showQuickEdit, workVolumes]);
  const warehouseRoomOptions = useMemo(() => showQuickEdit ? roomProgressList.map((room) => room.roomName) : [], [showQuickEdit, roomProgressList]);

  const warehouseQuickColumns = useMemo<QuickGridColumn[]>(() => {
    if (!showQuickEdit) return [];
    if (quickEditMode === 'equipment') return [
      { key: 'name', label: 'Tên định danh kho (khóa)', editable: (row) => hasNormManageAccess && Boolean(row.__new), required: true, width: 220 },
      { key: 'displayName', label: 'Tên hiển thị (sửa được)', editable: hasNormManageAccess, width: 220 },
      { key: 'unit', label: 'ĐVT (sửa 1:1 an toàn)', editable: hasNormManageAccess, required: true, width: 150 },
      { key: 'category', label: 'Nhóm thiết bị', editable: hasNormManageAccess, width: 165 },
      { key: 'brand', label: 'Hãng', editable: hasNormManageAccess, width: 160 },
      { key: 'model', label: 'Model / Mã hiệu', editable: hasNormManageAccess, width: 160 },
      { key: 'specifications', label: 'Thông số kỹ thuật', editable: hasNormManageAccess, width: 265 },
      { key: 'notes', label: 'Ghi chú', editable: hasNormManageAccess, width: 245 },
    ];
    if (quickEditMode === 'norms') return [
      { key: 'materialName', label: 'Tên vật tư', editable: (row) => hasNormManageAccess && Boolean(row.__groupPrimary), required: true, width: 220 },
      { key: 'category', label: 'Chủng loại vật tư', editable: (row) => hasNormManageAccess && Boolean(row.__groupPrimary), required: true, width: 170 },
      { key: 'unit', label: 'ĐVT (đổi tại Danh mục)', editable: false, required: true, width: 120 },
      {
        key: 'workCategory',
        label: 'Hạng mục thi công',
        editable: hasNormManageAccess,
        type: 'select',
        options: warehouseWorkOptions,
        width: 260,
        validate: (value, row) => {
          const name = String(value || '').trim();
          if (!name) return row.__new ? 'Dòng mới phải chọn Hạng mục' : null;
          return (workVolumes || []).some((work) => normalizeLinkText(work.title) === normalizeLinkText(name))
            ? null
            : 'Hạng mục không còn trong danh mục';
        },
      },
      { key: 'specificNorm', label: 'ĐM riêng hạng mục', editable: hasNormManageAccess, type: 'number', allowExpression: true, width: 145, validate: (value) => { const raw = String(value ?? '').trim(); const parsed = raw ? evaluateMathExpression(raw) : null; return parsed !== null && parsed < 0 ? 'Không được âm' : null; } },
      { key: 'generalNorm', label: 'ĐM chung', editable: (row) => hasNormManageAccess && Boolean(row.__groupPrimary), type: 'number', allowExpression: true, width: 120, validate: (value) => { const raw = String(value ?? '').trim(); const parsed = raw ? evaluateMathExpression(raw) : null; return parsed !== null && parsed < 0 ? 'Không được âm' : null; } },
      { key: 'normSource', label: 'Nguồn định mức', editable: false, width: 155 },
      { key: 'quotaQuantity', label: 'Nhu cầu vật tư theo định mức', editable: false, type: 'number', width: 205 },
      { key: 'notes', label: 'Ghi chú / Tiêu chuẩn kỹ thuật', editable: (row) => hasNormManageAccess && Boolean(row.__groupPrimary), width: 300 },
    ];
    if (quickEditMode === 'stock') return [
      { key: 'materialName', label: 'Vật tư / Thiết bị', editable: false, width: 220 },
      { key: 'category', label: 'Chủng loại vật tư / Nhóm thiết bị', editable: false, width: 210 },
      { key: 'unit', label: 'ĐVT', editable: false, width: 90 },
      { key: 'totalIn', label: 'Tổng nhập', editable: false, type: 'number', width: 110 },
      { key: 'totalOut', label: 'Tổng xuất', editable: false, type: 'number', width: 110 },
      { key: 'currentStock', label: 'Tồn kho', editable: false, type: 'number', width: 110 },
      { key: 'normQuantity', label: 'Nhu cầu định mức', editable: false, type: 'number', width: 155 },
      { key: 'remainingNeed', label: 'Còn cần theo định mức', editable: false, type: 'number', width: 145 },
    ];
    const base: QuickGridColumn[] = [
      { key: 'date', label: 'Ngày', editable: hasImportAccess, type: 'date', required: true, width: 135 },
      { key: 'itemKind', label: 'Loại hàng', editable: (row) => hasImportAccess && Boolean(row.__new), type: 'select', options: [{ value: 'material', label: 'Vật tư' }, { value: 'equipment', label: 'Thiết bị' }], required: true, width: 115 },
      { key: 'materialName', label: 'Tên vật tư / thiết bị', editable: hasImportAccess, type: 'select', options: warehouseMaterialOptions, required: true, width: 220 },
      { key: 'unit', label: 'ĐVT (tự lấy)', editable: false, required: true, width: 120 },
      { key: 'quantity', label: 'Số lượng', editable: hasImportAccess, type: 'number', allowExpression: true, required: true, width: 110, validate: (value) => { const parsed = evaluateMathExpression(String(value ?? '')); return parsed !== null && parsed <= 0 ? 'Phải lớn hơn 0' : null; } },
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
  }, [showQuickEdit, quickEditMode, hasNormManageAccess, hasImportAccess, warehouseMaterialOptions, warehouseFloorOptions, warehouseRoomOptions, warehouseTeamOptions, warehouseWorkOptions, normalizedStructureConfig]);

  const warehouseActiveQuickRows = quickEditMode === 'equipment'
    ? warehouseQuickEquipmentRows
    : quickEditMode === 'norms'
    ? warehouseQuickNormRows
    : quickEditMode === 'stock'
      ? warehouseQuickStockRows
      : warehouseQuickInventoryRows.filter((row) => row.__type === quickEditMode);

  const saveWarehouseQuickRows = async (
    rows: QuickGridRow[],
    dirtyCellKeys: Set<string>,
    deletedRows: QuickGridRow[] = [],
  ) => {
    if (quickEditMode === 'stock') return;
    if (quickEditMode === 'equipment') {
      if (!hasNormManageAccess || !equipmentMasterReady || !currentProjectId) {
        throw new Error('Chưa xác minh danh mục thiết bị Cloud hoặc không có quyền ADMIN.');
      }
      if (deletedRows.length > 0) throw new Error('Không được xóa trực tiếp danh mục thiết bị có lịch sử.');
      const changedRows = rows.filter(row => Array.from(dirtyCellKeys).some(cell => cell.startsWith(row.__rowKey + '::')));
      if (!changedRows.length) return;
      // A catalog metadata batch is one transaction, but voucher/balance unit migrations
      // are separate transactions per identity. Never partially save a mixed bulk edit.
      const changedUnitRows = changedRows.filter(row => {
        const original = warehouseQuickEquipmentRows.find(item => item.__rowKey === row.__rowKey);
        return original && !row.__new && !areSameUnit(String(original.unit || ''), String(row.unit || ''));
      });
      if (changedUnitRows.length && changedRows.length !== 1) {
        alert('Có thiết bị đổi ĐVT trong nhiều dòng chỉnh sửa. Để tránh lưu một phần dữ liệu, hãy lưu riêng từng thiết bị cần đổi ĐVT; các dòng chỉ sửa thông tin có thể lưu chung.');
        return false;
      }
      const drafts: EquipmentCatalogInput[] = changedRows.map(row => {
        const name = String(row.name || '').trim();
        const unit = normalizeUnit(String(row.unit || '').trim()) || String(row.unit || '').trim();
        // A new metadata row for legacy vouchers may select ONE unit already
        // present in Cloud history. saveEquipmentCatalogBatch checks that on
        // the server; mismatched other vouchers must not block metadata edits.
        return {
          id: String(row.__catalogId || '') || undefined,
          revision: row.__catalogRevision === undefined ? undefined : Number(row.__catalogRevision),
          name, displayName: String(row.displayName || name).trim(), unit, category: String(row.category || 'Thiết bị'),
          brand: String(row.brand || ''), model: String(row.model || ''),
          specifications: String(row.specifications || ''), notes: String(row.notes || ''),
        };
      });
      if (changedUnitRows.length) {
        // The only dirty row is a 1:1 unit correction; keep its metadata in the
        // same atomic operation as all affected vouchers and balances.
        const row = changedUnitRows[0];
        const draft = drafts[0];
        const original = warehouseQuickEquipmentRows.find(item => item.__rowKey === row.__rowKey);
        const fromUnit = normalizeUnit(String(original?.unit || '')) || String(original?.unit || '').trim();
        if (!original || !fromUnit || !onRenameWarehouseUnit) {
          alert('Chưa thể đổi ĐVT: thiếu đơn vị gốc hoặc chức năng đồng bộ phiếu kho. Chưa lưu dữ liệu.');
          return false;
        }
        const approved = await confirmAsync(
          `Đổi ĐVT thiết bị “${draft.name}” từ “${fromUnit}” thành “${draft.unit}”?\n`
          + 'Nếu có phiếu kho, danh mục, phiếu nhập/xuất và tồn kho sẽ được đồng bộ trong MỘT giao dịch. '
          + 'Chỉ sửa nhãn ghi nhầm theo tỷ lệ 1:1, KHÔNG quy đổi số lượng (Bộ không mặc định bằng Cái).',
          { title: 'Xác nhận đổi ĐVT thiết bị', confirmLabel: 'Kiểm tra và lưu', cancelLabel: 'Hủy' },
        );
        if (!approved) return false;
        const master = equipmentMaster.find(item => item.id === String(row.__catalogId || ''));
        const equipmentMetadata = {
          displayName: draft.displayName || draft.name, category: draft.category,
          brand: draft.brand || '', model: draft.model || '',
          specifications: draft.specifications || '', notes: draft.notes || '',
          expectedRevision: master?.revision,
        };
        const migrate = async (unitOnCloud: string) => {
          if (!areSameUnit(unitOnCloud, fromUnit)) {
            throw new Error('ĐVT gốc đã thay đổi trên Cloud. Hãy tải lại trước khi sửa.');
          }
          await onRenameWarehouseUnit({
            kind: 'equipment', materialName: draft.name,
            fromUnit: unitOnCloud, toUnit: draft.unit, equipmentMetadata,
          });
        };
        try {
          const hasLocalVouchers = inventory.some(item =>
            item.itemKind === 'equipment'
            && equipmentIdentityKey(item.materialName) === equipmentIdentityKey(draft.name));
          if (hasLocalVouchers) {
            await migrate(fromUnit);
          } else {
            try {
              await saveEquipmentCatalogBatch(currentProjectId, drafts);
            } catch (error) {
              // Cloud history may be absent from the local cache. A typed
              // conflict means the server demands an atomic ledger migration.
              if (!(error instanceof EquipmentUnitMigrationRequiredError)) throw error;
              await migrate(error.storedUnit);
            }
          }
        } catch (error) {
          alert('Chưa lưu ĐVT thiết bị: ' + (error instanceof Error ? error.message : String(error)));
          return false;
        }
        return;
      }
      if (!(await confirmAsync(`Lưu thông số ${drafts.length} thiết bị? Không chỉnh phiếu kho/tồn kho.`))) return false;
      await saveEquipmentCatalogBatch(currentProjectId, drafts);
      return;
    }
    const dirtyRowKeys = new Set(Array.from(dirtyCellKeys).map((key) => key.split('::')[0]));
    const dirtyRows = rows.filter((row) => dirtyRowKeys.has(row.__rowKey));

    if (quickEditMode === 'norms') {
      if (!hasNormManageAccess || !onImportNorms) return;
      const affectedNormIds = new Set<string>([
        ...dirtyRows.map((row) => String(row.__normId || '').trim()),
        ...deletedRows.map((row) => String(row.__normId || '').trim()),
      ].filter(Boolean));
      if (!affectedNormIds.size) return;

      const byId = new Map<string, MaterialNorm>(materialNorms.map((norm) => [norm.id, norm] as const));

      for (const normId of affectedNormIds) {
        const existing = byId.get(normId);
        if (!existing) throw new Error(`Không tìm thấy vật tư gốc cho __normId ${normId}. Hệ thống đã hủy để tránh tạo nhầm vật tư.`);

        const groupRows = rows.filter((row) => String(row.__normId || '').trim() === normId);
        if (!groupRows.length) throw new Error(`Không thể xóa toàn bộ dòng của vật tư “${existing.materialName}” trong Bảng chỉnh nhanh.`);
        const primary = groupRows.find((row) => row.__groupPrimary) || groupRows[0];

        const nextMaterialName = String(primary.materialName || '').trim();
        const nextCategory = String(primary.category || '').trim();
        const nextUnit = normalizeUnit(String(primary.unit || '').trim()) || String(primary.unit || '').trim();
        if (!nextMaterialName || !nextCategory || !nextUnit) throw new Error('Tên vật tư, Chủng loại vật tư và ĐVT không được để trống.');

        const duplicateMaterial = materialNorms.find((norm) =>
          norm.id !== normId
          && normalizeLinkText(norm.materialName) === normalizeLinkText(nextMaterialName)
          && (normalizeUnit(norm.unit) || norm.unit) === nextUnit
        );
        if (duplicateMaterial) {
          throw new Error(`Vật tư “${nextMaterialName}” / ${nextUnit} đã tồn tại. Hệ thống hủy để tránh tạo hai vật tư trùng.`);
        }

        const oldUnit = normalizeUnit(existing.unit) || existing.unit;
        if (oldUnit !== nextUnit) {
          const stableMaterialId = resolveNormMaterialId(existing);
          const hasWarehouseHistory = inventory.some((item) =>
            String(item.materialId || '').trim() === stableMaterialId
            || (!item.materialId
              && normalizeLinkText(item.materialName) === normalizeLinkText(existing.materialName)
              && (normalizeUnit(item.unit) || item.unit) === oldUnit)
          );
          if (hasWarehouseHistory) {
            throw new Error(`Không thể đổi ĐVT của “${existing.materialName}” vì đã có lịch sử Nhập/Xuất kho. Hãy giữ ĐVT cũ để bảo toàn số liệu và materialId.`);
          }
        }

        const selectedIds: string[] = [];
        const selectedNames: string[] = [];
        const selectedSpecific: Record<string, number> = {};
        const seenIds = new Set<string>();

        for (const row of groupRows) {
          const workName = String(row.workCategory || '').trim();
          if (!workName) {
            if (row.__new) throw new Error(`Dòng mới của “${nextMaterialName}” phải chọn Hạng mục thi công.`);
            continue;
          }
          const work = (workVolumes || []).find((item) => normalizeLinkText(item.title) === normalizeLinkText(workName));
          if (!work) throw new Error(`Hạng mục thi công “${workName}” không còn trong danh mục.`);
          const categoryId = canonicalWorkCategoryId(work);
          if (seenIds.has(categoryId)) throw new Error(`Vật tư “${nextMaterialName}” đang có hai dòng cùng Hạng mục “${workName}”.`);
          seenIds.add(categoryId);
          selectedIds.push(categoryId);
          selectedNames.push(work.title);
          const specificRaw = String(row.specificNorm ?? '').trim();
          if (specificRaw !== '') {
            const specific = evaluateMathExpression(specificRaw);
            if (specific === null || specific < 0) throw new Error(`ĐM riêng của “${workName}” không hợp lệ.`);
            selectedSpecific[categoryId] = specific;
          }
        }

        const generalRaw = String(primary.generalNorm ?? '').trim();
        const generalNorm = generalRaw === '' ? undefined : evaluateMathExpression(generalRaw);
        if (generalRaw !== '' && (generalNorm === null || generalNorm < 0)) throw new Error('ĐM chung không hợp lệ.');
        const inputExpressions = { ...(existing.inputExpressions || {}) };
        delete inputExpressions.unitNormPerM2;
        Object.keys(inputExpressions).filter((key) => key.startsWith('workCategoryNorm:')).forEach((key) => delete inputExpressions[key]);
        if (generalRaw && hasMathExpression(generalRaw) && generalNorm !== null) inputExpressions.unitNormPerM2 = generalRaw;
        groupRows.forEach((row) => {
          const workName = String(row.workCategory || '').trim();
          const work = (workVolumes || []).find((item) => normalizeLinkText(item.title) === normalizeLinkText(workName));
          const raw = String(row.specificNorm ?? '').trim();
          if (!work || !hasMathExpression(raw) || evaluateMathExpression(raw) === null) return;
          inputExpressions[`workCategoryNorm:${canonicalWorkCategoryId(work)}`] = raw;
        });
        // quotaQuantity is derived centrally in App.tsx from WorkVolume × norm factor.
        // Never persist a Quick Edit override as a second source of truth.
        const quotaQuantity = Number(existing.quotaQuantity || 0);

        byId.set(normId, {
          ...existing,
          materialName: nextMaterialName,
          category: nextCategory,
          unit: nextUnit,
          quotaQuantity,
          unitNormPerM2: generalNorm ?? undefined,
          inputExpressions: Object.keys(inputExpressions).length ? inputExpressions : undefined,
          notes: String(primary.notes || '').trim() || undefined,
          workCategory: selectedNames[0],
          workCategoryId: selectedIds[0],
          workCategories: selectedNames.length ? selectedNames : undefined,
          workCategoryIds: selectedIds.length ? selectedIds : undefined,
          workCategoryNormsById: Object.keys(selectedSpecific).length ? selectedSpecific : undefined,
        });
      }

      const confirmed = await confirmAsync(
        `Lưu thay đổi Định mức cho ${affectedNormIds.size} vật tư?\n\n`
        + 'Tên/Chủng loại vật tư/ĐVT/ĐM chung/Nhu cầu định mức/Ghi chú được lấy từ dòng đại diện; các dòng con chỉ quản lý liên kết Hạng mục và ĐM riêng. materialId được giữ nguyên.'
      );
      if (!confirmed) return false;
      onImportNorms(Array.from(byId.values()));
      return;
    }

    if (!hasImportAccess) return;
    const deleteIds = deletedRows
      .map((row) => String(row.__recordId || row.__rowKey || '').trim())
      .filter((id) => Boolean(id) && inventory.some((item) => item.id === id));
    if (!dirtyRows.length && !deleteIds.length) return;
    if (dirtyRows.length && !onImportInventory) return;

    const upserts: InventoryItem[] = dirtyRows.map((row) => {
      const existing = inventory.find((item) => item.id === String(row.__recordId || row.__rowKey));
      const materialNameValue = String(row.materialName || '').trim();
      const resolvedItemKind: InventoryItemKind = existing
        ? (existing.itemKind === 'equipment' ? 'equipment' : 'material')
        : (row.itemKind === 'equipment' ? 'equipment' : 'material');
      // Unit comes from the selected catalog identity, NEVER a stale spreadsheet cell.
      const candidateNorms = resolvedItemKind === 'material'
        ? materialNorms.filter((item) => normalizeLinkText(item.materialName) === normalizeLinkText(materialNameValue))
        : [];
      const existingNorm = candidateNorms.find((item) => resolveNormMaterialId(item) === existing?.materialId);
      const uniqueUnits = Array.from(new Set(candidateNorms.map((item) => normalizeUnit(item.unit) || item.unit)));
      const norm = existingNorm || (uniqueUnits.length === 1 ? candidateNorms[0] : undefined);
      if (resolvedItemKind === 'material' && !norm) {
        throw new Error(`Không xác định được duy nhất ĐVT cho “${materialNameValue}”. Hãy chọn tại phiếu hoặc Định mức.`);
      }
      const equipmentUnits = resolvedItemKind === 'equipment'
        ? Array.from(new Set(equipmentCatalog.filter((item) => normalizeLinkText(item.name) === normalizeLinkText(materialNameValue)).map((item) => normalizeUnit(item.unit) || item.unit)))
        : [];
      if (resolvedItemKind === 'equipment' && equipmentUnits.length !== 1) {
        throw new Error(`Thiết bị “${materialNameValue}” chưa có ĐVT danh mục duy nhất. Hãy tạo/chỉnh trong Danh mục thiết bị.`);
      }
      const canonicalUnit = norm?.unit || equipmentUnits[0];
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
        itemKind: resolvedItemKind,
        materialId: resolvedItemKind === 'material'
          ? (norm ? resolveNormMaterialId(norm) : existing?.materialId)
          : undefined,
        materialName: materialNameValue,
        unit: normalizeUnit(canonicalUnit) || canonicalUnit,
        quantity: Math.max(0, evaluateMathExpression(String(row.quantity ?? '')) ?? 0),
        inputExpressions: (() => {
          const next = { ...(existing?.inputExpressions || {}) };
          const raw = String(row.quantity ?? '').trim();
          delete next.quantity;
          if (hasMathExpression(raw) && evaluateMathExpression(raw) !== null) next.quantity = raw;
          return Object.keys(next).length ? next : undefined;
        })(),
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

    const confirmed = await confirmAsync(
      `Bảng chỉnh nhanh ${quickEditMode === 'in' ? 'Nhập kho' : 'Xuất kho'}:\n\n`
      + `• ${upserts.length} phiếu thêm/sửa\n`
      + `• ${deleteIds.length} phiếu chờ xóa\n\n`
      + 'Tồn kho sẽ được tính lại từ sổ giao dịch. Tiếp tục?'
    );
    if (!confirmed) return false;

    if (upserts.length > 0 && onImportInventory) await onImportInventory(upserts);
    if (deleteIds.length > 0) {
      if (!hasDeleteAccess) throw new Error('Tài khoản hiện tại không có quyền xóa dữ liệu Kho.');
      if (onDeleteMultipleInventory) await onDeleteMultipleInventory(deleteIds);
      else for (const id of deleteIds) await onDeleteInventory(id);
    }
  };

  return (
    <div className="p-4 space-y-4 pb-24 w-full max-w-6xl mx-auto">
      {/* Title & horizontal PC actions */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-blue-600" />
            {t('warehouse_title')}
          </h2>
          <p className="text-xs text-slate-500">{t('warehouse_subtitle')}</p>
        </div>

        <div
          onDragOver={hasImportAccess ? handleDragOverExcel : undefined}
          onDragLeave={hasImportAccess ? handleDragLeaveExcel : undefined}
          onDrop={hasImportAccess ? handleDropExcel : undefined}
          className={`grid w-full grid-cols-2 gap-2 rounded-xl transition-all lg:w-auto lg:grid-flow-col lg:auto-cols-max lg:grid-cols-none lg:items-center ${isDraggingExcel ? 'ring-2 ring-emerald-400 ring-offset-2' : ''}`}
        >
          {hasEditAccess && (
            <button
              onClick={() => openCreateInventory('material')}
              data-hnl-primary-action="warehouse-create"
              className="order-first col-span-2 flex h-11 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-extrabold text-white shadow-md transition-all hover:bg-blue-700 active:scale-[0.99] lg:order-none lg:col-span-1 lg:h-10 lg:px-3 lg:text-xs"
            >
              <Plus className="w-4 h-4" />
              Tạo phiếu
            </button>
          )}
          <div data-hnl-secondary-action-group="warehouse" className="order-2 col-span-2 grid grid-cols-3 gap-2 lg:contents">
            <button
              type="button"
              onClick={() => { setCatalogHistory(null); setWarehouseCatalogTab('material'); setWarehouseCatalogSearch(''); setShowWarehouseCatalog(true); }}
              className="flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2 text-[11px] font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.99] lg:px-3 lg:text-xs"
              title="Xem danh mục và tồn kho vật tư, thiết bị của dự án"
            >
              <Layers className="h-4 w-4 shrink-0 text-slate-600" />
              <span className="sm:hidden">Danh mục</span>
              <span className="hidden sm:inline">Danh mục kho</span>
            </button>
            <button
              onClick={() => onOpenNormModal('material')}
              className="flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2 text-[11px] font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.99] lg:px-3 lg:text-xs"
              title={hasNormManageAccess ? 'Chỉnh thông tin vật tư, thiết bị và định mức' : 'Xem vật tư, thiết bị và định mức'}
            >
              <Sliders className="h-4 w-4 shrink-0 text-slate-600" />
              <span>Thiết lập</span>
            </button>
            <DataManagementMenu
              fillMobile
              triggerLabel="Quản lý dữ liệu"
              onQuickEdit={quickEditEnabled ? (() => { setQuickEditMode('norms'); setShowQuickEdit(true); }) : undefined}
              onExportEdit={() => import('../utils/excelExport').then(({ exportWarehouseUpdateTemplate }) => exportWarehouseUpdateTemplate(materialNorms, workVolumes || [], inventory, undefined, {
                floorPlans,
                roomProgressList,
                teams,
                structureConfig: normalizedStructureConfig,
              }))}
              onImportFile={hasImportAccess ? handleFileChangeExcel : undefined}
              onDownloadTemplate={() => import('../utils/excelExport').then(({ exportWarehouseUpdateTemplate }) => exportWarehouseUpdateTemplate(materialNorms, workVolumes || [], [], undefined, {
                floorPlans,
                roomProgressList,
                teams,
                structureConfig: normalizedStructureConfig,
              }))}
              exportLabel="Xuất dữ liệu Kho để chỉnh sửa"
              importLabel="Nhập dữ liệu Kho đã chỉnh sửa"
              templateLabel="Tải mẫu Kho / Định mức"
            />
          </div>
        </div>
      </div>

      <SettingsFeatureSheet
        open={showWarehouseCatalog}
        onClose={() => { setShowWarehouseCatalog(false); setCatalogHistory(null); }}
        sheetKey="warehouse-catalog"
        icon={Layers}
        iconClassName="text-indigo-600"
        title={catalogHistory ? (catalogHistory.type === 'in' ? 'Chi tiết nhập kho' : 'Chi tiết xuất kho') : 'Danh mục kho'}
        description={catalogHistory ? `${catalogHistory.displayName} · ${catalogHistory.unit}` : 'Tổng hợp vật tư và thiết bị theo nhập, xuất, tồn kho; vật tư còn có thông tin nhu cầu theo định mức.'}
        bodyClassName="space-y-3"
      >
        <div className="space-y-3">
          {catalogHistory ? (
            <div data-hnl-catalog-history-view="visible">
            <div data-hnl-catalog-history="readonly" role="region" aria-label="Chi tiết lịch sử nhập xuất kho" className="rounded-xl border border-indigo-200 bg-white p-3 shadow-sm space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-sm font-extrabold text-slate-800">{catalogHistory.type === 'in' ? 'Chi tiết nhập kho' : 'Chi tiết xuất kho'}</h4>
                  <p className="text-xs text-slate-600 break-words">{catalogHistory.displayName} · {catalogHistory.unit} · {catalogHistory.kind === 'equipment' ? 'Thiết bị' : 'Vật tư'}</p>
                </div>
                <button type="button" onClick={() => setCatalogHistory(null)} className="min-h-10 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-indigo-700">← Danh mục kho</button>
              </div>
              <p className="text-xs font-bold text-slate-700">Tổng {catalogHistory.type === 'in' ? 'nhập' : 'xuất'}: {formatDecimal(catalogHistory.expectedTotal)} {catalogHistory.unit} · {catalogHistoryRows.length} giao dịch</p>
              {Math.abs(catalogHistoryTotal - catalogHistory.expectedTotal) > 0.000001 && (
                <p role="alert" className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Dữ liệu chi tiết hiện tại ({formatDecimal(catalogHistoryTotal)}) chưa khớp tổng danh mục. Vui lòng đồng bộ lại trước khi đối chiếu; không tự điều chỉnh phiếu.</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-slate-600">Từ ngày<input type="date" value={catalogHistoryStart} max={catalogHistoryEnd || undefined} onChange={(e) => setCatalogHistoryStart(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-900" /></label>
                <label className="text-xs font-semibold text-slate-600">Đến ngày<input type="date" value={catalogHistoryEnd} min={catalogHistoryStart || undefined} onChange={(e) => setCatalogHistoryEnd(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-900" /></label>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {catalogHistoryDates.length === 0 ? <p className="text-xs text-slate-500">Không có giao dịch phù hợp khoảng ngày đã chọn.</p> : catalogHistoryDates.map(([date, entries]) => (
                  <div key={date} className="rounded-lg border border-slate-200">
                    <button type="button" aria-expanded={activeCatalogHistoryDate === date} onClick={() => setExpandedHistoryDate(current => (current === null ? catalogHistoryDates[0]?.[0] : current) === date ? '' : date)} className="flex w-full items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-left text-xs font-bold text-slate-800">
                      <span>{formatDateDDMMYYYY(date)} · {entries.length} lần</span>
                      <span>{formatDecimal(entries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0))} {catalogHistory.unit} {activeCatalogHistoryDate === date ? '▲' : '▼'}</span>
                    </button>
                    {activeCatalogHistoryDate === date && <div className="divide-y divide-slate-100">
                      {entries.map(entry => <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 p-2 text-xs">
                        <div className="min-w-0 space-y-1"><p className="break-all font-semibold text-slate-700">Mã phiếu: {entry.id}</p><p className="text-slate-600">{entry.handler || 'Chưa ghi người thực hiện'}{entry.location ? ` · ${entry.location}` : ''}</p>{entry.notes && <p className="break-words text-slate-500">{entry.notes}</p>}</div>
                        <span className="font-extrabold text-slate-800">{formatDecimal(entry.quantity)} {entry.unit}</span>
                      </div>)}
                    </div>}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">Chỉ xem lịch sử; không tạo phiếu mới, không thay đổi tồn kho hoặc quyền chỉnh sửa.</p>
            </div>
            </div>
          ) : (
            <>
          <div data-hnl-nested-nav="warehouse-catalog" className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
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
            {roleResolved && (
              <button
                type="button"
                onClick={() => { setShowWarehouseCatalog(false); onOpenNormModal(warehouseCatalogTab, undefined, true); }}
                data-hnl-catalog-settings-link="true"
                className="inline-flex shrink-0 items-center justify-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
                title={warehouseCatalogTab === 'equipment' ? 'Mở quản lý thông số thiết bị' : 'Mở quản lý vật tư và định mức'}
              >
                <Sliders className="h-4 w-4" />
                {warehouseCatalogTab === 'equipment' ? 'Thiết lập thiết bị' : 'Thiết lập vật tư'}
              </button>
            )}
          </div>

          <QuickSortBar<WarehouseCatalogSortKey>
            itemCount={warehouseCatalogStockRows.length}
            options={[
              { key: 'name', label: warehouseCatalogTab === 'equipment' ? 'Tên thiết bị' : 'Tên vật tư', kind: 'alpha', defaultOrder: 'asc' },
              { key: 'category', label: warehouseCatalogTab === 'equipment' ? 'Nhóm thiết bị' : 'Chủng loại vật tư', kind: 'alpha', defaultOrder: 'asc' },
              { key: 'unit', label: 'ĐVT', kind: 'alpha', defaultOrder: 'asc' },
              { key: 'totalIn', label: 'Nhập', kind: 'number', defaultOrder: 'desc' },
              { key: 'totalOut', label: 'Xuất', kind: 'number', defaultOrder: 'desc' },
              ...(warehouseCatalogTab === 'material'
                ? [{ key: 'normQuantity' as const, label: 'Nhu cầu định mức', kind: 'number' as const, defaultOrder: 'desc' as const }]
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
            <div className="min-w-[900px]">
              <div data-hnl-warehouse-catalog-header="aligned" className="grid grid-cols-[minmax(180px,1.6fr)_150px_52px_64px_64px_120px_76px_82px] items-center gap-2 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600">
                <span>Tên {warehouseCatalogTab === 'equipment' ? 'thiết bị' : 'vật tư'}</span>
                <span>{warehouseCatalogTab === 'equipment' ? 'Nhóm thiết bị' : 'Chủng loại vật tư'}</span>
                <span>ĐVT</span>
                <span className="text-right">Nhập</span>
                <span className="text-right">Xuất</span>
                <span className="whitespace-nowrap text-right leading-none">Nhu cầu định mức</span>
                <span className="text-right">Tồn kho</span>
                <span className="text-right" title="Tổng nhập / Nhu cầu định mức toàn dự án">% Nhập/ĐM</span>
              </div>
              <div className="max-h-[46vh] divide-y divide-slate-100 overflow-y-auto">
                {warehouseCatalogStockRows.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-slate-500">
                    {warehouseCatalogTab === 'equipment' ? 'Chưa có thiết bị. Bạn có thể thêm trước trong Vật tư & Thiết bị.' : 'Không có vật tư phù hợp.'}
                  </div>
                ) : warehouseCatalogStockRows.map((item) => (
                  <div key={item.key} className="grid grid-cols-[minmax(180px,1.6fr)_150px_52px_64px_64px_120px_76px_82px] items-center gap-2 px-3 py-0.5 text-xs">
                    <div className="min-w-0">
                      <button type="button"
                        data-hnl-catalog-open-master={item.key}
                        onClick={() => {
                          const scrollBody = document.querySelector<HTMLElement>('[data-hnl-settings-sheet-scrollbody="warehouse-catalog"]');
                          catalogScrollReturnTopRef.current = scrollBody?.scrollTop ?? 0;
                          catalogReturnItemKeyRef.current = item.key;
                          setShowWarehouseCatalog(false);
                          onOpenNormModal(warehouseCatalogTab, {
                            name: 'sourceName' in item ? item.sourceName : item.name,
                            unit: item.unit,
                          }, true);
                        }}
                        className="flex min-h-10 w-full min-w-0 items-center rounded-md text-left whitespace-normal break-words font-bold leading-snug text-slate-800 transition-colors hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-600"
                        aria-label={`Mở quản lý ${warehouseCatalogTab === 'equipment' ? 'thiết bị' : 'định mức vật tư'} ${item.name}, đơn vị ${item.unit}`}
                        title={warehouseCatalogTab === 'equipment' ? 'Mở thông tin thiết bị' : 'Mở định mức vật tư'}
                      >{item.name}</button>
                    </div>
                    <span className="min-w-0 whitespace-normal break-words text-slate-500">{item.category}</span>
                    <span className="break-words text-slate-600">{item.unit}</span>
                    <button type="button" data-hnl-catalog-in-history={item.key}
                      onClick={() => { setCatalogHistory({ kind: warehouseCatalogTab, name: 'sourceName' in item ? item.sourceName : item.name, displayName: item.name, unit: item.unit, type: 'in', expectedTotal: item.totalIn }); setCatalogHistoryStart(''); setCatalogHistoryEnd(''); setExpandedHistoryDate(null); }}
                      className="min-h-10 rounded px-1 text-right font-semibold text-emerald-700 underline decoration-dotted underline-offset-2 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-600"
                      aria-label={`Xem chi tiết nhập kho ${item.name}: ${formatDecimal(item.totalIn)} ${item.unit}`}>
                      {formatDecimal(item.totalIn)}</button>
                    <button type="button" data-hnl-catalog-out-history={item.key}
                      onClick={() => { setCatalogHistory({ kind: warehouseCatalogTab, name: 'sourceName' in item ? item.sourceName : item.name, displayName: item.name, unit: item.unit, type: 'out', expectedTotal: item.totalOut }); setCatalogHistoryStart(''); setCatalogHistoryEnd(''); setExpandedHistoryDate(null); }}
                      className="min-h-10 rounded px-1 text-right font-semibold text-amber-700 underline decoration-dotted underline-offset-2 hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-amber-600"
                      aria-label={`Xem chi tiết xuất kho ${item.name}: ${formatDecimal(item.totalOut)} ${item.unit}`}>
                      {formatDecimal(item.totalOut)}</button>
                    <span className="text-right font-semibold text-indigo-700">
                      {warehouseCatalogTab === 'material' ? formatDecimal(item.normQuantity || 0) : '—'}
                    </span>
                    <span className="text-right font-extrabold text-blue-700">{formatDecimal(item.currentStock)}</span>
                    <span className={`text-right font-bold tabular-nums ${warehouseCatalogTab !== 'material' || !Number.isFinite(Number(item.normQuantity)) || Number(item.normQuantity) <= 0 ? 'text-slate-400' : item.totalIn > Number(item.normQuantity) ? 'text-rose-700' : item.totalIn >= Number(item.normQuantity) * 0.9 ? 'text-amber-700' : 'text-emerald-700'}`}
                      title={warehouseCatalogTab === 'material' && Number(item.normQuantity) > 0 ? `Tổng nhập ${formatDecimal(item.totalIn)} / Nhu cầu định mức ${formatDecimal(item.normQuantity)} toàn dự án` : 'Không áp dụng / chưa có nhu cầu định mức'}>
                      {warehouseCatalogTab === 'material' && Number.isFinite(Number(item.normQuantity)) && Number(item.normQuantity) > 0
                        ? `${formatDecimal(Math.round((item.totalIn / Number(item.normQuantity)) * 10_000) / 100)}%`
                        : '—'}
                    </span>
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
            </>
          )}
        </div>
      </SettingsFeatureSheet>



      {quickEditEnabled && showQuickEdit && <React.Suspense fallback={null}>
      <LazyQuickEditGridModal
        open={showQuickEdit}
        title="Bảng chỉnh nhanh · Kho vật tư & thiết bị"
        subtitle={quickEditMode === 'equipment'
          ? 'Sửa Tên hiển thị, ĐVT và thông số thiết bị. Tên định danh kho vẫn khóa; đổi ĐVT có phiếu phải xác nhận đồng bộ 1:1 từng thiết bị.'
          : quickEditMode === 'stock'
          ? 'Tồn kho là số tính từ Tổng nhập - Tổng xuất và luôn chỉ đọc.'
          : quickEditMode === 'norms'
            ? 'Mỗi vật tư là một cụm dữ liệu. Dòng đại diện sửa Tên/Chủng loại vật tư/ĐVT/ĐM chung/Nhu cầu định mức/Ghi chú và tự đồng bộ các dòng con; dòng con sửa Hạng mục + ĐM riêng.'
            : 'Chỉnh trực tiếp theo cột/dòng; dữ liệu chỉ ghi khi bấm Lưu.'}
        tabs={[
          { key: 'norms', label: 'Định mức vật tư' },
          { key: 'equipment', label: 'Thiết bị' },
          { key: 'in', label: 'Nhập kho' },
          { key: 'out', label: 'Xuất kho' },
          { key: 'stock', label: 'Tồn kho 🔒' },
        ]}
        activeTab={quickEditMode}
        onTabChange={(key) => setQuickEditMode(key as 'norms' | 'equipment' | 'in' | 'out' | 'stock')}
        columns={warehouseQuickColumns}
        rows={warehouseActiveQuickRows}
        canEdit={quickEditMode === 'stock' ? false : quickEditMode === 'norms' || quickEditMode === 'equipment' ? hasNormManageAccess && (quickEditMode !== 'equipment' || equipmentMasterReady) : hasImportAccess}
        canAddRows={quickEditMode === 'norms' ? hasNormManageAccess : quickEditMode === 'equipment' ? hasNormManageAccess && equipmentMasterReady : quickEditMode === 'in' || quickEditMode === 'out' ? hasImportAccess : false}
        canDeleteRows={quickEditMode === 'norms' ? hasNormManageAccess : quickEditMode === 'in' || quickEditMode === 'out' ? hasDeleteAccess : false}
        requiresAnchorForInsert={quickEditMode === 'norms'}
        syncGroupColumns={quickEditMode === 'norms' ? ['materialName', 'category', 'unit', 'generalNorm', 'notes'] : []}
        spreadsheetSelection
        getRowDeleteBlockReason={(row, currentRows) => {
          if (quickEditMode !== 'norms') return null;
          const normId = String(row.__normId || '').trim();
          const workName = String(row.workCategory || '').trim();
          if (!normId || !workName) return 'Dòng ĐM chung đại diện không được xóa trong Bảng chỉnh nhanh.';
          const linkedCount = currentRows.filter((item) =>
            String(item.__normId || '').trim() === normId && String(item.workCategory || '').trim()
          ).length;
          return linkedCount <= 1
            ? 'Không thể xóa Hạng mục cuối cùng của vật tư trong Bảng chỉnh nhanh. Hãy quản lý liên kết này ở màn Định mức vật tư.'
            : null;
        }}
        createEmptyRow={(index, anchorRow) => quickEditMode === 'equipment' ? ({
          __rowKey: `new-equipment-${Date.now()}-${index}`, __new: true,
          name: '', unit: 'Cái', category: 'Thiết bị', brand: '', model: '',
          specifications: '', notes: '',
        }) : quickEditMode === 'norms' ? (anchorRow ? ({
          __rowKey: `new-norm-${String(anchorRow.__normId || anchorRow.__groupKey || 'unknown')}-${Date.now()}-${index}`,
          __new: true,
          __normId: String(anchorRow.__normId || anchorRow.__groupKey || ''),
          __workCategoryId: '',
          __groupKey: String(anchorRow.__normId || anchorRow.__groupKey || ''),
          __groupPrimary: false,
          materialName: String(anchorRow.materialName || ''),
          category: String(anchorRow.category || ''),
          unit: String(anchorRow.unit || ''),
          workCategory: '',
          normSource: 'Dùng định mức chung',
          specificNorm: '',
          generalNorm: anchorRow.generalNorm ?? '',
          quotaQuantity: anchorRow.quotaQuantity ?? 0,
          notes: String(anchorRow.notes || ''),
        }) : null) : ({
          __rowKey: `new-${quickEditMode}-${Date.now()}-${index}`,
          __new: true,
          __recordId: '',
          __type: quickEditMode,
          itemKind: 'material',
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
      </React.Suspense>}

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
              <h3 className="text-sm font-extrabold text-slate-900">Gợi ý vật tư tổng hợp · Nhu cầu theo phạm vi</h3>
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
            title="Gợi ý vật tư tổng hợp · Nhu cầu theo phạm vi"
            description={normalizedStructureConfig.enabled ? `Theo ${normalizedStructureConfig.label} · Tầng · Căn · Hạng mục · Đội` : 'Theo tầng · Theo căn · Theo hạng mục đã khai · Theo đội'}
            bodyClassName="space-y-3"
          >
            <div id="material-need-details" className="flex min-w-0 flex-col gap-3">
              <p className="text-[11px] text-slate-600">
                Có thể chọn {normalizedStructureConfig.enabled ? `${normalizedStructureConfig.label}, ` : ''}một hoặc nhiều tầng, căn/phòng, hạng mục thi công đã khai và đội thi công. Để trống bộ lọc nghĩa là chọn tất cả. Hệ thống sử dụng chung một bộ tính nhu cầu vật tư từ dữ liệu gốc, sau đó mới lọc và tổng hợp để tránh tính trùng khối lượng.
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
                    placeholder="Tìm vật tư, chủng loại vật tư, đơn vị..."
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
                  { key: 'category', label: 'Chủng loại vật tư', kind: 'alpha', defaultOrder: 'asc' },
                  { key: 'unit', label: 'ĐVT', kind: 'alpha', defaultOrder: 'asc' },
                  { key: 'remaining', label: 'Còn cần theo phạm vi', kind: 'number', defaultOrder: 'desc' },
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
                    <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600"><tr><th className="p-2 text-left">Vật tư</th><th className="p-2 text-left">Chủng loại vật tư</th><th className="p-2 text-left">ĐVT</th><th className="p-2 text-right">Nhu cầu theo phạm vi</th><th className="p-2 text-right">Đã xuất</th>{hasMaterialAllocationFilter && <th className="p-2 text-right">Chưa phân bổ</th>}<th className="p-2 text-right">Còn cần theo phạm vi</th><th className="p-2 text-right">Tồn kho</th><th className="p-2 text-right">Thiếu</th></tr></thead>
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
                  <div className="font-bold mb-1">Dữ liệu định mức/liên kết chưa đầy đủ. Hệ thống đã bỏ qua phần không xác định; các số còn hiển thị chỉ là nhu cầu tính được từ liên kết hợp lệ, KHÔNG phải tổng nhu cầu đầy đủ:</div>
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
              Cảnh báo thiếu so với định mức tổng kế hoạch ({lowStockItems.length})
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
                      {item.remainingDemand !== undefined ? ` / Còn cần theo định mức: ${formatDecimal(item.remainingDemand)} ${item.unit}` : ''}
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
              Cảnh báo nhập kho so với nhu cầu vật tư theo định mức ({quotaWarnings.length})
            </span>
          </div>
          <p className="text-[11px] text-indigo-700 leading-normal">
            Hệ thống phát hiện các vật tư đã nhập gần đủ hoặc vượt Nhu cầu vật tư theo định mức. Vui lòng đối chiếu kỹ khi làm việc với nhà cung cấp hoặc đặt đơn cuối!
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
                      Tổng đã nhập: <strong className="font-extrabold">{formatDecimal(item.inQty)}</strong> / Nhu cầu vật tư theo định mức: {formatDecimal(item.quota)} {item.unit}
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
                        Nhu cầu vật tư theo định mức: <strong className="text-indigo-600">{formatDecimal(quota)}</strong> {item.unit}
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
            placeholder="Tìm vật tư, thiết bị, vị trí kho, người giao..."
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

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Lọc nhật ký kho theo loại hàng">
          <span className="text-[11px] font-bold text-slate-600">Loại hàng:</span>
          {([
            { key: 'all', label: 'Tất cả' },
            { key: 'material', label: 'Vật tư' },
            { key: 'equipment', label: 'Thiết bị' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              data-hnl-warehouse-kind-filter={key}
              aria-pressed={inventoryKindFilter === key}
              onClick={() => setInventoryKindFilter(key)}
              className={`min-h-8 rounded-lg border px-3 py-1 text-[11px] font-bold transition-colors ${inventoryKindFilter === key
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <QuickSortBar
          itemCount={filteredInventory.length}
          options={[
            { key: 'date', label: 'Ngày', kind: 'date', defaultOrder: 'desc' },
            { key: 'material', label: 'Tên vật tư / thiết bị', kind: 'alpha' },
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
          {roleResolved && <button type="button" data-hnl-warehouse-export-open="all"
            onClick={() => setVoucherShareOpen(true)}
            className="min-h-10 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-bold text-indigo-700">
            Chia sẻ phiếu nhập/xuất kho
          </button>}
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
                    <div className="flex min-w-0 flex-1 items-start gap-2">
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
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            data-hnl-warehouse-voucher-id={item.id}
                            title={`Mã phiếu: ${item.id}`}
                            aria-label={`Mã phiếu ${item.id}. ${expandedInventoryId === item.id ? 'Thu gọn' : 'Xem đầy đủ'}`}
                            aria-expanded={expandedInventoryId === item.id}
                            onClick={() => setExpandedInventoryId((current) => current === item.id ? null : item.id)}
                            className="min-w-0 max-w-full rounded text-left text-[10px] font-bold text-slate-500 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-500"
                          >
                            <span className={expandedInventoryId === item.id
                              ? 'block max-w-full break-all whitespace-normal select-text'
                              : 'block max-w-[108px] truncate sm:max-w-[170px]'}>
                              [{item.id}]
                            </span>
                          </button>
                          {expandedInventoryId === item.id && (
                            <button
                              type="button"
                              title="Sao chép đầy đủ mã phiếu"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(item.id);
                                  setCopiedInventoryId(item.id);
                                } catch {
                                  window.prompt('Mã phiếu để sao chép:', item.id);
                                }
                              }}
                              className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              {copiedInventoryId === item.id ? 'Đã sao chép' : 'Sao chép'}
                            </button>
                          )}
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
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                              Thiết bị
                            </span>
                          )}
                        </div>
                        <h4 className="text-xs font-bold text-slate-900 mt-0.5 leading-snug break-words">
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

                  <div className="flex flex-wrap justify-end gap-3 pt-1">
                    {currentProjectId && roleResolved && (
                      <button type="button" data-hnl-warehouse-photo-voucher={item.id}
                        onClick={() => setPhotoVoucher({ projectId: currentProjectId, id: item.id, type: item.type, materialName: item.materialName })}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:text-sky-900"
                        title={`Xem ảnh giao nhận của phiếu ${item.id}`}>
                        <Images className="h-3.5 w-3.5" /> Ảnh giao nhận
                      </button>
                    )}
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

      {voucherShareOpen && <WarehouseVoucherShareSheet
        open={voucherShareOpen}
        inventory={inventory}
        projectName={projectName}
        projectLocation={projectLocation}
        contractorName={contractorName}
        onClose={() => setVoucherShareOpen(false)} />}
      {photoVoucher && photoVoucher.projectId === currentProjectId && roleResolved && (
        <div className="fixed inset-0 z-[96] flex items-end justify-center bg-slate-900/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          data-hnl-warehouse-photo-modal="true" role="dialog" aria-modal="true" aria-label="Ảnh giao nhận phiếu kho">
          <div className="flex max-h-[95dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-2xl">
            <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 p-3 sm:p-4">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-900"><Images className="h-4 w-4 text-sky-600" /> Ảnh giao nhận · {photoVoucher.type === 'in' ? 'Nhập kho' : 'Xuất kho'}</h3>
                <p className="mt-1 break-words text-xs text-slate-600">{photoVoucher.materialName} · Mã phiếu: <span className="break-all font-mono">{photoVoucher.id}</span></p>
              </div>
              <button type="button" onClick={() => setPhotoVoucher(null)} disabled={Boolean(photoVoucher.initialFiles?.length)}
                className="min-h-10 shrink-0 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{photoVoucher.initialFiles?.length ? 'Đang lưu ảnh…' : 'Đóng'}</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
              <PhotoAttachmentPicker
                key={`${currentProjectId}:${photoVoucher.id}`} projectId={currentProjectId}
                entityType="inventory" entityId={photoVoucher.id} category="warehouse_receipt"
                label="ẢNH GIAO NHẬN (TỐI ĐA 10 ẢNH)" maxPhotos={10}
                readOnly={!hasEditAccess}
                initialFiles={photoVoucher.initialFiles}
                onInitialFilesProcessed={() => setPhotoVoucher((current) => current?.id === photoVoucher.id ? { ...current, initialFiles: [] } : current)}
              />
              <p className="mt-2 text-[11px] text-slate-500">Ảnh gắn riêng theo mã phiếu; không ảnh hưởng số lượng nhập, xuất hoặc tồn kho. Khi mạng yếu, ảnh sẽ chờ đồng bộ và chỉ hiển thị trên thiết bị khác sau khi Cloud sẵn sàng.</p>
            </div>
          </div>
        </div>
      )}
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
                onClick={() => {
                  if (pendingVoucherPhotos.length > 0 && !window.confirm('Hủy phiếu chưa lưu và bỏ các ảnh đã chọn?')) return;
                  setPendingVoucherPhotos([]); setShowAddForm(false); setEditingInventory(null);
                }}
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
                        placeholder="Tìm vật tư theo tên, chủng loại hoặc đơn vị..."
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
                      value={materialNorms.find((m) => m.materialName === materialName && (normalizeUnit(m.unit) || m.unit) === (normalizeUnit(unit) || unit))?.id || ''}
                      onChange={(e) => {
                        const matched = materialNorms.find((m) => m.id === e.target.value);
                        if (matched) { setMaterialName(matched.materialName); setUnit(matched.unit); setCustomMaterial(''); }
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800"
                    >
                      <option value="">— Chọn vật tư —</option>
                      {filteredMaterialNorms.map((m) => <option key={m.id} value={m.id}>[{m.category}] {m.materialName} ({m.unit})</option>)}
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
                      {filteredEquipmentCatalog.map((item) => <option key={`${item.name}|${item.unit}`} value={`${item.name}|||${item.unit}`}>{item.displayName || item.name} ({item.unit}){item.displayName !== item.name ? ' · ' + item.name : ''}</option>)}
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
                        Phạm vi dưới đây không bắt buộc nhập đủ. {itemKind === 'equipment' ? 'Thiết bị có thể ghi nhận Khu/Khối, Tầng, Căn / Phòng và Đội nhận; thiết bị không tham gia định mức.' : 'Chọn càng chi tiết thì thống kê vật tư theo Khu/Khối, Tầng, Căn / Phòng, Đội và Hạng mục càng chính xác.'}
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
                <div className="lg:col-span-3 space-y-2">
                  <label className="block text-slate-500 font-medium mb-1">Tên vật tư khác</label>
                  <input
                    type="text"
                    placeholder="Ví dụ: Đèn âm trần 12W, Keo bọt nở..."
                    value={customMaterial}
                    onChange={(e) => setCustomMaterial(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl p-2.5"
                  />
                  {customMaterial.trim() && !materialNorms.some((norm) =>
                    norm.materialName.trim().toLocaleLowerCase('vi-VN') === customMaterial.trim().toLocaleLowerCase('vi-VN')
                    && (normalizeUnit(norm.unit) || norm.unit) === (normalizeUnit(unit) || unit)
                  ) && (
                    <div className="rounded-xl border border-blue-100 bg-blue-50 p-2.5">
                      {hasNormManageAccess ? (
                        <>
                          <label className="block text-[10px] font-bold text-blue-800 mb-1">Chủng loại vật tư mới</label>
                          <input
                            type="text"
                            value={customMaterialCategory}
                            onChange={(e) => setCustomMaterialCategory(e.target.value)}
                            placeholder="Vật tư khác"
                            className="w-full rounded-lg border border-blue-200 bg-white px-2.5 py-2 text-xs text-slate-800"
                          />
                          <p className="mt-1.5 text-[10px] leading-relaxed text-blue-700">
                            Khi lưu phiếu, vật tư này sẽ được thêm vào Danh mục vật tư và liên kết bằng materialId. Định mức hao phí chưa khai báo (0) để tránh tự suy đoán.
                          </p>
                        </>
                      ) : (
                        <p className="text-[10px] leading-relaxed text-amber-700">
                          Vật tư này chưa có trong Danh mục vật tư. Chỉ ADMIN quản lý định mức mới được tạo vật tư mới; hãy chọn vật tư có sẵn hoặc nhờ ADMIN thêm trước.
                        </p>
                      )}
                    </div>
                  )}
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
                      if (parsed !== null) setQuantity(parsed);
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
                    readOnly={!isNewMaterialDefinition && (itemKind === 'material' || !isNewEquipment)}
                    onChange={(e) => {
                      if (isNewMaterialDefinition || (itemKind === 'equipment' && isNewEquipment)) setUnit(e.target.value);
                    }}
                    className={`w-full rounded-xl border border-slate-200 p-2.5 ${!isNewMaterialDefinition && (itemKind === 'material' || !isNewEquipment) ? 'bg-slate-100 text-slate-600 cursor-not-allowed' : 'bg-white'}`}
                    required
                  />
                  {!isNewMaterialDefinition && (itemKind === 'material' || !isNewEquipment) && (
                    <p className="mt-1 text-[10px] text-slate-500">ĐVT theo danh mục; không sửa riêng trên phiếu.</p>
                  )}
                  {isNewMaterialDefinition && (
                    <p className="mt-1 text-[10px] text-indigo-600">Vật tư mới: nhập ĐVT khi tạo danh mục; chỉ ADMIN được thêm vật tư mới.</p>
                  )}
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

              {currentProjectId && (
                <div className="lg:col-span-6 rounded-xl border border-sky-100 bg-sky-50/40 p-2.5" data-hnl-warehouse-form-photos="true">
                  {editingInventory ? (
                    <PhotoAttachmentPicker
                      key={`${currentProjectId}:${editingInventory.id}`} projectId={currentProjectId}
                      entityType="inventory" entityId={editingInventory.id} category="warehouse_receipt"
                      label="ẢNH GIAO NHẬN VẬT TƯ / THIẾT BỊ (KHÔNG BẮT BUỘC)" maxPhotos={10}
                      readOnly={!hasEditAccess}
                    />
                  ) : (
                    <WarehouseVoucherPhotoDraft files={pendingVoucherPhotos} onChange={setPendingVoucherPhotos} />
                  )}
                </div>
              )}

              {quickAddMessage && !editingInventory && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800 lg:col-span-6">
                  {quickAddMessage}
                </div>
              )}

              {/* Buttons */}
              <div className={`sticky bottom-0 z-10 -mx-5 lg:-mx-6 -mb-5 lg:-mb-6 mt-1 grid gap-2 border-t border-slate-100 bg-white px-5 lg:px-6 py-4 lg:col-span-6 ${editingInventory ? 'grid-cols-1' : 'grid-cols-2'}`}>
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
