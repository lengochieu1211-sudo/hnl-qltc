import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
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
  ChevronsDown,
  ChevronsUp,
  Palette,
  ArrowUpDown,
  GripVertical
} from 'lucide-react';
import { FloorPlan, DefectItem, DefectCategory, DefectSeverity, DefectStatus, RoomProgressItem, RoomSubItem, Point2D, ChecklistItem, TeamInfo, MaterialNorm, InventoryItem, WorkVolume } from '../types';
import { UndoRedoControls } from './UndoRedoControls';
import { getRoomColorStyle, ROOM_COLOR_PALETTE } from '../utils/colorPalette';
import { getDefectOverdueInfo, getDefectShortCode } from '../utils/defectUtils';
import { formatDateDDMMYYYY, parseLegacyTimestamp } from '../utils/dateFormatter';
import { useFormatSettings, parseExcelNumber, formatDecimal } from '../utils/numberUtils';
import { createEntityId } from '../utils/idUtils';
import { normalizeUnit, unitKey } from '../utils/unitUtils';
import { ImageViewerModal } from './ImageViewerModal';
import { ImageEditorModal } from './ImageEditorModal';
import { RoomHighlightModal } from './RoomHighlightModal';
import { PhotoAttachmentPicker } from './PhotoAttachmentPicker';
import { PhotoAttachment, deleteEntityPhotos, getEntityPhotos, getPhotoDataUrl, isPhotoSharedCloudReady, savePhotoAttachment } from '../utils/photoStorage';
import { safeSetLocalStorageItem } from '../utils/storage';
import { getAsyncItem, removeAsyncItem } from '../utils/asyncStorage';
import { saveWorkbookFile } from '../utils/fileExport';
import { convertPdfToImage, describePdfError, getPdfDocumentInfo, loadPdfDocument, renderPdfDocumentPageToImage } from '../utils/pdfToImage';
import { getImageQualityProfile } from '../utils/imageQualitySettings';
import { detectPdfRoomCandidatesFromDocument, DEFAULT_PDF_ROOM_NAME_PATTERN, PdfRoomCandidate } from '../utils/pdfRoomDetection';
import { QuickSortBar } from './QuickSortBar';
import { MoveOrderControls } from './MoveOrderControls';
import { UserRole, canManageFloorPlanStructure, canEditDefectData, canDeleteBusinessData } from '../utils/securityUtils';
import { appendRuntimeDiagnostic } from '../lib/runtimeDiagnostics';
import { ContactMenu } from './ContactMenu';
import { buildDefectShareText, resolveDefectTeam } from '../utils/defectContactUtils';
import { isPointInsideRoom, reconcileDefectLinkage, resolveDefectLinkageFromSelection } from '../utils/defectLinkageUtils';

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

const isPointInRoom = isPointInsideRoom;

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
            <optgroup label="📍 Đội thuộc Căn / Phòng hiện tại">
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
  userRole?: UserRole;
  roleResolved?: boolean;
  onAddInventory?: (item: Omit<InventoryItem, 'id'> & { id?: string }) => void;
  onAddFloorPlan: (plan: Omit<FloorPlan, 'id'> & { id?: string }) => void;
  onUpdateFloorPlan?: (id: string, updates: Partial<FloorPlan>) => void;
  onUpdateFloorPlanImage?: (id: string, imageUrl: string) => void;
  onRenameFloorPlan?: (id: string, newName: string) => void;
  onDeleteFloorPlan?: (id: string) => void;
  onDeleteMultipleFloorPlans?: (ids: string[]) => void;
  onDuplicateFloorPlan?: (id: string, customName?: string) => void;
  onMoveFloorPlan?: (id: string, direction: 'left' | 'right') => void;
  onAddDefect: (defect: Omit<DefectItem, 'id' | 'createdAt'> & { id?: string }) => void;
  onUpdateDefectStatus: (id: string, status: DefectStatus) => void;
  onUpdateDefect?: (defect: DefectItem) => void;
  onDeleteDefect: (id: string) => void;
  onDeleteMultipleDefects?: (ids: string[]) => void;
  onSaveRoomProgress: (room: Omit<RoomProgressItem, 'id' | 'updatedAt'> & { id?: string }) => void;
  onBatchSaveRooms?: (rooms: RoomProgressItem[]) => void;
  onCreateMultipleRoomProgress?: (rooms: RoomProgressItem[]) => void;
  onDeleteRoomProgress: (id: string) => void;
  onDeleteMultipleRoomProgress?: (ids: string[]) => void;
  onReorderRoomProgressList?: (reorderedList: RoomProgressItem[]) => void;
  onReorderFloorPlans?: (reorderedList: FloorPlan[]) => void;
  onActiveFloorChange?: (floorId: string) => void;
  onOpenExportPdf?: () => void;
  onExportExcel?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

const DEFECT_CATEGORIES: DefectCategory[] = [
  'Khung trần',
  'Tấm thạch cao',
  'Vách thạch cao',
  'Hoàn thiện bả sơn',
  'Khe hở / mối nối',
  'Ty treo / phụ kiện',
  'Sai vị trí / sai cao độ',
  'Thiết bị liên quan',
  'Vệ sinh / bảo vệ thành phẩm',
  'Khác',
];

type DefectSortBy = 'createdAt' | 'priority' | 'category' | 'floorName' | 'roomName' | 'severity' | 'dueDate' | 'status' | 'assignedTo';
type SortOrder = 'asc' | 'desc';

interface PendingSmartPdfImport {
  floorId: string;
  floorName: string;
  fileName: string;
  imageUrl: string;
  pageNumber: number;
  pageCount: number;
  rooms: PdfRoomCandidate[];
}


const compareVietnameseText = (a: string | undefined, b: string | undefined) =>
  (a || '').localeCompare(b || '', 'vi', { numeric: true, sensitivity: 'base' });

const normalizeVietnameseSearchText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const getSuggestedDefectCategory = (description: string): DefectCategory | null => {
  const text = normalizeVietnameseSearchText(description);
  if (!text.trim()) return null;

  if (/(vach)/.test(text)) return 'Vách thạch cao';
  if (/(xuong|khung|thanh chinh|thanh phu|cong|venh)/.test(text)) return 'Khung trần';
  if (/(tam|ban tam|thieu tam|nut|vo|vong|lech tam)/.test(text)) return 'Tấm thạch cao';
  if (/(ba|son|hoan thien|tray|do ban|be mat)/.test(text)) return 'Hoàn thiện bả sơn';
  if (/(khe|mi|moi noi|ho)/.test(text)) return 'Khe hở / mối nối';
  if (/(ty treo|lien ket|phu kien|vit)/.test(text)) return 'Ty treo / phụ kiện';
  if (/(sai vi tri|sai kich thuoc|cao do|lech vi tri)/.test(text)) return 'Sai vị trí / sai cao độ';
  if (/(den|cua tham|mieng gio|sprinkler|thiet bi)/.test(text)) return 'Thiết bị liên quan';
  if (/(ve sinh|bao ve|thanh pham|rac)/.test(text)) return 'Vệ sinh / bảo vệ thành phẩm';

  return null;
};

const getDefectSeverityWeight = (severity: DefectSeverity) => {
  if (severity === 'Nghiêm trọng') return 1;
  if (severity === 'Trung bình') return 2;
  return 3;
};

const getDefectStatusWeight = (status: DefectStatus) => {
  if (status === 'Mới phát hiện') return 1;
  if (status === 'Đang sửa') return 2;
  if (status === 'Đã khắc phục') return 3;
  return 4;
};




const getDefectPriorityWeight = (defect: DefectItem) => {
  const overdueInfo = getDefectOverdueInfo(defect);
  const isClosed = defect.status === 'Đã nghiệm thu';
  const isFixed = defect.status === 'Đã khắc phục';

  if (!isClosed && !isFixed && overdueInfo.isOverdue) return 1;
  if (!isClosed && !isFixed && defect.dueDate && overdueInfo.daysDiff === 0) return 2;
  if (!isClosed && !isFixed && defect.dueDate && overdueInfo.daysDiff < 0 && Math.abs(overdueInfo.daysDiff) <= 3) return 3;
  if (defect.status === 'Mới phát hiện') return 4;
  if (defect.status === 'Đang sửa') return 5;
  if (isFixed) return 6;
  return 7;
};

import { compressImage, compressDefectPhoto, compressFloorPlanImage, readFloorPlanAsDataUrl } from '../utils/imageCompressor';
import { confirmAsync } from '../utils/confirmAsync';
import { apiFetch, hasApiBackend } from '../utils/api';

const readFileAsDataUrl = (file: File): Promise<string> => {
  return readFloorPlanAsDataUrl(file);
};

const readDefectPhotoAsDataUrl = (file: File | Blob | string): Promise<string> => {
  return compressDefectPhoto(file);
};

interface DefectPhotoStripProps {
  projectId: string;
  defect: DefectItem;
  category: 'defect_before' | 'defect_after';
  legacyUrl?: string;
  label: string;
  emptyText: string;
  tone: 'slate' | 'emerald';
  onOpen: (images: string[], initialIndex: number) => void;
}

