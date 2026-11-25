import React, { useState, useEffect } from 'react';
import { 
  X, 
  CheckCircle2, 
  AlertCircle, 
  User, 
  Trash2, 
  Building2, 
  Clock,
  Sparkles,
  Plus,
  ListChecks,
  PlusCircle,
  FileText,
  PackageCheck,
  Boxes,
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  Calculator,
  Sliders,
  ChevronDown,
  Edit2,
  Check,
  Pencil
} from 'lucide-react';
import { RoomProgressItem, RoomSubItem, RoomQuantityFormulaSetting, HighlightRegionRect, HighlightRegionShape, AcceptanceStatus, RoomInspectionResult, Point2D, TeamInfo, ChecklistItem, MaterialNorm, InventoryItem, WorkVolume } from '../types';
import { ROOM_COLOR_PALETTE } from '../utils/colorPalette';
import { WHOLE_ROOM_REGION, computeSubHighlightAreaRatio, getEffectiveStageHighlightRegions, isAreaHighlightUnit, normalizeHighlightRect } from '../utils/subItemHighlightGeometry';
import { calculateHighlightTotalRatio, getHighlightStageShapes, highlightShapeToPolygon, validateHighlightShape } from '../utils/highlightTotalGeometry';
import { confirmAsync } from '../utils/confirmAsync';
import { formatDecimal, formatAdaptiveDecimal, evaluateMathExpression, useFormatSettings } from '../utils/numberUtils';
import { MathNumberInput } from './MathNumberInput';
import { createEntityId, createDeterministicId } from '../utils/idUtils';
import { toLocalDateInputValue } from '../utils/dateFormatter';
import { normalizeUnit, areSameUnit } from '../utils/unitUtils';
import { totalCountPoints } from '../utils/highlightCountPoints';
import { getRoomWorkCategoryUnit } from '../utils/roomCategoryUnit';
import { ADVANCED_HIGHLIGHT_ENABLED, getBasicRoomMetricUnit, type BasicRoomQuantitySource } from '../utils/roomHighlightBasicMetric';
import { evaluateRoomQuantityFormula, type QuantityVariables } from '../utils/roomQuantityFormula';
import { RoomQuantityCalculator } from './RoomQuantityCalculator';
import { roomFormulaCategoryKey } from '../utils/roomQuantityAutoUpdate';
import type { MetricMeasure } from '../utils/highlightMetricGeometry';
import { buildMaterialAliasMap, getMaterialIdentityKey, resolveNormMaterialId, normalizeMaterialNameKey } from '../utils/inventoryUtils';
import { computeMaterialNeeds } from '../utils/materialNeedEngine';
import { validateInventoryOutProvenance } from '../utils/linkageIntegrity';
import { MoveOrderControls } from './MoveOrderControls';
import { ContactMenu } from './ContactMenu';

interface RoomHighlightModalProps {
  isOpen: boolean;
  onClose: () => void;
  contextReturnLabel?: string;
  roomItem: RoomProgressItem | null; // Null means creating a new room highlight
  initialPos?: { x: number; y: number };
  initialRect?: { x: number; y: number; width: number; height: number };
  initialPoints?: Point2D[];
  floorId: string;
  floorName: string;
  /** Display-only reference image; optional and never uploaded by the editor. */
  floorPlanImageUrl?: string;
  checklistItems?: ChecklistItem[];
  teams?: TeamInfo[];
  materialNorms?: MaterialNorm[];
  inventory?: InventoryItem[];
  workVolumes?: WorkVolume[];
  existingRoomNames?: string[];
  defaultInspectorName?: string;
  onAddInventory?: (item: Omit<InventoryItem, 'id'> & { id?: string }) => void | Promise<void>;
  onSaveRoom: (room: Omit<RoomProgressItem, 'id' | 'updatedAt'> & { id?: string }) => void | Promise<void>;
  onDeleteRoom?: (id: string) => void;
  onStartRedraw2Point?: (room: RoomProgressItem, tool: 'freehand' | 'polygon' | '2point') => void;
  /** Save room draft first, then open the stage's count editor on the real floor map. */
  onStartCountOnMap?: (room: RoomProgressItem, stageId: string) => void;
  /** Open the existing full floor map for Cách 2 measurement; never writes quantity here. */
  onStartDrawOnMap?: (room: RoomProgressItem, category: string, target: string) => void;
  onMeasureBasicRoom?: (room: RoomProgressItem, unit: string, source?: BasicRoomQuantitySource) => MetricMeasure;
  structureReadOnly?: boolean;
  focusOrphanRepair?: boolean;
}

// Preset mapping for Construction & Acceptance Categories requested by user
export const WORK_CATEGORY_PRESETS: { [cat: string]: string[] } = {
  'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn': ['Thi công khung', 'Thi công tấm'],
  'Trần Thạch Cao Khung Chìm Tấm Chống Ẩm': ['Thi công khung', 'Thi công tấm'],
  'Trần Thạch Cao Khung Nổi Tấm Tiêu Chuẩn': ['Thi công khung', 'Thi công tấm'],
  'Trần Thạch Cao Khung Nổi Tấm Chống Ẩm': ['Thi công khung', 'Thi công tấm'],
  'Vách Thạch Cao Hai Mặt Tấm Tiêu Chuẩn': ['Thi công khung', 'Thi công tấm mặt 1', 'Thi công tấm mặt 2'],
  'Vách Thạch Cao Hai Mặt Tấm Chống Ẩm': ['Thi công khung', 'Thi công tấm mặt 1', 'Thi công tấm mặt 2'],
  'Vách Thạch Cao Một Mặt': ['Thi công khung', 'Thi công tấm mặt 1'],
  'Sơn Bả Hoàn Thiện Trần / Vách': ['Sơn lót', 'Bả matit lớp 1', 'Bả matit lớp 2', 'Sơn phủ hoàn thiện'],
};

// Common checklist criteria presets to import into room checklist
const DEFAULT_CHECKLIST_CRITERIA = [
  'Kiểm tra độ phẳng mặt phẳng trần/vách',
  'Khoảng cách ty treo & khung xương chính/phụ',
  'Cố định ty treo, ty ren & tắc kê trần',
  'Xử lý mối nối bột trét & dán băng keo lưới',
  'Khoảng cách bắn vít tấm thạch cao (15-20cm)',
  'Kiểm tra độ thẳng & vuông góc chân vách thạch cao',
  'Nghiệm thu trám trét lỗ ti vữa & viền chân tường',
  'Kiểm tra nghiệm thu hoàn thiện bề mặt sơn bả',
];

const getSubItemsForCategory = (catName: string): string[] => {
  // Find if there's any preset key that is a substring or match
  const matchedKey = Object.keys(WORK_CATEGORY_PRESETS).find(
    key => catName.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(catName.toLowerCase())
  );
  if (matchedKey) {
    return WORK_CATEGORY_PRESETS[matchedKey];
  }
  // Guess based on content
  const lower = catName.toLowerCase();
  if (lower.includes('sơn') || lower.includes('bả') || lower.includes('hoàn thiện')) {
    return ['Sơn lót', 'Bả matit lớp 1', 'Bả matit lớp 2', 'Sơn phủ hoàn thiện'];
  }
  if (lower.includes('vách') && (lower.includes('hai mặt') || lower.includes('2 mặt'))) {
    return ['Thi công khung', 'Thi công tấm mặt 1', 'Thi công tấm mặt 2'];
  }
  if (lower.includes('vách') && (lower.includes('một mặt') || lower.includes('1 mặt'))) {
    return ['Thi công khung', 'Thi công tấm mặt 1'];
  }
  // Default fallback
  return ['Thi công khung', 'Thi công tấm'];
};

