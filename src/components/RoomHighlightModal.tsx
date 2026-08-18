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
  Calculator,
  Sliders,
  ChevronUp,
  ChevronDown,
  Edit2,
  Check,
  Phone,
  Pencil
} from 'lucide-react';
import { RoomProgressItem, RoomSubItem, AcceptanceStatus, RoomInspectionResult, Point2D, TeamInfo, ChecklistItem, MaterialNorm, InventoryItem, WorkVolume } from '../types';
import { ROOM_COLOR_PALETTE } from '../utils/colorPalette';
import { confirmAsync } from '../utils/confirmAsync';
import { formatDecimal, evaluateMathExpression, useFormatSettings } from '../utils/numberUtils';
import { MathNumberInput } from './MathNumberInput';

interface RoomHighlightModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomItem: RoomProgressItem | null; // Null means creating a new room highlight
  initialPos?: { x: number; y: number };
  initialRect?: { x: number; y: number; width: number; height: number };
  initialPoints?: Point2D[];
  floorId: string;
  floorName: string;
  checklistItems?: ChecklistItem[];
  teams?: TeamInfo[];
  materialNorms?: MaterialNorm[];
  inventory?: InventoryItem[];
  workVolumes?: WorkVolume[];
  defaultInspectorName?: string;
  onAddInventory?: (item: Omit<InventoryItem, 'id'>) => void;
  onSaveRoom: (room: Omit<RoomProgressItem, 'id' | 'updatedAt'> & { id?: string }) => void;
  onDeleteRoom?: (id: string) => void;
  onStartRedraw2Point?: (room: RoomProgressItem, tool: 'freehand' | 'polygon' | '2point') => void;
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
  checklistItems = [],
  teams = [],
  materialNorms = [],
  inventory = [],
  workVolumes = [],
  defaultInspectorName,
  onAddInventory,
  onSaveRoom,
  onDeleteRoom,
  onStartRedraw2Point,
}) => {
  const activeDefaultInspector = defaultInspectorName || 'KS. Nguyễn Văn Bình';

  const [roomName, setRoomName] = useState('');
  const [workCategory, setWorkCategory] = useState('Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn');
  const [presetSelection, setPresetSelection] = useState('Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn');
  const [subItems, setSubItems] = useState<RoomSubItem[]>([]);
  const [categoryVolumes, setCategoryVolumes] = useState<Record<string, number>>({});
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
  const [showConfirmReplaceModal, setShowConfirmReplaceModal] = useState(false);
  const [availableTeams, setAvailableTeams] = useState<TeamInfo[]>([]);
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);
  const [showDimensionSettings, setShowDimensionSettings] = useState<boolean>(false);
  const [showMaterialEstimates, setShowMaterialEstimates] = useState<boolean>(false);
  const [selectedSubItemIds, setSelectedSubItemIds] = useState<string[]>([]);

  // Combined teams list from props or local storage
  const displayTeams = (teams && teams.length > 0) 
    ? teams 
    : (availableTeams && availableTeams.length > 0)
    ? availableTeams
    : [];

  useEffect(() => {
    setIsConfirmingDelete(false);
    setSelectedSubItemIds([]);
    if (roomItem) {
      setRoomName(roomItem.roomName);
      const cat = roomItem.workCategory || 'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn';
      setWorkCategory(cat);
      setPresetSelection(cat);
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
      setVolumeUnit(roomItem.volumeUnit || 'm²');

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
        const cat = roomItem.workCategory || 'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn';
        if (roomItem.workVolume !== undefined && roomItem.workVolume !== null) {
          initialMap[cat] = Number(roomItem.workVolume);
        }
        setCategoryVolumes(initialMap);
        const initialStrings: Record<string, string> = {};
        if (roomItem.workVolume !== undefined && roomItem.workVolume !== null) {
          initialStrings[cat] = formatDecimal(roomItem.workVolume);
        }
        setVolumeStrings(initialStrings);
      }
    } else {
      setVolumeStrings({});
      setCategoryVolumes({});
      setRoomName('Căn ' + Math.floor(100 + Math.random() * 800));
      const defaultCat = (workVolumes && workVolumes.length > 0 && workVolumes[0].title) 
        ? workVolumes[0].title 
        : 'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn';
      setWorkCategory(defaultCat);
      
      const names = getSubItemsForCategory(defaultCat);

      setSubItems(
        names.map((name, idx) => {
          const displaySubName = name.toLowerCase().startsWith('thi công') || name.toLowerCase().startsWith('sơn') || name.toLowerCase().startsWith('bả') ? name : `Thi công ${name}`;
          return {
            id: `sub-init-${Date.now()}-${idx}`,
            name: displaySubName,
            category: defaultCat,
            status: 'Chưa làm',
            inspectionStatus: 'Chưa nghiệm thu',
            targetDate: '',
          };
        })
      );
      setCategoryVolumes({ [defaultCat]: 0 });

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
      setVolumeUnit('m²');
    }
  }, [roomItem, initialPos, initialRect, initialPoints, isOpen]);

  // Handler to change work category preset (mode: 'append' to add more categories to the room, 'replace' to reset)
  const handleApplyPreset = (catName: string, mode: 'replace' | 'append' = 'append') => {
    setWorkCategory(catName);
    
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
        id: `sub-preset-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 5)}`,
        name: displaySubName,
        category: catName,
        status: 'Chưa làm',
        inspectionStatus: 'Chưa nghiệm thu',
        targetDate: '',
        workVolume: undefined,
        volumeUnit: 'm²',
        assignedTeam: assignedTeam || '',
      };
    });

    if (mode === 'replace') {
      setSubItems(newItems);
      const vol = Number(workVolume) || 0;
      setCategoryVolumes({ [catName]: vol });
      setVolumeStrings({ [catName]: formatDecimal(vol) });
    } else {
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
    }
  };

  // Get unique work categories from work volumes, fallback to material norms & presets
  const availableWorkCategories = React.useMemo(() => {
    const list = new Set<string>();

    // 1. Add current room's workCategory (state)
    if (workCategory && workCategory.trim()) {
      list.add(workCategory.trim());
    }

    // 2. Add any active categories from subItems state
    if (subItems && subItems.length > 0) {
      subItems.forEach((item) => {
        if (item.category && item.category.trim()) {
          list.add(item.category.trim());
        }
      });
    }

    // 3. Add any categories from categoryVolumes state
    if (categoryVolumes) {
      Object.keys(categoryVolumes).forEach((cat) => {
        if (cat && cat.trim()) {
          list.add(cat.trim());
        }
      });
    }

    // 4. Add original roomItem's values just in case
    if (roomItem) {
      if (roomItem.workCategory && roomItem.workCategory.trim()) {
        list.add(roomItem.workCategory.trim());
      }
      if (roomItem.subItems) {
        roomItem.subItems.forEach((item) => {
          if (item.category && item.category.trim()) {
            list.add(item.category.trim());
          }
        });
      }
      if (roomItem.categoryVolumes) {
        Object.keys(roomItem.categoryVolumes).forEach((cat) => {
          if (cat && cat.trim()) {
            list.add(cat.trim());
          }
        });
      }
    }

    // 5. Add categories from project work volumes
    if (workVolumes && workVolumes.length > 0) {
      workVolumes.forEach((v) => {
        if (v.title && v.title.trim()) {
          list.add(v.title.trim());
        }
      });
    }

    // If we have items from our explicit sources, return them
    if (list.size > 0) {
      return Array.from(list);
    }

    if (materialNorms && materialNorms.length > 0) {
      materialNorms.forEach((norm) => {
        if (norm.workCategories && norm.workCategories.length > 0) {
          norm.workCategories.forEach(c => list.add(c));
        } else if (norm.workCategory) {
          list.add(norm.workCategory);
        }
      });
    }

    // If we have items in our set, return them
    if (list.size > 0) {
      return Array.from(list);
    }

    // Fallback to keys of WORK_CATEGORY_PRESETS
    return Object.keys(WORK_CATEGORY_PRESETS);
  }, [workVolumes, materialNorms, workCategory, subItems, categoryVolumes, roomItem]);

  // Calculate stock balance map from inventory
  const stockMap = React.useMemo(() => {
    const map: Record<string, number> = {};
    if (inventory) {
      inventory.forEach((item) => {
        const key = item.materialName.trim().toLowerCase();
        if (!map[key]) map[key] = 0;
        if (item.type === 'in') map[key] += item.quantity;
        else map[key] -= item.quantity;
      });
    }
    return map;
  }, [inventory]);

  // Calculate active work categories present in this room
  const activeCategories = React.useMemo(() => {
    const list = new Set<string>();
    subItems.forEach((item) => {
      const cat = item.category || workCategory || 'Chưa phân nhóm';
      list.add(cat);
    });
    return Array.from(list);
  }, [workCategory, subItems]);

  // Sum up material estimates from all active categories based on their volumes
  const roomMaterialEstimates = React.useMemo(() => {
    if (!materialNorms || materialNorms.length === 0) return [];

    const accumulated: Record<string, { norm: MaterialNorm; estQty: number }> = {};

    activeCategories.forEach((cat) => {
      const catVolume = categoryVolumes[cat] !== undefined ? categoryVolumes[cat] : 0;
      if (catVolume <= 0) return;

      const matchingNorms = materialNorms.filter((norm) => {
        const hasWorkCategories = (norm.workCategories && norm.workCategories.length > 0) || norm.workCategory;
        if (!hasWorkCategories) return true; // general norms applied to all
        if (norm.workCategories && norm.workCategories.length > 0) {
          return norm.workCategories.includes(cat);
        }
        return norm.workCategory === cat;
      });

      matchingNorms.forEach((norm) => {
        let factor = 0;
        if (norm.workCategoryNorms && norm.workCategoryNorms[cat] !== undefined) {
          factor = norm.workCategoryNorms[cat];
        } else {
          factor = norm.unitNormPerM2 || 0;
        }
        if (factor <= 0) return;

        const portionQty = catVolume * factor;
        const key = norm.materialName.trim().toLowerCase();

        if (accumulated[key]) {
          accumulated[key].estQty += portionQty;
        } else {
          accumulated[key] = {
            norm,
            estQty: portionQty,
          };
        }
      });
    });

    return Object.values(accumulated).map(({ norm, estQty }) => {
      const roundedEstQty = Math.ceil(estQty * 100) / 100;
      const stockQty = stockMap[norm.materialName.trim().toLowerCase()] || 0;
      return {
        ...norm,
        estQty: roundedEstQty,
        stockQty,
        sufficient: stockQty >= roundedEstQty,
      };
    });
  }, [materialNorms, activeCategories, categoryVolumes, stockMap]);

  const handleAutoIssueForRoom = async () => {
    if (!onAddInventory) {
      alert('Không có hàm nạp phiếu kho!');
      return;
    }
    
    const validCategories = activeCategories.filter(cat => (categoryVolumes[cat] || 0) > 0);
    if (validCategories.length === 0) {
      alert('Vui lòng nhập khối lượng thi công (> 0 m²) cho ít nhất một hạng mục trước khi xuất kho!');
      return;
    }
    
    if (roomMaterialEstimates.length === 0) {
      alert('Chưa tìm thấy định mức vật tư nào phù hợp với các hạng mục thi công này trong Kho Vật Tư!');
      return;
    }

    let issuedCount = 0;
    const catDetailsStr = validCategories.map(cat => `${cat} (${categoryVolumes[cat]} m²)`).join(', ');

    roomMaterialEstimates.forEach((item) => {
      if (item.estQty > 0) {
        onAddInventory({
          type: 'out',
          materialName: item.materialName,
          unit: item.unit,
          quantity: item.estQty,
          location: `${floorName} - ${roomName || 'Căn hộ'}`,
          handler: assignedTeam || 'Đội thi công căn hộ',
          date: new Date().toISOString().split('T')[0],
          notes: `Tự động xuất kho dự toán tổng hợp cho [${roomName || 'Căn Hộ'}] gồm các hạng mục: ${catDetailsStr}`,
        });
        issuedCount++;
      }
    });

    alert(`🚚 Đã tự động tạo ${issuedCount} phiếu XUẤT KHO cho căn hộ [${roomName || 'Căn Hộ'}] dựa trên định mức chi tiết từng hạng mục!`);
  };

  // Handler to add custom sub item
  const handleAddSubItem = (catName?: string) => {
    setSubItems(prev => [
      ...prev,
      {
        id: `sub-custom-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        name: `Hạng mục ${prev.length + 1}`,
        status: 'Chưa làm',
        inspectionStatus: 'Chưa nghiệm thu',
        targetDate: '',
        category: catName,
      }
    ]);
  };

  // Update sub item field
  const handleUpdateSubItem = (id: string, patch: Partial<RoomSubItem>) => {
    setSubItems(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  // Delete sub item
  const handleDeleteSubItem = async (id: string) => {
    if (subItems.length <= 1) {
      // Avoid using window.alert due to iframe restrictions
      return;
    }
    setSubItems(prev => prev.filter(item => item.id !== id));
  };

  // Move category up or down
  const handleMoveCategory = (catName: string, direction: 'up' | 'down') => {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) {
      alert('Vui lòng nhập tên phòng hoặc mã căn hộ!');
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

    const matchingVolume = workVolumes.find(v => v.title.trim().toLowerCase() === workCategory.trim().toLowerCase());
    const finalWorkCategoryId = matchingVolume?.workCategoryId || matchingVolume?.id || undefined;

    const finalSubItems = subItems.map(s => {
      const sCat = s.category || workCategory || '';
      const matchingSubVol = workVolumes.find(v => v.title.trim().toLowerCase() === sCat.trim().toLowerCase());
      const subWorkCategoryId = matchingSubVol?.workCategoryId || matchingSubVol?.id || undefined;

      const sTeam = s.assignedTeam || '';
      const matchingSubTeam = displayTeams.find(t => t.name.trim().toLowerCase() === sTeam.trim().toLowerCase());
      const subTeamId = matchingSubTeam?.id || undefined;

      return {
        ...s,
        workCategoryId: subWorkCategoryId,
        teamId: subTeamId
      };
    });

    onSaveRoom({
      id: roomItem?.id,
      floorId,
      roomName: roomName.trim(),
      workCategory,
      workCategoryId: finalWorkCategoryId,
      categoryVolumes,
      subItems: finalSubItems,
      workVolume: parsedVol !== undefined && !isNaN(parsedVol) ? parsedVol : undefined,
      volumeUnit: volumeUnit.trim() || 'm²',
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
    });

    onClose();
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
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-2xl p-4 sm:p-5 space-y-4 max-h-[92vh] flex flex-col border border-slate-100 shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {roomItem ? `Sửa Nghiệm Thu - ${roomItem.roomName}` : `Tạo Vùng Highlight Căn / Phòng`}
              </h3>
              <p className="text-xs text-slate-500">Mặt bằng: {floorName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto overflow-x-hidden space-y-3.5 pr-1 text-xs">
          
          {/* Room / Apartment Name */}
          <div>
            <label className="block font-bold text-slate-800 mb-1">Tên Căn Hộ / Tên Phòng *</label>
            <input
              type="text"
              placeholder="VD: Căn A101 (Phòng Khách), Phòng WC 2..."
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>

          {/* Custom Highlight Color Option (Collapsible) */}
          <div className="bg-slate-50/90 rounded-2xl border border-slate-200 overflow-hidden">
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
                {showColorPicker ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
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
                    : '🎨 Bạn đã chọn màu tùy chỉnh riêng cho căn hộ này.'}
                </p>
              </div>
            )}
          </div>





          {/* CATEGORY PRESETS SECTION */}
          <div className="bg-indigo-50/80 p-3.5 rounded-2xl border border-indigo-200/90 space-y-3">
            <div className="flex items-start gap-2 border-b border-indigo-100/80 pb-2">
              <div className="p-1.5 bg-indigo-600 text-white rounded-lg shrink-0 mt-0.5 shadow-2xs">
                <ListChecks className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="font-black text-indigo-950 text-xs uppercase tracking-wide leading-snug break-words">
                  Nạp Mẫu Hạng Mục Thi Công (Presets)
                </h4>
                <p className="text-[11px] text-indigo-700/90 font-medium">
                  Nạp tự động các bộ công đoạn. Bạn có thể nạp thêm nhiều bộ khác nhau vào cùng 1 căn (VD: Trần Tiêu Chuẩn + Trần Chống Ẩm...).
                </p>
              </div>
            </div>

            {/* Select Preset Category */}
            <div className="space-y-2">
              <label className="text-[11px] font-extrabold text-indigo-900 block leading-tight">
                Chọn bộ mẫu hạng mục thi công áp dụng:
              </label>
              <select
                value={presetSelection}
                onChange={(e) => setPresetSelection(e.target.value)}
                className="w-full min-w-0 border border-indigo-200 rounded-xl p-2.5 text-xs font-bold text-slate-800 bg-white focus:ring-2 focus:ring-indigo-500 shadow-2xs truncate"
              >
                {availableWorkCategories.map((catName) => (
                  <option key={catName} value={catName}>
                    {catName}
                  </option>
                ))}
              </select>

              <div className="flex flex-col sm:flex-row gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => handleApplyPreset(presetSelection, 'append')}
                  className="flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs shadow-2xs active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Nạp Thêm Vào Căn Này</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (subItems.length > 0) {
                      setShowConfirmReplaceModal(true);
                    } else {
                      handleApplyPreset(presetSelection, 'replace');
                    }
                  }}
                  className="px-3 py-2 bg-white hover:bg-indigo-100 text-indigo-900 border border-indigo-300 font-extrabold rounded-xl text-xs active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1 shrink-0"
                  title="Thay thế toàn bộ danh sách hạng mục hiện tại bằng mẫu này"
                >
                  <span>⚡ Nạp Thay Thế (Xóa Cũ)</span>
                </button>
              </div>
            </div>
          </div>

          {/* DYNAMIC SUB-ITEMS LIST SECTION */}
          <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/90 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <h4 className="font-extrabold text-slate-900 text-xs flex items-center gap-1.5 uppercase tracking-wider">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  Danh Sách Hạng Mục Thi Công Trong Căn Hộ ({subItems.length} hạng mục)
                </h4>
                <p className="text-[10.5px] text-slate-500 font-medium mt-0.5 leading-tight">
                  💡 Mỗi hạng mục có thể phân công cho các đội thi công khác nhau từ danh sách Quân số.
                </p>
              </div>
            </div>

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
                    <span>Chọn Tất Cả Hạng Mục ({subItems.length})</span>
                  </label>

                  {selectedSubItemIds.length > 0 && (
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
                      <span>Cập Nhật Nhanh {selectedSubItemIds.length} Hạng Mục Đã Chọn:</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {/* Progress Status */}
                      <div>
                        <span className="font-bold text-slate-600 block mb-1">▶ Tiến độ thi công:</span>
                        <div className="grid grid-cols-3 gap-1">
                          {(['Chưa làm', 'Đang làm', 'Đã hoàn thành'] as AcceptanceStatus[]).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={async () => {
                                setSubItems(prev => prev.map(s => selectedSubItemIds.includes(s.id) ? { ...s, status: st } : s));
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
                        <span className="font-bold text-slate-600 block mb-1">▶ Nghiệm thu:</span>
                        <div className="grid grid-cols-3 gap-1">
                          {(['Chưa nghiệm thu', 'Đạt nghiệm thu', 'Chưa đạt (Cần sửa)'] as RoomInspectionResult[]).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={async () => {
                                setSubItems(prev => prev.map(s => selectedSubItemIds.includes(s.id) ? { ...s, inspectionStatus: st } : s));
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
                ) : (
                  <p className="text-[10px] text-slate-400 italic">
                    💡 Hãy tick chọn các hạng mục bên dưới để cập nhật nhanh/hàng loạt (tiến độ, nghiệm thu, phân công đội, hạn xong...).
                  </p>
                )}
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
                    <div className="flex flex-col gap-2 w-full min-w-0">
                      {/* Select to swap category */}
                      <select
                        value={catName}
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
                            // Update workCategory if matches
                            if (workCategory === catName) {
                              setWorkCategory(newCat);
                            }
                          }
                        }}
                        className="w-full font-black text-[13px] text-indigo-950 bg-indigo-50/80 hover:bg-indigo-100 border border-indigo-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-3xs"
                      >
                        {availableWorkCategories.map(c => (
                          <option key={c} value={c}>🏗️ {c}</option>
                        ))}
                      </select>

                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {/* Interactive Input Volume directly in the list */}
                        <div className="flex items-center gap-1.5 shrink-0 bg-emerald-50/70 border border-emerald-100 rounded-xl px-2.5 py-1">
                          <span className="text-[10px] font-extrabold text-emerald-800">Khối lượng:</span>
                          <input
                            type="text"
                            placeholder="0"
                            value={volumeStrings[catName] !== undefined ? volumeStrings[catName] : (categoryVolumes[catName] !== undefined ? formatDecimal(categoryVolumes[catName]) : '')}
                            onChange={(e) => {
                              const typedVal = e.target.value;
                              setVolumeStrings(prev => ({
                                ...prev,
                                [catName]: typedVal
                              }));
                              const parsed = evaluateMathExpression(typedVal);
                              const numericVal = parsed !== null ? parsed : (typedVal === '' ? 0 : Number(typedVal.replace(/,/g, '.')));
                              if (!isNaN(numericVal)) {
                                setCategoryVolumes(prev => ({
                                  ...prev,
                                  [catName]: numericVal
                                }));
                              }
                            }}
                            onBlur={() => {
                              const typedVal = volumeStrings[catName] || '';
                              const parsed = evaluateMathExpression(typedVal);
                              if (parsed !== null) {
                                setCategoryVolumes(prev => ({
                                  ...prev,
                                  [catName]: parsed
                                }));
                                setVolumeStrings(prev => ({
                                  ...prev,
                                  [catName]: formatDecimal(parsed)
                                }));
                              } else {
                                const numericVal = typedVal === '' ? 0 : Number(typedVal.replace(/,/g, '.'));
                                if (!isNaN(numericVal)) {
                                  setCategoryVolumes(prev => ({
                                    ...prev,
                                    [catName]: numericVal
                                  }));
                                  setVolumeStrings(prev => ({
                                    ...prev,
                                    [catName]: formatDecimal(numericVal)
                                  }));
                                }
                              }
                            }}
                            className="w-20 text-center font-black text-xs text-emerald-950 bg-white border border-emerald-300 rounded focus:ring-1 focus:ring-emerald-500 outline-none px-1.5 py-0.5"
                          />
                          <span className="text-[10px] font-black text-emerald-800">{volumeUnit || 'm²'}</span>

                          {activeCategories.length > 1 && (
                            <div className="flex items-center bg-white rounded-lg p-0.5 border border-slate-200 shrink-0 ml-1">
                              <button
                                type="button"
                                onClick={() => handleMoveCategory(catName, 'up')}
                                className="p-0.5 hover:bg-slate-100 rounded text-slate-700 hover:text-indigo-600 transition-all cursor-pointer"
                                title="Di chuyển nhóm này lên"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <div className="w-[1px] h-3 bg-slate-200 mx-0.5" />
                              <button
                                type="button"
                                onClick={() => handleMoveCategory(catName, 'down')}
                                className="p-0.5 hover:bg-slate-100 rounded text-slate-700 hover:text-indigo-600 transition-all cursor-pointer"
                                title="Di chuyển nhóm này xuống"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* "Thêm Hạng Mục Lẻ" button for this category */}
                  <button
                    type="button"
                    onClick={() => handleAddSubItem(catName)}
                    className="w-full py-2 bg-white hover:bg-indigo-50 text-indigo-600 border border-indigo-200 border-dashed hover:border-indigo-300 font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-3xs active:scale-98 mb-2"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm Hạng Mục Lẻ</span>
                  </button>

                  <div className="space-y-3">
                    {itemsInCat.map((item) => {
                      const originalIndex = subItems.findIndex(s => s.id === item.id);
                      return (
                        <div key={`${item.id}-${originalIndex}`} className="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-2xs space-y-2.5 overflow-x-hidden">
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
                              {itemsInCat.length > 1 && (
                                <div className="flex flex-col gap-0 border border-slate-200 rounded bg-slate-50 px-0.5">
                                  <button
                                    type="button"
                                    onClick={() => handleMoveSubItem(item.id, 'up')}
                                    className="hover:bg-slate-200 rounded-sm text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer"
                                    style={{ padding: '1px' }}
                                    title="Di chuyển lên"
                                  >
                                    <ChevronUp className="w-2.5 h-2.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMoveSubItem(item.id, 'down')}
                                    className="hover:bg-slate-200 rounded-sm text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer"
                                    style={{ padding: '1px' }}
                                    title="Di chuyển xuống"
                                  >
                                    <ChevronDown className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => handleUpdateSubItem(item.id, { name: e.target.value })}
                              placeholder="Tên hạng mục thi công..."
                              className="flex-1 font-extrabold text-slate-900 text-xs border border-slate-200 rounded-lg px-2 py-1 focus:ring-1 focus:ring-indigo-500 outline-none min-w-0"
                            />
                            {deletingSubItemId === item.id ? (
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
                                  Đồng Ý
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
                            )}
                          </div>

                          {/* Team & Volume per Sub-Item */}
                          <div className="bg-slate-50 p-2 rounded-xl border border-slate-100 text-[10.5px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <User className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                              <span className="font-bold text-slate-600 shrink-0">Đội thi công:</span>
                              <select
                                value={item.assignedTeam || ''}
                                onChange={(e) => handleUpdateSubItem(item.id, { assignedTeam: e.target.value })}
                                className="flex-1 font-bold border border-slate-200 rounded-lg px-2 py-1 text-xs focus:ring-1 focus:ring-indigo-500 outline-none bg-white min-w-0 truncate"
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
                                  const phoneClean = String(matchingTeam.phone || '').replace(/\s+/g, '');
                                  return (
                                    <a
                                      href={`tel:${phoneClean}`}
                                      className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg font-bold text-[10px] flex items-center gap-1 shrink-0 active:scale-95 transition-all shadow-2xs"
                                      title={`Gọi điện thoại cho ${matchingTeam.name} (${matchingTeam.phone})`}
                                    >
                                      <Phone className="w-3 h-3 text-emerald-600" />
                                      <span>Gọi</span>
                                    </a>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          </div>

                          {/* Status buttons: Thi công */}
                          <div>
                            <span className="text-[10.5px] font-bold text-slate-500 block mb-1">▶ Tiến độ thi công:</span>
                            <div className="grid grid-cols-3 gap-1.5 mb-1.5">
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
                                  {st === 'Đã hoàn thành' ? '✅ Xong' : st === 'Đang làm' ? '🚧 Đang Làm' : '⏳ Chưa Làm'}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Status buttons: Nghiệm thu */}
                          <div className="pt-1.5 border-t border-slate-100">
                            <span className="text-[10.5px] font-bold text-indigo-700 block mb-1">▶ Nghiệm thu hạng mục này:</span>
                            <div className="grid grid-cols-3 gap-1.5 mb-1.5">
                              {(['Chưa nghiệm thu', 'Đạt nghiệm thu', 'Chưa đạt (Cần sửa)'] as RoomInspectionResult[]).map((st) => (
                                <button
                                  key={st}
                                  type="button"
                                  onClick={() => handleUpdateSubItem(item.id, { inspectionStatus: st })}
                                  className={`py-1.5 px-1 rounded-xl font-bold text-[10px] transition-all border cursor-pointer ${
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
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>


          </div>

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
                    Vật Tư Dự Toán Tổng Hợp Liên Kết Từ Kho
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
                {showMaterialEstimates ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </button>

            {showMaterialEstimates && (
              <div className="p-3.5 pt-2 border-t border-emerald-200/80 space-y-3 bg-white/40">
                {onAddInventory && roomMaterialEstimates.length > 0 && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleAutoIssueForRoom}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] px-3 py-1.5 rounded-xl shadow-xs active:scale-95 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      Xuất Kho Căn Hộ
                    </button>
                  </div>
                )}

                {roomMaterialEstimates.length === 0 ? (
                  <p className="text-[11px] text-slate-500 italic text-center py-2 bg-white/60 rounded-xl">
                    Chưa có định mức vật tư tiêu hao (ĐVT/m²) cài đặt cho hạng mục này hoặc khối lượng đang bằng 0 m². Vui lòng thiết lập ở mục "Kho Vật Tư &gt; Định Mức".
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
                              Định mức hao phí: <strong className="text-slate-700">{item.unitNormPerM2} {item.unit}/m²</strong>
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-black text-emerald-700">
                              Tổng cần: {item.estQty} {item.unit}
                            </p>
                            <span className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded inline-block mt-0.5 ${
                              item.sufficient ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {item.sufficient ? `Tồn kho: ${item.stockQty} (Đủ)` : `Tồn kho: ${item.stockQty} (Thiếu ${item.estQty - item.stockQty})`}
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
          <div className="space-y-2">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Kỹ Sư Giám Sát Nghiệm Thu</label>
              <input
                type="text"
                value={inspectorName}
                onChange={(e) => setInspectorName(e.target.value)}
                placeholder="VD: KS. Nguyễn Văn Bình"
                className="w-full border border-slate-200 rounded-xl p-2.5 font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Ghi Chú Nghiệm Thu Căn Hộ</label>
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
          <div className="bg-amber-50/80 rounded-2xl border border-amber-200/90 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowDimensionSettings(!showDimensionSettings)}
              className="w-full p-3.5 flex items-center justify-between text-left hover:bg-amber-100/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="font-extrabold text-amber-950 text-xs truncate">
                  📐 Tùy Chỉnh Kích Thước &amp; Tọa Độ
                </span>
              </div>
              <div className="flex items-center gap-1 text-amber-900 text-xs font-semibold shrink-0">
                <span>{showDimensionSettings ? 'Thu gọn' : 'Tùy chỉnh'}</span>
                {showDimensionSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </button>

            {showDimensionSettings && (
              <div className="p-3.5 pt-0 border-t border-amber-200/70 space-y-3">
                {roomItem && onStartRedraw2Point && (
                  <div className="mt-2.5 space-y-2">
                    <p className="text-[11px] font-extrabold text-amber-900 flex items-center gap-1.5">
                      🎨 Chọn chế độ để vẽ lại vùng cho căn này:
                    </p>
                    <div className="grid grid-cols-3 gap-2">
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
                  <p className="font-extrabold text-slate-800 text-[11px] leading-snug break-words">📍 Tọa Độ 2 Điểm Khung (% trên mặt bằng, hỗ trợ số thập phân):</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1.5 min-w-0">
                      <span className="font-extrabold text-indigo-700 block text-[10.5px] leading-tight truncate">• Điểm Góc 1 (Trái - Trên):</span>
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
                      <span className="font-extrabold text-indigo-700 block text-[10.5px] leading-tight truncate">• Điểm Góc 2 (Phải - Dưới):</span>
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
                <div className="grid grid-cols-2 gap-3 text-[11px]">
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
          </div>

          {/* Submit Actions */}
          <div className="pt-2 flex flex-wrap gap-2">
            {roomItem && onDeleteRoom && (
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
                    Đồng Ý Xóa
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
              {roomItem ? 'Lưu Thay Đổi Nghiệm Thu' : 'Tạo Highlight Căn Hộ'}
            </button>
          </div>
        </form>
      </div>

      {/* CONFIRM REPLACE PRESET MODAL */}
      {showConfirmReplaceModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[250] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full space-y-4 border border-rose-100 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Xác Nhận Thay Thế Mẫu</h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Bạn có chắc chắn muốn nạp mẫu này và <strong className="text-rose-600 font-bold">XÓA TOÀN BỘ</strong> các hạng mục cũ đang có trong căn hộ không?
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmReplaceModal(false)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
              >
                Hủy Bỏ
              </button>
              <button
                type="button"
                onClick={async () => {
                  handleApplyPreset(presetSelection, 'replace');
                  setShowConfirmReplaceModal(false);
                }}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs shadow-xs"
              >
                Đồng Ý Xóa &amp; Thay Thế
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