const DefectPhotoStrip: React.FC<DefectPhotoStripProps> = ({
  projectId,
  defect,
  category,
  legacyUrl,
  label,
  emptyText,
  tone,
  onOpen,
}) => {
  const [photos, setPhotos] = useState<PhotoAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  // Realtime photo metadata can arrive while the initial IndexedDB read is still
  // pending. Only the newest read is allowed to update this strip; otherwise an
  // older empty read can finish last and make one device show "Chưa có ảnh".
  const photoLoadSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const loadCount = async () => {
      if (!projectId || !defect.id) return;
      const loadSeq = ++photoLoadSeqRef.current;
      setLoading(true);
      try {
        const items = await getEntityPhotos(projectId, 'defect', defect.id, category);
        if (!cancelled && loadSeq === photoLoadSeqRef.current) setPhotos(items);
      } catch (_) {
        if (!cancelled && loadSeq === photoLoadSeqRef.current) setPhotos([]);
      } finally {
        if (!cancelled && loadSeq === photoLoadSeqRef.current) setLoading(false);
      }
    };
    const handlePhotosChanged = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      if (detail.source === 'cloud' && Array.isArray(detail.entities)) {
        const relevant = detail.entities.some((item: any) =>
          item?.entityType === 'defect' &&
          item?.entityId === defect.id &&
          (!item?.category || item.category === category)
        );
        if (!relevant) return;
      } else {
        if (detail.entityType && detail.entityType !== 'defect') return;
        if (detail.entityId && detail.entityId !== defect.id) return;
        if (detail.category && detail.category !== category) return;
      }
      void loadCount();
    };
    void loadCount();
    window.addEventListener('qlct-photo-attachments-changed', handlePhotosChanged);
    return () => {
      cancelled = true;
      photoLoadSeqRef.current += 1;
      window.removeEventListener('qlct-photo-attachments-changed', handlePhotosChanged);
    };
  }, [projectId, defect.id, category, legacyUrl]);

  const legacyImages = legacyUrl ? [legacyUrl] : [];
  const totalCount = legacyImages.length + photos.length;
  const pendingCount = photos.filter((photo) => !isPhotoSharedCloudReady(photo)).length;
  const labelClass = tone === 'emerald' ? 'text-emerald-700' : 'text-slate-700';
  const chipClass = pendingCount > 0
    ? 'bg-amber-50 border-amber-200 text-amber-800'
    : tone === 'emerald'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : 'bg-slate-50 border-slate-200 text-slate-600';

  const openGallery = async () => {
    if (totalCount <= 0) return;
    // Open ONE defect-wide gallery, not one isolated category. This lets a defect with
    // "trước sửa" + "sau sửa" images swipe through all photos like Crew does.
    const allStored = await getEntityPhotos(projectId, 'defect', defect.id);
    const ordered: Array<{ category: 'defect_before' | 'defect_after'; url: string }> = [];
    if (defect.imageUrl) ordered.push({ category: 'defect_before', url: defect.imageUrl });
    for (const photo of allStored.filter((item) => item.category === 'defect_before')) {
      const url = await getPhotoDataUrl(photo.id, photo.cloudUrl || photo.cloudFileId || photo.localUri, false, projectId);
      if (url) ordered.push({ category: 'defect_before', url });
    }
    if (defect.afterImageUrl) ordered.push({ category: 'defect_after', url: defect.afterImageUrl });
    for (const photo of allStored.filter((item) => item.category === 'defect_after')) {
      const url = await getPhotoDataUrl(photo.id, photo.cloudUrl || photo.cloudFileId || photo.localUri, false, projectId);
      if (url) ordered.push({ category: 'defect_after', url });
    }

    const deduped: typeof ordered = [];
    const seen = new Set<string>();
    for (const item of ordered) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      deduped.push(item);
    }
    const initialIndex = Math.max(0, deduped.findIndex((item) => item.category === category));
    if (deduped.length > 0) onOpen(deduped.map((item) => item.url), initialIndex);
  };

  return (
    <div className="min-w-0">
      <div className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide ${labelClass}`}>
        <Images className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </div>
      {totalCount === 0 ? (
        <div className={`mt-1 inline-flex items-center px-2 py-1 rounded-lg border text-[10px] font-bold ${chipClass}`}>
          {loading ? 'Đang kiểm tra ảnh...' : emptyText}
        </div>
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void openGallery();
          }}
          className={`mt-1 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-extrabold hover:brightness-95 transition ${chipClass}`}
          title="Mở thư viện ảnh"
        >
          <Images className="w-3.5 h-3.5" />
          {totalCount} ảnh{pendingCount > 0 ? ` · ${pendingCount} chờ Cloud` : ''} · Bấm để xem
        </button>
      )}
    </div>
  );
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
  userRole = 'VIEWER',
  roleResolved = false,
  onAddInventory,
  onAddFloorPlan,
  onUpdateFloorPlan,
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
  onCreateMultipleRoomProgress,
  onDeleteRoomProgress,
  onDeleteMultipleRoomProgress,
  onReorderRoomProgressList,
  onReorderFloorPlans,
  onActiveFloorChange,
  onOpenExportPdf,
  onExportExcel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}) => {
  const { t } = useLanguage();
  const currentProjectId = projectId || (typeof window !== 'undefined' ? sessionStorage.getItem('active_project_id') || localStorage.getItem('active_project_id') : '') || 'default';
  const normalizedUserRole: UserRole = userRole === 'ADMIN' || userRole === 'EDITOR' ? userRole : 'VIEWER';
  const canManageStructure = roleResolved && canManageFloorPlanStructure(normalizedUserRole);
  const canEditDefects = roleResolved && canEditDefectData(normalizedUserRole);
  const canDeleteDefects = roleResolved && canDeleteBusinessData(normalizedUserRole);
  const getDraftKey = (base: string) => (currentProjectId === 'default' ? base : `${base}_${currentProjectId}`);
  const readIdSet = (storageKey: string): Set<string> => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
    } catch {
      return new Set<string>();
    }
  };

  const [selectedFloorId, setSelectedFloorId] = useState<string>(() => {
    const saved = localStorage.getItem(getDraftKey('construction_selected_floor_id'));
    if (saved && floorPlans.some((fp) => fp.id === saved)) {
      return saved;
    }
    return floorPlans[0]?.id || 'fp-1';
  });
  useFormatSettings();
  const [selectedDefectIds, setSelectedDefectIds] = useState<string[]>([]);
  const [showFloorProgressPanel, setShowFloorProgressPanel] = useState(false);

  // Zoom Scale State (Requirement #2: Zoom in on floor plan image)
  const [zoomScale, setZoomScale] = useState<number>(1);

  // V6.2.20: navigation/display controls are UI-only and never write Firestore.
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [mapLayers, setMapLayers] = useState(() => {
    try {
      const raw = localStorage.getItem(getDraftKey('construction_floorplan_layers'));
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        roomRegions: parsed.roomRegions !== false,
        roomLabels: parsed.roomLabels !== false,
        defects: parsed.defects !== false,
        resolvedDefects: parsed.resolvedDefects !== false,
      };
    } catch {
      return { roomRegions: true, roomLabels: true, defects: true, resolvedDefects: true };
    }
  });
  const [lockedRoomIds, setLockedRoomIds] = useState<Set<string>>(() => readIdSet(getDraftKey('construction_floorplan_locked_rooms')));
  const [lockedDefectIds, setLockedDefectIds] = useState<Set<string>>(() => readIdSet(getDraftKey('construction_floorplan_locked_defects')));
  const [viewportInfo, setViewportInfo] = useState({ scrollLeft: 0, scrollTop: 0, clientWidth: 1, clientHeight: 1, scrollWidth: 1, scrollHeight: 1 });
  const floorViewRestoringRef = useRef(false);
  const projectUiSettingsHydratingRef = useRef(false);
  const miniMapDragRef = useRef(false);
  const pendingFocusRef = useRef<{ floorId: string; x: number; y: number } | null>(null);


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
      onActiveFloorChange?.(selectedFloorId);
    }
  }, [selectedFloorId, currentProjectId, onActiveFloorChange]);

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


  React.useEffect(() => {
    projectUiSettingsHydratingRef.current = true;
    try {
      const raw = localStorage.getItem(getDraftKey('construction_floorplan_layers'));
      const parsed = raw ? JSON.parse(raw) : {};
      setMapLayers({
        roomRegions: parsed.roomRegions !== false,
        roomLabels: parsed.roomLabels !== false,
        defects: parsed.defects !== false,
        resolvedDefects: parsed.resolvedDefects !== false,
      });
    } catch {
      setMapLayers({ roomRegions: true, roomLabels: true, defects: true, resolvedDefects: true });
    }
    setLockedRoomIds(readIdSet(getDraftKey('construction_floorplan_locked_rooms')));
    setLockedDefectIds(readIdSet(getDraftKey('construction_floorplan_locked_defects')));
    requestAnimationFrame(() => { projectUiSettingsHydratingRef.current = false; });
  }, [currentProjectId]);

  React.useEffect(() => {
    if (projectUiSettingsHydratingRef.current) return;
    localStorage.setItem(getDraftKey('construction_floorplan_layers'), JSON.stringify(mapLayers));
  }, [mapLayers, currentProjectId]);

  React.useEffect(() => {
    if (projectUiSettingsHydratingRef.current) return;
    localStorage.setItem(getDraftKey('construction_floorplan_locked_rooms'), JSON.stringify(Array.from(lockedRoomIds)));
  }, [lockedRoomIds, currentProjectId]);

  React.useEffect(() => {
    if (projectUiSettingsHydratingRef.current) return;
    localStorage.setItem(getDraftKey('construction_floorplan_locked_defects'), JSON.stringify(Array.from(lockedDefectIds)));
  }, [lockedDefectIds, currentProjectId]);

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [defectSortBy, setDefectSortBy] = useState<DefectSortBy>('createdAt');
  const [defectSortOrder, setDefectSortOrder] = useState<SortOrder>('desc');
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
  const [smartPdfDetectionEnabled, setSmartPdfDetectionEnabled] = useState(true);
  const [smartPdfRasterFallback, setSmartPdfRasterFallback] = useState(true);
  const [smartPdfUseColorFilter, setSmartPdfUseColorFilter] = useState(true);
  const [smartPdfTargetColor, setSmartPdfTargetColor] = useState('#FFFF00');
  const [smartPdfColorTolerance, setSmartPdfColorTolerance] = useState(35);
  const [smartPdfMinAreaPercent, setSmartPdfMinAreaPercent] = useState(0.12);
  const [smartPdfMaxAreaPercent, setSmartPdfMaxAreaPercent] = useState(35);
  const [smartPdfNamePattern, setSmartPdfNamePattern] = useState(DEFAULT_PDF_ROOM_NAME_PATTERN);
  const [smartPdfCenterSearchMarginPercent, setSmartPdfCenterSearchMarginPercent] = useState(10);
  const [smartPdfHideOriginalAnnotations, setSmartPdfHideOriginalAnnotations] = useState(true);
  const [smartPdfAllowNumericOnlyNames, setSmartPdfAllowNumericOnlyNames] = useState(false);
  const [showSmartPdfAdvanced, setShowSmartPdfAdvanced] = useState(false);
  const [pendingSmartPdfImport, setPendingSmartPdfImport] = useState<PendingSmartPdfImport | null>(null);
  const [pdfDetectedRoomSortBy, setPdfDetectedRoomSortBy] = useState<'name' | 'confidence' | 'area'>('name');
  const [pdfDetectedRoomSortOrder, setPdfDetectedRoomSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isDetectingPdfRooms, setIsDetectingPdfRooms] = useState(false);

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

  // Notification/deep-link navigation must work both when Mặt bằng is being mounted
  // and when it is ALREADY open. sessionStorage covers mount/reload; a custom event
  // covers same-tab navigation, which previously did nothing because no dependency changed.
  useEffect(() => {
    const consumeNavigation = (pending: any, source: 'storage' | 'event') => {
      if (!pending) return;
      if (pending?.projectId && String(pending.projectId) !== currentProjectId) return;
      const defect = defects.find((item) =>
        item?.id === pending?.defectId
        && !item?.archivedAt
        && !(item as any)?.deleted
        && !item?.deletedAt
      );
      if (!defect) {
        try { sessionStorage.removeItem('qlct_pending_defect_navigation'); } catch (_) {}
        appendRuntimeDiagnostic({ level: 'warn', area: 'defect-navigation', projectId: currentProjectId, code: 'DEFECT_NOT_FOUND', message: `source=${source} requested=${String(pending?.defectId || '')}` });
        console.warn('[Defect navigation] Target no longer exists or is archived:', pending?.defectId);
        alert('Defect này không còn tồn tại hoặc đã được lưu trữ. Không có Defect khác được mở thay thế.');
        return;
      }
      if (!floorPlans.some((floor) => floor.id === defect.floorId)) {
        try { sessionStorage.removeItem('qlct_pending_defect_navigation'); } catch (_) {}
        appendRuntimeDiagnostic({ level: 'warn', area: 'defect-navigation', projectId: currentProjectId, code: 'FLOOR_NOT_FOUND', message: `defect=${defect.id} requestedFloor=${String(pending?.floorId || '')} actualFloor=${String(defect.floorId || '')}` });
        console.warn('[Defect navigation] Target floor no longer exists:', defect.floorId);
        alert('Không thể mở Defect vì mặt bằng/tầng liên quan không còn tồn tại. Không có Defect khác được mở thay thế.');
        return;
      }

      try { sessionStorage.removeItem('qlct_pending_defect_navigation'); } catch (_) {}
      localStorage.setItem(getDraftKey('construction_selected_floor_id'), defect.floorId);
      localStorage.setItem(getDraftKey('construction_selected_view_mode'), 'defect');
      pendingFocusRef.current = { floorId: defect.floorId, x: defect.x, y: defect.y };
      setStatusFilter('all');
      setViewMode('defect');
      setMapLayers((prev) => ({ ...prev, defects: true }));
      setSelectedDefectIds([defect.id]);
      setActiveDefectDetail(defect);
      appendRuntimeDiagnostic({
        level: 'info',
        area: 'defect-navigation',
        projectId: currentProjectId,
        code: 'OPEN_TARGET',
        message: `source=${source} defect=${defect.id} requestedFloor=${String(pending?.floorId || '')} actualFloor=${defect.floorId} selectedBefore=${selectedFloorId}`,
      });

      if (selectedFloorId !== defect.floorId) {
        setSelectedFloorId(defect.floorId);
      } else {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          focusPlanPoint(defect.x, defect.y);
          pendingFocusRef.current = null;
        }));
      }
    };

    let raw = '';
    try { raw = sessionStorage.getItem('qlct_pending_defect_navigation') || ''; } catch (_) {}
    if (raw) {
      try { consumeNavigation(JSON.parse(raw), 'storage'); }
      catch (err) {
        try { sessionStorage.removeItem('qlct_pending_defect_navigation'); } catch (_) {}
        appendRuntimeDiagnostic({ level: 'error', area: 'defect-navigation', projectId: currentProjectId, code: 'INVALID_REQUEST', message: err instanceof Error ? err.message : String(err) });
      }
    }

    const onNavigationRequest = (event: Event) => {
      consumeNavigation((event as CustomEvent<any>).detail || null, 'event');
    };
    window.addEventListener('qlct-defect-navigation-request', onNavigationRequest as EventListener);
    return () => window.removeEventListener('qlct-defect-navigation-request', onNavigationRequest as EventListener);
  }, [defects, currentProjectId, floorPlans, selectedFloorId]);

  useEffect(() => {
    if (!canEditDefects) {
      setShowDefectModal(false);
      setIsDefectPinPlacementMode(false);
      setPinPos(null);
    }
    if (!canDeleteDefects) {
      setSelectedDefectIds([]);
      setDeletingDefectTarget(null);
    }
  }, [canEditDefects, canDeleteDefects]);
  const [isDefectPinPlacementMode, setIsDefectPinPlacementMode] = useState(false);
  const [isRoomPinPlacementMode, setIsRoomPinPlacementMode] = useState(false);

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
  const suggestedDefectCategory = React.useMemo(() => getSuggestedDefectCategory(description), [description]);

  // Effects to save draft fields
  React.useEffect(() => {
    if (pinPos) {
      safeSetLocalStorageItem(getDraftKey('construction_defect_draft_pinPos'), JSON.stringify(pinPos));
    } else {
      localStorage.removeItem(getDraftKey('construction_defect_draft_pinPos'));
    }
  }, [pinPos, currentProjectId]);

  React.useEffect(() => {
    safeSetLocalStorageItem(getDraftKey('construction_defect_draft_showDefectModal'), String(showDefectModal));
  }, [showDefectModal, currentProjectId]);

  React.useEffect(() => {
    safeSetLocalStorageItem(getDraftKey('construction_defect_draft_category'), category);
  }, [category, currentProjectId]);

  React.useEffect(() => {
    safeSetLocalStorageItem(getDraftKey('construction_defect_draft_description'), description);
  }, [description, currentProjectId]);

  React.useEffect(() => {
    safeSetLocalStorageItem(getDraftKey('construction_defect_draft_severity'), severity);
  }, [severity, currentProjectId]);

  React.useEffect(() => {
    safeSetLocalStorageItem(getDraftKey('construction_defect_draft_assignedTo'), assignedTo);
  }, [assignedTo, currentProjectId]);

  React.useEffect(() => {
    safeSetLocalStorageItem(getDraftKey('construction_defect_draft_dueDate'), dueDate);
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

  // V6.2.9: old releases stored the full Base64 camera image in localStorage.
  // That can consume the entire Web Storage quota and make Firestore crash while it tries
  // to write its own `firestore_mutations_*` coordination marker. Migrate the one legacy
  // draft image to IndexedDB PhotoStorage once, then remove the Base64 localStorage copy.
  React.useEffect(() => {
    const legacyKey = getDraftKey('construction_defect_draft_photoUrl');
    let cancelled = false;
    (async () => {
      // Bootstrap may already have moved this large Base64 value from localStorage to
      // ConstructionAppDB before Firebase initialized. Read through asyncStorage so the
      // unsaved draft photo is preserved instead of being discarded just to free quota.
      const migratedLegacy = await getAsyncItem<string>(legacyKey, '').catch(() => '');
      const legacy = photoUrl || localStorage.getItem(legacyKey) || migratedLegacy || '';
      if (!legacy || !legacy.startsWith('data:image/')) return;
      try {
        await savePhotoAttachment(
          {
            projectId: currentProjectId,
            entityType: 'defect',
            entityId: draftDefectId,
            category: 'defect_before',
            fileName: 'ảnh_báo_lỗi_legacy.jpg',
            mimeType: 'image/jpeg',
            fileSize: 0,
          },
          legacy
        );
        await removeAsyncItem(legacyKey).catch(() => {});
        if (!cancelled) setPhotoUrl('');
      } catch (err) {
        console.warn('Không thể chuyển ảnh draft legacy sang PhotoStorage; giữ bản IndexedDB/localStorage để thử lại:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [currentProjectId, draftDefectId]);

  const handleCancelDefectModal = async () => {
    if (draftDefectId) {
      try {
        await deleteEntityPhotos(currentProjectId, 'defect', draftDefectId);
      } catch (_) {}
    }
    const nextDraftId = `defect_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    safeSetLocalStorageItem(getDraftKey('construction_defect_draft_id'), nextDraftId);
    setDraftDefectId(nextDraftId);

    setShowDefectModal(false);
    setPinPos(null);
    setDescription('');
    setPhotoUrl('');
    setAfterPhotoUrl('');
    
    // Clear draft storage
    localStorage.removeItem(getDraftKey('construction_defect_draft_pinPos'));
    safeSetLocalStorageItem(getDraftKey('construction_defect_draft_showDefectModal'), 'false');
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

  // PDF Upload & Convert State (Requirement #3)
  const [isConvertingPdf, setIsConvertingPdf] = useState(false);
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
    if (!canManageStructure) {
      setTouchMenu(null);
      return;
    }
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
    if (!canManageStructure) {
      setTouchMenu(null);
      return;
    }
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
    if (!canManageStructure) return;
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
    if (!canManageStructure || orphanedRooms.length === 0) return;
    setConfirmDeleteOrphanedModal(true);
  };

  const handleConfirmDeleteAllOrphaned = () => {
    if (!canManageStructure) return;
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
    if (!canManageStructure || copiedRoomsState.length === 0 || !activeFloor) return;
    
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

      const generatedId = existingRoom ? existingRoom.id : createEntityId('ROOM');
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
              id: createEntityId('sub-custom'),
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
    if (!canManageStructure) return;
    setDeletingRoomTarget({ id: room.id, name: room.roomName });
    setTouchMenu(null);
  };

  const handleRoomTouchStart = (e: React.TouchEvent, room: RoomProgressItem) => {
    e.stopPropagation();
    if (!canManageStructure || e.touches.length !== 1) return;
    
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
    }, 2000); // 2s deliberate long-press
  };

  const handleRoomTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartPosRef.current.clientX;
    const dy = touch.clientY - touchStartPosRef.current.clientY;
    if (dx * dx + dy * dy > 144) { // >12px cancels long-press so pan/zoom wins
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
    // Paste Căn/Phòng by touch belongs only to Căn/Phòng mode.
    if (viewMode !== 'highlight') return;
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
    }, 2000); // 2s deliberate long-press
  };

  const handleBgTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartPosRef.current.clientX;
    const dy = touch.clientY - touchStartPosRef.current.clientY;
    if (dx * dx + dy * dy > 144) { // >12px cancels long-press so pan/zoom wins
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

  // RC2.2.5: fail closed on role downgrade/switch. Structural state can be left armed
  // by an ADMIN session; EDITOR/VIEWER must never inherit those destructive controls.
  React.useEffect(() => {
    if (canManageStructure) return;
    setIsRoomPinPlacementMode(false);
    setDrawTool('none');
    setDrawStartPos(null);
    setDrawHoverPos(null);
    setPolygonPoints([]);
    setFreehandPoints([]);
    setPendingDraftHighlight(null);
    setRedrawingRoomTarget(null);
    setSelectedRoomForDragId(null);
    setSelectedRoomIds([]);
    setSelectedApartmentIds([]);
    setCopiedRoomsState([]);
    setClickChoicePos(null);
    setTouchMenu(null);
    setShowManageFloorsModal(false);
    setShowQuickAddFloorModal(false);
    setShowAddFloorModal(false);
    setEditingFloorId(null);
    setInlineEditingFloorId(null);
    setDuplicatingFloorTarget(null);
    setDeletingFloorTarget(null);
    setDeletingRoomTarget(null);
    setConfirmDeleteOrphanedModal(false);
    setPendingSmartPdfImport(null);
  }, [canManageStructure]);
  const [is2PointDragging, setIs2PointDragging] = useState(false);

  const handleStartRedraw2Point = (room: RoomProgressItem, tool: 'freehand' | 'polygon' | '2point' = '2point') => {
    if (lockedRoomIds.has(room.id)) {
      setCopyNotification('🔒 Căn/Phòng đang khóa vị trí. Mở khóa trước khi vẽ lại vùng.');
      window.setTimeout(() => setCopyNotification(null), 2200);
      return;
    }
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
    const roomsToExport = floorRooms;

    const data = roomsToExport.map(r => ({
      'STT': roomsToExport.indexOf(r) + 1,
      '__recordId': (r as any).id || '',
      'Tên Căn / Phòng': r.roomName,
      'Tọa độ X (%)': r.x,
      'Tọa độ Y (%)': r.y,
      'Chiều Rộng W (%)': r.width,
      'Chiều Cao H (%)': r.height,
      'Trạng Thái Khung Xương': r.frameStatus,
      'Trạng Thái Bắn Tấm': r.boardStatus,
      'Nghiệm Thu Khung': r.frameInspectionStatus,
      'Nghiệm Thu Tấm': r.boardInspectionStatus,
      'Kỹ sư phụ trách': r.inspectorName,
      'Ghi Chú': r.notes || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, activeFloor ? activeFloor.floorName : 'DanhSachPhong');
    return saveWorkbookFile(wb, `Danh_Sach_Phong_${activeFloor ? activeFloor.floorName.replace(/\s+/g, '_') : 'MatBang'}.xlsx`);
  };



  // Handle uploaded excel to import Room Highlights
  const handleImportExcelHighlights = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canManageStructure) {
      e.currentTarget.value = '';
      return;
    }
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
          ['Tên Căn / Phòng', 'Tên Căn Hộ hoặc Phòng', 'roomName', 'Tên Phòng', 'Phòng', 'Căn Hộ', 'can ho', 'room'].some(rk => h.toLowerCase().includes(rk.toLowerCase()))
        );

        if (!nameMatchKey) {
          alert(
            `⚠️ Không tìm thấy cột thông tin bắt buộc 'Tên Căn / Phòng'!\n\n` +
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
          alert('⚠️ Không tìm thấy Căn / Phòng hợp lệ nào trong tệp Excel để xử lý!');
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

          const rawX = parseExcelNumber(row['Tọa độ X (%)'] || row['x'] || 20);
          const rawY = parseExcelNumber(row['Tọa độ Y (%)'] || row['y'] || 20);
          const rawW = parseExcelNumber(row['Chiều Rộng W (%)'] || row['width'] || 30);
          const rawH = parseExcelNumber(row['Chiều Cao H (%)'] || row['height'] || 30);

          const frameSt = row['Trạng Thái Khung Xương'] || row['frameStatus'] || 'Chưa làm';
          const boardSt = row['Trạng Thái Bắn Tấm'] || row['boardStatus'] || 'Chưa làm';
          const frameInsp = row['Nghiệm Thu Khung'] || row['frameInspectionStatus'] || 'Chưa nghiệm thu';
          const boardInsp = row['Nghiệm Thu Tấm'] || row['boardInspectionStatus'] || 'Chưa nghiệm thu';
          const inspector = row['Kỹ sư phụ trách'] || row['Kỹ Sư Giám Sát'] || row['inspectorName'] || '';
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
            // Reuse an imported record ID only when it does not belong to a room on
            // another floor. This prevents an Excel file from silently moving/overwriting
            // a different floor's room through the global ID update path.
            const idUsedElsewhere = rawRecordId
              ? roomProgressList.some((room) => room.id === rawRecordId && room.floorId !== activeFloor?.id)
              : false;
            existingId = rawRecordId && !idUsedElsewhere ? rawRecordId : undefined;
            importedCount++;
          }

          const targetId = existingId || createEntityId('ROOM');
          processedRoomIds.add(targetId);
          const safeX = Math.min(95, Math.max(0, rawX));
          const safeY = Math.min(95, Math.max(0, rawY));
          const safeW = Math.min(100 - safeX, Math.max(5, rawW));
          const safeH = Math.min(100 - safeY, Math.max(5, rawH));

          onSaveRoomProgress({
            ...(existingRoomObj || {}),
            id: targetId,
            createdAt: existingRoomObj?.createdAt || Date.now(),
            floorId: activeFloor?.id || 'fp-1',
            floorName: activeFloor?.floorName || 'Mặt bằng',
            roomName: nameStr,
            x: safeX,
            y: safeY,
            width: safeW,
            height: safeH,
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
          `🎉 Nhập dữ liệu Mặt bằng từ Excel thành công!\n\n` +
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

  const getFloorTargetState = (dateStr?: string) => {
    if (!dateStr) return { label: 'Chưa đặt hạn', className: 'bg-slate-100 text-slate-600 border-slate-200' };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(target.getTime())) return { label: 'Ngày không hợp lệ', className: 'bg-slate-100 text-slate-600 border-slate-200' };
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diffDays < 0) return { label: `Quá hạn ${Math.abs(diffDays)} ngày`, className: 'bg-rose-50 text-rose-700 border-rose-200' };
    if (diffDays === 0) return { label: 'Hạn hôm nay', className: 'bg-amber-50 text-amber-800 border-amber-200' };
    if (diffDays <= 3) return { label: `Còn ${diffDays} ngày`, className: 'bg-amber-50 text-amber-800 border-amber-200' };
    return { label: `Còn ${diffDays} ngày`, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  };

  const openDefectLegacyImageViewer = (defect: DefectItem, requestedUrl?: string) => {
    const images = [defect.imageUrl, defect.afterImageUrl].filter((url): url is string => Boolean(url));
    if (images.length === 0) return;
    const initialIndex = Math.max(0, requestedUrl ? images.indexOf(requestedUrl) : 0);
    setViewingImageSet({ images, initialIndex });
  };

  const floorDefects = defects.filter((d) => d.floorId === activeFloor?.id);
  const floorRooms = roomProgressList.filter((r) => r.floorId === activeFloor?.id);
  const mapFloorDefects = floorDefects.filter((d) => mapLayers.resolvedDefects || !(d.status === 'Đã nghiệm thu' || d.status === 'Đã khắc phục'));

  // Generate a collision-safe default name for quick room creation.
  const getNextAvailableQuickRoomName = () => {
    const existingNames = new Set(
      floorRooms.map((room) => String(room.roomName || '').trim().toLocaleLowerCase('vi-VN'))
    );
    let index = 1;
    while (existingNames.has(`căn / phòng ${index}`.toLocaleLowerCase('vi-VN'))) index += 1;
    return `Căn / Phòng ${index}`;
  };
  const [draggingRoomsPreview, setDraggingRoomsPreview] = useState<Record<string, RoomProgressItem> | null>(null);
  const draggingRoomsPreviewRef = useRef<Record<string, RoomProgressItem> | null>(null);

  const displayedFloorRooms = React.useMemo(() => {
    if (!draggingRoomsPreview) return floorRooms;
    return floorRooms.map((r) => draggingRoomsPreview[r.id] || r);
  }, [floorRooms, draggingRoomsPreview]);

  const [roomSortBy, setRoomSortBy] = useState<'name' | 'createdAt' | 'updatedAt' | 'manual'>('manual');
  const [roomSortOrder, setRoomSortOrder] = useState<'asc' | 'desc'>('asc');

  // Căn / Phòng collapse state is UI-only. With many rooms, default to collapsed
  // to reduce scrolling and avoid rendering every sub-item until it is needed.
  const [roomExpansionByFloor, setRoomExpansionByFloor] = useState<Record<string, string[]>>({});
  const [collapsedRoomCategoryKeys, setCollapsedRoomCategoryKeys] = useState<Set<string>>(new Set());

  const activeFloorExpansionKey = activeFloor?.id || '';
  const hasSavedRoomExpansion = activeFloorExpansionKey
    ? Object.prototype.hasOwnProperty.call(roomExpansionByFloor, activeFloorExpansionKey)
    : false;
  const expandedRoomIds = React.useMemo(() => {
    if (!activeFloorExpansionKey) return new Set<string>();
    if (hasSavedRoomExpansion) {
      return new Set(roomExpansionByFloor[activeFloorExpansionKey] || []);
    }
    // Up to 5 rooms: open by default. More than 5: compact by default.
    return new Set(floorRooms.length <= 5 ? floorRooms.map((room) => room.id) : []);
  }, [activeFloorExpansionKey, floorRooms, hasSavedRoomExpansion, roomExpansionByFloor]);

  const setExpandedRoomsForActiveFloor = (ids: string[]) => {
    if (!activeFloorExpansionKey) return;
    setRoomExpansionByFloor((prev) => ({ ...prev, [activeFloorExpansionKey]: ids }));
  };

  const toggleRoomExpanded = (roomId: string) => {
    const next = new Set<string>(expandedRoomIds);
    if (next.has(roomId)) next.delete(roomId);
    else next.add(roomId);
    setExpandedRoomsForActiveFloor(Array.from(next));
  };

  const collapseAllRooms = () => {
    setExpandedRoomsForActiveFloor([]);
    setCollapsedRoomCategoryKeys(new Set());
  };

  const expandAllRooms = () => {
    setExpandedRoomsForActiveFloor(floorRooms.map((room) => room.id));
    setCollapsedRoomCategoryKeys(new Set());
  };

  const toggleRoomCategoryCollapsed = (roomId: string, categoryName: string) => {
    const key = `${roomId}::${categoryName}`;
    setCollapsedRoomCategoryKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const sortedFloorRooms = React.useMemo(() => {
    if (roomSortBy === 'manual') return displayedFloorRooms;

    const getCreatedAt = (room: RoomProgressItem) => {
      if (room.createdAt && Number.isFinite(room.createdAt)) return room.createdAt;
      // Legacy migration fallback only: recover old timestamp-shaped IDs without
      // treating updatedAt as the creation date.
      const match = room.id.match(/(?:ROOM-|room_)(\d{13})/i);
      if (match) {
        const ts = Number(match[1]);
        if (Number.isFinite(ts) && ts > 0) return ts;
      }
      return 0;
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
  const selectedDefectForFocus = floorDefects.find((d) => selectedDefectIds.includes(d.id)) || null;
  const selectedRoomIdsForAction = selectedRoomIds.length > 0
    ? selectedRoomIds
    : selectedRoomObject ? [selectedRoomObject.id] : [];
  const selectedRoomsAreLocked = selectedRoomIdsForAction.length > 0 && selectedRoomIdsForAction.every((id) => lockedRoomIds.has(id));

  const toggleSelectedRoomLock = () => {
    if (selectedRoomIdsForAction.length === 0) return;
    setLockedRoomIds((prev) => {
      const next = new Set(prev);
      const shouldUnlock = selectedRoomIdsForAction.every((id) => next.has(id));
      selectedRoomIdsForAction.forEach((id) => shouldUnlock ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const toggleDefectLock = (defectId: string) => {
    if (!canEditDefects) return;
    setLockedDefectIds((prev) => {
      const next = new Set(prev);
      if (next.has(defectId)) next.delete(defectId); else next.add(defectId);
      return next;
    });
  };

  const focusCurrentSelection = () => {
    const selectedRoomsForFocus = displayedFloorRooms.filter((room) => selectedRoomIds.includes(room.id) || room.id === selectedRoomForDragId);
    if (selectedRoomsForFocus.length > 0) {
      const centers = selectedRoomsForFocus.map((room) => {
        if (room.points && room.points.length > 0) {
          return {
            x: room.points.reduce((sum, pt) => sum + pt.x, 0) / room.points.length,
            y: room.points.reduce((sum, pt) => sum + pt.y, 0) / room.points.length,
          };
        }
        return { x: room.x + (room.width || 0) / 2, y: room.y + (room.height || 0) / 2 };
      });
      focusPlanPoint(
        centers.reduce((sum, point) => sum + point.x, 0) / centers.length,
        centers.reduce((sum, point) => sum + point.y, 0) / centers.length
      );
      return;
    }
    if (selectedDefectForFocus) focusPlanPoint(selectedDefectForFocus.x, selectedDefectForFocus.y);
  };

  const getFloorViewStateKey = (floorId: string) => `qlct_floor_view_${currentProjectId}_${floorId}`;

  useEffect(() => {
    setRotation(0);
    floorViewRestoringRef.current = true;
    let savedZoom = 1;
    let savedLeft = 0;
    let savedTop = 0;
    try {
      const raw = sessionStorage.getItem(getFloorViewStateKey(selectedFloorId));
      if (raw) {
        const saved = JSON.parse(raw);
        const currentWidth = Math.max(0, parentRef.current?.clientWidth || 0);
        const currentHeight = Math.max(0, parentRef.current?.clientHeight || 0);
        const savedWidth = Math.max(0, Number(saved.viewportWidth) || 0);
        const savedHeight = Math.max(0, Number(saved.viewportHeight) || 0);
        const widthRatio = savedWidth > 0 && currentWidth > 0 ? currentWidth / savedWidth : 0;
        const heightRatio = savedHeight > 0 && currentHeight > 0 ? currentHeight / savedHeight : 0;
        const compatibleViewport = widthRatio >= 0.8 && widthRatio <= 1.25 && heightRatio >= 0.8 && heightRatio <= 1.25;
        if (compatibleViewport) {
          savedZoom = Math.min(20, Math.max(1, Number(saved.zoom) || 1));
          savedLeft = Math.max(0, Number(saved.scrollLeft) || 0);
          savedTop = Math.max(0, Number(saved.scrollTop) || 0);
        }
      }
    } catch {}
    setZoomScale(savedZoom);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const parent = parentRef.current;
      if (parent) {
        parent.scrollLeft = savedLeft;
        parent.scrollTop = savedTop;
        setViewportInfo({
          scrollLeft: parent.scrollLeft,
          scrollTop: parent.scrollTop,
          clientWidth: Math.max(1, parent.clientWidth),
          clientHeight: Math.max(1, parent.clientHeight),
          scrollWidth: Math.max(1, parent.scrollWidth),
          scrollHeight: Math.max(1, parent.scrollHeight),
        });
      }
      floorViewRestoringRef.current = false;
    }));
  }, [selectedFloorId, currentProjectId]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending || pending.floorId !== selectedFloorId) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      focusPlanPoint(pending.x, pending.y);
      pendingFocusRef.current = null;
    }));
  }, [selectedFloorId]);

  useEffect(() => {
    // Always use the real image ratio once it is available. Resetting to 1.414 at
    // 100% and switching to the real ratio only after zooming changes both scale
    // and geometry on the first wheel step, which makes the drawing jump.
    const imgEl = imageContainerRef.current?.querySelector('img');
    if (imgEl && imgEl.naturalWidth && imgEl.naturalHeight) {
      setImgAspect(imgEl.naturalWidth / imgEl.naturalHeight);
    }
  }, [activeFloor?.imageUrl, selectedFloorId, isFullscreen]);

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


  useEffect(() => {
    const el = parentRef.current;
    if (!el || !selectedFloorId) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = {
          scrollLeft: el.scrollLeft,
          scrollTop: el.scrollTop,
          clientWidth: Math.max(1, el.clientWidth),
          clientHeight: Math.max(1, el.clientHeight),
          scrollWidth: Math.max(1, el.scrollWidth),
          scrollHeight: Math.max(1, el.scrollHeight),
        };
        setViewportInfo(next);
        if (!floorViewRestoringRef.current) {
          try {
            sessionStorage.setItem(getFloorViewStateKey(selectedFloorId), JSON.stringify({
              zoom: zoomScaleRef.current,
              scrollLeft: next.scrollLeft,
              scrollTop: next.scrollTop,
              viewportWidth: next.clientWidth,
              viewportHeight: next.clientHeight,
            }));
          } catch {}
        }
      });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [selectedFloorId, currentProjectId, isFullscreen]);

  const activePointersRef = useRef<Set<number>>(new Set());
  // Floor-plan navigation: touch one-finger pan; desktop middle-mouse or Space+left pan.
  const panStateRef = useRef<{ active: boolean; pointerId: number | null; startX: number; startY: number; scrollLeft: number; scrollTop: number; moved: boolean }>({ active: false, pointerId: null, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0, moved: false });
  const suppressNextCanvasClickRef = useRef(false);
  const pendingZoomAnchorRef = useRef<{ clientX: number; clientY: number; rx: number; ry: number } | null>(null);
  const roomInteractionClickResetTimerRef = useRef<number | null>(null);
  const spacePanHeldRef = useRef(false);
  // Distinguish a deliberate tap/click from a drag so polygon/room/defect creation
  // never fires after the user was navigating the plan.
  const canvasPressRef = useRef<{ pointerId: number | null; startX: number; startY: number; moved: boolean }>({
    pointerId: null, startX: 0, startY: 0, moved: false,
  });

  const photoInputRef = useRef<HTMLInputElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts: Ctrl+C (copy selected room), Ctrl+V (paste copied room), Delete / Backspace (delete selected room with confirmation)
  // Native touch handlers for pinch-to-zoom + cursor-anchored desktop wheel zoom.
  const zoomScaleRef = useRef(zoomScale);
  useLayoutEffect(() => {
    zoomScaleRef.current = zoomScale;

    // Keep the map point under the mouse / pinch midpoint fixed during the exact
    // layout commit that changes the zoom. This avoids stacked requestAnimationFrame
    // corrections when wheel events arrive faster than React can paint.
    const anchor = pendingZoomAnchorRef.current;
    if (!anchor) return;
    pendingZoomAnchorRef.current = null;

    const parent = parentRef.current;
    const image = imageContainerRef.current;
    if (!parent || !image) return;
    const nextRect = image.getBoundingClientRect();
    if (nextRect.width <= 0 || nextRect.height <= 0) return;

    const anchoredClientX = nextRect.left + anchor.rx * nextRect.width;
    const anchoredClientY = nextRect.top + anchor.ry * nextRect.height;
    parent.scrollLeft += anchoredClientX - anchor.clientX;
    parent.scrollTop += anchoredClientY - anchor.clientY;
  }, [zoomScale, rotation]);


  useEffect(() => {
    if (floorViewRestoringRef.current || !selectedFloorId) return;
    const parent = parentRef.current;
    if (!parent) return;
    try {
      sessionStorage.setItem(getFloorViewStateKey(selectedFloorId), JSON.stringify({
        zoom: zoomScale,
        scrollLeft: parent.scrollLeft,
        scrollTop: parent.scrollTop,
        viewportWidth: Math.max(1, parent.clientWidth),
        viewportHeight: Math.max(1, parent.clientHeight),
      }));
    } catch {}
    requestAnimationFrame(() => {
      const current = parentRef.current;
      if (!current) return;
      setViewportInfo({
        scrollLeft: current.scrollLeft,
        scrollTop: current.scrollTop,
        clientWidth: Math.max(1, current.clientWidth),
        clientHeight: Math.max(1, current.clientHeight),
        scrollWidth: Math.max(1, current.scrollWidth),
        scrollHeight: Math.max(1, current.scrollHeight),
      });
    });
  }, [zoomScale, selectedFloorId, currentProjectId]);

  const toDisplayedPercent = (x: number, y: number) => {
    if (rotation === 90) return { x: 100 - y, y: x };
    if (rotation === 180) return { x: 100 - x, y: 100 - y };
    if (rotation === 270) return { x: y, y: 100 - x };
    return { x, y };
  };

  const focusPlanPoint = (x: number, y: number, ensureZoom = true) => {
    const run = () => {
      const parent = parentRef.current;
      const image = imageContainerRef.current;
      if (!parent || !image) return;
      const parentRect = parent.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      const displayed = toDisplayedPercent(x, y);
      const contentX = parent.scrollLeft + (imageRect.left - parentRect.left) + (displayed.x / 100) * imageRect.width;
      const contentY = parent.scrollTop + (imageRect.top - parentRect.top) + (displayed.y / 100) * imageRect.height;
      parent.scrollTo({
        left: Math.max(0, contentX - parent.clientWidth / 2),
        top: Math.max(0, contentY - parent.clientHeight / 2),
        behavior: 'smooth',
      });
    };
    if (ensureZoom && zoomScaleRef.current < 1.6) {
      zoomScaleRef.current = 2;
      setZoomScale(2);
      requestAnimationFrame(() => requestAnimationFrame(run));
    } else {
      run();
    }
  };

  const fitFloorPlan = () => {
    zoomScaleRef.current = 1;
    setZoomScale(1);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      parentRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
    }));
  };

  const centerMiniMapAt = (clientX: number, clientY: number, element: HTMLElement) => {
    const parent = parentRef.current;
    if (!parent) return;
    const rect = element.getBoundingClientRect();
    const rx = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    const ry = Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height)));
    parent.scrollLeft = Math.max(0, rx * parent.scrollWidth - parent.clientWidth / 2);
    parent.scrollTop = Math.max(0, ry * parent.scrollHeight - parent.clientHeight / 2);
  };

  useEffect(() => {
    // Bind once on the scroll viewport. Binding both viewport + image caused the same
    // wheel/touch event to be handled twice because the event bubbles.
    const gestureEl = parentRef.current || imageContainerRef.current;
    if (!gestureEl) return;

    let initialDist = 0;
    let initialZoom = 1;

    const applyAnchoredZoom = (requestedScale: number, clientX: number, clientY: number) => {
      const image = imageContainerRef.current;
      if (!parentRef.current || !image) return;

      const oldScale = zoomScaleRef.current;
      const nextScale = Math.min(20, Math.max(1, Number(requestedScale.toFixed(2))));
      if (!Number.isFinite(nextScale) || Math.abs(nextScale - oldScale) < 0.001) return;

      const oldRect = image.getBoundingClientRect();
      if (oldRect.width <= 0 || oldRect.height <= 0) return;
      pendingZoomAnchorRef.current = {
        clientX,
        clientY,
        rx: Math.min(1, Math.max(0, (clientX - oldRect.left) / oldRect.width)),
        ry: Math.min(1, Math.max(0, (clientY - oldRect.top) / oldRect.height)),
      };

      zoomScaleRef.current = nextScale;
      setZoomScale(nextScale);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        if (touchHoldTimerRef.current) {
          clearTimeout(touchHoldTimerRef.current);
          touchHoldTimerRef.current = null;
        }
        panStateRef.current.active = false;
        canvasPressRef.current.moved = true;
        suppressNextCanvasClickRef.current = true;
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
          const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          applyAnchoredZoom(initialZoom * (dist / initialDist), centerX, centerY);
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        initialDist = 0;
        window.setTimeout(() => { suppressNextCanvasClickRef.current = false; }, 80);
      }
    };

    const onWheel = (e: WheelEvent) => {
      // PC: wheel zooms toward the cursor instead of zooming around the viewport origin.
      // Keep the existing 1x..20x limits unchanged for large floor plans.
      if (e.cancelable) e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      applyAnchoredZoom(zoomScaleRef.current * factor, e.clientX, e.clientY);
    };

    gestureEl.addEventListener('touchstart', onTouchStart, { passive: false });
    gestureEl.addEventListener('touchmove', onTouchMove, { passive: false });
    gestureEl.addEventListener('touchend', onTouchEnd);
    gestureEl.addEventListener('touchcancel', onTouchEnd);
    gestureEl.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      gestureEl.removeEventListener('touchstart', onTouchStart);
      gestureEl.removeEventListener('touchmove', onTouchMove);
      gestureEl.removeEventListener('touchend', onTouchEnd);
      gestureEl.removeEventListener('touchcancel', onTouchEnd);
      gestureEl.removeEventListener('wheel', onWheel);
    };
  }, [selectedFloorId, isFullscreen]);


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;

      // Structural keyboard shortcuts are ADMIN-only. Navigation/escape remain available.
      if (!canManageStructure) {
        if (e.code === 'Space') spacePanHeldRef.current = true;
        if (e.key === 'Escape') {
          setDrawTool('none');
          setIsRoomPinPlacementMode(false);
          setSelectedRoomIds([]);
          setSelectedRoomForDragId(null);
        }
        return;
      }

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

      // Arrow keys: nudge selected room(s). Shift = larger step. Keep text inputs untouched above.
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const roomsToNudge = floorRooms.filter(r => selectedRoomIds.includes(r.id) || r.id === selectedRoomForDragId);
        if (roomsToNudge.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          if (roomsToNudge.some((room) => lockedRoomIds.has(room.id))) {
            setCopyNotification('🔒 Có Căn/Phòng đang khóa vị trí. Mở khóa trước khi di chuyển.');
            window.setTimeout(() => setCopyNotification(null), 1800);
            return;
          }
          const step = e.shiftKey ? 1 : 0.2;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          const moved = roomsToNudge.map(room => {
            const width = room.width || 0;
            const height = room.height || 0;
            const nx = Math.min(100 - width, Math.max(0, Math.round((room.x + dx) * 10) / 10));
            const ny = Math.min(100 - height, Math.max(0, Math.round((room.y + dy) * 10) / 10));
            const pdx = nx - room.x, pdy = ny - room.y;
            return { ...room, x: nx, y: ny, points: room.points?.map(pt => ({ x: Math.min(100, Math.max(0, Math.round((pt.x + pdx) * 10) / 10)), y: Math.min(100, Math.max(0, Math.round((pt.y + pdy) * 10) / 10)) })) };
          });
          if (onBatchSaveRooms && moved.length > 1) onBatchSaveRooms(moved); else moved.forEach(onSaveRoomProgress);
        }
      }

      if (e.code === 'Space') spacePanHeldRef.current = true;

      // Escape: Cancel/exit drawing/placement commands first; never close the whole floor-plan screen.
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
        setIsRoomPinPlacementMode(false);
        setIsDefectPinPlacementMode(false);
        setSelectedRoomIds([]);
        setSelectedRoomForDragId(null);
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

    const handleKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') spacePanHeldRef.current = false; };
    // Capture phase keeps floor-plan shortcuts working even when a focused map
    // control stops keyboard bubbling. Editable text targets are excluded above.
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => { window.removeEventListener('keydown', handleKeyDown, true); window.removeEventListener('keyup', handleKeyUp, true); };
  }, [selectedRoomForDragId, selectedRoomIds, floorRooms, copiedRoomsState, activeFloor, onSaveRoomProgress, onDeleteRoomProgress, lockedRoomIds, canManageStructure]);

  // Repair legacy/stale links once source data is available. This is idempotent: only
  // mismatches are written. roomId follows the actual pin/highlight geometry, while a
  // valid per-defect teamId is preserved and its display name is refreshed after renames.
  React.useEffect(() => {
    if (!canEditDefects || !onUpdateDefect || floorDefects.length === 0) return;
    floorDefects.forEach((defect) => {
      const repaired = reconcileDefectLinkage(defect, floorRooms, teams);
      if (repaired !== defect) onUpdateDefect(repaired);
    });
  }, [canEditDefects, floorDefects, floorRooms, teams, onUpdateDefect]);

  const filteredDefects = React.useMemo(() => {
    const getRoomLabel = (defect: DefectItem) => {
      const matchedRoom = floorRooms.find((room) => room.id === defect.roomId);
      return matchedRoom?.roomName || defect.positionDetail || defect.axisGrid || '';
    };

    const compareDueDate = (a: DefectItem, b: DefectItem) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    };

    const list = floorDefects.filter((d) => {
      if (statusFilter === 'all') return true;
      return d.status === statusFilter;
    });

    return [...list].sort((a, b) => {
      let comparison = 0;

      if (defectSortBy === 'createdAt') {
        comparison = parseLegacyTimestamp(a.createdAt, 0) - parseLegacyTimestamp(b.createdAt, 0);
      } else if (defectSortBy === 'priority') {
        comparison = getDefectPriorityWeight(a) - getDefectPriorityWeight(b);
        if (comparison === 0) comparison = getDefectSeverityWeight(a.severity) - getDefectSeverityWeight(b.severity);
        if (comparison === 0) comparison = compareDueDate(a, b);
        if (comparison === 0) comparison = parseLegacyTimestamp(a.createdAt, 0) - parseLegacyTimestamp(b.createdAt, 0);
      } else if (defectSortBy === 'category') {
        comparison = compareVietnameseText(a.category, b.category);
      } else if (defectSortBy === 'floorName') {
        comparison = compareVietnameseText(a.floorName, b.floorName);
      } else if (defectSortBy === 'roomName') {
        comparison = compareVietnameseText(getRoomLabel(a), getRoomLabel(b));
      } else if (defectSortBy === 'severity') {
        comparison = getDefectSeverityWeight(a.severity) - getDefectSeverityWeight(b.severity);
      } else if (defectSortBy === 'dueDate') {
        comparison = compareDueDate(a, b);
      } else if (defectSortBy === 'status') {
        comparison = getDefectStatusWeight(a.status) - getDefectStatusWeight(b.status);
      } else if (defectSortBy === 'assignedTo') {
        comparison = compareVietnameseText(a.assignedTo, b.assignedTo);
      }

      return defectSortOrder === 'asc' ? comparison : -comparison;
    });
  }, [floorDefects, floorRooms, statusFilter, defectSortBy, defectSortOrder]);

  // Helper handlers for floor plan customization (rename, duplicate, delete, quick add)
  const isFloorNameTaken = (name: string, exceptFloorId?: string) => {
    const normalized = String(name || '').trim().toLocaleLowerCase('vi-VN');
    if (!normalized) return false;
    return floorPlans.some((floor) =>
      floor.id !== exceptFloorId && floor.floorName.trim().toLocaleLowerCase('vi-VN') === normalized
    );
  };

  const commitInlineFloorRename = (floorId: string) => {
    const trimmed = inlineEditingName.trim();
    const currentName = floorPlans.find((floor) => floor.id === floorId)?.floorName || '';
    if (!trimmed) {
      setInlineEditingName(currentName);
      setInlineEditingFloorId(null);
      return;
    }
    if (isFloorNameTaken(trimmed, floorId)) {
      alert(`Tên mặt bằng “${trimmed}” đã tồn tại. Vui lòng dùng tên khác để tránh liên kết dữ liệu nhầm tầng.`);
      setInlineEditingName(currentName);
      setInlineEditingFloorId(null);
      return;
    }
    if (onRenameFloorPlan) onRenameFloorPlan(floorId, trimmed);
    setInlineEditingFloorId(null);
  };

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
    if (isFloorNameTaken(finalName)) {
      alert(`Tên mặt bằng “${finalName}” đã tồn tại. Vui lòng đổi tên bản sao trước khi tạo.`);
      return;
    }
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
    const floorName = quickFloorNameInput.trim();
    if (!floorName) return;
    if (isFloorNameTaken(floorName)) {
      alert(`Tên mặt bằng “${floorName}” đã tồn tại. Vui lòng dùng tên khác.`);
      return;
    }

    onAddFloorPlan({
      floorName,
      imageUrl: '',
      uploadedAt: new Date().toISOString().split('T')[0],
    });

    setQuickFloorNameInput('');
    setShowQuickAddFloorModal(false);
    alert(`Đã tạo thêm mặt bằng tầng "${floorName}" thành công!`);
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

  // Operational category catalog. WorkVolume is the project source of truth for
  // active categories. Historical room metadata is intentionally preserved for audit/
  // recovery, but deleted categories must not reappear in the Mặt bằng dashboard.
  const operationalWorkCategoryCatalog = React.useMemo(() => {
    const byId = new Map<string, string>();
    const byName = new Map<string, string>();
    workVolumes.forEach((item) => {
      const title = String(item.title || '').trim();
      if (!title) return;
      byName.set(title.toLocaleLowerCase('vi-VN'), title);
      [item.id, item.workCategoryId].filter(Boolean).forEach((id) => byId.set(String(id), title));
    });
    return { byId, byName, hasCatalog: byName.size > 0 };
  }, [workVolumes]);

  const resolveOperationalCategoryName = React.useCallback((rawName?: string | null, rawId?: string | null): string | null => {
    const id = String(rawId || '').trim();
    if (id && operationalWorkCategoryCatalog.byId.has(id)) return operationalWorkCategoryCatalog.byId.get(id)!;
    const raw = String(rawName || '').trim();
    if (!raw) return null;
    if (!operationalWorkCategoryCatalog.hasCatalog) return raw; // legacy project without a master catalog
    if (operationalWorkCategoryCatalog.byId.has(raw)) return operationalWorkCategoryCatalog.byId.get(raw)!;
    return operationalWorkCategoryCatalog.byName.get(raw.toLocaleLowerCase('vi-VN')) || null;
  }, [operationalWorkCategoryCatalog]);

  const getOperationalRoomSubItems = React.useCallback((room: RoomProgressItem): RoomSubItem[] => {
    return (room.subItems || []).filter((sub) => Boolean(resolveOperationalCategoryName(sub.category || room.workCategory, sub.workCategoryId)));
  }, [resolveOperationalCategoryName]);

  // Dynamic summary by active work categories configured in Khối lượng. Deleted
  // categories can remain in old room records for history but are excluded here.
  const floorCategorySummary = React.useMemo(() => {
    type CategoryStat = {
      name: string;
      roomCount: number;
      workDoneCount: number;
      inspectedCount: number;
      totalSteps: number;
      doneSteps: number;
      inspectedSteps: number;
      volumeByUnit: Record<string, number>;
    };
    const map = new Map<string, CategoryStat>();

    floorRooms.forEach((room) => {
      const categoryNames = new Set<string>();
      Object.keys(room.categoryVolumes || {}).forEach((rawKey) => {
        const resolved = resolveOperationalCategoryName(rawKey);
        if (resolved) categoryNames.add(resolved);
      });
      (room.subItems || []).forEach((sub) => {
        const resolved = resolveOperationalCategoryName(sub.category || room.workCategory, sub.workCategoryId);
        if (resolved) categoryNames.add(resolved);
      });
      const primaryResolved = resolveOperationalCategoryName(room.workCategory, room.workCategoryId);
      if (primaryResolved) categoryNames.add(primaryResolved);

      categoryNames.forEach((categoryName) => {
        if (!map.has(categoryName)) {
          map.set(categoryName, {
            name: categoryName,
            roomCount: 0,
            workDoneCount: 0,
            inspectedCount: 0,
            totalSteps: 0,
            doneSteps: 0,
            inspectedSteps: 0,
            volumeByUnit: {},
          });
        }
        const stat = map.get(categoryName)!;
        stat.roomCount += 1;

        let categoryVolume = 0;
        let categoryVolumeUnit = room.volumeUnit || 'm²';
        Object.entries(room.categoryVolumes || {}).forEach(([rawKey, rawValue]) => {
          if (resolveOperationalCategoryName(rawKey) !== categoryName) return;
          // Same legacy category can exist under both ID and title. Use the largest
          // value instead of double-counting the same room quantity.
          categoryVolume = Math.max(categoryVolume, Number(rawValue) || 0);
          categoryVolumeUnit = room.categoryVolumeUnits?.[rawKey] || categoryVolumeUnit;
        });
        if (categoryVolume <= 0 && primaryResolved === categoryName) categoryVolume = Number(room.workVolume || 0);
        if (categoryVolume > 0) {
          const unit = normalizeUnit(categoryVolumeUnit || 'm²') || 'm²';
          const uKey = unitKey(unit) || unit;
          stat.volumeByUnit[uKey] = (stat.volumeByUnit[uKey] || 0) + categoryVolume;
        }

        const categorySubs = (room.subItems || []).filter((sub) =>
          resolveOperationalCategoryName(sub.category || room.workCategory, sub.workCategoryId) === categoryName
        );
        if (categorySubs.length > 0) {
          stat.totalSteps += categorySubs.length;
          stat.doneSteps += categorySubs.filter((sub) => sub.status === 'Đã hoàn thành').length;
          stat.inspectedSteps += categorySubs.filter((sub) => sub.status === 'Đã hoàn thành' && sub.inspectionStatus === 'Đạt nghiệm thu').length;
          if (categorySubs.every((sub) => sub.status === 'Đã hoàn thành')) stat.workDoneCount += 1;
          if (categorySubs.every((sub) => sub.status === 'Đã hoàn thành' && sub.inspectionStatus === 'Đạt nghiệm thu')) stat.inspectedCount += 1;
        } else {
          const legacyDone = room.inspectionStatus === 'Đạt nghiệm thu' ||
            (room.frameStatus === 'Đã hoàn thành' && room.boardStatus === 'Đã hoàn thành');
          if (legacyDone) stat.workDoneCount += 1;
          if (room.inspectionStatus === 'Đạt nghiệm thu') stat.inspectedCount += 1;
        }
      });
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' }));
  }, [floorRooms, resolveOperationalCategoryName]);

  const choosePdfPageNumber = async (file: File): Promise<number | null> => {
    const info = await getPdfDocumentInfo(file);
    if (info.pageCount <= 1) return 1;
    const raw = window.prompt(`PDF có ${info.pageCount} trang. Nhập số trang muốn dùng làm mặt bằng (1-${info.pageCount}):`, '1');
    if (raw === null) return null;
    const pageNumber = Math.trunc(Number(raw));
    if (!Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > info.pageCount) {
      alert(`Số trang không hợp lệ. Vui lòng chọn từ 1 đến ${info.pageCount}.`);
      return null;
    }
    return pageNumber;
  };

  const renderFloorPlanFile = async (file: File): Promise<string | null> => {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      const pageNumber = await choosePdfPageNumber(file);
      if (pageNumber === null) return null;
      const profile = getImageQualityProfile('floorPlan');
      return convertPdfToImage(file, { pageNumber, maxDimension: profile.maxDimension, quality: profile.quality });
    }
    if (!(file.type || '').startsWith('image/') && !/\.(jpe?g|png|webp)$/i.test(file.name || '')) {
      throw new Error('Chỉ hỗ trợ PDF, JPG, PNG hoặc WebP.');
    }
    return compressFloorPlanImage(file);
  };

  // Handle PDF/Image upload from legacy quick input.
  const handlePdfFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsConvertingPdf(true);
      const planUrl = await renderFloorPlanFile(file);
      if (!planUrl) return;

      const floorNameClean = file.name.replace(/\.[^/.]+$/, '');
      if (isFloorNameTaken(floorNameClean)) {
        alert(`Tên mặt bằng “${floorNameClean}” đã tồn tại. Vui lòng đổi tên tệp hoặc dùng chức năng cập nhật bản vẽ của tầng hiện có.`);
        return;
      }
      const newFloorId = createEntityId('fp-pdf');

      // Create Floor Plan
      onAddFloorPlan({
        id: newFloorId,
        floorName: `Mặt bằng PDF - ${floorNameClean}`,
        imageUrl: planUrl,
        uploadedAt: new Date().toISOString().split('T')[0],
      });

      // Do not create demo Căn / Phòng or fake progress from an uploaded drawing.
      setSelectedFloorId(newFloorId);
      alert(`Đã nạp mặt bằng "${file.name}" thành công. Bản vẽ mới không tự tạo dữ liệu Căn / Phòng mẫu.`);
    } catch (err) {
      console.error('PDF upload error:', err);
      alert(describePdfError(err));
    } finally {
      setIsConvertingPdf(false);
    }
  };

  // Handle PDF/Image file upload to update an existing floor plan drawing
  const handleUpdatePlanFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canManageStructure) { if (e.target) e.target.value = ''; return; }
    const file = e.target.files?.[0];
    if (!file || !updatingFloorPlanId) return;

    try {
      setIsConvertingPdf(true);
      const planUrl = await renderFloorPlanFile(file);
      if (!planUrl) return;

      if (onUpdateFloorPlanImage) {
        onUpdateFloorPlanImage(updatingFloorPlanId, planUrl);
        alert(`🎉 Đã cập nhật thành công bản vẽ mới cho tầng!`);
      }
    } catch (err) {
      console.error('Update floor plan drawing error:', err);
      alert(describePdfError(err));
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
    if (!canManageStructure) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    const selectedIdsForDrag = selectedRoomIds.includes(room.id) && handle === 'move' ? selectedRoomIds : [room.id];
    if (selectedIdsForDrag.some((id) => lockedRoomIds.has(id))) {
      setCopyNotification('🔒 Căn/Phòng đang khóa vị trí. Mở khóa trước khi di chuyển hoặc chỉnh kích thước.');
      window.setTimeout(() => setCopyNotification(null), 2200);
      return;
    }
    if (!imageContainerRef.current) return;

    // Moving/resizing a room must never fall through to the canvas click handler.
    // Highlight mode treats a blank click as Add Room, so a compatibility click
    // emitted after pointer-up would otherwise create an extra room. Arm this only
    // after the drag is actually allowed, otherwise a locked-room click could leave
    // the canvas click suppression stuck on indefinitely.
    suppressNextCanvasClickRef.current = true;
    if (roomInteractionClickResetTimerRef.current !== null) {
      window.clearTimeout(roomInteractionClickResetTimerRef.current);
      roomInteractionClickResetTimerRef.current = null;
    }
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
    if (!canManageStructure && drawTool !== 'none') setDrawTool('none');

    // Navigation wins over creation. Mobile: one-finger background drag pans.
    // Desktop: middle mouse drag or Space + left mouse drag pans.
    const canTouchPan = activeDragHandle === null && drawTool !== 'freehand' && drawTool !== '2point' && drawTool !== 'drag';
    const wantsDesktopPan = e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && spacePanHeldRef.current));
    // A stationary touch still produces the normal click/tap action; movement becomes pan.
    // This lets users navigate even while Polygon / Add Room / Add Defect mode is armed.
    const wantsTouchPan = e.pointerType === 'touch' && canTouchPan;
    if ((wantsDesktopPan || wantsTouchPan) && parentRef.current) {
      panStateRef.current = { active: true, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, scrollLeft: parentRef.current.scrollLeft, scrollTop: parentRef.current.scrollTop, moved: false };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
      if (wantsDesktopPan) e.preventDefault();
      return;
    }
    
    if (e.button === 0 || e.pointerType === 'touch') {
      canvasPressRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
    }

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
    const pan = panStateRef.current;
    if (pan.active && pan.pointerId === e.pointerId && parentRef.current) {
      const dx = e.clientX - pan.startX, dy = e.clientY - pan.startY;
      if (dx * dx + dy * dy > 144) {
        pan.moved = true;
        suppressNextCanvasClickRef.current = true;
        if (touchHoldTimerRef.current) { clearTimeout(touchHoldTimerRef.current); touchHoldTimerRef.current = null; }
      }
      parentRef.current.scrollLeft = pan.scrollLeft - dx;
      parentRef.current.scrollTop = pan.scrollTop - dy;
      return;
    }
    const press = canvasPressRef.current;
    if (press.pointerId === e.pointerId && !press.moved) {
      const pressDx = e.clientX - press.startX;
      const pressDy = e.clientY - press.startY;
      if (pressDx * pressDx + pressDy * pressDy > 64) { // >8px = navigation/drag, not a click
        press.moved = true;
        suppressNextCanvasClickRef.current = true;
      }
    }

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
    if (canvasPressRef.current.pointerId === e.pointerId) {
      canvasPressRef.current.pointerId = null;
    }

    if (panStateRef.current.active && panStateRef.current.pointerId === e.pointerId) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      const moved = panStateRef.current.moved;
      panStateRef.current = { active: false, pointerId: null, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0, moved: false };
      if (moved) window.setTimeout(() => { suppressNextCanvasClickRef.current = false; }, 0);
      return;
    }

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
      roomInteractionClickResetTimerRef.current = window.setTimeout(() => {
        suppressNextCanvasClickRef.current = false;
        roomInteractionClickResetTimerRef.current = null;
      }, 250);
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
    if (!canManageStructure || polygonPoints.length < 2) return;
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
    if (!canEditDefects) return;
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
    if (suppressNextCanvasClickRef.current) { suppressNextCanvasClickRef.current = false; return; }
    if (!imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const { x: rawX, y: rawY } = getMappedCoordinates(e, imageContainerRef.current, rotation);
    const x = Math.min(100, Math.max(0, Math.round(rawX * 10) / 10));
    const y = Math.min(100, Math.max(0, Math.round(rawY * 10) / 10));

    lastPointerMapPosRef.current = { x, y };

    // RC2.2.5: EDITOR may place defects but must never enter any floor/room structural
    // creation flow, including stale draw/pin state left over from an ADMIN session.
    if (!canManageStructure) {
      setIsRoomPinPlacementMode(false);
      setDrawTool('none');
      setDrawStartPos(null);
      setDrawHoverPos(null);
      setPolygonPoints([]);
      setPendingDraftHighlight(null);
      setSelectedRoomForDragId(null);
      setSelectedRoomIds([]);
      setClickChoicePos(null);
      setTouchMenu(null);
      setHoveredRoomId(null);
      if (canEditDefects && isDefectPinPlacementMode) {
        setIsDefectPinPlacementMode(false);
        openDefectModalForPin(x, y);
      }
      return;
    }

    // Explicit room placement: never invent a default coordinate.
    if (isRoomPinPlacementMode) {
      setIsRoomPinPlacementMode(false);
      setIsDefectPinPlacementMode(false);
      setSelectedRoomForEdit(null);
      setNewRoomClickPos({ x, y });
      setNewRoomRect({ x: Math.max(0, x - 8), y: Math.max(0, y - 6), width: 16, height: 12 });
      setNewRoomPoints(undefined);
      setIsRoomModalOpen(true);
      return;
    }

    // Defect pin placement is explicit: press "+ Defect" first, then tap the exact location.
    // This prevents accidental defect creation while panning/inspecting the drawing.
    if (isDefectPinPlacementMode) {
      setIsRoomPinPlacementMode(false);
      setIsDefectPinPlacementMode(false);
      openDefectModalForPin(x, y);
      return;
    }

    // In Defect-only mode, a normal tap is inspection/navigation only.
    if (viewMode === 'defect') {
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
      if (viewMode === 'highlight') {
        setSelectedRoomForEdit(null);
        setNewRoomClickPos({ x, y });
        setNewRoomRect({ x: Math.max(0, x - 8), y: Math.max(0, y - 6), width: 16, height: 12 });
        setNewRoomPoints(undefined);
        setIsRoomModalOpen(true);
        return;
      }
      // Tổng hợp/Defect: normal blank tap is inspection only; creation must be explicit.
      setClickChoicePos(null);
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

  const choosePdfPageNumberFromCount = (pageCount: number): number | null => {
    if (pageCount <= 1) return 1;
    const raw = window.prompt(`PDF có ${pageCount} trang. Nhập số trang muốn dùng làm mặt bằng (1-${pageCount}):`, '1');
    if (raw === null) return null;
    const pageNumber = Math.trunc(Number(raw));
    if (!Number.isFinite(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      alert(`Số trang không hợp lệ. Vui lòng chọn từ 1 đến ${pageCount}.`);
      return null;
    }
    return pageNumber;
  };

  const updatePendingPdfRoom = (id: string, updates: Partial<PdfRoomCandidate>) => {
    setPendingSmartPdfImport((prev) => prev ? {
      ...prev,
      rooms: prev.rooms.map((room) => room.id === id ? { ...room, ...updates } : room),
    } : prev);
  };

  const commitPendingSmartPdfImport = (createDetectedRooms: boolean) => {
    const pending = pendingSmartPdfImport;
    if (!pending) return;

    const selectedRooms = createDetectedRooms ? pending.rooms.filter((room) => room.selected) : [];
    if (createDetectedRooms) {
      const unnamed = selectedRooms.filter((room) => !room.roomName.trim());
      if (unnamed.length > 0) {
        alert(`Còn ${unnamed.length} vùng đã chọn chưa có tên. Hãy nhập tên Căn / Phòng hoặc bỏ chọn vùng đó trước khi tạo.`);
        return;
      }
      const normalizedNames = selectedRooms.map((room) => room.roomName.trim().toLocaleLowerCase('vi'));
      const duplicatedNames = Array.from(new Set(normalizedNames.filter((name, index) => normalizedNames.indexOf(name) !== index)));
      if (duplicatedNames.length > 0) {
        alert(`Có tên Căn / Phòng bị trùng: ${duplicatedNames.join(', ')}. Hãy sửa tên trước khi tạo để tránh nhầm dữ liệu.`);
        return;
      }
    }

    onAddFloorPlan({
      id: pending.floorId,
      floorName: pending.floorName,
      imageUrl: pending.imageUrl,
      uploadedAt: new Date().toISOString().split('T')[0],
    });

    const now = Date.now();
    const detectedRoomRecords: RoomProgressItem[] = selectedRooms.map((candidate) => ({
      id: createEntityId('ROOM'),
      floorId: pending.floorId,
      floorName: pending.floorName,
      roomName: candidate.roomName.trim(),
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
      points: candidate.points,
      isPolyline: false,
      frameStatus: 'Chưa làm',
      boardStatus: 'Chưa làm',
      frameInspectionStatus: 'Chưa nghiệm thu',
      boardInspectionStatus: 'Chưa nghiệm thu',
      inspectionStatus: 'Chưa nghiệm thu',
      color: candidate.color,
      createdAt: now,
      updatedAt: now,
    }));

    if (detectedRoomRecords.length > 0 && onCreateMultipleRoomProgress) {
      onCreateMultipleRoomProgress(detectedRoomRecords);
    } else {
      detectedRoomRecords.forEach(({ updatedAt: _updatedAt, ...room }) => onSaveRoomProgress(room));
    }

    setSelectedFloorId(pending.floorId);
    setPendingSmartPdfImport(null);
    setNewFloorName('');
    alert(createDetectedRooms
      ? `Đã tạo mặt bằng "${pending.floorName}" và ${selectedRooms.length} Căn / Phòng từ vùng highlight PDF.`
      : `Đã tạo mặt bằng "${pending.floorName}". Không tạo Căn / Phòng tự động.`);
  };

  // Upload a new floor-plan PDF or image. PDF can optionally detect highlighted room regions + text labels.
  const handlePlanFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !newFloorName.trim()) return;
    try {
      setIsUploadingPlan(true);
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const savedFloorName = newFloorName.trim();
      if (isFloorNameTaken(savedFloorName)) {
        alert(`Tên mặt bằng “${savedFloorName}” đã tồn tại. Vui lòng dùng tên khác trước khi tải bản vẽ.`);
        return;
      }
      const newFloorId = createEntityId('fp');

      if (isPdf) {
        const pdf = await loadPdfDocument(file);
        try {
          const pageCount = Math.max(1, Number(pdf.numPages || 1));
          const pageNumber = choosePdfPageNumberFromCount(pageCount);
          if (pageNumber === null) return;
          const profile = getImageQualityProfile('floorPlan');
          const planUrl = await renderPdfDocumentPageToImage(pdf, {
            pageNumber,
            maxDimension: profile.maxDimension,
            quality: profile.quality,
            // When Smart PDF is enabled, the annotation geometry is used to create
            // app-native highlights. Hiding annotations in the background prevents
            // the original PDF highlight from being painted a second time.
            hideAnnotations: smartPdfDetectionEnabled && smartPdfHideOriginalAnnotations,
          });

          if (smartPdfDetectionEnabled) {
            setIsDetectingPdfRooms(true);
            try {
              const detectedRooms = await detectPdfRoomCandidatesFromDocument(pdf, {
                pageNumber,
                minAreaPercent: smartPdfMinAreaPercent,
                maxAreaPercent: smartPdfMaxAreaPercent,
                useColorFilter: smartPdfUseColorFilter,
                targetColor: smartPdfTargetColor,
                colorTolerance: smartPdfColorTolerance,
                includeRasterFallback: smartPdfRasterFallback,
                namePattern: smartPdfNamePattern,
                centerSearchMarginPercent: smartPdfCenterSearchMarginPercent,
                allowNumericOnlyNames: smartPdfAllowNumericOnlyNames,
                allowedAnnotationSubtypes: ['square', 'polygon', 'highlight'],
              });
              setPendingSmartPdfImport({
                floorId: newFloorId,
                floorName: savedFloorName,
                fileName: file.name,
                imageUrl: planUrl,
                pageNumber,
                pageCount,
                rooms: detectedRooms,
              });
              setShowAddFloorModal(false);
              return;
            } catch (detectErr) {
              console.warn('Smart PDF room detection failed; keeping normal PDF upload:', detectErr);
              // Detection is an optional accelerator. A valid PDF must still be usable
              // even when an unusual annotation/text layer cannot be analyzed.
              onAddFloorPlan({ id: newFloorId, floorName: savedFloorName, imageUrl: planUrl, uploadedAt: new Date().toISOString().split('T')[0] });
              setSelectedFloorId(newFloorId);
              setShowAddFloorModal(false);
              setNewFloorName('');
              alert(`Đã tải mặt bằng "${savedFloorName}" thành công.\n\nKhông thể tự nhận diện Căn / Phòng từ PDF này; bạn vẫn có thể tạo Căn / Phòng thủ công.`);
              return;
            } finally {
              setIsDetectingPdfRooms(false);
            }
          }

          onAddFloorPlan({ id: newFloorId, floorName: savedFloorName, imageUrl: planUrl, uploadedAt: new Date().toISOString().split('T')[0] });
          setSelectedFloorId(newFloorId);
          setShowAddFloorModal(false);
          setNewFloorName('');
          alert(`Đã tải mặt bằng "${savedFloorName}" thành công.`);
          return;
        } finally {
          try { await pdf.destroy?.(); } catch {}
        }
      }

      const planUrl = await renderFloorPlanFile(file);
      if (!planUrl) return;
      onAddFloorPlan({ id: newFloorId, floorName: savedFloorName, imageUrl: planUrl, uploadedAt: new Date().toISOString().split('T')[0] });
      setSelectedFloorId(newFloorId);
      setShowAddFloorModal(false);
      setNewFloorName('');
      alert(`Đã tải mặt bằng "${savedFloorName}" thành công.`);
    } catch (err: any) {
      console.error('Floor plan upload error:', err);
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      alert(isPdf ? describePdfError(err) : (err?.message || 'Không thể đọc tệp mặt bằng.'));
    } finally {
      setIsDetectingPdfRooms(false);
      setIsUploadingPlan(false);
      e.target.value = '';
    }
  };

  // Select Defect Photo
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEditDefects) { e.target.value = ''; return; }
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
    if (!canEditDefects) return;
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
    if (!canEditDefects) { e.target.value = ''; return; }
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
    if (!canEditDefects) { e.target.value = ''; return; }
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
    if (!canEditDefects) return;
    if (!activeDefectDetail) return;
    const updated = { ...activeDefectDetail, imageUrl: undefined };
    setActiveDefectDetail(updated);
    if (onUpdateDefect) {
      onUpdateDefect(updated);
    }
  };

  const handleClearModalAfterPhoto = () => {
    if (!canEditDefects) return;
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
    if (!canEditDefects) return;
    if (!pinPos || !activeFloor) return;

    const linkage = resolveDefectLinkageFromSelection(
      { x: pinPos.x, y: pinPos.y },
      assignedTo,
      floorRooms,
      teams
    );

    onAddDefect({
      id: draftDefectId,
      floorId: activeFloor.id,
      floorName: activeFloor.floorName,
      roomId: linkage.roomId,
      teamId: linkage.teamId,
      category,
      x: pinPos.x,
      y: pinPos.y,
      description: description.trim() || `Lỗi ${category} tại vị trí (${pinPos.x}%, ${pinPos.y}%)`,
      severity,
      assignedTo: linkage.assignedTo,
      createdBy: createdBy.trim() || inspectorName || 'Kỹ sư QC',
      dueDate: dueDate || undefined,
      imageUrl: photoUrl || undefined,
      afterImageUrl: afterPhotoUrl || undefined,
      status: 'Mới phát hiện',
    });

    const nextDraftId = `defect_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    safeSetLocalStorageItem(getDraftKey('construction_defect_draft_id'), nextDraftId);
    setDraftDefectId(nextDraftId);

    setShowDefectModal(false);
    setPinPos(null);
    setDescription('');
    setPhotoUrl('');
    setAfterPhotoUrl('');

    // Clear draft storage
    localStorage.removeItem(getDraftKey('construction_defect_draft_pinPos'));
    safeSetLocalStorageItem(getDraftKey('construction_defect_draft_showDefectModal'), 'false');
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
          {canManageStructure && <button
            type="button"
            onClick={() => setShowManageFloorsModal(true)}
            className="flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-2.5 py-2 rounded-xl text-xs font-bold active:scale-95 transition-all shadow-xs"
            title="Quản lý, đổi tên, sao chép hoặc xóa các tầng"
          >
            <Settings className="w-3.5 h-3.5" />
            Tùy chỉnh tầng
          </button>}
          <input
            type="file"
            ref={updatePlanInputRef}
            accept=".pdf,image/*"
            className="hidden"
            onChange={handleUpdatePlanFileChange}
          />
        </div>
      </div>

      {/* Operational floor target dates belong with the floor plan, not system Configuration. */}
      {activeFloor && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setShowFloorProgressPanel((value) => !value)}
            className="w-full p-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900">
                <Clock className="w-4 h-4 text-indigo-600" /> Kế hoạch tiến độ tầng
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                {activeFloor.floorName} · Khung: {activeFloor.targetFrameDate ? formatDateDDMMYYYY(activeFloor.targetFrameDate) : 'chưa đặt'} · Tấm: {activeFloor.targetBoardDate ? formatDateDDMMYYYY(activeFloor.targetBoardDate) : 'chưa đặt'}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`hidden sm:inline-flex px-2 py-1 rounded-lg border text-[9px] font-bold ${getFloorTargetState(activeFloor.targetFrameDate).className}`}>
                Khung · {getFloorTargetState(activeFloor.targetFrameDate).label}
              </span>
              <span className={`hidden sm:inline-flex px-2 py-1 rounded-lg border text-[9px] font-bold ${getFloorTargetState(activeFloor.targetBoardDate).className}`}>
                Tấm · {getFloorTargetState(activeFloor.targetBoardDate).label}
              </span>
              {showFloorProgressPanel ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </div>
          </button>

          {showFloorProgressPanel && (
            <div className="border-t border-slate-100 p-3 space-y-3 bg-slate-50/60">
              <div className="md:hidden rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                <div className="font-extrabold text-xs text-slate-800">{activeFloor.floorName}</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'targetFrameDate' as const, label: 'Xong Khung', value: activeFloor.targetFrameDate },
                    { key: 'targetBoardDate' as const, label: 'Xong Tấm', value: activeFloor.targetBoardDate },
                  ].map((field) => {
                    const state = getFloorTargetState(field.value);
                    return (
                      <label key={field.key} className="space-y-1">
                        <span className="text-[10px] font-bold text-slate-600">{field.label}</span>
                        <input
                          type="date"
                          value={field.value || ''}
                          disabled={!canManageStructure}
                          onChange={(event) => onUpdateFloorPlan?.(activeFloor.id, { [field.key]: event.target.value })}
                          className="w-full border border-slate-200 bg-white rounded-lg px-2 py-1.5 text-[11px] font-bold disabled:bg-slate-100 disabled:text-slate-500"
                        />
                        <span className={`inline-flex px-1.5 py-0.5 rounded-md border text-[9px] font-bold ${state.className}`}>{state.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-[10px] border-separate border-spacing-y-1">
                  <thead className="text-slate-500">
                    <tr><th className="text-left px-2">Tầng</th><th className="text-left px-2">Xong Khung</th><th className="text-left px-2">Xong Tấm</th></tr>
                  </thead>
                  <tbody>
                    {floorPlans.map((floor) => {
                      const frameState = getFloorTargetState(floor.targetFrameDate);
                      const boardState = getFloorTargetState(floor.targetBoardDate);
                      return (
                        <tr key={floor.id} className={floor.id === activeFloor.id ? 'bg-indigo-50' : 'bg-white'}>
                          <td className="px-2 py-2 rounded-l-xl font-extrabold text-slate-800">{floor.floorName}</td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              <input type="date" value={floor.targetFrameDate || ''} disabled={!canManageStructure} onChange={(event) => onUpdateFloorPlan?.(floor.id, { targetFrameDate: event.target.value })} className="border border-slate-200 rounded-lg px-2 py-1 text-[10px] disabled:bg-slate-100" />
                              <span className={`px-1.5 py-0.5 rounded-md border font-bold ${frameState.className}`}>{frameState.label}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2 rounded-r-xl">
                            <div className="flex items-center gap-2">
                              <input type="date" value={floor.targetBoardDate || ''} disabled={!canManageStructure} onChange={(event) => onUpdateFloorPlan?.(floor.id, { targetBoardDate: event.target.value })} className="border border-slate-200 rounded-lg px-2 py-1 text-[10px] disabled:bg-slate-100" />
                              <span className={`px-1.5 py-0.5 rounded-md border font-bold ${boardState.className}`}>{boardState.label}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!canManageStructure && (
                <p className="text-[10px] text-slate-500">Ngày mục tiêu là kế hoạch dùng chung của dự án. Kỹ sư/Viewer được xem cảnh báo; chỉ ADMIN được đổi ngày.</p>
              )}
            </div>
          )}
        </div>
      )}

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
          {canManageStructure && (
            <button
              type="button"
              onClick={handleDeleteAllOrphanedRooms}
              className="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-xl text-[11px] shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> XÓA SẠCH {orphanedRooms.length} PHÒNG ẨN NGAY
            </button>
          )}
        </div>
      )}

      {/* PDF Loading Banner */}
      {isConvertingPdf && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded-2xl flex items-center gap-3 animate-pulse shadow-sm">
          <div className="w-5 h-5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin shrink-0" />
          <div className="text-xs">
            <span className="font-bold block">🔄 Đang nạp &amp; chuyển đổi tệp PDF mặt bằng...</span>
            <span className="text-[11px] text-amber-700">Đang chuyển PDF thành ảnh mặt bằng sắc nét; không tự tạo Căn / Phòng hoặc dữ liệu mẫu.</span>
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
                        commitInlineFloorRename(fp.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          commitInlineFloorRename(fp.id);
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
                        commitInlineFloorRename(fp.id);
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
                      if (!canManageStructure) return;
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
                {canManageStructure && !isEditingInline && (
                  <div className="hidden sm:flex items-center gap-0.5 ml-1 opacity-80 group-hover:opacity-100 transition-opacity">
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
                        title="Di chuyển tầng sang trái"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
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
                        title="Di chuyển tầng sang phải"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>


      </div>

      {/* View mode: the same three names are used everywhere in the app.
          Press the active button again to return to Mặt bằng tổng hợp. */}
      <div className="bg-slate-200/90 p-1.5 rounded-2xl grid grid-cols-2 gap-1.5 text-xs font-bold shadow-inner">
        <button
          type="button"
          onClick={() => {
            setViewMode((currentMode) => currentMode === 'highlight' ? 'all' : 'highlight');
            setIsDefectPinPlacementMode(false);
            setDrawTool('none');
            setDrawStartPos(null);
            setDrawHoverPos(null);
            setPolygonPoints([]);
            setPendingDraftHighlight(null);
            setSelectedRoomForDragId(null);
          }}
          className={`py-2.5 px-2 sm:px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            viewMode === 'highlight'
              ? 'bg-indigo-600 text-white shadow-md font-black ring-2 ring-indigo-300 scale-[1.01]'
              : 'bg-white/80 text-slate-700 hover:bg-white hover:text-indigo-600'
          }`}
          title={viewMode === 'highlight' ? 'Nhấn lại để về Mặt bằng tổng hợp' : 'Chỉ hiển thị vùng Căn / Phòng thi công'}
        >
          <Building2 className="w-4 h-4 shrink-0" />
          <span className="truncate">Mặt bằng thi công ({floorRooms.length})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setViewMode((currentMode) => currentMode === 'defect' ? 'all' : 'defect');
            setIsDefectPinPlacementMode(false);
            setDrawTool('none');
            setDrawStartPos(null);
            setDrawHoverPos(null);
            setPolygonPoints([]);
            setPendingDraftHighlight(null);
            setSelectedRoomForDragId(null);
          }}
          className={`py-2.5 px-2 sm:px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            viewMode === 'defect'
              ? 'bg-rose-600 text-white shadow-md font-black ring-2 ring-rose-300 scale-[1.01]'
              : 'bg-white/80 text-slate-700 hover:bg-white hover:text-rose-600'
          }`}
          title={viewMode === 'defect' ? 'Nhấn lại để về Mặt bằng tổng hợp' : 'Chỉ hiển thị vị trí Defect'}
        >
          <MapPin className="w-4 h-4 shrink-0" />
          <span className="truncate">Mặt bằng Defect ({floorDefects.length})</span>
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
                  ? '✨ Mặt bằng tổng hợp'
                  : viewMode === 'highlight'
                  ? '🏗️ Mặt bằng thi công'
                  : '📌 Mặt bằng Defect'}{' '}
                · <span className="text-indigo-700">{activeFloor.floorName}</span>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 w-full sm:w-auto sm:flex sm:items-center">
              {canManageStructure && <button
                type="button"
                onClick={async () => {
                  setUpdatingFloorPlanId(activeFloor.id);
                  updatePlanInputRef.current?.click();
                }}
                className="col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/80 px-3 py-2 sm:py-1.5 rounded-xl text-xs font-bold transition-all shadow-2xs active:scale-95"
                title="Cập nhật tệp ảnh hoặc PDF bản vẽ mới cho tầng đang xem"
              >
                <Upload className="w-3.5 h-3.5 text-slate-600" />
                <span>Cập nhật bản vẽ</span>
              </button>}

              {canManageStructure && (viewMode === 'highlight' || viewMode === 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setIsDefectPinPlacementMode(false);
                    setDrawTool('none');
                    setSelectedRoomForEdit(null);
                    setNewRoomClickPos(null);
                    setNewRoomRect(null);
                    setNewRoomPoints(undefined);
                    setIsRoomPinPlacementMode((active) => !active);
                  }}
                  className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-2 sm:py-1.5 rounded-xl flex items-center justify-center gap-1.5 shadow-xs active:scale-95 transition-all min-w-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isRoomPinPlacementMode ? 'Chạm vị trí Căn / Phòng…' : 'Thêm Căn / Phòng'}</span>
                </button>
              )}

              {canEditDefects && (viewMode === 'defect' || viewMode === 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setIsRoomPinPlacementMode(false);
                    setDrawTool('none');
                    setPinPos(null);
                    setIsDefectPinPlacementMode((active) => !active);
                  }}
                  className={`text-xs font-bold px-3 py-2 sm:py-1.5 rounded-xl flex items-center justify-center gap-1.5 shadow-xs active:scale-95 transition-all min-w-0 ${
                    isDefectPinPlacementMode
                      ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 ring-2 ring-amber-200'
                      : 'bg-rose-600 hover:bg-rose-700 text-white'
                  }`}
                  title="Bấm nút rồi chạm đúng vị trí cần đặt Defect trên mặt bằng"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{isDefectPinPlacementMode ? 'Chạm vị trí Defect…' : 'Thêm Defect'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Dedicated Drawing & View Controls Toolbar */}
          {canManageStructure && (viewMode === 'highlight' || viewMode === 'all') && (
            <details className="group bg-slate-50/90 rounded-xl border border-slate-200/80">
              <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-bold text-slate-700 flex items-center justify-between">
                <span>Công cụ vẽ vùng Căn / Phòng</span>
                <span className="text-slate-400 group-open:hidden">Mở</span>
                <span className="text-slate-400 hidden group-open:inline">Thu gọn</span>
              </summary>
              <div className="p-2 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
              {/* Group 1: 3 Drawing Tools */}
              <div className="flex flex-wrap items-center gap-1.5">

                {/* Tool 1: Freehand Drawing */}
                <button
                  type="button"
                  onClick={async () => {
                    setIsRoomPinPlacementMode(false); setIsDefectPinPlacementMode(false);
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
                  <span>Vẽ tự do</span>
                </button>

                {/* Tool 2: Line / Polygon Point-by-Point (2 or more points) */}
                <button
                  type="button"
                  onClick={async () => {
                    setIsRoomPinPlacementMode(false); setIsDefectPinPlacementMode(false);
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
                  title="Chấm 2 hoặc nhiều điểm để vẽ đường thẳng / đa giác, rồi bấm [Xác nhận]"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>Vẽ đa giác</span>
                </button>

                {/* Tool 3: 2-Point Rectangle */}
                <button
                  type="button"
                  onClick={async () => {
                    setIsRoomPinPlacementMode(false); setIsDefectPinPlacementMode(false);
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
                  <span>Vẽ chữ nhật</span>
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
                  <span>{roomColorMode === 'palette' ? 'Mỗi Căn / Phòng 1 màu' : 'Theo trạng thái'}</span>
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
                  <span>{!showTextOverlay ? 'Chỉ hiện màu' : 'Hiện tên Căn / Phòng'}</span>
                </button>
              </div>
              </div>
            </details>
          )}

          {!canManageStructure && (viewMode === 'highlight' || viewMode === 'all') && (
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-50/90 rounded-xl border border-slate-200/80 px-2.5 py-2">
              <button
                type="button"
                onClick={() => setRoomColorMode(roomColorMode === 'palette' ? 'status' : 'palette')}
                className={`text-xs font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all ${
                  roomColorMode === 'palette' ? 'bg-indigo-600 text-white' : 'bg-amber-500 text-slate-950'
                }`}
                title="Đổi cách hiển thị màu Căn / Phòng"
              >
                <Palette className="w-3.5 h-3.5" />
                <span>{roomColorMode === 'palette' ? 'Mỗi Căn / Phòng 1 màu' : 'Theo trạng thái'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowTextOverlay(!showTextOverlay)}
                className={`text-xs font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 transition-all ${
                  !showTextOverlay ? 'bg-emerald-600 text-white' : 'bg-white text-slate-700 border border-slate-200'
                }`}
                title="Bật/Tắt nhãn tên Căn / Phòng"
              >
                {!showTextOverlay ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{!showTextOverlay ? 'Chỉ hiện màu' : 'Hiện tên Căn / Phòng'}</span>
              </button>
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
                        📏 Đường
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCompletePolygon(false)}
                        className="bg-emerald-950 text-emerald-300 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-emerald-900 transition-colors shadow-xs cursor-pointer"
                      >
                        ▭ Chữ nhật
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
                        〰️ Gấp khúc
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCompletePolygon(false)}
                        className="bg-emerald-950 text-emerald-300 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-emerald-900 transition-colors shadow-xs cursor-pointer"
                      >
                        🔷 Đa giác
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setPolygonPoints((prev) => prev.slice(0, -1))}
                    className="bg-slate-900/80 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-slate-900 cursor-pointer"
                  >
                    ↺ Điểm cuối
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
                  <strong>Kéo Vẽ tự do:</strong> Nhấn giữ & rê chuột/tay khoanh vùng bất kỳ. Nhả tay ra để chốt!
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
                  <strong>Đa giác:</strong> {polygonPoints.length} điểm · Click để thêm
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
                      📏 Đường
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCompletePolygon(false)}
                      className="bg-emerald-950 text-emerald-300 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-emerald-900 transition-colors shadow-xs cursor-pointer"
                    >
                      ▭ Chữ nhật
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
                      〰️ Gấp khúc
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCompletePolygon(false)}
                      className="bg-emerald-950 text-emerald-300 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-emerald-900 transition-colors shadow-xs cursor-pointer"
                    >
                      🔷 Đa giác
                    </button>
                  </>
                )}
                {polygonPoints.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPolygonPoints((prev) => prev.slice(0, -1))}
                    className="bg-slate-900/80 text-white text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-slate-900"
                  >
                    ↺ Điểm cuối
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
          {canManageStructure && pendingDraftHighlight && (
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
              <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={async () => {
                    setNewRoomRect(pendingDraftHighlight.rect);
                    setNewRoomPoints(pendingDraftHighlight.points);
                    setSelectedRoomForEdit({
                      id: '',
                      floorId: activeFloor.id,
                      roomName: getNextAvailableQuickRoomName(),
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
                  className="bg-slate-950 hover:bg-slate-900 text-amber-300 text-xs font-black px-3 py-1.5 rounded-xl shadow transition-all active:scale-95 flex items-center justify-center gap-1 cursor-pointer flex-1 min-w-[160px] sm:flex-none"
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
                      roomName: getNextAvailableQuickRoomName(),
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
                  className="bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl shadow transition-all active:scale-95 cursor-pointer flex-1 min-w-[105px] sm:flex-none"
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
          <div className={`${isFullscreen ? 'fixed inset-0 z-[100] bg-slate-950 rounded-none h-[100dvh] w-[100dvw] flex flex-col' : 'relative w-full h-[52dvh] min-h-[320px] max-h-[520px] sm:h-[400px] bg-slate-900 rounded-2xl'} overflow-hidden border border-slate-300 select-none group shadow-inner`}>
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

                    {canManageStructure && (viewMode === 'highlight' || viewMode === 'all') && (
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
                          <span>Vẽ tự do</span>
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
                          <span>Vẽ đa giác</span>
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
                          <span>Vẽ chữ nhật</span>
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
                          <span>{roomColorMode === 'palette' ? 'Mỗi Căn / Phòng 1 màu' : 'Theo trạng thái'}</span>
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
                          title="Hiện màu sạch / Hiện đầy đủ tên Căn / Phòng"
                        >
                          {!showTextOverlay ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          <span>{!showTextOverlay ? 'Chỉ hiện màu' : 'Hiện tên Căn / Phòng'}</span>
                        </button>

                        {/* Add Room */}
                        <button
                          type="button"
                          onClick={() => {
                            setIsDefectPinPlacementMode(false);
                            setDrawTool('none');
                            setSelectedRoomForEdit(null);
                            setNewRoomClickPos(null);
                            setNewRoomRect(null);
                            setNewRoomPoints(undefined);
                            setIsRoomPinPlacementMode((active) => !active);
                          }}
                          className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-xs shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{isRoomPinPlacementMode ? 'Chạm vị trí Căn / Phòng…' : 'Thêm Căn / Phòng'}</span>
                        </button>
                      </div>
                    )}

                    {canEditDefects && (viewMode === 'defect' || viewMode === 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          setDrawTool('none');
                          setPinPos(null);
                          setIsDefectPinPlacementMode((active) => !active);
                        }}
                        className={`text-[11px] font-black px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-xs shrink-0 ${
                          isDefectPinPlacementMode
                            ? 'bg-amber-400 hover:bg-amber-300 text-slate-950'
                            : 'bg-rose-600 hover:bg-rose-500 text-white'
                        }`}
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>{isDefectPinPlacementMode ? 'Chạm vị trí Defect…' : 'Thêm Defect'}</span>
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
                {canManageStructure && drawTool === 'polygon' && !redrawingRoomTarget && (
                  <div className="bg-amber-500 text-slate-950 px-2 py-1.5 rounded-xl text-[11px] font-bold flex flex-row flex-wrap items-center justify-between gap-1.5 border border-amber-300 shadow-lg animate-in slide-in-from-top-2 w-full">
                    <div className="flex items-center gap-1.5 w-full sm:w-auto">
                      <Sparkles className="w-4 h-4 text-slate-950 shrink-0" />
                      <span>
                        <strong>Đa giác:</strong> {polygonPoints.length} điểm · Click để thêm
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
                            📏 Đường
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCompletePolygon(false)}
                            className="bg-emerald-950 hover:bg-emerald-900 text-emerald-300 text-xs font-black px-3 py-1.5 rounded-xl transition-all shadow-md active:scale-95 flex items-center gap-1 cursor-pointer"
                          >
                            ▭ Chữ nhật
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
                            〰️ Gấp khúc
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCompletePolygon(false)}
                            className="bg-emerald-950 hover:bg-emerald-900 text-emerald-300 text-xs font-black px-3 py-1.5 rounded-xl transition-all shadow-md active:scale-95 flex items-center gap-1 cursor-pointer"
                          >
                            🔷 Đa giác
                          </button>
                        </>
                      )}
                      {polygonPoints.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPolygonPoints((prev) => prev.slice(0, -1))}
                          className="bg-slate-900 text-white text-[11px] font-bold px-2 py-1 rounded-xl hover:bg-slate-800"
                        >
                          ↺ Điểm cuối
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

                {canManageStructure && pendingDraftHighlight && (
                  <div className="bg-amber-500 text-slate-950 p-2 rounded-2xl shadow-2xl border-2 border-amber-300 flex flex-wrap items-center justify-between gap-2 animate-in zoom-in-95">
                    <div className="flex items-center gap-1.5 w-full sm:w-auto">
                      <Sparkles className="w-4 h-4 text-slate-950 shrink-0 animate-spin" />
                      <span className="font-black text-xs">Đã khoanh xong! Kiểm tra vùng vàng nhấp nháy trên bản vẽ.</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto sm:ml-auto justify-end">
                      <button
                        type="button"
                        onClick={async () => {
                          setNewRoomRect(pendingDraftHighlight.rect);
                          setNewRoomPoints(pendingDraftHighlight.points);
                          setSelectedRoomForEdit({
                            id: '',
                            floorId: activeFloor.id,
                            roomName: getNextAvailableQuickRoomName(),
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
                        className="bg-slate-950 hover:bg-slate-900 text-amber-300 text-xs font-black px-3 py-1.5 rounded-xl shadow transition-all active:scale-95 flex items-center justify-center gap-1 cursor-pointer flex-1 min-w-[160px] sm:flex-none"
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
                            roomName: getNextAvailableQuickRoomName(),
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
                        className="bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl shadow transition-all active:scale-95 cursor-pointer flex-1 min-w-[105px] sm:flex-none"
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
                      <span>💡 <strong>Kéo Vẽ tự do:</strong> Nhấn giữ & rê chuột/ngón tay khoanh vùng bất kỳ. Nhả tay để chốt!</span>
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
                              📏 Đường
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCompletePolygon(false)}
                              className="bg-emerald-950 text-emerald-300 text-[10px] font-black px-2.5 py-1 rounded-lg hover:bg-emerald-900 transition-colors shadow-xs cursor-pointer"
                            >
                              ▭ Chữ nhật
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
                              🔷 Đa giác
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
            {canManageStructure && (selectedRoomObject || copiedRoomsState.length > 0) && (
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
                      onClick={focusCurrentSelection}
                      className="flex items-center gap-1 bg-indigo-900/70 hover:bg-indigo-800 text-indigo-100 text-[11px] font-extrabold px-2 py-1 rounded-lg transition-colors border border-indigo-600 shadow-xs shrink-0"
                      title="Đưa Căn/Phòng đang chọn vào giữa màn hình"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Focus</span>
                    </button>
                    <button
                      type="button"
                      onClick={toggleSelectedRoomLock}
                      className={`flex items-center gap-1 text-[11px] font-extrabold px-2 py-1 rounded-lg transition-colors border shadow-xs shrink-0 ${selectedRoomsAreLocked ? 'bg-amber-500 text-slate-950 border-amber-300' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'}`}
                      title={selectedRoomsAreLocked ? 'Mở khóa vị trí Căn/Phòng đang chọn' : 'Khóa vị trí để tránh kéo/resize nhầm'}
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>{selectedRoomsAreLocked ? 'Mở khóa' : 'Khóa'}</span>
                    </button>

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

            {/* Compact Navigation Bar: zoom + fit + focus + minimap + layers */}
            <div className="absolute bottom-3 right-3 z-50 pointer-events-auto flex items-center gap-1 bg-slate-950/92 backdrop-blur-md px-2 py-1.5 rounded-xl border border-slate-700 shadow-2xl text-white text-[11px] max-w-[calc(100%-24px)] overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setZoomScale((prev) => Math.max(1, +(prev - 0.25).toFixed(2)))}
                className="p-1 hover:bg-slate-800 rounded-lg transition-colors text-slate-200 shrink-0"
                title="Thu nhỏ bản vẽ"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-extrabold px-1 text-amber-300 text-xs min-w-[42px] text-center shrink-0">
                {Math.round(zoomScale * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoomScale((prev) => Math.min(20, +(prev + 0.5).toFixed(2)))}
                className="p-1 hover:bg-slate-800 rounded-lg transition-colors text-slate-200 shrink-0"
                title="Phóng to bản vẽ"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={fitFloorPlan}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] font-black text-slate-200 shrink-0"
                title="Đưa toàn bộ bản vẽ vừa màn hình"
              >
                Fit
              </button>
              <button
                type="button"
                onClick={focusCurrentSelection}
                disabled={!selectedRoomObject && !selectedDefectForFocus}
                className="px-2 py-1 bg-indigo-700 hover:bg-indigo-600 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed rounded-lg text-[10px] font-black shrink-0"
                title="Đưa Căn/Defect đang chọn vào giữa màn hình"
              >
                🎯 Focus
              </button>
              <button
                type="button"
                onClick={() => setShowMiniMap((prev) => !prev)}
                className={`px-2 py-1 rounded-lg text-[10px] font-black shrink-0 ${showMiniMap ? 'bg-emerald-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'}`}
                title="Bật/tắt bản đồ nhỏ định hướng"
              >
                🗺 Mini
              </button>
              <button
                type="button"
                onClick={() => setShowLayerPanel((prev) => !prev)}
                className={`px-2 py-1 rounded-lg text-[10px] font-black shrink-0 ${showLayerPanel ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'}`}
                title="Ẩn/hiện nhanh các lớp trên mặt bằng"
              >
                Lớp
              </button>
              {isFullscreen && (
                <button
                  type="button"
                  onClick={() => setRotation(r => (r + 90) % 360)}
                  className="p-1 hover:bg-slate-800 rounded-lg transition-colors text-slate-200 shrink-0"
                  title="Xoay mặt bằng 90 độ"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              )}
              <div className="w-px h-4 bg-slate-700 mx-0.5 shrink-0"></div>
              <button
                type="button"
                onClick={() => {
                  if (isFullscreen) setRotation(0);
                  setIsFullscreen(!isFullscreen);
                }}
                className="p-1 hover:bg-slate-800 rounded-lg transition-colors text-slate-200 shrink-0"
                title={isFullscreen ? 'Thu nhỏ màn hình' : 'Toàn màn hình'}
              >
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5 text-amber-400" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </div>

            {showLayerPanel && (
              <div className="absolute bottom-14 right-3 z-50 w-[230px] max-w-[calc(100%-24px)] bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl p-2.5 text-[11px] text-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-black flex items-center gap-1"><Layers className="w-3.5 h-3.5 text-indigo-600" /> Lớp hiển thị</span>
                  <button type="button" onClick={() => setShowLayerPanel(false)} className="text-slate-400 hover:text-slate-700 font-black">✕</button>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {([
                    ['roomRegions', 'Vùng Căn/Phòng'],
                    ['roomLabels', 'Tên Căn/Phòng'],
                    ['defects', 'Marker Defect'],
                    ['resolvedDefects', 'Defect đã hoàn thành'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-100 cursor-pointer">
                      <span className="font-bold">{label}</span>
                      <input
                        type="checkbox"
                        checked={mapLayers[key]}
                        onChange={(e) => setMapLayers((prev) => ({ ...prev, [key]: e.target.checked }))}
                        className="accent-indigo-600"
                      />
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[9px] leading-snug text-slate-500">Chỉ thay đổi hiển thị trên máy này, không xóa dữ liệu và không ghi Firebase.</p>
              </div>
            )}

            {showMiniMap && zoomScale > 1.15 && activeFloor?.imageUrl && (
              <div className="absolute bottom-3 left-3 z-45 pointer-events-auto w-[150px] sm:w-[190px] bg-slate-950/92 rounded-xl border border-slate-600 shadow-2xl p-1.5 select-none">
                <div className="flex items-center justify-between text-[9px] text-slate-200 font-black mb-1 px-0.5">
                  <span>🗺 {activeFloor.floorName}</span>
                  <button type="button" onClick={() => setShowMiniMap(false)} className="text-slate-400 hover:text-white">✕</button>
                </div>
                <div
                  className="relative w-full aspect-[1.45/1] overflow-hidden bg-slate-800 rounded-lg cursor-crosshair touch-none"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    miniMapDragRef.current = true;
                    centerMiniMapAt(e.clientX, e.clientY, e.currentTarget);
                  }}
                  onPointerMove={(e) => {
                    if (miniMapDragRef.current) centerMiniMapAt(e.clientX, e.clientY, e.currentTarget);
                  }}
                  onPointerUp={(e) => {
                    miniMapDragRef.current = false;
                    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch {}
                  }}
                  onPointerCancel={() => { miniMapDragRef.current = false; }}
                >
                  <img
                    src={activeFloor.imageUrl}
                    alt="Mini-map"
                    className="absolute inset-0 w-full h-full object-contain opacity-75 pointer-events-none"
                    style={{ transform: `rotate(${rotation}deg)` }}
                  />
                  <div
                    className="absolute border-2 border-amber-400 bg-amber-300/20 rounded-sm pointer-events-none shadow"
                    style={{
                      left: `${Math.min(100, Math.max(0, (viewportInfo.scrollLeft / Math.max(1, viewportInfo.scrollWidth)) * 100))}%`,
                      top: `${Math.min(100, Math.max(0, (viewportInfo.scrollTop / Math.max(1, viewportInfo.scrollHeight)) * 100))}%`,
                      width: `${Math.min(100, Math.max(6, (viewportInfo.clientWidth / Math.max(1, viewportInfo.scrollWidth)) * 100))}%`,
                      height: `${Math.min(100, Math.max(6, (viewportInfo.clientHeight / Math.max(1, viewportInfo.scrollHeight)) * 100))}%`,
                    }}
                  />
                </div>
                <p className="text-[8px] text-slate-400 mt-1 px-0.5">Chạm/kéo để nhảy nhanh đến khu vực khác.</p>
              </div>
            )}

            {/* Scrollable / Zoomable Inner Area */}
            <div ref={parentRef} className={`w-full overflow-auto flex items-start justify-start ${isFullscreen ? 'flex-1' : 'h-full'}`}>
              <div
                style={{
                   width: containerW,
                   height: containerH,
                }}
                className="relative shrink-0 m-auto"
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
                          const w = e.currentTarget.naturalWidth;
                          const h = e.currentTarget.naturalHeight;
                          if (w > 0 && h > 0) setImgAspect(w / h);
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
                {mapLayers.roomRegions && (viewMode === 'all' || viewMode === 'highlight') && (() => {
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
            {canManageStructure && mapLayers.roomRegions && (viewMode === 'all' || viewMode === 'highlight') && (
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
              const isLocked = lockedRoomIds.has(room.id);

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

                  {isLocked ? (
                    <div
                      style={{ left: `${cx}%`, top: `${cy}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none bg-slate-950 text-amber-300 px-2 py-1 rounded-full shadow-xl border border-amber-400 text-[10px] font-black"
                      title="Căn/Phòng đang khóa vị trí"
                    >
                      🔒
                    </div>
                  ) : (<>
                  {/* Center Move Handle Badge */}
                  <div
                    style={{ left: `${cx}%`, top: `${cy}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'move')}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-grab active:cursor-grabbing bg-slate-950 text-amber-400 p-1.5 rounded-full shadow-2xl border-2 border-amber-400 flex items-center justify-center hover:scale-125 transition-transform group"
                    title="Nhấn giữ & kéo rê để di chuyển toàn bộ vùng highlight"
                  >
                    <Move className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform" />
                  </div>

                  {/* 4 Corner Resizing Handles */}
                  <div
                    style={{ left: `${rx}%`, top: `${ry}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'nw')}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-nwse-resize w-4 h-4 bg-amber-400 border-2 border-slate-950 rounded-full shadow-lg hover:scale-150 transition-transform"
                    title="Kéo chỉnh góc Trên-Trái"
                  />
                  <div
                    style={{ left: `${rx + rw}%`, top: `${ry}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'ne')}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-nesw-resize w-4 h-4 bg-amber-400 border-2 border-slate-950 rounded-full shadow-lg hover:scale-150 transition-transform"
                    title="Kéo chỉnh góc Trên-Phải"
                  />
                  <div
                    style={{ left: `${rx}%`, top: `${ry + rh}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'sw')}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-nesw-resize w-4 h-4 bg-amber-400 border-2 border-slate-950 rounded-full shadow-lg hover:scale-150 transition-transform"
                    title="Kéo chỉnh góc Dưới-Trái"
                  />
                  <div
                    style={{ left: `${rx + rw}%`, top: `${ry + rh}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'se')}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-nwse-resize w-4 h-4 bg-amber-400 border-2 border-slate-950 rounded-full shadow-lg hover:scale-150 transition-transform"
                    title="Kéo chỉnh góc Dưới-Phải"
                  />

                  {/* 4 Side Midpoint Handles */}
                  <div
                    style={{ left: `${cx}%`, top: `${ry}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'n')}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-ns-resize w-3.5 h-3.5 bg-amber-300 border-2 border-slate-900 rounded-sm shadow-md hover:scale-150 transition-transform"
                    title="Kéo chỉnh viền Cạnh Trên"
                  />
                  <div
                    style={{ left: `${cx}%`, top: `${ry + rh}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 's')}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-ns-resize w-3.5 h-3.5 bg-amber-300 border-2 border-slate-900 rounded-sm shadow-md hover:scale-150 transition-transform"
                    title="Kéo chỉnh viền Cạnh Dưới"
                  />
                  <div
                    style={{ left: `${rx}%`, top: `${cy}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'w')}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto cursor-ew-resize w-3.5 h-3.5 bg-amber-300 border-2 border-slate-900 rounded-sm shadow-md hover:scale-150 transition-transform"
                    title="Kéo chỉnh viền Cạnh Trái"
                  />
                  <div
                    style={{ left: `${rx + rw}%`, top: `${cy}%`, touchAction: 'none' }}
                    onPointerDown={(e) => handleStartDrag(e, room, 'e')}
                    onClick={(e) => e.stopPropagation()}
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
                    onClick={(e) => e.stopPropagation()}
                        className="absolute -translate-x-1/2 -translate-y-1/2 z-45 pointer-events-auto cursor-crosshair w-4 h-4 bg-amber-500 border-2 border-slate-950 rounded-full shadow-lg hover:scale-150 transition-transform flex items-center justify-center text-[8px] font-black text-slate-950"
                        title={`Kéo di chuyển Đỉnh Góc #${pIdx + 1}`}
                      >
                        {pIdx + 1}
                      </div>
                    ))}
                  </>)}

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
            {mapLayers.roomLabels && (viewMode === 'all' || viewMode === 'highlight') && (
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
                          <span className={`max-w-[128px] sm:max-w-[180px] whitespace-normal break-words text-center leading-tight text-[9px] sm:text-[10px] font-extrabold px-2 py-0.5 rounded-xl shadow-md backdrop-blur-xs border inline-flex flex-wrap items-center justify-center gap-1 ${
                            isFailed
                              ? 'bg-rose-950/90 text-rose-200 border-rose-500'
                              : isPassed
                              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500'
                              : 'bg-slate-950/85 text-slate-100 border-slate-600'
                          }`}>
                            {room.roomName}{lockedRoomIds.has(room.id) ? ' 🔒' : ''}
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
                        <span className="max-w-[128px] sm:max-w-[180px] whitespace-normal break-words text-center leading-tight font-extrabold text-[9px] sm:text-[10px] bg-black/85 text-white px-2 py-0.5 rounded-md shadow border border-white/20">
                          {room.roomName}{lockedRoomIds.has(room.id) ? ' 🔒' : ''}
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
            {mapLayers.defects && (viewMode === 'all' || viewMode === 'defect') && (
              <>
                {mapFloorDefects.map((defect) => {
                  const isResolved = defect.status === 'Đã nghiệm thu' || defect.status === 'Đã khắc phục';
                  const isSevere = defect.severity === 'Nghiêm trọng';
                  const shortDefectCode = getDefectShortCode(defect.id);
                  // Spread markers that are almost on top of each other on mobile.
                  const nearby = mapFloorDefects
                    .filter((other) => Math.hypot(Number(other.x) - Number(defect.x), Number(other.y) - Number(defect.y)) <= 2.2)
                    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
                  const clusterIndex = Math.max(0, nearby.findIndex((item) => item.id === defect.id));
                  const x = Number(defect.x) || 0;
                  const y = Number(defect.y) || 0;
                  let markerX: number;
                  let markerY: number;
                  if (nearby.length > 1) {
                    const angle = (Math.PI * 2 * clusterIndex) / nearby.length;
                    const spread = Math.min(4.2, 2.8 + nearby.length * 0.24);
                    markerX = Math.max(2.5, Math.min(97.5, x + Math.cos(angle) * spread));
                    markerY = Math.max(2.5, Math.min(97.5, y + Math.sin(angle) * spread));
                  } else {
                    // Keep the real dot visible even for a single Defect; the label is offset
                    // and connected by a short leader instead of covering the real position.
                    const dx = x > 84 ? -3.6 : 3.6;
                    const dy = y < 12 ? 2.5 : -2.5;
                    markerX = Math.max(2.5, Math.min(97.5, x + dx));
                    markerY = Math.max(2.5, Math.min(97.5, y + dy));
                  }
                  const pinColor = isResolved ? '#10b981' : isSevere ? '#e11d48' : '#f59e0b';
                  // Keep the real dot/leader compact as the drawing zooms, but keep the text
                  // badge close to the Căn / Phòng label size. The old implementation applied
                  // the same 55% scale to the badge at high zoom, which made DF-xx unreadable
                  // around 500-700%. SVG geometry still compensates strongly; the label only
                  // shrinks gently (minimum 92%) because it already uses screen-pixel sizing.
                  const defectVisualScale = Math.max(0.55, Math.min(1, 1 / Math.sqrt(Math.max(1, zoomScale))));
                  const defectLabelScale = Math.max(0.82, Math.min(1, 1 / Math.pow(Math.max(1, zoomScale), 0.06)));
                  const svgZoomCompensation = defectVisualScale / Math.max(1, zoomScale);

                  return (
                    <React.Fragment key={defect.id}>
                      <svg
                        className="absolute inset-0 w-full h-full pointer-events-none z-20 overflow-visible"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <line
                          x1={x}
                          y1={y}
                          x2={markerX}
                          y2={markerY}
                          stroke={pinColor}
                          strokeWidth={0.22 * svgZoomCompensation}
                          opacity="0.82"
                        />
                        <circle
                          cx={x}
                          cy={y}
                          r={0.78 * svgZoomCompensation}
                          fill="white"
                          stroke={pinColor}
                          strokeWidth={0.25 * svgZoomCompensation}
                        />
                        <circle cx={x} cy={y} r={0.30 * svgZoomCompensation} fill={pinColor} />
                      </svg>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveDefectDetail(defect);
                        }}
                        style={{ left: `${markerX}%`, top: `${markerY}%` }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-30 transition-transform hover:scale-110 active:scale-105"
                        title={`${shortDefectCode} · ${defect.category}${defect.description ? ` · ${defect.description}` : ''}`}
                      >
                        <div
                          style={{
                            transform: `scale(${defectLabelScale})`,
                            transformOrigin: 'center',
                          }}
                          className={`h-5 min-w-6 px-1.5 rounded-lg flex items-center justify-center text-white font-extrabold text-[8px] sm:text-[9px] leading-none shadow border border-white/90 whitespace-nowrap ${
                            isResolved
                              ? 'bg-emerald-500'
                              : isSevere
                              ? 'bg-rose-600'
                              : 'bg-amber-500'
                          }`}
                        >
                          {shortDefectCode}{lockedDefectIds.has(defect.id) ? ' 🔒' : ''}
                        </div>
                      </div>
                    </React.Fragment>
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
                {canManageStructure && clickChoicePos && (
                  <div
                    style={{
                      left: `clamp(105px, ${clickChoicePos.x}%, calc(100% - 105px))`,
                      top: `clamp(115px, ${clickChoicePos.y}%, calc(100% - 115px))`,
                    }}
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
                        Vẽ vùng
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
                        Thêm Căn / Phòng
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
              ? '💡 Dùng công cụ vẽ để đánh dấu vùng Căn / Phòng thi công trên mặt bằng.'
              : viewMode === 'defect'
              ? '💡 Bấm “Thêm Defect” rồi chạm đúng vị trí cần ghim; bấm mã Defect để xem chi tiết.'
              : '💡 Mặt bằng tổng hợp đang hiển thị cả Căn / Phòng thi công và vị trí Defect.'}
          </p>
        </div>
      )}

      {/* SECTION FOR HIGHLIGHT MODE: ROOM PROGRESS DASHBOARD & LIST */}
      {(viewMode === 'highlight' || viewMode === 'all') && (
        <div className="space-y-3">
          {/* Progress summary: prefer real dynamic work categories; keep legacy Khung/Tấm only for old records. */}
          {floorCategorySummary.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
              {floorCategorySummary.map((stat) => {
                const workPercent = stat.roomCount > 0 ? Math.round((stat.workDoneCount / stat.roomCount) * 100) : 0;
                const inspectionPercent = stat.roomCount > 0 ? Math.round((stat.inspectedCount / stat.roomCount) * 100) : 0;
                const volumeText = (Object.entries(stat.volumeByUnit) as Array<[string, number]>)
                  .map(([unit, value]) => `${formatDecimal(value)} ${unit}`)
                  .join(' + ');
                return (
                  <div key={stat.name} className="bg-indigo-50/70 p-2.5 rounded-2xl border border-indigo-200/80 shadow-2xs space-y-1.5 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-extrabold text-indigo-950 text-[11px] leading-snug break-words">{stat.name}</span>
                      <span className="text-[10px] bg-white text-indigo-700 px-1.5 py-0.5 rounded-md font-black border border-indigo-200 shrink-0">{workPercent}%</span>
                    </div>
                    {volumeText && <div className="text-[10px] text-indigo-700 font-extrabold">KL: {volumeText}</div>}
                    <div className="grid grid-cols-2 gap-1 text-[10px] pt-1 border-t border-indigo-200/60">
                      <div>
                        <span className="text-indigo-500 block">Thi công:</span>
                        <strong className="text-indigo-950">{stat.workDoneCount}/{stat.roomCount} Căn / Phòng</strong>
                      </div>
                      <div>
                        <span className="text-emerald-600 block">Nghiệm thu:</span>
                        <strong className="text-emerald-800">{stat.inspectedCount}/{stat.roomCount} ({inspectionPercent}%)</strong>
                      </div>
                    </div>
                    {stat.totalSteps > 0 && (
                      <div className="text-[9.5px] text-slate-500 font-medium">Công đoạn: {stat.doneSteps}/{stat.totalSteps} xong · {stat.inspectedSteps}/{stat.totalSteps} đạt NT</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="bg-emerald-50/90 p-2.5 rounded-2xl border border-emerald-200/90 shadow-2xs space-y-1">
                <div className="flex items-center justify-between font-extrabold text-emerald-900">
                  <span className="flex items-center gap-1 text-[11px]">🏗️ Khung trần (dữ liệu cũ)</span>
                  <span className="text-[10px] bg-emerald-200/80 text-emerald-900 px-1.5 py-0.5 rounded-md font-black">{roomSummary.frameInspectPercent}% đạt</span>
                </div>
                <div className="text-[10px] text-emerald-800">Thi công xong: <strong>{roomSummary.frameDone}/{roomSummary.total}</strong> · Đạt NT: <strong>{roomSummary.frameInspectPassed}/{roomSummary.total}</strong></div>
              </div>
              <div className="bg-blue-50/90 p-2.5 rounded-2xl border border-blue-200/90 shadow-2xs space-y-1">
                <div className="flex items-center justify-between font-extrabold text-blue-900">
                  <span className="flex items-center gap-1 text-[11px]">📄 Tấm thạch cao (dữ liệu cũ)</span>
                  <span className="text-[10px] bg-blue-200/80 text-blue-900 px-1.5 py-0.5 rounded-md font-black">{roomSummary.boardInspectPercent}% đạt</span>
                </div>
                <div className="text-[10px] text-blue-800">Thi công xong: <strong>{roomSummary.boardDone}/{roomSummary.total}</strong> · Đạt NT: <strong>{roomSummary.boardInspectPassed}/{roomSummary.total}</strong></div>
              </div>
              <div className="bg-amber-50/90 p-2.5 rounded-2xl border border-amber-200/90 shadow-2xs space-y-1">
                <div className="flex items-center justify-between font-extrabold text-amber-900">
                  <span className="flex items-center gap-1 text-[11px]">🏆 Nghiệm thu hoàn thiện</span>
                  <span className="text-[10px] bg-amber-200/80 text-amber-950 px-1.5 py-0.5 rounded-md font-black">{roomSummary.inspectPercent}%</span>
                </div>
                <div className="text-[10px] text-amber-800">Đạt tổng: <strong>{roomSummary.inspectedPassed}/{roomSummary.total} Căn / Phòng</strong></div>
              </div>
            </div>
          )}

          {/* Room Cards List */}
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-indigo-600" />
                Nghiệm thu từng Căn / Phòng ({floorRooms.length})
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
                {canManageStructure && (
                  <>
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
                      <Plus className="w-3.5 h-3.5" /> Thêm Căn / Phòng
                    </button>
                  </>
                )}
              </div>
            </div>

            {floorRooms.length === 0 ? (
              <div className="bg-white rounded-2xl p-6 text-center text-slate-400 text-xs border border-dashed border-slate-300">
                Chưa có Căn / Phòng nào trên mặt bằng này. Hãy dùng công cụ vẽ để tạo vùng highlight!
              </div>
            ) : (
              <>
                {/* Quick Sort Controls */}
                <QuickSortBar
                  itemCount={floorRooms.length}
                  className="mb-2.5"
                  options={[
                    { key: 'name', label: 'Tên Căn / Phòng', kind: 'alpha' },
                    { key: 'createdAt', label: 'Ngày tạo', kind: 'date', defaultOrder: 'desc' },
                    { key: 'updatedAt', label: 'Ngày chỉnh sửa', kind: 'date', defaultOrder: 'desc' },
                  ]}
                  activeKey={roomSortBy === 'manual' ? null : roomSortBy}
                  order={roomSortOrder}
                  onChange={(key, order) => { setRoomSortBy(key); setRoomSortOrder(order); }}
                  onToggleOrder={() => setRoomSortOrder((order) => order === 'asc' ? 'desc' : 'asc')}
                  onReset={() => { setRoomSortBy('manual'); setRoomSortOrder('asc'); }}
                  resetLabel="Thứ tự thủ công"
                />

                <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
                  <button
                    type="button"
                    onClick={collapseAllRooms}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50 active:scale-95 transition"
                    title="Thu gọn nhanh toàn bộ Căn / Phòng"
                  >
                    <ChevronsUp className="w-3.5 h-3.5 text-indigo-500" />
                    Thu gọn tất cả
                  </button>
                  <button
                    type="button"
                    onClick={expandAllRooms}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-50 active:scale-95 transition"
                    title="Mở nhanh toàn bộ Căn / Phòng"
                  >
                    <ChevronsDown className="w-3.5 h-3.5 text-indigo-500" />
                    Mở rộng tất cả
                  </button>
                  <span className="text-[10px] text-slate-500 font-medium">
                    {floorRooms.length > 5 ? 'Nhiều Căn / Phòng: mặc định thu gọn để lướt nhanh.' : 'Có thể thu gọn để xem danh sách nhanh hơn.'}
                  </span>
                </div>

                {/* Bulk structural actions are ADMIN-only. */}
                {canManageStructure && (
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
                    <span>Chọn tất cả Căn / Phòng ({floorRooms.length})</span>
                  </label>

                  <div className="flex items-center gap-3 justify-end">
                    {selectedApartmentIds.some(id => floorRooms.some(item => item.id === id)) && (
                      <button
                        type="button"
                        onClick={async () => {
                          const idsToDelete = selectedApartmentIds.filter(id => floorRooms.some(item => item.id === id));
                          if (await confirmAsync(`Bạn có chắc muốn xóa ${idsToDelete.length} Căn / Phòng đã chọn?`)) {
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
                        <Trash2 className="w-3.5 h-3.5" /> Xóa đã chọn ({selectedApartmentIds.filter(id => floorRooms.some(item => item.id === id)).length})
                      </button>
                    )}
                  </div>
                </div>
                )}

                {sortedFloorRooms.map((room, index) => {
                  const roomExpanded = expandedRoomIds.has(room.id);
                  const operationalSubItems = getOperationalRoomSubItems(room);
                  const roomSubItemCount = operationalSubItems.length;
                  const roomCategoryNames = new Set<string>();
                  Object.keys(room.categoryVolumes || {}).forEach((rawName) => {
                    const resolved = resolveOperationalCategoryName(rawName);
                    if (resolved) roomCategoryNames.add(resolved);
                  });
                  operationalSubItems.forEach((sub) => {
                    const resolved = resolveOperationalCategoryName(sub.category || room.workCategory, sub.workCategoryId);
                    if (resolved) roomCategoryNames.add(resolved);
                  });
                  const primaryResolvedCategory = resolveOperationalCategoryName(room.workCategory, room.workCategoryId);
                  if (primaryResolvedCategory) roomCategoryNames.add(primaryResolvedCategory);
                  const roomCategoryCount = roomCategoryNames.size;
                  const roomVolumeByUnit: Record<string, number> = {};
                  const categoryUnitMax = new Map<string, { value: number; unit: string }>();
                  Object.entries(room.categoryVolumes || {}).forEach(([rawCategoryName, value]) => {
                    const resolved = resolveOperationalCategoryName(rawCategoryName);
                    if (!resolved) return;
                    const unit = room.categoryVolumeUnits?.[rawCategoryName] || room.volumeUnit || 'm²';
                    const previous = categoryUnitMax.get(resolved);
                    const nextValue = Number(value) || 0;
                    if (!previous || nextValue > previous.value) categoryUnitMax.set(resolved, { value: nextValue, unit });
                  });
                  categoryUnitMax.forEach(({ value, unit }) => {
                    roomVolumeByUnit[unit] = (roomVolumeByUnit[unit] || 0) + value;
                  });
                  if (categoryUnitMax.size === 0 && primaryResolvedCategory && Number(room.workVolume || 0) > 0) {
                    roomVolumeByUnit[room.volumeUnit || 'm²'] = Number(room.workVolume || 0);
                  }
                  const roomVolumeSummary = Object.entries(roomVolumeByUnit)
                    .filter(([, value]) => value > 0)
                    .map(([unit, value]) => `${formatDecimal(value)} ${unit}`)
                    .join(' + ');

                  return (
                  <div
                    key={room.id}
                    draggable={canManageStructure && roomSortBy === 'manual'}
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
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-2.5 mb-2.5">
                      <div className="flex items-start sm:items-center gap-2.5 min-w-0 w-full sm:flex-1">
                        {canManageStructure && (
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
                            className="w-4 h-4 mt-1 sm:mt-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0 transition-colors"
                            aria-label={`Chọn ${room.roomName}`}
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="block font-bold text-sm text-slate-800 whitespace-normal break-words leading-snug" title={room.roomName}>
                            {room.roomName}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRoomExpanded(room.id);
                          }}
                          className="w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 transition"
                          title={roomExpanded ? 'Thu gọn Căn / Phòng' : 'Mở rộng Căn / Phòng'}
                          aria-label={roomExpanded ? 'Thu gọn Căn / Phòng' : 'Mở rộng Căn / Phòng'}
                        >
                          {roomExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto justify-between sm:justify-end shrink-0">
                        {canManageStructure && roomSortBy === 'manual' && (
                          <MoveOrderControls
                            showDragHandle
                            disableUp={index === 0}
                            disableDown={index === sortedFloorRooms.length - 1}
                            onMoveUp={() => {
                              const updated = [...floorRooms];
                              const idx = updated.findIndex(r => r.id === room.id);
                              if (idx > 0) {
                                [updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]];
                                if (onReorderRoomProgressList) onReorderRoomProgressList(updated);
                              }
                            }}
                            onMoveDown={() => {
                              const updated = [...floorRooms];
                              const idx = updated.findIndex(r => r.id === room.id);
                              if (idx !== -1 && idx < updated.length - 1) {
                                [updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]];
                                if (onReorderRoomProgressList) onReorderRoomProgressList(updated);
                              }
                            }}
                            className="shrink-0"
                            label="Sắp xếp thứ tự Căn / Phòng"
                          />
                        )}
                        <div className="flex items-center gap-1.5 ml-auto">
                          <button
                            type="button"
                            onClick={async () => {
                              setSelectedRoomForEdit(room);
                              setIsRoomModalOpen(true);
                            }}
                            className="text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100/80 px-2.5 py-1.5 rounded-lg border border-indigo-200/60 transition-all flex items-center gap-1 cursor-pointer shadow-3xs active:scale-95"
                            title={canManageStructure ? 'Chỉnh sửa Căn / Phòng và hạng mục thi công' : 'Cập nhật tiến độ, nghiệm thu và ghi chú hiện trường'}
                          >
                            <Pencil className="w-3.5 h-3.5 text-indigo-500" />
                            <span>{canManageStructure ? 'Chỉnh sửa' : 'Cập nhật'}</span>
                          </button>

                          {canManageStructure && (
                            <button
                              type="button"
                              onClick={() => setDeletingRoomTarget({ id: room.id, name: room.roomName })}
                              className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100/80 px-2.5 py-1.5 rounded-lg border border-rose-200/60 transition-all flex items-center gap-1 cursor-pointer shadow-3xs active:scale-95"
                              title="Xóa Căn / Phòng / vùng highlight này"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                              <span>Xóa</span>
                            </button>
                          )}
                        </div>

                        {/* Deleted redundant overall inspection status badge */}
                      </div>
                    </div>

                    {roomExpanded ? (
                      <>
                    {/* Sub-Items or Dual Grid */}
                    {operationalSubItems.length > 0 ? (
                      <div className="space-y-3">
                        {Object.entries(
                          operationalSubItems.reduce((acc: Record<string, RoomSubItem[]>, sub) => {
                            const catName = resolveOperationalCategoryName(sub.category || room.workCategory, sub.workCategoryId);
                            if (!catName) return acc;
                            if (!acc[catName]) acc[catName] = [];
                            acc[catName].push(sub);
                            return acc;
                          }, {} as Record<string, RoomSubItem[]>)
                        ).map(([catName, subsVal], catIdx) => {
                          const subs = subsVal as RoomSubItem[];
                          return (
                            <div key={`${catName}-${catIdx}`} className="space-y-2 border border-slate-100 bg-slate-50/50 p-2.5 rounded-xl">
                              {/* Group Header */}
                              <div className="flex items-center justify-between border-b border-slate-200/60 pb-1.5 mb-1 text-xs gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleRoomCategoryCollapsed(room.id, catName)}
                                  className="min-w-0 font-extrabold text-slate-800 flex items-center gap-1 text-left hover:text-indigo-700 transition"
                                  title={collapsedRoomCategoryKeys.has(`${room.id}::${catName}`) ? 'Mở hạng mục chính' : 'Thu gọn hạng mục chính'}
                                >
                                  {collapsedRoomCategoryKeys.has(`${room.id}::${catName}`)
                                    ? <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                                    : <ChevronUp className="w-3.5 h-3.5 shrink-0" />}
                                  <span className="truncate">{catName}</span>
                                  <span className="text-[9px] font-bold text-slate-400 shrink-0">({subs.length})</span>
                                </button>
                                {room.categoryVolumes?.[catName] !== undefined && room.categoryVolumes[catName] !== null && (
                                  <span className="text-[10px] font-extrabold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded shrink-0">
                                    {formatDecimal(room.categoryVolumes[catName])} {room.categoryVolumeUnits?.[catName] || room.volumeUnit || 'm²'}
                                  </span>
                                )}
                              </div>

                              {/* Group Content */}
                              {!collapsedRoomCategoryKeys.has(`${room.id}::${catName}`) && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                {subs.map((sub, idx) => (
                                  <div key={`${sub.id || 'sub'}-${idx}`} className="bg-white p-2 rounded-xl border border-slate-200/80 space-y-1.5">
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center justify-between font-bold text-[11px] text-slate-800 gap-1">
                                        <span className="truncate">#{idx + 1}. {sub.name}</span>
                                        {(sub.assignedTeam || sub.workVolume !== undefined) && (
                                          <span className="text-[10px] text-indigo-800 bg-indigo-50 border border-indigo-100 px-1.5 py-0.2 rounded shrink-0 font-semibold truncate max-w-[120px]">
                                            {sub.assignedTeam && `👷 ${sub.assignedTeam}`} {sub.workVolume !== undefined && `(${formatDecimal(sub.workVolume)} ${sub.volumeUnit || 'm²'})`}
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
                                        {sub.status === 'Đã hoàn thành' ? '✅ Xong' : sub.status === 'Đang làm' ? '🚧 Đang làm' : '⏳ Chưa làm'}
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
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : operationalWorkCategoryCatalog.hasCatalog && roomCategoryCount === 0 ? (
                      <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium">
                        Căn / Phòng này chưa được gán hạng mục đang hoạt động. Dữ liệu hạng mục đã xóa (nếu có) vẫn được giữ trong cache/lịch sử nhưng không hiển thị như hạng mục thi công hiện hành.
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
                            Thi công: {room.frameStatus === 'Đã hoàn thành' ? '✅ Xong Khung' : room.frameStatus === 'Đang làm' ? '🚧 Đang làm' : '⏳ Chưa làm'}
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
                            title="Bấm để chuyển kết quả nghiệm thu khung trần"
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
                            title="Bấm để chuyển kết quả nghiệm thu tấm trần"
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
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleRoomExpanded(room.id)}
                        className="w-full flex items-center justify-between gap-2 bg-slate-50/80 hover:bg-indigo-50/70 border border-slate-100 rounded-xl px-3 py-2 text-left transition"
                        title="Mở chi tiết Căn / Phòng"
                      >
                        <span className="min-w-0 text-[11px] font-semibold text-slate-600 truncate">
                          {roomCategoryCount} hạng mục chính
                          {roomSubItemCount > 0 ? ` · ${roomSubItemCount} hạng mục con` : ''}
                          {roomVolumeSummary ? ` · ${roomVolumeSummary}` : ''}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 shrink-0">
                          <ChevronDown className="w-3.5 h-3.5" /> Mở chi tiết
                        </span>
                      </button>
                    )}
                </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}

      {/* SECTION FOR DEFECT MODE: DEFECT LIST & FILTER */}
      {(viewMode === 'defect' || viewMode === 'all') && (
        <div className="space-y-3">
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Danh sách Defect ({filteredDefects.length})
            </h3>

            <div className="space-y-2">
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-bold text-[11px] text-slate-600">Lọc:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="min-w-[145px] max-w-full bg-white border border-slate-200 text-[11px] sm:text-xs font-bold rounded-lg px-2.5 py-1.5 text-slate-700 focus:ring-2 focus:ring-indigo-200"
                  title="Lọc Defect theo trạng thái"
                >
                  <option value="all">Tất cả trạng thái</option>
                  <option value="Mới phát hiện">Mới phát hiện</option>
                  <option value="Đang sửa">Đang sửa</option>
                  <option value="Đã khắc phục">Đã khắc phục</option>
                  <option value="Đã nghiệm thu">Đã nghiệm thu</option>
                </select>
              </div>

              <QuickSortBar
                itemCount={filteredDefects.length}
                options={[
                  { key: 'createdAt', label: 'Ngày ghi nhận', kind: 'date', defaultOrder: 'desc' },
                  { key: 'priority', label: 'Ưu tiên xử lý', kind: 'generic' },
                  { key: 'dueDate', label: 'Hạn sửa', kind: 'deadline', defaultOrder: 'asc' },
                  { key: 'floorName', label: 'Tầng', kind: 'floor' },
                  { key: 'roomName', label: 'Căn / Phòng', kind: 'alpha' },
                  { key: 'category', label: 'Loại lỗi', kind: 'alpha' },
                  { key: 'assignedTo', label: 'Đội phụ trách', kind: 'alpha' },
                  { key: 'severity', label: 'Mức độ', kind: 'generic' },
                  { key: 'status', label: 'Trạng thái', kind: 'generic' },
                ]}
                activeKey={defectSortBy}
                order={defectSortOrder}
                onChange={(key, order) => { setDefectSortBy(key); setDefectSortOrder(order); }}
                onToggleOrder={() => setDefectSortOrder((order) => order === 'asc' ? 'desc' : 'asc')}
                onReset={() => { setDefectSortBy('createdAt'); setDefectSortOrder('desc'); }}
              />
            </div>
          </div>

          {canDeleteDefects && filteredDefects.length > 0 && (
            <div className="flex flex-wrap items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs gap-2">
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
                <span>Chọn tất cả Defect ({filteredDefects.length})</span>
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
                    <Trash2 className="w-3.5 h-3.5" /> Xóa đã chọn ({selectedDefectIds.filter(id => filteredDefects.some(item => item.id === id)).length})
                  </button>
                )}
              </div>
            </div>
          )}

          {filteredDefects.length === 0 ? (
            <div className="bg-white rounded-2xl p-6 text-center text-slate-400 text-xs border border-dashed border-slate-300">
              Chưa có Defect nào được ghi nhận trên mặt bằng này 🎉
            </div>
          ) : (
            filteredDefects.map((defect) => {
              const overdueInfo = getDefectOverdueInfo(defect);
              const contactTeam = resolveDefectTeam(defect, teams);
              const defectShareText = buildDefectShareText(defect);
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
                    {canDeleteDefects && <input
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
                    />}

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
                            <span className="text-[10px] font-black text-slate-400 mr-1.5">[{getDefectShortCode(defect.id)}]</span>
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
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
                            <span className="font-bold text-slate-800">{defect.assignedTo}</span>
                            <ContactMenu
                              target={{ name: defect.assignedTo || 'Đội phụ trách', phone: contactTeam?.phone }}
                              context={{ type: 'defect', projectId: currentProjectId, entityId: defect.id, shareText: defectShareText }}
                              triggerLabel={contactTeam?.phone ? 'Liên hệ' : 'Chia sẻ'}
                            />
                          </div>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[9px] font-bold uppercase">Deadline sửa</span>
                          <span className={`font-bold ${overdueInfo.isOverdue ? 'text-rose-600' : 'text-slate-800'}`}>
                            {defect.dueDate ? formatDateDDMMYYYY(defect.dueDate) : 'Chưa đặt'}
                          </span>
                        </div>
                    <div>
                      <span className="text-slate-400 block text-[9px] font-bold uppercase">Ngày hoàn thành</span>
                      <span className="font-bold text-emerald-700">{defect.completedAt ? formatDateDDMMYYYY(defect.completedAt) : 'Chưa xong'}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <DefectPhotoStrip
                      projectId={currentProjectId}
                      defect={defect}
                      category="defect_before"
                      legacyUrl={defect.imageUrl}
                      label="Ảnh lỗi / trước sửa"
                      emptyText="Chưa có ảnh lỗi"
                      tone="slate"
                      onOpen={(images, initialIndex) => setViewingImageSet({ images, initialIndex })}
                    />
                    <DefectPhotoStrip
                      projectId={currentProjectId}
                      defect={defect}
                      category="defect_after"
                      legacyUrl={defect.afterImageUrl}
                      label="Ảnh sau sửa / khắc phục"
                      emptyText="Chưa có ảnh khắc phục"
                      tone="emerald"
                      onOpen={(images, initialIndex) => setViewingImageSet({ images, initialIndex })}
                    />
                  </div>
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
        structureReadOnly={!canManageStructure}
        onDeleteRoom={canManageStructure ? onDeleteRoomProgress : undefined}
        onStartRedraw2Point={canManageStructure ? handleStartRedraw2Point : undefined}
        teams={teams}
        materialNorms={materialNorms}
        inventory={inventory}
        workVolumes={workVolumes}
        existingRoomNames={floorRooms.filter((room) => room.id !== selectedRoomForEdit?.id).map((room) => room.roomName)}
        defaultInspectorName={inspectorName}
        onAddInventory={onAddInventory}
      />

      {/* Add New Floor Plan Modal */}
      {canManageStructure && showAddFloorModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-slate-900">Tải mặt bằng thi công tầng</h3>
              <button onClick={() => setShowAddFloorModal(false)} className="font-bold text-slate-500">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Tên tầng / khu vực</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Tầng 3, Tầng Thượng..."
                  value={newFloorName}
                  onChange={(e) => setNewFloorName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold"
                />
              </div>

              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3 space-y-2.5">
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={smartPdfDetectionEnabled}
                    onChange={(e) => setSmartPdfDetectionEnabled(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-extrabold text-indigo-900">
                      <Sparkles className="w-4 h-4" /> Tự nhận diện Căn / Phòng từ PDF highlight
                    </span>
                    <span className="block text-[10.5px] text-indigo-700 mt-0.5">
                      Ưu tiên vùng Highlight/Rectangle/Polygon của PDF và đọc tên nằm trong hoặc gần giữa vùng. Trước khi tạo sẽ có màn hình kiểm tra lại.
                    </span>
                  </span>
                </label>

                {smartPdfDetectionEnabled && (
                  <>
                    <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={smartPdfRasterFallback}
                        onChange={(e) => setSmartPdfRasterFallback(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600"
                      />
                      Nếu PDF đã flatten thành ảnh: dò vùng theo màu highlight
                    </label>

                    <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={smartPdfHideOriginalAnnotations}
                        onChange={(e) => setSmartPdfHideOriginalAnnotations(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600"
                      />
                      Ẩn highlight/annotation PDF gốc sau nhận diện (khuyên dùng)
                    </label>

                    <button
                      type="button"
                      onClick={() => setShowSmartPdfAdvanced((v) => !v)}
                      className="text-[11px] font-bold text-indigo-700 hover:text-indigo-900 inline-flex items-center gap-1"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      {showSmartPdfAdvanced ? 'Ẩn tùy chỉnh nhận diện' : 'Tùy chỉnh nhận diện'}
                    </button>

                    {showSmartPdfAdvanced && (
                      <div className="grid grid-cols-2 gap-2 bg-white/90 rounded-xl border border-indigo-100 p-2.5">
                        <div className="col-span-2 flex items-center justify-between gap-2">
                          <label className="text-[10.5px] font-bold text-slate-700 flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={smartPdfUseColorFilter}
                              onChange={(e) => setSmartPdfUseColorFilter(e.target.checked)}
                              className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600"
                            />
                            Chỉ nhận màu highlight đã chọn
                          </label>
                          <input
                            type="color"
                            value={smartPdfTargetColor}
                            onChange={(e) => setSmartPdfTargetColor(e.target.value.toUpperCase())}
                            disabled={!smartPdfUseColorFilter && !smartPdfRasterFallback}
                            className="w-9 h-7 rounded border border-slate-200 bg-white p-0.5"
                            title="Màu highlight cần nhận diện"
                          />
                        </div>

                        <label className="text-[10px] font-bold text-slate-600">
                          Sai số màu: {smartPdfColorTolerance}
                          <input
                            type="range" min="5" max="70" step="1"
                            value={smartPdfColorTolerance}
                            onChange={(e) => setSmartPdfColorTolerance(Number(e.target.value))}
                            className="w-full mt-1"
                          />
                        </label>

                        <label className="text-[10px] font-bold text-slate-600">
                          Diện tích nhỏ nhất (% trang)
                          <input
                            type="number" min="0.01" max="10" step="0.01"
                            value={smartPdfMinAreaPercent}
                            onChange={(e) => setSmartPdfMinAreaPercent(Math.max(0.01, Number(e.target.value) || 0.12))}
                            className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5"
                          />
                        </label>

                        <label className="text-[10px] font-bold text-slate-600">
                          Vùng tìm tên quanh tâm: {smartPdfCenterSearchMarginPercent}%
                          <input
                            type="range" min="0" max="30" step="1"
                            value={smartPdfCenterSearchMarginPercent}
                            onChange={(e) => setSmartPdfCenterSearchMarginPercent(Number(e.target.value))}
                            className="w-full mt-1"
                          />
                        </label>

                        <label className="text-[10px] font-bold text-slate-600">
                          Diện tích lớn nhất (% trang)
                          <input
                            type="number" min="1" max="100" step="1"
                            value={smartPdfMaxAreaPercent}
                            onChange={(e) => setSmartPdfMaxAreaPercent(Math.max(1, Number(e.target.value) || 35))}
                            className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5"
                          />
                        </label>

                        <label className="col-span-2 flex items-center gap-2 text-[10px] font-bold text-slate-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={smartPdfAllowNumericOnlyNames}
                            onChange={(e) => setSmartPdfAllowNumericOnlyNames(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600"
                          />
                          Cho phép tên chỉ gồm số (VD: 101, 102). Tắt mặc định để tránh nhận nhầm kích thước CAD như 1200/3000.
                        </label>

                        <label className="col-span-2 text-[10px] font-bold text-slate-600">
                          Quy tắc tên Căn / Phòng (nâng cao)
                          <input
                            type="text"
                            value={smartPdfNamePattern}
                            onChange={(e) => setSmartPdfNamePattern(e.target.value)}
                            className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 font-mono text-[9.5px]"
                          />
                          <span className="block text-[9px] text-slate-400 mt-1">Để mặc định nếu không rõ. Nhận tốt A101, A-101, P.101, WC-01, Căn 101, Phòng 01...</span>
                        </label>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Chọn bản vẽ (PDF/JPG/PNG/WebP)</label>
                <input
                  type="file"
                  accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"
                  onChange={handlePlanFileChange}
                  disabled={isUploadingPlan || !newFloorName.trim()}
                  className="w-full text-xs text-slate-500 file:mr-3 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {isUploadingPlan && <p className="text-blue-600 text-[11px] mt-1">Đang xử lý bản vẽ theo chất lượng ảnh đã chọn...</p>}
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

      {/* Review detected Căn / Phòng from highlighted PDF before writing project data */}
      {pendingSmartPdfImport && (() => {
        const selectedCount = pendingSmartPdfImport.rooms.filter((room) => room.selected).length;
        const unnamedCount = pendingSmartPdfImport.rooms.filter((room) => room.selected && !room.roomName.trim()).length;
        const lowConfidenceCount = pendingSmartPdfImport.rooms.filter((room) => room.selected && room.confidence < 0.65).length;
        const rasterCount = pendingSmartPdfImport.rooms.filter((room) => room.source === 'raster-color').length;
        const sortedDetectedRooms = [...pendingSmartPdfImport.rooms].sort((a, b) => {
          let comparison = 0;
          if (pdfDetectedRoomSortBy === 'confidence') {
            comparison = a.confidence - b.confidence;
          } else if (pdfDetectedRoomSortBy === 'area') {
            comparison = a.areaPercent - b.areaPercent;
          } else {
            comparison = (a.roomName || '').localeCompare(b.roomName || '', 'vi', { numeric: true, sensitivity: 'base' });
          }
          return pdfDetectedRoomSortOrder === 'asc' ? comparison : -comparison;
        });
        return (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-[260] flex items-end lg:items-center justify-center p-0 lg:p-4">
            <div className="bg-white w-full max-w-6xl rounded-t-3xl lg:rounded-3xl shadow-2xl max-h-[96vh] overflow-hidden flex flex-col">
              <div className="px-4 sm:px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
                <div className="min-w-0">
                  <h3 className="font-black text-slate-900 flex items-center gap-2 text-sm sm:text-base">
                    <Sparkles className="w-5 h-5 text-indigo-600" /> Kiểm tra nhận diện Căn / Phòng từ PDF
                  </h3>
                  <p className="text-[10.5px] sm:text-xs text-slate-500 truncate">
                    {pendingSmartPdfImport.floorName} · {pendingSmartPdfImport.fileName} · Trang {pendingSmartPdfImport.pageNumber}/{pendingSmartPdfImport.pageCount}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPendingSmartPdfImport(null);
                    setShowAddFloorModal(true);
                  }}
                  className="w-8 h-8 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900 font-black shrink-0"
                  title="Quay lại"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)] gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
                      <span className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 font-bold border border-indigo-100">Nhận diện: {pendingSmartPdfImport.rooms.length}</span>
                      <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold border border-emerald-100">Đang chọn: {selectedCount}</span>
                      {unnamedCount > 0 && <span className="px-2 py-1 rounded-lg bg-rose-50 text-rose-700 font-bold border border-rose-100">Chưa có tên: {unnamedCount}</span>}
                      {lowConfidenceCount > 0 && <span className="px-2 py-1 rounded-lg bg-amber-50 text-amber-800 font-bold border border-amber-100">Cần kiểm tra: {lowConfidenceCount}</span>}
                    </div>

                    <div className="relative bg-white border border-slate-300 rounded-2xl overflow-hidden shadow-inner min-h-[260px] flex items-center justify-center">
                      <img src={pendingSmartPdfImport.imageUrl} alt="Preview PDF" className="w-full h-auto block select-none" />
                      <div className="absolute inset-0 pointer-events-none">
                        {pendingSmartPdfImport.rooms.map((room, index) => (
                          <div
                            key={room.id}
                            className={`absolute border-2 rounded-sm flex items-center justify-center ${room.selected ? 'border-indigo-600 bg-indigo-400/15' : 'border-slate-400 bg-slate-300/10 opacity-50'}`}
                            style={{ left: `${room.x}%`, top: `${room.y}%`, width: `${room.width}%`, height: `${room.height}%` }}
                            title={`${room.roomName || 'Chưa có tên'} · ${Math.round(room.confidence * 100)}%`}
                          >
                            <span className={`max-w-[90%] truncate px-1 py-0.5 rounded bg-white/90 border shadow-sm text-[8px] sm:text-[10px] font-black ${room.hasDetectedName ? 'text-indigo-800 border-indigo-200' : 'text-rose-700 border-rose-200'}`}>
                              {room.roomName || `? ${index + 1}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[10.5px] text-slate-600 leading-relaxed">
                      <strong className="text-slate-800">Cách nhận diện:</strong> app ưu tiên Annotation/Rectangle/Polygon/Ink/Highlight thật trong PDF. Nếu PDF đã flatten, app có thể dò màu nhưng độ chính xác phụ thuộc màu và khoảng cách giữa các vùng. Tên được đọc từ text PDF nằm trong hoặc gần giữa vùng; PDF dạng ảnh scan không có text layer thì cần nhập tên thủ công.
                      {rasterCount > 0 && <div className="mt-1 text-amber-700 font-semibold">⚠️ Có {rasterCount} vùng lấy từ dò màu. Nếu các highlight chạm liền nhau, chúng có thể bị gộp thành một vùng; nên kiểm tra preview kỹ.</div>}
                    </div>
                  </div>

                  <div className="space-y-2 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h4 className="text-xs font-black text-slate-800">Danh sách vùng nhận diện</h4>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPendingSmartPdfImport((prev) => prev ? { ...prev, rooms: prev.rooms.map((room) => ({ ...room, selected: true })) } : prev)}
                          className="px-2 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-bold"
                        >
                          Chọn tất cả
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingSmartPdfImport((prev) => prev ? { ...prev, rooms: prev.rooms.map((room) => ({ ...room, selected: false })) } : prev)}
                          className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 text-[10px] font-bold"
                        >
                          Bỏ chọn
                        </button>
                      </div>
                    </div>

                    <QuickSortBar
                      itemCount={pendingSmartPdfImport.rooms.length}
                      options={[
                        { key: 'name', label: 'Tên Căn / Phòng', kind: 'alpha' },
                        { key: 'confidence', label: 'Độ tin cậy', kind: 'number' },
                        { key: 'area', label: 'Diện tích vùng', kind: 'number' },
                      ]}
                      activeKey={pdfDetectedRoomSortBy}
                      order={pdfDetectedRoomSortOrder}
                      onChange={(key, order) => { setPdfDetectedRoomSortBy(key); setPdfDetectedRoomSortOrder(order); }}
                      onReset={() => { setPdfDetectedRoomSortBy('name'); setPdfDetectedRoomSortOrder('asc'); }}
                      summary={`${pendingSmartPdfImport.rooms.length} vùng nhận diện`}
                    />

                    {pendingSmartPdfImport.rooms.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-4 text-center text-xs text-amber-900">
                        <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
                        <p className="font-extrabold">Chưa nhận diện được vùng Căn / Phòng.</p>
                        <p className="text-[10.5px] mt-1">Nếu PDF có highlight thật, hãy kiểm tra loại annotation hoặc giảm giới hạn diện tích. Nếu PDF đã flatten, bật dò màu và chọn đúng màu highlight.</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-[52vh] overflow-y-auto pr-1">
                        {sortedDetectedRooms.map((room, index) => (
                          <div key={room.id} className={`rounded-xl border p-2 ${room.selected ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 opacity-70'}`}>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={room.selected}
                                onChange={(e) => updatePendingPdfRoom(room.id, { selected: e.target.checked })}
                                className="w-4 h-4 rounded border-slate-300 text-indigo-600 shrink-0"
                              />
                              <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-600 inline-flex items-center justify-center text-[10px] font-black shrink-0">{index + 1}</span>
                              <input
                                type="text"
                                value={room.roomName}
                                onChange={(e) => updatePendingPdfRoom(room.id, { roomName: e.target.value, hasDetectedName: Boolean(e.target.value.trim()) })}
                                disabled={!room.selected}
                                placeholder="Nhập tên Căn / Phòng..."
                                className={`min-w-0 flex-1 border rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-1 focus:ring-indigo-500 ${room.roomName.trim() ? 'border-slate-200 text-slate-900' : 'border-rose-300 bg-rose-50 text-rose-800'}`}
                              />
                            </div>
                            <div className="mt-1.5 ml-8 flex items-center gap-1.5 flex-wrap text-[9.5px]">
                              <span className={`px-1.5 py-0.5 rounded font-bold ${room.confidence >= 0.8 ? 'bg-emerald-50 text-emerald-700' : room.confidence >= 0.65 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                                Tin cậy {Math.round(room.confidence * 100)}%
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">
                                {room.source === 'annotation' ? `PDF ${room.annotationSubtype || 'Annotation'}` : 'Dò màu'}
                              </span>
                              <span className="text-slate-400">Vùng {room.areaPercent}% trang</span>
                              {room.color && <span className="inline-flex items-center gap-1 text-slate-500"><i className="w-2.5 h-2.5 rounded-full border border-slate-300" style={{ backgroundColor: room.color }} />{room.color}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="px-3 sm:px-5 py-3 border-t border-slate-200 bg-white flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setPendingSmartPdfImport(null);
                    setShowAddFloorModal(true);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                >
                  ← Quay lại tùy chỉnh
                </button>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => commitPendingSmartPdfImport(false)}
                    className="px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs"
                  >
                    Chỉ lưu bản vẽ
                  </button>
                  <button
                    type="button"
                    onClick={() => commitPendingSmartPdfImport(true)}
                    disabled={selectedCount === 0 || unnamedCount > 0}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-extrabold text-xs shadow-sm"
                  >
                    Tạo mặt bằng &amp; {selectedCount} Căn / Phòng
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* New Defect Form Modal */}
      {canEditDefects && showDefectModal && pinPos && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
                Định vị Defect tại vị trí ({pinPos.x}%, {pinPos.y}%)
              </h3>
              <button onClick={handleCancelDefectModal} className="font-bold text-slate-500 hover:text-slate-700">✕</button>
            </div>

            <form onSubmit={handleCreateDefect} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Nhóm lỗi / hạng mục lỗi</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as DefectCategory)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                >
                  {Array.from(new Set([category, ...DEFECT_CATEGORIES])).map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Mô tả lỗi chi tiết</label>
                <textarea
                  placeholder="Ví dụ: Bắn thiếu vít khoảng cách >30cm, khung trần bị võng 10mm..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl p-2.5"
                  required
                />
                {suggestedDefectCategory && suggestedDefectCategory !== category && (
                  <button
                    type="button"
                    onClick={() => setCategory(suggestedDefectCategory)}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-extrabold text-indigo-700 hover:bg-indigo-100"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Gợi ý: {suggestedDefectCategory}
                  </button>
                )}
              </div>

              {/* 5 Key Control Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50 p-3 rounded-2xl border border-slate-200/80">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">👤 Người Tạo</label>
                  <input
                    type="text"
                    value={createdBy}
                    readOnly
                    placeholder="Tự ghi theo tài khoản đăng nhập"
                    className="w-full border border-slate-200 bg-slate-100 rounded-xl p-2 font-semibold text-slate-700"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">Khi lưu, hệ thống tự ghi đúng tài khoản Firebase đang đăng nhập.</p>
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
                  Lưu Defect lên mặt bằng
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Defect Detail & Control Modal */}
      {activeDefectDetail && (() => {
        const overdueInfo = getDefectOverdueInfo(activeDefectDetail);
        const activeContactTeam = resolveDefectTeam(activeDefectDetail, teams);
        const activeDefectShareText = buildDefectShareText(activeDefectDetail);
        const handleDetailFieldChange = (field: keyof DefectItem, value: any) => {
          if (!canEditDefects) return;
          let updated = { ...activeDefectDetail, [field]: value };
          if (field === 'assignedTo') {
            const linkage = resolveDefectLinkageFromSelection(
              { x: activeDefectDetail.x, y: activeDefectDetail.y },
              String(value),
              floorRooms,
              teams
            );
            updated = { ...updated, ...linkage };
          }
          setActiveDefectDetail(updated);
          if (onUpdateDefect) {
            onUpdateDefect(updated);
          }
        };

        const handleStatusChange = async (newStatus: DefectStatus) => {
          if (!canEditDefects) return;
          if (newStatus === 'Đã nghiệm thu' && !activeDefectDetail.afterImageUrl) {
            const afterPhotos = await getEntityPhotos(
              currentProjectId,
              'defect',
              activeDefectDetail.id,
              'defect_after'
            ).catch(() => []);
            const hasAfterEvidence = afterPhotos.some((photo) => !photo.deleted);
            if (!hasAfterEvidence) {
              const ok = await confirmAsync('Defect chưa có ảnh sau sửa/khắc phục. Vẫn chuyển sang Đã nghiệm thu? Chỉ nên tiếp tục khi đã kiểm tra thực tế.');
              if (!ok) return;
            }
          }
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
                  <span className="text-[10px] font-black text-slate-400">[{getDefectShortCode(activeDefectDetail.id)}]</span>
                  <h3 className="text-base font-extrabold text-slate-900">{activeDefectDetail.category}</h3>
                </div>
                <div className="flex items-center gap-1.5">
                  {canEditDefects && <button
                    type="button"
                    onClick={() => toggleDefectLock(activeDefectDetail.id)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-black border ${lockedDefectIds.has(activeDefectDetail.id) ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                    title="Khóa vị trí Defect để tránh thay đổi tọa độ ngoài ý muốn"
                  >
                    {lockedDefectIds.has(activeDefectDetail.id) ? '🔒 Mở khóa vị trí' : '🔓 Khóa vị trí'}
                  </button>}
                  <button onClick={() => setActiveDefectDetail(null)} className="font-bold text-slate-400 hover:text-slate-700">✕</button>
                </div>
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
                  <label className="block text-slate-700 font-bold mb-1">Mô tả lỗi</label>
                  <textarea
                    value={activeDefectDetail.description}
                    readOnly={!canEditDefects}
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
                        const floorId = targetFp?.id || activeDefectDetail.floorId || selectedFloorId;
                        pendingFocusRef.current = { floorId, x: activeDefectDetail.x, y: activeDefectDetail.y };
                        const switchingFloor = Boolean(targetFp && targetFp.id !== selectedFloorId);
                        if (switchingFloor && targetFp) setSelectedFloorId(targetFp.id);
                        setSelectedDefectIds([activeDefectDetail.id]);
                        setActiveDefectDetail(null);
                        if (!switchingFloor) {
                          requestAnimationFrame(() => requestAnimationFrame(() => {
                            const pending = pendingFocusRef.current;
                            if (pending) {
                              focusPlanPoint(pending.x, pending.y);
                              pendingFocusRef.current = null;
                            }
                          }));
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
                      readOnly
                      placeholder="Tự ghi theo tài khoản tạo Defect"
                      className="w-full border border-slate-200 bg-slate-100 rounded-xl p-2 font-semibold text-slate-700"
                    />
                    <p className="mt-1 text-[10px] text-slate-400">Người tạo là thông tin audit, được khóa sau khi tạo Defect.</p>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">⏱️ Deadline Sửa (Hạn Chót)</label>
                    <input
                      type="date"
                      value={activeDefectDetail.dueDate || ''}
                      disabled={!canEditDefects}
                      onChange={(e) => handleDetailFieldChange('dueDate', e.target.value)}
                      className="w-full border border-slate-200 bg-white rounded-xl p-2 font-semibold"
                    />
                  </div>

                  <div className="sm:col-span-2 space-y-2">
                    {canEditDefects ? (
                      <TeamSelectorInput
                        value={activeDefectDetail.assignedTo || ''}
                        onChange={(val) => handleDetailFieldChange('assignedTo', val)}
                        pinPos={{ x: activeDefectDetail.x, y: activeDefectDetail.y }}
                        activeFloorRooms={floorRooms}
                        allRooms={roomProgressList}
                        declaredTeams={teams}
                        listId="defect-team-datalist-detail"
                      />
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-white p-2 text-[11px] text-slate-700">
                        <span className="font-bold">Đội phụ trách:</span> {activeDefectDetail.assignedTo || 'Chưa gán'}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/60 p-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-blue-700">Liên hệ người phụ trách / Chia sẻ Defect</div>
                        <div className="mt-0.5 text-[10px] font-semibold text-slate-600">
                          {activeContactTeam?.phone ? `${activeDefectDetail.assignedTo} · ${activeContactTeam.phone}` : 'Chưa có số điện thoại khớp với đội phụ trách. Vẫn có thể sao chép/chia sẻ nội dung Defect.'}
                        </div>
                      </div>
                      <ContactMenu
                        target={{ name: activeDefectDetail.assignedTo || 'Đội phụ trách', phone: activeContactTeam?.phone }}
                        context={{ type: 'defect', projectId: currentProjectId, entityId: activeDefectDetail.id, shareText: activeDefectShareText }}
                        triggerLabel={activeContactTeam?.phone ? 'Liên hệ' : 'Chia sẻ'}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">🏁 Ngày Hoàn Thành Thực Tế</label>
                    <input
                      type="date"
                      value={activeDefectDetail.completedAt || ''}
                      disabled={!canEditDefects}
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
                    readOnly={!canEditDefects}
                  />
                  <PhotoAttachmentPicker
                    projectId={currentProjectId}
                    entityType="defect"
                    entityId={activeDefectDetail.id}
                    category="defect_after"
                    label="🛠️ Ảnh Bằng Chứng Sau Khi Sửa (Tùy Chọn)"
                    readOnly={!canEditDefects}
                  />
                </div>

                {/* Status Update Action Grid */}
                {canEditDefects && <div>
                  <label className="block text-slate-700 font-bold mb-1.5">Cập nhật trạng thái kiểm soát</label>
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
                      ✅ Nghiệm thu
                    </button>
                  </div>
                </div>}

                {/* Footer buttons */}
                <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                  {canDeleteDefects && <button
                    onClick={async () => {
                      setDeletingDefectTarget(activeDefectDetail);
                      setActiveDefectDetail(null);
                    }}
                    className="text-rose-600 font-bold text-xs hover:underline"
                  >
                    Xóa Lỗi
                  </button>}
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



      {/* MANAGE FLOORS MODAL (Tùy Chỉnh, Đổi Tên, Nhân bản, Xóa tầng) */}
      {canManageStructure && showManageFloorsModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-indigo-600" />
                  Quản lý &amp; tùy chỉnh tầng ({floorPlans.length})
                </h3>
                <p className="text-xs text-slate-500 font-medium">Thêm, xóa, đổi tên, hoặc sao chép nhân bản thiết kế tầng</p>
              </div>
              <button onClick={() => setShowManageFloorsModal(false)} className="font-bold text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>

            {/* Quick Sort Floors Controls */}
            <QuickSortBar
              itemCount={floorPlans.length}
              options={[
                { key: 'name', label: 'Tên tầng', kind: 'floor' },
                { key: 'rooms', label: 'Số Căn / Phòng', kind: 'number' },
                { key: 'defects', label: 'Số Defect', kind: 'number' },
              ]}
              activeKey={floorSortBy === 'none' ? null : floorSortBy}
              order={floorSortOrder}
              onChange={(key, order) => { setFloorSortBy(key); setFloorSortOrder(order); }}
              onToggleOrder={() => setFloorSortOrder((order) => order === 'asc' ? 'desc' : 'asc')}
              onReset={() => { setFloorSortBy('none'); setFloorSortOrder('asc'); }}
              resetLabel="Thứ tự thủ công"
            />

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
                          <span>🎨 {roomCount} Căn / Phòng</span>
                          <span>•</span>
                          <span>📌 {defectCount} ghim lỗi</span>
                        </div>
                      </div>
                    </div>

                    {/* Floor Action Buttons */}
                    <div className="flex items-center gap-1.5 self-end sm:self-center flex-wrap">
                      {floorSortBy === 'none' && (
                        <MoveOrderControls
                          disableUp={index === 0}
                          disableDown={index === sortedFloorPlans.length - 1}
                          onMoveUp={() => { if (onMoveFloorPlan) onMoveFloorPlan(fp.id, 'left'); }}
                          onMoveDown={() => { if (onMoveFloorPlan) onMoveFloorPlan(fp.id, 'right'); }}
                          label="Sắp thứ tự tầng"
                        />
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
                        Bản vẽ
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
                        Nhân bản
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
                ⚡ Thêm tầng nhanh (không cần ảnh)
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
                📤 Tải bản vẽ ảnh / PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUICK ADD FLOOR MODAL (Thêm Tầng Nhanh) */}
      {canManageStructure && showQuickAddFloorModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-2xl p-5 space-y-4 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-600" />
                Thêm tầng mới cho dự án
              </h3>
              <button onClick={() => setShowQuickAddFloorModal(false)} className="font-bold text-slate-400">✕</button>
            </div>

            <form onSubmit={handleQuickAddFloorSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Tên tầng / khu vực mới</label>
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
                  Tạo tầng
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
              <h3 className="text-base font-extrabold text-slate-900">Xác nhận xóa mặt bằng tầng</h3>
              <p className="text-xs text-slate-500 mt-1">
                Bạn có chắc chắn muốn xóa <span className="font-bold text-rose-600">"{deletingFloorTarget.name}"</span>?
              </p>
              <p className="text-[11px] text-slate-500 mt-2 bg-rose-50 border border-rose-100 rounded-lg p-2 leading-relaxed">
                Sẽ xóa <strong>{roomProgressList.filter((r) => r.floorId === deletingFloorTarget.id).length}</strong> Căn / Phòng và bản vẽ của tầng này.{' '}
                <strong>{defects.filter((d) => d.floorId === deletingFloorTarget.id).length}</strong> Defect và{' '}
                <strong>{checklistItems.filter((c) => c.floorId === deletingFloorTarget.id || c.floorName === deletingFloorTarget.name).length}</strong> Checklist được <strong>giữ làm lịch sử</strong> nhưng bỏ liên kết khỏi tầng đã xóa.
                Khối lượng và nhật ký đội cũng được giữ lại và tự bỏ liên kết tới tầng.
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
                Xóa tầng
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
                <h3 className="text-base font-extrabold text-slate-900">Nhân bản tầng</h3>
                <p className="text-xs text-slate-500">Tạo bản sao mặt bằng từ <strong className="text-slate-800">{duplicatingFloorTarget.name}</strong></p>
                <p className="text-[10.5px] text-emerald-700 mt-1">Sao chép bản vẽ, Căn / Phòng, hạng mục và tiêu chí Checklist; tự đặt tiến độ về Chưa làm/Chưa nghiệm thu và không sao chép Defect.</p>
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
                  Xác nhận nhân bản
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
              <h3 className="text-base font-extrabold text-slate-900">Xóa vùng Căn / Phòng</h3>
              <p className="text-xs text-slate-500 mt-1">
                Xóa vùng highlight <span className="font-bold text-rose-600">"{deletingRoomTarget.name}"</span>?
              </p>
              <p className="text-[10.5px] text-slate-400 mt-1 leading-relaxed">
                Defect và Checklist đã gắn với Căn / Phòng sẽ được giữ lại để không mất lịch sử, nhưng tự bỏ liên kết tới Căn / Phòng đã xóa.
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
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE DEFECT PIN MODAL */}
      {canDeleteDefects && deletingDefectTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-sm rounded-2xl p-5 space-y-4 shadow-2xl border border-rose-100 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 mx-auto flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Xác nhận xóa Vị trí Defect</h3>
              <p className="text-xs text-slate-500 mt-1">
                Bạn có chắc chắn muốn xóa báo lỗi <strong className="text-slate-800 font-bold">[{deletingDefectTarget.id}] - {deletingDefectTarget.category}</strong> tại vị trí ({deletingDefectTarget.x}%, {deletingDefectTarget.y}%) không?
              </p>
              <p className="text-[11px] text-indigo-600 mt-1 font-medium">💡 Thao tác này có thể Hoàn tác.</p>
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
                  if (!canDeleteDefects) return;
                  onDeleteDefect(deletingDefectTarget.id);
                  setDeletingDefectTarget(null);
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-extrabold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE ORPHANED ROOMS MODAL */}
      {canManageStructure && confirmDeleteOrphanedModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[200] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-sm rounded-2xl p-5 space-y-4 shadow-2xl border border-rose-100 text-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 mx-auto flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Xác nhận xóa Phòng Ẩn</h3>
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
                Xác nhận xóa Sạch
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
          onClose={() => {
            viewingImageSet.images.forEach((url) => {
              if (url.startsWith('blob:')) { try { URL.revokeObjectURL(url); } catch {} }
            });
            setViewingImageSet(null);
          }}
          images={viewingImageSet.images}
          initialIndex={viewingImageSet.initialIndex}
        />
      )}

      {/* MOBILE LONG PRESS TOUCH CONTEXT MENU */}
      {canManageStructure && touchMenu && (
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