export const RoomHighlightModal: React.FC<RoomHighlightModalProps> = ({
  isOpen,
  onClose,
  roomItem,
  initialPos,
  initialRect,
  initialPoints,
  floorId,
  floorName,
  floorPlanImageUrl,
  checklistItems = [],
  teams = [],
  materialNorms = [],
  inventory = [],
  workVolumes = [],
  existingRoomNames = [],
  defaultInspectorName,
  contextReturnLabel,
  onAddInventory,
  onSaveRoom,
  onDeleteRoom,
  onStartRedraw2Point,
  onStartCountOnMap,
  onStartDrawOnMap,
  onMeasureBasicRoom,
  structureReadOnly = false,
  focusOrphanRepair = false,
}) => {
  const roomDraftDirtyRef = React.useRef(false);
  const countStageAfterSaveRef = React.useRef<string | null>(null);
  const basicMeasuredRef = React.useRef<Record<string, { unit: 'm²' | 'm'; value: number; key: string }>>({});
  type DraftMeasurement = { cat: string; stageId?: string; expression: string; source: string; unit: string; value: number; key: string };
  type QuantityDraft = { raw: string; auto: boolean; error?: string };
  const formulaMeasuredRef = React.useRef<Record<string, DraftMeasurement>>({});
  const [quantityDrafts,setQuantityDrafts] = useState<Record<string,QuantityDraft>>({});
  useEffect(() => { roomDraftDirtyRef.current = false; basicMeasuredRef.current = {}; formulaMeasuredRef.current = {}; setQuantityDrafts({}); }, [isOpen, roomItem?.id, floorId]);
  const closeRoomWithDraftGuard = (label: string) => {
    if (roomDraftDirtyRef.current && !window.confirm(`${label}? Các thay đổi chưa nhấn Lưu sẽ không được lưu. Tiếp tục?`)) return;
    roomDraftDirtyRef.current = false;
    onClose();
  };

  // The legacy independent-total drawing editor remains in source for historic records,
  // but must not be exposed alongside the calibrated Cách 2 editor.
  const legacyHighlightEditorVisible = false;
  const launchCach2 = (category: string, target: string) => {
    if (!ADVANCED_HIGHLIGHT_ENABLED || !roomItem?.id || !onStartDrawOnMap || structureReadOnly) return;
    // Never silently discard an unsaved draft or auto-save old legacy quantities.
    if (roomDraftDirtyRef.current && !window.confirm('Mở mặt bằng sẽ bỏ các thay đổi chưa lưu trong biểu mẫu. Hãy nhấn Lưu trước nếu muốn giữ. Tiếp tục?')) return;
    // The map owner closes only the room form after validating the target.
    // Generic onClose can trigger context-return navigation and unmount the map.
    // A rejected launch leaves the form open; preserve unsaved-draft warnings.
    // A successful launch closes the form and its isOpen effect resets this ref.
    onStartDrawOnMap(roomItem, category, target);
  };

  const activeDefaultInspector = defaultInspectorName || '';

  const [roomName, setRoomName] = useState('');
  // Never seed a room with a hard-coded category. The project WorkVolume catalog is
  // the operational source of truth; deleted categories may remain in historical room
  // metadata but must not be silently resurrected into a new Căn / Phòng.
  const [workCategory, setWorkCategory] = useState('');
  const [presetSelection, setPresetSelection] = useState('');
  const [subItems, setSubItems] = useState<RoomSubItem[]>([]);
  const [customUnitStageId, setCustomUnitStageId] = useState<string | null>(null);
  const [customUnitText, setCustomUnitText] = useState('');
  const [mapPickerCategory, setMapPickerCategory] = useState<string | null>(null);
  const [mapPickerTarget, setMapPickerTarget] = useState('main');
  const [mapPickerNewName, setMapPickerNewName] = useState('');
  const [mapPickerRenameTarget, setMapPickerRenameTarget] = useState<string | null>(null);
  const [mapPickerRenameText, setMapPickerRenameText] = useState('');
  const [mapPickerMessage, setMapPickerMessage] = useState('');
  useEffect(() => {
    setMapPickerCategory(null); setMapPickerTarget('main');setMapPickerNewName('');
    setMapPickerMessage('');setMapPickerRenameTarget(null);setMapPickerRenameText('');
    setCustomUnitStageId(null);setCustomUnitText('');
  }, [isOpen, roomItem?.id]);
  const [categoryVolumes, setCategoryVolumes] = useState<Record<string, number>>({});
  // Optional, opt-in advanced highlighting. Legacy rooms and all ordinary stages
  // remain manual; opening this section never changes saved quantities.
  const [categoryHighlightRegions, setCategoryHighlightRegions] = useState<Record<string, HighlightRegionRect>>({});
  // Optional, room-local total quantity/geometry; absent fields preserve original legacy math.
  const [categoryHighlightTotalVolumes, setCategoryHighlightTotalVolumes] = useState<Record<string, number>>({});
  const [categoryHighlightTotalShapes, setCategoryHighlightTotalShapes] = useState<Record<string, HighlightRegionShape[]>>({});
  const [categoryHighlightShapes, setCategoryHighlightShapes] = useState<Record<string, HighlightRegionShape[]>>({});
  const [categoryHighlightAutoMode, setCategoryHighlightAutoMode] = useState<Record<string, boolean>>({});
  const [highlightDrawTool, setHighlightDrawTool] = useState<'2point' | 'polygon' | 'freehand'>('2point');
  const [polygonDraft, setPolygonDraft] = useState<Point2D[]>([]);
  const [freehandDraft, setFreehandDraft] = useState<Point2D[]>([]);
  const [showAdvancedHighlights, setShowAdvancedHighlights] = useState(false);
  // Cách 2 is a launcher, not a permanently expanded editor in every room form.
  const [highlightCategory, setHighlightCategory] = useState('');
  const [highlightTarget, setHighlightTarget] = useState('main');
  const [appendHighlightRegion, setAppendHighlightRegion] = useState(false);
  const [highlightDraft, setHighlightDraft] = useState<{ start: Point2D; end: Point2D } | null>(null);
  const highlightPointerStartRef = React.useRef<Point2D | null>(null);
  const highlightSvgClipId = React.useId();
  const HIGHLIGHT_COLORS = ['#2563eb', '#f59e0b', '#16a34a', '#9333ea', '#dc2626', '#0891b2'];

  const [volumeStrings, setVolumeStrings] = useState<Record<string, string>>({});

  useFormatSettings();
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState<string>('');

  const handleRenameCategory = (oldName: string, newName: string) => {
    if (!newName || !newName.trim() || oldName === newName) {
      setRenamingCategory(null);
      return;
    }
    const trimmed = newName.trim();
    
    // 1. Update subItems
    setSubItems(prev => prev.map(item => {
      const itemCat = item.category || workCategory || 'Chưa phân nhóm';
      if (itemCat === oldName) {
        return { ...item, category: trimmed };
      }
      return item;
    }));

    // 2. Update categoryVolumes
    setCategoryVolumes(prev => {
      const updated = { ...prev };
      if (oldName in updated) {
        updated[trimmed] = updated[oldName];
        delete updated[oldName];
      }
      return updated;
    });

    setVolumeStrings(prev => {
      const updated = { ...prev };
      if (oldName in updated) {
        updated[trimmed] = updated[oldName];
        delete updated[oldName];
      }
      return updated;
    });

    // Preserve the advanced main region when a category is renamed.
    setCategoryHighlightRegions(prev => {
      if (!Object.prototype.hasOwnProperty.call(prev, oldName)) return prev;
      const next = { ...prev, [trimmed]: prev[oldName] };
      delete next[oldName];
      return next;
    });
    for (const setMap of [setCategoryHighlightTotalVolumes, setCategoryHighlightTotalShapes, setCategoryHighlightShapes, setCategoryHighlightAutoMode] as const) {
      setMap((prev: any) => {
        if (!Object.prototype.hasOwnProperty.call(prev, oldName)) return prev;
        const next = { ...prev, [trimmed]: prev[oldName] };
        delete next[oldName];
        return next;
      });
    }
    setHighlightCategory(prev => prev === oldName ? trimmed : prev);

    // 3. Update workCategory if matches
    if (workCategory === oldName) {
      setWorkCategory(trimmed);
    }

    setRenamingCategory(null);
  };

  const [x, setX] = useState<number>(20);
  const [y, setY] = useState<number>(20);
  const [width, setWidth] = useState<number>(30);
  const [height, setHeight] = useState<number>(30);
  const [points, setPoints] = useState<Point2D[] | undefined>(undefined);

  const [inspectionStatus, setInspectionStatus] = useState<RoomInspectionResult>('Chưa nghiệm thu');
  const [inspectorName, setInspectorName] = useState(() => roomItem?.inspectorName || activeDefaultInspector);
  const [notes, setNotes] = useState('');
  const [assignedTeam, setAssignedTeam] = useState('');
  const [selectedColor, setSelectedColor] = useState<string>('');
  const [isPolyline, setIsPolyline] = useState<boolean>(false);
  const [workVolume, setWorkVolume] = useState<number | string>('');
  const [volumeUnit, setVolumeUnit] = useState<string>('m²');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [deletingSubItemId, setDeletingSubItemId] = useState<string | null>(null);
  const [availableTeams, setAvailableTeams] = useState<TeamInfo[]>([]);
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);
  const [showDimensionSettings, setShowDimensionSettings] = useState<boolean>(false);
  const [showMaterialEstimates, setShowMaterialEstimates] = useState<boolean>(false);
  const [isAutoIssuing, setIsAutoIssuing] = useState<boolean>(false);
  const [selectedSubItemIds, setSelectedSubItemIds] = useState<string[]>([]);
  const [orphanRepairTargets, setOrphanRepairTargets] = useState<Record<string, string>>({});
  const [orphanDismissedKeys, setOrphanDismissedKeys] = useState<string[]>([]);
  const orphanRepairRef = React.useRef<HTMLDivElement | null>(null);
  const formRef = React.useRef<HTMLFormElement | null>(null);

  // Combined teams list from props or local storage
  const displayTeams = (teams && teams.length > 0) 
    ? teams 
    : (availableTeams && availableTeams.length > 0)
    ? availableTeams
    : [];

  useEffect(() => {
    setIsConfirmingDelete(false);
    setShowAdvancedHighlights(false);
    setHighlightDraft(null);
    setPolygonDraft([]);
    setFreehandDraft([]);
    setHighlightDrawTool('2point');
    highlightPointerStartRef.current = null;
    setHighlightTarget('total');
    setAppendHighlightRegion(false);
    setCategoryHighlightRegions(roomItem?.categoryHighlightRegions || {});
    setCategoryHighlightTotalVolumes(roomItem?.categoryHighlightTotalVolumes || {});
    setCategoryHighlightTotalShapes(roomItem?.categoryHighlightTotalShapes || {});
    setCategoryHighlightShapes(roomItem?.categoryHighlightShapes || {});
    setCategoryHighlightAutoMode(roomItem?.categoryHighlightAutoMode || {});
    setHighlightCategory(roomItem?.workCategory || Object.keys(roomItem?.categoryVolumes || {})[0] || '');
    setSelectedSubItemIds([]);
    setOrphanRepairTargets({});
    setOrphanDismissedKeys([]);
    if (roomItem) {
      setRoomName(roomItem.roomName);
      const projectDefaultCategory = workVolumes.find((item) => item.title?.trim())?.title?.trim() || '';
      const cat = roomItem.workCategory || projectDefaultCategory;
      setWorkCategory(cat);
      // Preset actions should default to an ACTIVE catalog item, not a historical
      // category that may have been deleted long ago from Khối lượng.
      setPresetSelection(projectDefaultCategory || cat);
      setX(roomItem.x);
      setY(roomItem.y);
      setWidth(roomItem.width || 30);
      setHeight(roomItem.height || 30);
      setPoints(roomItem.points);
      
      // Load subItems or build from legacy fields
      if (roomItem.subItems && roomItem.subItems.length > 0) {
        setSubItems(roomItem.subItems);
      } else {
        setSubItems([
          {
            id: 'sub-frame',
            name: 'Thi công khung',
            status: roomItem.frameStatus || 'Chưa làm',
            inspectionStatus: roomItem.frameInspectionStatus || 'Chưa nghiệm thu',
            targetDate: roomItem.targetFrameDate || '',
          },
          {
            id: 'sub-board',
            name: 'Thi công Tấm',
            status: roomItem.boardStatus || 'Chưa làm',
            inspectionStatus: roomItem.boardInspectionStatus || 'Chưa nghiệm thu',
            targetDate: roomItem.targetBoardDate || '',
          },
        ]);
      }

      setInspectionStatus(roomItem.inspectionStatus);
      setInspectorName(roomItem.inspectorName || activeDefaultInspector);
      setNotes(roomItem.notes || '');
      setAssignedTeam(roomItem.assignedTeam || '');
      setSelectedColor(roomItem.color || '');
      setIsPolyline(!!roomItem.isPolyline);
      setWorkVolume(roomItem.workVolume !== undefined && roomItem.workVolume !== null ? roomItem.workVolume : '');
      setVolumeUnit(normalizeUnit(getRoomWorkCategoryUnit(cat, workVolumes, floorId) || roomItem.volumeUnit || 'm²') || 'm²');

      // Load categoryVolumes
      if (roomItem.categoryVolumes) {
        setCategoryVolumes(roomItem.categoryVolumes);
        const initialStrings: Record<string, string> = {};
        Object.entries(roomItem.categoryVolumes).forEach(([key, val]) => {
          initialStrings[key] = val !== undefined && val !== null ? formatDecimal(val as any) : '';
        });
        setVolumeStrings(initialStrings);
      } else {
        const initialMap: Record<string, number> = {};
        const projectDefaultCategory = workVolumes.find((item) => item.title?.trim())?.title?.trim() || '';
        const cat = roomItem.workCategory || projectDefaultCategory;
        if (cat && roomItem.workVolume !== undefined && roomItem.workVolume !== null) {
          initialMap[cat] = Number(roomItem.workVolume);
        }
        setCategoryVolumes(initialMap);
        const initialStrings: Record<string, string> = {};
        if (cat && roomItem.workVolume !== undefined && roomItem.workVolume !== null) {
          initialStrings[cat] = formatDecimal(roomItem.workVolume);
        }
        setVolumeStrings(initialStrings);
      }
    } else {
      setVolumeStrings({});
      setCategoryVolumes({});
      setRoomName('Căn ' + Math.floor(100 + Math.random() * 800));
      const defaultCat = workVolumes.find((item) => item.title?.trim())?.title?.trim() || '';
      setWorkCategory(defaultCat);
      setPresetSelection(defaultCat);
      
      const names = defaultCat ? getSubItemsForCategory(defaultCat) : [];

      setSubItems(
        names.map((name, idx) => {
          const displaySubName = name.toLowerCase().startsWith('thi công') || name.toLowerCase().startsWith('sơn') || name.toLowerCase().startsWith('bả') ? name : `Thi công ${name}`;
          return {
            id: createEntityId(`sub-init-${idx}`),
            name: displaySubName,
            category: defaultCat,
            highlightVolumeMode: 'manual',
            status: 'Chưa làm',
            inspectionStatus: 'Chưa nghiệm thu',
            targetDate: '',
          };
        })
      );
      setCategoryVolumes(defaultCat ? { [defaultCat]: 0 } : {});

      setPoints(initialPoints);
      if (initialRect) {
        setX(Math.min(90, Math.max(0, initialRect.x)));
        setY(Math.min(90, Math.max(0, initialRect.y)));
        setWidth(Math.min(100 - initialRect.x, Math.max(3, initialRect.width)));
        setHeight(Math.min(100 - initialRect.y, Math.max(3, initialRect.height)));
      } else if (initialPos) {
        setX(Math.min(70, Math.max(5, initialPos.x)));
        setY(Math.min(70, Math.max(5, initialPos.y)));
        setWidth(30);
        setHeight(30);
      } else {
        setX(20);
        setY(20);
        setWidth(30);
        setHeight(30);
      }
      setInspectionStatus('Chưa nghiệm thu');
      setInspectorName(activeDefaultInspector);
      setNotes('');
      setAssignedTeam('');
      setWorkVolume('');
      setVolumeUnit(normalizeUnit(getRoomWorkCategoryUnit(defaultCat, workVolumes, floorId) || 'm²') || 'm²');
    }
  }, [roomItem, initialPos, initialRect, initialPoints, isOpen]);

  // Add preset sub-items without replacing the room's saved construction and acceptance history.
  const handleApplyPreset = (catName: string) => {
    const normalizedCategory = String(catName || '').trim();
    if (!normalizedCategory) return;
    catName = normalizedCategory;
    setWorkCategory(catName);
    setVolumeUnit(normalizeUnit(getRoomWorkCategoryUnit(catName, workVolumes, floorId) || volumeUnit || 'm²') || 'm²');
    
    // Find all material norms matching this category
    const matchingNorms = materialNorms ? materialNorms.filter(norm => {
      if (norm.workCategories && norm.workCategories.length > 0) {
        return norm.workCategories.includes(catName);
      }
      return norm.workCategory === catName;
    }) : [];

    const names = getSubItemsForCategory(catName);
    
    // Short category prefix so sub-items are clearly distinguished when multiple categories exist in 1 room
    const shortPrefix = catName
      .replace('Trần Thạch Cao ', 'Trần ')
      .replace('Vách Thạch Cao ', 'Vách ');

    const newItems: RoomSubItem[] = names.map((name, idx) => {
      const displaySubName = name.toLowerCase().startsWith('thi công') || name.toLowerCase().startsWith('sơn') || name.toLowerCase().startsWith('bả') ? name : `Thi công ${name}`;
      return {
        id: createEntityId(`sub-preset-${idx}`),
        name: displaySubName,
        category: catName,
        highlightVolumeMode: 'manual',
        status: 'Chưa làm',
        inspectionStatus: 'Chưa nghiệm thu',
        targetDate: '',
        workVolume: undefined,
        volumeUnit: normalizeUnit(getRoomWorkCategoryUnit(catName, workVolumes, floorId) || volumeUnit || 'm²') || 'm²',
        assignedTeam: assignedTeam || '',
      };
    });

    setSubItems(prev => [...prev, ...newItems]);
    const existingVol = categoryVolumes[catName] !== undefined ? categoryVolumes[catName] : (Number(workVolume) || 0);
    setCategoryVolumes(prev => ({
      ...prev,
      [catName]: existingVol
    }));
    setVolumeStrings(prev => ({
      ...prev,
      [catName]: formatDecimal(existingVol)
    }));
  };

  const projectWorkCategoryTitles = React.useMemo(() => {
    const seen = new Set<string>();
    const titles: string[] = [];
    workVolumes.forEach((item) => {
      const title = String(item.title || '').trim();
      const key = title.toLocaleLowerCase('vi-VN');
      if (!title || seen.has(key)) return;
      seen.add(key);
      titles.push(title);
    });
    return titles;
  }, [workVolumes]);

  // Active WorkVolume rows are authoritative for presets. Historical/deleted category
  // names may still live inside old room records for audit/history, but must not be
  // offered as a normal preset and accidentally become active again.
  const presetWorkCategories = React.useMemo(() => {
    // Do not synthesize an operational category from generic presets/material norms.
    // A category must first exist in Khối lượng (WorkVolume); otherwise a deleted
    // category could be recreated just by opening this modal.
    return projectWorkCategoryTitles;
  }, [projectWorkCategoryTitles]);

  React.useEffect(() => {
    if (!isOpen || roomItem || presetSelection || presetWorkCategories.length === 0) return;
    const defaultCat = presetWorkCategories[0];
    setPresetSelection(defaultCat);
    if (!workCategory) {
      setWorkCategory(defaultCat);
      const names = getSubItemsForCategory(defaultCat);
      setSubItems(names.map((name, idx) => ({
        id: createEntityId(`sub-init-late-${idx}`),
        highlightVolumeMode: 'manual',
        name: name.toLowerCase().startsWith('thi công') || name.toLowerCase().startsWith('sơn') || name.toLowerCase().startsWith('bả') ? name : `Thi công ${name}`,
        category: defaultCat,
        status: 'Chưa làm',
        inspectionStatus: 'Chưa nghiệm thu',
        targetDate: '',
      })));
      setCategoryVolumes({ [defaultCat]: 0 });
    }
  }, [isOpen, roomItem, presetSelection, presetWorkCategories, workCategory]);

  const activeWorkCategoryIdSet = React.useMemo(() => new Set(
    workVolumes.flatMap((item) => [item.id, item.workCategoryId].filter(Boolean) as string[])
  ), [workVolumes]);
  const activeWorkCategoryNameMap = React.useMemo(() => new Map(
    projectWorkCategoryTitles.map((title) => [title.trim().toLocaleLowerCase('vi-VN'), title] as const)
  ), [projectWorkCategoryTitles]);

  // Normal dropdowns expose only ACTIVE WorkVolume categories. Historical/deleted names
  // remain visible only in the dedicated orphan-repair warning and can never be selected again.
  const availableWorkCategories = React.useMemo(() => projectWorkCategoryTitles, [projectWorkCategoryTitles]);

  type OrphanCategoryRef = { key: string; source: 'room' | 'categoryVolumes' | 'subItem'; workCategoryId?: string; workCategoryName?: string; label: string };
  const orphanWorkCategoryRefs = React.useMemo<OrphanCategoryRef[]>(() => {
    const refs = new Map<string, OrphanCategoryRef>();
    const dismissed = new Set(orphanDismissedKeys);
    const add = (source: OrphanCategoryRef['source'], workCategoryId?: string, workCategoryName?: string) => {
      const id = String(workCategoryId || '').trim();
      const name = String(workCategoryName || '').trim();
      if (!id && !name) return;
      const known = id ? activeWorkCategoryIdSet.has(id) : activeWorkCategoryNameMap.has(name.toLocaleLowerCase('vi-VN'));
      if (known) return;
      const key = id ? `id:${id}` : `name:${name.toLocaleLowerCase('vi-VN')}`;
      if (dismissed.has(key) || refs.has(key)) return;
      refs.set(key, { key, source, workCategoryId: id || undefined, workCategoryName: name || undefined, label: name || id });
    };

    if ((Number(workVolume) || 0) > 0) {
      const roomId = roomItem && workCategory === String(roomItem.workCategory || '') ? roomItem.workCategoryId : undefined;
      add('room', roomId, workCategory);
    }
    Object.entries(categoryVolumes || {}).forEach(([raw, volume]) => {
      if ((Number(volume) || 0) <= 0) return;
      add('categoryVolumes', activeWorkCategoryIdSet.has(raw) ? raw : undefined, activeWorkCategoryIdSet.has(raw) ? '' : raw);
    });
    subItems.forEach((sub) => {
      if (sub.workCategoryId) add('subItem', sub.workCategoryId, sub.category);
      else if ((Number(sub.workVolume) || 0) > 0) add('subItem', undefined, sub.category);
    });
    return Array.from(refs.values());
  }, [activeWorkCategoryIdSet, activeWorkCategoryNameMap, categoryVolumes, orphanDismissedKeys, roomItem, subItems, workCategory, workVolume]);

  React.useEffect(() => {
    if (!isOpen || !focusOrphanRepair || orphanWorkCategoryRefs.length === 0) return;
    const timer = window.setTimeout(() => orphanRepairRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    return () => window.clearTimeout(timer);
  }, [focusOrphanRepair, isOpen, orphanWorkCategoryRefs.length]);

  const remapOrphanCategory = async (orphan: OrphanCategoryRef) => {
    if (structureReadOnly) return;
    const target = String(orphanRepairTargets[orphan.key] || '').trim();
    if (!target || !activeWorkCategoryNameMap.has(target.toLocaleLowerCase('vi-VN'))) {
      alert('Hãy chọn một hạng mục đang còn trong danh mục Khối lượng.');
      return;
    }
    const targetVolume = workVolumes.find((item) => item.title.trim().toLocaleLowerCase('vi-VN') === target.toLocaleLowerCase('vi-VN'));
    const targetId = targetVolume?.workCategoryId || targetVolume?.id || undefined;
    const oldName = String(orphan.workCategoryName || '').trim();
    const oldId = String(orphan.workCategoryId || '').trim();
    const matches = (name?: string, id?: string) => Boolean(
      (oldId && id && oldId === String(id).trim()) ||
      (oldName && name && oldName.toLocaleLowerCase('vi-VN') === String(name).trim().toLocaleLowerCase('vi-VN'))
    );
    const affectedSubItems = subItems.filter((sub) => matches(sub.category, sub.workCategoryId)).length;
    const sourceVolume = oldName && categoryVolumes[oldName] !== undefined
      ? Number(categoryVolumes[oldName]) || 0
      : oldId && categoryVolumes[oldId] !== undefined
        ? Number(categoryVolumes[oldId]) || 0
        : (orphan.source === 'room' ? Number(workVolume) || 0 : 0);
    const confirmed = await confirmAsync(
      `Gán lại hạng mục mồ côi:\n\n“${orphan.label}” → “${target}”\n\nHạng mục con liên quan: ${affectedSubItems}\nKhối lượng chuyển: ${formatDecimal(sourceVolume)} ${getRoomWorkCategoryUnit(orphan.workCategoryName || workCategory, workVolumes, floorId) || volumeUnit || 'm²'}\n\nTiến độ, nghiệm thu và đội thi công được giữ nguyên. Không xóa lịch sử. Tiếp tục?`
    );
    if (!confirmed) return;

    setSubItems((prev) => prev.map((sub) => matches(sub.category, sub.workCategoryId)
      ? { ...sub, category: target, workCategoryId: targetId }
      : sub));
    setCategoryVolumes((prev) => {
      const next = { ...prev };
      let moved = 0;
      for (const rawKey of Object.keys(next)) {
        if ((oldId && rawKey === oldId) || (oldName && rawKey.toLocaleLowerCase('vi-VN') === oldName.toLocaleLowerCase('vi-VN'))) {
          moved += Number(next[rawKey]) || 0;
          delete next[rawKey];
        }
      }
      if (moved > 0 || orphan.source === 'categoryVolumes') next[target] = (Number(next[target]) || 0) + moved;
      return next;
    });
    setVolumeStrings((prev) => {
      const next = { ...prev };
      let moved = 0;
      for (const rawKey of Object.keys(next)) {
        if ((oldId && rawKey === oldId) || (oldName && rawKey.toLocaleLowerCase('vi-VN') === oldName.toLocaleLowerCase('vi-VN'))) {
          const parsed = evaluateMathExpression(String(next[rawKey] || ''));
          moved += parsed === null ? 0 : parsed;
          delete next[rawKey];
        }
      }
      if (moved > 0 || orphan.source === 'categoryVolumes') next[target] = formatDecimal((evaluateMathExpression(String(next[target] || '')) || 0) + moved);
      return next;
    });
    if (matches(workCategory, roomItem?.workCategoryId)) setWorkCategory(target);
    setPresetSelection(target);
    setOrphanDismissedKeys((prev) => [...new Set([...prev, orphan.key])]);
    if (focusOrphanRepair && roomItem?.id) {
      window.setTimeout(() => formRef.current?.requestSubmit(), 0);
    }
  };

  const materialAliasMap = React.useMemo(() => buildMaterialAliasMap(materialNorms), [materialNorms]);

  const canonicalMaterialKey = React.useCallback((materialId?: string, materialName?: string, unit?: string) => {
    const resolvedId = materialId ? (materialAliasMap.get(String(materialId)) || String(materialId)) : undefined;
    return getMaterialIdentityKey(resolvedId, materialName, unit);
  }, [materialAliasMap]);

  // Calculate stock balance map from inventory using one canonical material identity.
  const stockMap = React.useMemo(() => {
    const map: Record<string, number> = {};
    inventory.forEach((item) => {
      const key = canonicalMaterialKey(item.materialId, item.materialName, item.unit);
      map[key] = (map[key] || 0) + (item.type === 'in' ? 1 : -1) * (Number(item.quantity) || 0);

      // Legacy transactions without materialId can still match a norm by name + unit.
      if (!item.materialId) {
        const matchedNorm = materialNorms.find((norm) =>
          normalizeMaterialNameKey(norm.materialName) === normalizeMaterialNameKey(item.materialName) &&
          areSameUnit(norm.unit, item.unit)
        );
        if (matchedNorm) {
          const normKey = canonicalMaterialKey(resolveNormMaterialId(matchedNorm), matchedNorm.materialName, matchedNorm.unit);
          if (normKey !== key) {
            map[normKey] = (map[normKey] || 0) + (item.type === 'in' ? 1 : -1) * (Number(item.quantity) || 0);
          }
        }
      }
    });
    return map;
  }, [inventory, materialNorms, canonicalMaterialKey]);

  // Calculate active work categories from every supported room representation.
  // Legacy/imported rooms may have categoryVolumes without subItems, or may store
  // the WorkVolume ID as the categoryVolumes key. Resolve those IDs back to titles.
  const activeCategories = React.useMemo(() => {
    const list = new Set<string>();
    Object.keys(categoryVolumes || {}).forEach((rawKey) => {
      const matched = workVolumes.find((v) => v.id === rawKey);
      list.add(matched?.title || rawKey);
    });
    if (workCategory?.trim()) list.add(workCategory.trim());
    subItems.forEach((item) => {
      const cat = item.category || workCategory || 'Chưa phân nhóm';
      if (cat?.trim()) list.add(cat.trim());
    });
    return Array.from(list).filter(Boolean);
  }, [workCategory, subItems, categoryVolumes, workVolumes]);

  const getCategoryVolume = React.useCallback((cat: string) => {
    if (categoryVolumes[cat] !== undefined) return Number(categoryVolumes[cat]) || 0;
    const matched = workVolumes.find((v) => v.title.trim().toLocaleLowerCase('vi-VN') === cat.trim().toLocaleLowerCase('vi-VN'));
    if (matched && categoryVolumes[matched.id] !== undefined) return Number(categoryVolumes[matched.id]) || 0;
    if (workCategory.trim().toLocaleLowerCase('vi-VN') === cat.trim().toLocaleLowerCase('vi-VN')) return Number(workVolume || 0) || 0;
    return 0;
  }, [categoryVolumes, workVolumes, workCategory, workVolume]);

  const getCategorySourceUnit = (cat: string) => {
    const catalogUnit = getRoomWorkCategoryUnit(cat, workVolumes, floorId);
    return normalizeUnit(catalogUnit || roomItem?.categoryVolumeUnits?.[cat] || volumeUnit || 'm²') || 'm²';
  };

  const getCategoryInputKey = (cat: string) => {
    const catalog = workVolumes.find(v => v.title.trim().toLocaleLowerCase('vi-VN') === cat.trim().toLocaleLowerCase('vi-VN'));
    return Object.prototype.hasOwnProperty.call(categoryVolumes, cat) ? cat :
      catalog && Object.prototype.hasOwnProperty.call(categoryVolumes, catalog.id) ? catalog.id : cat;
  };
  // Do not infer m² from a missing unit or another category's unit.
  const getBasicMeasureUnit = (cat: string) => {
    const name = cat.trim().toLocaleLowerCase('vi-VN');
    const matches = workVolumes.filter(v => v.id === cat || v.workCategoryId === cat || v.title.trim().toLocaleLowerCase('vi-VN') === name);
    const scoped = matches.filter(v => v.floorId === floorId || v.floorIds?.includes(floorId));
    const candidates = scoped.length ? scoped : matches;
    const catalogUnits = [...new Set(candidates.map(v => normalizeUnit(v.unit || '')).filter(Boolean))];
    const savedUnit = roomItem?.categoryVolumeUnits?.[cat] || roomItem?.categoryVolumeUnits?.[getCategoryInputKey(cat)] ||
      (roomItem?.workCategory === cat ? roomItem.volumeUnit : '');
    // Refuse ambiguous or conflicting units instead of changing an old quantity's meaning.
    if (catalogUnits.length > 1) return null;
    const catalogUnit = catalogUnits[0];
    if (catalogUnit && savedUnit && !areSameUnit(catalogUnit, savedUnit)) return null;
    return getBasicRoomMetricUnit(catalogUnit || savedUnit || '');
  };
  const quantityLocked = structureReadOnly || roomItem?.positionLocked === true || roomItem?.inspectionStatus === 'Đạt nghiệm thu';
  const computeDraftFormula = (cat: string, expression: string, source: string, stage?: RoomSubItem) => {
    const fail = (reason: string) => ({ valid: false as const, reason });
    if (quantityLocked || stage?.status === 'Đã hoàn thành' || stage?.inspectionStatus === 'Đạt nghiệm thu') return fail('Khối lượng đã khóa hoặc đã chốt.');
    const unit = normalizeUnit(stage?.volumeUnit || getCategorySourceUnit(cat));
    if (['area','perimeter','length'].includes(source) && !stage?.volumeUnit && !getBasicMeasureUnit(cat)) return fail('Chưa xác định ĐVT đo của hạng mục.');
    if ((source === 'area' && !areSameUnit(unit,'m²')) || ((source === 'perimeter' || source === 'length') && !areSameUnit(unit,'m')))
      return fail('Nguồn đo và ĐVT kết quả không khớp. Dùng công thức nếu cần hệ số chuyển đổi.');
    const variables: QuantityVariables = {};
    const names: string[] = expression.toUpperCase().match(/[A-Z]+/g) || [];
    for (const [name, metric] of [['S','area'],['P','perimeter'],['L','length']] as const) {
      if (!names.includes(name)) continue;
      if (!roomItem?.id || !onMeasureBasicRoom) return fail('Cần lưu phòng và hiệu chuẩn mặt bằng trước.');
      const actualMetric = metric === 'length' ? 'linear' : metric;
      const measured = onMeasureBasicRoom(roomItem, metric === 'area' ? 'm²' : 'm', actualMetric);
      if (measured.valid === false) return fail(measured.reason);
      variables[name] = measured.value;
    }
    if (names.includes('KL')) {
      if (!stage) return fail('KL chỉ dùng cho hạng mục con.');
      if (source === 'parent' && !areSameUnit(unit,getCategorySourceUnit(cat))) return fail('ĐVT con khác ĐVT chính; hãy dùng công thức phù hợp.');
      const key = getCategoryInputKey(cat);
      const raw = categoryVolumes[key] ?? (workCategory.trim().toLocaleLowerCase('vi-VN') === cat.trim().toLocaleLowerCase('vi-VN') && workVolume !== '' ? Number(workVolume) : undefined);
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return fail('Chưa có KL chính hợp lệ.');
      variables.KL = raw;
    }
    const normalized = expression.trim().replace(/^=/,'');
    const legacyNumber = /^[\d.,+\-*/()\s×÷:xX]+$/.test(normalized) ? evaluateMathExpression(normalized) : null;
    const calculated = legacyNumber !== null && Number.isFinite(legacyNumber) && legacyNumber >= 0
      ? {valid:true as const,value:legacyNumber} : evaluateRoomQuantityFormula(normalized,variables);
    if (calculated.valid === false) return calculated;
    const value = legacyNumber !== null ? calculated.value : Math.round(calculated.value * 100) / 100;
    if (!Number.isFinite(value)) return fail('Kết quả vượt giới hạn.');
    return {valid:true as const,value,unit};
  };
  const calculateDraftFormula = (cat: string, expression: string, source: string, stage?: RoomSubItem): string | null => {
    const result = computeDraftFormula(cat,expression,source,stage);
    if (result.valid === false) return result.reason;
    const key = getCategoryInputKey(cat);
    const previous = formulaMeasuredRef.current[stage ? 'sub:'+stage.id : 'main:'+cat];
    if (previous?.expression === expression && previous.source === source && previous.unit === result.unit && previous.value === result.value && (stage ? stage.workVolume : categoryVolumes[key]) === result.value) return null;
    roomDraftDirtyRef.current = true;
    formulaMeasuredRef.current[stage ? 'sub:'+stage.id : 'main:'+cat] = {cat,...(stage ? {stageId:stage.id} : {}),expression,source,unit:result.unit,value:result.value,key};
    if (stage) {
      handleUpdateSubItem(stage.id,{workVolume:result.value,highlightVolumeMode:'manual',highlightCountMode:'manual'});
    } else {
      delete basicMeasuredRef.current[cat];
      setCategoryVolumes(prev=>({...prev,[key]:result.value}));
      setVolumeStrings(prev=>({...prev,[cat]:formatDecimal(result.value),[key]:formatDecimal(result.value)}));
      if (workCategory.trim().toLocaleLowerCase('vi-VN') === cat.trim().toLocaleLowerCase('vi-VN')) setWorkVolume(result.value);
    }
    return null;
  };
  const formulaCategoryKey = (cat:string) => roomFormulaCategoryKey(cat,workVolumes,floorId,getCategoryInputKey(cat));
  const formulaId = (cat:string, stage?:RoomSubItem) => stage?'sub:'+stage.id:'main:'+formulaCategoryKey(cat);
  const formulaSource = (raw:string) => {
    const clean=raw.trim().replace(/^=/,'').toUpperCase();
    return clean==='S'?'area':clean==='L'?'length':clean==='P'?'perimeter':clean==='KL'?'parent':'formula';
  };
  const getQuantityInput = (cat:string, stage?:RoomSubItem) => {
    const id=formulaId(cat,stage);
    const actual=stage?stage.workVolume:categoryVolumes[getCategoryInputKey(cat)] ?? (workCategory===cat&&workVolume!==''?Number(workVolume):undefined);
    const unit=normalizeUnit(stage?.volumeUnit||getCategorySourceUnit(cat));
    const saved=roomItem?.quantityFormulaSettings?.[id];
    const compatible=saved && typeof saved.expression==='string' && saved.expression.length<=256 && typeof saved.auto==='boolean' &&
      saved.categoryKey===formulaCategoryKey(cat) && saved.unit===unit && saved.value===actual;
    const draft: QuantityDraft | undefined=quantityDrafts[id] || (compatible?{raw:saved.expression,auto:saved.auto}:undefined);
    return {id,raw:draft?.raw ?? (actual===undefined||actual===null?'':formatDecimal(actual)),auto:draft?.auto??false,
      error:draft?.error,result:actual===undefined||actual===null||!Number.isFinite(actual)?null:actual};
  };
  const editQuantityInput = (cat:string, raw:string, auto:boolean, stage?:RoomSubItem) => {
    if (quantityLocked || stage?.status==='Đã hoàn thành' || stage?.inspectionStatus==='Đạt nghiệm thu') return;
    const id=formulaId(cat,stage);
    const refKey=stage?'sub:'+stage.id:'main:'+cat;
    let error:string|null=null;
    if (!raw.trim()) {
      delete formulaMeasuredRef.current[refKey];
      roomDraftDirtyRef.current=true;
      if(stage) setSubItems(prev=>prev.map(s=>{if(s.id!==stage.id)return s;const {workVolume: _removed,...rest}=s;return {...rest,highlightVolumeMode:'manual',highlightCountMode:'manual'};}));
      else {
        const key=getCategoryInputKey(cat);
        delete basicMeasuredRef.current[cat];
        setCategoryVolumes(prev=>({...prev,[key]:0}));
        setVolumeStrings(prev=>({...prev,[cat]:'',[key]:''}));
        if(workCategory.trim().toLocaleLowerCase('vi-VN')===cat.trim().toLocaleLowerCase('vi-VN'))setWorkVolume(0);
      }
    } else error=calculateDraftFormula(cat,raw,formulaSource(raw),stage);
    roomDraftDirtyRef.current=true;
    setQuantityDrafts(prev=>{
      const next={raw,auto,...(error?{error}:{})};
      const old=prev[id];
      return old?.raw===next.raw && old?.auto===next.auto && old?.error===next.error?prev:{...prev,[id]:next};
    });
  };
  const toggleQuantityAuto = (cat:string, enabled:boolean, stage?:RoomSubItem) => {
    const input=getQuantityInput(cat,stage);
    if(enabled) editQuantityInput(cat,input.raw,true,stage);
    else {
      roomDraftDirtyRef.current=true;
      setQuantityDrafts(prev=>({...prev,[input.id]:{raw:input.raw,auto:false,...(input.error?{error:input.error}:{})}}));
    }
  };
  const calculateBasicRoomQuantity = (cat: string) => {
    if (ADVANCED_HIGHLIGHT_ENABLED || !roomItem?.id || !onMeasureBasicRoom || structureReadOnly ||
        roomItem.positionLocked || roomItem.inspectionStatus === 'Đạt nghiệm thu') return;
    const unit = getBasicMeasureUnit(cat);
    if (!unit) { window.alert('Chưa xác định ĐVT m² hoặc m của hạng mục chính.'); return; }
    const result = onMeasureBasicRoom(roomItem, unit);
    if (result.valid === false) { window.alert(result.reason); return; }
    // Match the existing room-form number precision; never write on measurement click.
    const value = Math.round(result.value * 100) / 100;
    if (value <= 0 || !Number.isFinite(value)) { window.alert('Kết quả quá nhỏ hoặc không hợp lệ.'); return; }
    if (!window.confirm(`Dùng ${formatDecimal(value)} ${unit} từ biên Highlight căn/phòng cho “${cat}”? Chỉ cập nhật ô khối lượng, chưa lưu.`)) return;
    roomDraftDirtyRef.current = true;
    const key = getCategoryInputKey(cat);
    // Keep the original category key (ID or title), not a duplicate quantity.
    delete formulaMeasuredRef.current['main:'+cat];
    setQuantityDrafts(prev=>({...prev,[formulaId(cat)]:{raw:formatDecimal(value),auto:false}}));
    basicMeasuredRef.current[cat] = { unit, value, key };
    setCategoryVolumes(prev => ({ ...prev, [key]: value }));
    setVolumeStrings(prev => ({ ...prev, [cat]: formatDecimal(value), [key]: formatDecimal(value) }));
    if (workCategory.trim().toLocaleLowerCase('vi-VN') === cat.trim().toLocaleLowerCase('vi-VN')) setWorkVolume(value);
  };
  const getHighlightRoom = () => ({ x, y, width, height, points, isPolyline });
  const hasIndependentTotal = (cat: string) => Object.prototype.hasOwnProperty.call(categoryHighlightTotalVolumes, cat);
  const getHighlightTotalQuantity = (cat: string) => hasIndependentTotal(cat)
    ? categoryHighlightTotalVolumes[cat] : getCategoryVolume(cat);
  const getHighlightTotalShapes = (cat: string): HighlightRegionShape[] => categoryHighlightTotalShapes[cat] || [];
  const getHighlightMainShapes = (cat: string): HighlightRegionShape[] =>
    categoryHighlightShapes[cat]?.length ? categoryHighlightShapes[cat] :
      (categoryHighlightRegions[cat] ? [categoryHighlightRegions[cat]] : []);
  const getStageHighlightResult = (cat: string, stage: RoomSubItem) => {
    if (hasIndependentTotal(cat)) {
      return calculateHighlightTotalRatio({
        room: getHighlightRoom(), total: getHighlightTotalShapes(cat),
        main: getHighlightMainShapes(cat), sub: getHighlightStageShapes(stage),
      });
    }
    if (stage.highlightShapes?.length) {
      return calculateHighlightTotalRatio({ room: getHighlightRoom(), main: getHighlightMainShapes(cat), sub: stage.highlightShapes });
    }
    return computeSubHighlightAreaRatio(getHighlightRoom(), categoryHighlightRegions[cat], getEffectiveStageHighlightRegions(stage));
  };
  const getMainHighlightResult = (cat: string) => calculateHighlightTotalRatio({
    room: getHighlightRoom(), total: getHighlightTotalShapes(cat), main: getHighlightMainShapes(cat),
  });
  const canDeriveStageHighlightQuantity = (cat: string, stage: RoomSubItem): boolean =>
    isAreaHighlightUnit(stage.volumeUnit || getCategorySourceUnit(cat)) && stage.highlightCountMode !== 'points' && Number.isFinite(getHighlightTotalQuantity(cat)) && getHighlightTotalQuantity(cat) >= 0 &&
    (hasIndependentTotal(cat) || !(stage.highlightShapes?.length)) &&
    stage.status !== 'Đã hoàn thành' && stage.inspectionStatus !== 'Đạt nghiệm thu';

  const getHighlightPointFromPointer = (event: React.PointerEvent<SVGSVGElement>): Point2D => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width) * 100)),
      y: Math.min(100, Math.max(0, (event.clientY - bounds.top) / Math.max(1, bounds.height) * 100)),
    };
  };
  // All new shapes use one geometry store; old highlightRegions remain readable.
  const canEditAdvancedHighlight = () => {
    if (roomItem?.inspectionStatus === 'Đạt nghiệm thu' ||
      (highlightTarget !== 'total' && highlightTarget !== 'main' &&
        subItems.some(item => item.id === highlightTarget && (item.status === 'Đã hoàn thành' || item.inspectionStatus === 'Đạt nghiệm thu')))) {
      alert('Vùng đã nghiệm thu/hoàn thành: không tự ý sửa hình học hoặc khối lượng. Hãy thực hiện điều chỉnh nghiệm thu có kiểm soát trước.');
      return false;
    }
    return true;
  };
  const addHighlightShape = (shape: HighlightRegionShape) => {
    if (!canEditAdvancedHighlight() || !validateHighlightShape(shape)) return;
    roomDraftDirtyRef.current = true;
    if (highlightTarget === 'total') {
      setCategoryHighlightTotalShapes(prev => ({ ...prev,
        [highlightSelectedCategory]: appendHighlightRegion ? [...(prev[highlightSelectedCategory] || []), shape].slice(0,24) : [shape] }));
    } else if (highlightTarget === 'main') {
      setCategoryHighlightShapes(prev => ({ ...prev,
        [highlightSelectedCategory]: appendHighlightRegion ? [...(prev[highlightSelectedCategory] || []), shape].slice(0,24) : [shape] }));
    } else {
      setSubItems(prev => prev.map(stage => stage.id !== highlightTarget ? stage : {
        ...stage,
        highlightShapes: appendHighlightRegion ? [...getHighlightStageShapes(stage), shape].slice(0,24) : [shape],
        highlightVolumeMode: canDeriveStageHighlightQuantity(highlightSelectedCategory, stage) ? 'area' : 'manual',
        highlightColor: stage.highlightColor || HIGHLIGHT_COLORS[Math.max(0, prev.findIndex(s => s.id === stage.id)) % HIGHLIGHT_COLORS.length],
      }));
    }
    setAppendHighlightRegion(false);
    setPolygonDraft([]);
    setFreehandDraft([]);
  };
  const finishHighlightPolygon = () => {
    if (polygonDraft.length >= 3) addHighlightShape({kind:'polygon', drawMode:'polygon', points:polygonDraft});
    setPolygonDraft([]);
  };
  const handleHighlightPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (highlightDrawTool === 'polygon') return;
    const start = highlightPointerStartRef.current;
    if (!start) return;
    const end = getHighlightPointFromPointer(event);
    highlightPointerStartRef.current = null;
    setHighlightDraft(null);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    if (highlightDrawTool === 'freehand') {
      const stroke = [...freehandDraft, end];
      if (stroke.length >= 3) addHighlightShape({kind:'polygon', drawMode:'freehand', points:stroke});
      setFreehandDraft([]);
      return;
    }
    const region = normalizeHighlightRect({
      x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y),
    });
    if (region) addHighlightShape(region);
  };
  const clearHighlightRegion = () => {
    if (!canEditAdvancedHighlight()) return;
    roomDraftDirtyRef.current = true;
    if (highlightTarget === 'total') {
      setCategoryHighlightTotalShapes(prev => {const next = {...prev}; delete next[highlightSelectedCategory]; return next;});
    } else if (highlightTarget === 'main') {
      setCategoryHighlightShapes(prev => {const next = {...prev}; delete next[highlightSelectedCategory]; return next;});
      setCategoryHighlightRegions(prev => {const next = {...prev}; delete next[highlightSelectedCategory]; return next;});
    } else {
      setSubItems(prev => prev.map(stage => {
        if (stage.id !== highlightTarget) return stage;
        const { highlightRegions: _legacy, highlightShapes: _shapes, ...unchanged } = stage;
        return unchanged; // Preserve auto mode: no sub-region means 100% of the main category.
      }));
    }
  };
  const selectWholeHighlight = () => {
    if (!canEditAdvancedHighlight()) return;
    roomDraftDirtyRef.current = true;
    if (highlightTarget === 'total' || highlightTarget === 'main') clearHighlightRegion();
    else setSubItems(prev => prev.map(stage => stage.id === highlightTarget ? {
      ...stage,
      highlightShapes: [WHOLE_ROOM_REGION],
      highlightVolumeMode: canDeriveStageHighlightQuantity(highlightSelectedCategory, stage) ? 'area' : 'manual',
    } : stage));
  };
  const highlightSelectedCategory = activeCategories.includes(highlightCategory) ? highlightCategory : (activeCategories[0] || '');
  const highlightedStages = subItems.filter(stage => (stage.category || workCategory || 'Chưa phân nhóm') === highlightSelectedCategory);
  const selectedHighlightStage = highlightedStages.find(stage => stage.id === highlightTarget);
  const draftHighlightRect = highlightDraft ? normalizeHighlightRect({
    x: Math.min(highlightDraft.start.x, highlightDraft.end.x), y: Math.min(highlightDraft.start.y, highlightDraft.end.y),
    width: Math.abs(highlightDraft.end.x - highlightDraft.start.x), height: Math.abs(highlightDraft.end.y - highlightDraft.start.y),
  }) : null;
  const advancedRoomShape = points?.length && !isPolyline ? points.map(p => ({
    x: (p.x - x) / Math.max(0.001, width) * 100,
    y: (p.y - y) / Math.max(0.001, height) * 100,
  })) : null;

  const currentRoomAutoIssuedMap = React.useMemo(() => {
    const map: Record<string, { total: number; stableRecordQty: number }> = {};
    if (!roomItem?.id) return map;
    const legacyLocation = `${floorName} - ${roomItem.roomName}`.trim().toLowerCase();
    inventory.forEach((tx) => {
      if (tx.type !== 'out') return;
      const isCurrentAutoTx =
        (tx.sourceType === 'room-auto' && tx.sourceRoomId === roomItem.id) ||
        (!tx.sourceRoomId &&
          tx.location?.trim().toLowerCase() === legacyLocation &&
          tx.notes?.startsWith('Tự động xuất kho dự toán tổng hợp cho ['));
      if (!isCurrentAutoTx) return;

      let key = canonicalMaterialKey(tx.materialId, tx.materialName, tx.unit);
      if (!tx.materialId) {
        const matchedNorm = materialNorms.find((norm) =>
          normalizeMaterialNameKey(norm.materialName) === normalizeMaterialNameKey(tx.materialName) && areSameUnit(norm.unit, tx.unit)
        );
        if (matchedNorm) key = canonicalMaterialKey(resolveNormMaterialId(matchedNorm), matchedNorm.materialName, matchedNorm.unit);
      }
      if (!map[key]) map[key] = { total: 0, stableRecordQty: 0 };
      map[key].total += Number(tx.quantity) || 0;
      if (tx.sourceIssueKey && tx.id === createDeterministicId('AUTO-XK', tx.sourceIssueKey)) {
        map[key].stableRecordQty = Math.max(map[key].stableRecordQty, Number(tx.quantity) || 0);
      }
    });
    return map;
  }, [inventory, roomItem?.id, roomItem?.roomName, floorName, materialNorms, canonicalMaterialKey]);

  // Single source of truth: the same deterministic Material Need Engine is used by
  // Room, Warehouse floor/team summaries and AI tools. Preserve legacy UI aliases.
  const roomMaterialNeedResult = React.useMemo(() => {
    const draftRoom: RoomProgressItem = {
      ...(roomItem || {} as RoomProgressItem),
      id: roomItem?.id || '__draft_room__',
      floorId,
      floorName,
      roomName: roomName || 'Căn / Phòng mới',
      workCategory,
      workCategoryId: roomItem?.workCategoryId,
      categoryVolumes,
      subItems,
      workVolume: Number(workVolume) || 0,
      volumeUnit,
      assignedTeam,
      teamId: roomItem?.teamId,
      x: roomItem?.x || 0,
      y: roomItem?.y || 0,
      width: roomItem?.width || 1,
      height: roomItem?.height || 1,
      frameStatus: roomItem?.frameStatus || 'Chưa làm',
      boardStatus: roomItem?.boardStatus || 'Chưa làm',
      inspectionStatus: roomItem?.inspectionStatus || 'Chưa nghiệm thu',
      updatedAt: roomItem?.updatedAt || Date.now(),
    };
    return computeMaterialNeeds({
      rooms: [draftRoom],
      materialNorms,
      inventory,
      workVolumes,
      scope: { roomId: draftRoom.id },
    });
  }, [roomItem, floorId, floorName, roomName, workCategory, categoryVolumes, subItems, workVolume, volumeUnit, assignedTeam, materialNorms, inventory, workVolumes]);

  const roomMaterialEstimates = React.useMemo(() => roomMaterialNeedResult.lines.map((line) => {
    const issued = currentRoomAutoIssuedMap[line.materialKey] || { total: line.rawAlreadyIssued, stableRecordQty: 0 };
    const rawAlreadyIssued = Math.max(line.rawAlreadyIssued, issued.total);
    const rawRemainingQty = Math.max(0, line.rawEstimatedQty - rawAlreadyIssued);
    const rawOverIssuedQty = Math.max(0, rawAlreadyIssued - line.rawEstimatedQty);
    return {
      ...line,
      id: line.sourceNormIds.length === 1 ? line.sourceNormIds[0] : undefined,
      estQty: line.estimatedQty,
      alreadyIssued: Math.round(rawAlreadyIssued * 100) / 100,
      rawAlreadyIssued,
      stableRecordQty: issued.stableRecordQty,
      remainingQty: Math.round(rawRemainingQty * 100) / 100,
      rawRemainingQty,
      overIssuedQty: Math.round(rawOverIssuedQty * 100) / 100,
      rawOverIssuedQty,
    };
  }), [roomMaterialNeedResult.lines, currentRoomAutoIssuedMap]);

  const handleAutoIssueForRoom = async () => {
    if (isAutoIssuing) return;
    if (!onAddInventory) {
      alert('Không có hàm tạo phiếu kho.');
      return;
    }
    if (!roomItem?.id) {
      alert('Vui lòng lưu Căn / Phòng trước, sau đó mở lại để xuất kho tự động. Điều này giúp hệ thống theo dõi chính xác vật tư đã xuất cho từng Căn / Phòng.');
      return;
    }

    const validCategories = activeCategories.filter((cat) => getCategoryVolume(cat) > 0);
    if (validCategories.length === 0) {
      alert('Vui lòng nhập khối lượng thi công (> 0) cho ít nhất một hạng mục trước khi xuất kho.');
      return;
    }
    if (roomMaterialEstimates.length === 0) {
      alert('Chưa tìm thấy định mức vật tư phù hợp với các hạng mục thi công này.');
      return;
    }
    if (roomMaterialNeedResult.failClosed) {
      const details = roomMaterialNeedResult.warnings.slice(0, 5).map((warning) => `• ${warning.message}`).join('\n');
      alert(`Không thể xuất kho tự động vì liên kết vật tư/hạng mục chưa duy nhất hoặc chưa đầy đủ. Hãy sửa dữ liệu trước:\n${details}`);
      return;
    }

    const needsIssue = roomMaterialEstimates.filter((item: any) => item.rawRemainingQty > 1e-9);
    if (needsIssue.length === 0) {
      const over = roomMaterialEstimates.filter((item: any) => item.rawOverIssuedQty > 1e-9);
      alert(over.length > 0
        ? `Căn / Phòng này đã xuất đủ vật tư theo định mức hiện tại. Có ${over.length} vật tư đang xuất vượt nhu cầu; vui lòng kiểm tra lịch sử kho.`
        : 'Căn / Phòng này đã xuất đủ vật tư theo định mức hiện tại. Không tạo thêm phiếu xuất trùng.');
      return;
    }

    const draftRoom: RoomProgressItem = {
      ...(roomItem as RoomProgressItem),
      floorId,
      floorName,
      roomName: roomName || roomItem.roomName,
      workCategory,
      workCategoryId: roomItem.workCategoryId,
      categoryVolumes,
      subItems,
      workVolume: Number(workVolume) || 0,
      volumeUnit,
      assignedTeam,
      teamId: roomItem.teamId,
    };

    // Preflight the ENTIRE auto-issue set before the first write. Each material must
    // come from exactly one Norm and one WorkCategory; team is recorded only if the
    // same provenance validator resolves it uniquely and consistently.
    const plannedIssues: Array<{ item: any; sourceNormId: string; sourceWorkCategoryId: string; sourceTeamId?: string }> = [];
    const preflightErrors: string[] = [];
    for (const item of needsIssue as any[]) {
      const normIds = Array.from(new Set((item.sourceNormIds || []).filter(Boolean))) as string[];
      const categoryIds = Array.from(new Set((item.normDetails || []).map((detail: any) => detail.workCategoryId).filter(Boolean))) as string[];
      if (normIds.length !== 1 || categoryIds.length !== 1) {
        preflightErrors.push(`${item.materialName}: nguồn định mức/hạng mục không duy nhất.`);
        continue;
      }
      if (Number(item.rawStockQty) + 1e-9 < Number(item.rawRemainingQty)) {
        preflightErrors.push(`${item.materialName}: cần ${formatDecimal(item.rawRemainingQty)} ${item.unit}, tồn ${formatDecimal(item.rawStockQty)} ${item.unit}.`);
        continue;
      }

      const probe: InventoryItem = {
        id: '__auto_issue_preflight__',
        type: 'out',
        materialId: item.materialId,
        materialName: item.materialName,
        unit: item.unit,
        quantity: Number(item.rawRemainingQty),
        location: `${floorName} - ${roomName || 'Căn / Phòng'}`,
        handler: assignedTeam || 'Đội thi công Căn / Phòng',
        date: toLocalDateInputValue(new Date()),
        sourceType: 'room-auto',
        sourceRoomId: roomItem.id,
        sourceFloorId: floorId,
        sourceNormId: normIds[0],
        sourceWorkCategoryId: categoryIds[0],
      };
      const provenance = validateInventoryOutProvenance({
        tx: probe,
        rooms: [draftRoom],
        workVolumes,
        materialNorms,
        teams,
      });
      if (provenance.state !== 'resolved' || provenance.workCategoryId !== categoryIds[0]) {
        preflightErrors.push(`${item.materialName}: ${provenance.reason || 'provenance OUT không hợp lệ'}.`);
        continue;
      }
      plannedIssues.push({ item, sourceNormId: normIds[0], sourceWorkCategoryId: categoryIds[0], sourceTeamId: provenance.teamId });
    }

    if (preflightErrors.length > 0 || plannedIssues.length !== needsIssue.length) {
      alert(`Không tạo phiếu xuất nào vì preflight chưa đạt:\n• ${preflightErrors.join('\n• ')}`);
      return;
    }

    setIsAutoIssuing(true);
    let issuedCount = 0;
    const catDetailsStr = validCategories.map(cat => `${cat} (${formatDecimal(getCategoryVolume(cat))} ${getCategorySourceUnit(cat)})`).join(', ');

    try {
      for (const planned of plannedIssues) {
        const item = planned.item;
        const sourceIssueKey = `${roomItem.id}|${item.materialKey}`;
        const deterministicId = createDeterministicId('AUTO-XK', sourceIssueKey);
        const cumulativeStableQty = Number(item.stableRecordQty || 0) + Number(item.rawRemainingQty || 0);
        await onAddInventory({
          id: deterministicId,
          type: 'out',
          materialId: item.materialId,
          materialName: item.materialName,
          unit: item.unit,
          quantity: cumulativeStableQty,
          location: `${floorName} - ${roomName || 'Căn / Phòng'}`,
          handler: assignedTeam || 'Đội thi công Căn / Phòng',
          date: toLocalDateInputValue(new Date()),
          notes: `Tự động xuất kho dự toán tổng hợp cho [${roomName || 'Căn / Phòng'}] gồm các hạng mục: ${catDetailsStr}`,
          sourceType: 'room-auto',
          sourceRoomId: roomItem.id,
          sourceFloorId: floorId,
          sourceNormId: planned.sourceNormId,
          sourceTeamId: planned.sourceTeamId,
          sourceWorkCategoryId: planned.sourceWorkCategoryId,
          sourceIssueKey,
        });
        issuedCount++;
      }
      alert(`Đã cập nhật ${issuedCount} phiếu xuất tự động theo phần vật tư còn thiếu cho [${roomName || 'Căn / Phòng'}].`);
    } finally {
      setIsAutoIssuing(false);
    }
  };

  // Handler to add custom sub item
  const handleAddSubItem = (catName?: string) => {
    if (structureReadOnly) return;
    roomDraftDirtyRef.current = true;
    setSubItems(prev => [
      ...prev,
      {
        id: createEntityId('sub-custom'),
        highlightVolumeMode: 'manual',
        name: `Hạng mục ${prev.length + 1}`,
        status: 'Chưa làm',
        inspectionStatus: 'Chưa nghiệm thu',
        targetDate: '',
        category: catName,
      }
    ]);
  };

  const applyProgressPatch = (item: RoomSubItem, patch: Partial<RoomSubItem>): RoomSubItem => {
    const next = { ...item, ...patch };

    // Business invariant: an item can only be "Đạt nghiệm thu" after construction
    // is completed. Moving progress backwards automatically reopens inspection;
    // trying to pass an unfinished item is ignored instead of creating bad data.
    if (next.inspectionStatus === 'Đạt nghiệm thu' && next.status !== 'Đã hoàn thành') {
      if (patch.inspectionStatus === 'Đạt nghiệm thu') return item;
      next.inspectionStatus = 'Chưa nghiệm thu';
    }

    return next;
  };

  // Update sub item field
  const handleUpdateSubItem = (id: string, patch: Partial<RoomSubItem>) => {
    const effectivePatch = structureReadOnly
      ? Object.fromEntries(Object.entries(patch).filter(([key]) => ['status', 'inspectionStatus', 'targetDate', 'assignedTeam', 'teamId'].includes(key))) as Partial<RoomSubItem>
      : patch;
    if (Object.keys(effectivePatch).length === 0) return;
    if (!structureReadOnly && Object.keys(effectivePatch).some(key => key === 'name' || key === 'volumeUnit')) {
      roomDraftDirtyRef.current = true;
    }
    setSubItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const next = applyProgressPatch(item, effectivePatch);
      const wasFinal = item.status === 'Đã hoàn thành' || item.inspectionStatus === 'Đạt nghiệm thu';
      const nowFinal = next.status === 'Đã hoàn thành' || next.inspectionStatus === 'Đạt nghiệm thu';
      const cat = item.category || workCategory || '';
      if (ADVANCED_HIGHLIGHT_ENABLED && !wasFinal && nowFinal && item.highlightVolumeMode === 'area' && canDeriveStageHighlightQuantity(cat, item)) {
        const result = getStageHighlightResult(cat, item);
        if (result.valid) return {
          ...next,
          workVolume: Math.round(getHighlightTotalQuantity(cat) * result.ratio * 10000) / 10000,
          volumeUnit: getCategorySourceUnit(cat),
        };
      }
      return next;
    }));
  };

  // Delete sub item
  const handleDeleteSubItem = async (id: string) => {
    if (structureReadOnly) return;
    if (subItems.length <= 1) {
      // Avoid using window.alert due to iframe restrictions
      return;
    }
    setSubItems(prev => prev.filter(item => item.id !== id));
  };

  // Move category up or down
  const handleMoveCategory = (catName: string, direction: 'up' | 'down') => {
    if (structureReadOnly) return;
    const currentCats = [...activeCategories];
    const index = currentCats.indexOf(catName);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentCats.length) return;
    
    const neighborCat = currentCats[targetIndex];
    
    const newCatOrder = [...currentCats];
    newCatOrder[index] = neighborCat;
    newCatOrder[targetIndex] = catName;
    
    const sortedSubItems = [...subItems].sort((a, b) => {
      const catA = a.category || workCategory || 'Chưa phân nhóm';
      const catB = b.category || workCategory || 'Chưa phân nhóm';
      return newCatOrder.indexOf(catA) - newCatOrder.indexOf(catB);
    });
    
    setSubItems(sortedSubItems);
  };

  // Move sub item up or down within its category
  const handleMoveSubItem = (itemId: string, direction: 'up' | 'down') => {
    if (structureReadOnly) return;
    const index = subItems.findIndex(item => item.id === itemId);
    if (index === -1) return;
    const item = subItems[index];
    const itemCat = item.category || workCategory || 'Chưa phân nhóm';
    
    const sameCatIndices = subItems
      .map((it, idx) => ({ id: it.id, cat: it.category || workCategory || 'Chưa phân nhóm', idx }))
      .filter(it => it.cat === itemCat);
      
    const sameCatPos = sameCatIndices.findIndex(it => it.id === itemId);
    if (sameCatPos === -1) return;
    
    const targetSameCatPos = direction === 'up' ? sameCatPos - 1 : sameCatPos + 1;
    if (targetSameCatPos < 0 || targetSameCatPos >= sameCatIndices.length) return;
    
    const targetIndex = sameCatIndices[targetSameCatPos].idx;
    
    const newSubItems = [...subItems];
    const temp = newSubItems[index];
    newSubItems[index] = newSubItems[targetIndex];
    newSubItems[targetIndex] = temp;
    
    setSubItems(newSubItems);
  };

  const savingRoomRef = React.useRef(false);
  const handleSubmit = async (e: React.FormEvent) => {
    if (savingRoomRef.current) return;
    e.preventDefault();
    const countStageAfterSave = countStageAfterSaveRef.current;
    countStageAfterSaveRef.current = null;
    if (!roomName.trim()) {
      alert('Vui lòng nhập tên hoặc mã Căn / Phòng!');
      return;
    }

    const normalizedRoomName = roomName.trim().toLocaleLowerCase('vi-VN');
    if (existingRoomNames.some((name) => String(name || '').trim().toLocaleLowerCase('vi-VN') === normalizedRoomName)) {
      alert(`Tên Căn / Phòng “${roomName.trim()}” đã tồn tại trên mặt bằng này. Vui lòng dùng tên khác để tránh liên kết Defect/Checklist nhầm phòng.`);
      return;
    }

    const contradictorySubItems = subItems.filter(
      (item) => item.inspectionStatus === 'Đạt nghiệm thu' && item.status !== 'Đã hoàn thành'
    );
    if (contradictorySubItems.length > 0) {
      const names = contradictorySubItems.slice(0, 5).map((item) => `• ${item.name}: ${item.status} → ${item.inspectionStatus}`).join('\n');
      const suffix = contradictorySubItems.length > 5 ? `\n• ... và ${contradictorySubItems.length - 5} hạng mục khác` : '';
      alert(
        `⚠️ Không thể lưu vì có ${contradictorySubItems.length} hạng mục “Đạt nghiệm thu” nhưng thi công chưa hoàn thành.\n\n${names}${suffix}\n\nHãy chuyển Tiến độ sang “Đã hoàn thành” hoặc đưa Nghiệm thu về “Chưa nghiệm thu”.`
      );
      return;
    }

    // Recheck the same room, current calibration and unit before the ordinary save.
    // Do not treat a changed floor/room or a revoked role as an accepted measurement.
    if (!ADVANCED_HIGHLIGHT_ENABLED) {
      for (const [cat, measurement] of Object.entries<{ unit: 'm²' | 'm'; value: number; key: string }>(basicMeasuredRef.current)) {
        const measured = roomItem && onMeasureBasicRoom && onMeasureBasicRoom(roomItem, measurement.unit);
        if (structureReadOnly || !activeCategories.includes(cat) || getBasicMeasureUnit(cat) !== measurement.unit ||
            !measured || measured.valid === false || Math.round(measured.value * 100) / 100 !== measurement.value ||
            categoryVolumes[measurement.key] !== measurement.value) {
          window.alert('Khối lượng đo của “' + cat + '” không còn khớp mặt bằng, phòng hoặc ĐVT hiện tại. Hãy tính lại hoặc nhập tay trước khi lưu.');
          return;
        }
      }
    }
    for (const [refKey, measured] of Object.entries<DraftMeasurement>(formulaMeasuredRef.current)) {
      const stage = measured.stageId ? subItems.find(s=>s.id===measured.stageId) : undefined;
      if (!activeCategories.includes(measured.cat) || (measured.stageId && (!stage || (stage.category || workCategory) !== measured.cat))) {
        // A deleted stage/category does not carry a calculation into the remaining items.
        delete formulaMeasuredRef.current[refKey];
        continue;
      }
      const priorStage=stage && roomItem?.subItems?.find(s=>s.id===stage.id);
      const validationStage=stage && (stage.status==='Đã hoàn thành'||stage.inspectionStatus==='Đạt nghiệm thu') &&
        (!priorStage || (priorStage.status!=='Đã hoàn thành'&&priorStage.inspectionStatus!=='Đạt nghiệm thu'))
        ? {...stage,status:priorStage?.status||'Chưa làm',inspectionStatus:priorStage?.inspectionStatus||'Chưa nghiệm thu'} : stage;
      const current = computeDraftFormula(measured.cat,measured.expression,measured.source,validationStage);
      const actual = stage ? stage.workVolume : categoryVolumes[measured.key];
      if (current.valid === false || current.unit !== measured.unit || current.value !== measured.value || actual !== measured.value || getCategoryInputKey(measured.cat) !== measured.key) {
        window.alert('Nguồn tính hoặc KL đã thay đổi. Hãy tính lại hoặc nhập tay trước khi lưu: '+(stage?.name || measured.cat));
        return;
      }
    }
    if (!structureReadOnly) {
      const invalidInput = activeCategories.some(cat=>!!quantityDrafts[formulaId(cat)]?.error) ||
        subItems.some(stage=>!!quantityDrafts[formulaId(stage.category || workCategory,stage)]?.error);
      if(invalidInput){window.alert('Còn công thức khối lượng không hợp lệ. Vui lòng sửa trước khi lưu.');return;}
    }
    const invalidVolumeFormula = Object.entries(volumeStrings).find(([, raw]) => {
      const text = String(raw || '').trim();
      return Boolean(text) && evaluateMathExpression(text) === null;
    });
    if (invalidVolumeFormula) {
      alert(`Khối lượng của hạng mục “${invalidVolumeFormula[0]}” có công thức không hợp lệ. Ví dụ: 100*5 hoặc 1220/3.`);
      return;
    }

    // Determine overall inspection status across subItems
    let overall: RoomInspectionResult = 'Chưa nghiệm thu';
    const allPassed = subItems.length > 0 && subItems.every(s => s.inspectionStatus === 'Đạt nghiệm thu');
    const anyDefect = subItems.some(s => s.inspectionStatus === 'Chưa đạt (Cần sửa)');
    
    if (allPassed) {
      overall = 'Đạt nghiệm thu';
    } else if (anyDefect) {
      overall = 'Chưa đạt (Cần sửa)';
    }

    const firstSub = subItems[0] || { status: 'Chưa làm', inspectionStatus: 'Chưa nghiệm thu', targetDate: '' };
    const secondSub = subItems[1] || firstSub;

    const parsedVol = workVolume !== '' ? parseFloat(String(workVolume)) : undefined;

    const matchingTeam = displayTeams.find(t => t.name.trim().toLowerCase() === assignedTeam.trim().toLowerCase());
    const finalTeamId = matchingTeam?.id || undefined;

    const activeDefaultCategory = projectWorkCategoryTitles[0] || '';
    const effectiveWorkCategory = workCategory.trim() || activeDefaultCategory;
    const matchingVolume = workVolumes.find(v => v.title.trim().toLowerCase() === effectiveWorkCategory.toLowerCase());
    const finalWorkCategoryId = matchingVolume?.workCategoryId || matchingVolume?.id || undefined;

    // No implicit recompute of old/manual quantities. Only opted-in area stages
    // derive their amounts, and accepted/completed stages are never auto-rewritten.
    const invalidAutoStage = subItems.find(stage => {
      if (!ADVANCED_HIGHLIGHT_ENABLED || stage.highlightVolumeMode !== 'area') return false;
      const cat = stage.category || effectiveWorkCategory;
      // Already-finalized, previously saved area quantities remain frozen.
      if ((stage.status === 'Đã hoàn thành' || stage.inspectionStatus === 'Đạt nghiệm thu') &&
          Number.isFinite(Number(stage.workVolume))) return false;
      return !canDeriveStageHighlightQuantity(cat, stage) || !getStageHighlightResult(cat, stage).valid;
    });
    if (invalidAutoStage) {
      alert(`Không thể tự tính “${invalidAutoStage.name}”: cần khối lượng hạng mục chính theo m², vùng highlight hợp lệ và hạng mục chưa chốt hoàn thành/nghiệm thu. Hãy chọn chế độ thủ công nếu cần giữ dữ liệu hiện tại.`);
      return;
    }

    const invalidAutoMain = activeCategories.find(cat => ADVANCED_HIGHLIGHT_ENABLED && roomItem?.inspectionStatus !== 'Đạt nghiệm thu' && categoryHighlightAutoMode[cat] &&
      (!hasIndependentTotal(cat) || !isAreaHighlightUnit(getCategorySourceUnit(cat)) ||
        !Number.isFinite(getHighlightTotalQuantity(cat)) || getHighlightTotalQuantity(cat) < 0 || !getMainHighlightResult(cat).valid));
    if (invalidAutoMain) {
      alert(`Không thể tự tính hạng mục chính “${invalidAutoMain}”: cần nhập KL vùng tổng m² hợp lệ và vẽ vùng tổng/chính hợp lệ.`);
      return;
    }
    // Recompute only explicitly opted-in categories. Never overwrite old/manual numbers.
    const finalCategoryVolumes = { ...categoryVolumes };
    activeCategories.forEach(cat => {
      if (!ADVANCED_HIGHLIGHT_ENABLED || !categoryHighlightAutoMode[cat] || roomItem?.inspectionStatus === 'Đạt nghiệm thu') return;
      const catalog = workVolumes.find(v => v.title.trim().toLocaleLowerCase('vi-VN') === cat.trim().toLocaleLowerCase('vi-VN'));
      const storageKey = Object.prototype.hasOwnProperty.call(categoryVolumes, cat) ? cat :
        catalog && Object.prototype.hasOwnProperty.call(categoryVolumes, catalog.id) ? catalog.id : cat;
      finalCategoryVolumes[storageKey] = Math.round(getHighlightTotalQuantity(cat) * getMainHighlightResult(cat).ratio * 10000) / 10000;
    });
    const finalSubItems = subItems.map(s => {
      const sCat = s.category || effectiveWorkCategory || '';
      const matchingSubVol = workVolumes.find(v => v.title.trim().toLowerCase() === sCat.trim().toLowerCase());
      const subWorkCategoryId = matchingSubVol?.workCategoryId || matchingSubVol?.id || undefined;

      const sTeam = s.assignedTeam || '';
      const matchingSubTeam = displayTeams.find(t => t.name.trim().toLowerCase() === sTeam.trim().toLowerCase());
      const subTeamId = matchingSubTeam?.id || undefined;

      return {
        ...s,
        ...(ADVANCED_HIGHLIGHT_ENABLED && s.highlightVolumeMode === 'area' && s.status !== 'Đã hoàn thành' && s.inspectionStatus !== 'Đạt nghiệm thu' ? {
          workVolume: Math.round(getHighlightTotalQuantity(sCat) * getStageHighlightResult(sCat, s).ratio * 10000) / 10000,
          volumeUnit: getCategorySourceUnit(sCat),
        } : {}),
        workCategoryId: subWorkCategoryId,
        teamId: subTeamId
      };
    });

    const categoryVolumeUnits = activeCategories.reduce<Record<string, string>>((acc, cat) => {
      const explicitSubUnits = finalSubItems
        .filter((sub) => (sub.category || workCategory || '') === cat && sub.volumeUnit)
        .map((sub) => normalizeUnit(sub.volumeUnit || ''))
        .filter(Boolean);
      const uniqueSubUnits = Array.from(new Set(explicitSubUnits));
      const catalogUnit = getRoomWorkCategoryUnit(cat, workVolumes, floorId);
      acc[cat] = basicMeasuredRef.current[cat]?.unit || normalizeUnit(catalogUnit || (uniqueSubUnits.length === 1 ? uniqueSubUnits[0] : '') || roomItem?.categoryVolumeUnits?.[cat] || volumeUnit || 'm²') || 'm²';
      return acc;
    }, {});

    const quantityFormulaSettings: Record<string,RoomQuantityFormulaSetting> = {...(roomItem?.quantityFormulaSettings || {})};
    const saveFormulaSetting = (cat:string,stage?:RoomSubItem) => {
      const id=formulaId(cat,stage), draft=quantityDrafts[id];
      if(!draft)return;
      const ref=formulaMeasuredRef.current[stage?'sub:'+stage.id:'main:'+cat];
      const raw=draft.raw.trim();
      if(!raw || !/[A-Za-z+*/()\-×÷:]/.test(raw)) {delete quantityFormulaSettings[id];return;}
      if(ref && ref.expression===draft.raw && !draft.error) {
        quantityFormulaSettings[id]={expression:raw,auto:draft.auto,categoryKey:formulaCategoryKey(cat),unit:ref.unit,value:ref.value};
      } else {
        const saved=quantityFormulaSettings[id];
        if(saved && saved.expression===raw && !draft.error) quantityFormulaSettings[id]={...saved,auto:draft.auto};
      }
    };
    if(!structureReadOnly) {
      activeCategories.forEach(cat=>saveFormulaSetting(cat));
      finalSubItems.forEach(stage=>saveFormulaSetting(stage.category||effectiveWorkCategory,stage));
    }
    const roomData: Omit<RoomProgressItem, 'updatedAt'> = {
      id: roomItem?.id,
      floorId,
      floorName,
      roomName: roomName.trim(),
      workCategory: effectiveWorkCategory,
      workCategoryId: finalWorkCategoryId,
      categoryVolumes: finalCategoryVolumes,
      categoryVolumeUnits,
      ...(Object.keys(quantityFormulaSettings).length || roomItem?.quantityFormulaSettings ? {quantityFormulaSettings} : {}),
      ...(Object.keys(categoryHighlightTotalVolumes).length || roomItem?.categoryHighlightTotalVolumes ? { categoryHighlightTotalVolumes } : {}),
      ...(Object.keys(categoryHighlightTotalShapes).length || roomItem?.categoryHighlightTotalShapes ? { categoryHighlightTotalShapes } : {}),
      ...(Object.keys(categoryHighlightShapes).length || roomItem?.categoryHighlightShapes ? { categoryHighlightShapes } : {}),
      ...(Object.keys(categoryHighlightAutoMode).length || roomItem?.categoryHighlightAutoMode ? { categoryHighlightAutoMode } : {}),
      ...(Object.keys(categoryHighlightRegions).length || Object.keys(roomItem?.categoryHighlightRegions || {}).length ? { categoryHighlightRegions } : {}),
      subItems: finalSubItems,
      workVolume: ADVANCED_HIGHLIGHT_ENABLED && categoryHighlightAutoMode[effectiveWorkCategory] && roomItem?.inspectionStatus !== 'Đạt nghiệm thu'
        ? Math.round(getHighlightTotalQuantity(effectiveWorkCategory) * getMainHighlightResult(effectiveWorkCategory).ratio * 10000) / 10000
        : (parsedVol !== undefined && !isNaN(parsedVol) ? parsedVol : undefined),
      volumeUnit: basicMeasuredRef.current[effectiveWorkCategory]?.unit || getCategorySourceUnit(effectiveWorkCategory),
      x,
      y,
      width,
      height,
      points,
      frameStatus: firstSub.status,
      boardStatus: secondSub.status,
      frameInspectionStatus: firstSub.inspectionStatus || 'Chưa nghiệm thu',
      boardInspectionStatus: secondSub.inspectionStatus || 'Chưa nghiệm thu',
      inspectionStatus: overall,
      inspectorName: inspectorName.trim(),
      notes: notes.trim(),
      assignedTeam,
      teamId: finalTeamId,
      color: selectedColor || undefined,
      isPolyline,
      targetFrameDate: firstSub.targetDate || '',
      targetBoardDate: secondSub.targetDate || '',
    };

    savingRoomRef.current = true;
    try {
    if (structureReadOnly && roomItem) {
      await onSaveRoom({
        ...roomItem,
        frameStatus: roomData.frameStatus,
        boardStatus: roomData.boardStatus,
        frameInspectionStatus: roomData.frameInspectionStatus,
        boardInspectionStatus: roomData.boardInspectionStatus,
        inspectionStatus: roomData.inspectionStatus,
        inspectorName: roomData.inspectorName,
        notes: roomData.notes,
        assignedTeam: roomData.assignedTeam,
        teamId: roomData.teamId,
        targetFrameDate: roomData.targetFrameDate,
        targetBoardDate: roomData.targetBoardDate,
        subItems: (roomItem.subItems || []).map((original) => {
          const edited = roomData.subItems?.find((item) => item.id === original.id);
          if (!edited) return original;
          return {
            ...original,
            status: edited.status,
            inspectionStatus: edited.inspectionStatus,
            targetDate: edited.targetDate,
            assignedTeam: edited.assignedTeam,
            teamId: edited.teamId,
          };
        }),
      });
    } else {
      await onSaveRoom(roomData);
    }

    onClose();
    if (countStageAfterSave && roomItem && onStartCountOnMap) onStartCountOnMap(roomItem, countStageAfterSave);
    } catch (err) {
      alert(`Không thể lưu tiến độ: ${err instanceof Error ? err.message : String(err)}. Dữ liệu chưa được ghi. Vui lòng tải lại và đối chiếu.`);
    } finally {
      savingRoomRef.current = false;
    }
  };

  // Combined checklist items list for dropdown selection
  const allChecklistTitles = Array.from(
    new Set([
      ...DEFAULT_CHECKLIST_CRITERIA,
      ...checklistItems.map(c => c.title)
    ])
  );

  if (!isOpen) return null;

  return (
    <div data-hnl-pc-v32-window="room-editor" className="hnl-ios-safe-modal fixed inset-y-0 right-0 left-0 lg:left-[84px] bg-slate-900/60 backdrop-blur-xs z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="hnl-ios-safe-dialog bg-white w-full sm:max-w-3xl lg:max-w-[1200px] xl:max-w-[1280px] rounded-t-3xl sm:rounded-2xl p-4 sm:p-5 lg:p-6 space-y-4 max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col border border-slate-100 shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {roomItem ? `${structureReadOnly ? 'Cập nhật hiện trường' : 'Sửa nghiệm thu'} - ${roomItem.roomName}` : `Tạo vùng Căn / Phòng`}
              </h3>
              <p className="text-xs text-slate-500">Mặt bằng: {floorName}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {contextReturnLabel && <button type="button" onClick={() => closeRoomWithDraftGuard('Quay lại')}
              className="min-h-9 rounded-lg bg-indigo-50 px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-100" data-hnl-room-context-back="true">← Quay lại {contextReturnLabel}</button>}
          <button
            type="button" onClick={() => closeRoomWithDraftGuard('Đóng Căn/Phòng')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
          </div>
        </div>

        {/* Form Body */}
        <form data-hnl-pc-v32-region="room-form" ref={formRef} onSubmit={handleSubmit}
          onChangeCapture={(event) => { if (!(event.target as HTMLElement).closest('[data-hnl-ui-only]')) roomDraftDirtyRef.current = true; }}
          onInputCapture={(event) => { if (!(event.target as HTMLElement).closest('[data-hnl-ui-only]')) roomDraftDirtyRef.current = true; }}
          onClickCapture={(event) => {
            // Interactive buttons can also mutate nested subitems without input events.
            const element = event.target as HTMLElement;
            const button = element.closest('button');
            if (button?.type === 'button' && !button.hasAttribute('data-hnl-ui-only')) roomDraftDirtyRef.current = true;
          }}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain space-y-3.5 pr-1 text-xs">
          {structureReadOnly && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] font-semibold text-indigo-800">
              Kỹ sư chỉ cập nhật tiến độ, nghiệm thu, đội thi công, hạn hoàn thành và ghi chú. Tên Căn/Phòng, khối lượng và hình học mặt bằng do Admin quản lý.
            </div>
          )}

          {orphanWorkCategoryRefs.length > 0 && (
            <div ref={orphanRepairRef} className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-3 space-y-2 shadow-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <div>
                  <div className="text-xs font-black text-rose-800">Hạng mục mồ côi cần xử lý</div>
                  <div className="mt-0.5 text-[10px] font-semibold text-rose-700">Các hạng mục dưới đây đã bị xóa/không còn trong Khối lượng. HNL không dùng chúng để tính AI/vật tư và không cho chọn lại trong dropdown thường.</div>
                </div>
              </div>
              {orphanWorkCategoryRefs.map((orphan) => (
                <div key={orphan.key} className="rounded-xl border border-rose-200 bg-white p-2.5 space-y-2">
                  <div className="text-[11px] font-black text-slate-900">⚠️ {orphan.label}</div>
                  <div className="text-[9px] font-semibold text-slate-500">Nguồn tham chiếu: {orphan.source === 'room' ? 'Căn/Phòng' : orphan.source === 'categoryVolumes' ? 'Khối lượng theo hạng mục' : 'Hạng mục con'}</div>
                  {!structureReadOnly && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select
                        value={orphanRepairTargets[orphan.key] || ''}
                        onChange={(e) => setOrphanRepairTargets((prev) => ({ ...prev, [orphan.key]: e.target.value }))}
                        className="min-w-0 flex-1 rounded-lg border border-rose-200 bg-white px-2.5 py-2 text-[10.5px] font-bold text-slate-800"
                      >
                        <option value="">-- Chọn hạng mục đang còn để gán lại --</option>
                        {projectWorkCategoryTitles.map((title) => <option key={title} value={title}>{title}</option>)}
                      </select>
                      <button
                        type="button"
                        disabled={!orphanRepairTargets[orphan.key]}
                        onClick={() => void remapOrphanCategory(orphan)}
                        className="rounded-lg bg-rose-600 px-3 py-2 text-[10.5px] font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {focusOrphanRepair ? 'Gán lại & lưu' : 'Gán lại hạng mục'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!structureReadOnly && projectWorkCategoryTitles.length === 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-bold text-amber-800">Chưa có hạng mục active trong Khối lượng để gán lại. Hãy tạo hạng mục hợp lệ ở Khối lượng trước.</div>}
            </div>
          )}
          
          {/* Room / Apartment Name */}
          <div>
            <label className="block font-bold text-slate-800 mb-1">Tên Căn / Phòng *</label>
            <input
              type="text"
              placeholder="VD: Căn A101 (Phòng Khách), Phòng WC 2..."
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              disabled={structureReadOnly}
              className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>

          {/* Custom Highlight Color Option (Collapsible) */}
          {!structureReadOnly && <div className="bg-slate-50/90 rounded-2xl border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="w-full p-3 flex items-center justify-between text-left hover:bg-slate-100/80 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] font-extrabold text-slate-800 truncate">
                  🎨 Tùy Chọn Màu Sắc
                </span>
                {selectedColor && (
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-slate-400 inline-block shrink-0 shadow-2xs"
                    style={{ backgroundColor: selectedColor }}
                  />
                )}
              </div>
              <div className="flex items-center gap-1 text-slate-500 text-xs font-semibold shrink-0">
                <span>{showColorPicker ? 'Thu gọn' : 'Tùy chỉnh'}</span>
                <ChevronDown data-open={showColorPicker} className="hnl-disclosure-chevron w-4 h-4" aria-hidden="true" />
              </div>
            </button>

            {showColorPicker && (
              <div className="px-3 pb-3 pt-1 border-t border-slate-200/80 space-y-2 bg-white/50">
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10.5px] font-bold text-slate-600">Bảng màu gợi ý:</span>
                  {selectedColor && (
                    <button
                      type="button"
                      onClick={() => setSelectedColor('')}
                      className="text-[10px] text-amber-700 hover:text-amber-800 font-extrabold bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
                    >
                      ↺ Tự động (Mỗi căn 1 màu)
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {ROOM_COLOR_PALETTE.map((c) => {
                    const isSelected = selectedColor?.toLowerCase() === c.hex.toLowerCase();
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedColor(c.hex)}
                        style={{ backgroundColor: c.hex }}
                        className={`w-6 h-6 rounded-full transition-all flex items-center justify-center border-2 cursor-pointer ${
                          isSelected
                            ? 'scale-125 border-slate-900 shadow-md ring-2 ring-indigo-400 z-10'
                            : 'border-white hover:scale-110 opacity-90 hover:opacity-100'
                        }`}
                        title={c.name}
                      >
                        {isSelected && <span className="text-white text-[10px] font-black drop-shadow-xs">✓</span>}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-500 font-medium">
                  {!selectedColor
                    ? '✨ Đang dùng chế độ tự động: Hệ thống sẽ tự cấp mỗi căn 1 màu đa sắc phân biệt.'
                    : '🎨 Bạn đã chọn màu tùy chỉnh riêng cho Căn / Phòng này.'}
                </p>
              </div>
            )}
          </div>}





          {/* ROOM WORK CATEGORIES: single section for picking and managing work */}
          <div data-hnl-room-work-categories="true" className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/90 space-y-3">
            {!structureReadOnly && roomItem?.id && (roomItem.positionLocked === true || roomItem.inspectionStatus === 'Đạt nghiệm thu') && (
              <p data-hnl-highlight-draw-block-reason="true" className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10.5px] font-semibold text-amber-800">
                {roomItem.positionLocked === true ? 'Phòng đang khóa vị trí. Mở khóa trước khi vẽ Highlight trên mặt bằng.' : 'Phòng đã đạt nghiệm thu; vùng và khối lượng được bảo vệ, không thể vẽ đè.'}
              </p>
            )}
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
              <div className="p-1.5 bg-indigo-600 text-white rounded-lg shrink-0 shadow-2xs">
                <ListChecks className="w-4 h-4" />
              </div>
              <h4 className="min-w-0 font-extrabold text-slate-900 text-xs uppercase tracking-wide break-words">
                <span>Hạng mục thi công ({subItems.length})</span>
              </h4>
            </div>

            {/* Keep preset controls inside the same section; read-only users still see the saved list. */}
            {!structureReadOnly && (
              <div className="space-y-2">
                <div data-hnl-room-preset-inline-row="true" className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <label htmlFor="hnl-room-work-category-preset" className="sr-only">Chọn hạng mục thi công</label>
                    <select
                      id="hnl-room-work-category-preset"
                      value={presetSelection}
                      onChange={(e) => setPresetSelection(e.target.value)}
                      className="w-full min-w-0 border border-indigo-200 rounded-xl p-2.5 text-xs font-bold text-slate-800 bg-white focus:ring-2 focus:ring-indigo-500 shadow-2xs truncate"
                    >
                      {presetWorkCategories.map((catName) => (
                        <option key={catName} value={catName}>
                          {catName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div data-hnl-pc-v35-actions="room-preset" className="flex flex-col gap-2 lg:shrink-0">
                    <button
                      type="button"
                      onClick={() => presetSelection && handleApplyPreset(presetSelection)}
                      disabled={!presetSelection}
                      className="w-full lg:w-auto px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs shadow-2xs active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>Thêm vào phòng</span>
                    </button>
                  </div>
                </div>
                {presetWorkCategories.length === 0 && (
                  <p className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                    Chưa có hạng mục đang hoạt động. Hãy tạo hạng mục ở tab Khối lượng trước; ứng dụng không tự phục hồi hạng mục đã xóa.
                  </p>
                )}
              </div>
            )}

            {/* Select All & Bulk Actions Toolbar */}
            {subItems.length > 0 && (
              <div className="bg-white border border-slate-200 p-3 rounded-2xl space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="flex items-center gap-2 font-black text-slate-700 cursor-pointer select-none text-[11px]">
                    <input
                      type="checkbox"
                      checked={subItems.length > 0 && subItems.every(s => selectedSubItemIds.includes(s.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedSubItemIds(subItems.map(s => s.id));
                        } else {
                          setSelectedSubItemIds([]);
                        }
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>Chọn tất cả ({subItems.length})</span>
                  </label>

                  {!structureReadOnly && selectedSubItemIds.length > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (await confirmAsync(`⚠️ Bạn có chắc muốn xóa ${selectedSubItemIds.length} hạng mục đã chọn không?`)) {
                          setSubItems(prev => prev.filter(s => !selectedSubItemIds.includes(s.id)));
                          setSelectedSubItemIds([]);
                        }
                      }}
                      className="text-rose-600 hover:text-rose-700 font-extrabold flex items-center gap-1 cursor-pointer transition-colors text-[10.5px]"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Xóa {selectedSubItemIds.length} Đã Chọn
                    </button>
                  )}
                </div>

                {/* Bulk updating controls panel */}
                {selectedSubItemIds.length > 0 ? (
                  <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 space-y-2.5 text-[10px]">
                    <div className="font-extrabold text-slate-800 text-[10.5px] border-b border-slate-200/50 pb-1.5 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Cập nhật nhanh {selectedSubItemIds.length} hạng mục đã chọn:</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {/* Progress Status */}
                      <div>
                        <span className="font-bold text-slate-600 block mb-1">Tiến độ thi công:</span>
                        <div data-hnl-pc-v36-room-status="bulk" className="grid grid-cols-3 gap-1">
                          {(['Chưa làm', 'Đang làm', 'Đã hoàn thành'] as AcceptanceStatus[]).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={async () => {
                                setSubItems(prev => prev.map(s => selectedSubItemIds.includes(s.id) ? applyProgressPatch(s, { status: st }) : s));
                              }}
                              className="py-1 px-0.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300 rounded-lg font-bold text-[9.5px] cursor-pointer transition-colors text-center"
                            >
                              {st === 'Đã hoàn thành' ? '✅ Xong' : st === 'Đang làm' ? '🚧 Làm' : '⏳ Chưa'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Inspection Status */}
                      <div>
                        <span className="font-bold text-slate-600 block mb-1">Nghiệm thu:</span>
                        <div data-hnl-pc-v36-room-status="bulk" className="grid grid-cols-3 gap-1">
                          {(['Chưa nghiệm thu', 'Đạt nghiệm thu', 'Chưa đạt (Cần sửa)'] as RoomInspectionResult[]).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={async () => {
                                if (st === 'Đạt nghiệm thu') {
                                  const blockedCount = subItems.filter(s => selectedSubItemIds.includes(s.id) && s.status !== 'Đã hoàn thành').length;
                                  if (blockedCount > 0) {
                                    alert(`⚠️ Có ${blockedCount} hạng mục chưa hoàn thành nên không thể chuyển sang “Đạt nghiệm thu”. Hãy cập nhật Tiến độ = “Đã hoàn thành” trước.`);
                                  }
                                }
                                setSubItems(prev => prev.map(s => selectedSubItemIds.includes(s.id) ? applyProgressPatch(s, { inspectionStatus: st }) : s));
                              }}
                              className="py-1 px-0.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300 rounded-lg font-bold text-[9.5px] cursor-pointer transition-colors text-center"
                            >
                              {st === 'Đạt nghiệm thu' ? '🏆 Đạt' : st === 'Chưa đạt (Cần sửa)' ? '⚠️ Lỗi' : '⏳ Chờ'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 border-t border-slate-200/40">
                      {/* Assigned Team */}
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-slate-600 shrink-0 text-[10.5px]">👷 Đội thi công:</span>
                        <select
                          value=""
                          onChange={(e) => {
                            const team = e.target.value;
                            if (team !== '') {
                              setSubItems(prev => prev.map(s => selectedSubItemIds.includes(s.id) ? { ...s, assignedTeam: team } : s));
                            }
                          }}
                          className="flex-1 font-bold border border-slate-200 rounded-lg px-2 py-1 text-[10.5px] bg-white max-w-full truncate outline-none"
                        >
                          <option value="">-- Chọn áp dụng --</option>
                          {displayTeams.map((t) => (
                            <option key={t.id || t.name} value={t.name}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Target Date */}
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-slate-600 shrink-0 text-[10.5px]">📅 Hạn xong:</span>
                        <input
                          type="date"
                          onChange={(e) => {
                            const date = e.target.value;
                            setSubItems(prev => prev.map(s => selectedSubItemIds.includes(s.id) ? { ...s, targetDate: date } : s));
                          }}
                          className="flex-1 text-[10.5px] border border-slate-200 rounded-lg px-2 py-1 bg-white outline-none"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* List of sub items grouped by category */}
            <div className="space-y-4">
              {(Object.entries(
                subItems.reduce((acc: Record<string, typeof subItems>, item) => {
                  const catName = item.category || workCategory || 'Chưa phân nhóm';
                  if (!acc[catName]) {
                    acc[catName] = [];
                  }
                  acc[catName].push(item);
                  return acc;
                }, {} as Record<string, typeof subItems>)
              ) as [string, typeof subItems][]).map(([catName, itemsInCat], catIdx) => (
                <div key={`${catName}-${catIdx}`} className="space-y-3 bg-slate-50/70 p-3 rounded-2xl border border-slate-100">
                  {/* Category Header */}
                  <div className="flex flex-col border-b border-slate-200 pb-2 mb-1 gap-2.5">
                    <div data-hnl-room-category-title-row="true" className="flex flex-col gap-2 w-full min-w-0 xl:flex-row xl:items-center">
                      {/* Select to swap category */}
                      <select
                        disabled={structureReadOnly}
                        value={activeWorkCategoryNameMap.has(catName.trim().toLocaleLowerCase('vi-VN')) ? catName : ''}
                        onChange={(e) => {
                          const newCat = e.target.value;
                          if (newCat && newCat !== catName) {
                            // Update sub-items categories
                            setSubItems(prev => prev.map(item => {
                              const itemCat = item.category || workCategory || 'Chưa phân nhóm';
                              if (itemCat === catName) {
                                return { ...item, category: newCat };
                              }
                              return item;
                            }));
                            // Update categoryVolumes
                            setCategoryVolumes(prev => {
                              const updated = { ...prev };
                              updated[newCat] = updated[catName] || 0;
                              delete updated[catName];
                              return updated;
                            });
                            setVolumeStrings(prev => {
                              const updated = { ...prev };
                              updated[newCat] = updated[catName] || '';
                              delete updated[catName];
                              return updated;
                            });
                            // Relink the optional main highlight, rather than leaving
                            // its geometry under the removed category name.
                            setCategoryHighlightRegions(prev => {
                              if (!prev[catName]) return prev;
                              const next = { ...prev, [newCat]: prev[catName] };
                              delete next[catName];
                              return next;
                            });
                            setHighlightCategory(prev => prev === catName ? newCat : prev);
                            // Update workCategory if matches
                            if (workCategory === catName) {
                              setWorkCategory(newCat);
                            }
                          }
                        }}
                        className="w-full xl:w-auto xl:flex-1 xl:min-w-0 font-black text-[13px] text-indigo-950 bg-indigo-50/80 hover:bg-indigo-100 border border-indigo-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-3xs"
                      >
                        {!activeWorkCategoryNameMap.has(catName.trim().toLocaleLowerCase('vi-VN')) && (
                          <option value="" disabled>⚠️ Đã xóa: {catName} — chọn hạng mục mới</option>
                        )}
                        {availableWorkCategories.map(c => (
                          <option key={c} value={c}>🏗️ {c}</option>
                        ))}
                      </select>

                      <div data-hnl-room-category-inline-actions="true" className="flex w-full xl:w-auto xl:shrink-0 flex-wrap items-center justify-between gap-2 mt-0.5 xl:mt-0">
                        {/* Interactive Input Volume directly in the list */}
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full bg-emerald-50/70 border border-emerald-100 rounded-xl px-2.5 py-1">
                          <span className="shrink-0 whitespace-nowrap text-[10px] font-extrabold text-emerald-800">KL:</span>
                          {(() => {
                            const input=getQuantityInput(catName);
                            return <RoomQuantityCalculator label={'hạng mục chính '+catName} unit={getBasicMeasureUnit(catName) || getCategorySourceUnit(catName)} raw={input.raw} result={input.result} auto={input.auto} error={input.error}
                              disabled={quantityLocked} refreshKey={JSON.stringify([roomItem?.revision,roomItem?.updatedAt,getCategorySourceUnit(catName)])}
                              onEdit={raw=>editQuantityInput(catName,raw,input.auto)}
                              onToggleAuto={enabled=>toggleQuantityAuto(catName,enabled)}
                              onRecalculate={()=>editQuantityInput(catName,input.raw,input.auto)}/>;
                          })()}
                          {!ADVANCED_HIGHLIGHT_ENABLED && !structureReadOnly && roomItem?.id && onMeasureBasicRoom && getBasicMeasureUnit(catName) && <button type="button" data-hnl-basic-room-quantity={catName}
                            disabled={roomItem.inspectionStatus === 'Đạt nghiệm thu' || roomItem.positionLocked === true}
                            onClick={() => calculateBasicRoomQuantity(catName)}
                            title="Tính từ biên Highlight căn/phòng theo tỷ lệ đã lưu; chưa ghi dữ liệu"
                            className="shrink-0 border-l border-emerald-200 pl-1.5 text-[10px] font-extrabold text-indigo-700 hover:text-indigo-900 disabled:opacity-40">📐 {getBasicMeasureUnit(catName) === 'm²' ? 'Tính diện tích' : 'Tính chu vi'}</button>}
                          {ADVANCED_HIGHLIGHT_ENABLED && !structureReadOnly && roomItem?.id && onStartDrawOnMap && <button type="button" data-hnl-ui-only="true" data-hnl-main-quantity-map={catName}
                            disabled={roomItem.inspectionStatus === 'Đạt nghiệm thu' || roomItem.positionLocked === true}
                            onClick={() => {
                              if (!itemsInCat.length) { launchCach2(catName, 'main'); return; }
                              setMapPickerCategory(previous => previous === catName ? null : catName);
                              setMapPickerTarget('main'); setMapPickerMessage(''); setMapPickerNewName('');
                              setMapPickerRenameTarget(null); setMapPickerRenameText('');
                            }}
                            title={`Đo vẽ khối lượng của hạng mục chính: ${catName}`}
                            className="shrink-0 border-l border-emerald-200 pl-1.5 text-[10px] font-extrabold text-indigo-700 hover:text-indigo-900 disabled:opacity-40">📐 Mặt bằng</button>}

                          {!structureReadOnly && activeCategories.length > 1 && (
                            <MoveOrderControls
                              onMoveUp={() => handleMoveCategory(catName, 'up')}
                              onMoveDown={() => handleMoveCategory(catName, 'down')}
                              className="shrink-0 ml-1"
                              label="Sắp thứ tự hạng mục chính"
                            />
                          )}
                        </div>
                        {/* PC only: Add sub-item to the RIGHT of the main category volume.
                            Mobile/tablet keep the separate button below. */}
                        {!structureReadOnly && (
                          <button
                            data-hnl-room-add-subitem-inline="true"
                            type="button"
                            onClick={() => handleAddSubItem(catName)}
                            className="hidden lg:inline-flex px-3 py-1.5 bg-white hover:bg-indigo-50 text-indigo-600 border border-indigo-200 border-dashed hover:border-indigo-300 font-bold rounded-xl text-[11px] items-center justify-center gap-1.5 transition-all cursor-pointer shadow-3xs active:scale-98"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Thêm hạng mục con</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  {ADVANCED_HIGHLIGHT_ENABLED && mapPickerCategory === catName && !structureReadOnly && roomItem?.id && (
                    <div data-hnl-main-highlight-stage-picker={catName}
                      className="mx-1 mt-2 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-2 space-y-2 text-[11px] text-slate-800">
                      <div className="font-bold">Mặt bằng · {catName}</div>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex-1 min-w-[180px] font-semibold">Vùng cần vẽ
                          <select data-hnl-ui-only="true" aria-label={`Chọn hạng mục con đã có của ${catName}`}
                            value={mapPickerTarget}
                            onChange={e => {setMapPickerTarget(e.target.value);setMapPickerMessage('');setMapPickerRenameTarget(null);setMapPickerRenameText('');}}
                            className="block mt-1 w-full rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-xs">
                            <option value="main">Hạng mục chính (vùng riêng)</option>
                            {itemsInCat.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                            <option value="new">+ Nhập hạng mục con mới</option>
                          </select>
                        </label>
                        {mapPickerTarget !== 'new' && (
                          <button type="button" data-hnl-ui-only="true" onClick={() => {
                            const target = mapPickerTarget === 'main' || itemsInCat.some(stage => stage.id === mapPickerTarget)
                              ? mapPickerTarget : 'main';
                            launchCach2(catName, target);
                          }}
                            disabled={mapPickerTarget !== 'main' && itemsInCat.some(stage => stage.id === mapPickerTarget &&
                              (stage.status === 'Đã hoàn thành' || stage.inspectionStatus === 'Đạt nghiệm thu'))}
                            className="rounded-lg bg-indigo-700 px-3 py-1.5 font-bold text-white disabled:opacity-40">
                            Vẽ tiếp vùng đã chọn
                          </button>
                        )}
                      </div>
                      {mapPickerTarget !== 'main' && mapPickerTarget !== 'new' &&
                        itemsInCat.some(stage => stage.id === mapPickerTarget && stage.status !== 'Đã hoàn thành' &&
                          stage.inspectionStatus !== 'Đạt nghiệm thu') && (
                        <div className="flex flex-wrap items-end gap-2">
                          {mapPickerRenameTarget !== mapPickerTarget ? (
                            <button type="button" data-hnl-ui-only="true" className="text-indigo-700 underline font-semibold"
                              onClick={() => {
                                const stage = itemsInCat.find(s => s.id === mapPickerTarget);
                                setMapPickerRenameTarget(stage?.id || null);
                                setMapPickerRenameText(stage?.name || '');
                              }}>Sửa tên hạng mục con đã chọn</button>
                          ) : (
                            <>
                              <label className="flex-1 min-w-[170px]">Tên mới (giữ nguyên ID)
                                <input aria-label="Sửa tên hạng mục con đã có" maxLength={120}
                                  value={mapPickerRenameText} onChange={e => setMapPickerRenameText(e.target.value)}
                                  className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-xs" />
                              </label>
                              <button type="button" className="rounded-lg bg-indigo-700 px-3 py-1.5 text-white font-bold"
                                onClick={() => {
                                  const selected = itemsInCat.find(s => s.id === mapPickerTarget);
                                  const nextName = mapPickerRenameText.trim();
                                  if (!selected || !nextName) {setMapPickerMessage('Tên mới không hợp lệ.');return;}
                                  if (itemsInCat.some(s => s.id !== selected.id &&
                                    s.name.trim().toLocaleLowerCase('vi-VN') === nextName.toLocaleLowerCase('vi-VN'))) {
                                    setMapPickerMessage('Tên đã có trong hạng mục chính này; không tạo trùng.');return;
                                  }
                                  handleUpdateSubItem(selected.id, {name:nextName});
                                  setMapPickerRenameTarget(null);
                                  setMapPickerMessage('Đã sửa tên trên biểu mẫu, giữ ID và KL cũ. Nhấn Lưu trước khi vẽ tiếp.');
                                }}>Áp dụng</button>
                              <button type="button" data-hnl-ui-only="true" onClick={() => setMapPickerRenameTarget(null)}
                                className="text-slate-600">Hủy</button>
                            </>
                          )}
                        </div>
                      )}
                      {mapPickerTarget === 'new' && (
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="flex-1 min-w-[170px]">Tên hạng mục con mới
                            <input aria-label="Nhập tên hạng mục con mới" value={mapPickerNewName}
                              onChange={e => setMapPickerNewName(e.target.value)} maxLength={120}
                              className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-xs"
                              placeholder="VD: Thi công khung" />
                          </label>
                          <button type="button" onClick={() => {
                            const name = mapPickerNewName.trim();
                            const matched = itemsInCat.find(stage => stage.name.trim().toLocaleLowerCase('vi-VN') === name.toLocaleLowerCase('vi-VN'));
                            if (!name) {setMapPickerMessage('Cần nhập tên hạng mục con.');return;}
                            if (matched) {
                              setMapPickerTarget(matched.id);
                              setMapPickerMessage('Hạng mục đã tồn tại: chọn lại vùng cũ, không tạo trùng ID.');return;
                            }
                            roomDraftDirtyRef.current = true;
                            setSubItems(prev => [...prev, {
                              id: createEntityId('sub-custom'), name, category: catName,
                              highlightVolumeMode: 'manual', status: 'Chưa làm',
                              inspectionStatus: 'Chưa nghiệm thu', targetDate: '',
                            }]);
                            setMapPickerTarget('main');setMapPickerNewName('');
                            setMapPickerMessage('Đã thêm vào biểu mẫu. Nhấn Lưu trước, sau đó chọn Mặt bằng của hạng mục con để vẽ; chưa ghi dữ liệu lên máy chủ.');
                          }} className="rounded-lg bg-emerald-700 px-3 py-1.5 font-bold text-white">
                            Thêm vào biểu mẫu
                          </button>
                        </div>
                      )}
                      <div className="text-slate-600">Muốn sửa tên hạng mục con đã có: sửa trực tiếp ở dòng bên dưới rồi nhấn Lưu. ID, KL và nghiệm thu được giữ nguyên.</div>
                      {mapPickerMessage && <div role="status" className="text-indigo-900 font-semibold">{mapPickerMessage}</div>}
                    </div>
                  )}

                  {/* Original mobile/tablet standalone Add-subitem action; PC uses the inline action. */}
                  {!structureReadOnly && (
                    <button
                      data-hnl-room-add-subitem-mobile="true"
                      type="button"
                      onClick={() => handleAddSubItem(catName)}
                      className="lg:hidden w-full lg:w-auto lg:px-4 py-2 bg-white hover:bg-indigo-50 text-indigo-600 border border-indigo-200 border-dashed hover:border-indigo-300 font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-3xs active:scale-98 mb-2"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Thêm hạng mục con</span>
                    </button>
                  )}

                  <div className="hidden xl:grid xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,1fr)] gap-3 px-3 py-2 rounded-xl border border-slate-200 bg-slate-100/80 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                    <div>Hạng mục con &amp; đội thi công</div>
                    <div>Tiến độ · Nghiệm thu · Hạn hoàn thành</div>
                  </div>

                  <div className="space-y-3">
                    {itemsInCat.map((item) => {
                      const originalIndex = subItems.findIndex(s => s.id === item.id);
                      return (
                        <div key={`${item.id}-${originalIndex}`} className="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-2xs space-y-2.5 xl:space-y-0 xl:grid xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,1fr)] xl:gap-3 xl:items-start overflow-x-hidden">
                          <div className="min-w-0 space-y-2 xl:min-h-[104px]">
                            <div className="flex items-center justify-between gap-1.5 min-w-0">
                            <div className="flex items-center gap-2 shrink-0">
                              <input
                                type="checkbox"
                                checked={selectedSubItemIds.includes(item.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedSubItemIds(prev => [...prev, item.id]);
                                  } else {
                                    setSelectedSubItemIds(prev => prev.filter(id => id !== item.id));
                                  }
                                }}
                                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                              />
                              <span className="font-black text-indigo-700 text-[11px] bg-indigo-50 px-1.5 py-0.5 rounded-md">
                                #{originalIndex + 1}
                              </span>
                              {!structureReadOnly && itemsInCat.length > 1 && (
                                <MoveOrderControls
                                  onMoveUp={() => handleMoveSubItem(item.id, 'up')}
                                  onMoveDown={() => handleMoveSubItem(item.id, 'down')}
                                  compact
                                  label="Sắp thứ tự hạng mục con"
                                />
                              )}
                            </div>
                            <input
                              type="text"
                              value={item.name}
                              disabled={structureReadOnly}
                              onChange={(e) => handleUpdateSubItem(item.id, { name: e.target.value })}
                              placeholder="Tên hạng mục thi công..."
                              className="flex-1 font-extrabold text-slate-900 text-xs border border-slate-200 rounded-lg px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none min-w-0"
                            />
                            {!structureReadOnly && (deletingSubItemId === item.id ? (
                              <div className="flex items-center gap-1 bg-rose-50 border border-rose-200 px-1.5 py-1 rounded-lg animate-in fade-in shrink-0">
                                <span className="text-[10px] font-bold text-rose-800">Xóa?</span>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    handleDeleteSubItem(item.id);
                                    setDeletingSubItemId(null);
                                  }}
                                  className="px-1.5 py-0.5 bg-rose-600 text-white rounded text-[10px] font-bold hover:bg-rose-700 cursor-pointer shadow-2xs shrink-0"
                                >
                                  Đồng ý
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingSubItemId(null)}
                                  className="px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px] font-bold hover:bg-slate-300 cursor-pointer shrink-0"
                                >
                                  Hủy
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setDeletingSubItemId(item.id)}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer shrink-0"
                                title="Xóa hạng mục này"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ))}
                            </div>

                            {/* Quantity and team are separate business sections. */}
                            <div data-hnl-sub-quantity-group="true" className="bg-emerald-50/40 p-2 rounded-xl border border-emerald-100 text-[10.5px]">
                              {(ADVANCED_HIGHLIGHT_ENABLED || structureReadOnly) && <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1.5">
                                <span className="font-bold text-slate-600">Khối lượng con:</span>
                                {(() => {
                                  const finalized = item.status === 'Đã hoàn thành' || item.inspectionStatus === 'Đạt nghiệm thu';
                                  const auto = ADVANCED_HIGHLIGHT_ENABLED && item.highlightVolumeMode === 'area' && item.highlightCountMode !== 'points' && !finalized;
                                  const result = auto ? getStageHighlightResult(catName, item) : null;
                                  const canAuto = auto && canDeriveStageHighlightQuantity(catName, item) && result?.valid;
                                  const displayedVolume = canAuto && result
                                    ? Math.round(getHighlightTotalQuantity(catName) * result.ratio * 10000) / 10000
                                    : item.workVolume;
                                  const validNumber = displayedVolume !== undefined && displayedVolume !== null &&
                                    String(displayedVolume).trim() !== '' && Number.isFinite(Number(displayedVolume));
                                  const unit = canAuto ? getCategorySourceUnit(catName) : (item.volumeUnit || getCategorySourceUnit(catName));
                                  const tooltip = canAuto
                                    ? 'Tính tức thời theo KL vùng tổng nếu đã thiết lập; chỉ ghi khi nhấn Lưu. Không có vùng con = phủ toàn vùng chính.'
                                    : finalized ? 'Khối lượng đã chốt; không tự tính lại.' : 'Khối lượng thủ công hoặc đã lưu.';
                                  return (
                                    <span data-hnl-subitem-quantity={item.id}
                                      className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap rounded-lg border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-950"
                                      title={tooltip}>
                                      <span className="font-semibold">KL:</span>
                                      <strong className="tabular-nums">{validNumber ? `${formatDecimal(Number(displayedVolume))} ${unit}` : 'Chưa có'}</strong>
                                      {canAuto && <span className="text-sky-700" title="Tự tính theo vùng">↻</span>}
                                      {ADVANCED_HIGHLIGHT_ENABLED && normalizeUnit(item.volumeUnit || getCategorySourceUnit(catName)) === 'Cái' && <span title="Tổng điểm đánh dấu" className="text-teal-700 font-bold"> · {totalCountPoints(item.highlightCountPoints || [])} cái đếm</span>}
                                      {ADVANCED_HIGHLIGHT_ENABLED && !structureReadOnly && roomItem?.id && (
                                        <button type="button" data-hnl-ui-only="true" aria-label={`Vẽ vùng highlight cho ${item.name}`}
                                          disabled={item.status === 'Đã hoàn thành' || item.inspectionStatus === 'Đạt nghiệm thu' || roomItem.inspectionStatus === 'Đạt nghiệm thu' || roomItem.positionLocked === true}
                                          onClick={() => launchCach2(catName, item.id)}
                                          className="ml-0.5 border-l border-emerald-200 pl-1 font-bold text-indigo-700 hover:text-indigo-900 disabled:opacity-40"
                                          title="Đo vẽ khối lượng hạng mục con trên mặt bằng">Mặt bằng</button>
                                      )}
                                    </span>
                                  );
                                })()}
                              </div>}
                              {!ADVANCED_HIGHLIGHT_ENABLED && !structureReadOnly && <div data-hnl-subitem-editable-quantity={item.id} className="flex flex-wrap items-center gap-1.5">
                                <span className="shrink-0 whitespace-nowrap font-bold text-slate-600">KL con:</span>
                                {(() => {
                                  const input=getQuantityInput(catName,item);
                                  return <RoomQuantityCalculator label={'hạng mục con '+item.name} allowParent raw={input.raw} result={input.result} auto={input.auto} error={input.error}
                                    disabled={quantityLocked || item.status==='Đã hoàn thành' || item.inspectionStatus==='Đạt nghiệm thu'}
                                    refreshKey={JSON.stringify([roomItem?.revision,roomItem?.updatedAt,getCategoryVolume(catName),item.volumeUnit,getCategorySourceUnit(catName)])}
                                    onEdit={raw=>editQuantityInput(catName,raw,input.auto,item)}
                                    onToggleAuto={enabled=>toggleQuantityAuto(catName,enabled,item)}
                                    onRecalculate={()=>editQuantityInput(catName,input.raw,input.auto,item)}/>;
                                })()}
                              </div>}
                              {/* ĐVT Cái: count positions are stored separately from m² highlights and Defects. */}
                              {!structureReadOnly && <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px]" data-hnl-sub-unit-spacing="true">
                                <label className="font-bold text-slate-600">ĐVT con:
                                  <select aria-label={`Đơn vị hạng mục con ${item.name}`} data-hnl-sub-count-unit="true"
                                    disabled={item.status === 'Đã hoàn thành' || item.inspectionStatus === 'Đạt nghiệm thu' || roomItem?.inspectionStatus === 'Đạt nghiệm thu'}
                                    className="ml-1.5 rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-800"
                                    value={!item.volumeUnit ? '__main__' :
                                      ['m²','m','Cái','Bộ','Tấm','Thanh','m³','kg','Hộp','Bao','Cuộn'].includes(normalizeUnit(item.volumeUnit))
                                        ? normalizeUnit(item.volumeUnit) : '__custom__'}
                                    onChange={event => {
                                      const next = event.target.value;
                                      if (next === '__custom__') {
                                        setCustomUnitStageId(item.id);
                                        setCustomUnitText(item.volumeUnit || '');return;
                                      }
                                      const effectiveBefore = normalizeUnit(item.volumeUnit || getCategorySourceUnit(catName));
                                      const effectiveAfter = normalizeUnit(next === '__main__' ? getCategorySourceUnit(catName) : next);
                                      if (effectiveBefore !== effectiveAfter && !window.confirm('Đổi ĐVT không tự quy đổi KL đã lưu; chế độ tự tính hiện tại sẽ chuyển về nhập tay. Tiếp tục?')) return;
                                      roomDraftDirtyRef.current = true;
                                      if(effectiveBefore!==effectiveAfter){delete formulaMeasuredRef.current['sub:'+item.id];setQuantityDrafts(prev=>({...prev,[formulaId(catName,item)]:{raw:item.workVolume===undefined?'':formatDecimal(item.workVolume),auto:false}}));}
                                      handleUpdateSubItem(item.id, {
                                        volumeUnit: next === '__main__' ? '' : next,
                                        ...(effectiveBefore !== effectiveAfter ? { highlightVolumeMode:'manual', highlightCountMode:'manual' } : {}),
                                      });
                                      setCustomUnitStageId(null);
                                    }}>
                                    <option value="__main__">Theo ĐVT chính ({getCategorySourceUnit(catName)})</option>
                                    {['m²','m','Cái','Bộ','Tấm','Thanh','m³','kg','Hộp','Bao','Cuộn'].map(unit =>
                                      <option key={unit} value={unit}>{unit}</option>)}
                                    <option value="__custom__">{item.volumeUnit && !['m²','m','Cái','Bộ','Tấm','Thanh','m³','kg','Hộp','Bao','Cuộn'].includes(normalizeUnit(item.volumeUnit))
                                      ? `${item.volumeUnit} (tự nhập)` : 'Nhập đơn vị khác…'}</option>
                                  </select>
                                </label>
                                {customUnitStageId !== item.id && item.volumeUnit &&
                                  !['m²','m','Cái','Bộ','Tấm','Thanh','m³','kg','Hộp','Bao','Cuộn'].includes(normalizeUnit(item.volumeUnit)) &&
                                  item.status !== 'Đã hoàn thành' && item.inspectionStatus !== 'Đạt nghiệm thu' && (
                                    <button type="button" className="text-indigo-700 underline font-bold"
                                      onClick={() => {setCustomUnitStageId(item.id);setCustomUnitText(item.volumeUnit || '');}}>Sửa ĐVT</button>
                                )}
                                {customUnitStageId === item.id && (
                                  <div className="flex items-center gap-1.5" data-hnl-sub-unit-custom-editor="true">
                                    <input aria-label={`Nhập đơn vị tùy chỉnh cho ${item.name}`}
                                      value={customUnitText} maxLength={24} onChange={e => setCustomUnitText(e.target.value)}
                                      placeholder="VD: md, bộ, m²" className="w-28 rounded-lg border border-indigo-300 bg-white px-2 py-1.5 text-xs" />
                                    <button type="button" className="rounded-lg bg-indigo-700 px-2 py-1.5 font-bold text-white"
                                      onClick={() => {
                                        const raw = normalizeUnit(customUnitText);
                                        if (!raw || raw.length > 24) { window.alert('ĐVT phải có 1–24 ký tự.');return; }
                                        const previous = normalizeUnit(item.volumeUnit || getCategorySourceUnit(catName));
                                        if (previous !== raw && !window.confirm('Đổi ĐVT không tự quy đổi KL đã lưu; chế độ tự tính sẽ chuyển về nhập tay. Tiếp tục?')) return;
                                        roomDraftDirtyRef.current = true;
                                        if(previous!==raw){delete formulaMeasuredRef.current['sub:'+item.id];setQuantityDrafts(prev=>({...prev,[formulaId(catName,item)]:{raw:item.workVolume===undefined?'':formatDecimal(item.workVolume),auto:false}}));}
                                        handleUpdateSubItem(item.id, {volumeUnit:raw,
                                          ...(previous !== raw ? {highlightVolumeMode:'manual',highlightCountMode:'manual'} : {}) });
                                        setCustomUnitStageId(null);
                                      }}>Áp dụng</button>
                                    <button type="button" className="px-1 text-slate-500" onClick={() => setCustomUnitStageId(null)}>Hủy</button>
                                  </div>
                                )}
                                {ADVANCED_HIGHLIGHT_ENABLED && normalizeUnit(item.volumeUnit || getCategorySourceUnit(catName)) === 'Cái' && <>
                                  <span className="rounded-md border border-teal-200 bg-teal-50 px-1.5 py-1 font-bold text-teal-800">
                                    {item.highlightCountMode === 'points' ? 'Đếm theo điểm' : 'Nhập tay'} · {totalCountPoints(item.highlightCountPoints || [])} cái tự đếm
                                  </span>
                                  {onStartCountOnMap && roomItem?.id && <button type="button" data-hnl-ui-only="true"
                                    disabled={item.status === 'Đã hoàn thành' || item.inspectionStatus === 'Đạt nghiệm thu' || roomItem.inspectionStatus === 'Đạt nghiệm thu'}
                                    onClick={() => { countStageAfterSaveRef.current = item.id; formRef.current?.requestSubmit(); }}
                                    className="rounded-lg border border-teal-300 bg-teal-100 px-2 py-1 font-bold text-teal-900 disabled:opacity-40">
                                    Lưu biểu mẫu & Đánh dấu trên mặt bằng
                                  </button>}
                                </>}
                              </div>}
                            </div>
                            <div data-hnl-sub-team-group="true" className="mt-3 bg-slate-50 p-2 rounded-xl border border-slate-100 text-[10.5px]">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <User className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                <span className="font-bold text-slate-600">Đội thi công:</span>
                              </div>
                              <div data-hnl-room-team-contact-row="true" className="flex min-w-0 flex-col gap-1.5 xl:flex-row xl:items-center">
                              <select
                                value={item.assignedTeam || ''}
                                onChange={(e) => handleUpdateSubItem(item.id, { assignedTeam: e.target.value })}
                                className="order-1 w-full min-w-0 xl:flex-1 font-bold border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                              >
                                <option value="">-- Chọn đội (Quân số) --</option>
                                {displayTeams.map((t) => (
                                  <option key={t.id || t.name} value={t.name}>
                                    👷 {t.name} ({t.leader || 'Trưởng đội'})
                                  </option>
                                ))}
                                {item.assignedTeam && !displayTeams.some(t => t.name === item.assignedTeam) && (
                                  <option value={item.assignedTeam}>👷 {item.assignedTeam}</option>
                                )}
                              </select>
                              {(() => {
                                const matchingTeam = displayTeams.find(t => t.name === item.assignedTeam);
                                if (matchingTeam?.phone) {
                                  return (
                                    <div className="order-2 flex justify-end xl:shrink-0">
                                      <ContactMenu
                                        target={{ name: matchingTeam.leader || matchingTeam.name, phone: matchingTeam.phone }}
                                        context={{ type: 'room', shareText: `HNL QLTC – Liên hệ đội thi công\nĐội: ${matchingTeam.name}\nĐội trưởng: ${matchingTeam.leader || 'Chưa cập nhật'}\nSĐT: ${matchingTeam.phone}` }}
                                        triggerLabel="Liên hệ"
                                      />
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                              </div>
                            </div>
                          </div>

                          <div data-hnl-room-pc-status-column="true" className="min-w-0 space-y-2 xl:space-y-2.5">
                          {/* Status buttons: Thi công */}
                          <div>
                            <span className="text-[10.5px] font-bold text-slate-500 block mb-1">Tiến độ thi công:</span>
                            <div data-hnl-pc-v36-room-status="item" className="grid grid-cols-3 gap-1.5 mb-1.5">
                              {(['Chưa làm', 'Đang làm', 'Đã hoàn thành'] as AcceptanceStatus[]).map((st) => (
                                <button
                                  key={st}
                                  type="button"
                                  onClick={() => handleUpdateSubItem(item.id, { status: st })}
                                  className={`py-1.5 px-1 rounded-xl font-bold text-[10px] transition-all border cursor-pointer ${
                                    item.status === st
                                      ? st === 'Đã hoàn thành'
                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs font-black'
                                        : st === 'Đang làm'
                                        ? 'bg-amber-500 text-white border-amber-500 shadow-xs font-black'
                                        : 'bg-slate-800 text-white border-slate-800 shadow-xs font-black'
                                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                  }`}
                                >
                                  {st === 'Đã hoàn thành' ? '✅ Xong' : st === 'Đang làm' ? '🚧 Đang làm' : '⏳ Chưa làm'}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Status buttons: Nghiệm thu */}
                          <div className="pt-2 border-t border-slate-200">
                            <span className="text-[10.5px] font-bold text-indigo-700 block mb-1">Nghiệm thu hạng mục này:</span>
                            <div data-hnl-pc-v36-room-status="item" className="grid grid-cols-3 gap-1.5 mb-1.5">
                              {(['Chưa nghiệm thu', 'Đạt nghiệm thu', 'Chưa đạt (Cần sửa)'] as RoomInspectionResult[]).map((st) => (
                                <button
                                  key={st}
                                  type="button"
                                  disabled={st === 'Đạt nghiệm thu' && item.status !== 'Đã hoàn thành'}
                                  title={st === 'Đạt nghiệm thu' && item.status !== 'Đã hoàn thành' ? 'Phải hoàn thành thi công trước khi đạt nghiệm thu' : undefined}
                                  onClick={() => handleUpdateSubItem(item.id, { inspectionStatus: st })}
                                  className={`py-1.5 px-1 rounded-xl font-bold text-[10px] transition-all border ${
                                    st === 'Đạt nghiệm thu' && item.status !== 'Đã hoàn thành' ? 'opacity-40 cursor-not-allowed bg-slate-50 text-slate-400 border-slate-200' : 'cursor-pointer'
                                  } ${
                                    item.inspectionStatus === st
                                      ? st === 'Đạt nghiệm thu'
                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs font-black'
                                        : st === 'Chưa đạt (Cần sửa)'
                                        ? 'bg-rose-600 text-white border-rose-600 shadow-xs font-black'
                                        : 'bg-slate-700 text-white border-slate-700 shadow-xs'
                                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                                  }`}
                                >
                                  {st === 'Đạt nghiệm thu' ? '🏆 Đạt NT' : st === 'Chưa đạt (Cần sửa)' ? '⚠️ Lỗi NT' : '⏳ Chờ NT'}
                                </button>
                              ))}
                            </div>

                            {/* Target Date */}
                            <div className="flex items-center gap-2 mt-2">
                              <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <label className="text-[10.5px] font-bold text-slate-600 shrink-0">Hạn xong:</label>
                              <input
                                type="date"
                                value={item.targetDate || ''}
                                onChange={(e) => handleUpdateSubItem(item.id, { targetDate: e.target.value })}
                                className="flex-1 text-[10.5px] border border-slate-200 rounded-lg px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none"
                              />
                            </div>
                          </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>


          </div>

          {/* Metric calibration stays on the floor toolbar; each main/child item opens that map inline above. */}
          {/* Legacy Cách 1 records remain readable/preserved, but editor is hidden. */}
          {legacyHighlightEditorVisible && !structureReadOnly && roomItem?.id && (
            <section data-hnl-room-highlight-advanced="true" className="rounded-2xl border border-sky-200 bg-sky-50/50 overflow-hidden">
              <button type="button" data-hnl-ui-only="true" aria-expanded={showAdvancedHighlights}
                onClick={() => setShowAdvancedHighlights(prev => !prev)}
                className="w-full p-3.5 flex items-center justify-between gap-3 text-left hover:bg-sky-100/60">
                <span className="min-w-0">
                  <span className="block font-extrabold text-sky-950 text-xs">Mở rộng highlight &amp; khối lượng</span>
                  <span className="block text-[10.5px] text-sky-700">Tùy chọn · vẽ vùng phụ và tự tính theo tỷ lệ m²</span>
                </span>
                <ChevronDown data-open={showAdvancedHighlights} className="hnl-disclosure-chevron w-4 h-4 text-sky-700 shrink-0" aria-hidden="true" />
              </button>
              {showAdvancedHighlights && (
                <div className="border-t border-sky-200 bg-white/70 p-3.5 space-y-3">
                  <div className="rounded-lg border border-sky-100 bg-white p-2 text-[10.5px] text-slate-600">
                    Chỉ mở rộng vùng của phòng đã lưu. <strong>Không thay đổi highlight phòng hiện tại</strong>. Vùng tổng mặc định là toàn phòng; chỉ hạng mục phụ bật “Tự tính” mới cập nhật khối lượng khi nhấn Lưu.
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="block text-[11px] font-bold text-slate-700">
                      Hạng mục chính
                      <select data-hnl-ui-only="true" aria-label="Chọn hạng mục chính để tô vùng" value={highlightSelectedCategory}
                        onChange={e => { setHighlightCategory(e.target.value); setHighlightTarget('main'); setAppendHighlightRegion(false); setPolygonDraft([]); setFreehandDraft([]); }}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800">
                        {activeCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                    </label>
                    <label className="block text-[11px] font-bold text-slate-700">
                      Vùng muốn vẽ
                      <select data-hnl-ui-only="true" aria-label="Chọn vùng tổng, hạng mục chính hoặc hạng mục con" value={highlightTarget === 'main' || highlightTarget === 'total' || highlightedStages.some(stage => stage.id === highlightTarget) ? highlightTarget : 'total'}
                        onChange={e => { setHighlightTarget(e.target.value); setAppendHighlightRegion(false); setPolygonDraft([]); setFreehandDraft([]); }}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800">
                        <option value="total">Vùng tổng độc lập</option>
                        <option value="main">Vùng hạng mục chính</option>
                        {highlightedStages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="rounded-xl border border-sky-200 bg-white p-3 space-y-2" data-hnl-highlight-independent-total="true">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="text-[11px] font-extrabold text-slate-800">
                        Khối lượng vùng tổng riêng (m²)
                        <input type="number" inputMode="decimal" min="0" step="any"
                          aria-label="Nhập khối lượng vùng tổng độc lập"
                          value={hasIndependentTotal(highlightSelectedCategory) ? categoryHighlightTotalVolumes[highlightSelectedCategory] : ''}
                          onChange={event => {
                            roomDraftDirtyRef.current = true;
                            const next = event.target.value;
                            setCategoryHighlightTotalVolumes(prev => {
                              const data = { ...prev };
                              if (!next.trim()) delete data[highlightSelectedCategory];
                              else if (Number.isFinite(Number(next)) && Number(next) >= 0) data[highlightSelectedCategory] = Number(next);
                              return data;
                            });
                          }}
                          disabled={!isAreaHighlightUnit(getCategorySourceUnit(highlightSelectedCategory)) || roomItem?.inspectionStatus === 'Đạt nghiệm thu'}
                          placeholder="Để trống = phép tính cũ"
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs text-slate-900" />
                      </label>
                      <div className="space-y-2 text-[11px] text-slate-700">
                        <label className="flex items-center gap-2 font-bold">
                          <input type="checkbox" checked={categoryHighlightAutoMode[highlightSelectedCategory] === true}
                            disabled={!hasIndependentTotal(highlightSelectedCategory) || !isAreaHighlightUnit(getCategorySourceUnit(highlightSelectedCategory)) || roomItem?.inspectionStatus === 'Đạt nghiệm thu'}
                            onChange={event => { roomDraftDirtyRef.current = true; setCategoryHighlightAutoMode(prev => ({ ...prev, [highlightSelectedCategory]: event.target.checked })); }}/>
                          Tự tính KL hạng mục chính theo vùng tổng
                        </label>
                        <span className="block text-[10px] text-slate-500">Bỏ trống giữ nguyên KL cũ. Vùng tổng mặc định phủ toàn phòng, lớp hiển thị trên mặt bằng mặc định ẩn.</span>
                        {roomItem?.inspectionStatus === 'Đạt nghiệm thu' && <span className="block font-bold text-amber-800">Phòng đã nghiệm thu: không tự ghi đè KL chính.</span>}
                        {!isAreaHighlightUnit(getCategorySourceUnit(highlightSelectedCategory)) && <span className="text-amber-700">Đơn vị m/bộ/cái không dùng phép tính theo diện tích.</span>}
                      </div>
                    </div>
                    {hasIndependentTotal(highlightSelectedCategory) && (() => {
                      const stat = getMainHighlightResult(highlightSelectedCategory);
                      return <div className="flex flex-wrap gap-2 text-[11px] font-bold">
                        <span className="rounded bg-blue-50 px-2 py-1 text-blue-800">Tổng: {formatDecimal(getHighlightTotalQuantity(highlightSelectedCategory))} m²</span>
                        <span className="rounded bg-sky-50 px-2 py-1 text-sky-900">Hạng mục chính: {stat.valid ? `${formatDecimal(stat.percent)}% = ${formatDecimal(getHighlightTotalQuantity(highlightSelectedCategory) * stat.ratio)} m²` : stat.reason}</span>
                      </div>;
                    })()}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-lg bg-sky-100 px-2 py-1 text-sky-800 font-bold">KL chính đang lưu: {formatDecimal(getCategoryVolume(highlightSelectedCategory))} {getCategorySourceUnit(highlightSelectedCategory)}</span>
                    {selectedHighlightStage && (() => {
                      const stat = getStageHighlightResult(highlightSelectedCategory, selectedHighlightStage);
                      return <>
                        <span className="rounded-lg bg-amber-100 px-2 py-1 font-bold text-amber-900">{stat.valid ? `${formatDecimal(stat.percent)}% vùng tổng` : stat.reason}</span>
                        {isAreaHighlightUnit(getCategorySourceUnit(highlightSelectedCategory)) && stat.valid && (
                          <span className="rounded-lg bg-emerald-100 px-2 py-1 font-bold text-emerald-800">
                            KL tính lại khi Lưu: {formatDecimal(getHighlightTotalQuantity(highlightSelectedCategory) * stat.ratio)} m²
                          </span>
                        )}
                      </>;
                    })()}
                  </div>
                  <div className="flex flex-wrap gap-2" data-hnl-highlight-three-draw-tools="true">
                    {([['2point', 'Chữ nhật · 2 điểm'], ['polygon', 'Đa giác · chấm điểm'], ['freehand', 'Vẽ tự do · kéo nét']] as const).map(([tool, label]) =>
                      <button type="button" key={tool} onClick={() => { setHighlightDrawTool(tool); setHighlightDraft(null); setPolygonDraft([]); setFreehandDraft([]); highlightPointerStartRef.current = null; }}
                        aria-pressed={highlightDrawTool === tool} className={`rounded-lg border px-3 py-2 text-[11px] font-bold ${highlightDrawTool === tool ? 'bg-blue-700 text-white border-blue-700' : 'bg-white border-slate-200 text-slate-800'}`}>{label}</button>)}
                  </div>
                  <div className="text-[10.5px] text-slate-600">
                    Chữ nhật: kéo 2 điểm. Đa giác: chấm các góc rồi bấm “Kết thúc đa giác”. Vẽ tự do: kéo quanh vùng muốn tô. Không thay đổi biên căn/phòng.
                  </div>
                  {highlightDrawTool === 'polygon' && polygonDraft.length > 0 && <div className="flex items-center gap-2">
                    <button type="button" onClick={finishHighlightPolygon} disabled={polygonDraft.length < 3}
                      className="rounded-lg bg-blue-700 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50">Kết thúc đa giác ({polygonDraft.length} điểm)</button>
                    <button type="button" onClick={() => setPolygonDraft([])} className="rounded-lg bg-slate-200 px-3 py-2 text-[11px] font-bold">Hủy nét</button>
                  </div>}
                  <div className="flex justify-center">
                    <svg data-hnl-advanced-highlight-canvas="true" role="img"
                      aria-label="Vẽ highlight nâng cao trên vùng căn phòng"
                      viewBox="0 0 100 100" preserveAspectRatio="none"
                      style={{ touchAction: 'none', aspectRatio: `${Math.max(0.5, Math.min(3, width / Math.max(1, height)))}` }}
                      className="w-full max-w-[440px] h-auto min-h-[180px] max-h-[350px] select-none cursor-crosshair rounded-xl border-2 border-sky-300 bg-slate-50"
                      onPointerDown={event => {
                        event.preventDefault();
                        const p = getHighlightPointFromPointer(event);
                        if (highlightDrawTool === 'polygon') {
                          setPolygonDraft(prev => prev.length < 128 ? [...prev, p] : prev);
                          return;
                        }
                        highlightPointerStartRef.current = p;
                        if (highlightDrawTool === 'freehand') setFreehandDraft([p]);
                        else setHighlightDraft({ start: p, end: p });
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={event => {
                        if (!highlightPointerStartRef.current) return;
                        const p = getHighlightPointFromPointer(event);
                        if (highlightDrawTool === 'freehand') {
                          setFreehandDraft(prev => prev.length >= 120 ||
                            (prev.length && Math.hypot(prev[prev.length-1].x-p.x,prev[prev.length-1].y-p.y)<1.5)
                            ? prev : [...prev,p]);
                        } else setHighlightDraft({ start: highlightPointerStartRef.current, end: p });
                      }}
                      onPointerUp={handleHighlightPointerUp}
                      onPointerCancel={() => { highlightPointerStartRef.current = null; setHighlightDraft(null); setFreehandDraft([]); }}>
                      <defs>
                        <clipPath id={highlightSvgClipId}>
                          {advancedRoomShape?.length && advancedRoomShape.length >= 3 ?
                            <polygon points={advancedRoomShape.map(p => `${p.x},${p.y}`).join(' ')} /> :
                            <rect x="0" y="0" width="100" height="100" />}
                        </clipPath>
                      </defs>
                      <g clipPath={`url(#${highlightSvgClipId})`}>
                        <rect x="0" y="0" width="100" height="100" fill="#e2e8f0" />
                        {floorPlanImageUrl && width > 0 && height > 0 && (
                          <image href={floorPlanImageUrl}
                            x={-x / width * 100} y={-y / height * 100}
                            width={10000 / width} height={10000 / height}
                            preserveAspectRatio="none" opacity={0.72} />
                        )}
                        {getHighlightTotalShapes(highlightSelectedCategory).flatMap((shape,index) => {
                          const p = highlightShapeToPolygon(shape);
                          return p ? [<polygon key={`total-${index}`} points={p.map(q=>`${q.x},${q.y}`).join(' ')} fill="#64748b" fillOpacity={0.07} stroke="#64748b" strokeWidth={0.6} strokeDasharray="2 1" />] : [];
                        })}
                        {getHighlightMainShapes(highlightSelectedCategory).flatMap((shape,index) => {
                          const p = highlightShapeToPolygon(shape);
                          return p ? [<polygon key={`main-${index}`} points={p.map(q=>`${q.x},${q.y}`).join(' ')} fill="#0284c7" fillOpacity={0.14} stroke="#0284c7" strokeWidth={0.7} />] : [];
                        })}
                        {highlightedStages.flatMap((stage, index) => {
                          const color = stage.highlightColor || HIGHLIGHT_COLORS[index % HIGHLIGHT_COLORS.length];
                          const shapes: HighlightRegionShape[] = stage.highlightShapes?.length ? stage.highlightShapes : (stage.highlightRegions || []);
                          return shapes.flatMap((r,index2) => {
                            const p = highlightShapeToPolygon(r);
                            return p ? [<polygon key={`${stage.id}-${index2}`} points={p.map(q=>`${q.x},${q.y}`).join(' ')} fill={color}
                              fillOpacity={highlightTarget === stage.id ? 0.48 : 0.17}
                              stroke={color} strokeWidth={highlightTarget === stage.id ? 1.1 : 0.4} />] : [];
                          });
                        })}
                        {draftHighlightRect && highlightDrawTool === '2point' && <rect {...draftHighlightRect} fill="#0ea5e9" fillOpacity={0.26}
                          stroke="#0284c7" strokeWidth={0.8} strokeDasharray="2 1" />}
                        {polygonDraft.length > 0 && <polyline points={polygonDraft.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#0284c7" strokeWidth={1.4} strokeDasharray="2 1" />}
                        {freehandDraft.length > 0 && <polyline points={freehandDraft.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#0284c7" strokeWidth={1.3} />}
                      </g>
                      {advancedRoomShape?.length && advancedRoomShape.length >= 3 ?
                        <polygon points={advancedRoomShape.map(p => `${p.x},${p.y}`).join(' ')}
                          fill="none" stroke="#334155" strokeWidth={1} /> :
                        <rect x="0" y="0" width="100" height="100" fill="none" stroke="#334155" strokeWidth={1} />}
                    </svg>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={selectWholeHighlight}
                      className="rounded-lg bg-sky-100 px-3 py-2 font-bold text-[11px] text-sky-900 hover:bg-sky-200">
                      {highlightTarget === 'total' ? 'Vùng tổng = toàn phòng' : highlightTarget === 'main' ? 'Vùng chính = toàn vùng tổng' : 'Phủ toàn bộ vùng chính'}
                    </button>
                    <button type="button" data-hnl-ui-only="true" onClick={() => setAppendHighlightRegion(true)}
                      disabled={(highlightTarget === 'total' ? getHighlightTotalShapes(highlightSelectedCategory).length : highlightTarget === 'main' ? getHighlightMainShapes(highlightSelectedCategory).length : (selectedHighlightStage?.highlightShapes?.length || selectedHighlightStage?.highlightRegions?.length || 0)) >= 24}
                      className={`rounded-lg px-3 py-2 font-bold text-[11px] ${appendHighlightRegion ? 'bg-amber-200 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>
                      {appendHighlightRegion ? 'Kéo để thêm vùng rời…' : 'Thêm vùng rời'}
                    </button>
                    <button type="button" onClick={clearHighlightRegion}
                      className="rounded-lg bg-rose-50 px-3 py-2 font-bold text-[11px] text-rose-700 hover:bg-rose-100">
                      {highlightTarget === 'total' ? 'Xóa vùng tổng tùy chỉnh' : highlightTarget === 'main' ? 'Xóa vùng chính' : 'Xóa vùng con (dùng vùng chính)'}
                    </button>
                  </div>
                  {selectedHighlightStage && (
                    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-[11px] text-slate-800">Tính khối lượng: {selectedHighlightStage.name}</strong>
                        <select aria-label="Chế độ tính khối lượng hạng mục phụ" value={selectedHighlightStage.highlightVolumeMode === 'area' ? 'area' : 'manual'}
                          onChange={event => {
                            roomDraftDirtyRef.current = true;
                            setSubItems(prev => prev.map(stage => stage.id === selectedHighlightStage.id ? { ...stage, highlightVolumeMode: event.target.value as 'manual' | 'area' } : stage));
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-800">
                          <option value="manual">Thủ công (như cũ)</option>
                          <option value="area" disabled={!canDeriveStageHighlightQuantity(highlightSelectedCategory, selectedHighlightStage)}>Tự tính theo vùng (m²)</option>
                        </select>
                      </div>
                      <p className="text-[10.5px] text-slate-500">
                        {selectedHighlightStage.highlightVolumeMode === 'area'
                          ? 'KL tự tính theo tỷ lệ diện tích trên vùng tổng (nếu đã nhập KL tổng riêng). Không có vùng con thì phủ toàn vùng chính. Ghi dữ liệu khi Lưu.'
                          : 'KL nhập tay giữ nguyên. Có thể chọn tự tính theo vùng chính hoặc vùng phụ khi đơn vị là m².'}
                      </p>
                      {!isAreaHighlightUnit(getCategorySourceUnit(highlightSelectedCategory)) && (
                        <p className="text-[10.5px] font-bold text-amber-800">Đơn vị m/bộ/cái không được tự tính bằng tỷ lệ diện tích.</p>
                      )}
                      {(selectedHighlightStage.status === 'Đã hoàn thành' || selectedHighlightStage.inspectionStatus === 'Đạt nghiệm thu') && (
                        <p className="text-[10.5px] font-bold text-amber-800">Hạng mục đã hoàn thành/nghiệm thu: khóa tự tính lại, giữ khối lượng hiện có.</p>
                      )}
                    </div>
                  )}
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    Mỗi công đoạn có thể phủ trùng với công đoạn khác; không cộng công đoạn thành KL chính. KL con lấy tỷ lệ diện tích trên vùng tổng độc lập và bị giới hạn trong vùng chính/biên phòng. Bật lớp “Hạng mục con” trên mặt bằng để xem riêng. Hạng mục đã nghiệm thu giữ KL chốt.
                  </p>
                </div>
              )}
            </section>
          )}

          {/* MATERIAL ESTIMATES LINKED FROM WAREHOUSE (Collapsible) */}
          <div className="bg-emerald-50/90 rounded-2xl border border-emerald-200/90 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowMaterialEstimates(!showMaterialEstimates)}
              className="w-full p-3.5 flex items-center justify-between text-left hover:bg-emerald-100/60 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 bg-emerald-600 text-white rounded-lg shrink-0 shadow-2xs">
                  <PackageCheck className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-extrabold text-emerald-950 text-xs uppercase tracking-wide truncate">
                    Vật tư dự toán liên kết từ kho
                  </h4>
                  <p className="text-[10.5px] text-emerald-700 font-medium truncate">
                    Tự động tính từ khối lượng các hạng mục &amp; định mức hao phí tương ứng
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-900 text-xs font-bold shrink-0 ml-2">
                {roomMaterialEstimates.length > 0 && (
                  <span className="bg-emerald-200 text-emerald-900 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                    {roomMaterialEstimates.length} loại
                  </span>
                )}
                <span>{showMaterialEstimates ? 'Thu gọn' : 'Chi tiết'}</span>
                <ChevronDown data-open={showMaterialEstimates} className="hnl-disclosure-chevron w-4 h-4" aria-hidden="true" />
              </div>
            </button>

            {showMaterialEstimates && (
              <div className="p-3.5 pt-2 border-t border-emerald-200/80 space-y-3 bg-white/40">
                {onAddInventory && roomMaterialEstimates.length > 0 && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleAutoIssueForRoom}
                      disabled={!roomItem?.id || isAutoIssuing}
                      title={!roomItem?.id ? 'Lưu Căn / Phòng trước để theo dõi chống xuất trùng' : 'Chỉ xuất phần vật tư còn thiếu so với định mức'}
                      className="bg-emerald-600 disabled:bg-slate-300 disabled:cursor-not-allowed hover:bg-emerald-700 text-white font-extrabold text-[11px] px-3 py-1.5 rounded-xl shadow-xs active:scale-95 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      {isAutoIssuing ? 'Đang tạo phiếu...' : roomItem?.id ? 'Xuất phần còn thiếu' : 'Lưu trước khi xuất kho'}
                    </button>
                  </div>
                )}

                {roomMaterialEstimates.length === 0 ? (
                  <p className="text-[11px] text-slate-500 italic text-center py-2 bg-white/60 rounded-xl">
                    Chưa có định mức vật tư phù hợp với đơn vị khối lượng của hạng mục này hoặc khối lượng đang bằng 0. Vui lòng thiết lập ở mục "Kho vật tư &gt; Định mức".
                  </p>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {roomMaterialEstimates.map((item, idx) => (
                      <div key={`${item.id || idx}-${idx}`} className="bg-white p-2.5 rounded-xl border border-emerald-200/80 text-[11px] space-y-1 shadow-2xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap gap-1">
                              <span className="text-[8.5px] font-extrabold px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded uppercase">
                                {item.category}
                              </span>
                              {item.workCategory && (
                                <span className="text-[8.5px] font-bold px-1.5 py-0.2 bg-indigo-50 text-indigo-700 rounded">
                                  🏗️ {item.workCategory}
                                </span>
                              )}
                            </div>
                            <p className="font-bold text-slate-900 truncate mt-1">{item.materialName}</p>
                            <p className="text-[10px] text-slate-500">
                              {item.normDetails?.length === 1 && item.unitNormPerM2 !== undefined ? (
                                <>Định mức / đơn vị: <strong className="text-slate-700">{formatAdaptiveDecimal(item.unitNormPerM2)} {item.unit}/{item.normBasisUnit || getCategorySourceUnit(item.workCategory || workCategory)}</strong></>
                              ) : (
                                <>Tổng hợp từ <strong className="text-slate-700">{item.normDetails?.length || item.sourceNormIds.length}</strong> định mức liên kết.</>
                              )}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-black text-emerald-700">
                              Tổng cần: {formatDecimal(item.estQty)} {item.unit}
                            </p>
                            {roomItem?.id && (
                              <p className="text-[9.5px] text-slate-500 font-semibold">
                                Đã xuất tự động: {formatDecimal(item.alreadyIssued)} · Còn: <strong className="text-indigo-700">{formatDecimal(item.remainingQty)}</strong> {item.unit}
                              </p>
                            )}
                            {item.overIssuedQty > 0 && (
                              <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded inline-block">
                                Xuất vượt nhu cầu: {formatDecimal(item.overIssuedQty)} {item.unit}
                              </span>
                            )}
                            <span className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded inline-block mt-0.5 ${
                              item.sufficient ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {item.sufficient ? `Tồn kho: ${formatDecimal(item.stockQty)} (Đủ phần còn thiếu)` : `Tồn kho: ${formatDecimal(item.stockQty)} (Thiếu ${formatDecimal(Math.max(0, item.remainingQty - item.stockQty))})`}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Inspector & Notes */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            <div className="lg:col-span-1">
              <label className="block font-bold text-slate-700 mb-1">Kỹ sư phụ trách nghiệm thu</label>
              <input
                type="text"
                value={inspectorName}
                onChange={(e) => setInspectorName(e.target.value)}
                placeholder="VD: KS. Nguyễn Văn Bình"
                className="w-full border border-slate-200 rounded-xl p-2.5 font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">Ghi chú nghiệm thu Căn / Phòng</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ghi chú chi tiết về chất lượng trần/vách, mối nối, độ phẳng..."
                rows={2}
                className="w-full border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Zone Geometry Adjustments & 2-Point Redraw Option (Collapsible) */}
          {!structureReadOnly && <div className="bg-amber-50/80 rounded-2xl border border-amber-200/90 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowDimensionSettings(!showDimensionSettings)}
              className="w-full p-3.5 flex items-center justify-between text-left hover:bg-amber-100/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="font-extrabold text-amber-950 text-xs truncate">
                  Tùy chỉnh kích thước &amp; tọa độ
                </span>
              </div>
              <div className="flex items-center gap-1 text-amber-900 text-xs font-semibold shrink-0">
                <span>{showDimensionSettings ? 'Thu gọn' : 'Tùy chỉnh'}</span>
                <ChevronDown data-open={showDimensionSettings} className="hnl-disclosure-chevron w-4 h-4" aria-hidden="true" />
              </div>
            </button>

            {showDimensionSettings && (
              <div className="p-3.5 pt-0 border-t border-amber-200/70 space-y-3">
                {!structureReadOnly && roomItem && onStartRedraw2Point && (
                  <div className="mt-2.5 space-y-2">
                    <p className="text-[11px] font-extrabold text-amber-900 flex items-center gap-1.5">
                      🎨 Chọn chế độ để vẽ lại vùng cho căn này:
                    </p>
                    <div data-hnl-pc-v39-room-redraw-tools="true" className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          onStartRedraw2Point(roomItem, 'freehand');
                          onClose();
                        }}
                        className="py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl shadow-2xs flex flex-col items-center justify-center gap-1 transition-all active:scale-95 text-[10.5px] border border-amber-400 cursor-pointer"
                        title="Vẽ tự do bằng cách nhấn giữ và kéo chuột/tay trên mặt bằng"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Vẽ Tự Do</span>
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          onStartRedraw2Point(roomItem, 'polygon');
                          onClose();
                        }}
                        className="py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl shadow-2xs flex flex-col items-center justify-center gap-1 transition-all active:scale-95 text-[10.5px] border border-indigo-500 cursor-pointer"
                        title="Chấm từng điểm góc trên mặt bằng để vẽ đa giác"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Vẽ Đa Giác</span>
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          onStartRedraw2Point(roomItem, '2point');
                          onClose();
                        }}
                        className="py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-black rounded-xl shadow-2xs flex flex-col items-center justify-center gap-1 transition-all active:scale-95 text-[10.5px] border border-slate-950 cursor-pointer"
                        title="Chấm 2 điểm đối góc để vẽ khung hình chữ nhật"
                      >
                        <span className="text-xs leading-none">📦</span>
                        <span>Vẽ Chữ Nhật</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 2 Free Points Coordinate Inputs */}
                <div className="bg-white p-3 rounded-xl border border-amber-200/80 space-y-2 text-[11px] min-w-0 overflow-hidden">
                  <p className="font-extrabold text-slate-800 text-[11px] leading-snug break-words">📍 Tọa độ 2 điểm khung (% trên mặt bằng, hỗ trợ số thập phân):</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1.5 min-w-0">
                      <span className="font-extrabold text-indigo-700 block text-[10.5px] leading-tight truncate">• Điểm góc 1 (trái - trên):</span>
                      <div className="grid grid-cols-2 gap-1.5 items-center">
                        <div className="flex items-center gap-1 min-w-0">
                          <label className="font-bold text-slate-500 shrink-0 text-[10px]">X1:</label>
                          <MathNumberInput
                            minValue={0}
                            maxValue={100}
                            value={x}
                            onValueChange={(raw) => {
                              const val = Math.min(100, Math.max(0, Number(raw || 0)));
                              const oldX2 = x + width;
                              setX(val);
                              if (oldX2 > val) setWidth(oldX2 - val);
                            }}
                            className="w-full min-w-0 border border-slate-300 rounded px-1.5 py-1 font-bold text-slate-900 text-xs focus:ring-1 focus:ring-indigo-500 bg-white"
                          />
                        </div>
                        <div className="flex items-center gap-1 min-w-0">
                          <label className="font-bold text-slate-500 shrink-0 text-[10px]">Y1:</label>
                          <MathNumberInput
                            minValue={0}
                            maxValue={100}
                            value={y}
                            onValueChange={(raw) => {
                              const val = Math.min(100, Math.max(0, Number(raw || 0)));
                              const oldY2 = y + height;
                              setY(val);
                              if (oldY2 > val) setHeight(oldY2 - val);
                            }}
                            className="w-full min-w-0 border border-slate-300 rounded px-1.5 py-1 font-bold text-slate-900 text-xs focus:ring-1 focus:ring-indigo-500 bg-white"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1.5 min-w-0">
                      <span className="font-extrabold text-indigo-700 block text-[10.5px] leading-tight truncate">• Điểm góc 2 (phải - dưới):</span>
                      <div className="grid grid-cols-2 gap-1.5 items-center">
                        <div className="flex items-center gap-1 min-w-0">
                          <label className="font-bold text-slate-500 shrink-0 text-[10px]">X2:</label>
                          <MathNumberInput
                            minValue={0}
                            maxValue={100}
                            value={Number((x + width).toFixed(2))}
                            onValueChange={(raw) => {
                              const val = Math.min(100, Math.max(0, Number(raw || 0)));
                              if (val > x) setWidth(val - x);
                            }}
                            className="w-full min-w-0 border border-slate-300 rounded px-1.5 py-1 font-bold text-slate-900 text-xs focus:ring-1 focus:ring-indigo-500 bg-white"
                          />
                        </div>
                        <div className="flex items-center gap-1 min-w-0">
                          <label className="font-bold text-slate-500 shrink-0 text-[10px]">Y2:</label>
                          <MathNumberInput
                            minValue={0}
                            maxValue={100}
                            value={Number((y + height).toFixed(2))}
                            onValueChange={(raw) => {
                              const val = Math.min(100, Math.max(0, Number(raw || 0)));
                              if (val > y) setHeight(val - y);
                            }}
                            className="w-full min-w-0 border border-slate-300 rounded px-1.5 py-1 font-bold text-slate-900 text-xs focus:ring-1 focus:ring-indigo-500 bg-white"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Geometry Sliders */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
                  <div>
                    <label className="text-slate-600 font-semibold block mb-0.5">Vị trí X: {Number(x.toFixed(1))}%</label>
                    <input
                      type="range"
                      step="0.1"
                      min="0"
                      max="90"
                      value={x}
                      onChange={(e) => setX(Number(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="text-slate-600 font-semibold block mb-0.5">Vị trí Y: {Number(y.toFixed(1))}%</label>
                    <input
                      type="range"
                      step="0.1"
                      min="0"
                      max="90"
                      value={y}
                      onChange={(e) => setY(Number(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="text-slate-600 font-semibold block mb-0.5">Chiều rộng (W): {Number(width.toFixed(1))}%</label>
                    <input
                      type="range"
                      step="0.1"
                      min="5"
                      max="80"
                      value={width}
                      onChange={(e) => setWidth(Number(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="text-slate-600 font-semibold block mb-0.5">Chiều cao (H): {Number(height.toFixed(1))}%</label>
                    <input
                      type="range"
                      step="0.1"
                      min="5"
                      max="80"
                      value={height}
                      onChange={(e) => setHeight(Number(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>}

          {/* Submit Actions */}
          <div data-hnl-pc-v35-actions="room-save" className="pt-2 flex flex-wrap gap-2">
            {!structureReadOnly && roomItem && onDeleteRoom && (
              isConfirmingDelete ? (
                <div className="flex items-center gap-1.5 w-full bg-rose-50 p-2 rounded-xl border border-rose-200">
                  <span className="text-[11px] font-bold text-rose-800 flex-1">Xác nhận xóa highlight?</span>
                  <button
                    type="button"
                    onClick={async () => {
                      onDeleteRoom(roomItem.id);
                      onClose();
                    }}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-lg text-xs shadow-xs active:scale-95 transition-all cursor-pointer"
                  >
                    Đồng ý xóa
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsConfirmingDelete(false)}
                    className="px-3 py-1.5 bg-slate-200 text-slate-700 font-bold rounded-lg text-xs hover:bg-slate-300 transition-all cursor-pointer"
                  >
                    Hủy
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(true)}
                  className="px-3 py-2.5 bg-rose-50 text-rose-600 hover:bg-rose-100 font-bold rounded-xl text-xs flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  Xóa
                </button>
              )
            )}

            <button
              type="submit"
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl shadow-md text-xs flex items-center justify-center gap-1.5 active:scale-98 transition-all cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {roomItem ? 'Lưu thay đổi nghiệm thu' : 'Tạo vùng Căn / Phòng'}
            </button>
          </div>
        </form>
      </div>


    </div>
  );
};
