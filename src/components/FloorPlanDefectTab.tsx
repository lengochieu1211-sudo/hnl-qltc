import React, { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import * as XLSX from 'xlsx';
import { 
  MapPin, 
  Upload, 
  Download,
  AlertTriangle, 
  CheckCircle, 
  Camera, 
  Layers, 
  User,
  UserCheck, 
  Image as ImageIcon,
  Images,
  ExternalLink,
  Plus,
  PlusCircle,
  X,
  Filter,
  FileText,
  FileSpreadsheet,
  Sparkles,
  Building2,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Edit2,
  Edit3,
  Copy,
  Settings,
  Check,
  Pencil,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  FileType,
  Move,
  MousePointer,
  Maximize2,
  Minimize2,
  Sliders,
  Trash2,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Palette,
  ArrowUpDown,
  GripVertical
} from 'lucide-react';
import { FloorPlan, DefectItem, DefectCategory, DefectSeverity, DefectStatus, RoomProgressItem, RoomSubItem, Point2D, ChecklistItem, TeamInfo, MaterialNorm, InventoryItem, WorkVolume } from '../types';
import { UndoRedoControls } from './UndoRedoControls';
import { getRoomColorStyle, ROOM_COLOR_PALETTE } from '../utils/colorPalette';
import { getDefectOverdueInfo } from '../utils/defectUtils';
import { formatDateDDMMYYYY } from '../utils/dateFormatter';
import { useFormatSettings } from '../utils/numberUtils';
import { ImageViewerModal } from './ImageViewerModal';
import { ImageEditorModal } from './ImageEditorModal';
import { RoomHighlightModal } from './RoomHighlightModal';
import { PhotoAttachmentPicker } from './PhotoAttachmentPicker';
import { deleteEntityPhotos, savePhotoAttachment } from '../utils/photoStorage';
import { saveWorkbookFile } from '../utils/fileExport';
import { convertPdfToImage } from '../utils/pdfToImage';
import * as pdfjsLib from 'pdfjs-dist';

try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '3.11.174'}/pdf.worker.min.js`;
} catch (e) {}

const getMappedCoordinates = (e: React.PointerEvent | React.MouseEvent | Touch, element: HTMLElement, currentRotation: number) => {
  const rect = element.getBoundingClientRect();
  const clientX = 'clientX' in e ? e.clientX : (e as Touch).clientX;
  const clientY = 'clientY' in e ? e.clientY : (e as Touch).clientY;
  
  let x = (clientX - rect.left) / rect.width;
  let y = (clientY - rect.top) / rect.height;

  let origX = x;
  let origY = y;

  if (currentRotation === 90) {
      origX = y;
      origY = 1 - x;
  } else if (currentRotation === 180) {
      origX = 1 - x;
      origY = 1 - y;
  } else if (currentRotation === 270) {
      origX = 1 - y;
      origY = x;
  }

  return {
      x: origX * 100,
      y: origY * 100
  };
};

const isPointInRoom = (px: number, py: number, room: RoomProgressItem): boolean => {
  if (room.points && room.points.length >= 3) {
    let inside = false;
    for (let i = 0, j = room.points.length - 1; i < room.points.length; j = i++) {
      const xi = room.points[i].x, yi = room.points[i].y;
      const xj = room.points[j].x, yj = room.points[j].y;
      const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }
  if (room.x !== undefined && room.y !== undefined && room.width && room.height) {
    if (px >= room.x && px <= room.x + room.width && py >= room.y && py <= room.y + room.height) {
      return true;
    }
  }
  return false;
};

const getCandidateTeamsForDefect = (
  pinPos: { x: number; y: number } | null,
  activeFloorRooms: RoomProgressItem[],
  allRooms: RoomProgressItem[],
  declaredTeams: TeamInfo[] = []
) => {
  let roomAtPos: RoomProgressItem | undefined = undefined;
  if (pinPos) {
    roomAtPos = activeFloorRooms.find((r) => isPointInRoom(pinPos.x, pinPos.y, r));
  }

  const roomAtPosTeam = roomAtPos?.assignedTeam?.trim();

  const currentFloorTeamsSet = new Set<string>();
  activeFloorRooms.forEach((r) => {
    if (r.assignedTeam?.trim()) currentFloorTeamsSet.add(r.assignedTeam.trim());
    r.subItems?.forEach((s) => {
      if (s.assignedTeam?.trim()) currentFloorTeamsSet.add(s.assignedTeam.trim());
    });
  });
  const currentFloorTeams = Array.from(currentFloorTeamsSet);

  const allFloorTeamsSet = new Set<string>();
  allRooms.forEach((r) => {
    if (r.assignedTeam?.trim()) allFloorTeamsSet.add(r.assignedTeam.trim());
    r.subItems?.forEach((s) => {
      if (s.assignedTeam?.trim()) allFloorTeamsSet.add(s.assignedTeam.trim());
    });
  });
  const allFloorTeams = Array.from(allFloorTeamsSet);

  const declaredTeamNames = declaredTeams.map((t) => t.name.trim()).filter(Boolean);

  const allSuggestedTeams = Array.from(
    new Set([
      ...(roomAtPosTeam ? [roomAtPosTeam] : []),
      ...currentFloorTeams,
      ...declaredTeamNames,
      ...allFloorTeams,
      'Đội thi công bắn tấm',
      'Đội thi công khung trần',
      'Đội sơn bả',
    ])
  );

  return {
    roomAtPos,
    roomAtPosTeam,
    currentFloorTeams,
    declaredTeamNames,
    allFloorTeams,
    allSuggestedTeams,
  };
};

interface TeamSelectorInputProps {
  value: string;
  onChange: (val: string) => void;
  pinPos: { x: number; y: number } | null;
  activeFloorRooms: RoomProgressItem[];
  allRooms: RoomProgressItem[];
  declaredTeams?: TeamInfo[];
  listId?: string;
}

const TeamSelectorInput: React.FC<TeamSelectorInputProps> = ({
  value,
  onChange,
  pinPos,
  activeFloorRooms,
  allRooms,
  declaredTeams = [],
}) => {
  const {
    roomAtPos,
    roomAtPosTeam,
    currentFloorTeams,
    declaredTeamNames,
    allSuggestedTeams,
  } = getCandidateTeamsForDefect(pinPos, activeFloorRooms, allRooms, declaredTeams);

  // Determine if the current value is one of the suggested items
  const isSuggested = allSuggestedTeams.includes(value);

  return (
    <div className="space-y-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/60">
      <label className="block text-slate-700 font-bold text-xs flex items-center gap-1">
        <span>👷</span> Người / Đội Chịu Trách Nhiệm
      </label>

      {/* 1. Styled standard select dropdown for robust popup selection on any device */}
      <div className="space-y-1">
        <label className="block text-[10px] text-indigo-700 font-bold uppercase tracking-wider">
          📋 Chọn nhanh từ danh sách:
        </label>
        <select
          value={isSuggested ? value : (value ? 'custom' : '')}
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'custom') {
              // Let user type their own in the text input below
            } else {
              onChange(val);
            }
          }}
          className="w-full border border-slate-300 bg-white rounded-xl p-2.5 font-bold text-slate-800 text-xs focus:ring-2 focus:ring-rose-500 focus:border-rose-500 shadow-sm"
        >
          <option value="">-- Chọn đội từ danh sách ở đây --</option>
          
          {roomAtPosTeam && (
            <optgroup label="📍 Đội thuộc căn hộ hiện tại">
              <option value={roomAtPosTeam}>📍 {roomAtPosTeam} ({roomAtPos?.roomName || 'Căn hiện tại'})</option>
            </optgroup>
          )}

          {currentFloorTeams.length > 0 && (
            <optgroup label="🏢 Đội thi công trên tầng này">
              {currentFloorTeams.map((tName) => (
                <option key={tName} value={tName}>🏢 {tName}</option>
              ))}
            </optgroup>
          )}

          {declaredTeamNames.length > 0 && (
            <optgroup label="📋 Đội đã khai báo (Nhân sự / Đội)">
              {declaredTeamNames.map((tName) => (
                <option key={tName} value={tName}>📋 {tName}</option>
              ))}
            </optgroup>
          )}

          <optgroup label="⚡ Đội mẫu tiêu chuẩn">
            <option value="Đội thi công bắn tấm">👷 Đội thi công bắn tấm</option>
            <option value="Đội thi công khung trần">👷 Đội thi công khung trần</option>
            <option value="Đội sơn bả">👷 Đội sơn bả</option>
          </optgroup>

          <option value="custom">✍️ Tự nhập tổ đội khác...</option>
        </select>
      </div>

      {/* 2. Manual text input for customization / visual feedback */}
      <div className="space-y-1">
        <label className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider">
          ✍️ Hoặc tự nhập / sửa đổi tên đội tại đây:
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Nhập tên đội chịu trách nhiệm..."
          className="w-full border border-slate-300 bg-white rounded-xl p-2.5 font-bold text-slate-800 text-xs focus:ring-2 focus:ring-rose-500 focus:border-rose-500 shadow-xs"
          required
        />
      </div>

      {/* 3. Inline Quick Click Badges (For instant 1-tap experience) */}
      <div className="space-y-1.5 pt-1 text-[11px] border-t border-slate-200/60 mt-1">
        <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">⚡ Chọn Nhanh Bằng 1 Click:</span>
        
        {/* Room at Pin Location */}
        {roomAtPos && (
          <div className="bg-amber-50 border border-amber-200/60 p-2 rounded-xl flex items-center justify-between gap-2">
            <span className="font-semibold text-amber-900 truncate">
              📍 Vị trí: <strong>{roomAtPos.roomName}</strong>
            </span>
            {roomAtPosTeam ? (
              <button
                type="button"
                onClick={() => onChange(roomAtPosTeam)}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 transition-all ${
                  value === roomAtPosTeam
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-white border border-amber-300 text-amber-900 hover:bg-amber-100'
                }`}
              >
                Gán ({roomAtPosTeam})
              </button>
            ) : (
              <span className="text-[10px] text-amber-700 italic shrink-0">Căn này chưa có đội</span>
            )}
          </div>
        )}

        {/* Floor Plan Teams */}
        {currentFloorTeams.length > 0 && (
          <div className="bg-slate-50 border border-slate-200 p-2 rounded-xl">
            <span className="text-slate-500 font-bold block mb-1">🏢 Đội trên mặt bằng tầng:</span>
            <div className="flex flex-wrap gap-1">
              {currentFloorTeams.map((tName) => (
                <button
                  type="button"
                  key={tName}
                  onClick={() => onChange(tName)}
                  className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition-all ${
                    value === tName
                      ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {tName}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Declared Teams */}
        {declaredTeamNames.length > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 p-2 rounded-xl">
            <span className="text-emerald-800 font-bold block mb-1">📋 Đội đã khai báo:</span>
            <div className="flex flex-wrap gap-1">
              {declaredTeamNames.map((tName) => (
                <button
                  type="button"
                  key={tName}
                  onClick={() => onChange(tName)}
                  className={`px-2 py-1 rounded-lg border text-[10px] font-bold transition-all ${
                    value === tName
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-white text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                  }`}
                >
                  {tName}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


interface FloorPlanDefectTabProps {
  projectId?: string;
  floorPlans: FloorPlan[];
  defects: DefectItem[];
  roomProgressList: RoomProgressItem[];
  checklistItems?: ChecklistItem[];
  teams?: TeamInfo[];
  materialNorms?: MaterialNorm[];
  inventory?: InventoryItem[];
  workVolumes?: WorkVolume[];
  inspectorName?: string;
  onAddInventory?: (item: Omit<InventoryItem, 'id'>) => void;
  onAddFloorPlan: (plan: Omit<FloorPlan, 'id'> & { id?: string }) => void;
  onUpdateFloorPlanImage?: (id: string, imageUrl: string) => void;
  onRenameFloorPlan?: (id: string, newName: string) => void;
  onDeleteFloorPlan?: (id: string) => void;
  onDeleteMultipleFloorPlans?: (ids: string[]) => void;
  onDuplicateFloorPlan?: (id: string, customName?: string) => void;
  onMoveFloorPlan?: (id: string, direction: 'left' | 'right') => void;
  onAddDefect: (defect: Omit<DefectItem, 'id' | 'createdAt'>) => void;
  onUpdateDefectStatus: (id: string, status: DefectStatus) => void;
  onUpdateDefect?: (defect: DefectItem) => void;
  onDeleteDefect: (id: string) => void;
  onDeleteMultipleDefects?: (ids: string[]) => void;
  onSaveRoomProgress: (room: Omit<RoomProgressItem, 'id' | 'updatedAt'> & { id?: string }) => void;
  onBatchSaveRooms?: (rooms: RoomProgressItem[]) => void;
  onDeleteRoomProgress: (id: string) => void;
  onDeleteMultipleRoomProgress?: (ids: string[]) => void;
  onReorderRoomProgressList?: (reorderedList: RoomProgressItem[]) => void;
  onReorderFloorPlans?: (reorderedList: FloorPlan[]) => void;
  onOpenExportPdf?: () => void;
  onExportExcel?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

const DEFECT_CATEGORIES: DefectCategory[] = [
  'Bắn thiếu vít / thưa vít tấm',
  'Khung trần lệch/xô lệch',
  'Hở khe / Nứt mối nối tấm',
  'Ty treo lỏng / Sai khoảng cách',
  'Tấm trần bị ẩm / ố vàng / móp',
  'Chừa thiếu lỗ điện/máy lạnh',
  'Khác',
];

import { compressImage, compressDefectPhoto, compressFloorPlanImage, readFloorPlanAsDataUrl } from '../utils/imageCompressor';
import { confirmAsync } from '../utils/confirmAsync';
import { apiFetch, hasApiBackend } from '../utils/api';

const readFileAsDataUrl = (file: File): Promise<string> => {
  return readFloorPlanAsDataUrl(file);
};

const readDefectPhotoAsDataUrl = (file: File | Blob | string): Promise<string> => {
  return compressDefectPhoto(file);
};

export const FloorPlanDefectTab: React.FC<FloorPlanDefectTabProps> = ({
  projectId,
  floorPlans,
  defects,
  roomProgressList,
  checklistItems = [],
  teams = [],
  materialNorms = [],
  inventory = [],
  workVolumes = [],
  inspectorName,
  onAddInventory,
  onAddFloorPlan,
  onUpdateFloorPlanImage,
  onRenameFloorPlan,
  onDeleteFloorPlan,
  onDeleteMultipleFloorPlans,
  onDuplicateFloorPlan,
  onMoveFloorPlan,
  onAddDefect,
  onUpdateDefectStatus,
  onUpdateDefect,
  onDeleteDefect,
  onDeleteMultipleDefects,
  onSaveRoomProgress,
  onBatchSaveRooms,
  onDeleteRoomProgress,
  onDeleteMultipleRoomProgress,
  onReorderRoomProgressList,
  onReorderFloorPlans,
  onOpenExportPdf,
  onExportExcel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}) => {
  const { t } = useLanguage();
  const currentProjectId = projectId || (typeof localStorage !== 'undefined' ? localStorage.getItem('active_project_id') : '') || 'default';
  const getDraftKey = (base: string) => (currentProjectId === 'default' ? base : `${base}_${currentProjectId}`);

  const [selectedFloorId, setSelectedFloorId] = useState<string>(() => {
    const saved = localStorage.getItem(getDraftKey('construction_selected_floor_id'));
    if (saved && floorPlans.some((fp) => fp.id === saved)) {
      return saved;
    }
    return floorPlans[0]?.id || 'fp-1';
  });
  useFormatSettings();
  const [selectedDefectIds, setSelectedDefectIds] = useState<string[]>([]);

  // Auto-select newly added or duplicated floor by detecting the new ID
  const prevFloorPlansRef = useRef<FloorPlan[]>(floorPlans);
  const justSetStartPosRef = useRef(false);
  React.useEffect(() => {
    if (floorPlans.length > prevFloorPlansRef.current.length) {
      // Find the ID that exists in floorPlans but not in the previous list of floor plans
      const prevIds = new Set(prevFloorPlansRef.current.map((fp) => fp.id));
      const newFloor = floorPlans.find((fp) => !prevIds.has(fp.id));
      if (newFloor) {
        setSelectedFloorId(newFloor.id);
      }
    }
    prevFloorPlansRef.current = floorPlans;
  }, [floorPlans]);

  // Keep selectedFloorId in sync with valid floorPlans
  React.useEffect(() => {
    if (floorPlans.length > 0) {
      const saved = localStorage.getItem(getDraftKey('construction_selected_floor_id'));
      if (saved && floorPlans.some((fp) => fp.id === saved)) {
        if (selectedFloorId !== saved) {
          setSelectedFloorId(saved);
        }
        return;
      }
      const exists = floorPlans.some((fp) => fp.id === selectedFloorId);
      if (!exists) {
        setSelectedFloorId(floorPlans[0].id);
      }
    }
  }, [floorPlans, currentProjectId]);

  // Sync selectedFloorId to localStorage
  React.useEffect(() => {
    if (selectedFloorId) {
      localStorage.setItem(getDraftKey('construction_selected_floor_id'), selectedFloorId);
    }
  }, [selectedFloorId, currentProjectId]);

  const [viewMode, setViewMode] = useState<'all' | 'highlight' | 'defect'>(() => {
    const saved = localStorage.getItem(getDraftKey('construction_selected_view_mode'));
    if (saved === 'all' || saved === 'highlight' || saved === 'defect') {
      return saved;
    }
    return 'highlight';
  });

  React.useEffect(() => {
    localStorage.setItem(getDraftKey('construction_selected_view_mode'), viewMode);
  }, [viewMode, currentProjectId]);

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isUploadingPlan, setIsUploadingPlan] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [editingPhotoUrl, setEditingPhotoUrl] = useState<string | null>(null);
  const [isImageEditorOpen, setIsImageEditorOpen] = useState(false);
  const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
  const [viewingImageSet, setViewingImageSet] = useState<{ images: string[]; initialIndex: number } | null>(null);

  // Floor Customization & Management State
  const [showManageFloorsModal, setShowManageFloorsModal] = useState(false);
  const [floorSortBy, setFloorSortBy] = useState<'none' | 'name' | 'rooms' | 'defects'>('none');
  const [floorSortOrder, setFloorSortOrder] = useState<'asc' | 'desc'>('asc');
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null);
  const [editingFloorName, setEditingFloorName] = useState<string>('');
  const [inlineEditingFloorId, setInlineEditingFloorId] = useState<string | null>(null);
  const [inlineEditingName, setInlineEditingName] = useState<string>('');
  const [showQuickAddFloorModal, setShowQuickAddFloorModal] = useState(false);
  const [quickFloorNameInput, setQuickFloorNameInput] = useState('');
  const [showAddFloorModal, setShowAddFloorModal] = useState(false);
  const [newFloorName, setNewFloorName] = useState('');

  // Custom Confirmation Dialog States (Replaces native browser confirm dialogs)
  const [duplicatingFloorTarget, setDuplicatingFloorTarget] = useState<{ id: string; name: string } | null>(null);
  const [duplicateFloorNameInput, setDuplicateFloorNameInput] = useState<string>('');
  const [deletingFloorTarget, setDeletingFloorTarget] = useState<{ id: string; name: string } | null>(null);
  const [deletingRoomTarget, setDeletingRoomTarget] = useState<{ id: string; name: string; multipleIds?: string[] } | null>(null);
  const [deletingDefectTarget, setDeletingDefectTarget] = useState<DefectItem | null>(null);
  const [confirmDeleteOrphanedModal, setConfirmDeleteOrphanedModal] = useState<boolean>(false);

  // Defect Pin state
  const [pinPos, setPinPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const saved = localStorage.getItem(getDraftKey('construction_defect_draft_pinPos'));
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [showDefectModal, setShowDefectModal] = useState(() => {
    return localStorage.getItem(getDraftKey('construction_defect_draft_showDefectModal')) === 'true';
  });
  const [draftDefectId, setDraftDefectId] = useState<string>(() => {
    let saved = localStorage.getItem(getDraftKey('construction_defect_draft_id'));
    if (!saved) {
      saved = `defect_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      localStorage.setItem(getDraftKey('construction_defect_draft_id'), saved);
    }
    return saved;
  });
  const [activeDefectDetail, setActiveDefectDetail] = useState<DefectItem | null>(null);

  // Choice modal when clicking blueprint in 'all' mode
  const [clickChoicePos, setClickChoicePos] = useState<{ x: number; y: number } | null>(null);

  // Defect Form State
  const [category, setCategory] = useState<DefectCategory>(() => {
    const saved = localStorage.getItem(getDraftKey('construction_defect_draft_category'));
    return (saved as DefectCategory) || DEFECT_CATEGORIES[0];
  });
  const [description, setDescription] = useState(() => {
    return localStorage.getItem(getDraftKey('construction_defect_draft_description')) || '';
  });
  const [severity, setSeverity] = useState<DefectSeverity>(() => {
    return (localStorage.getItem(getDraftKey('construction_defect_draft_severity')) as DefectSeverity) || 'Trung bình';
  });
  const [assignedTo, setAssignedTo] = useState(() => {
    return localStorage.getItem(getDraftKey('construction_defect_draft_assignedTo')) || 'Đội thi công bắn tấm';
  });
  const [createdBy, setCreatedBy] = useState(() => inspectorName || 'Kỹ sư QC');
  const [dueDate, setDueDate] = useState(() => {
    const saved = localStorage.getItem(getDraftKey('construction_defect_draft_dueDate'));
    if (saved) return saved;
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().split('T')[0];
  });
  const [photoUrl, setPhotoUrl] = useState(() => {
    return localStorage.getItem(getDraftKey('construction_defect_draft_photoUrl')) || '';
  });
  const [afterPhotoUrl, setAfterPhotoUrl] = useState('');

  // Effects to save draft fields
  React.useEffect(() => {
    if (pinPos) {
      localStorage.setItem(getDraftKey('construction_defect_draft_pinPos'), JSON.stringify(pinPos));
    } else {
      localStorage.removeItem(getDraftKey('construction_defect_draft_pinPos'));
    }
  }, [pinPos, currentProjectId]);

  React.useEffect(() => {
    localStorage.setItem(getDraftKey('construction_defect_draft_showDefectModal'), String(showDefectModal));
  }, [showDefectModal, currentProjectId]);

  React.useEffect(() => {
    localStorage.setItem(getDraftKey('construction_defect_draft_category'), category);
  }, [category, currentProjectId]);

  React.useEffect(() => {
    localStorage.setItem(getDraftKey('construction_defect_draft_description'), description);
  }, [description, currentProjectId]);

  React.useEffect(() => {
    localStorage.setItem(getDraftKey('construction_defect_draft_severity'), severity);
  }, [severity, currentProjectId]);

  React.useEffect(() => {
    localStorage.setItem(getDraftKey('construction_defect_draft_assignedTo'), assignedTo);
  }, [assignedTo, currentProjectId]);

  React.useEffect(() => {
    localStorage.setItem(getDraftKey('construction_defect_draft_dueDate'), dueDate);
  }, [dueDate, currentProjectId]);

  // Legacy photo auto-migration effect for activeDefectDetail
  React.useEffect(() => {
    if (!activeDefectDetail) return;
    const pid = currentProjectId;
    const defectId = activeDefectDetail.id;

    let hasLegacy = false;
    const updated = { ...activeDefectDetail };

    const migrate = async () => {
      if (activeDefectDetail.imageUrl) {
        hasLegacy = true;
        try {
          await savePhotoAttachment(
            {
              projectId: pid,
              entityType: 'defect',
              entityId: defectId,
              category: 'defect_before',
              fileName: 'ảnh_trước_sửa.jpg',
              mimeType: 'image/jpeg',
              fileSize: 0,
            },
            activeDefectDetail.imageUrl
          );
        } catch (_) {}
        updated.imageUrl = undefined;
      }

      if (activeDefectDetail.afterImageUrl) {
        hasLegacy = true;
        try {
          await savePhotoAttachment(
            {
              projectId: pid,
              entityType: 'defect',
              entityId: defectId,
              category: 'defect_after',
              fileName: 'ảnh_sau_sửa.jpg',
              mimeType: 'image/jpeg',
              fileSize: 0,
            },
            activeDefectDetail.afterImageUrl
          );
        } catch (_) {}
        updated.afterImageUrl = undefined;
      }

      if (hasLegacy) {
        setActiveDefectDetail(updated);
        if (onUpdateDefect) {
          onUpdateDefect(updated);
        }
      }
    };

    migrate();
  }, [activeDefectDetail?.id]);

  React.useEffect(() => {
    localStorage.setItem(getDraftKey('construction_defect_draft_photoUrl'), photoUrl);
  }, [photoUrl, currentProjectId]);

  const handleCancelDefectModal = async () => {
    if (draftDefectId) {
      try {
        await deleteEntityPhotos(currentProjectId, 'defect', draftDefectId);
      } catch (_) {}
    }
    const nextDraftId = `defect_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    localStorage.setItem(getDraftKey('construction_defect_draft_id'), nextDraftId);
    setDraftDefectId(nextDraftId);

    setShowDefectModal(false);
    setPinPos(null);
    setDescription('');
    setPhotoUrl('');
    setAfterPhotoUrl('');
    
    // Clear draft storage
    localStorage.removeItem(getDraftKey('construction_defect_draft_pinPos'));
    localStorage.setItem(getDraftKey('construction_defect_draft_showDefectModal'), 'false');
    localStorage.removeItem(getDraftKey('construction_defect_draft_category'));
    localStorage.removeItem(getDraftKey('construction_defect_draft_description'));
    localStorage.removeItem(getDraftKey('construction_defect_draft_severity'));
    localStorage.removeItem(getDraftKey('construction_defect_draft_assignedTo'));
    localStorage.removeItem(getDraftKey('construction_defect_draft_dueDate'));
    localStorage.removeItem(getDraftKey('construction_defect_draft_photoUrl'));
  };

  const afterPhotoInputRef = useRef<HTMLInputElement>(null);
  const modalBeforeCameraRef = useRef<HTMLInputElement>(null);
  const modalBeforeGalleryRef = useRef<HTMLInputElement>(null);
  const modalAfterCameraRef = useRef<HTMLInputElement>(null);
  const modalAfterGalleryRef = useRef<HTMLInputElement>(null);

  // Draft Highlight Preview State (Requirement #1: Show highlight region on map BEFORE opening edit modal)
  const [pendingDraftHighlight, setPendingDraftHighlight] = useState<{
    rect?: { x: number; y: number; width: number; height: number };
    points?: Point2D[];
    isPolyline?: boolean;
  } | null>(null);

  // Zoom Scale State (Requirement #2: Zoom in on floor plan image)
  const [zoomScale, setZoomScale] = useState<number>(1);

  // PDF Upload & Convert State (Requirement #3)
  const [isConvertingPdf, setIsConvertingPdf] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [updatingFloorPlanId, setUpdatingFloorPlanId] = useState<string | null>(null);
  const updatePlanInputRef = useRef<HTMLInputElement>(null);

  // Room Highlight Modal State
  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const [selectedRoomForEdit, setSelectedRoomForEdit] = useState<RoomProgressItem | null>(null);
  const [newRoomClickPos, setNewRoomClickPos] = useState<{ x: number; y: number } | undefined>(undefined);
  const [newRoomRect, setNewRoomRect] = useState<{ x: number; y: number; width: number; height: number } | undefined>(undefined);
  const [newRoomPoints, setNewRoomPoints] = useState<Point2D[] | undefined>(undefined);

  // Drawing Tools State ('freehand' | 'polygon' | '2point' | 'drag' | 'none')
  const [drawTool, setDrawTool] = useState<'freehand' | 'polygon' | '2point' | 'drag' | 'none'>('none');
  const [roomColorMode, setRoomColorMode] = useState<'palette' | 'status'>('palette');
  const [drawStartPos, setDrawStartPos] = useState<{ x: number; y: number } | null>(null);
  const [drawHoverPos, setDrawHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Interactive Drag & Resize Highlight Region State
  const [selectedRoomForDragId, setSelectedRoomForDragId] = useState<string | null>(null);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const [selectedApartmentIds, setSelectedApartmentIds] = useState<string[]>([]);
  const [selectedFloorIdsForBulk, setSelectedFloorIdsForBulk] = useState<string[]>([]);
  const [isSelectingMultipleFloors, setIsSelectingMultipleFloors] = useState<boolean>(false);
  const [copiedRoomsState, setCopiedRoomsState] = useState<RoomProgressItem[]>([]);
  const [copyNotification, setCopyNotification] = useState<string | null>(null);
  const lastPointerMapPosRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 });

  // Touch Context Menu State for Mobile (Long-press)
  interface TouchContextMenuState {
    clientX: number;
    clientY: number;
    room: RoomProgressItem | null;
    rawX: number;
    rawY: number;
  }
  const [touchMenu, setTouchMenu] = useState<TouchContextMenuState | null>(null);
  
  const touchHoldTimerRef = useRef<any>(null);
  const touchStartPosRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const isLongPressActiveRef = useRef<boolean>(false);

  const handleContextMenuOnRoom = (e: React.MouseEvent, room: RoomProgressItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (!imageContainerRef.current) return;
    const { x: rawX, y: rawY } = getMappedCoordinates(e, imageContainerRef.current, rotation);
    const x = Math.min(100, Math.max(0, Math.round(rawX * 10) / 10));
    const y = Math.min(100, Math.max(0, Math.round(rawY * 10) / 10));
    setTouchMenu({
      clientX: e.clientX,
      clientY: e.clientY,
      room,
      rawX: x,
      rawY: y
    });
  };

  const handleContextMenuOnBg = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!imageContainerRef.current) return;
    const { x: rawX, y: rawY } = getMappedCoordinates(e, imageContainerRef.current, rotation);
    const x = Math.min(100, Math.max(0, Math.round(rawX * 10) / 10));
    const y = Math.min(100, Math.max(0, Math.round(rawY * 10) / 10));
    setTouchMenu({
      clientX: e.clientX,
      clientY: e.clientY,
      room: null,
      rawX: x,
      rawY: y
    });
  };

  const handleCopyRoom = async (room: RoomProgressItem) => {
    let selectedToCopy: RoomProgressItem[] = [room];
    if (selectedRoomIds.includes(room.id) && selectedRoomIds.length > 1) {
      selectedToCopy = roomProgressList.filter(r => selectedRoomIds.includes(r.id));
    }
    setCopiedRoomsState(selectedToCopy);
    setTouchMenu(null);
    setCopyNotification(`📋 Đã copy ${selectedToCopy.length > 1 ? `${selectedToCopy.length} căn` : `căn "${room.roomName}"`}! Bấm "Dán" để chèn vào mặt bằng.`);
    setTimeout(() => setCopyNotification(null), 3500);
  };

  const sortedFloorPlans = React.useMemo(() => {
    if (floorSortBy === 'none') {
      return floorPlans;
    }
    return [...floorPlans].sort((a, b) => {
      if (floorSortBy === 'name') {
        const comp = a.floorName.localeCompare(b.floorName, 'vi', { numeric: true, sensitivity: 'base' });
        return floorSortOrder === 'asc' ? comp : -comp;
      }
      if (floorSortBy === 'rooms') {
        const getCount = (fp: FloorPlan) => roomProgressList.filter(r => r.floorId === fp.id).length;
        const comp = getCount(a) - getCount(b);
        return floorSortOrder === 'asc' ? comp : -comp;
      }
      if (floorSortBy === 'defects') {
        const getCount = (fp: FloorPlan) => defects.filter(d => d.floorId === fp.id).length;
        const comp = getCount(a) - getCount(b);
        return floorSortOrder === 'asc' ? comp : -comp;
      }
      return 0;
    });
  }, [floorPlans, floorSortBy, floorSortOrder, roomProgressList, defects]);

  const orphanedRooms = React.useMemo(() => {
    return roomProgressList.filter((r) => !floorPlans.some((fp) => fp.id === r.floorId));
  }, [roomProgressList, floorPlans]);

  const handleDeleteAllOrphanedRooms = async () => {
    if (orphanedRooms.length === 0) return;
    setConfirmDeleteOrphanedModal(true);
  };

  const handleConfirmDeleteAllOrphaned = () => {
    if (onDeleteMultipleRoomProgress) {
      onDeleteMultipleRoomProgress(orphanedRooms.map(r => r.id));
    } else {
      orphanedRooms.forEach((r) => {
        if (onDeleteRoomProgress) {
          onDeleteRoomProgress(r.id);
        }
      });
    }
    setConfirmDeleteOrphanedModal(false);
  };

  const handlePasteRoom = (targetX: number, targetY: number, overwrite = false) => {
    if (copiedRoomsState.length === 0 || !activeFloor) return;
    
    // Find bounding box center of all copied rooms
    let minX = 100, minY = 100, maxX = 0, maxY = 0;
    copiedRoomsState.forEach(room => {
      if (room.points && room.points.length > 0) {
        room.points.forEach(p => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });
      } else {
        if (room.x < minX) minX = room.x;
        if (room.x + (room.width || 20) > maxX) maxX = room.x + (room.width || 20);
        if (room.y < minY) minY = room.y;
        if (room.y + (room.height || 15) > maxY) maxY = room.y + (room.height || 15);
      }
    });

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const dx = targetX - centerX;
    const dy = targetY - centerY;

    const newPastedIds: string[] = [];

    copiedRoomsState.forEach((room) => {
      let newX = Math.min(100 - (room.width || 20), Math.max(0, room.x + dx));
      let newY = Math.min(100 - (room.height || 15), Math.max(0, room.y + dy));
      let newPoints = undefined;

      if (room.points && room.points.length > 0) {
        newPoints = room.points.map((p) => ({
          x: Math.min(100, Math.max(0, Math.round((p.x + dx) * 10) / 10)),
          y: Math.min(100, Math.max(0, Math.round((p.y + dy) * 10) / 10)),
        }));
        let newMinX = 100, newMinY = 100;
        newPoints.forEach((p) => {
          if (p.x < newMinX) newMinX = p.x;
          if (p.y < newMinY) newMinY = p.y;
        });
        newX = Math.round(newMinX * 10) / 10;
        newY = Math.round(newMinY * 10) / 10;
      } else {
        newX = Math.round(newX * 10) / 10;
        newY = Math.round(newY * 10) / 10;
      }

      // Format clean duplicate name or keep exact name if overwriting
      let newName = room.roomName;
      if (!overwrite) {
        if (newName.includes('(Bản sao')) {
          const match = newName.match(/\(Bản sao\s*(\d*)\)/);
          if (match) {
            const num = match[1] ? parseInt(match[1], 10) + 1 : 2;
            newName = newName.replace(/\(Bản sao\s*\d*\)/, `(Bản sao ${num})`);
          } else {
            newName = `${newName} (Bản sao)`;
          }
        } else {
          newName = `${newName} (Bản sao)`;
        }
      }

      // Check for an existing room of the same name on this floor to overwrite
      const existingRoom = overwrite
        ? floorRooms.find((r) => r.roomName.trim().toLowerCase() === room.roomName.trim().toLowerCase())
        : undefined;

      const generatedId = existingRoom ? existingRoom.id : `ROOM-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      newPastedIds.push(generatedId);

      const newRoom: RoomProgressItem = {
        id: generatedId,
        floorId: activeFloor.id,
        roomName: newName,
        x: newX,
        y: newY,
        width: room.width || 20,
        height: room.height || 15,
        frameStatus: room.frameStatus,
        boardStatus: room.boardStatus,
        frameInspectionStatus: room.frameInspectionStatus,
        boardInspectionStatus: room.boardInspectionStatus,
        inspectionStatus: room.inspectionStatus,
        inspectorName: room.inspectorName,
        notes: room.notes,
        assignedTeam: room.assignedTeam,
        targetFrameDate: room.targetFrameDate,
        targetBoardDate: room.targetBoardDate,
        points: newPoints,
        workCategory: room.workCategory,
        categoryVolumes: room.categoryVolumes ? { ...room.categoryVolumes } : undefined,
        subItems: room.subItems
          ? room.subItems.map((subItem) => ({
              ...subItem,
              id: `sub-custom-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            }))
          : undefined,
        workVolume: room.workVolume,
        volumeUnit: room.volumeUnit,
        isPolyline: room.isPolyline,
        color: room.color,
        updatedAt: Date.now()
      };
      
      onSaveRoomProgress(newRoom);
    });

    if (newPastedIds.length > 0) {
      const lastId = newPastedIds[newPastedIds.length - 1];
      setSelectedRoomForDragId(lastId);
      setSelectedRoomIds(newPastedIds);
      setCopyNotification(
        overwrite
          ? `🎉 Đã dán đè/cập nhật thành công ${newPastedIds.length} căn!`
          : `🎉 Đã dán thành công ${newPastedIds.length} căn mới!`
      );
      setTimeout(() => setCopyNotification(null), 3500);
    }

    setTouchMenu(null);
  };

  const handleDeleteRoom = (room: RoomProgressItem) => {
    setDeletingRoomTarget({ id: room.id, name: room.roomName });
    setTouchMenu(null);
  };

  const handleRoomTouchStart = (e: React.TouchEvent, room: RoomProgressItem) => {
    e.stopPropagation();
    if (e.touches.length !== 1) return;
    
    const touch = e.touches[0];
    const clientX = touch.clientX;
    const clientY = touch.clientY;
    touchStartPosRef.current = { clientX, clientY };
    isLongPressActiveRef.current = false;

    if (!imageContainerRef.current) return;
    const { x: rawX, y: rawY } = getMappedCoordinates(touch, imageContainerRef.current, rotation);
    const x = Math.min(100, Math.max(0, Math.round(rawX * 10) / 10));
    const y = Math.min(100, Math.max(0, Math.round(rawY * 10) / 10));

    if (touchHoldTimerRef.current) clearTimeout(touchHoldTimerRef.current);
    touchHoldTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true;
      if (navigator.vibrate) {
        try { navigator.vibrate(50); } catch {}
      }
      setTouchMenu({
        clientX,
        clientY,
        room,
        rawX: x,
        rawY: y
      });
    }, 400); // 0.4s touch-hold delay
  };

  const handleRoomTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartPosRef.current.clientX;
    const dy = touch.clientY - touchStartPosRef.current.clientY;
    if (dx * dx + dy * dy > 900) { // 30px wobble tolerance
      if (touchHoldTimerRef.current) {
        clearTimeout(touchHoldTimerRef.current);
        touchHoldTimerRef.current = null;
      }
    }
  };

  const handleRoomTouchEnd = (e: React.TouchEvent) => {
    if (touchHoldTimerRef.current) {
      clearTimeout(touchHoldTimerRef.current);
      touchHoldTimerRef.current = null;
    }
    if (isLongPressActiveRef.current) {
      e.preventDefault();
      isLongPressActiveRef.current = false;
    }
    touchStartPosRef.current = null;
  };

  const handleBgTouchStart = (e: React.TouchEvent) => {
    if (drawTool !== 'none' && drawTool !== 'drag') return;
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    const clientX = touch.clientX;
    const clientY = touch.clientY;
    touchStartPosRef.current = { clientX, clientY };
    isLongPressActiveRef.current = false;

    if (!imageContainerRef.current) return;
    const { x: rawX, y: rawY } = getMappedCoordinates(touch, imageContainerRef.current, rotation);
    const x = Math.min(100, Math.max(0, Math.round(rawX * 10) / 10));
    const y = Math.min(100, Math.max(0, Math.round(rawY * 10) / 10));

    if (touchHoldTimerRef.current) clearTimeout(touchHoldTimerRef.current);
    touchHoldTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true;
      if (navigator.vibrate) {
        try { navigator.vibrate(50); } catch {}
      }
      setTouchMenu({
        clientX,
        clientY,
        room: null,
        rawX: x,
        rawY: y
      });
    }, 400); // 0.4s touch-hold delay
  };

  const handleBgTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartPosRef.current.clientX;
    const dy = touch.clientY - touchStartPosRef.current.clientY;
    if (dx * dx + dy * dy > 900) { // 30px wobble tolerance
      if (touchHoldTimerRef.current) {
        clearTimeout(touchHoldTimerRef.current);
        touchHoldTimerRef.current = null;
      }
    }
  };

  const handleBgTouchEnd = (e: React.TouchEvent) => {
    if (touchHoldTimerRef.current) {
      clearTimeout(touchHoldTimerRef.current);
      touchHoldTimerRef.current = null;
    }
    if (isLongPressActiveRef.current) {
      e.preventDefault();
      isLongPressActiveRef.current = false;
    }
    touchStartPosRef.current = null;
  };

  const handleRoomSelectClick = (e: React.MouseEvent | React.PointerEvent, room: RoomProgressItem) => {
    e.stopPropagation();
    if (touchHoldTimerRef.current) {
      clearTimeout(touchHoldTimerRef.current);
      touchHoldTimerRef.current = null;
    }
    setTouchMenu(null);
    setHoveredRoomId(null);
    setClickChoicePos(null);

    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setSelectedRoomIds((prev) => {
        const exists = prev.includes(room.id);
        let updated;
        if (exists) {
          updated = prev.filter(id => id !== room.id);
        } else {
          updated = [...prev, room.id];
        }
        setSelectedRoomForDragId(updated.length > 0 ? updated[updated.length - 1] : null);
        return updated;
      });
    } else {
      setSelectedRoomIds((prev) => {
        if (prev.length === 1 && prev[0] === room.id) {
          setSelectedRoomForDragId(null);
          return [];
        }
        setSelectedRoomForDragId(room.id);
        return [room.id];
      });
    }
  };

  const [activeDragHandle, setActiveDragHandle] = useState<
    'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | number | null
  >(null);
  const [dragStartInfo, setDragStartInfo] = useState<{
    mouseX: number;
    mouseY: number;
    room: RoomProgressItem;
    rooms?: RoomProgressItem[];
  } | null>(null);



  // Freehand Drawing Live State
  const [isFreehandDrawing, setIsFreehandDrawing] = useState(false);
  const [freehandPoints, setFreehandPoints] = useState<Point2D[]>([]);

  // Polygon Point-by-Point Drawing State
  const [polygonPoints, setPolygonPoints] = useState<Point2D[]>([]);

  // Redraw existing room highlight using 2 points state
  const [redrawingRoomTarget, setRedrawingRoomTarget] = useState<RoomProgressItem | null>(null);
  const [is2PointDragging, setIs2PointDragging] = useState(false);

  const handleStartRedraw2Point = (room: RoomProgressItem, tool: 'freehand' | 'polygon' | '2point' = '2point') => {
    setRedrawingRoomTarget(room);
    setDrawTool(tool);
    setDrawStartPos(null);
    setDrawHoverPos(null);
    setPolygonPoints([]);
    if (imageContainerRef.current) {
      imageContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // Download excel template or current room data for Room Highlights
  const downloadHighlightTemplate = () => {
    const wb = XLSX.utils.book_new();
    const roomsToExport = floorRooms.length > 0 ? floorRooms : [
      {
        roomName: 'Phòng Khách Căn A101',
        x: 15,
        y: 20,
        width: 30,
        height: 25,
        frameStatus: 'Đang làm',
        boardStatus: 'Chưa làm',
        frameInspectionStatus: 'Chưa nghiệm thu',
        boardInspectionStatus: 'Chưa nghiệm thu',
        inspectorName: 'KS. Nguyễn Văn Bình',
        notes: 'Khung xương cá BASI lắp ghép thăng bằng tốt'
      },
      {
        roomName: 'Phòng WC Căn A101',
        x: 48,
        y: 20,
        width: 15,
        height: 20,
        frameStatus: 'Đã hoàn thành',
        boardStatus: 'Đã hoàn thành',
        frameInspectionStatus: 'Đạt nghiệm thu',
        boardInspectionStatus: 'Đạt nghiệm thu',
        inspectorName: 'KS. Nguyễn Văn Bình',
        notes: 'Đã nghiệm thu xong cả khung và tấm'
      }
    ];

    const data = roomsToExport.map(r => ({
      'STT': roomsToExport.indexOf(r) + 1,
      '__recordId': (r as any).id || '',
      'Tên Căn Hộ hoặc Phòng': r.roomName,
      'Tọa độ X (%)': r.x,
      'Tọa độ Y (%)': r.y,
      'Chiều Rộng W (%)': r.width,
      'Chiều Cao H (%)': r.height,
      'Trạng Thái Khung Xương': r.frameStatus,
      'Trạng Thái Bắn Tấm': r.boardStatus,
      'Nghiệm Thu Khung': r.frameInspectionStatus,
      'Nghiệm Thu Tấm': r.boardInspectionStatus,
      'Kỹ Sư Giám Sát': r.inspectorName,
      'Ghi Chú': r.notes || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, activeFloor ? activeFloor.floorName : 'DanhSachPhong');
    return saveWorkbookFile(wb, `Danh_Sach_Phong_${activeFloor ? activeFloor.floorName.replace(/\s+/g, '_') : 'MatBang'}.xlsx`);
  };



  // Handle uploaded excel to import Room Highlights
  const handleImportExcelHighlights = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

        if (!jsonData || jsonData.length === 0) {
          alert('❌ Thất bại: Tệp Excel không có dữ liệu hoặc định dạng không đúng! Vui lòng tải lại tệp chuẩn.');
          return;
        }

        // Validate that we can find the room name column
        const firstRow = jsonData[0];
        const foundHeaders = Object.keys(firstRow);
        const nameMatchKey = foundHeaders.find(h => 
          ['Tên Căn Hộ hoặc Phòng', 'roomName', 'Tên Phòng', 'Phòng', 'Căn Hộ', 'can ho', 'room'].some(rk => h.toLowerCase().includes(rk.toLowerCase()))
        );

        if (!nameMatchKey) {
          alert(
            `⚠️ Không tìm thấy cột thông tin bắt buộc 'Tên Căn Hộ hoặc Phòng'!\n\n` +
            `• Các cột tìm thấy trong file: [${foundHeaders.join(', ')}]\n` +
            `• Vui lòng đặt lại tiêu đề cột trong file Excel trùng với mẫu để hệ thống nhận diện đúng phòng.`
          );
          return;
        }

        const currentFloorRooms = roomProgressList.filter(r => r.floorId === activeFloor?.id);

        let existingMatchCount = 0;
        let newCount = 0;
        jsonData.forEach((row: any) => {
          const rawName = row[nameMatchKey];
          if (rawName) {
            const nameStr = String(rawName).trim();
            if (nameStr) {
              const found = currentFloorRooms.find(r => r.roomName.toLowerCase() === nameStr.toLowerCase());
              if (found) existingMatchCount++;
              else newCount++;
            }
          }
        });

        if (existingMatchCount === 0 && newCount === 0) {
          alert('⚠️ Không tìm thấy phòng hoặc căn hộ hợp lệ nào trong tệp Excel để xử lý!');
          return;
        }

        // Ask Step 1: Merge or choose replace/cancel
        const wantMerge = await confirmAsync(
          `📂 Phát hiện ${jsonData.length} phòng trong tệp Excel (${existingMatchCount} phòng trùng tên đã có sẵn, ${newCount} phòng mới).\n\n` +
          `• Bấm "Đồng ý" để CẬP NHẬT thông tin các phòng cũ & THÊM MỚI các phòng chưa có.\n` +
          `• Bấm "Hủy" để mở tùy chọn THAY THẾ TOÀN BỘ hoặc HỦY THAO TÁC.`
        );

        let importMode: 'merge' | 'replace' = 'merge';

        if (!wantMerge) {
          const wantReplace = await confirmAsync(
            `⚠️ Bạn có chắc chắn muốn XÓA TOÀN BỘ ${currentFloorRooms.length} căn/phòng hiện tại trên mặt bằng "${activeFloor?.floorName}" và THAY THẾ HOÀN TOÀN bằng dữ liệu mới từ file Excel không?\n\n` +
            `• Bấm "Đồng ý" để XÓA TOÀN BỘ & NẠP LẠI MỚI.\n` +
            `• Bấm "Hủy" để DỪNG THAO TÁC VÀ GIỮ NGUYÊN DỮ LIỆU CŨ.`
          );

          if (!wantReplace) {
            e.target.value = '';
            return;
          }

          importMode = 'replace';
        }

        let importedCount = 0;
        let updatedCount = 0;
        const processedRoomIds = new Set<string>();

        jsonData.forEach((row: any) => {
          const rawRecordId = String(row['__recordId'] || row['Mã Định Danh'] || row['id'] || '').trim();
          const rawName = row[nameMatchKey];
          if (!rawName) return;

          const nameStr = String(rawName).trim();
          if (!nameStr) return;

          const rawX = Number(row['Tọa độ X (%)'] || row['x'] || 20);
          const rawY = Number(row['Tọa độ Y (%)'] || row['y'] || 20);
          const rawW = Number(row['Chiều Rộng W (%)'] || row['width'] || 30);
          const rawH = Number(row['Chiều Cao H (%)'] || row['height'] || 30);

          const frameSt = row['Trạng Thái Khung Xương'] || row['frameStatus'] || 'Chưa làm';
          const boardSt = row['Trạng Thái Bắn Tấm'] || row['boardStatus'] || 'Chưa làm';
          const frameInsp = row['Nghiệm Thu Khung'] || row['frameInspectionStatus'] || 'Chưa nghiệm thu';
          const boardInsp = row['Nghiệm Thu Tấm'] || row['boardInspectionStatus'] || 'Chưa nghiệm thu';
          const inspector = row['Kỹ Sư Giám Sát'] || row['inspectorName'] || 'KS. Nguyễn Văn Bình';
          const noteText = row['Ghi Chú'] || row['notes'] || '';

          const validAcceptance = ['Chưa làm', 'Đang làm', 'Đã hoàn thành'];
          const validInspection = ['Chưa nghiệm thu', 'Đạt nghiệm thu', 'Chưa đạt (Cần sửa)'];

          const frameStatusVal = validAcceptance.includes(frameSt) ? frameSt : 'Chưa làm';
          const boardStatusVal = validAcceptance.includes(boardSt) ? boardSt : 'Chưa làm';
          const frameInspectionVal = validInspection.includes(frameInsp) ? frameInsp : 'Chưa nghiệm thu';
          const boardInspectionVal = validInspection.includes(boardInsp) ? boardInsp : 'Chưa nghiệm thu';

          let overall = 'Chưa nghiệm thu';
          if (frameInspectionVal === 'Đạt nghiệm thu' && boardInspectionVal === 'Đạt nghiệm thu') {
            overall = 'Đạt nghiệm thu';
          } else if (frameInspectionVal === 'Chưa đạt (Cần sửa)' || boardInspectionVal === 'Chưa đạt (Cần sửa)') {
            overall = 'Chưa đạt (Cần sửa)';
          }

          let existingId: string | undefined = undefined;
          let existingRoomObj: any = null;
          
          // Match by __recordId or name
          const match = currentFloorRooms.find(r => (rawRecordId && r.id === rawRecordId) || r.roomName.toLowerCase() === nameStr.toLowerCase());
          if (match) {
            existingId = match.id;
            existingRoomObj = match;
            updatedCount++;
          } else {
            existingId = rawRecordId || undefined;
            importedCount++;
          }

          const targetId = existingId || `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          processedRoomIds.add(targetId);

          onSaveRoomProgress({
            ...(existingRoomObj || {}),
            id: targetId,
            floorId: activeFloor?.id || 'fp-1',
            floorName: activeFloor?.floorName || 'Mặt bằng',
            roomName: nameStr,
            x: Math.min(95, Math.max(0, rawX)),
            y: Math.min(95, Math.max(0, rawY)),
            width: Math.min(100 - rawX, Math.max(5, rawW)),
            height: Math.min(100 - rawY, Math.max(5, rawH)),
            frameStatus: frameStatusVal,
            boardStatus: boardStatusVal,
            frameInspectionStatus: frameInspectionVal,
            boardInspectionStatus: boardInspectionVal,
            inspectionStatus: overall,
            inspectorName: inspector,
            notes: noteText
          });
        });

        // In replace mode, delete only obsolete rooms not present in the Excel file
        if (importMode === 'replace') {
          const obsoleteRooms = currentFloorRooms.filter(r => !processedRoomIds.has(r.id));
          if (obsoleteRooms.length > 0) {
            if (onDeleteMultipleRoomProgress) {
              onDeleteMultipleRoomProgress(obsoleteRooms.map(r => r.id));
            } else {
              obsoleteRooms.forEach(r => onDeleteRoomProgress(r.id));
            }
          }
        }

        alert(
          `🎉 Nhập dữ liệu Mặt Bằng từ Excel thành công!\n\n` +
          `• Đã cập nhật/chỉnh sửa: ${updatedCount} phòng/căn\n` +
          `• Đã tạo mới/thêm mới: ${importedCount} phòng/căn`
        );
      } catch (err: any) {
        alert(`❌ Lỗi đọc hoặc phân tích tệp Excel:\n${err.message || err}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // Minimalist Overlay Mode State (Default FALSE so only clean highlights show without cluttered text)
  const [showTextOverlay, setShowTextOverlay] = useState(false);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imgAspect, setImgAspect] = useState<number>(1.414);
  const [rotation, setRotation] = useState<number>(0);
  const parentRef = useRef<HTMLDivElement>(null);
  const [parentSize, setParentSize] = useState({ w: 0, h: 0 });

  const activeFloor = floorPlans.find((fp) => fp.id === selectedFloorId) || floorPlans[0];
  const openDefectLegacyImageViewer = (defect: DefectItem, requestedUrl?: string) => {
    const images = [defect.imageUrl, defect.afterImageUrl].filter((url): url is string => Boolean(url));
    if (images.length === 0) return;
    const initialIndex = Math.max(0, requestedUrl ? images.indexOf(requestedUrl) : 0);
    setViewingImageSet({ images, initialIndex });
  };

  const floorDefects = defects.filter((d) => d.floorId === activeFloor?.id);
  const floorRooms = roomProgressList.filter((r) => r.floorId === activeFloor?.id);
  const [draggingRoomsPreview, setDraggingRoomsPreview] = useState<Record<string, RoomProgressItem> | null>(null);
  const draggingRoomsPreviewRef = useRef<Record<string, RoomProgressItem> | null>(null);

  const displayedFloorRooms = React.useMemo(() => {
    if (!draggingRoomsPreview) return floorRooms;
    return floorRooms.map((r) => draggingRoomsPreview[r.id] || r);
  }, [floorRooms, draggingRoomsPreview]);

  const [roomSortBy, setRoomSortBy] = useState<'name' | 'createdAt' | 'updatedAt' | 'manual'>('manual');
  const [roomSortOrder, setRoomSortOrder] = useState<'asc' | 'desc'>('asc');

  const sortedFloorRooms = React.useMemo(() => {
    if (roomSortBy === 'manual') return displayedFloorRooms;

    const getCreatedAt = (room: RoomProgressItem) => {
      const parts = room.id.split('-');
      if (parts.length > 1) {
        const ts = parseInt(parts[1], 10);
        if (!isNaN(ts) && ts > 1000000000000) {
          return ts;
        }
      }
      return room.updatedAt || 0;
    };

    return [...displayedFloorRooms].sort((a, b) => {
      let comparison = 0;
      if (roomSortBy === 'name') {
        comparison = a.roomName.localeCompare(b.roomName, 'vi', { numeric: true, sensitivity: 'base' });
      } else if (roomSortBy === 'createdAt') {
        comparison = getCreatedAt(a) - getCreatedAt(b);
      } else if (roomSortBy === 'updatedAt') {
        comparison = (a.updatedAt || 0) - (b.updatedAt || 0);
      }
      return roomSortOrder === 'asc' ? comparison : -comparison;
    });
  }, [displayedFloorRooms, roomSortBy, roomSortOrder]);

  const selectedRoomObject = displayedFloorRooms.find((r) => r.id === selectedRoomForDragId || selectedRoomIds.includes(r.id));

  useEffect(() => {
    setRotation(0);
    setZoomScale(1);
  }, [selectedFloorId]);

  useEffect(() => {
    if (isFullscreen || zoomScale > 1) {
      const imgEl = imageContainerRef.current?.querySelector('img');
      if (imgEl && imgEl.naturalWidth && imgEl.naturalHeight) {
        setImgAspect(imgEl.naturalWidth / imgEl.naturalHeight);
      }
    } else {
      setImgAspect(1.414);
    }
  }, [isFullscreen, zoomScale, selectedFloorId]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setParentSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    obs.observe(el);
    setParentSize({ w: el.clientWidth, h: el.clientHeight });
    return () => obs.disconnect();
  }, [isFullscreen, selectedFloorId, activeFloor]);

  const activePointersRef = useRef<Set<number>>(new Set());

  const photoInputRef = useRef<HTMLInputElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts: Ctrl+C (copy selected room), Ctrl+V (paste copied room), Delete / Backspace (delete selected room with confirmation)
  const [copiedRoomState, setCopiedRoomState] = useState<RoomProgressItem | null>(null);

  // Native touch handlers for pinch-to-zoom
  const zoomScaleRef = useRef(zoomScale);
  useEffect(() => {
    zoomScaleRef.current = zoomScale;
  }, [zoomScale]);

  useEffect(() => {
    const parentEl = parentRef.current;
    const imgEl = imageContainerRef.current;
    const elementsToBind = [parentEl, imgEl].filter((el): el is HTMLElement => el !== null);

    if (elementsToBind.length === 0) return;
    
    let initialDist = 0;
    let initialZoom = 1;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        initialDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialZoom = zoomScaleRef.current;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialDist > 0) {
        if (e.cancelable) e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (dist > 0) {
          const scaleChange = dist / initialDist;
          let newScale = initialZoom * scaleChange;
          newScale = Math.min(20, Math.max(1, newScale));
          setZoomScale(Number(newScale.toFixed(2)));
        }
      }
    };
    
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        initialDist = 0;
      }
    };

    const onWheel = (e: WheelEvent) => {
      // Zoom with wheel when holding Ctrl / Cmd (or standard touchpad pinch which sets ctrlKey = true)
      if (e.ctrlKey || e.metaKey) {
        if (e.cancelable) e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        let newScale = zoomScaleRef.current * factor;
        newScale = Math.min(20, Math.max(1, newScale));
        setZoomScale(Number(newScale.toFixed(2)));
      }
    };

    elementsToBind.forEach(container => {
      container.addEventListener('touchstart', onTouchStart, { passive: false });
      container.addEventListener('touchmove', onTouchMove, { passive: false });
      container.addEventListener('touchend', onTouchEnd);
      container.addEventListener('touchcancel', onTouchEnd);
      container.addEventListener('wheel', onWheel, { passive: false });
    });

    return () => {
      elementsToBind.forEach(container => {
        container.removeEventListener('touchstart', onTouchStart);
        container.removeEventListener('touchmove', onTouchMove);
        container.removeEventListener('touchend', onTouchEnd);
        container.removeEventListener('touchcancel', onTouchEnd);
        container.removeEventListener('wheel', onWheel);
      });
    };
  }, [selectedFloorId, isFullscreen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      // Ctrl+A / Cmd+A: Select all rooms on current floor
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const allRoomIds = floorRooms.map(r => r.id);
        setSelectedRoomIds(allRoomIds);
        if (allRoomIds.length > 0) {
          setSelectedRoomForDragId(allRoomIds[allRoomIds.length - 1]);
        }
      }

      // Ctrl+C / Cmd+C: Copy selected rooms
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const roomsToCopy = floorRooms.filter(r => selectedRoomIds.includes(r.id) || r.id === selectedRoomForDragId);
        if (roomsToCopy.length > 0) {
          handleCopyRoom(roomsToCopy[0]);
        }
      }

      // Ctrl+V / Cmd+V: Paste copied rooms
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (copiedRoomsState.length > 0 && activeFloor) {
          e.preventDefault();
          const px = lastPointerMapPosRef.current ? lastPointerMapPosRef.current.x : 50;
          const py = lastPointerMapPosRef.current ? lastPointerMapPosRef.current.y : 50;
          handlePasteRoom(px, py);
        }
      }

      // Escape: Cancel/exit drawing commands and clear drawing states
      if (e.key === 'Escape') {
        setDrawTool('none');
        setRedrawingRoomTarget(null);
        setIs2PointDragging(false);
        setIsFreehandDrawing(false);
        setDrawStartPos(null);
        setDrawHoverPos(null);
        setFreehandPoints([]);
        setPolygonPoints([]);
        setPendingDraftHighlight(null);
        setPinPos(null);
        setClickChoicePos(null);
      }

      // Delete / Backspace: Delete selected rooms with confirmation
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const roomsToDelete = floorRooms.filter(r => selectedRoomIds.includes(r.id) || r.id === selectedRoomForDragId);
        if (roomsToDelete.length > 0 && onDeleteRoomProgress) {
          const names = roomsToDelete.map(r => `"${r.roomName}"`).join(', ');
          setDeletingRoomTarget({
            id: roomsToDelete[0].id,
            name: `${roomsToDelete.length > 1 ? `${roomsToDelete.length} căn (${names})` : names}`,
            multipleIds: roomsToDelete.map(r => r.id)
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedRoomForDragId, selectedRoomIds, floorRooms, copiedRoomsState, activeFloor, onSaveRoomProgress, onDeleteRoomProgress]);

  const filteredDefects = floorDefects.filter((d) => {
    if (statusFilter === 'all') return true;
    return d.status === statusFilter;
  });

  // Helper handlers for floor plan customization (rename, duplicate, delete, quick add)
  const handleRenameFloor = (floorId: string, currentName: string) => {
    setInlineEditingFloorId(floorId);
    setInlineEditingName(currentName);
  };

  const handleDuplicateFloor = (floorId: string, floorName: string) => {
    setDuplicatingFloorTarget({ id: floorId, name: floorName });
    setDuplicateFloorNameInput(`${floorName} (Bản sao)`);
  };

  const handleConfirmDuplicateFloor = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!duplicatingFloorTarget) return;
    const finalName = duplicateFloorNameInput.trim() || `${duplicatingFloorTarget.name} (Bản sao)`;
    if (onDuplicateFloorPlan) {
      onDuplicateFloorPlan(duplicatingFloorTarget.id, finalName);
    }
    setDuplicatingFloorTarget(null);
  };

  const handleDeleteFloor = (floorId: string, floorName: string) => {
    if (floorPlans.length <= 1) {
      alert('Không thể xóa mặt bằng duy nhất! Dự án cần duy trì ít nhất 1 mặt bằng.');
      return;
    }
    setDeletingFloorTarget({ id: floorId, name: floorName });
  };

  const handleConfirmDeleteFloor = async () => {
    if (!deletingFloorTarget) return;
    const { id } = deletingFloorTarget;
    if (selectedFloorId === id) {
      const remaining = floorPlans.filter((fp) => fp.id !== id);
      if (remaining.length > 0) {
        setSelectedFloorId(remaining[0].id);
      }
    }
    if (onDeleteFloorPlan) {
      onDeleteFloorPlan(id);
    }
    setDeletingFloorTarget(null);
  };

  const handleConfirmDeleteRoom = () => {
    if (!deletingRoomTarget) return;
    if (deletingRoomTarget.multipleIds && deletingRoomTarget.multipleIds.length > 0) {
      if (onDeleteMultipleRoomProgress) {
        onDeleteMultipleRoomProgress(deletingRoomTarget.multipleIds);
      } else if (onDeleteRoomProgress) {
        deletingRoomTarget.multipleIds.forEach(id => onDeleteRoomProgress(id));
      }
    } else if (onDeleteRoomProgress) {
      onDeleteRoomProgress(deletingRoomTarget.id);
    }
    setDeletingRoomTarget(null);
    setSelectedRoomForDragId(null);
    setSelectedRoomIds([]);
  };

  const handleQuickAddFloorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickFloorNameInput.trim()) return;

    const defaultImage = activeFloor?.imageUrl || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80';

    onAddFloorPlan({
      floorName: quickFloorNameInput.trim(),
      imageUrl: defaultImage,
      uploadedAt: new Date().toISOString().split('T')[0],
    });

    setQuickFloorNameInput('');
    setShowQuickAddFloorModal(false);
    alert(`Đã tạo thêm mặt bằng tầng "${quickFloorNameInput.trim()}" thành công!`);
  };

  // Calculate Progress Summary for the current floor rooms
  const roomSummary = React.useMemo(() => {
    const total = floorRooms.length;
    const frameDone = floorRooms.filter((r) => r.frameStatus === 'Đã hoàn thành').length;
    const boardDone = floorRooms.filter((r) => r.boardStatus === 'Đã hoàn thành').length;
    const frameInspectPassed = floorRooms.filter((r) => r.frameInspectionStatus === 'Đạt nghiệm thu').length;
    const boardInspectPassed = floorRooms.filter((r) => r.boardInspectionStatus === 'Đạt nghiệm thu').length;
    const inspectedPassed = floorRooms.filter((r) => r.inspectionStatus === 'Đạt nghiệm thu').length;

    const framePercent = total > 0 ? Math.round((frameDone / total) * 100) : 0;
    const boardPercent = total > 0 ? Math.round((boardDone / total) * 100) : 0;
    const frameInspectPercent = total > 0 ? Math.round((frameInspectPassed / total) * 100) : 0;
    const boardInspectPercent = total > 0 ? Math.round((boardInspectPassed / total) * 100) : 0;
    const inspectPercent = total > 0 ? Math.round((inspectedPassed / total) * 100) : 0;

    return { 
      total, 
      frameDone, 
      boardDone, 
      frameInspectPassed, 
      boardInspectPassed, 
      inspectedPassed, 
      framePercent, 
      boardPercent, 
      frameInspectPercent, 
      boardInspectPercent, 
      inspectPercent 
    };
  }, [floorRooms]);

  // Handle PDF File Upload & convert to floor plan image with sample highlights
  const handlePdfFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsConvertingPdf(true);
      let planUrl = '';
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        planUrl = await convertPdfToImage(file);
      } else {
        planUrl = await readFileAsDataUrl(file);
      }

      const floorNameClean = file.name.replace(/\.[^/.]+$/, '');
      const newFloorId = `fp-pdf-${Date.now()}`;

      // Create Floor Plan
      onAddFloorPlan({
        id: newFloorId,
        floorName: `Mặt Bằng PDF - ${floorNameClean}`,
        imageUrl: planUrl,
        uploadedAt: new Date().toISOString().split('T')[0],
      });

      // Auto-create 4 sample highlight rooms for this PDF so the user can immediately edit them
      const samplePdfRooms: Array<Omit<RoomProgressItem, 'id' | 'updatedAt'>> = [
        {
          floorId: newFloorId,
          roomName: 'Căn P101 (Phòng Khách)',
          x: 12,
          y: 15,
          width: 35,
          height: 32,
          frameStatus: 'Đã hoàn thành',
          boardStatus: 'Đang làm',
          inspectionStatus: 'Chưa nghiệm thu',
          inspectorName: 'KS. Nguyễn Văn Bình',
          notes: 'Mẫu nhập từ tệp PDF',
        },
        {
          floorId: newFloorId,
          roomName: 'Căn P102 (Phòng Ngủ 1)',
          x: 52,
          y: 15,
          width: 36,
          height: 32,
          frameStatus: 'Đã hoàn thành',
          boardStatus: 'Đã hoàn thành',
          inspectionStatus: 'Đạt nghiệm thu',
          inspectorName: 'KS. Nguyễn Văn Bình',
          notes: 'Mẫu nhập từ tệp PDF',
        },
        {
          floorId: newFloorId,
          roomName: 'Căn P103 (Phòng Ngủ 2)',
          x: 12,
          y: 52,
          width: 35,
          height: 35,
          frameStatus: 'Đang làm',
          boardStatus: 'Chưa làm',
          inspectionStatus: 'Chưa nghiệm thu',
          inspectorName: 'KS. Nguyễn Văn Bình',
          notes: 'Mẫu nhập từ tệp PDF',
        },
        {
          floorId: newFloorId,
          roomName: 'Căn P104 (Bếp & WC)',
          x: 52,
          y: 52,
          width: 36,
          height: 35,
          frameStatus: 'Đã hoàn thành',
          boardStatus: 'Đã hoàn thành',
          inspectionStatus: 'Chưa đạt (Cần sửa)',
          inspectorName: 'KS. Nguyễn Văn Bình',
          notes: 'Vít chưa đủ khoảng cách',
        },
      ];

      samplePdfRooms.forEach((r) => onSaveRoomProgress(r));
      setSelectedFloorId(newFloorId);
      alert(`🎉 Đã nạp thành công PDF "${file.name}"! Đã tạo sẵn 4 vùng highlight mẫu để bạn tùy chỉnh.`);
    } catch (err) {
      console.error('PDF upload error:', err);
      alert('Không thể đọc tệp PDF! Vui lòng chọn tệp PDF hoặc ảnh hợp lệ.');
    } finally {
      setIsConvertingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  // Handle PDF/Image file upload to update an existing floor plan drawing
  const handleUpdatePlanFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !updatingFloorPlanId) return;

    try {
      setIsConvertingPdf(true);
      let planUrl = '';
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        planUrl = await convertPdfToImage(file);
      } else {
        planUrl = await readFileAsDataUrl(file);
      }

      if (onUpdateFloorPlanImage) {
        onUpdateFloorPlanImage(updatingFloorPlanId, planUrl);
        alert(`🎉 Đã cập nhật thành công bản vẽ mới cho tầng!`);
      }
    } catch (err) {
      console.error('Update floor plan drawing error:', err);
      alert('Không thể đọc tệp bản vẽ mới! Vui lòng chọn tệp PDF hoặc ảnh hợp lệ.');
    } finally {
      setIsConvertingPdf(false);
      setUpdatingFloorPlanId(null);
      if (updatePlanInputRef.current) updatePlanInputRef.current.value = '';
    }
  };

  // Start dragging a room highlight (move position or resize handle)
  const handleStartDrag = (
    e: React.PointerEvent,
    room: RoomProgressItem,
    handle: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | number
  ) => {
    e.stopPropagation();
    if (!imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const { x: mouseX, y: mouseY } = getMappedCoordinates(e, imageContainerRef.current, rotation);

    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

    const isSelected = selectedRoomIds.includes(room.id);
    let roomsToDrag = [room];
    if (isSelected && handle === 'move') {
      roomsToDrag = floorRooms.filter(r => selectedRoomIds.includes(r.id));
    }
    
    // If we click the move icon but the room isn't in selectedRoomIds, maybe select it?
    if (!isSelected) {
      setSelectedRoomIds([room.id]);
    }

    setSelectedRoomForDragId(room.id);
    setActiveDragHandle(handle);
    setDraggingRoomsPreview(null);
    draggingRoomsPreviewRef.current = null;
    setDragStartInfo({ 
      mouseX, 
      mouseY, 
      room: JSON.parse(JSON.stringify(room)),
      rooms: JSON.parse(JSON.stringify(roomsToDrag))
    });
  };

  // Pointer Down on Floor Plan (Freehand start or Polygon or 2-Point)
  const handlePointerDownImage = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.add(e.pointerId);
    
    if (activePointersRef.current.size > 1) {
      // It's a multi-touch/pinch, so cancel any drawing we just started
      setIsFreehandDrawing(false);
      setFreehandPoints([]);
      if (is2PointDragging) setIs2PointDragging(false);
      return;
    }

    if (activeDragHandle !== null) return;
    if (!imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const { x: rawX, y: rawY } = getMappedCoordinates(e, imageContainerRef.current, rotation);
    const x = Math.min(100, Math.max(0, Math.round(rawX * 10) / 10));
    const y = Math.min(100, Math.max(0, Math.round(rawY * 10) / 10));

    if (drawTool === 'freehand') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      setIsFreehandDrawing(true);
      setFreehandPoints([{ x, y }]);
    } else if (drawTool === '2point') {
      if (drawStartPos === null) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {}
        setIs2PointDragging(true);
        setDrawStartPos({ x, y });
        setDrawHoverPos({ x, y });
        justSetStartPosRef.current = true;
      }
    }
  };

  // Pointer Move on Floor Plan (Freehand tracking, Drag-and-Resize, or Hover)
  const handlePointerMoveImage = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointersRef.current.size > 1) return; // Ignore move if multi-touch

    if (!imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const { x: rawX, y: rawY } = getMappedCoordinates(e, imageContainerRef.current, rotation);
    const x = Math.min(100, Math.max(0, Math.round(rawX * 10) / 10));
    const y = Math.min(100, Math.max(0, Math.round(rawY * 10) / 10));

    lastPointerMapPosRef.current = { x, y };
    setDrawHoverPos({ x, y });

    // Handle Active Drag-and-Resize on Highlight Region
    if (activeDragHandle !== null && dragStartInfo) {
      const dx = x - dragStartInfo.mouseX;
      const dy = y - dragStartInfo.mouseY;
      const initRoom = dragStartInfo.room;

      let newX = initRoom.x;
      let newY = initRoom.y;
      let newW = initRoom.width || 20;
      let newH = initRoom.height || 15;
      let newPoints = initRoom.points ? [...initRoom.points] : undefined;

      if (activeDragHandle === 'move' && dragStartInfo.rooms && dragStartInfo.rooms.length > 0) {
        const previewMap: Record<string, RoomProgressItem> = {};
        dragStartInfo.rooms.forEach(roomToMove => {
          const roomW = roomToMove.width || 20;
          const roomH = roomToMove.height || 15;
          let newX = Math.min(100 - roomW, Math.max(0, Math.round((roomToMove.x + dx) * 10) / 10));
          let newY = Math.min(100 - roomH, Math.max(0, Math.round((roomToMove.y + dy) * 10) / 10));
          let newPoints = roomToMove.points ? [...roomToMove.points] : undefined;

          if (newPoints && roomToMove.points) {
            const pdx = newX - roomToMove.x;
            const pdy = newY - roomToMove.y;
            newPoints = roomToMove.points.map((p) => ({
              x: Math.min(100, Math.max(0, Math.round((p.x + pdx) * 10) / 10)),
              y: Math.min(100, Math.max(0, Math.round((p.y + pdy) * 10) / 10)),
            }));
          }

          previewMap[roomToMove.id] = {
            ...roomToMove,
            x: newX,
            y: newY,
            width: roomW,
            height: roomH,
            points: newPoints,
          };
        });
        setDraggingRoomsPreview(previewMap);
        draggingRoomsPreviewRef.current = previewMap;
        return;
      } else if (typeof activeDragHandle === 'number' && newPoints) {
        // Drag individual polygon point
        newPoints[activeDragHandle] = { x, y };

        // Recalculate bounding box
        let minX = 100, minY = 100, maxX = 0, maxY = 0;
        newPoints.forEach((p) => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });
        newX = Math.round(minX * 10) / 10;
        newY = Math.round(minY * 10) / 10;
        newW = Math.max(2, Math.round((maxX - minX) * 10) / 10);
        newH = Math.max(2, Math.round((maxY - minY) * 10) / 10);
      } else {
        // Handle corner and side resize
        if (activeDragHandle === 'nw') {
          const calcX = Math.min(initRoom.x + initRoom.width - 2, Math.max(0, initRoom.x + dx));
          const calcY = Math.min(initRoom.y + initRoom.height - 2, Math.max(0, initRoom.y + dy));
          newW = Math.round((initRoom.x + initRoom.width - calcX) * 10) / 10;
          newH = Math.round((initRoom.y + initRoom.height - calcY) * 10) / 10;
          newX = Math.round(calcX * 10) / 10;
          newY = Math.round(calcY * 10) / 10;
        } else if (activeDragHandle === 'ne') {
          const calcY = Math.min(initRoom.y + initRoom.height - 2, Math.max(0, initRoom.y + dy));
          newW = Math.max(2, Math.min(100 - initRoom.x, Math.round((initRoom.width + dx) * 10) / 10));
          newH = Math.round((initRoom.y + initRoom.height - calcY) * 10) / 10;
          newY = Math.round(calcY * 10) / 10;
        } else if (activeDragHandle === 'sw') {
          const calcX = Math.min(initRoom.x + initRoom.width - 2, Math.max(0, initRoom.x + dx));
          newW = Math.round((initRoom.x + initRoom.width - calcX) * 10) / 10;
          newH = Math.max(2, Math.min(100 - initRoom.y, Math.round((initRoom.height + dy) * 10) / 10));
          newX = Math.round(calcX * 10) / 10;
        } else if (activeDragHandle === 'se') {
          newW = Math.max(2, Math.min(100 - initRoom.x, Math.round((initRoom.width + dx) * 10) / 10));
          newH = Math.max(2, Math.min(100 - initRoom.y, Math.round((initRoom.height + dy) * 10) / 10));
        } else if (activeDragHandle === 'n') {
          const calcY = Math.min(initRoom.y + initRoom.height - 2, Math.max(0, initRoom.y + dy));
          newH = Math.round((initRoom.y + initRoom.height - calcY) * 10) / 10;
          newY = Math.round(calcY * 10) / 10;
        } else if (activeDragHandle === 's') {
          newH = Math.max(2, Math.min(100 - initRoom.y, Math.round((initRoom.height + dy) * 10) / 10));
        } else if (activeDragHandle === 'w') {
          const calcX = Math.min(initRoom.x + initRoom.width - 2, Math.max(0, initRoom.x + dx));
          newW = Math.round((initRoom.x + initRoom.width - calcX) * 10) / 10;
          newX = Math.round(calcX * 10) / 10;
        } else if (activeDragHandle === 'e') {
          newW = Math.max(2, Math.min(100 - initRoom.x, Math.round((initRoom.width + dx) * 10) / 10));
        }
      }

      const previewMap: Record<string, RoomProgressItem> = {
        [initRoom.id]: {
          ...initRoom,
          x: newX,
          y: newY,
          width: newW,
          height: newH,
          points: newPoints,
        }
      };
      setDraggingRoomsPreview(previewMap);
      draggingRoomsPreviewRef.current = previewMap;
      return;
    }

    if (isFreehandDrawing) {
      setFreehandPoints((prev) => {
        if (prev.length === 0) return [{ x, y }];
        const last = prev[prev.length - 1];
        const dx = x - last.x;
        const dy = y - last.y;
        if (dx * dx + dy * dy >= 0.12) {
          return [...prev, { x, y }];
        }
        return prev;
      });
    }
  };

  // Pointer Up on Floor Plan (Complete Freehand drawing or 2-Point drag or finish active drag)
  const handlePointerUpImage = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);

    if (activeDragHandle !== null) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}

      const previewToCommit = draggingRoomsPreviewRef.current;
      if (previewToCommit) {
        const modifiedRooms = Object.values(previewToCommit);
        if (modifiedRooms.length > 0) {
          if (onBatchSaveRooms && modifiedRooms.length > 1) {
            onBatchSaveRooms(modifiedRooms);
          } else {
            modifiedRooms.forEach((r) => onSaveRoomProgress(r));
          }
        }
      }

      setActiveDragHandle(null);
      setDragStartInfo(null);
      setDraggingRoomsPreview(null);
      draggingRoomsPreviewRef.current = null;
      return;
    }

    if (is2PointDragging && drawStartPos) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      setIs2PointDragging(false);

      const x1 = drawStartPos.x;
      const y1 = drawStartPos.y;
      const x2 = drawHoverPos ? drawHoverPos.x : x1;
      const y2 = drawHoverPos ? drawHoverPos.y : y1;

      const dist = Math.hypot(x2 - x1, y2 - y1);
      if (dist >= 2) {
        const finalX = Math.min(x1, x2);
        const finalY = Math.min(y1, y2);
        const finalW = Math.max(3, Math.abs(x2 - x1));
        const finalH = Math.max(3, Math.abs(y2 - y1));

        if (redrawingRoomTarget) {
          onSaveRoomProgress({
            ...redrawingRoomTarget,
            x: finalX,
            y: finalY,
            width: finalW,
            height: finalH,
            points: undefined,
          });
          setRedrawingRoomTarget(null);
          setDrawStartPos(null);
          setDrawHoverPos(null);
        } else {
          setPendingDraftHighlight({
            rect: { x: finalX, y: finalY, width: finalW, height: finalH },
          });
          setDrawStartPos(null);
          setDrawHoverPos(null);
        }
      }
      return;
    }

    if (isFreehandDrawing) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
      setIsFreehandDrawing(false);
      if (freehandPoints.length >= 3) {
        let minX = 100, minY = 100, maxX = 0, maxY = 0;
        freehandPoints.forEach((p) => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });
        const w = Math.max(4, maxX - minX);
        const h = Math.max(4, maxY - minY);

        if (redrawingRoomTarget) {
          onSaveRoomProgress({
            ...redrawingRoomTarget,
            x: minX,
            y: minY,
            width: w,
            height: h,
            points: [...freehandPoints],
            isPolyline: false,
          });
          setRedrawingRoomTarget(null);
          setDrawTool('none');
        } else {
          // Preview highlight on map FIRST before opening modal
          setPendingDraftHighlight({
            rect: { x: minX, y: minY, width: w, height: h },
            points: [...freehandPoints],
          });
        }
      }
      setFreehandPoints([]);
    }
  };

  // Finish Polygon / Line Drawing (2 or more points) and show preview highlight BEFORE modal
  const handleCompletePolygon = (asPolylineMode?: boolean) => {
    if (polygonPoints.length < 2) return;
    let finalPoints = [...polygonPoints];
    let isPolyline = !!asPolylineMode;

    if (polygonPoints.length === 2 && !asPolylineMode) {
      const p1 = polygonPoints[0];
      const p2 = polygonPoints[1];
      const minX = Math.min(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const w = Math.max(3, Math.abs(p2.x - p1.x));
      const h = Math.max(3, Math.abs(p2.y - p1.y));
      finalPoints = [
        { x: minX, y: minY },
        { x: minX + w, y: minY },
        { x: minX + w, y: minY + h },
        { x: minX, y: minY + h },
      ];
      isPolyline = false;
    }

    let minX = 100, minY = 100, maxX = 0, maxY = 0;
    finalPoints.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    const w = Math.max(3, maxX - minX);
    const h = Math.max(3, maxY - minY);

    if (redrawingRoomTarget) {
      onSaveRoomProgress({
        ...redrawingRoomTarget,
        x: minX,
        y: minY,
        width: w,
        height: h,
        points: finalPoints,
        isPolyline,
      });
      setRedrawingRoomTarget(null);
      setDrawTool('none');
    } else {
      // Preview highlight on map FIRST before opening modal
      setPendingDraftHighlight({
        rect: { x: minX, y: minY, width: w, height: h },
        points: finalPoints,
        isPolyline,
      });
    }

    setPolygonPoints([]);
  };

  const openDefectModalForPin = (x: number, y: number) => {
    setPinPos({ x, y });
    const { roomAtPosTeam, currentFloorTeams, declaredTeamNames } = getCandidateTeamsForDefect(
      { x, y },
      floorRooms,
      roomProgressList,
      teams
    );
    if (roomAtPosTeam) {
      setAssignedTo(roomAtPosTeam);
    } else if (currentFloorTeams.length > 0) {
      setAssignedTo(currentFloorTeams[0]);
    } else if (declaredTeamNames.length > 0) {
      setAssignedTo(declaredTeamNames[0]);
    } else {
      setAssignedTo('Đội thi công');
    }
    setShowDefectModal(true);
  };

  // Handle tap on plan image based on current active viewMode & drawTool
  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const { x: rawX, y: rawY } = getMappedCoordinates(e, imageContainerRef.current, rotation);
    const x = Math.min(100, Math.max(0, Math.round(rawX * 10) / 10));
    const y = Math.min(100, Math.max(0, Math.round(rawY * 10) / 10));

    lastPointerMapPosRef.current = { x, y };

    // Defect Mode: Always place a defect pin directly without room highlight drawing
    if (viewMode === 'defect') {
      openDefectModalForPin(x, y);
      return;
    }

    // Polygon Point-by-Point Mode (2 or more points)
    if (drawTool === 'polygon') {
      setPolygonPoints((prev) => [...prev, { x, y }]);
      setDrawHoverPos({ x, y });
      return;
    }

    // If Point 1 of 2-point draw is active, click 2 completes the rectangle & updates room or shows PREVIEW
    if (drawStartPos && drawTool === '2point') {
      if (justSetStartPosRef.current) {
        justSetStartPosRef.current = false;
        return;
      }

      const x1 = drawStartPos.x;
      const y1 = drawStartPos.y;
      const x2 = x;
      const y2 = y;

      const finalX = Math.min(x1, x2);
      const finalY = Math.min(y1, y2);
      let finalW = Math.abs(x2 - x1);
      let finalH = Math.abs(y2 - y1);

      if (finalW < 2) finalW = 20;
      if (finalH < 2) finalH = 15;

      if (redrawingRoomTarget) {
        onSaveRoomProgress({
          ...redrawingRoomTarget,
          x: finalX,
          y: finalY,
          width: finalW,
          height: finalH,
          points: undefined,
        });
        setRedrawingRoomTarget(null);
        setDrawStartPos(null);
        setDrawHoverPos(null);
      } else {
        // Preview highlight on map FIRST before opening modal
        setPendingDraftHighlight({
          rect: { x: finalX, y: finalY, width: finalW, height: finalH },
        });
        setDrawStartPos(null);
        setDrawHoverPos(null);
      }
      return;
    }

    if (drawTool === '2point') {
      setDrawStartPos({ x, y });
      setDrawHoverPos({ x, y });
      return;
    }

    if (drawTool === 'freehand') {
      // Freehand drawing is handled by drag pointer events
      return;
    }

    if (drawTool === 'none') {
      if (viewMode === 'all') {
        setClickChoicePos({ x, y });
      } else {
        setClickChoicePos(null);
      }
      setSelectedRoomForDragId(null);
      setSelectedRoomIds([]);
      setTouchMenu(null);
      setHoveredRoomId(null);
      return;
    }
  };

  // Quick action to cycle Frame Status
  const handleCycleFrame = (e: React.MouseEvent, room: RoomProgressItem) => {
    e.stopPropagation();
    const nextStatus = room.frameStatus === 'Chưa làm' ? 'Đang làm' : room.frameStatus === 'Đang làm' ? 'Đã hoàn thành' : 'Chưa làm';
    onSaveRoomProgress({
      ...room,
      frameStatus: nextStatus,
    });
  };

  // Quick action to cycle Board Status
  const handleCycleBoard = (e: React.MouseEvent, room: RoomProgressItem) => {
    e.stopPropagation();
    const nextStatus = room.boardStatus === 'Chưa làm' ? 'Đang làm' : room.boardStatus === 'Đang làm' ? 'Đã hoàn thành' : 'Chưa làm';
    onSaveRoomProgress({
      ...room,
      boardStatus: nextStatus,
    });
  };

  // Quick action to cycle Frame Inspection Status
  const handleCycleFrameInspection = (e: React.MouseEvent, room: RoomProgressItem) => {
    e.stopPropagation();
    const current = room.frameInspectionStatus || 'Chưa nghiệm thu';
    const nextStatus = current === 'Chưa nghiệm thu' ? 'Đạt nghiệm thu' : current === 'Đạt nghiệm thu' ? 'Chưa đạt (Cần sửa)' : 'Chưa nghiệm thu';
    
    // Auto sync overall inspection
    const boardInsp = room.boardInspectionStatus || 'Chưa nghiệm thu';
    let overall = room.inspectionStatus;
    if (nextStatus === 'Đạt nghiệm thu' && boardInsp === 'Đạt nghiệm thu') {
      overall = 'Đạt nghiệm thu';
    } else if (nextStatus === 'Chưa đạt (Cần sửa)' || boardInsp === 'Chưa đạt (Cần sửa)') {
      overall = 'Chưa đạt (Cần sửa)';
    }

    onSaveRoomProgress({
      ...room,
      frameInspectionStatus: nextStatus,
      inspectionStatus: overall,
    });
  };

  // Quick action to cycle Board Inspection Status
  const handleCycleBoardInspection = (e: React.MouseEvent, room: RoomProgressItem) => {
    e.stopPropagation();
    const current = room.boardInspectionStatus || 'Chưa nghiệm thu';
    const nextStatus = current === 'Chưa nghiệm thu' ? 'Đạt nghiệm thu' : current === 'Đạt nghiệm thu' ? 'Chưa đạt (Cần sửa)' : 'Chưa nghiệm thu';
    
    // Auto sync overall inspection
    const frameInsp = room.frameInspectionStatus || 'Chưa nghiệm thu';
    let overall = room.inspectionStatus;
    if (frameInsp === 'Đạt nghiệm thu' && nextStatus === 'Đạt nghiệm thu') {
      overall = 'Đạt nghiệm thu';
    } else if (frameInsp === 'Chưa đạt (Cần sửa)' || nextStatus === 'Chưa đạt (Cần sửa)') {
      overall = 'Chưa đạt (Cần sửa)';
    }

    onSaveRoomProgress({
      ...room,
      boardInspectionStatus: nextStatus,
      inspectionStatus: overall,
    });
  };

  // Quick action to cycle Overall Inspection Status
  const handleCycleInspection = (e: React.MouseEvent, room: RoomProgressItem) => {
    e.stopPropagation();
    const nextStatus = room.inspectionStatus === 'Chưa nghiệm thu' ? 'Đạt nghiệm thu' : room.inspectionStatus === 'Đạt nghiệm thu' ? 'Chưa đạt (Cần sửa)' : 'Chưa nghiệm thu';
    onSaveRoomProgress({
      ...room,
      inspectionStatus: nextStatus,
    });
  };

  // Upload new floor plan image file to Drive
  const handlePlanFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !newFloorName.trim()) return;

    try {
      setIsUploadingPlan(true);
      let planUrl = await readFileAsDataUrl(file);

      if (hasApiBackend()) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('fileName', `MB_${newFloorName}_${Date.now()}.png`);

        const res = await apiFetch('/api/drive/upload-image', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();
        if (data.url) planUrl = data.url;
      }

      onAddFloorPlan({
        floorName: newFloorName.trim(),
        imageUrl: planUrl,
        uploadedAt: new Date().toISOString().split('T')[0],
      });

      setShowAddFloorModal(false);
      setNewFloorName('');
      alert(`Đã tải lên mặt bằng ${newFloorName} thành công!`);
    } catch (err) {
      alert('Không thể đọc tệp mặt bằng!');
    } finally {
      setIsUploadingPlan(false);
    }
  };

  // Select Defect Photo
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploadingPhoto(true);
      const url = await readDefectPhotoAsDataUrl(file);
      if (!url) {
        alert('Không thể đọc ảnh');
        return;
      }
      setPhotoUrl(url);
      setEditingPhotoUrl(url);
    } catch (err) {
      console.error(err);
      alert('Không thể đọc ảnh');
    } finally {
      setIsUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const handleSaveEditedPhoto = async (editedFile: File) => {
    setIsImageEditorOpen(false);
    setEditingPhotoUrl(null);
    try {
      setIsUploadingPhoto(true);
      let photoResultUrl = await readDefectPhotoAsDataUrl(editedFile);

      if (hasApiBackend()) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const formData = new FormData();
        formData.append('file', editedFile);
        formData.append('fileName', `Defect_Photo_Edited_${Date.now()}.jpg`);

        const res = await apiFetch('/api/drive/upload-image', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await res.json();
        if (data.url) photoResultUrl = data.url;
      }

      setPhotoUrl(photoResultUrl);
    } catch (err) {
      console.error('Failed to handle photo:', err);
      alert('Không thể tải ảnh');
    } finally {
      setIsUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const handleAfterPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>, forModal: boolean = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploadingPhoto(true);
      let photoResultUrl = await readDefectPhotoAsDataUrl(file);

      if (hasApiBackend()) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('fileName', `Defect_After_Photo_${Date.now()}.jpg`);

        const res = await apiFetch('/api/drive/upload-image', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await res.json();
        if (data.url) photoResultUrl = data.url;
      }

      if (forModal && activeDefectDetail) {
        const updated = { ...activeDefectDetail, afterImageUrl: photoResultUrl };
        setActiveDefectDetail(updated);
        if (onUpdateDefect) {
          onUpdateDefect(updated);
        } else {
          onUpdateDefectStatus(updated.id, updated.status);
        }
      } else {
        setAfterPhotoUrl(photoResultUrl);
      }
    } catch (err) {
      console.error('Failed to handle after photo:', err);
      alert('Không thể tải ảnh sau sửa');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleModalBeforePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeDefectDetail) return;

    try {
      setIsUploadingPhoto(true);
      let photoResultUrl = await readDefectPhotoAsDataUrl(file);

      if (hasApiBackend()) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('fileName', `Defect_Before_Photo_${Date.now()}.jpg`);

        const res = await apiFetch('/api/drive/upload-image', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await res.json();
        if (data.url) photoResultUrl = data.url;
      }

      const updated = { ...activeDefectDetail, imageUrl: photoResultUrl };
      setActiveDefectDetail(updated);
      if (onUpdateDefect) {
        onUpdateDefect(updated);
      }
    } catch (err) {
      console.error('Failed to handle before photo:', err);
      alert('Không thể tải ảnh trước sửa');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleClearModalBeforePhoto = () => {
    if (!activeDefectDetail) return;
    const updated = { ...activeDefectDetail, imageUrl: undefined };
    setActiveDefectDetail(updated);
    if (onUpdateDefect) {
      onUpdateDefect(updated);
    }
  };

  const handleClearModalAfterPhoto = () => {
    if (!activeDefectDetail) return;
    const updated = { ...activeDefectDetail, afterImageUrl: undefined };
    setActiveDefectDetail(updated);
    if (onUpdateDefect) {
      onUpdateDefect(updated);
    } else {
      onUpdateDefectStatus(updated.id, updated.status);
    }
  };

  const handleCreateDefect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinPos || !activeFloor) return;

    const isPointInRoom = (px: number, py: number, r: any) => {
      if (r.points && r.points.length >= 3) {
        let inside = false;
        for (let i = 0, j = r.points.length - 1; i < r.points.length; j = i++) {
          const xi = r.points[i].x, yi = r.points[i].y;
          const xj = r.points[j].x, yj = r.points[j].y;
          const intersect = ((yi > py) !== (yj > py))
              && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      }
      const rx = r.x;
      const ry = r.y;
      const rw = r.width || 0;
      const rh = r.height || 0;
      return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
    };
    const matchedRoom = floorRooms.find(r => isPointInRoom(pinPos.x, pinPos.y, r));

    const matchingTeam = teams.find(t => t.name.trim().toLowerCase() === assignedTo.trim().toLowerCase());
    const finalTeamId = matchingTeam?.id || undefined;

    onAddDefect({
      id: draftDefectId,
      floorId: activeFloor.id,
      floorName: activeFloor.floorName,
      roomId: matchedRoom?.id || undefined,
      teamId: finalTeamId,
      category,
      x: pinPos.x,
      y: pinPos.y,
      description: description.trim() || `Lỗi ${category} tại vị trí (${pinPos.x}%, ${pinPos.y}%)`,
      severity,
      assignedTo: assignedTo.trim() || 'Đội thi công',
      createdBy: createdBy.trim() || inspectorName || 'Kỹ sư QC',
      dueDate: dueDate || undefined,
      imageUrl: photoUrl || undefined,
      afterImageUrl: afterPhotoUrl || undefined,
      status: 'Mới phát hiện',
    });

    const nextDraftId = `defect_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    localStorage.setItem(getDraftKey('construction_defect_draft_id'), nextDraftId);
    setDraftDefectId(nextDraftId);

    setShowDefectModal(false);
    setPinPos(null);
    setDescription('');
    setPhotoUrl('');
    setAfterPhotoUrl('');

    // Clear draft storage
    localStorage.removeItem(getDraftKey('construction_defect_draft_pinPos'));
    localStorage.setItem(getDraftKey('construction_defect_draft_showDefectModal'), 'false');
    localStorage.removeItem(getDraftKey('construction_defect_draft_category'));
    localStorage.removeItem(getDraftKey('construction_defect_draft_description'));
    localStorage.removeItem(getDraftKey('construction_defect_draft_severity'));
    localStorage.removeItem(getDraftKey('construction_defect_draft_assignedTo'));
    localStorage.removeItem(getDraftKey('construction_defect_draft_dueDate'));
    localStorage.removeItem(getDraftKey('construction_defect_draft_photoUrl'));

    alert('Đã định vị và lưu Defect thành công!');
  };

  const isRotated = rotation === 90 || rotation === 270;
  const availW = isRotated ? parentSize.h : parentSize.w;
  const availH = isRotated ? parentSize.w : parentSize.h;
  
  // High-reliability dimension calculations:
  // If parent size is not yet measured (0), use the default layout height (400px) and scale width using imgAspect to completely avoid distortion.
  let targetW = 400;
  let targetH = 400;
  
  if (imgAspect) {
    if (availW > 10 && availH > 10) {
      if (availW / availH > imgAspect) {
        targetH = availH;
        targetW = availH * imgAspect;
      } else {
        targetW = availW;
        targetH = availW / imgAspect;
      }
    } else {
      targetH = 400;
      targetW = 400 * imgAspect;
    }
  } else {
    targetW = availW || 400;
    targetH = availH || 400;
  }

  targetW *= zoomScale;
  targetH *= zoomScale;

  const containerW = isRotated ? targetH : targetW;
  const containerH = isRotated ? targetW : targetH;

  let transformStr = '';
  if (rotation === 90) {
     transformStr = `translate(${containerW}px, 0) rotate(90deg)`;
  } else if (rotation === 180) {
     transformStr = `translate(${containerW}px, ${containerH}px) rotate(180deg)`;
  } else if (rotation === 270) {
     transformStr = `translate(0, ${containerH}px) rotate(270deg)`;
  }

  return (
    <div className="p-4 space-y-4 pb-24 w-full max-w-6xl mx-auto">
      {/* Title Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-600" />
            {t('floorplan_title')}
          </h2>
          <p className="text-xs text-slate-500 font-medium">
            Đang xem: <span className="font-extrabold text-indigo-600">{activeFloor?.floorName}</span> ({floorPlans.length} tầng)
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => setShowManageFloorsModal(true)}
            className="flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-2.5 py-2 rounded-xl text-xs font-bold active:scale-95 transition-all shadow-xs"
            title="Quản lý, đổi tên, sao chép hoặc xóa các tầng"
          >
            <Settings className="w-3.5 h-3.5" />
            Tùy Chỉnh Tầng
          </button>
          <input
            type="file"
            ref={pdfInputRef}
            accept=".pdf,image/*"
            className="hidden"
            onChange={handlePdfFileUpload}
          />
          <input
            type="file"
            ref={updatePlanInputRef}
            accept=".pdf,image/*"
            className="hidden"
            onChange={handleUpdatePlanFileChange}
          />
        </div>
      </div>

      {/* Orphaned Hidden Rooms Warning & Action */}
      {orphanedRooms.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 text-rose-900 p-3.5 rounded-2xl space-y-2.5 shadow-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5 animate-pulse" />
            <div className="text-xs space-y-0.5">
              <span className="font-extrabold block text-rose-800">⚠️ Phát hiện {orphanedRooms.length} mặt bằng phòng ẩn!</span>
              <p className="text-rose-700 leading-relaxed font-medium">
                Các phòng này bị mất liên kết (không thuộc về bất kỳ tầng hiện tại nào) do thay đổi tầng hoặc dữ liệu cũ.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDeleteAllOrphanedRooms}
            className="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-xl text-[11px] shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" /> XÓA SẠCH {orphanedRooms.length} PHÒNG ẨN NGAY
          </button>
        </div>
      )}

      {/* PDF Loading Banner */}
      {isConvertingPdf && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded-2xl flex items-center gap-3 animate-pulse shadow-sm">
          <div className="w-5 h-5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin shrink-0" />
          <div className="text-xs">
            <span className="font-bold block">🔄 Đang nạp &amp; chuyển đổi tệp PDF mặt bằng...</span>
            <span className="text-[11px] text-amber-700">Tự động tạo ảnh sắc nét và trích xuất các vùng highlight mẫu...</span>
          </div>
        </div>
      )}

      {/* Floor Plan Selector Chips & Quick Customization Toolbar */}
      <div className="bg-slate-100/90 p-2.5 rounded-2xl border border-slate-200/80 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] font-extrabold text-slate-600 px-1 border-b border-slate-200/50 pb-1.5">
          <span className="flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-indigo-600" /> DANH SÁCH TẦNG DỰ ÁN:
          </span>
          <div className="flex items-center gap-2">
            {!isSelectingMultipleFloors ? (
              <button
                type="button"
                onClick={() => setIsSelectingMultipleFloors(true)}
                className="text-indigo-600 hover:text-indigo-800 transition font-bold"
              >
                Chọn nhiều để xóa
              </button>
            ) : (
              <div className="flex items-center gap-2.5 flex-wrap">
                <label className="flex items-center gap-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={floorPlans.length > 0 && floorPlans.every(fp => selectedFloorIdsForBulk.includes(fp.id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFloorIdsForBulk(floorPlans.map(fp => fp.id));
                      } else {
                        setSelectedFloorIdsForBulk([]);
                      }
                    }}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span>Chọn tất cả</span>
                </label>

                {selectedFloorIdsForBulk.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (floorPlans.length - selectedFloorIdsForBulk.length < 1) {
                        alert('Không thể xóa toàn bộ mặt bằng! Dự án cần duy trì ít nhất 1 mặt bằng tầng.');
                        return;
                      }
                      if (await confirmAsync(`Bạn có chắc muốn xóa ${selectedFloorIdsForBulk.length} tầng đã chọn? Tất cả phòng và defect thuộc các tầng này sẽ bị xóa.`)) {
                        if (onDeleteMultipleFloorPlans) {
                          onDeleteMultipleFloorPlans(selectedFloorIdsForBulk);
                        } else if (onDeleteFloorPlan) {
                          selectedFloorIdsForBulk.forEach(id => onDeleteFloorPlan(id));
                        }
                        setSelectedFloorIdsForBulk([]);
                        setIsSelectingMultipleFloors(false);
                      }
                    }}
                    className="text-rose-600 hover:text-rose-800 transition font-extrabold"
                  >
                    Xóa đã chọn ({selectedFloorIdsForBulk.length})
                  </button>
                )}

                <button
                  type="button"
                  onClick={async () => {
                    setIsSelectingMultipleFloors(false);
                    setSelectedFloorIdsForBulk([]);
                  }}
                  className="text-slate-400 hover:text-slate-600 transition font-bold"
                >
                  Hủy
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 text-xs no-scrollbar">
          {sortedFloorPlans.map((fp, index) => {
            const isSelected = selectedFloorId === fp.id || (!selectedFloorId && fp.id === activeFloor?.id);
            const defectCount = defects.filter((d) => d.floorId === fp.id && d.status !== 'Đã nghiệm thu').length;
            const roomCount = roomProgressList.filter((r) => r.floorId === fp.id).length;
            const isEditingInline = inlineEditingFloorId === fp.id;

            return (
              <div
                key={fp.id}
                onClick={async () => {
                  if (isSelectingMultipleFloors) {
                    setSelectedFloorIdsForBulk(prev => {
                      if (prev.includes(fp.id)) {
                        return prev.filter(id => id !== fp.id);
                      } else {
                        return [...prev, fp.id];
                      }
                    });
                  } else {
                    setSelectedFloorId(fp.id);
                  }
                }}
                className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 cursor-pointer group select-none ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-300'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {isSelectingMultipleFloors ? (
                  <input
                    type="checkbox"
                    checked={selectedFloorIdsForBulk.includes(fp.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      setSelectedFloorIdsForBulk(prev => {
                        if (e.target.checked) {
                          return [...prev, fp.id];
                        } else {
                          return prev.filter(id => id !== fp.id);
                        }
                      });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer mr-0.5 shrink-0"
                  />
                ) : (
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                )}

                {/* Direct Inline Edit or Name Display */}
                {isEditingInline ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={inlineEditingName}
                      onChange={(e) => setInlineEditingName(e.target.value)}
                      onBlur={() => {
                        if (inlineEditingName.trim() && onRenameFloorPlan) {
                          onRenameFloorPlan(fp.id, inlineEditingName.trim());
                        }
                        setInlineEditingFloorId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (inlineEditingName.trim() && onRenameFloorPlan) {
                            onRenameFloorPlan(fp.id, inlineEditingName.trim());
                          }
                          setInlineEditingFloorId(null);
                        } else if (e.key === 'Escape') {
                          setInlineEditingFloorId(null);
                        }
                      }}
                      className="bg-white text-slate-900 border border-indigo-400 rounded px-1.5 py-0.5 text-xs font-extrabold w-28 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (inlineEditingName.trim() && onRenameFloorPlan) {
                          onRenameFloorPlan(fp.id, inlineEditingName.trim());
                        }
                        setInlineEditingFloorId(null);
                      }}
                      className="bg-emerald-500 hover:bg-emerald-600 text-white p-0.5 rounded"
                      title="Lưu tên mới"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setInlineEditingFloorId(fp.id);
                      setInlineEditingName(fp.floorName);
                    }}
                    className="font-extrabold tracking-wide"
                    title="Nhấp đôi để sửa tên tầng trực tiếp"
                  >
                    {fp.floorName}
                  </span>
                )}

                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    isSelected ? 'bg-indigo-700 text-indigo-100 font-extrabold' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {roomCount} căn
                </span>

                {defectCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" title={`${defectCount} lỗi defect`} />
                )}

                {/* Direct Action Quick Buttons on Tab */}
                {!isEditingInline && (
                  <div className="flex items-center gap-0.5 ml-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    {/* Pencil Edit Icon */}
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        setInlineEditingFloorId(fp.id);
                        setInlineEditingName(fp.floorName);
                      }}
                      className={`p-1 rounded hover:bg-black/10 transition-colors ${isSelected ? 'text-indigo-100' : 'text-slate-400 hover:text-slate-700'}`}
                      title="Sửa tên tầng trực tiếp"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>

                    {/* Copy / Duplicate Icon */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicateFloor(fp.id, fp.floorName);
                      }}
                      className={`p-1 rounded hover:bg-black/10 transition-colors ${isSelected ? 'text-indigo-100' : 'text-slate-400 hover:text-indigo-600'}`}
                      title="Nhân bản tầng này ngay lập tức"
                    >
                      <Copy className="w-3 h-3" />
                    </button>

                    {/* Delete Floor Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFloor(fp.id, fp.floorName);
                      }}
                      className={`p-1 rounded hover:bg-rose-500/20 transition-colors ${isSelected ? 'text-rose-200 hover:text-white' : 'text-slate-400 hover:text-rose-600'}`}
                      title="Xóa tầng này"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>

                    {/* Move Left Button */}
                    {index > 0 && floorSortBy === 'none' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onMoveFloorPlan) onMoveFloorPlan(fp.id, 'left');
                        }}
                        className={`p-0.5 rounded hover:bg-black/10 transition-colors ${isSelected ? 'text-indigo-100' : 'text-slate-400 hover:text-slate-700'}`}
                        title="Dời tầng sang Trái"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Move Right Button */}
                    {index < sortedFloorPlans.length - 1 && floorSortBy === 'none' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onMoveFloorPlan) onMoveFloorPlan(fp.id, 'right');
                        }}
                        className={`p-0.5 rounded hover:bg-black/10 transition-colors ${isSelected ? 'text-indigo-100' : 'text-slate-400 hover:text-slate-700'}`}
                        title="Dời tầng sang Phải"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>


      </div>

      {/* View Mode Switcher Bar - Distinct Construction vs Defect Tabs */}
      <div className="bg-slate-200/90 p-1.5 rounded-2xl grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs font-bold shadow-inner">
        <button
          onClick={async () => {
            setViewMode('highlight');
            setDrawTool('none');
            setDrawStartPos(null);
            setDrawHoverPos(null);
            setPolygonPoints([]);
            setPendingDraftHighlight(null);
            setSelectedRoomForDragId(null);
          }}
          className={`py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            viewMode === 'highlight'
              ? 'bg-indigo-600 text-white shadow-md font-black ring-2 ring-indigo-300 scale-[1.01]'
              : 'bg-white/80 text-slate-700 hover:bg-white hover:text-indigo-600'
          }`}
        >
          <Building2 className="w-4 h-4 shrink-0" />
          <span className="truncate">Mặt Bằng Thi Công ({floorRooms.length})</span>
        </button>

        <button
          onClick={async () => {
            setViewMode('defect');
            setDrawTool('none');
            setDrawStartPos(null);
            setDrawHoverPos(null);
            setPolygonPoints([]);
            setPendingDraftHighlight(null);
            setSelectedRoomForDragId(null);
          }}
          className={`py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            viewMode === 'defect'
              ? 'bg-rose-600 text-white shadow-md font-black ring-2 ring-rose-300 scale-[1.01]'
              : 'bg-white/80 text-slate-700 hover:bg-white hover:text-rose-600'
          }`}
        >
          <MapPin className="w-4 h-4 shrink-0" />
          <span className="truncate">Mặt Bằng Defect ({floorDefects.length})</span>
        </button>

        <button
          onClick={async () => {
            setViewMode('all');
            setDrawTool('none');
            setDrawStartPos(null);
            setDrawHoverPos(null);
            setPolygonPoints([]);
            setPendingDraftHighlight(null);
            setSelectedRoomForDragId(null);
          }}
          className={`py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all col-span-2 sm:col-span-1 ${
            viewMode === 'all'
              ? 'bg-amber-500 text-slate-950 shadow-md font-black ring-2 ring-amber-300 scale-[1.01]'
              : 'bg-white/80 text-slate-700 hover:bg-white hover:text-amber-600'
          }`}
        >
          <Sparkles className="w-4 h-4 shrink-0" />
          <span className="truncate">Xem Tổng Hợp Tất Cả</span>
        </button>
      </div>

      {/* Interactive Blueprint Canvas Viewer Card */}
      {activeFloor && (
        <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-sm space-y-2.5">
          {/* Header Row: Title & Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-700 w-full pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-slate-900 font-extrabold text-sm">
                {viewMode === 'all'
                  ? '✨ Bản Vẽ Tổng Hợp'
                  : viewMode === 'highlight'
                  ? '🏗️ Bản Vẽ Tiến Độ'
                  : '📌 Bản Vẽ Vị Trí Lỗi'}{' '}
                - <span className="text-indigo-700">{activeFloor.floorName}</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  setUpdatingFloorPlanId(activeFloor.id);
                  updatePlanInputRef.current?.click();
                }}
                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/80 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-2xs active:scale-95"
                title="Cập nhật tệp ảnh hoặc PDF bản vẽ mới cho tầng đang xem"
              >
                <Upload className="w-3.5 h-3.5 text-slate-600" />
                <span>Cập Nhật Bản Vẽ</span>
              </button>

              {(viewMode === 'highlight' || viewMode === 'all') && (
                <button
                  type="button"
                  onClick={async () => {
                    setSelectedRoomForEdit(null);
                    setNewRoomClickPos({ x: 25, y: 25 });
                    setNewRoomRect({ x: 20, y: 20, width: 30, height: 25 });
                    setNewRoomPoints(undefined);
                    setIsRoomModalOpen(true);
                  }}
                  className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs active:scale-95 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm Căn</span>
                </button>
              )}

              {viewMode === 'defect' && (
                <button
                  onClick={() => openDefectModalForPin(50, 50)}
                  className="text-xs bg-rose-600 hover:bg-rose-700 text-white font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs active:scale-95 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Ghim Defect</span>
                </button>
              )}
            </div>
          </div>

          {/* Dedicated Drawing & View Controls Toolbar */}
          {(viewMode === 'highlight' || viewMode === 'all') && (
            <div className="bg-slate-50/90 p-2 rounded-xl border border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
              {/* Group 1: 3 Drawing Tools */}
              <div className="flex flex-wrap items-center gap-1.5">

                {/* Tool 1: Freehand Drawing */}
                <button
                  type="button"
                  onClick={async () => {
                    setDrawTool(drawTool === 'freehand' ? 'none' : 'freehand');
                    setDrawStartPos(null);
                    setDrawHoverPos(null);
                    setPolygonPoints([]);
                  }}
                  className={`text-xs font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all shrink-0 cursor-pointer whitespace-nowrap ${
                    drawTool === 'freehand'
                      ? 'bg-amber-500 text-slate-950 font-black shadow-sm ring-2 ring-amber-300'
                      : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/90 shadow-2xs'
                  }`}
                  title="Nhấn giữ & kéo chuột/ngón tay để vẽ tự do trên mặt bằng"
                >
                  <Pencil className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                  <span>Vẽ Tự Do</span>
                </button>

                {/* Tool 2: Line / Polygon Point-by-Point (2 or more points) */}
                <button
                  type="button"
                  onClick={async () => {
                    setDrawTool(drawTool === 'polygon' ? 'none' : 'polygon');
                    setDrawStartPos(null);
                    setDrawHoverPos(null);
                    setPolygonPoints([]);
                  }}
                  className={`text-xs font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all shrink-0 cursor-pointer whitespace-nowrap ${
                    drawTool === 'polygon'
                      ? 'bg-amber-500 text-slate-950 font-black shadow-sm ring-2 ring-amber-300'
                      : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/90 shadow-2xs'
                  }`}
                  title="Chấm 2 hoặc nhiều điểm để vẽ đường thẳng / đa giác, rồi bấm [Xác Nhận]"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>Vẽ Đa Giác</span>
                </button>

                {/* Tool 3: 2-Point Rectangle */}
                <button
                  type="button"
                  onClick={async () => {
                    setDrawTool(drawTool === '2point' ? 'none' : '2point');
                    setDrawStartPos(null);
                    setDrawHoverPos(null);
                    setPolygonPoints([]);
                  }}
                  className={`text-xs font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all shrink-0 cursor-pointer whitespace-nowrap ${
                    drawTool === '2point'
                      ? 'bg-amber-500 text-slate-950 font-black shadow-sm ring-2 ring-amber-300'
                      : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/90 shadow-2xs'
                  }`}
                  title="Bấm 2 điểm đối góc để tạo khung hình chữ nhật"
                >
                  <span className="text-sm leading-none shrink-0">📦</span>
                  <span>Vẽ Chữ Nhật</span>
                </button>
              </div>

              {/* Group 2: Display Overlay Toggle & Color Mode */}
              <div className="flex flex-wrap items-center gap-1.5">
                {/* Room Highlight Color Mode Toggle */}
                <button
                  type="button"
                  onClick={() => setRoomColorMode(roomColorMode === 'palette' ? 'status' : 'palette')}
                  className={`text-xs font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all shrink-0 cursor-pointer whitespace-nowrap ${
                    roomColorMode === 'palette'
                      ? 'bg-indigo-600 text-white shadow-xs hover:bg-indigo-700'
                      : 'bg-amber-500 text-slate-950 font-black shadow-xs hover:bg-amber-400'
                  }`}
                  title="Đổi giữa Chế độ Mỗi căn 1 màu đa sắc phân biệt (Mặc định) và Màu theo Trạng thái Nghiệm thu"
                >
                  <Palette className="w-3.5 h-3.5 shrink-0" />
                  <span>{roomColorMode === 'palette' ? 'Mỗi Căn 1 Màu' : 'Theo Trạng Thái'}</span>
                </button>

                {/* Show/Hide Text Label Toggle */}
                <button
                  type="button"
                  onClick={() => setShowTextOverlay(!showTextOverlay)}
                  className={`text-xs font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all shrink-0 cursor-pointer whitespace-nowrap ${
                    !showTextOverlay
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/90 shadow-2xs'
                  }`}
                  title="Bật/Tắt chế độ chỉ hiện màu Highlight (không hiện chữ rối)"
                >
                  {!showTextOverlay ? <EyeOff className="w-3.5 h-3.5 shrink-0" /> : <Eye className="w-3.5 h-3.5 shrink-0" />}
                  <span>{!showTextOverlay ? 'Chỉ Hiện Màu' : 'Hiện Tên Căn'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Active Drawing Tool Info Banner */}
          {redrawingRoomTarget ? (
            <div className="bg-amber-500 text-slate-950 p-2.5 rounded-2xl text-xs font-black flex flex-col gap-2 border-2 border-amber-400 shadow-md animate-in slide-in-from-top-1">
              <div className="flex items-center justify-between gap-3 w-full">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-slate-950 shrink-0 animate-spin" />
                  <span>
                    <strong>Đang vẽ lại vùng cho căn "{redrawingRoomTarget.roomName}":</strong>{' '}
                    {drawTool === 'freehand' && 'Nhấn giữ và rê chuột/ngón tay trên mặt bằng để vẽ tự do. Nhả tay để lưu!'}
                    {drawTool === 'polygon' && `Chấm từng góc đa giác mới (Đã chấm ${polygonPoints.length} góc). Hãy bấm nút Chốt bên dưới để lưu!`}
                    {drawTool === '2point' && 'Click 2 điểm góc đối diện (hoặc kéo thả) trên mặt bằng để vẽ khung hình chữ nhật!'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setRedrawingRoomTarget(null);
                    setDrawTool('none');
                    setDrawStartPos(null);
                    setDrawHoverPos(null);
                    setPolygonPoints([]);
                  }}
                  className="bg-slate-950 text-white text-[10px] font-bold px-2.5 py-1 rounded-xl hover:bg-slate-900 shrink-0 cursor-pointer"
                >
                  ✕ Hủy Vẽ Lại
                </button>
              </div>

              {drawTool === 'polygon' && polygonPoints.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 w-full bg-amber-600/30 p-1.5 rounded-xl border border-amber-600/40">
                  {polygonPoints.length === 2 && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleCompletePolygon(true)}
                        className="bg-indigo-950 text-indigo-200 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-indigo-900 transition-colors shadow-xs cursor-pointer"
                      >
                        📏 Chốt Đường Thẳng (2 điểm)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCompletePolygon(false)}
                        className="bg-emerald-950 text-emerald-300 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-emerald-900 transition-colors shadow-xs cursor-pointer"
                      >
                        📦 Chốt Khung Chữ Nhật
                      </button>
                    </>
                  )}
                  {polygonPoints.length >= 3 && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleCompletePolygon(true)}
                        className="bg-indigo-950 text-indigo-200 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-indigo-900 transition-colors shadow-xs cursor-pointer"
                      >
                        〰️ Chốt Đường Gấp Khúc ({polygonPoints.length} điểm)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCompletePolygon(false)}
                        className="bg-emerald-950 text-emerald-300 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-emerald-900 transition-colors shadow-xs cursor-pointer"
                      >
                        🔷 Chốt Đa Giác Diện Tích ({polygonPoints.length} góc)
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setPolygonPoints((prev) => prev.slice(0, -1))}
                    className="bg-slate-900/80 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-slate-900 cursor-pointer"
                  >
                    ↺ Xóa góc cuối
                  </button>
                  <button
                    type="button"
                    onClick={() => setPolygonPoints([])}
                    className="bg-slate-950 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-slate-800 cursor-pointer"
                  >
                    ✕ Xóa hết
                  </button>
                </div>
              )}
            </div>
          ) : drawTool === 'drag' ? (
            <div className="bg-amber-50 text-slate-950 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center justify-between border border-amber-300 shadow-xs animate-in slide-in-from-top-1">
              <div className="flex items-center gap-2">
                <Move className="w-4 h-4 text-amber-600 shrink-0 animate-bounce" />
                <span>
                  <strong>Chế Độ Kéo & Chỉnh Vùng Highlight:</strong> Nhấn giữ nút di chuyển ở giữa hoặc kéo các điểm góc ↖️↗️↙️↘️ để co giãn kích thước trực tiếp trên hình!
                </span>
              </div>
              {selectedRoomForDragId && (
                <button
                  type="button"
                  onClick={() => setSelectedRoomForDragId(null)}
                  className="bg-slate-900 text-amber-300 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-slate-800 transition-colors shrink-0"
                >
                  ✕ Bỏ chọn
                </button>
              )}
            </div>
          ) : drawTool === 'freehand' ? (
            <div className="bg-amber-50 text-slate-900 px-3 py-1.5 rounded-xl text-[11px] font-semibold flex items-center justify-between border border-amber-200 shadow-2xs animate-in slide-in-from-top-1">
              <div className="flex items-center gap-1.5 w-full sm:w-auto">
                <Pencil className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>
                  <strong>Kéo Vẽ Tự Do:</strong> Nhấn giữ & rê chuột/tay khoanh vùng bất kỳ. Nhả tay ra để chốt!
                </span>
              </div>
              {!showTextOverlay && (
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
                  ✨ Chế độ Highlight Tinh Gọn
                </span>
              )}
            </div>
          ) : drawTool === 'polygon' ? (
            <div className="bg-amber-500 text-slate-950 p-2 sm:px-3 sm:py-2 rounded-xl text-xs font-bold flex flex-col items-start sm:flex-row sm:items-center justify-between gap-2 border border-amber-400 shadow-sm animate-in slide-in-from-top-1">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-slate-950 shrink-0" />
                <span className="leading-tight">
                  <strong>Vẽ Đa Giác Chấm Góc:</strong> Click từng góc căn hộ trên mặt bằng (Đã chấm {polygonPoints.length} góc)
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
                {polygonPoints.length === 2 && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCompletePolygon(true)}
                      className="bg-indigo-950 text-indigo-200 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-indigo-900 transition-colors shadow-xs cursor-pointer"
                    >
                      📏 Chốt Đường Thẳng (2 điểm)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCompletePolygon(false)}
                      className="bg-emerald-950 text-emerald-300 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-emerald-900 transition-colors shadow-xs cursor-pointer"
                    >
                      📦 Chốt Khung Chữ Nhật
                    </button>
                  </>
                )}
                {polygonPoints.length >= 3 && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCompletePolygon(true)}
                      className="bg-indigo-950 text-indigo-200 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-indigo-900 transition-colors shadow-xs cursor-pointer"
                    >
                      〰️ Chốt Đường Gấp Khúc ({polygonPoints.length} điểm)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCompletePolygon(false)}
                      className="bg-emerald-950 text-emerald-300 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-emerald-900 transition-colors shadow-xs cursor-pointer"
                    >
                      🔷 Chốt Đa Giác Diện Tích ({polygonPoints.length} góc)
                    </button>
                  </>
                )}
                {polygonPoints.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPolygonPoints((prev) => prev.slice(0, -1))}
                    className="bg-slate-900/80 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-slate-900"
                  >
                    ↺ Xóa góc cuối
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPolygonPoints([])}
                  className="bg-slate-950 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-slate-800"
                >
                  ✕ Xóa hết
                </button>
              </div>
            </div>
          ) : drawStartPos ? (
            <div className="bg-amber-500 text-slate-950 px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between border border-amber-400 shadow-sm animate-in slide-in-from-top-1">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 bg-slate-950 rounded-full animate-ping shrink-0" />
                <span>
                  <strong>Đã chọn Điểm 1</strong>. Nhấp <strong>Điểm 2 (Góc đối diện)</strong> để chốt!
                </span>
              </div>
              <button
                onClick={async () => {
                  setDrawStartPos(null);
                  setDrawHoverPos(null);
                }}
                className="bg-slate-950 text-white text-[10px] font-bold px-2 py-0.5 rounded-lg hover:bg-slate-800 transition-colors ml-2 shrink-0"
              >
                ✕ Hủy
              </button>
            </div>
          ) : drawTool === '2point' ? (
            <div className="bg-indigo-50 text-indigo-900 px-3 py-1.5 rounded-xl text-[11px] font-semibold flex items-center gap-2 border border-indigo-100">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>
                <strong>Chế độ Vẽ 2 Điểm:</strong> Click <strong>Góc 1</strong> ➔ Click <strong>Góc 2</strong> để tạo khung chữ nhật!
              </span>
            </div>
          ) : null}

          {/* Pending Draft Highlight Confirmation Banner */}
          {pendingDraftHighlight && (
            <div className="bg-amber-500 text-slate-950 p-3 rounded-2xl shadow-lg border-2 border-amber-300 flex flex-col sm:flex-row items-center justify-between gap-2.5 animate-in zoom-in-95">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-slate-950 shrink-0 animate-spin" />
                <div>
                  <span className="font-black text-xs block">Đã khoanh xong vùng Highlight!</span>
                  <span className="text-[11px] text-slate-950 font-bold">
                    Vùng màu vàng nhấp nháy trên bản vẽ. Bạn kiểm tra lại vị trí nhé!
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={async () => {
                    setNewRoomRect(pendingDraftHighlight.rect);
                    setNewRoomPoints(pendingDraftHighlight.points);
                    setSelectedRoomForEdit({
                      id: '',
                      floorId: activeFloor.id,
                      roomName: `Căn ${activeFloor.floorName ? activeFloor.floorName.replace(/[^\d]/g, '') || '1' : '1'}0${floorRooms.length + 1}`,
                      frameStatus: 'Chưa làm',
                      boardStatus: 'Chưa làm',
                      inspectionStatus: 'Chưa nghiệm thu',
                      x: pendingDraftHighlight.rect?.x ?? 20,
                      y: pendingDraftHighlight.rect?.y ?? 20,
                      width: pendingDraftHighlight.rect?.width ?? 20,
                      height: pendingDraftHighlight.rect?.height ?? 15,
                      points: pendingDraftHighlight.points,
                      isPolyline: pendingDraftHighlight.isPolyline,
                      updatedAt: Date.now(),
                    });
                    setIsRoomModalOpen(true);
                  }}
                  className="bg-slate-950 hover:bg-slate-900 text-amber-300 text-xs font-black px-3 py-1.5 rounded-xl shadow transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  ✓ Bắt Đầu Cấu Hình
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const roomCount = floorRooms.length + 1;
                    onSaveRoomProgress({
                      floorId: activeFloor.id,
                      roomName: `Căn ${activeFloor.floorName ? activeFloor.floorName.replace(/[^\d]/g, '') || '1' : '1'}0${roomCount}`,
                      frameStatus: 'Chưa làm',
                      boardStatus: 'Chưa làm',
                      inspectionStatus: 'Chưa nghiệm thu',
                      x: pendingDraftHighlight.rect?.x ?? 20,
                      y: pendingDraftHighlight.rect?.y ?? 20,
                      width: pendingDraftHighlight.rect?.width ?? 20,
                      height: pendingDraftHighlight.rect?.height ?? 15,
                      points: pendingDraftHighlight.points,
                      isPolyline: pendingDraftHighlight.isPolyline,
                    });
                    setPendingDraftHighlight(null);
                  }}
                  className="bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl shadow transition-all active:scale-95 cursor-pointer"
                >
                  ⚡ Lưu Nhanh
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDraftHighlight(null)}
                  className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl"
                >
                  ✕ Vẽ Lại
                </button>
              </div>
            </div>
          )}

          {/* Blueprint Image Outer Container with Controls */}
          <div className={`${isFullscreen ? 'fixed inset-0 z-[100] bg-slate-950 rounded-none h-[100dvh] w-[100dvw] flex flex-col' : 'relative w-full h-[400px] bg-slate-900 rounded-2xl'} overflow-hidden border border-slate-300 select-none group shadow-inner`}>
            {/* Fullscreen Pinned Drawing Toolbar & Active Banners */}
            {isFullscreen && (
              <div className="shrink-0 z-[70] pointer-events-auto flex flex-col gap-1.5 p-2 bg-slate-950/95 border-b border-slate-800 shadow-lg">
                {/* Fullscreen Top Control Bar */}
                <div className="flex items-center justify-between gap-2 bg-slate-900/95 backdrop-blur-md px-3 py-1.5 rounded-2xl border border-slate-700 shadow-2xl text-white overflow-x-auto no-scrollbar">
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-black text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-xl border border-amber-400/30 flex items-center gap-1.5 shrink-0">
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span className="truncate max-w-[100px] sm:max-w-none">{activeFloor?.floorName || 'Toàn Màn Hình'}</span>
                    </span>

                    {(viewMode === 'highlight' || viewMode === 'all') && (
                      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                        {/* Tool 1: Freehand Drawing */}
                        <button
                          type="button"
                          onClick={async () => {
                            setDrawTool(drawTool === 'freehand' ? 'none' : 'freehand');
                            setDrawStartPos(null);
                            setDrawHoverPos(null);
                            setPolygonPoints([]);
                          }}
                          className={`text-[11px] font-extrabold px-2.5 py-1 rounded-xl flex items-center gap-1 transition-all shrink-0 ${
                            drawTool === 'freehand'
                              ? 'bg-amber-500 text-slate-950 font-black scale-105 shadow-sm'
                              : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
                          }`}
                          title="Nhấn giữ & kéo chuột/ngón tay để vẽ tự do"
                        >
                          <Pencil className="w-3.5 h-3.5 text-amber-400" />
                          <span>Vẽ Tự Do</span>
                        </button>

                        {/* Tool 2: Polygon / Line (2+ Points) */}
                        <button
                          type="button"
                          onClick={async () => {
                            setDrawTool(drawTool === 'polygon' ? 'none' : 'polygon');
                            setDrawStartPos(null);
                            setDrawHoverPos(null);
                            setPolygonPoints([]);
                          }}
                          className={`text-[11px] font-extrabold px-2.5 py-1 rounded-xl flex items-center gap-1 transition-all shrink-0 cursor-pointer ${
                            drawTool === 'polygon'
                              ? 'bg-amber-500 text-slate-950 font-black scale-105 shadow-sm'
                              : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
                          }`}
                          title="Chấm 2 hoặc nhiều điểm vẽ đường/được đa giác rồi chốt"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Vẽ Đa Giác</span>
                        </button>

                        {/* Tool 3: 2-Point Rectangle */}
                        <button
                          type="button"
                          onClick={async () => {
                            setDrawTool(drawTool === '2point' ? 'none' : '2point');
                            setDrawStartPos(null);
                            setDrawHoverPos(null);
                            setPolygonPoints([]);
                          }}
                          className={`text-[11px] font-extrabold px-2.5 py-1 rounded-xl flex items-center gap-1 transition-all shrink-0 cursor-pointer ${
                            drawTool === '2point'
                              ? 'bg-amber-500 text-slate-950 font-black scale-105 shadow-sm'
                              : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
                          }`}
                          title="Bấm 2 điểm tạo khung chữ nhật"
                        >
                          <span>Vẽ Chữ Nhật</span>
                        </button>

                        {/* Color Mode Toggle */}
                        <button
                          type="button"
                          onClick={() => setRoomColorMode(roomColorMode === 'palette' ? 'status' : 'palette')}
                          className={`text-[11px] font-extrabold px-2.5 py-1 rounded-xl flex items-center gap-1 transition-all shrink-0 cursor-pointer ${
                            roomColorMode === 'palette'
                              ? 'bg-indigo-600 text-white shadow-xs hover:bg-indigo-500'
                              : 'bg-amber-500 text-slate-950 font-black shadow-xs hover:bg-amber-400'
                          }`}
                          title="Đổi giữa Chế độ Mỗi căn 1 màu đa sắc phân biệt và Theo Trạng thái Nghiệm thu"
                        >
                          <Palette className="w-3.5 h-3.5" />
                          <span>{roomColorMode === 'palette' ? 'Mỗi Căn 1 Màu' : 'Theo Trạng Thái'}</span>
                        </button>

                        {/* Toggle Highlight Display */}
                        <button
                          type="button"
                          onClick={() => setShowTextOverlay(!showTextOverlay)}
                          className={`text-[11px] font-extrabold px-2.5 py-1 rounded-xl flex items-center gap-1 transition-all shrink-0 cursor-pointer ${
                            !showTextOverlay
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                          }`}
                          title="Hiện màu sạch / Hiện đầy đủ tên căn"
                        >
                          {!showTextOverlay ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          <span>{!showTextOverlay ? 'Chỉ Hiện Màu' : 'Hiện Tên Căn'}</span>
                        </button>

                        {/* Add Room */}
                        <button
                          type="button"
                          onClick={async () => {
                            setSelectedRoomForEdit(null);
                            setNewRoomClickPos({ x: 25, y: 25 });
                            setNewRoomRect({ x: 20, y: 20, width: 30, height: 25 });
                            setNewRoomPoints(undefined);
                            setIsRoomModalOpen(true);
                          }}
                          className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-xs shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Thêm Căn</span>
                        </button>
                      </div>
                    )}

                    {viewMode === 'defect' && (
                      <button
                        onClick={() => openDefectModalForPin(50, 50)}
                        className="text-[11px] bg-rose-600 hover:bg-rose-500 text-white font-black px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-xs shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Ghim Defect</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <UndoRedoControls
                      onUndo={onUndo}
                      onRedo={onRedo}
                      canUndo={canUndo}
                      canRedo={canRedo}
                      variant="dark"
                      showLabel={false}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        setRotation(0);
                        setIsFullscreen(false);
                      }}
                      className="bg-rose-600/90 hover:bg-rose-600 text-white font-bold text-xs px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-md shrink-0 ml-1"
                      title="Thu nhỏ màn hình"
                    >
                      <Minimize2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Thu Nhỏ</span>
                    </button>
                  </div>
                </div>

                {/* Floating Active Drawing Action Banner in Fullscreen */}
                {drawTool === 'polygon' && !redrawingRoomTarget && (
                  <div className="bg-amber-500 text-slate-950 p-2 rounded-2xl text-xs font-bold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-2 border-amber-300 shadow-2xl animate-in slide-in-from-top-2 w-full">
                    <div className="flex items-center gap-1.5 w-full sm:w-auto">
                      <Sparkles className="w-4 h-4 text-slate-950 shrink-0" />
                      <span>
                        <strong>Chấm Góc Đa Giác:</strong> Click từng góc trên bản vẽ (Đã chấm {polygonPoints.length} góc)
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto sm:ml-auto">
                      {polygonPoints.length === 2 && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCompletePolygon(true)}
                            className="bg-indigo-950 hover:bg-indigo-900 text-indigo-200 text-xs font-black px-3 py-1.5 rounded-xl transition-all shadow-md active:scale-95 flex items-center gap-1 cursor-pointer"
                          >
                            📏 Chốt Đường Thẳng (2 điểm)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCompletePolygon(false)}
                            className="bg-emerald-950 hover:bg-emerald-900 text-emerald-300 text-xs font-black px-3 py-1.5 rounded-xl transition-all shadow-md active:scale-95 flex items-center gap-1 cursor-pointer"
                          >
                            📦 Chốt Khung Chữ Nhật
                          </button>
                        </>
                      )}
                      {polygonPoints.length >= 3 && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCompletePolygon(true)}
                            className="bg-indigo-950 hover:bg-indigo-900 text-indigo-200 text-xs font-black px-3 py-1.5 rounded-xl transition-all shadow-md active:scale-95 flex items-center gap-1 cursor-pointer"
                          >
                            〰️ Chốt Đường Gấp Khúc ({polygonPoints.length} điểm)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCompletePolygon(false)}
                            className="bg-emerald-950 hover:bg-emerald-900 text-emerald-300 text-xs font-black px-3 py-1.5 rounded-xl transition-all shadow-md active:scale-95 flex items-center gap-1 cursor-pointer"
                          >
                            🔷 Chốt Đa Giác Diện Tích ({polygonPoints.length} góc)
                          </button>
                        </>
                      )}
                      {polygonPoints.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPolygonPoints((prev) => prev.slice(0, -1))}
                          className="bg-slate-900 text-white text-[11px] font-bold px-2 py-1 rounded-xl hover:bg-slate-800"
                        >
                          ↺ Xóa góc cuối
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          setPolygonPoints([]);
                          setDrawTool('none');
                        }}
                        className="bg-slate-950 text-white text-[11px] font-bold px-2 py-1 rounded-xl hover:bg-slate-800"
                      >
                        ✕ Hủy
                      </button>
                    </div>
                  </div>
                )}

                {pendingDraftHighlight && (
                  <div className="bg-amber-500 text-slate-950 p-2 rounded-2xl shadow-2xl border-2 border-amber-300 flex flex-wrap items-center justify-between gap-2 animate-in zoom-in-95">
                    <div className="flex items-center gap-1.5 w-full sm:w-auto">
                      <Sparkles className="w-4 h-4 text-slate-950 shrink-0 animate-spin" />
                      <span className="font-black text-xs">Đã khoanh xong! Kiểm tra vùng vàng nhấp nháy trên bản vẽ.</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                      <button
                        type="button"
                        onClick={async () => {
                          setNewRoomRect(pendingDraftHighlight.rect);
                          setNewRoomPoints(pendingDraftHighlight.points);
                          setSelectedRoomForEdit({
                            id: '',
                            floorId: activeFloor.id,
                            roomName: `Căn ${activeFloor.floorName ? activeFloor.floorName.replace(/[^\d]/g, '') || '1' : '1'}0${floorRooms.length + 1}`,
                            frameStatus: 'Chưa làm',
                            boardStatus: 'Chưa làm',
                            inspectionStatus: 'Chưa nghiệm thu',
                            x: pendingDraftHighlight.rect?.x ?? 20,
                            y: pendingDraftHighlight.rect?.y ?? 20,
                            width: pendingDraftHighlight.rect?.width ?? 20,
                            height: pendingDraftHighlight.rect?.height ?? 15,
                            points: pendingDraftHighlight.points,
                            isPolyline: pendingDraftHighlight.isPolyline,
                            updatedAt: Date.now(),
                          });
                          setIsRoomModalOpen(true);
                        }}
                        className="bg-slate-950 hover:bg-slate-900 text-amber-300 text-xs font-black px-3 py-1.5 rounded-xl shadow transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        ✓ Bắt Đầu Cấu Hình
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const roomCount = floorRooms.length + 1;
                          onSaveRoomProgress({
                            floorId: activeFloor.id,
                            roomName: `Căn ${activeFloor.floorName ? activeFloor.floorName.replace(/[^\d]/g, '') || '1' : '1'}0${roomCount}`,
                            frameStatus: 'Chưa làm',
                            boardStatus: 'Chưa làm',
                            inspectionStatus: 'Chưa nghiệm thu',
                            x: pendingDraftHighlight.rect?.x ?? 20,
                            y: pendingDraftHighlight.rect?.y ?? 20,
                            width: pendingDraftHighlight.rect?.width ?? 20,
                            height: pendingDraftHighlight.rect?.height ?? 15,
                            points: pendingDraftHighlight.points,
                            isPolyline: pendingDraftHighlight.isPolyline,
                          });
                          setPendingDraftHighlight(null);
                        }}
                        className="bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl shadow transition-all active:scale-95 cursor-pointer"
                      >
                        ⚡ Lưu Nhanh
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDraftHighlight(null)}
                        className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl"
                      >
                        ✕ Vẽ Lại
                      </button>
                    </div>
                  </div>
                )}

                {drawTool === 'freehand' && !redrawingRoomTarget && (
                  <div className="bg-amber-500 text-slate-950 p-2 rounded-2xl text-xs font-bold flex items-center justify-between gap-2 border border-amber-300 shadow-xl">
                    <div className="flex items-center gap-1.5 w-full sm:w-auto">
                      <Pencil className="w-3.5 h-3.5 shrink-0" />
                      <span>💡 <strong>Kéo Vẽ Tự Do:</strong> Nhấn giữ & rê chuột/ngón tay khoanh vùng bất kỳ. Nhả tay để chốt!</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDrawTool('none')}
                      className="bg-slate-950 text-white text-[11px] font-bold px-2 py-1 rounded-xl"
                    >
                      ✕ Tắt vẽ
                    </button>
                  </div>
                )}

                {drawStartPos && !redrawingRoomTarget && (
                  <div className="bg-amber-500 text-slate-950 p-2 rounded-2xl text-xs font-bold flex items-center justify-between gap-2 border border-amber-300 shadow-xl">
                    <div className="flex items-center gap-1.5 w-full sm:w-auto">
                      <div className="w-2.5 h-2.5 bg-slate-950 rounded-full animate-ping shrink-0" />
                      <span>🎯 <strong>Đã chọn Điểm 1.</strong> Click <strong>Điểm 2 (Góc đối diện)</strong> để chốt!</span>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        setDrawStartPos(null);
                        setDrawHoverPos(null);
                      }}
                      className="bg-slate-950 text-white text-[11px] font-bold px-2 py-1 rounded-xl"
                    >
                      ✕ Hủy
                    </button>
                  </div>
                )}

                 {redrawingRoomTarget && (
                  <div className="bg-amber-500 text-slate-950 p-2 rounded-2xl text-xs font-bold flex flex-col gap-2 border border-amber-300 shadow-xl w-full">
                    <div className="flex items-center justify-between gap-2 w-full">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 shrink-0 animate-spin" />
                        <span>
                          📐 <strong>Đang vẽ lại vùng cho căn "{redrawingRoomTarget.roomName}":</strong>{' '}
                          {drawTool === 'freehand' && 'Nhấn giữ & rê ngón tay/chuột để vẽ tự do. Nhả tay để lưu!'}
                          {drawTool === 'polygon' && `Chấm từng điểm góc đa giác mới (Đã chấm ${polygonPoints.length} góc). Bấm nút Chốt để lưu!`}
                          {drawTool === '2point' && 'Bấm 2 điểm đối góc trên mặt bằng để vẽ khung hình chữ nhật!'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          setRedrawingRoomTarget(null);
                          setDrawTool('none');
                          setDrawStartPos(null);
                          setDrawHoverPos(null);
                          setPolygonPoints([]);
                        }}
                        className="bg-slate-950 text-white text-[11px] font-bold px-2 py-1 rounded-xl cursor-pointer"
                      >
                        ✕ Hủy
                      </button>
                    </div>

                    {drawTool === 'polygon' && polygonPoints.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 w-full bg-amber-600/30 p-1.5 rounded-xl border border-amber-600/40">
                        {polygonPoints.length === 2 && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCompletePolygon(true)}
                              className="bg-indigo-950 text-indigo-200 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-indigo-900 transition-colors shadow-xs cursor-pointer"
                            >
                              📏 Chốt Đường Thẳng (2 điểm)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCompletePolygon(false)}
                              className="bg-emerald-950 text-emerald-300 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-emerald-900 transition-colors shadow-xs cursor-pointer"
                            >
                              📦 Chốt Khung Chữ Nhật
                            </button>
                          </>
                        )}
                        {polygonPoints.length >= 3 && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCompletePolygon(true)}
                              className="bg-indigo-950 text-indigo-200 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-indigo-900 transition-colors shadow-xs cursor-pointer"
                            >
                              〰️ Chốt Gấp Khúc ({polygonPoints.length} điểm)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCompletePolygon(false)}
                              className="bg-emerald-950 text-emerald-300 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-emerald-900 transition-colors shadow-xs cursor-pointer"
                            >
                              🔷 Chốt Đa Giác Diện Tích ({polygonPoints.length} góc)
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setPolygonPoints((prev) => prev.slice(0, -1))}
                          className="bg-slate-900 text-white text-[11px] font-bold px-2 py-1 rounded-xl hover:bg-slate-800 cursor-pointer"
                        >
                          ↺ Xóa góc
                        </button>
                        <button
                          type="button"
                          onClick={() => setPolygonPoints([])}
                          className="bg-slate-950 text-white text-[11px] font-bold px-2 py-1 rounded-xl hover:bg-slate-850 cursor-pointer"
                        >
                          ✕ Xóa hết
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Quick Floating Room Operations Bar (Top Left) */}
            {(selectedRoomObject || copiedRoomsState.length > 0) && (
              <div className={`absolute ${isFullscreen ? 'top-20 sm:top-16' : 'top-2'} left-2 z-40 pointer-events-auto flex items-center gap-1.5 bg-slate-900/95 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-700 shadow-2xl text-white animate-in fade-in slide-in-from-top-2 overflow-x-auto max-w-[calc(100%-16px)] sm:max-w-none no-scrollbar shrink`}>
                {selectedRoomObject ? (
                  <>
                    <div className="text-[11px] font-black text-amber-300 pr-1.5 border-r border-slate-700 max-w-[120px] sm:max-w-[160px] truncate flex items-center gap-1 shrink-0">
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
                      <span className="truncate">{selectedRoomObject.roomName}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyRoom(selectedRoomObject)}
                      className="flex items-center gap-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[11px] font-extrabold px-2 py-1 rounded-lg transition-colors border border-amber-500/40 shadow-xs shrink-0"
                      title="Sao chép căn này"
                    >
                      <Copy className="w-3.5 h-3.5 text-amber-400" />
                      <span>Sao chép</span>
                    </button>

                    {copiedRoomsState.length > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          let px = selectedRoomObject.x + (selectedRoomObject.width || 20) / 2;
                          let py = selectedRoomObject.y + (selectedRoomObject.height || 15) / 2;
                          if (selectedRoomObject.points && selectedRoomObject.points.length > 0) {
                            px = selectedRoomObject.points.reduce((s, p) => s + p.x, 0) / selectedRoomObject.points.length;
                            py = selectedRoomObject.points.reduce((s, p) => s + p.y, 0) / selectedRoomObject.points.length;
                          }
                          handlePasteRoom(px + 6, py + 6);
                        }}
                        className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-[11px] font-extrabold px-2.5 py-1 rounded-lg transition-colors border border-indigo-400 shadow-xs shrink-0"
                        title="Dán căn đã copy"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Dán</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={async () => {
                        setSelectedRoomForEdit(selectedRoomObject);
                        setIsRoomModalOpen(true);
                      }}
                      className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] font-extrabold px-2 py-1 rounded-lg transition-colors border border-slate-600 shadow-xs shrink-0"
                      title="Sửa thông tin chi tiết căn"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Sửa</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteRoom(selectedRoomObject)}
                      className="flex items-center gap-1 bg-rose-900/60 hover:bg-rose-800 text-rose-200 text-[11px] font-extrabold px-2 py-1 rounded-lg transition-colors border border-rose-700 shadow-xs shrink-0"
                      title="Xóa căn này"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span className="hidden sm:inline">Xóa</span>
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        setSelectedRoomForDragId(null);
                        setSelectedRoomIds([]);
                      }}
                      className="text-slate-400 hover:text-white px-1.5 py-1 rounded-lg text-xs font-bold transition-colors ml-0.5 shrink-0"
                      title="Bỏ chọn căn"
                    >
                      ✕
                    </button>
                  </>
                ) : copiedRoomsState.length > 0 ? (
                  <>
                    <div className="text-[11px] font-black text-amber-300 pr-1.5 border-r border-slate-700 flex items-center gap-1 shrink-0">
                      <Copy className="w-3.5 h-3.5 text-amber-400" />
                      <span>Đã copy ({copiedRoomsState.length})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handlePasteRoom(50, 50)}
                      className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-extrabold px-2.5 py-1 rounded-lg transition-colors border border-indigo-400 shadow-xs shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Dán tại đây</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCopiedRoomsState([])}
                      className="text-slate-400 hover:text-white px-1.5 py-1 text-xs font-bold shrink-0"
                      title="Hủy sao chép"
                    >
                      ✕
                    </button>
                  </>
                ) : null}
              </div>
            )}

            {/* Copy / Paste Feedback Toast Banner */}
            {copyNotification && (
              <div className="absolute top-12 left-1/2 -translate-x-1/2 z-[60] bg-slate-950/95 text-amber-300 text-xs font-black px-3 py-1.5 rounded-xl border border-amber-400/80 shadow-2xl animate-in fade-in zoom-in-95 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                <span>{copyNotification}</span>
              </div>
            )}

            {/* Floating Zoom Bar (Positioned at Bottom Right to prevent overlap on mobile) */}
            <div className="absolute bottom-3 right-3 z-40 pointer-events-auto flex items-center gap-1 bg-slate-950/90 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-700 shadow-2xl text-white text-[11px]">
              <button
                type="button"
                onClick={() => setZoomScale((prev) => Math.max(1, +(prev - 0.25).toFixed(2)))}
                className="p-1 hover:bg-slate-800 rounded-lg transition-colors text-slate-200"
                title="Thu nhỏ bản vẽ (-)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-extrabold px-1 text-amber-300 text-xs min-w-[38px] text-center">
                {Math.round(zoomScale * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoomScale((prev) => Math.min(20, +(prev + 0.5).toFixed(2)))}
                className="p-1 hover:bg-slate-800 rounded-lg transition-colors text-slate-200"
                title="Phóng to bản vẽ để highlight chi tiết (+)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              {zoomScale > 1 && (
                <button
                  type="button"
                  onClick={() => setZoomScale(1)}
                  className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] font-bold text-slate-300 transition-colors ml-1 flex items-center justify-center min-w-[24px]"
                  title="Đặt lại zoom 100%"
                >
                  1:1
                </button>
              )}
              {isFullscreen && (
                <button
                  type="button"
                  onClick={() => setRotation(r => (r + 90) % 360)}
                  className="p-1 hover:bg-slate-800 rounded-lg transition-colors text-slate-200 ml-1"
                  title="Xoay mặt bằng 90 độ"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              )}
              <div className="w-px h-4 bg-slate-700 mx-1"></div>
              <button
                type="button"
                onClick={async () => {
                  if (isFullscreen) {
                    setRotation(0);
                  }
                  setIsFullscreen(!isFullscreen);
                }}
                className="p-1 hover:bg-slate-800 rounded-lg transition-colors text-slate-200"
                title={isFullscreen ? 'Thu nhỏ màn hình' : 'Toàn màn hình (Xoay ngang điện thoại để xem dễ hơn)'}
              >
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5 text-amber-400" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Scrollable / Zoomable Inner Area */}
            <div ref={parentRef} className={`w-full overflow-auto flex ${zoomScale > 1 ? 'items-start justify-start p-4' : 'items-center justify-center'} ${isFullscreen ? 'flex-1' : 'h-full'}`}>
              <div
                style={{
                   width: containerW,
                   height: containerH,
                }}
                className="relative shrink-0"
              >
                  <div
                    ref={imageContainerRef}
                    onPointerDown={handlePointerDownImage}
                    onPointerMove={handlePointerMoveImage}
                    onPointerUp={handlePointerUpImage}
                    onPointerCancel={(e) => {
                      activePointersRef.current.delete(e.pointerId);
                      handlePointerUpImage(e);
                    }}
                    onClick={handleImageClick}
                    onTouchStart={handleBgTouchStart}
                    onTouchMove={handleBgTouchMove}
                    onTouchEnd={handleBgTouchEnd}
                    onContextMenu={handleContextMenuOnBg}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: targetW,
                      height: targetH,
                      transform: transformStr,
                      transformOrigin: '0 0',
                      touchAction: (viewMode === 'highlight' && drawTool === 'freehand') || selectedRoomForDragId !== null || activeDragHandle !== null || drawTool === 'drag' ? 'none' : 'pan-x pan-y',
                    }}
                    className="relative cursor-crosshair select-none"
                  >
                    {activeFloor?.imageUrl ? (
                      <img
                        src={activeFloor.imageUrl}
                        alt={activeFloor.floorName}
                        onLoad={(e) => {
                          if (zoomScale > 1 || isFullscreen) {
                            const w = e.currentTarget.naturalWidth;
                            const h = e.currentTarget.naturalHeight;
                            if (h > 0) setImgAspect(w / h);
                          }
                        }}
                        referrerPolicy="no-referrer"
                        crossOrigin="anonymous"
                        className="w-full h-full object-fill pointer-events-none opacity-90"
                      />
                    ) : (
                      <div className="w-full h-[400px] flex items-center justify-center bg-slate-100 text-slate-400 font-bold text-sm">
                        Chưa có ảnh bản vẽ mặt bằng
                      </div>
                    )}

                {/* SVG OVERLAY FOR HIGHLIGHT SHAPES & LIVE DRAWINGS */}
                {(viewMode === 'all' || viewMode === 'highlight') && (() => {
                  const strokeScale = 1 / Math.max(1, zoomScale);
                  return (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {/* Live Draft Highlight Pending Pulsing Shape */}
                    {pendingDraftHighlight && (
                      <g>
                        {pendingDraftHighlight.points ? (
                          pendingDraftHighlight.isPolyline ? (
                            <polyline
                              points={pendingDraftHighlight.points.map((p) => `${p.x},${p.y}`).join(' ')}
                              fill="none"
                              stroke="#f59e0b"
                              strokeWidth={1.8 * strokeScale}
                              strokeDasharray="2,1"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="animate-pulse"
                            />
                          ) : (
                            <polygon
                              points={pendingDraftHighlight.points.map((p) => `${p.x},${p.y}`).join(' ')}
                              fill="rgba(245, 158, 11, 0.45)"
                              stroke="#f59e0b"
                              strokeWidth={1.2 * strokeScale}
                              strokeDasharray="2,1"
                              className="animate-pulse"
                            />
                          )
                        ) : pendingDraftHighlight.rect ? (
                          <rect
                            x={pendingDraftHighlight.rect.x}
                            y={pendingDraftHighlight.rect.y}
                            width={pendingDraftHighlight.rect.width}
                            height={pendingDraftHighlight.rect.height}
                            rx="1"
                            fill="rgba(245, 158, 11, 0.45)"
                            stroke="#f59e0b"
                            strokeWidth={1.2 * strokeScale}
                            strokeDasharray="2,1"
                            className="animate-pulse"
                          />
                        ) : null}
                      </g>
                    )}

                    {/* Live 2-Point Drawing Rectangle Preview */}
                    {drawStartPos && drawHoverPos && drawTool === '2point' && (
                      <rect
                        x={Math.min(drawStartPos.x, drawHoverPos.x)}
                        y={Math.min(drawStartPos.y, drawHoverPos.y)}
                        width={Math.abs(drawHoverPos.x - drawStartPos.x)}
                        height={Math.abs(drawHoverPos.y - drawStartPos.y)}
                        rx="1"
                        fill="rgba(99, 102, 241, 0.35)"
                        stroke="#4f46e5"
                        strokeWidth={0.8 * strokeScale}
                        strokeDasharray="2,2"
                      />
                    )}

                    {/* Live Freehand Drawing Line Preview */}
                    {isFreehandDrawing && freehandPoints.length > 0 && (
                  <polyline
                    points={freehandPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={1.2 * strokeScale}
                    strokeDasharray="1,1"
                  />
                )}

                {/* Live Polygon Point-by-Point Drawing Preview */}
                {polygonPoints.length > 0 && (
                  <g>
                    <polyline
                      points={
                        drawHoverPos && (drawHoverPos.x !== polygonPoints[polygonPoints.length - 1].x || drawHoverPos.y !== polygonPoints[polygonPoints.length - 1].y)
                          ? [...polygonPoints, drawHoverPos].map((p) => `${p.x},${p.y}`).join(' ')
                          : polygonPoints.map((p) => `${p.x},${p.y}`).join(' ')
                      }
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth={1.2 * strokeScale}
                      strokeDasharray="1,1"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {polygonPoints.map((p, idx) => (
                      <circle key={idx} cx={p.x} cy={p.y} r={1 * strokeScale} fill="#f59e0b" stroke="#000" strokeWidth={0.3 * strokeScale} />
                    ))}
                  </g>
                )}

                {/* Render All Saved Room Highlights */}
                {displayedFloorRooms.map((room, roomIdx) => {
                  const { fill: fillColor, stroke: strokeColor } = getRoomColorStyle(room, roomIdx, roomColorMode);
                  const isSelectedForDrag = selectedRoomForDragId === room.id || selectedRoomIds.includes(room.id);

                  if (room.isPolyline && room.points && room.points.length >= 2) {
                    return (
                      <g key={room.id} className="pointer-events-auto cursor-pointer">
                        {/* Glow outer stroke */}
                        <polyline
                          points={room.points.map((p) => `${p.x},${p.y}`).join(' ')}
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth={3.0 * strokeScale}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity="0.28"
                        />
                        {/* Crisp foreground stroke */}
                        <polyline
                          points={room.points.map((p) => `${p.x},${p.y}`).join(' ')}
                          fill="none"
                          stroke={isSelectedForDrag ? '#f59e0b' : strokeColor}
                          strokeWidth={(isSelectedForDrag ? 1.6 : 1.2) * strokeScale}
                          strokeDasharray={isSelectedForDrag ? '2,1' : undefined}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          onMouseEnter={() => setHoveredRoomId(room.id)}
                          onMouseLeave={() => setHoveredRoomId(null)}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRoomSelectClick(e, room);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setSelectedRoomForEdit(room);
                            setIsRoomModalOpen(true);
                          }}
                          onTouchStart={(e) => handleRoomTouchStart(e, room)}
                          onTouchMove={handleRoomTouchMove}
                          onTouchEnd={handleRoomTouchEnd}
                          onContextMenu={(e) => handleContextMenuOnRoom(e, room)}
                        />
                      </g>
                    );
                  }

                  const isFreehand = room.points && room.points.length >= 3;

                  return isFreehand ? (
                    <polygon
                      key={room.id}
                      points={room.points!.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill={fillColor}
                      stroke={isSelectedForDrag ? '#f59e0b' : strokeColor}
                      strokeWidth={(isSelectedForDrag ? 1.2 : 0.6) * strokeScale}
                      strokeDasharray={isSelectedForDrag ? '2,1' : undefined}
                      className="pointer-events-auto cursor-pointer transition-all hover:fill-opacity-75"
                      onMouseEnter={() => setHoveredRoomId(room.id)}
                      onMouseLeave={() => setHoveredRoomId(null)}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRoomSelectClick(e, room);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setSelectedRoomForEdit(room);
                        setIsRoomModalOpen(true);
                      }}
                      onTouchStart={(e) => handleRoomTouchStart(e, room)}
                      onTouchMove={handleRoomTouchMove}
                      onTouchEnd={handleRoomTouchEnd}
                      onContextMenu={(e) => handleContextMenuOnRoom(e, room)}
                    />
                  ) : (
                    <rect
                      key={room.id}
                      x={room.x}
                      y={room.y}
                      width={room.width}
                      height={room.height}
                      rx="1"
                      fill={fillColor}
                      stroke={isSelectedForDrag ? '#f59e0b' : strokeColor}
                      strokeWidth={(isSelectedForDrag ? 1.2 : 0.6) * strokeScale}
                      strokeDasharray={isSelectedForDrag ? '2,1' : undefined}
                      className="pointer-events-auto cursor-pointer transition-all hover:fill-opacity-75"
                      onMouseEnter={() => setHoveredRoomId(room.id)}
                      onMouseLeave={() => setHoveredRoomId(null)}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRoomSelectClick(e, room);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setSelectedRoomForEdit(room);
                        setIsRoomModalOpen(true);
                      }}
                      onTouchStart={(e) => handleRoomTouchStart(e, room)}
                      onTouchMove={handleRoomTouchMove}
                      onTouchEnd={handleRoomTouchEnd}
                      onContextMenu={(e) => handleContextMenuOnRoom(e, room)}
                    />
                  );
                })}
              </svg>
                  );
                })()}

            {/* INTERACTIVE DRAG & RESIZE HANDLES OVERLAY */}
            {(viewMode === 'all' || viewMode === 'highlight') && (
              <>
                {displayedFloorRooms.map((room) => {
                  const isSelectedForDrag = selectedRoomForDragId === room.id || selectedRoomIds.includes(room.id) || (drawTool === 'drag' && hoveredRoomId === room.id);

                  if (!isSelectedForDrag) return null;

              const rx = room.x;
              const ry = room.y;
              const rw = room.width || 20;
              const rh = room.height || 15;
              const cx = rx + rw / 2;
              const cy = ry + rh / 2;

              const isPolygon = room.points && room.points.length >= 3;

              return (
                <React.Fragment key={`drag-controls-${room.id}`}>
                  {/* Selection Border / Bounding Box */}
                  <div
                    style={{
                      left: `${rx}%`,
                      top: `${ry}%`,
                      width: `${rw}%`,
                      height: `${rh}%`,
                    }}
                    className={`absolute pointer-events-none rounded-sm border-2 ${
                      selectedRoomForDragId === room.id
                        ? 'border-amber-400 shadow-lg shadow-amber-500/20 ring-2 ring-amber-300 ring-offset-1'
                        : 'border-amber-300/70 border-dashed'
                    }`}
                  />

                  {/* Center Move Handle Badge */}
                  <div
                    style={{ left: `${cx}%`, top: `${cy}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'move')}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-grab active:cursor-grabbing bg-slate-950 text-amber-400 p-1.5 rounded-full shadow-2xl border-2 border-amber-400 flex items-center justify-center hover:scale-125 transition-transform group"
                    title="Nhấn giữ & kéo rê để di chuyển toàn bộ vùng highlight"
                  >
                    <Move className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform" />
                  </div>

                  {/* 4 Corner Resizing Handles */}
                  <div
                    style={{ left: `${rx}%`, top: `${ry}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'nw')}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-nwse-resize w-4 h-4 bg-amber-400 border-2 border-slate-950 rounded-full shadow-lg hover:scale-150 transition-transform"
                    title="Kéo chỉnh góc Trên-Trái"
                  />
                  <div
                    style={{ left: `${rx + rw}%`, top: `${ry}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'ne')}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-nesw-resize w-4 h-4 bg-amber-400 border-2 border-slate-950 rounded-full shadow-lg hover:scale-150 transition-transform"
                    title="Kéo chỉnh góc Trên-Phải"
                  />
                  <div
                    style={{ left: `${rx}%`, top: `${ry + rh}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'sw')}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-nesw-resize w-4 h-4 bg-amber-400 border-2 border-slate-950 rounded-full shadow-lg hover:scale-150 transition-transform"
                    title="Kéo chỉnh góc Dưới-Trái"
                  />
                  <div
                    style={{ left: `${rx + rw}%`, top: `${ry + rh}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'se')}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-nwse-resize w-4 h-4 bg-amber-400 border-2 border-slate-950 rounded-full shadow-lg hover:scale-150 transition-transform"
                    title="Kéo chỉnh góc Dưới-Phải"
                  />

                  {/* 4 Side Midpoint Handles */}
                  <div
                    style={{ left: `${cx}%`, top: `${ry}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'n')}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-ns-resize w-3.5 h-3.5 bg-amber-300 border-2 border-slate-900 rounded-sm shadow-md hover:scale-150 transition-transform"
                    title="Kéo chỉnh viền Cạnh Trên"
                  />
                  <div
                    style={{ left: `${cx}%`, top: `${ry + rh}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 's')}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-ns-resize w-3.5 h-3.5 bg-amber-300 border-2 border-slate-900 rounded-sm shadow-md hover:scale-150 transition-transform"
                    title="Kéo chỉnh viền Cạnh Dưới"
                  />
                  <div
                    style={{ left: `${rx}%`, top: `${cy}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'w')}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-ew-resize w-3.5 h-3.5 bg-amber-300 border-2 border-slate-900 rounded-sm shadow-md hover:scale-150 transition-transform"
                    title="Kéo chỉnh viền Cạnh Trái"
                  />
                  <div
                    style={{ left: `${rx + rw}%`, top: `${cy}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'e')}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-ew-resize w-3.5 h-3.5 bg-amber-300 border-2 border-slate-900 rounded-sm shadow-md hover:scale-150 transition-transform"
                    title="Kéo chỉnh viền Cạnh Phải"
                  />

                  {/* Polygon Point Handles (If polygon) */}
                  {isPolygon &&
                    room.points!.map((pt, pIdx) => (
                      <div
                        key={`poly-handle-${pIdx}`}
                        style={{ left: `${pt.x}%`, top: `${pt.y}%`, touchAction: 'none' }}
                        onPointerDown={(e) => handleStartDrag(e, room, pIdx)}
                        className="absolute -translate-x-1/2 -translate-y-1/2 z-45 pointer-events-auto cursor-crosshair w-4 h-4 bg-amber-500 border-2 border-slate-950 rounded-full shadow-lg hover:scale-150 transition-transform flex items-center justify-center text-[8px] font-black text-slate-950"
                        title={`Kéo di chuyển Đỉnh Góc #${pIdx + 1}`}
                      >
                        {pIdx + 1}
                      </div>
                    ))}


                </React.Fragment>
              );
            })}

            {/* LIVE 2-POINT DRAWING PREVIEW */}
            {drawStartPos && (
              <>
                <div
                  style={{ left: `${drawStartPos.x}%`, top: `${drawStartPos.y}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none"
                >
                  <div className="relative flex items-center justify-center">
                    <div className="w-5 h-5 bg-amber-500 rounded-full border-2 border-white animate-ping opacity-75 absolute" />
                    <div className="w-6 h-6 bg-amber-500 text-slate-950 rounded-full flex items-center justify-center font-black text-xs shadow-lg border-2 border-white">
                      1
                    </div>
                  </div>
                </div>

                {drawHoverPos && (
                  (() => {
                    const minX = Math.min(drawStartPos.x, drawHoverPos.x);
                    const minY = Math.min(drawStartPos.y, drawHoverPos.y);
                    const w = Math.abs(drawHoverPos.x - drawStartPos.x);
                    const h = Math.abs(drawHoverPos.y - drawStartPos.y);
                    return (
                      <div
                        style={{
                          left: `${minX}%`,
                          top: `${minY}%`,
                          width: `${w}%`,
                          height: `${h}%`,
                        }}
                        className="absolute border-2 border-dashed border-amber-400 bg-amber-400/30 rounded-xl backdrop-blur-[1px] z-20 pointer-events-none transition-all duration-75 shadow-xl"
                      />
                    );
                  })()
                )}
              </>
            )}
              </>
            )}

            {/* MINIMALIST OR FULL TEXT BADGES OVERLAY */}
            {(viewMode === 'all' || viewMode === 'highlight') && (
              <>
                {displayedFloorRooms.map((room) => {
                  const isPassed = room.inspectionStatus === 'Đạt nghiệm thu';
                  const isFailed = room.inspectionStatus === 'Chưa đạt (Cần sửa)';
                  const isHovered = hoveredRoomId === room.id;

                  // Compute center point for label positioning
                  let cx = room.x + room.width / 2;
                  let cy = room.y + room.height / 2;
                  if (room.points && room.points.length > 0) {
                    cx = room.points.reduce((acc, p) => acc + p.x, 0) / room.points.length;
                    cy = room.points.reduce((acc, p) => acc + p.y, 0) / room.points.length;
                  }

                  if (!showTextOverlay) {
                    // Minimalist Mode: Only render sleek room label badge OR hover tooltip!
                    return (
                      <React.Fragment key={room.id}>
                        {/* Sleek Minimal Room Name Badge at Center */}
                        <div
                          style={{ left: `${cx}%`, top: `${cy}%` }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRoomSelectClick(e, room);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setSelectedRoomForEdit(room);
                            setIsRoomModalOpen(true);
                          }}
                          className={`absolute -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-auto cursor-pointer transition-all ${
                            isHovered ? 'scale-110 z-30' : ''
                          }`}
                        >
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full shadow-md backdrop-blur-xs border flex items-center gap-1 ${
                            isFailed
                              ? 'bg-rose-950/90 text-rose-200 border-rose-500'
                              : isPassed
                              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500'
                              : 'bg-slate-950/85 text-slate-100 border-slate-600'
                          }`}>
                            {room.roomName}
                            {isPassed && ' 🏆'}
                            {isFailed && ' ⚠️'}
                          </span>
                        </div>

                        {/* Hover Popover Tooltip for Clean Mode */}
                        {isHovered && selectedRoomForDragId !== room.id && !selectedRoomIds.includes(room.id) && (
                          <div
                            style={{ left: `${cx}%`, top: `${cy + 6}%` }}
                            className="absolute -translate-x-1/2 z-40 pointer-events-none bg-slate-950/95 text-white p-2 rounded-xl text-[10px] font-bold shadow-2xl border border-slate-700 backdrop-blur-md flex flex-col gap-1 min-w-[130px] animate-in fade-in duration-150"
                          >
                            <div className="flex items-center justify-between text-amber-300 font-extrabold border-b border-slate-800 pb-1">
                              <span>{room.roomName}</span>
                              <span className="text-[9px]">
                                {isPassed ? '🏆 Đạt' : isFailed ? '⚠️ Sửa' : '⏳ Chờ'}
                              </span>
                            </div>
                            <div className="flex flex-col gap-1 text-[9px] pt-0.5">
                              <div className="flex flex-col gap-0.5 bg-slate-900/80 p-1 rounded border border-slate-700/50">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="text-emerald-400 font-bold">Khung:</span>
                                  <span>TC: {room.frameStatus === 'Đã hoàn thành' ? '✅' : '🚧'}</span>
                                  <span className={room.frameInspectionStatus === 'Đạt nghiệm thu' ? 'text-emerald-300 font-bold' : 'text-slate-400'}>
                                    NT: {room.frameInspectionStatus === 'Đạt nghiệm thu' ? '🏆' : room.frameInspectionStatus === 'Chưa đạt (Cần sửa)' ? '⚠️' : '⏳'}
                                  </span>
                                </div>
                                {room.targetFrameDate && (
                                  <div className="text-[8px] text-slate-400 font-medium flex items-center justify-between">
                                    <span>Hạn: {formatDateDDMMYYYY(room.targetFrameDate)}</span>
                                    {room.frameStatus !== 'Đã hoàn thành' && new Date(room.targetFrameDate).getTime() - new Date().getTime() <= 3 * 24 * 60 * 60 * 1000 && (
                                      <span className="text-amber-400 animate-pulse font-bold">⚠️ Sắp đến</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-col gap-0.5 bg-slate-900/80 p-1 rounded border border-slate-700/50">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="text-blue-400 font-bold">Tấm:</span>
                                  <span>TC: {room.boardStatus === 'Đã hoàn thành' ? '✅' : '🚧'}</span>
                                  <span className={room.boardInspectionStatus === 'Đạt nghiệm thu' ? 'text-blue-300 font-bold' : 'text-slate-400'}>
                                    NT: {room.boardInspectionStatus === 'Đạt nghiệm thu' ? '🏆' : room.boardInspectionStatus === 'Chưa đạt (Cần sửa)' ? '⚠️' : '⏳'}
                                  </span>
                                </div>
                                {room.targetBoardDate && (
                                  <div className="text-[8px] text-slate-400 font-medium flex items-center justify-between">
                                    <span>Hạn: {formatDateDDMMYYYY(room.targetBoardDate)}</span>
                                    {room.boardStatus !== 'Đã hoàn thành' && new Date(room.targetBoardDate).getTime() - new Date().getTime() <= 3 * 24 * 60 * 60 * 1000 && (
                                      <span className="text-rose-400 animate-pulse font-bold">⚠️ Sắp đến</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  }

                  // Full Text Overlay Mode (If toggled on)
                  return (
                    <div
                      key={room.id}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRoomSelectClick(e, room);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setSelectedRoomForEdit(room);
                        setIsRoomModalOpen(true);
                      }}
                      style={{
                        left: `${cx}%`,
                        top: `${cy}%`,
                      }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-auto cursor-pointer p-1 flex flex-col items-center gap-0.5 transition-all"
                    >
                      <div className="flex items-center gap-1">
                        <span className="font-extrabold text-[10px] truncate bg-black/85 text-white px-2 py-0.5 rounded-md shadow border border-white/20">
                          {room.roomName}
                        </span>
                        {isPassed && (
                          <span className="bg-emerald-600 text-white text-[9px] font-extrabold px-1 rounded-full shadow">
                            🏆
                          </span>
                        )}
                        {isFailed && (
                          <span className="bg-rose-600 text-white text-[9px] font-extrabold px-1 rounded-full shadow">
                            ⚠️
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 text-[8px] font-bold">
                        <span className={`px-1 py-0.2 rounded border ${
                          room.frameInspectionStatus === 'Đạt nghiệm thu'
                            ? 'bg-emerald-800 text-emerald-100 border-emerald-500'
                            : room.frameStatus === 'Đã hoàn thành'
                            ? 'bg-emerald-950 text-emerald-200 border-emerald-700'
                            : 'bg-slate-900 text-slate-300 border-slate-700'
                        }`}>
                          Khung: {room.frameInspectionStatus === 'Đạt nghiệm thu' ? '🏆' : room.frameStatus === 'Đã hoàn thành' ? '✓' : '⏳'}
                        </span>
                        <span className={`px-1 py-0.2 rounded border ${
                          room.boardInspectionStatus === 'Đạt nghiệm thu'
                            ? 'bg-blue-800 text-blue-100 border-blue-500'
                            : room.boardStatus === 'Đã hoàn thành'
                            ? 'bg-blue-950 text-blue-200 border-blue-700'
                            : 'bg-slate-900 text-slate-300 border-slate-700'
                        }`}>
                          Tấm: {room.boardInspectionStatus === 'Đạt nghiệm thu' ? '🏆' : room.boardStatus === 'Đã hoàn thành' ? '✓' : '⏳'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* MODE 2: DEFECT PIN OVERLAYS */}
            {(viewMode === 'all' || viewMode === 'defect') && (
              <>
                {floorDefects.map((defect) => {
                  const isResolved = defect.status === 'Đã nghiệm thu' || defect.status === 'Đã khắc phục';
                  const isSevere = defect.severity === 'Nghiêm trọng';

                  return (
                    <div
                      key={defect.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveDefectDetail(defect);
                      }}
                      style={{ left: `${defect.x}%`, top: `${defect.y}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-30 transition-transform hover:scale-125 active:scale-110"
                    >
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-white font-extrabold text-[10px] shadow-lg border-2 border-white ${
                          isResolved
                            ? 'bg-emerald-500'
                            : isSevere
                            ? 'bg-rose-600 animate-bounce'
                            : 'bg-amber-500'
                        }`}
                      >
                        📍
                      </div>
                      <div className="absolute top-7 left-1/2 -translate-x-1/2 bg-slate-900/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap shadow pointer-events-none">
                        {defect.id}
                      </div>
                    </div>
                  );
                })}

                {/* Pin indicator on click */}
                {pinPos && (
                  <div
                    style={{ left: `${pinPos.x}%`, top: `${pinPos.y}%` }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30"
                  >
                    <div className="w-8 h-8 rounded-full bg-blue-600/80 border-2 border-white animate-ping flex items-center justify-center text-white font-bold text-xs">
                      🎯
                    </div>
                  </div>
                )}

                {/* Compact Floating Paste & Position Action Target Popover */}
                {clickChoicePos && (
                  <div
                    style={{ left: `${clickChoicePos.x}%`, top: `${clickChoicePos.y}%` }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-auto bg-slate-950/95 text-white p-2.5 rounded-2xl shadow-2xl border border-indigo-500/80 backdrop-blur-md flex flex-col gap-2 min-w-[190px] animate-in zoom-in-95 duration-150"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1 text-[11px] font-extrabold text-amber-300">
                      <span>🎯 Vị trí ({clickChoicePos.x}%, {clickChoicePos.y}%)</span>
                      <button 
                        type="button"
                        onClick={() => setClickChoicePos(null)} 
                        className="text-slate-400 hover:text-white font-black px-1 text-xs"
                      >
                        ✕
                      </button>
                    </div>

                    {copiedRoomsState.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <button
                          type="button"
                          onClick={() => handlePasteRoom(clickChoicePos.x, clickChoicePos.y, false)}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-black rounded-xl flex items-center justify-center gap-1.5 shadow-xs active:scale-95 transition-all border border-indigo-400 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>📋 Dán thường (Tạo Bản Sao)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePasteRoom(clickChoicePos.x, clickChoicePos.y, true)}
                          className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-black rounded-xl flex items-center justify-center gap-1.5 shadow-xs active:scale-95 transition-all border border-emerald-400 cursor-pointer"
                          title="Giữ nguyên tên gốc, ghi đè/cập nhật nếu trùng tên"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>📝 Dán đè (Giữ nguyên tên)</span>
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-1.5 text-[10px] font-bold">
                      <button
                        type="button"
                        onClick={async () => {
                          setDrawTool('2point');
                          setDrawStartPos(clickChoicePos);
                          setDrawHoverPos(clickChoicePos);
                          setClickChoicePos(null);
                        }}
                        className="py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg flex items-center justify-center gap-1 font-extrabold"
                      >
                        <Sparkles className="w-3 h-3" />
                        Vẽ Khung
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setSelectedRoomForEdit(null);
                          setNewRoomClickPos(clickChoicePos);
                          setNewRoomRect({ x: clickChoicePos.x, y: clickChoicePos.y, width: 30, height: 20 });
                          setClickChoicePos(null);
                          setIsRoomModalOpen(true);
                        }}
                        className="py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg flex items-center justify-center gap-1"
                      >
                        <Building2 className="w-3 h-3 text-indigo-400" />
                        Thêm Căn
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
                  </div>
                </div>
            </div>
          </div>

          {/* Hint text */}
          <p className="text-[10px] text-slate-500 text-center italic">
            {viewMode === 'highlight' 
              ? '💡 Dùng công cụ "Vẽ Tự Do" hoặc "Vẽ 2 Điểm" để đánh dấu vùng thi công trên mặt bằng.' 
              : '💡 Bấm trực tiếp vào các ghim đỏ/vàng trên hình để xem ảnh & chi tiết lỗi.'}
          </p>
        </div>
      )}

      {/* SECTION FOR HIGHLIGHT MODE: ROOM PROGRESS DASHBOARD & LIST */}
      {(viewMode === 'highlight' || viewMode === 'all') && (
        <div className="space-y-3">
          {/* Progress Summary Cards - Separated Khung & Tấm */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            {/* Khung Summary Card */}
            <div className="bg-emerald-50/90 p-2.5 rounded-2xl border border-emerald-200/90 shadow-2xs space-y-1">
              <div className="flex items-center justify-between font-extrabold text-emerald-900">
                <span className="flex items-center gap-1 text-[11px]">🏗️ KHUNG TRẦN</span>
                <span className="text-[10px] bg-emerald-200/80 text-emerald-900 px-1.5 py-0.5 rounded-md font-black">
                  {roomSummary.frameInspectPercent}% Đạt
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px] pt-1 border-t border-emerald-200/60 font-semibold text-emerald-800">
                <div>
                  <span className="text-[9px] text-emerald-700 block">Thi công xong:</span>
                  <span className="font-extrabold">{roomSummary.frameDone}/{roomSummary.total} căn</span>
                </div>
                <div>
                  <span className="text-[9px] text-emerald-700 block">Đạt NT Khung:</span>
                  <span className="font-black text-emerald-950">{roomSummary.frameInspectPassed}/{roomSummary.total} căn</span>
                </div>
              </div>
            </div>

            {/* Tấm Summary Card */}
            <div className="bg-blue-50/90 p-2.5 rounded-2xl border border-blue-200/90 shadow-2xs space-y-1">
              <div className="flex items-center justify-between font-extrabold text-blue-900">
                <span className="flex items-center gap-1 text-[11px]">📄 TẤM THẠCH CAO</span>
                <span className="text-[10px] bg-blue-200/80 text-blue-900 px-1.5 py-0.5 rounded-md font-black">
                  {roomSummary.boardInspectPercent}% Đạt
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px] pt-1 border-t border-blue-200/60 font-semibold text-blue-800">
                <div>
                  <span className="text-[9px] text-blue-700 block">Bắn tấm xong:</span>
                  <span className="font-extrabold">{roomSummary.boardDone}/{roomSummary.total} căn</span>
                </div>
                <div>
                  <span className="text-[9px] text-blue-700 block">Đạt NT Tấm:</span>
                  <span className="font-black text-blue-950">{roomSummary.boardInspectPassed}/{roomSummary.total} căn</span>
                </div>
              </div>
            </div>

            {/* Total Overall Summary Card */}
            <div className="bg-amber-50/90 p-2.5 rounded-2xl border border-amber-200/90 shadow-2xs space-y-1 sm:col-span-1 col-span-1">
              <div className="flex items-center justify-between font-extrabold text-amber-900">
                <span className="flex items-center gap-1 text-[11px]">🏆 NT HOÀN THIỆN</span>
                <span className="text-[10px] bg-amber-200/80 text-amber-950 px-1.5 py-0.5 rounded-md font-black">
                  {roomSummary.inspectPercent}% Tổng
                </span>
              </div>
              <div className="pt-1 border-t border-amber-200/60 flex items-center justify-between text-[11px] font-semibold text-amber-900">
                <div>
                  <span className="text-[9px] text-amber-800 block">Đạt Cả Khung & Tấm:</span>
                  <span className="font-black text-amber-950 text-sm">{roomSummary.inspectedPassed}/{roomSummary.total} căn</span>
                </div>
              </div>
            </div>
          </div>

          {/* Room Cards List */}
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-indigo-600" />
                Nghiệm Thu Từng Căn Hộ / Phòng ({floorRooms.length})
              </h3>
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={downloadHighlightTemplate}
                  className="text-[11px] font-extrabold text-indigo-700 hover:text-indigo-900 bg-white hover:bg-slate-50 px-2.5 py-1.5 rounded-xl flex items-center gap-1 border border-slate-200 transition-all active:scale-95 shadow-2xs"
                  title="Tải tệp mẫu Excel để nhập danh sách hàng loạt"
                >
                  <Download className="w-3.5 h-3.5" /> Mẫu Excel
                </button>
                <label className="text-[11px] font-extrabold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-xl flex items-center gap-1 border border-emerald-200 cursor-pointer transition-all active:scale-95 shadow-2xs">
                  <Upload className="w-3.5 h-3.5" /> Nhập Excel
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleImportExcelHighlights}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  onClick={async () => {
                    setSelectedRoomForEdit(null);
                    setNewRoomClickPos({ x: 30, y: 30 });
                    setIsRoomModalOpen(true);
                  }}
                  className="text-xs font-extrabold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2.5 py-1 rounded-lg flex items-center gap-1 border border-indigo-200 transition-all active:scale-95 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Thêm Căn Hộ
                </button>
              </div>
            </div>

            {floorRooms.length === 0 ? (
              <div className="bg-white rounded-2xl p-6 text-center text-slate-400 text-xs border border-dashed border-slate-300">
                Chưa có phòng / căn hộ nào trên mặt bằng này. Hãy dùng công cụ vẽ để tạo vùng highlight!
              </div>
            ) : (
              <>
                {/* Quick Sort Controls */}
                <div className="flex items-center gap-2 bg-indigo-50/60 border border-indigo-100 rounded-xl px-3 py-2 text-xs text-slate-700 flex-wrap mb-2.5">
                  <span className="font-bold text-[11px] text-indigo-800 flex items-center gap-1">
                    <ArrowUpDown className="w-3.5 h-3.5 text-indigo-500" /> Sắp xếp nhanh:
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        if (roomSortBy === 'name') {
                          if (roomSortOrder === 'asc') {
                            setRoomSortOrder('desc');
                          } else {
                            setRoomSortBy('manual');
                          }
                        } else {
                          setRoomSortBy('name');
                          setRoomSortOrder('asc');
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg transition-all font-bold text-[11px] flex items-center gap-1 cursor-pointer ${
                        roomSortBy === 'name'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      Tên {roomSortBy === 'name' && (roomSortOrder === 'asc' ? '↑' : '↓')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (roomSortBy === 'createdAt') {
                          if (roomSortOrder === 'asc') {
                            setRoomSortOrder('desc');
                          } else {
                            setRoomSortBy('manual');
                          }
                        } else {
                          setRoomSortBy('createdAt');
                          setRoomSortOrder('asc');
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg transition-all font-bold text-[11px] flex items-center gap-1 cursor-pointer ${
                        roomSortBy === 'createdAt'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      Ngày tạo {roomSortBy === 'createdAt' && (roomSortOrder === 'asc' ? '↑' : '↓')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (roomSortBy === 'updatedAt') {
                          if (roomSortOrder === 'asc') {
                            setRoomSortOrder('desc');
                          } else {
                            setRoomSortBy('manual');
                          }
                        } else {
                          setRoomSortBy('updatedAt');
                          setRoomSortOrder('asc');
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg transition-all font-bold text-[11px] flex items-center gap-1 cursor-pointer ${
                        roomSortBy === 'updatedAt'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      Ngày chỉnh sửa {roomSortBy === 'updatedAt' && (roomSortOrder === 'asc' ? '↑' : '↓')}
                    </button>
                  </div>
                </div>

                {/* Bulk actions toolbar for rooms */}
                <div className="flex items-center justify-between bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-xs gap-2 mb-2">
                  <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={floorRooms.length > 0 && floorRooms.every(item => selectedApartmentIds.includes(item.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedApartmentIds(prev => Array.from(new Set([...prev, ...floorRooms.map(item => item.id)])));
                        } else {
                          setSelectedApartmentIds(prev => prev.filter(id => !floorRooms.some(item => item.id === id)));
                        }
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>Chọn Tất Cả Căn Hộ ({floorRooms.length})</span>
                  </label>

                  <div className="flex items-center gap-3 justify-end">
                    {selectedApartmentIds.some(id => floorRooms.some(item => item.id === id)) && (
                      <button
                        type="button"
                        onClick={async () => {
                          const idsToDelete = selectedApartmentIds.filter(id => floorRooms.some(item => item.id === id));
                          if (await confirmAsync(`Bạn có chắc muốn xóa ${idsToDelete.length} căn hộ/phòng đã chọn?`)) {
                            if (onDeleteMultipleRoomProgress) {
                              onDeleteMultipleRoomProgress(idsToDelete);
                            } else {
                              idsToDelete.forEach(id => onDeleteRoomProgress(id));
                            }
                            setSelectedApartmentIds(prev => prev.filter(id => !idsToDelete.includes(id)));
                          }
                        }}
                        className="text-rose-600 hover:text-rose-700 font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Xóa Đã Chọn ({selectedApartmentIds.filter(id => floorRooms.some(item => item.id === id)).length})
                      </button>
                    )}
                  </div>
                </div>

                {sortedFloorRooms.map((room, index) => (
                  <div
                    key={room.id}
                    draggable={roomSortBy === 'manual'}
                    onDragStart={(e) => {
                      if (roomSortBy !== 'manual') return;
                      e.dataTransfer.setData('text/plain', room.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.currentTarget.classList.add('opacity-40');
                    }}
                    onDragEnd={(e) => {
                      e.currentTarget.classList.remove('opacity-40');
                    }}
                    onDragOver={(e) => {
                      if (roomSortBy !== 'manual') return;
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (roomSortBy !== 'manual') return;
                      e.preventDefault();
                      const draggedId = e.dataTransfer.getData('text/plain');
                      if (draggedId && draggedId !== room.id) {
                        const draggedIndex = floorRooms.findIndex(r => r.id === draggedId);
                        const targetIndex = floorRooms.findIndex(r => r.id === room.id);
                        if (draggedIndex !== -1 && targetIndex !== -1) {
                          const updated = [...floorRooms];
                          const [removed] = updated.splice(draggedIndex, 1);
                          updated.splice(targetIndex, 0, removed);
                          if (onReorderRoomProgressList) {
                            onReorderRoomProgressList(updated);
                          }
                        }
                      }
                    }}
                    className={`bg-white rounded-2xl p-3.5 border border-slate-200/90 shadow-2xs space-y-2.5 hover:border-slate-300 transition-all ${
                      roomSortBy === 'manual' ? 'hover:bg-slate-50/40 select-none' : ''
                    }`}
                  >
                    {/* Card Header: Room Name + Badges */}
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2.5 mb-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {roomSortBy === 'manual' && (
                          <div className="flex flex-col items-center justify-center gap-0.5 shrink-0 select-none mr-1 bg-slate-50/50 border border-slate-200/40 w-6 h-8 rounded-lg shadow-3xs">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => {
                                const updated = [...floorRooms];
                                const idx = updated.findIndex(r => r.id === room.id);
                                if (idx > 0) {
                                  const temp = updated[idx];
                                  updated[idx] = updated[idx - 1];
                                  updated[idx - 1] = temp;
                                  if (onReorderRoomProgressList) onReorderRoomProgressList(updated);
                                }
                              }}
                              className="p-0.5 rounded hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer transition-colors"
                              title="Dời lên"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={index === sortedFloorRooms.length - 1}
                              onClick={() => {
                                const updated = [...floorRooms];
                                const idx = updated.findIndex(r => r.id === room.id);
                                if (idx !== -1 && idx < updated.length - 1) {
                                  const temp = updated[idx];
                                  updated[idx] = updated[idx + 1];
                                  updated[idx + 1] = temp;
                                  if (onReorderRoomProgressList) onReorderRoomProgressList(updated);
                                }
                              }}
                              className="p-0.5 rounded hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer transition-colors"
                              title="Dời xuống"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        <input
                          type="checkbox"
                          checked={selectedApartmentIds.includes(room.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedApartmentIds(prev => [...prev, room.id]);
                            } else {
                              setSelectedApartmentIds(prev => prev.filter(id => id !== room.id));
                            }
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0 transition-colors"
                        />
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold text-sm text-slate-800 truncate" title={room.roomName}>
                            {room.roomName}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            setSelectedRoomForEdit(room);
                            setIsRoomModalOpen(true);
                          }}
                          className="text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100/80 px-2.5 py-1 rounded-lg border border-indigo-200/60 transition-all flex items-center gap-1 cursor-pointer shadow-3xs active:scale-95"
                          title="Chỉnh sửa hoặc quản lý các hạng mục thi công"
                        >
                          <Pencil className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Chỉnh sửa</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setDeletingRoomTarget({ id: room.id, name: room.roomName })}
                          className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100/80 px-2.5 py-1 rounded-lg border border-rose-200/60 transition-all flex items-center gap-1 cursor-pointer shadow-3xs active:scale-95"
                          title="Xóa căn hộ / vùng highlight này"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                          <span>Xóa</span>
                        </button>

                        {/* Deleted redundant overall inspection status badge */}
                      </div>
                    </div>

                    {/* Sub-Items or Dual Grid */}
                    {room.subItems && room.subItems.length > 0 ? (
                      <div className="space-y-3">
                        {Object.entries(
                          (room.subItems || []).reduce((acc: Record<string, RoomSubItem[]>, sub) => {
                            const catName = sub.category || room.workCategory || 'Chưa phân nhóm';
                            if (!acc[catName]) {
                              acc[catName] = [];
                            }
                            acc[catName].push(sub);
                            return acc;
                          }, {} as Record<string, RoomSubItem[]>)
                        ).map(([catName, subsVal], catIdx) => {
                          const subs = subsVal as RoomSubItem[];
                          return (
                            <div key={`${catName}-${catIdx}`} className="space-y-2 border border-slate-100 bg-slate-50/50 p-2.5 rounded-xl">
                              {/* Group Header */}
                              <div className="flex items-center justify-between border-b border-slate-200/60 pb-1.5 mb-1 text-xs">
                                <span className="font-extrabold text-slate-800 flex items-center gap-1">
                                  🏗️ {catName}
                                </span>
                                {room.categoryVolumes?.[catName] !== undefined && room.categoryVolumes[catName] !== null && (
                                  <span className="text-[10px] font-extrabold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded">
                                    {room.categoryVolumes[catName]} {room.volumeUnit || 'm²'}
                                  </span>
                                )}
                              </div>

                              {/* Group Content */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                {subs.map((sub, idx) => (
                                  <div key={`${sub.id || 'sub'}-${idx}`} className="bg-white p-2 rounded-xl border border-slate-200/80 space-y-1.5">
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center justify-between font-bold text-[11px] text-slate-800 gap-1">
                                        <span className="truncate">#{idx + 1}. {sub.name}</span>
                                        {(sub.assignedTeam || sub.workVolume !== undefined) && (
                                          <span className="text-[10px] text-indigo-800 bg-indigo-50 border border-indigo-100 px-1.5 py-0.2 rounded shrink-0 font-semibold truncate max-w-[120px]">
                                            {sub.assignedTeam && `👷 ${sub.assignedTeam}`} {sub.workVolume !== undefined && `(${sub.workVolume} ${sub.volumeUnit || 'm²'})`}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-1 text-[10px]">
                                      <span className={`py-1 px-1.5 rounded-lg font-bold border text-center ${
                                        sub.status === 'Đã hoàn thành'
                                          ? 'bg-emerald-600 text-white border-emerald-600'
                                          : sub.status === 'Đang làm'
                                          ? 'bg-amber-500 text-white border-amber-500'
                                          : 'bg-white text-slate-600 border-slate-200'
                                      }`}>
                                        {sub.status === 'Đã hoàn thành' ? '✅ Xong' : sub.status === 'Đang làm' ? '🚧 Đang Làm' : '⏳ Chưa Làm'}
                                      </span>
                                      <span className={`py-1 px-1.5 rounded-lg font-black border text-center ${
                                        sub.inspectionStatus === 'Đạt nghiệm thu'
                                          ? 'bg-emerald-700 text-white border-emerald-700'
                                          : sub.inspectionStatus === 'Chưa đạt (Cần sửa)'
                                          ? 'bg-rose-600 text-white border-rose-600'
                                          : 'bg-white text-slate-700 border-slate-200'
                                      }`}>
                                        {sub.inspectionStatus === 'Đạt nghiệm thu' ? '🏆 Đạt NT' : sub.inspectionStatus === 'Chưa đạt (Cần sửa)' ? '⚠️ Lỗi NT' : '⏳ Chờ NT'}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {/* HẠNG MỤC KHUNG TRẦN */}
                      <div className="bg-slate-50 p-2 rounded-xl border border-slate-200/80 space-y-1.5">
                        <div className="flex items-center justify-between font-bold text-[11px] text-emerald-900">
                          <span>🏗️ Khung Trần:</span>
                        </div>

                        <div className="grid grid-cols-2 gap-1 text-[10px]">
                          <button
                            type="button"
                            onClick={(e) => handleCycleFrame(e, room)}
                            className={`py-1 px-1.5 rounded-lg font-bold transition-all border text-center ${
                              room.frameStatus === 'Đã hoàn thành'
                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                                : room.frameStatus === 'Đang làm'
                                ? 'bg-amber-500 text-white border-amber-500'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                            title="Bấm để chuyển trạng thái thi công Khung"
                          >
                            Thi công: {room.frameStatus === 'Đã hoàn thành' ? '✅ Xong Khung' : room.frameStatus === 'Đang làm' ? '🚧 Đang Làm' : '⏳ Chưa Làm'}
                          </button>

                          <button
                            type="button"
                            onClick={(e) => handleCycleFrameInspection(e, room)}
                            className={`py-1 px-1.5 rounded-lg font-black transition-all border text-center ${
                              room.frameInspectionStatus === 'Đạt nghiệm thu'
                                ? 'bg-emerald-700 text-white border-emerald-700 shadow-2xs'
                                : room.frameInspectionStatus === 'Chưa đạt (Cần sửa)'
                                ? 'bg-rose-600 text-white border-rose-600'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                            title="Bấm để chuyển kết quả Nghiệm Thu Khung Trần"
                          >
                            NT Khung: {room.frameInspectionStatus === 'Đạt nghiệm thu' ? '🏆 Đạt' : room.frameInspectionStatus === 'Chưa đạt (Cần sửa)' ? '⚠️ Sửa' : '⏳ Chờ'}
                          </button>
                        </div>
                      </div>

                      {/* HẠNG MỤC TẤM TRẦN */}
                      <div className="bg-slate-50 p-2 rounded-xl border border-slate-200/80 space-y-1.5">
                        <div className="flex items-center justify-between font-bold text-[11px] text-blue-900">
                          <span>📄 Tấm Trần:</span>
                        </div>

                        <div className="grid grid-cols-2 gap-1 text-[10px]">
                          <button
                            type="button"
                            onClick={(e) => handleCycleBoard(e, room)}
                            className={`py-1 px-1.5 rounded-lg font-bold transition-all border text-center ${
                              room.boardStatus === 'Đã hoàn thành'
                                ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                                : room.boardStatus === 'Đang làm'
                                ? 'bg-amber-500 text-white border-amber-500'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                            title="Bấm để chuyển trạng thái thi công Bắn Tấm"
                          >
                            Thi công: {room.boardStatus === 'Đã hoàn thành' ? '✅ Xong Tấm' : room.boardStatus === 'Đang làm' ? '🚧 Đang Bắn' : '⏳ Chưa Bắn'}
                          </button>

                          <button
                            type="button"
                            onClick={(e) => handleCycleBoardInspection(e, room)}
                            className={`py-1 px-1.5 rounded-lg font-black transition-all border text-center ${
                              room.boardInspectionStatus === 'Đạt nghiệm thu'
                                ? 'bg-blue-700 text-white border-blue-700 shadow-2xs'
                                : room.boardInspectionStatus === 'Chưa đạt (Cần sửa)'
                                ? 'bg-rose-600 text-white border-rose-600'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                            title="Bấm để chuyển kết quả Nghiệm Thu Tấm Trần"
                          >
                            NT Tấm: {room.boardInspectionStatus === 'Đạt nghiệm thu' ? '🏆 Đạt' : room.boardInspectionStatus === 'Chưa đạt (Cần sửa)' ? '⚠️ Sửa' : '⏳ Chờ'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {room.notes && (
                    <p className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded-xl border border-slate-100 font-medium">
                      📝 <span className="font-semibold text-slate-800">Ghi chú:</span> {room.notes}
                    </p>
                  )}
                </div>
              ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* SECTION FOR DEFECT MODE: DEFECT LIST & FILTER */}
      {(viewMode === 'defect' || viewMode === 'all') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Danh Sách Lỗi Defect ({filteredDefects.length})
            </h3>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-slate-200 text-xs font-semibold rounded-lg px-2 py-1 text-slate-700"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="Mới phát hiện">🔴 Mới phát hiện</option>
              <option value="Đang sửa">🟡 Đang sửa</option>
              <option value="Đã khắc phục">🟢 Đã khắc phục</option>
              <option value="Đã nghiệm thu">✅ Đã nghiệm thu</option>
            </select>
          </div>

          {filteredDefects.length > 0 && (
            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs gap-2">
              <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={filteredDefects.length > 0 && filteredDefects.every(item => selectedDefectIds.includes(item.id))}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedDefectIds(prev => Array.from(new Set([...prev, ...filteredDefects.map(item => item.id)])));
                    } else {
                      setSelectedDefectIds(prev => prev.filter(id => !filteredDefects.some(item => item.id === id)));
                    }
                  }}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <span>Chọn Tất Cả Lỗi ({filteredDefects.length})</span>
              </label>

              <div className="flex items-center gap-3 justify-end">
                {selectedDefectIds.some(id => filteredDefects.some(item => item.id === id)) && (
                  <button
                    type="button"
                    onClick={async () => {
                      const idsToDelete = selectedDefectIds.filter(id => filteredDefects.some(item => item.id === id));
                      if (await confirmAsync(`Bạn có chắc muốn xóa ${idsToDelete.length} lỗi defect đã chọn?`)) {
                        if (onDeleteMultipleDefects) {
                          onDeleteMultipleDefects(idsToDelete);
                        } else {
                          idsToDelete.forEach(id => onDeleteDefect(id));
                        }
                        setSelectedDefectIds(prev => prev.filter(id => !idsToDelete.includes(id)));
                      }
                    }}
                    className="text-rose-600 hover:text-rose-700 font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Xóa Đã Chọn ({selectedDefectIds.filter(id => filteredDefects.some(item => item.id === id)).length})
                  </button>
                )}
              </div>
            </div>
          )}

          {filteredDefects.length === 0 ? (
            <div className="bg-white rounded-2xl p-6 text-center text-slate-400 text-xs border border-dashed border-slate-300">
              Chưa có lỗi defect nào được ghi nhận trên mặt bằng này 🎉
            </div>
          ) : (
            filteredDefects.map((defect) => {
              const overdueInfo = getDefectOverdueInfo(defect);
              return (
                <div
                  key={defect.id}
                  onClick={() => setActiveDefectDetail(defect)}
                  className={`rounded-2xl p-3.5 border transition-all duration-150 space-y-2.5 hover:border-indigo-300 hover:shadow-md cursor-pointer ${
                    selectedDefectIds.includes(defect.id)
                      ? 'border-indigo-300 bg-indigo-50/10 shadow-xs'
                      : 'border-slate-200 bg-white shadow-xs'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={selectedDefectIds.includes(defect.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedDefectIds(prev => [...prev, defect.id]);
                        } else {
                          setSelectedDefectIds(prev => prev.filter(id => id !== defect.id));
                        }
                      }}
                      className="mt-1 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                    />

                    <div className="flex-1 min-w-0 space-y-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-3 h-3 rounded-full shrink-0 ${
                              defect.status === 'Đã nghiệm thu' || defect.status === 'Đã khắc phục'
                                ? 'bg-emerald-500'
                                : defect.severity === 'Nghiêm trọng'
                                ? 'bg-rose-600 animate-pulse'
                                : 'bg-amber-500'
                            }`}
                          />
                          <div>
                            <span className="text-[10px] font-black text-slate-400 mr-1.5">[{defect.id}]</span>
                            <span className="text-xs font-extrabold text-slate-900 leading-snug">{defect.category}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Overdue Badge */}
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${overdueInfo.badgeClass}`}>
                            {overdueInfo.shortText}
                          </span>
                          {/* Status Tag */}
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                              defect.status === 'Đã nghiệm thu' || defect.status === 'Đã khắc phục'
                                ? 'bg-emerald-100 text-emerald-800'
                                : defect.status === 'Đang sửa'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {defect.status}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs font-medium text-slate-700 line-clamp-2 leading-relaxed">{defect.description}</p>

                      {/* Enhanced Metadata Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[11px] bg-slate-50 p-2 rounded-xl border border-slate-100 text-slate-600">
                        <div>
                          <span className="text-slate-400 block text-[9px] font-bold uppercase">Người tạo</span>
                          <span className="font-bold text-slate-800">{defect.createdBy || 'Giám sát'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[9px] font-bold uppercase">Phụ trách</span>
                          <span className="font-bold text-slate-800">{defect.assignedTo}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[9px] font-bold uppercase">Deadline sửa</span>
                          <span className={`font-bold ${overdueInfo.isOverdue ? 'text-rose-600' : 'text-slate-800'}`}>
                            {defect.dueDate || 'Chưa đặt'}
                          </span>
                        </div>
                    <div>
                      <span className="text-slate-400 block text-[9px] font-bold uppercase">Ngày hoàn thành</span>
                      <span className="font-bold text-emerald-700">{defect.completedAt || 'Chưa xong'}</span>
                    </div>
                  </div>

                  {/* Photo Badges / Thumbnails */}
                  {(Boolean(defect.imageUrl) || Boolean(defect.afterImageUrl)) && (
                    <div className="flex items-center gap-3 pt-1">
                      {Boolean(defect.imageUrl) && (
                        <div
                          className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDefectLegacyImageViewer(defect, defect.imageUrl);
                          }}
                        >
                          <img src={defect.imageUrl} alt="Trước sửa" className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0" />
                          <span>Ảnh trước sửa</span>
                        </div>
                      )}
                      {Boolean(defect.afterImageUrl) && (
                        <div
                          className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDefectLegacyImageViewer(defect, defect.afterImageUrl);
                          }}
                        >
                          <img src={defect.afterImageUrl} alt="Sau sửa" className="w-8 h-8 rounded-lg object-cover border border-emerald-300 shrink-0" />
                          <span>✅ Ảnh sau sửa</span>
                        </div>
                      )}
                    </div>
                  )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Room Highlight Modal */}
      <RoomHighlightModal
        isOpen={isRoomModalOpen}
        onClose={() => setIsRoomModalOpen(false)}
        roomItem={selectedRoomForEdit}
        initialPos={newRoomClickPos}
        initialRect={newRoomRect}
        initialPoints={newRoomPoints}
        floorId={activeFloor?.id || 'fp-1'}
        floorName={activeFloor?.floorName || 'Tầng 1'}
        checklistItems={checklistItems}
        onSaveRoom={onSaveRoomProgress}
        onDeleteRoom={onDeleteRoomProgress}
        onStartRedraw2Point={handleStartRedraw2Point}
        teams={teams}
        materialNorms={materialNorms}
        inventory={inventory}
        workVolumes={workVolumes}
        defaultInspectorName={inspectorName}
        onAddInventory={onAddInventory}
      />

      {/* Add New Floor Plan Modal */}
      {showAddFloorModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-slate-900">Upload Mặt Bằng Thi Công Tầng</h3>
              <button onClick={() => setShowAddFloorModal(false)} className="font-bold text-slate-500">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Tên Tầng / Khu Vực</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Tầng 3, Tầng Thượng..."
                  value={newFloorName}
                  onChange={(e) => setNewFloorName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Chọn File Ảnh Bản Vẽ Mặt Bằng (PNG/JPG)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePlanFileChange}
                  disabled={isUploadingPlan || !newFloorName.trim()}
                  className="w-full text-xs text-slate-500 file:mr-3 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {isUploadingPlan && <p className="text-blue-600 text-[11px] mt-1">Dang xu ly ban ve va luu cuc bo...</p>}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddFloorModal(false)}
                  className="px-4 py-2 bg-slate-100 rounded-xl font-bold text-slate-600"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Defect Form Modal */}
      {showDefectModal && pinPos && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
                Định Vị Defect Vị Trí ({pinPos.x}%, {pinPos.y}%)
              </h3>
              <button onClick={handleCancelDefectModal} className="font-bold text-slate-500 hover:text-slate-700">✕</button>
            </div>

            <form onSubmit={handleCreateDefect} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Loại Lỗi Thạch Cao / Khung Trần</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as DefectCategory)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                >
                  {DEFECT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Mô Tả Lỗi Chi Tiết</label>
                <textarea
                  placeholder="Ví dụ: Bắn thiếu vít khoảng cách >30cm, khung trần bị võng 10mm..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl p-2.5"
                  required
                />
              </div>

              {/* 5 Key Control Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50 p-3 rounded-2xl border border-slate-200/80">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">👤 Người Tạo (QC / Giám Sát)</label>
                  <input
                    type="text"
                    value={createdBy}
                    onChange={(e) => setCreatedBy(e.target.value)}
                    placeholder="Tên kỹ sư QC..."
                    className="w-full border border-slate-200 bg-white rounded-xl p-2 font-semibold"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">⏱️ Deadline Sửa (Hạn Chót)</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full border border-slate-200 bg-white rounded-xl p-2 font-semibold"
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <TeamSelectorInput
                    value={assignedTo}
                    onChange={setAssignedTo}
                    pinPos={pinPos}
                    activeFloorRooms={floorRooms}
                    allRooms={roomProgressList}
                    declaredTeams={teams}
                    listId="defect-team-datalist-create"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">⚠️ Mức Độ Nghiêm Trọng</label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as DefectSeverity)}
                    className="w-full border border-slate-200 bg-white rounded-xl p-2 font-semibold"
                  >
                    <option value="Thấp">Thấp</option>
                    <option value="Trung bình">Trung bình</option>
                    <option value="Nghiêm trọng">Nghiêm trọng</option>
                  </select>
                </div>
              </div>

              {/* PhotoAttachmentPicker for multiple photo management during creation */}
              <div className="space-y-3 pt-1">
                <PhotoAttachmentPicker
                  projectId={currentProjectId}
                  entityType="defect"
                  entityId={draftDefectId}
                  category="defect_before"
                  label="📷 Ảnh Báo Lỗi Ban Đầu (Trước Sửa)"
                />
                <PhotoAttachmentPicker
                  projectId={currentProjectId}
                  entityType="defect"
                  entityId={draftDefectId}
                  category="defect_after"
                  label="🛠️ Ảnh Bằng Chứng Sau Khi Sửa (Tùy Chọn)"
                />
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleCancelDefectModal}
                  className="flex-1 py-3 bg-slate-100 rounded-xl font-bold text-slate-600"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold shadow-md"
                >
                  Lưu Defect Lên Mặt Bằng
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Defect Detail & Control Modal */}
      {activeDefectDetail && (() => {
        const overdueInfo = getDefectOverdueInfo(activeDefectDetail);
        const handleDetailFieldChange = (field: keyof DefectItem, value: any) => {
          let updated = { ...activeDefectDetail, [field]: value };
          if (field === 'assignedTo') {
            const matchingTeam = teams.find(t => t.name.trim().toLowerCase() === String(value).trim().toLowerCase());
            updated.teamId = matchingTeam?.id || undefined;
          }
          setActiveDefectDetail(updated);
          if (onUpdateDefect) {
            onUpdateDefect(updated);
          }
        };

        const handleStatusChange = (newStatus: DefectStatus) => {
          const todayStr = new Date().toISOString().split('T')[0];
          const updated = {
            ...activeDefectDetail,
            status: newStatus,
            completedAt: (newStatus === 'Đã khắc phục' || newStatus === 'Đã nghiệm thu')
              ? (activeDefectDetail.completedAt || todayStr)
              : activeDefectDetail.completedAt
          };
          setActiveDefectDetail(updated);
          if (onUpdateDefect) {
            onUpdateDefect(updated);
          } else {
            onUpdateDefectStatus(updated.id, newStatus);
          }
        };

        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <span className="text-[10px] font-black text-slate-400">[{activeDefectDetail.id}]</span>
                  <h3 className="text-base font-extrabold text-slate-900">{activeDefectDetail.category}</h3>
                </div>
                <button onClick={() => setActiveDefectDetail(null)} className="font-bold text-slate-400 hover:text-slate-700">✕</button>
              </div>

              {/* Overdue / Progress Banner */}
              <div className={`p-3 rounded-2xl border flex items-center justify-between gap-3 ${overdueInfo.badgeClass}`}>
                <div className="flex items-center gap-2.5">
                  <div>
                    <p className="font-black text-xs uppercase tracking-wide">{overdueInfo.statusText}</p>
                    <p className="text-[10px] opacity-80 font-medium">Trạng thái: {activeDefectDetail.status}</p>
                  </div>
                </div>
                {overdueInfo.isOverdue && (
                  <span className="text-[10px] font-black uppercase px-2.5 py-1 bg-rose-600 text-white rounded-lg animate-pulse shrink-0">
                    Cần xử lý gấp!
                  </span>
                )}
              </div>

              {/* Main Content */}
              <div className="space-y-3 text-xs">
                {/* Description Box */}
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Mô Tả Lỗi</label>
                  <textarea
                    value={activeDefectDetail.description}
                    onChange={(e) => handleDetailFieldChange('description', e.target.value)}
                    rows={2}
                    className="w-full border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800"
                  />
                  <div className="flex items-center justify-between gap-2 mt-1 flex-wrap">
                    <p className="text-[10px] text-slate-500 font-medium">📍 Vị trí trên mặt bằng: {activeDefectDetail.floorName || 'Mặt bằng'} ({Math.round(activeDefectDetail.x)}%, {Math.round(activeDefectDetail.y)}%)</p>
                    <button
                      type="button"
                      onClick={() => {
                        const targetFp = floorPlans.find(f => f.id === activeDefectDetail.floorId || f.floorName === activeDefectDetail.floorName);
                        if (targetFp) {
                          setSelectedFloorId(targetFp.id);
                        }
                        setSelectedDefectIds([activeDefectDetail.id]);
                        setActiveDefectDetail(null);
                        if (imageContainerRef.current) {
                          imageContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded-lg text-[11px] font-bold transition-all shadow-2xs shrink-0"
                    >
                      <MapPin className="w-3 h-3 text-indigo-600" />
                      <span>Xem vị trí trên mặt bằng</span>
                    </button>
                  </div>
                </div>

                {/* 5 Control Fields Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50 p-3 rounded-2xl border border-slate-200/80">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">👤 Người Tạo (QC / Giám Sát)</label>
                    <input
                      type="text"
                      value={activeDefectDetail.createdBy || ''}
                      onChange={(e) => handleDetailFieldChange('createdBy', e.target.value)}
                      placeholder="Nhập tên người tạo..."
                      className="w-full border border-slate-200 bg-white rounded-xl p-2 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">⏱️ Deadline Sửa (Hạn Chót)</label>
                    <input
                      type="date"
                      value={activeDefectDetail.dueDate || ''}
                      onChange={(e) => handleDetailFieldChange('dueDate', e.target.value)}
                      className="w-full border border-slate-200 bg-white rounded-xl p-2 font-semibold"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <TeamSelectorInput
                      value={activeDefectDetail.assignedTo || ''}
                      onChange={(val) => handleDetailFieldChange('assignedTo', val)}
                      pinPos={{ x: activeDefectDetail.x, y: activeDefectDetail.y }}
                      activeFloorRooms={floorRooms}
                      allRooms={roomProgressList}
                      declaredTeams={teams}
                      listId="defect-team-datalist-detail"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">🏁 Ngày Hoàn Thành Thực Tế</label>
                    <input
                      type="date"
                      value={activeDefectDetail.completedAt || ''}
                      onChange={(e) => handleDetailFieldChange('completedAt', e.target.value)}
                      className="w-full border border-slate-200 bg-white rounded-xl p-2 font-semibold"
                    />
                  </div>
                </div>

                {/* Bộ Sưu Tập Ảnh Đính Kèm (Defect Photos) */}
                <div className="space-y-3 pt-1 border-t border-slate-100">
                  <PhotoAttachmentPicker
                    projectId={currentProjectId}
                    entityType="defect"
                    entityId={activeDefectDetail.id}
                    category="defect_before"
                    label="📷 Ảnh Báo Lỗi Ban Đầu (Trước Sửa)"
                  />
                  <PhotoAttachmentPicker
                    projectId={currentProjectId}
                    entityType="defect"
                    entityId={activeDefectDetail.id}
                    category="defect_after"
                    label="🛠️ Ảnh Bằng Chứng Sau Khi Sửa (Tùy Chọn)"
                  />
                </div>

                {/* Status Update Action Grid */}
                <div>
                  <label className="block text-slate-700 font-bold mb-1.5">Cập Nhật Trạng Thái Kiểm Soát</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    <button
                      onClick={() => handleStatusChange('Mới phát hiện')}
                      className={`py-2 px-1 rounded-xl font-bold text-[11px] transition-all ${
                        activeDefectDetail.status === 'Mới phát hiện' ? 'bg-rose-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      🔴 Mới Báo
                    </button>

                    <button
                      onClick={() => handleStatusChange('Đang sửa')}
                      className={`py-2 px-1 rounded-xl font-bold text-[11px] transition-all ${
                        activeDefectDetail.status === 'Đang sửa' ? 'bg-amber-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      🟡 Đang Sửa
                    </button>

                    <button
                      onClick={() => handleStatusChange('Đã khắc phục')}
                      className={`py-2 px-1 rounded-xl font-bold text-[11px] transition-all ${
                        activeDefectDetail.status === 'Đã khắc phục' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      🟢 Đã Khắc Phục
                    </button>

                    <button
                      onClick={() => handleStatusChange('Đã nghiệm thu')}
                      className={`py-2 px-1 rounded-xl font-bold text-[11px] transition-all ${
                        activeDefectDetail.status === 'Đã nghiệm thu' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      ✅ Nghiệm Thu
                    </button>
                  </div>
                </div>

                {/* Footer buttons */}
                <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                  <button
                    onClick={async () => {
                      setDeletingDefectTarget(activeDefectDetail);
                      setActiveDefectDetail(null);
                    }}
                    className="text-rose-600 font-bold text-xs hover:underline"
                  >
                    Xóa Lỗi
                  </button>
                  <button
                    onClick={() => setActiveDefectDetail(null)}
                    className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold"
                  >
                    Lưu &amp; Đóng
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}



      {/* MANAGE FLOORS MODAL (Tùy Chỉnh, Đổi Tên, Nhân Bản, Xóa Tầng) */}
      {showManageFloorsModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-indigo-600" />
                  Quản Lý &amp; Tùy Chỉnh Các Tầng ({floorPlans.length})
                </h3>
                <p className="text-xs text-slate-500 font-medium">Thêm, xóa, đổi tên, hoặc sao chép nhân bản thiết kế tầng</p>
              </div>
              <button onClick={() => setShowManageFloorsModal(false)} className="font-bold text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>

            {/* Quick Sort Floors Controls */}
            <div className="flex items-center gap-2 bg-indigo-50/60 border border-indigo-100 rounded-xl px-3 py-2 text-xs text-slate-700 flex-wrap">
              <span className="font-bold text-[11px] text-indigo-800 flex items-center gap-1">
                <ArrowUpDown className="w-3.5 h-3.5 text-indigo-500" /> Sắp xếp nhanh:
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    if (floorSortBy === 'name') {
                      if (floorSortOrder === 'asc') {
                        setFloorSortOrder('desc');
                      } else {
                        setFloorSortBy('none');
                      }
                    } else {
                      setFloorSortBy('name');
                      setFloorSortOrder('asc');
                    }
                  }}
                  className={`px-2.5 py-1 rounded-lg transition-all font-bold text-[11px] flex items-center gap-1 cursor-pointer ${
                    floorSortBy === 'name'
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                  }`}
                >
                  Tên {floorSortBy === 'name' && (floorSortOrder === 'asc' ? '↑' : '↓')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (floorSortBy === 'rooms') {
                      if (floorSortOrder === 'asc') {
                        setFloorSortOrder('desc');
                      } else {
                        setFloorSortBy('none');
                      }
                    } else {
                      setFloorSortBy('rooms');
                      setFloorSortOrder('asc');
                    }
                  }}
                  className={`px-2.5 py-1 rounded-lg transition-all font-bold text-[11px] flex items-center gap-1 cursor-pointer ${
                    floorSortBy === 'rooms'
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                  }`}
                >
                  Số Căn Hộ {floorSortBy === 'rooms' && (floorSortOrder === 'asc' ? '↑' : '↓')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (floorSortBy === 'defects') {
                      if (floorSortOrder === 'asc') {
                        setFloorSortOrder('desc');
                      } else {
                        setFloorSortBy('none');
                      }
                    } else {
                      setFloorSortBy('defects');
                      setFloorSortOrder('asc');
                    }
                  }}
                  className={`px-2.5 py-1 rounded-lg transition-all font-bold text-[11px] flex items-center gap-1 cursor-pointer ${
                    floorSortBy === 'defects'
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                  }`}
                >
                  Số Ghim Lỗi {floorSortBy === 'defects' && (floorSortOrder === 'asc' ? '↑' : '↓')}
                </button>
              </div>
            </div>

            {/* List of Floor Plans */}
            <div className="space-y-2.5">
              {sortedFloorPlans.map((fp, index) => {
                const isSelected = selectedFloorId === fp.id;
                const roomCount = roomProgressList.filter((r) => r.floorId === fp.id).length;
                const defectCount = defects.filter((d) => d.floorId === fp.id).length;
                const isEditingThis = editingFloorId === fp.id;

                return (
                  <div
                    key={fp.id}
                    className={`p-3 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                      isSelected
                        ? 'bg-indigo-50/50 border-indigo-300 ring-1 ring-indigo-200'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden shrink-0 relative group">
                        {fp.imageUrl ? (
                          <img src={fp.imageUrl} alt={fp.floorName} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400 font-bold bg-slate-100">
                            No img
                          </div>
                        )}
                      </div>

                      <div className="space-y-0.5">
                        {isEditingThis ? (
                          <div className="flex items-center gap-1.5 w-full sm:w-auto">
                            <input
                              type="text"
                              value={editingFloorName}
                              onChange={(e) => setEditingFloorName(e.target.value)}
                              className="border border-indigo-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                if (editingFloorName.trim() && onRenameFloorPlan) {
                                  onRenameFloorPlan(fp.id, editingFloorName.trim());
                                }
                                setEditingFloorId(null);
                              }}
                              className="bg-emerald-600 text-white p-1 rounded-lg text-xs font-bold hover:bg-emerald-700"
                              title="Lưu tên"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingFloorId(null)}
                              className="bg-slate-200 text-slate-700 p-1 rounded-lg text-xs font-bold hover:bg-slate-300"
                              title="Hủy"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-sm text-slate-900">{fp.floorName}</span>
                            {isSelected && (
                              <span className="bg-indigo-600 text-white text-[9px] font-extrabold px-2 py-0.2 rounded-full">
                                Đang xem
                              </span>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium">
                          <span>🎨 {roomCount} căn hộ</span>
                          <span>•</span>
                          <span>📌 {defectCount} ghim lỗi</span>
                        </div>
                      </div>
                    </div>

                    {/* Floor Action Buttons */}
                    <div className="flex items-center gap-1.5 self-end sm:self-center flex-wrap">
                      {/* Move Up / Move Left */}
                      {index > 0 && floorSortBy === 'none' && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (onMoveFloorPlan) onMoveFloorPlan(fp.id, 'left');
                          }}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 p-1.5 rounded-xl text-xs font-bold transition-all"
                          title="Dời tầng lên trước"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Move Down / Move Right */}
                      {index < sortedFloorPlans.length - 1 && floorSortBy === 'none' && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (onMoveFloorPlan) onMoveFloorPlan(fp.id, 'right');
                          }}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 p-1.5 rounded-xl text-xs font-bold transition-all"
                          title="Dời tầng xuống sau"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {!isSelected && (
                        <button
                          type="button"
                          onClick={async () => {
                            setSelectedFloorId(fp.id);
                            setShowManageFloorsModal(false);
                          }}
                          className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all"
                        >
                          Xem
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={async () => {
                          setUpdatingFloorPlanId(fp.id);
                          updatePlanInputRef.current?.click();
                        }}
                        className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all"
                        title="Cập nhật tệp ảnh hoặc PDF bản vẽ mới cho tầng này"
                      >
                        <Upload className="w-3.5 h-3.5 text-emerald-600" />
                        Bản Vẽ
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          setEditingFloorId(fp.id);
                          setEditingFloorName(fp.floorName);
                        }}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all"
                        title="Đổi tên tầng"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-indigo-600" />
                        Tên
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDuplicateFloor(fp.id, fp.floorName)}
                        className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all"
                        title="Sao chép nhân bản mặt bằng tầng kèm các vùng highlight"
                      >
                        <Copy className="w-3.5 h-3.5 text-indigo-600" />
                        Nhân Bản
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteFloor(fp.id, fp.floorName)}
                        className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all"
                        title="Xóa tầng này"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom Add Actions */}
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={async () => {
                  setShowManageFloorsModal(false);
                  setShowQuickAddFloorModal(true);
                }}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all"
              >
                <Plus className="w-4 h-4" />
                ⚡ Thêm Tầng Nhanh (Không Cần Ảnh)
              </button>

              <button
                type="button"
                onClick={async () => {
                  setShowManageFloorsModal(false);
                  setShowAddFloorModal(true);
                }}
                className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all"
              >
                <Upload className="w-4 h-4" />
                📤 Upload Bản Vẽ Ảnh / PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUICK ADD FLOOR MODAL (Thêm Tầng Nhanh) */}
      {showQuickAddFloorModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-2xl p-5 space-y-4 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-600" />
                Thêm Tầng Mới Cho Dự Án
              </h3>
              <button onClick={() => setShowQuickAddFloorModal(false)} className="font-bold text-slate-400">✕</button>
            </div>

            <form onSubmit={handleQuickAddFloorSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Tên Tầng / Khu Vực Mới</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Tầng 3, Tầng 4, Tầng Thượng..."
                  value={quickFloorNameInput}
                  onChange={(e) => setQuickFloorNameInput(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl p-2.5 font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                  required
                />
              </div>

              <p className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100 italic">
                💡 Hệ thống sẽ tự động khởi tạo mặt bằng cho tầng mới. Bạn có thể tự do vẽ các khung highlight hoặc tải bản vẽ riêng lên bất kỳ lúc nào!
              </p>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowQuickAddFloorModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 rounded-xl font-bold text-slate-600 hover:bg-slate-200"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md"
                >
                  Tạo Tầng
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE FLOOR MODAL */}
      {deletingFloorTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-sm rounded-2xl p-5 space-y-4 shadow-2xl border border-rose-100 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 mx-auto flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Xác Nhận Xóa Mặt Bằng Tầng</h3>
              <p className="text-xs text-slate-500 mt-1">
                Bạn có chắc chắn muốn xóa <span className="font-bold text-rose-600">"{deletingFloorTarget.name}"</span>?
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Tất cả các vùng highlight căn hộ và ghim lỗi defect của tầng này sẽ bị xóa.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingFloorTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-all"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteFloor}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-extrabold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                Xóa Tầng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DUPLICATE FLOOR MODAL */}
      {duplicatingFloorTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-sm rounded-2xl p-5 space-y-4 shadow-2xl border border-indigo-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                <Copy className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Nhân Bản Tầng</h3>
                <p className="text-xs text-slate-500">Tạo bản sao mặt bằng từ <strong className="text-slate-800">{duplicatingFloorTarget.name}</strong></p>
              </div>
            </div>

            <form onSubmit={handleConfirmDuplicateFloor} className="space-y-3">
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Tên mặt bằng tầng mới:
                </label>
                <input
                  type="text"
                  value={duplicateFloorNameInput}
                  onChange={(e) => setDuplicateFloorNameInput(e.target.value)}
                  placeholder="VD: Tầng 2, Tầng 3..."
                  className="w-full text-xs font-bold bg-slate-50 border border-slate-200 focus:border-indigo-500 rounded-xl px-3 py-2.5 outline-none"
                  autoFocus
                  required
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDuplicatingFloorTarget(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-all"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-extrabold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-4 h-4" />
                  Xác Nhận Nhân Bản
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE ROOM HIGHLIGHT MODAL */}
      {deletingRoomTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-sm rounded-2xl p-5 space-y-4 shadow-2xl border border-rose-100 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 mx-auto flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Xóa Vùng Highlight Căn Hộ</h3>
              <p className="text-xs text-slate-500 mt-1">
                Xóa vùng highlight <span className="font-bold text-rose-600">"{deletingRoomTarget.name}"</span>?
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingRoomTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-all"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteRoom}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-extrabold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                Xác Nhận Xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE DEFECT PIN MODAL */}
      {deletingDefectTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-sm rounded-2xl p-5 space-y-4 shadow-2xl border border-rose-100 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 mx-auto flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Xác Nhận Xóa Pin Defect</h3>
              <p className="text-xs text-slate-500 mt-1">
                Bạn có chắc chắn muốn xóa báo lỗi <strong className="text-slate-800 font-bold">[{deletingDefectTarget.id}] - {deletingDefectTarget.category}</strong> tại vị trí ({deletingDefectTarget.x}%, {deletingDefectTarget.y}%) không?
              </p>
              <p className="text-[11px] text-indigo-600 mt-1 font-medium">💡 Thao tác này có thể Hoàn Tác (Undo).</p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingDefectTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-all"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={async () => {
                  onDeleteDefect(deletingDefectTarget.id);
                  setDeletingDefectTarget(null);
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-extrabold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                Xác Nhận Xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE ORPHANED ROOMS MODAL */}
      {confirmDeleteOrphanedModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-sm rounded-2xl p-5 space-y-4 shadow-2xl border border-rose-100 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 mx-auto flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Xác Nhận Xóa Phòng Ẩn</h3>
              <p className="text-xs text-slate-500 mt-1">
                Bạn có chắc chắn muốn xóa toàn bộ <span className="font-bold text-rose-600">{orphanedRooms.length} phòng ẩn / mất liên kết</span> khỏi hệ thống không?
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteOrphanedModal(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteAllOrphaned}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-extrabold text-xs shadow-md"
              >
                Xác Nhận Xóa Sạch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Editor Modal */}
      {editingPhotoUrl && (
        <ImageEditorModal
          isOpen={isImageEditorOpen}
          onClose={() => {
            setIsImageEditorOpen(false);
            setEditingPhotoUrl(null);
            if (photoInputRef.current) photoInputRef.current.value = '';
          }}
          imageUrl={editingPhotoUrl}
          onSave={handleSaveEditedPhoto}
        />
      )}

      {/* Image Viewer Modal */}
      {viewingImageUrl && (
        <ImageViewerModal
          isOpen={!!viewingImageUrl}
          onClose={() => setViewingImageUrl(null)}
          imageUrl={viewingImageUrl}
        />
      )}

      {viewingImageSet && (
        <ImageViewerModal
          isOpen={!!viewingImageSet}
          onClose={() => setViewingImageSet(null)}
          images={viewingImageSet.images}
          initialIndex={viewingImageSet.initialIndex}
        />
      )}

      {/* MOBILE LONG PRESS TOUCH CONTEXT MENU */}
      {touchMenu && (
        <div 
          className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px]" 
          onClick={(e) => {
            e.stopPropagation();
            setTouchMenu(null);
          }}
        >
          <div
            style={{
              position: 'fixed',
              top: Math.min(window.innerHeight - 200, Math.max(10, touchMenu.clientY)),
              left: Math.min(window.innerWidth - 200, Math.max(10, touchMenu.clientX)),
            }}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 shadow-2xl rounded-2xl p-2.5 w-52 flex flex-col gap-1 z-55 animate-in fade-in zoom-in duration-100"
          >
            <div className="px-2 py-1 text-[10px] text-slate-400 font-extrabold uppercase border-b border-slate-100 pb-1.5 mb-1 truncate">
              {touchMenu.room ? `Căn: ${touchMenu.room.roomName}` : 'Mặt bằng'}
            </div>
            
            {touchMenu.room ? (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyRoom(touchMenu.room!);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50 active:bg-slate-100 rounded-lg text-left transition-colors"
                >
                  <Copy className="w-4 h-4 text-slate-500" />
                  Sao chép căn
                </button>
                
                {copiedRoomsState.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePasteRoom(touchMenu.rawX, touchMenu.rawY, false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-extrabold text-indigo-600 hover:bg-indigo-50 active:bg-indigo-100 rounded-lg text-left transition-colors cursor-pointer"
                    >
                      <Check className="w-4 h-4 text-indigo-500" />
                      Dán thường (Tạo Bản Sao)
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePasteRoom(touchMenu.rawX, touchMenu.rawY, true);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-extrabold text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 rounded-lg text-left transition-colors cursor-pointer"
                    >
                      <Check className="w-4 h-4 text-emerald-500" />
                      Dán đè (Giữ nguyên tên)
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteRoom(touchMenu.room!);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-extrabold text-rose-600 hover:bg-rose-50 active:bg-rose-100 rounded-lg text-left transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4 text-rose-500" />
                  Xóa căn
                </button>
              </>
            ) : (
              <>
                {copiedRoomsState.length > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePasteRoom(touchMenu.rawX, touchMenu.rawY, false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-extrabold text-indigo-600 hover:bg-indigo-50 active:bg-indigo-100 rounded-lg text-left transition-colors cursor-pointer"
                    >
                      <Check className="w-4 h-4 text-indigo-500" />
                      Dán thường (Tạo Bản Sao)
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePasteRoom(touchMenu.rawX, touchMenu.rawY, true);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-extrabold text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 rounded-lg text-left transition-colors cursor-pointer"
                    >
                      <Check className="w-4 h-4 text-emerald-500" />
                      Dán đè (Giữ nguyên tên)
                    </button>
                  </>
                ) : (
                  <div className="px-2 py-1.5 text-[10px] text-amber-600 font-extrabold text-center bg-amber-50 rounded-lg leading-relaxed">
                    Vui lòng đè vào một căn để Sao chép trước!
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
