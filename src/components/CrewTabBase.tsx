import React, { useState, useMemo, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import * as XLSX from 'xlsx';
import { 
  Users, 
  Calendar, 
  Plus, 
  Trash2, 
  Edit2, 
  Copy, 
  ChevronLeft, 
  ChevronRight, 
  MapPin, 
  Clipboard, 
  User, 
  X, 
  TrendingUp,
  Briefcase,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Settings,
  Download,
  Upload,
  FileSpreadsheet,
  BarChart3,
  Home,
  CheckCircle,
  ArrowUpDown
} from 'lucide-react';
import { CrewRecord, FloorPlan, TeamInfo, RoomProgressItem, DefectItem, CrewFloorWork, CrewFloorCategoryWork, AcceptanceStatus, RoomInspectionResult } from '../types';
import { formatDateDDMMYYYY } from '../utils/dateFormatter';
import { exportTeamStatisticsToExcel } from '../utils/excelExport';
import { confirmAsync } from '../utils/confirmAsync';
import { formatDecimal, evaluateMathExpression, useFormatSettings, parseExcelNumber } from '../utils/numberUtils';
import { isTeamMatch, getTeamCategoriesForRoom, calculateTeamStatistics, isTeamWorkCompletedInRoom, FloorGroupDetail, getSubItemGroupWeight } from '../utils/teamUtils';
import { SortOrder, applySortOrder, compareDateValues, compareFloorValues, naturalCompare } from '../utils/sortUtils';
import { PhotoAttachmentPicker } from './PhotoAttachmentPicker';
import { MathNumberInput } from './MathNumberInput';
import { deleteEntityPhotos, getEntityPhotos, isPhotoSharedCloudReady } from '../utils/photoStorage';
import { saveWorkbookFile } from '../utils/fileExport';
import { createEntityId } from '../utils/idUtils';
import { QuickSortBar } from './QuickSortBar';
import { UserRole, canEditCrewData, canDeleteBusinessData, canDeleteCrewRecord, canManageTeams, canImportData } from '../utils/securityUtils';
import { getCrewShiftCounts } from '../utils/crewUtils';
import { ContactMenu } from './ContactMenu';
import { ShareEntityMenu } from './ShareEntityMenu';

const CrewPhotoCount: React.FC<{ projectId?: string; recordId: string }> = ({ projectId, recordId }) => {
  const [count, setCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!projectId || !recordId) return;
      setLoading(true);
      try {
        const photos = await getEntityPhotos(projectId, 'crewRecord', recordId, 'crew_progress');
        if (!cancelled) {
          setCount(photos.length);
          setPendingCount(photos.filter((photo) => !isPhotoSharedCloudReady(photo)).length);
        }
      } catch (_) {
        if (!cancelled) {
          setCount(0);
          setPendingCount(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const onPhotosChanged = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      if (detail.source === 'cloud' && Array.isArray(detail.entities)) {
        const relevant = detail.entities.some((item: any) =>
          item?.entityType === 'crewRecord' && item?.entityId === recordId && (!item?.category || item.category === 'crew_progress')
        );
        if (!relevant) return;
      } else {
        if (detail.entityType && detail.entityType !== 'crewRecord') return;
        if (detail.entityId && detail.entityId !== recordId) return;
        if (detail.category && detail.category !== 'crew_progress') return;
      }
      void load();
    };
    void load();
    window.addEventListener('qlct-photo-attachments-changed', onPhotosChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('qlct-photo-attachments-changed', onPhotosChanged);
    };
  }, [projectId, recordId]);

  return (
    <div className="mt-2.5 pt-2 border-t border-slate-100">
      <button
        type="button"
        onClick={() => count > 0 && setExpanded((value) => !value)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-extrabold ${pendingCount > 0 ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100' : count > 0 ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100' : 'bg-slate-50 border-slate-200 text-slate-500'}`}
      >
        <FileText className="w-3.5 h-3.5" />
        {loading
          ? 'Đang kiểm tra ảnh...'
          : count > 0
            ? `${count} ảnh hiện trường${pendingCount > 0 ? ` · ${pendingCount} chờ Cloud` : ''} · ${expanded ? 'Ẩn' : 'Xem'}`
            : 'Chưa có ảnh hiện trường'}
      </button>
      {expanded && count > 0 && projectId && (
        <div className="mt-2">
          <PhotoAttachmentPicker
            projectId={projectId}
            entityType="crewRecord"
            entityId={recordId}
            category="crew_progress"
            label="HÌNH ẢNH HIỆN TRƯỜNG"
            readOnly
          />
        </div>
      )}
    </div>
  );
};

interface CrewTabProps {
  projectId?: string;
  userRole: UserRole;
  roleResolved: boolean;
  currentUserUid?: string;
  projectName?: string;
  crewRecords: CrewRecord[];
  floorPlans: FloorPlan[];
  roomProgressList?: RoomProgressItem[];
  defects?: DefectItem[];
  onAddCrewRecord: (record: Omit<CrewRecord, 'id'> & { id?: string }) => void;
  onUpdateCrewRecord: (id: string, record: Partial<CrewRecord>) => void;
  onDeleteCrewRecord: (id: string) => void;
  onDeleteMultipleCrewRecords?: (ids: string[]) => void;
  onCopyCrewRecordsFromDate: (sourceDate: string, targetDate: string) => void;
  onOpenExportPdf?: () => void;
  onExportExcel?: () => void;
  teams?: TeamInfo[];
  onUpdateTeams?: (teams: TeamInfo[]) => void;
}

const buildCrewRecordShareText = (record: CrewRecord, projectName?: string) => {
  const counts = getCrewShiftCounts(record);
  const floors = Array.from(new Set([
    record.floorName,
    ...(record.floorWorks || []).map((work) => work.floorName),
  ].map((value) => String(value || '').trim()).filter(Boolean)));
  const tasks = Array.from(new Set([
    record.taskDescription,
    ...(record.floorWorks || []).flatMap((work) => (work.categories || []).flatMap((category) => [
      category.categoryName,
      ...(category.subItems || []),
    ])),
  ].map((value) => String(value || '').trim()).filter(Boolean)));
  return [
    'HNL QLTC – Báo cáo quân số theo ngày',
    projectName ? `Dự án: ${projectName}` : '',
    `Ngày: ${formatDateDDMMYYYY(record.date)}`,
    `Đội: ${record.teamName || 'Chưa cập nhật'}`,
    record.leaderName ? `Đội trưởng: ${record.leaderName}` : '',
    floors.length ? `Tầng / khu vực: ${floors.join(', ')}` : '',
    `Sáng: ${counts.morning} người`,
    `Chiều: ${counts.afternoon} người`,
    `Tối: ${counts.evening} người`,
    `Quân số tham chiếu: ${Number(record.workerCount || 0)} người`,
    tasks.length ? `Công việc: ${tasks.join(' · ')}` : '',
    record.notes ? `Ghi chú: ${record.notes}` : '',
    'Lưu ý: Sáng/Chiều/Tối là quân số theo ca, không cộng thành số người duy nhất trong ngày.',
  ].filter(Boolean).join('\n');
};

const COMMON_TASKS = [
  'Bắn tấm thạch cao trần vách',
  'Lắp dựng khung xương chính & phụ',
  'Sơn bả matit hoàn thiện trần',
  'Trét mối nối & dán băng keo thủy tinh',
  'Vệ sinh mặt bằng & tập kết vật tư',
  'Sửa chữa lỗi & vá dặm lỗ điện nước',
  'Thi công cách âm / bảo ôn bông thủy tinh'
];

type TeamSortOrder = SortOrder;
type TeamLogSortMode = 'date' | 'floor';

const getFloorPlanById = (floorPlans: FloorPlan[], floorId?: string | null) =>
  floorId ? floorPlans.find(floor => floor.id === floorId) : undefined;

const getDefectRoomSortLabel = (defect: DefectItem, rooms: RoomProgressItem[]) => {
  const roomName = defect.roomId ? rooms.find(room => room.id === defect.roomId)?.roomName : '';
  return roomName || defect.roomId || defect.axisGrid || defect.positionDetail || '';
};

const getCrewLogFloorEntries = (log: CrewRecord, floorPlans: FloorPlan[]) => {
  const entries: Array<{ floorId?: string; floorName?: string }> = [];
  const floorIds = Array.isArray((log as CrewRecord & { floorIds?: string[] }).floorIds)
    ? (log as CrewRecord & { floorIds?: string[] }).floorIds || []
    : [];

  floorIds.forEach(floorId => {
    const floor = getFloorPlanById(floorPlans, floorId);
    entries.push({ floorId, floorName: floor?.floorName });
  });

  if (Array.isArray(log.floorWorks)) {
    log.floorWorks.forEach(work => {
      entries.push({ floorId: work.floorId, floorName: work.floorName });
    });
  }

  if (entries.length === 0 && (log.floorId || log.floorName)) {
    const names = log.floorName
      ? log.floorName.split(/\s*,\s*/).map(name => name.trim()).filter(Boolean)
      : [];
    if (names.length > 1) {
      names.forEach(name => entries.push({ floorName: name }));
    } else {
      const floor = getFloorPlanById(floorPlans, log.floorId);
      entries.push({ floorId: log.floorId, floorName: log.floorName || floor?.floorName });
    }
  }

  const seen = new Set<string>();
  return entries.filter(entry => {
    const key = `${entry.floorId || ''}|${entry.floorName || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(entry.floorId || entry.floorName);
  });
};

const getCrewLogPrimaryFloor = (log: CrewRecord, floorPlans: FloorPlan[]) => {
  const entries = getCrewLogFloorEntries(log, floorPlans);
  return [...entries].sort(compareFloorValues)[0] || { floorName: log.floorName || '' };
};

const getCrewLogFloorLabel = (log: CrewRecord, floorPlans: FloorPlan[]) => {
  const entries = getCrewLogFloorEntries(log, floorPlans);
  if (entries.length === 0) return log.floorName || 'Chưa chọn tầng';
  return entries
    .sort(compareFloorValues)
    .map(entry => entry.floorName || entry.floorId || 'Chưa chọn tầng')
    .join(', ');
};



export const CrewTab: React.FC<CrewTabProps> = ({
  projectId = 'default-project',
  userRole,
  roleResolved,
  currentUserUid = '',
  projectName,
  crewRecords,
  floorPlans,
  roomProgressList = [],
  defects = [],
  onAddCrewRecord,
  onUpdateCrewRecord,
  onDeleteCrewRecord,
  onDeleteMultipleCrewRecords,
  onCopyCrewRecordsFromDate,
  onOpenExportPdf,
  onExportExcel,
  teams: propTeams,
  onUpdateTeams,
}) => {
  const { t } = useLanguage();
  const canOperate = roleResolved && canEditCrewData(userRole);
  // Bulk deletion remains ADMIN-only. EDITOR can remove only a record they created,
  // and that record still goes through the normal Trash / soft-delete sync pipeline.
  const canDelete = roleResolved && canDeleteBusinessData(userRole);
  const canDeleteRecord = (record: CrewRecord) =>
    roleResolved && canDeleteCrewRecord(userRole, currentUserUid, record.createdByUid);
  const canManageTeamDirectory = roleResolved && canManageTeams(userRole);
  const canImportTeams = roleResolved && canImportData(userRole) && canManageTeams(userRole);
  // Navigation Tabs: 'logs' (Daily logs) or 'teams' (Manage team directory)
  const [activeSubTab, setActiveSubTab] = useState<'logs' | 'teams'>('logs');
  useFormatSettings();
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);

  // Load custom teams list from props
  const [teams, setTeams] = useState<TeamInfo[]>(() => propTeams || []);

  // Team detail & statistics modal state
  const [selectedTeamForDetail, setSelectedTeamForDetail] = useState<TeamInfo | null>(null);
  const [detailModalTab, setDetailModalTab] = useState<'rooms' | 'defects' | 'logs'>('rooms');
  const [defectFilter, setDefectFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [teamFloorSortOrder, setTeamFloorSortOrder] = useState<TeamSortOrder>('asc');
  const [teamDefectFloorSortOrder, setTeamDefectFloorSortOrder] = useState<TeamSortOrder>('asc');
  const [teamLogSortMode, setTeamLogSortMode] = useState<TeamLogSortMode>('date');
  const [teamLogDateSortOrder, setTeamLogDateSortOrder] = useState<TeamSortOrder>('desc');
  const [teamLogFloorSortOrder, setTeamLogFloorSortOrder] = useState<TeamSortOrder>('asc');
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [dailyRecordSortBy, setDailyRecordSortBy] = useState<'team' | 'floor' | 'workers'>('team');
  const [dailyRecordSortOrder, setDailyRecordSortOrder] = useState<TeamSortOrder>('asc');
  const [teamListSortBy, setTeamListSortBy] = useState<'name' | 'leader' | 'count'>('name');
  const [teamListSortOrder, setTeamListSortOrder] = useState<TeamSortOrder>('asc');

  // Sync state if prop changes
  useEffect(() => {
    if (propTeams) {
      setTeams(propTeams);
    }
  }, [propTeams]);

  // Call onUpdateTeams when teams change
  const updateTeamsAndParent = (nextTeams: TeamInfo[]) => {
    if (!canManageTeamDirectory) return;
    setTeams(nextTeams);
    if (onUpdateTeams) {
      onUpdateTeams(nextTeams);
    }
  };

  // Today's date YYYY-MM-DD
  const getTodayString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [selectedDate, setSelectedDate] = useState<string>(getTodayString());
  
  // Modals visibility states
  const [showAddLogModal, setShowAddLogModal] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  
  // Editing targets
  const [editingRecord, setEditingRecord] = useState<CrewRecord | null>(null);
  const [editingTeam, setEditingTeam] = useState<TeamInfo | null>(null);

  // A diagnostic request is stored before App switches tabs, so lazy mounting cannot
  // lose the target. Editors open the exact record; read-only users land on its date
  // and the matching card is scrolled into view.
  useEffect(() => {
    let raw = '';
    try { raw = sessionStorage.getItem('qlct_diagnostic_navigation_request') || ''; } catch (_) {}
    if (!raw) return;
    try {
      const request = JSON.parse(raw);
      if (request?.entityType !== 'crewRecord') return;
      if (request?.projectId && request.projectId !== projectId) return;
      const target = crewRecords.find((record) => record.id === request.entityId);
      if (!target) {
        sessionStorage.removeItem('qlct_diagnostic_navigation_request');
        alert('Bản ghi quân số liên quan không còn tồn tại hoặc đã bị xóa.');
        return;
      }
      setActiveSubTab('logs');
      setSelectedDate(target.date);
      if (canOperate) {
        setEditingRecord(target);
        setShowAddLogModal(true);
      }
      sessionStorage.removeItem('qlct_diagnostic_navigation_request');
      window.setTimeout(() => {
        document.querySelector(`[data-crew-record-id="${target.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    } catch (_) {
      try { sessionStorage.removeItem('qlct_diagnostic_navigation_request'); } catch (_) {}
    }
  }, [projectId, crewRecords, canOperate]);

  // Custom confirmation modal states
  const [deletingRecordTarget, setDeletingRecordTarget] = useState<CrewRecord | null>(null);
  const [deletingTeamTarget, setDeletingTeamTarget] = useState<TeamInfo | null>(null);
  const [showCopyConfirm, setShowCopyConfirm] = useState(false);
  const [copySourceDate, setCopySourceDate] = useState('');
  const [showCopyDatePicker, setShowCopyDatePicker] = useState(false);
  const [copyDatePickerValue, setCopyDatePickerValue] = useState('');

  useEffect(() => {
    if (!canOperate) {
      setShowAddLogModal(false);
      setEditingRecord(null);
      setShowCopyConfirm(false);
    }
    if (!canDelete) {
      // EDITOR has no bulk-delete selection. A single own-record delete target is
      // allowed to remain open; any stale/foreign target is closed.
      setDeletingRecordTarget((target) => target && canDeleteRecord(target) ? target : null);
      setSelectedRecordIds([]);
    }
    if (!canManageTeamDirectory) {
      setShowTeamModal(false);
      setEditingTeam(null);
      setDeletingTeamTarget(null);
      setSelectedTeamIds([]);
    }
  }, [canOperate, canDelete, canManageTeamDirectory, roleResolved, userRole, currentUserUid]);

  // Daily Log Form State
  const [teamName, setTeamName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [leaderName, setLeaderName] = useState('');
  const [workerCount, setWorkerCount] = useState<number>(5);
  const [morningCount, setMorningCount] = useState<number>(5);
  const [afternoonCount, setAfternoonCount] = useState<number>(5);
  const [eveningCount, setEveningCount] = useState<number>(0);
  const [selectedFloorId, setSelectedFloorId] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [floorWorks, setFloorWorks] = useState<CrewFloorWork[]>([]);

  const addFloorWork = () => {
    const defaultFp = floorPlans[0];
    setFloorWorks(prev => [
      ...prev,
      {
        floorId: defaultFp ? defaultFp.id : 'floor-1',
        floorName: defaultFp ? defaultFp.floorName : 'Tầng 1',
        categories: [
          {
            categoryName: 'Thi công thạch cao',
            subItems: ['Bắn tấm khung trần']
          }
        ]
      }
    ]);
  };

  const removeFloorWork = async (floorIndex: number) => {
    setFloorWorks(prev => prev.filter((_, idx) => idx !== floorIndex));
  };

  const updateFloorWorkFloor = (floorIndex: number, floorId: string) => {
    const fp = floorPlans.find(f => f.id === floorId);
    setFloorWorks(prev => prev.map((fw, idx) => {
      if (idx === floorIndex) {
        return {
          ...fw,
          floorId,
          floorName: fp ? fp.floorName : fw.floorName
        };
      }
      return fw;
    }));
  };

  const addCategoryToFloor = (floorIndex: number) => {
    setFloorWorks(prev => prev.map((fw, idx) => {
      if (idx === floorIndex) {
        return {
          ...fw,
          categories: [
            ...fw.categories,
            {
              categoryName: 'Hạng mục mới',
              subItems: ['Công đoạn 1']
            }
          ]
        };
      }
      return fw;
    }));
  };

  const removeCategoryFromFloor = (floorIndex: number, catIndex: number) => {
    setFloorWorks(prev => prev.map((fw, idx) => {
      if (idx === floorIndex) {
        return {
          ...fw,
          categories: fw.categories.filter((_, cIdx) => cIdx !== catIndex)
        };
      }
      return fw;
    }));
  };

  const updateCategoryName = (floorIndex: number, catIndex: number, categoryName: string) => {
    setFloorWorks(prev => prev.map((fw, idx) => {
      if (idx === floorIndex) {
        return {
          ...fw,
          categories: fw.categories.map((cat, cIdx) => {
            if (cIdx === catIndex) {
              return { ...cat, categoryName };
            }
            return cat;
          })
        };
      }
      return fw;
    }));
  };

  const addSubItemToCategory = (floorIndex: number, catIndex: number, subItemName: string) => {
    if (!subItemName.trim()) return;
    setFloorWorks(prev => prev.map((fw, idx) => {
      if (idx === floorIndex) {
        return {
          ...fw,
          categories: fw.categories.map((cat, cIdx) => {
            if (cIdx === catIndex) {
              return { ...cat, subItems: [...cat.subItems, subItemName.trim()] };
            }
            return cat;
          })
        };
      }
      return fw;
    }));
  };

  const removeSubItemFromCategory = (floorIndex: number, catIndex: number, subIdx: number) => {
    setFloorWorks(prev => prev.map((fw, idx) => {
      if (idx === floorIndex) {
        return {
          ...fw,
          categories: fw.categories.map((cat, cIdx) => {
            if (cIdx === catIndex) {
              return { ...cat, subItems: cat.subItems.filter((_, sIdx) => sIdx !== subIdx) };
            }
            return cat;
          })
        };
      }
      return fw;
    }));
  };

  const syncWorkerCountFromShifts = (morning: number, afternoon: number, evening: number) => {
    setWorkerCount(Math.max(0, morning || 0, afternoon || 0, evening || 0));
  };

  const setShiftCount = (shift: 'Sáng' | 'Chiều' | 'Tối', value: number) => {
    const safe = Math.max(0, Number(value) || 0);
    const nextMorning = shift === 'Sáng' ? safe : morningCount;
    const nextAfternoon = shift === 'Chiều' ? safe : afternoonCount;
    const nextEvening = shift === 'Tối' ? safe : eveningCount;
    setMorningCount(nextMorning);
    setAfternoonCount(nextAfternoon);
    setEveningCount(nextEvening);
    syncWorkerCountFromShifts(nextMorning, nextAfternoon, nextEvening);
  };



  // Manage Team Form State
  const [tName, setTName] = useState('');
  const [tLeader, setTLeader] = useState('');
  const [tCount, setTCount] = useState<number>(5);
  const [tPhone, setTPhone] = useState('');
  const [tNotes, setTNotes] = useState('');

  // Synchronize Daily Log Form values
  const [activeLogEntityId, setActiveLogEntityId] = useState<string>(`crew_${Date.now()}`);

  useEffect(() => {
    if (editingRecord) {
      setActiveLogEntityId(editingRecord.id);
      setTeamName(editingRecord.teamName);
      setTeamId(editingRecord.teamId || '');
      setLeaderName(editingRecord.leaderName);
      setWorkerCount(editingRecord.workerCount);
      const legacyShiftText = editingRecord.shift || 'Sáng, Chiều';
      const legacyShifts = legacyShiftText === 'Hành chính' ? ['Sáng', 'Chiều'] : legacyShiftText === 'Tăng ca' ? ['Tối'] : legacyShiftText.split(',').map(v => v.trim());
      const legacyCount = Math.max(0, Number(editingRecord.workerCount) || 0);
      setMorningCount(editingRecord.morningCount ?? (legacyShifts.includes('Sáng') ? legacyCount : 0));
      setAfternoonCount(editingRecord.afternoonCount ?? (legacyShifts.includes('Chiều') ? legacyCount : 0));
      setEveningCount(editingRecord.eveningCount ?? (legacyShifts.includes('Tối') ? legacyCount : 0));
      if (editingRecord.floorWorks && editingRecord.floorWorks.length > 0) {
        setFloorWorks(editingRecord.floorWorks);
      } else if (editingRecord.floorId) {
        setFloorWorks([{
          floorId: editingRecord.floorId,
          floorName: editingRecord.floorName || 'Tầng',
          categories: [{
            categoryName: editingRecord.taskDescription || 'Thi công thạch cao',
            subItems: []
          }]
        }]);
      } else {
        setFloorWorks([]);
      }
      setSelectedFloorId(editingRecord.floorId || '');
      setTaskDescription(editingRecord.taskDescription);
      
      setNotes(editingRecord.notes || '');
    } else {
      setActiveLogEntityId(`crew_${Date.now()}`);
      // Set to first team in directory if available, otherwise blank
      if (teams.length > 0) {
        setTeamName(teams[0].name);
        setTeamId(teams[0].id || '');
        setLeaderName(teams[0].leader);
        setWorkerCount(teams[0].defaultCount);
        setMorningCount(teams[0].defaultCount);
        setAfternoonCount(teams[0].defaultCount);
        setEveningCount(0);
      } else {
        setTeamName('');
        setTeamId('');
        setLeaderName('');
        setWorkerCount(5);
        setMorningCount(5);
        setAfternoonCount(5);
        setEveningCount(0);
      }
      if (floorPlans.length > 0) {
        setFloorWorks([{
          floorId: floorPlans[0].id,
          floorName: floorPlans[0].floorName,
          categories: [{
            categoryName: 'Thi công thạch cao',
            subItems: ['Bắn tấm khung chìm', 'Bả matit 2 lớp']
          }]
        }]);
        setSelectedFloorId(floorPlans[0].id);
      } else {
        setFloorWorks([]);
        setSelectedFloorId('');
      }
      setTaskDescription(COMMON_TASKS[0]);
      setNotes('');
    }
  }, [editingRecord, showAddLogModal, floorPlans, teams]);

  // Synchronize Manage Team Form values
  useEffect(() => {
    if (editingTeam) {
      setTName(editingTeam.name);
      setTLeader(editingTeam.leader);
      setTCount(editingTeam.defaultCount);
      setTPhone(editingTeam.phone || '');
      setTNotes(editingTeam.notes || '');
    } else {
      setTName('');
      setTLeader('');
      setTCount(5);
      setTPhone('');
      setTNotes('');
    }
  }, [editingTeam, showTeamModal]);

  // Paste from Clipboard or Prompt
  const handlePasteClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setTPhone(text.trim());
          return;
        }
      }
    } catch (err) {
      console.log('Clipboard read permission error:', err);
    }
    const p = prompt('Dán hoặc nhập số điện thoại từ danh bạ:');
    if (p) {
      setTPhone(p.trim());
    }
  };

  // Pick Contact from Device Contact List
  const handlePickContact = async () => {
    let success = false;
    if ('contacts' in navigator && 'select' in (navigator as any).contacts) {
      try {
        const props = ['name', 'tel'];
        const contacts = await (navigator as any).contacts.select(props, { multiple: false });
        if (contacts && contacts.length > 0) {
          const contact = contacts[0];
          if (contact.tel && contact.tel.length > 0) {
            const rawPhone = contact.tel[0].replace(/[^\d+]/g, '');
            setTPhone(rawPhone || contact.tel[0]);
            success = true;
          }
          if (contact.name && contact.name.length > 0 && !tLeader) {
            setTLeader(contact.name[0]);
          }
        } else {
          return; // user cancelled
        }
      } catch (err) {
        console.log('Contact picker not allowed in iframe or failed:', err);
      }
    }

    if (!success) {
      await handlePasteClipboard();
    }
  };

  // Navigate Date
  const handlePrevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    setSelectedDate(`${year}-${month}-${day}`);
  };

  const handleNextDay = () => {
    const today = getTodayString();
    if (selectedDate >= today) {
      alert('Không thể chọn quân số của ngày hôm sau!');
      return;
    }
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const nextDate = `${year}-${month}-${day}`;
    if (nextDate > today) {
      alert('Không thể chọn quân số của ngày hôm sau!');
      return;
    }
    setSelectedDate(nextDate);
  };

  // Filter records for the selected date
  const filteredRecords = useMemo(() => {
    return crewRecords.filter((record) => record.date === selectedDate);
  }, [crewRecords, selectedDate]);

  const sortedFilteredRecords = useMemo(() => {
    const list = [...filteredRecords];
    list.sort((a, b) => {
      let comparison = 0;
      if (dailyRecordSortBy === 'team') {
        comparison = (a.teamName || '').localeCompare(b.teamName || '', 'vi', { numeric: true, sensitivity: 'base' });
      } else if (dailyRecordSortBy === 'floor') {
        comparison = compareFloorValues(getCrewLogPrimaryFloor(a, floorPlans), getCrewLogPrimaryFloor(b, floorPlans));
      } else {
        comparison = (Number(a.workerCount) || 0) - (Number(b.workerCount) || 0);
      }
      return dailyRecordSortOrder === 'asc' ? comparison : -comparison;
    });
    return list;
  }, [filteredRecords, dailyRecordSortBy, dailyRecordSortOrder]);

  const sortedTeams = useMemo(() => {
    const list = [...teams];
    list.sort((a, b) => {
      let comparison = 0;
      if (teamListSortBy === 'name') {
        comparison = (a.name || '').localeCompare(b.name || '', 'vi', { numeric: true, sensitivity: 'base' });
      } else if (teamListSortBy === 'leader') {
        comparison = (a.leader || '').localeCompare(b.leader || '', 'vi', { numeric: true, sensitivity: 'base' });
      } else {
        comparison = (Number(a.defaultCount) || 0) - (Number(b.defaultCount) || 0);
      }
      return teamListSortOrder === 'asc' ? comparison : -comparison;
    });
    return list;
  }, [teams, teamListSortBy, teamListSortOrder]);

  // Statistics for the selected date
  const stats = useMemo(() => {
    // “Quân số trong ngày” is headcount, not the sum of morning + afternoon shifts.
    // For each team, take the highest recorded headcount of the day so the same
    // workers are not counted twice when they work both Sáng and Chiều.
    const teamMaxMap: Record<string, number> = {};
    const teamSet = new Set<string>();

    filteredRecords.forEach((r) => {
      const teamKey = r.teamId || r.teamName.trim().toLowerCase();
      teamSet.add(teamKey);
      teamMaxMap[teamKey] = Math.max(teamMaxMap[teamKey] || 0, Number(r.workerCount) || 0);
    });

    const totalWorkers = Object.values(teamMaxMap).reduce((sum, count) => sum + count, 0);
    const totalTeams = teamSet.size;

    // Distribution by floor
    const floorDistribution: { [key: string]: { name: string; count: number } } = {};
    filteredRecords.forEach((r) => {
      if (r.floorId) {
        if (!floorDistribution[r.floorId]) {
          floorDistribution[r.floorId] = { name: r.floorName || 'Tầng', count: 0 };
        }
        floorDistribution[r.floorId].count += r.workerCount;
      }
    });

    const activeFloorsList = Object.values(floorDistribution).sort((a, b) => b.count - a.count);

    return {
      totalWorkers,
      totalTeams,
      activeFloorsList
    };
  }, [filteredRecords]);

  // Centralized calculations for all construction teams
  const allTeamStatsMap = useMemo(() => {
    return calculateTeamStatistics({
      teams,
      roomProgressList: roomProgressList || [],
      defects: defects || [],
      crewRecords: crewRecords || [],
      floorPlans: floorPlans || []
    });
  }, [teams, roomProgressList, defects, crewRecords, floorPlans]);

  // Handle Daily Log Submission
  const handleLogSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canOperate) return;
    if (!teamName.trim()) {
      alert('Vui lòng chọn hoặc nhập tên đội thi công!');
      return;
    }
    if (!leaderName.trim()) {
      alert('Vui lòng nhập tên trưởng nhóm/đội trưởng!');
      return;
    }
    if (Math.max(morningCount, afternoonCount, eveningCount) <= 0) {
      alert('Phải có ít nhất một ca có quân số lớn hơn 0!');
      return;
    }

    const normalizedTeamName = teamName.trim();
    const existingRecord = crewRecords.find(
      (r) => r.date === selectedDate && r.teamName.toLowerCase() === normalizedTeamName.toLowerCase()
    );

    if (existingRecord && (!editingRecord || existingRecord.id !== editingRecord.id)) {
      alert(`Đội "${normalizedTeamName}" đã được ghi nhận quân số trong ngày hôm nay!`);
      return;
    }

    // Auto-commit any currently typed but unadded sub-items / work categories
    let finalFloorWorks = [...floorWorks];
    floorWorks.forEach((fw, fIdx) => {
      fw.categories.forEach((cat, cIdx) => {
        const inputEl = document.getElementById(`sub-input-${fIdx}-${cIdx}`) as HTMLInputElement;
        if (inputEl && inputEl.value.trim()) {
          const val = inputEl.value.trim();
          finalFloorWorks = finalFloorWorks.map((fItem, fI) => {
            if (fI === fIdx) {
              return {
                ...fItem,
                categories: fItem.categories.map((cItem, cI) => {
                  if (cI === cIdx) {
                    return {
                      ...cItem,
                      subItems: [...cItem.subItems, val]
                    };
                  }
                  return cItem;
                })
              };
            }
            return fItem;
          });
          inputEl.value = ''; // clear the input field
        }
      });
    });

    const firstFw = finalFloorWorks[0];
    const floorId = firstFw ? firstFw.floorId : selectedFloorId;
    const floorName = finalFloorWorks.length > 0
      ? finalFloorWorks.map(fw => fw.floorName).join(', ')
      : (floorPlans.find(fp => fp.id === selectedFloorId)?.floorName || 'Tầng');

    const taskDesc = finalFloorWorks.length > 0
      ? finalFloorWorks.map(fw => `[${fw.floorName}]: ` + fw.categories.map(c => `${c.categoryName} (${c.subItems.join(', ')})`).join('; ')).join(' | ')
      : taskDescription;

    const activeShifts = [morningCount > 0 ? 'Sáng' : '', afternoonCount > 0 ? 'Chiều' : '', eveningCount > 0 ? 'Tối' : ''].filter(Boolean);
    const shiftValue = activeShifts.length > 0 ? activeShifts.join(', ') : 'Nghỉ';

    const matchingTeam = teams.find(t => t.name.trim().toLowerCase() === teamName.trim().toLowerCase());
    const finalTeamId = teamId || matchingTeam?.id || '';

    const recordData = {
      date: selectedDate,
      teamId: finalTeamId || undefined,
      teamName: teamName.trim(),
      leaderName: leaderName.trim(),
      workerCount: Math.max(0, morningCount, afternoonCount, eveningCount),
      morningCount: Math.max(0, morningCount),
      afternoonCount: Math.max(0, afternoonCount),
      eveningCount: Math.max(0, eveningCount),
      floorId,
      floorName,
      floorWorks: finalFloorWorks,
      taskDescription: taskDesc,
      shift: shiftValue,
      notes: notes.trim() || undefined
    };

    if (editingRecord) {
      onUpdateCrewRecord(editingRecord.id, recordData);
      setEditingRecord(null);
    } else {
      onAddCrewRecord({ ...recordData, id: activeLogEntityId });
    }
    setShowAddLogModal(false);
  };

  // Handle Team Directory Submission
  const handleTeamSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTeamDirectory) return;
    if (!tName.trim()) {
      alert('Vui lòng nhập tên đội thi công!');
      return;
    }
    if (!tLeader.trim()) {
      alert('Vui lòng nhập tên đội trưởng!');
      return;
    }
    if (tCount <= 0) {
      alert('Quân số định biên mặc định phải lớn hơn 0!');
      return;
    }

    const teamData: TeamInfo = {
      id: editingTeam ? editingTeam.id : createEntityId('team'),
      name: tName.trim(),
      leader: tLeader.trim(),
      defaultCount: tCount,
      phone: tPhone.trim() || undefined,
      notes: tNotes.trim() || undefined
    };

    let nextTeams: TeamInfo[];
    if (editingTeam) {
      nextTeams = teams.map((t) => (t.id === editingTeam.id ? teamData : t));
      setEditingTeam(null);
    } else {
      nextTeams = [...teams, teamData];
    }
    setTeams(nextTeams);
    if (onUpdateTeams) {
      onUpdateTeams(nextTeams);
    }
    setShowTeamModal(false);
  };

  // Copy the complete crew log from the immediately previous calendar day.
  const requestCopyFromDate = (sourceDate: string) => {
    if (!canOperate || !sourceDate) return;
    if (sourceDate === selectedDate) {
      alert('Ngày nguồn phải khác ngày đang ghi nhận.');
      return;
    }
    const sourceRecords = crewRecords.filter((r) => r.date === sourceDate);
    if (sourceRecords.length === 0) {
      alert(`Không tìm thấy dữ liệu quân số của ngày ${formatDateDDMMYYYY(sourceDate)} để sao chép!`);
      return;
    }
    setCopySourceDate(sourceDate);
    if (filteredRecords.length > 0) setShowCopyConfirm(true);
    else onCopyCrewRecordsFromDate(sourceDate, selectedDate);
  };

  const handleOpenCopyDatePicker = () => {
    if (!canOperate) return;
    const d = new Date(`${selectedDate}T12:00:00`);
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    setCopyDatePickerValue(`${year}-${month}-${day}`);
    setShowCopyDatePicker((value) => !value);
  };

  const confirmCopy = () => {
    if (!canOperate) return;
    onCopyCrewRecordsFromDate(copySourceDate, selectedDate);
    setShowCopyConfirm(false);
  };

  const executeDeleteRecord = async () => {
    if (!deletingRecordTarget || !canDeleteRecord(deletingRecordTarget)) return;
    if (deletingRecordTarget) {
      if (projectId) {
        let trashEnabled = true;
        try {
          const settingsKey = projectId === 'default' ? 'construction_trash_settings' : `construction_trash_settings_${projectId}`;
          const settings = JSON.parse(localStorage.getItem(settingsKey) || '{}');
          trashEnabled = settings?.enabled !== false;
        } catch (_) {}
        if (!trashEnabled) {
          try {
            await deleteEntityPhotos(projectId, 'crewRecord', deletingRecordTarget.id);
          } catch (_) {}
        }
      }
      onDeleteCrewRecord(deletingRecordTarget.id);
      setDeletingRecordTarget(null);
    }
  };

  const executeDeleteTeam = () => {
    if (!canManageTeamDirectory) return;
    if (deletingTeamTarget) {
      const nextTeams = teams.filter((t) => t.id !== deletingTeamTarget.id);
      setTeams(nextTeams);
      if (onUpdateTeams) {
        onUpdateTeams(nextTeams);
      }
      setDeletingTeamTarget(null);
    }
  };

  const handleExportTeamsTemplate = () => {
    const wb = XLSX.utils.book_new();
    const sourceData = teams.length > 0 ? teams : [
      {
        name: 'Đội Thạch Cao Hà Nội',
        leader: 'Đội trưởng Hùng',
        defaultCount: 12,
        phone: '0912345678',
        notes: 'Đội chính đóng tấm Gyproc'
      }
    ];

    const data = sourceData.map((item, idx) => ({
      'STT': idx + 1,
      '__teamId': item.id,
      'Tên Đội Thi Công': item.name,
      'Trưởng Nhóm / Đội Trưởng': item.leader,
      'Quân số định biên': item.defaultCount,
      'Số Điện Thoại': item.phone || '',
      'Ghi Chú': item.notes || '',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    
    // Auto-fit column widths
    const maxLens = data.reduce((acc: any, row: any) => {
      Object.keys(row).forEach((key) => {
        const valLen = String(row[key] || '').length;
        acc[key] = Math.max(acc[key] || 10, valLen + 4);
      });
      return acc;
    }, {});
    ws['!cols'] = Object.keys(maxLens).map((key) => ({ wch: maxLens[key] }));

    XLSX.utils.book_append_sheet(wb, ws, 'Danh Sach Doi Thi Cong');
    return saveWorkbookFile(wb, 'Mau_Danh_Sach_Doi_Thi_Cong.xlsx');
  };

  const handleExportTeamStats = (teamName?: string) => {
    const currentProjName = projectName || 'Công Trình';
    exportTeamStatisticsToExcel({
      teams,
      roomProgressList: roomProgressList || [],
      defects: defects || [],
      crewRecords,
      floorPlans,
      projectName: currentProjName,
      selectedTeamName: teamName
    });
  };

  const handleImportExcelTeams = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canImportTeams) { e.target.value = ''; return; }
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
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

        // Validate that we can find the team name column
        const firstRow = jsonData[0];
        const foundHeaders = Object.keys(firstRow);
        const nameMatchKey = foundHeaders.find(h => 
          ['Tên Đội Thi Công', 'teamName', 'Tên Đội', 'Đội Thi Công', 'team'].some(rk => h.toLowerCase().includes(rk.toLowerCase()))
        );

        if (!nameMatchKey) {
          alert(
            `⚠️ Không tìm thấy cột thông tin bắt buộc 'Tên Đội Thi Công'!\n\n` +
            `• Các cột tìm thấy trong file: [${foundHeaders.join(', ')}]\n` +
            `• Vui lòng đặt lại tiêu đề cột trong file Excel trùng với mẫu để hệ thống nhận diện đúng.`
          );
          return;
        }

        let updatedCount = 0;
        let addedCount = 0;
        let skippedCount = 0;
        let newTeams = [...teams];

        jsonData.forEach((row: any) => {
          const rawTeamId = String(row['__teamId'] || row['Mã Đội'] || row['id'] || '').trim();
          const nameStr = String(row[nameMatchKey] || '').trim();
          const leaderStr = String(row['Trưởng Nhóm / Đội Trưởng'] || row['Trưởng Nhóm'] || row['Đội Trưởng'] || row['leader'] || '').trim();
          const countNum = parseExcelNumber(row['Quân số định biên'] || row['defaultCount'] || row['Quân số'] || row['Số người'] || 0);
          const phoneStr = String(row['Số Điện Thoại'] || row['phone'] || row['sdt'] || '').trim();
          const notesStr = String(row['Ghi Chú'] || row['notes'] || '').trim();

          if (!nameStr || !leaderStr || countNum <= 0) {
            skippedCount++;
            return;
          }

          const existingIdx = rawTeamId 
            ? newTeams.findIndex(t => t.id === rawTeamId)
            : newTeams.findIndex(t => t.name.toLowerCase() === nameStr.toLowerCase());

          const teamData: TeamInfo = {
            id: existingIdx !== -1 ? newTeams[existingIdx].id : (rawTeamId || createEntityId('team')),
            name: nameStr,
            leader: leaderStr,
            defaultCount: countNum,
            phone: phoneStr || undefined,
            notes: notesStr || undefined
          };

          if (existingIdx !== -1) {
            newTeams[existingIdx] = teamData;
            updatedCount++;
          } else {
            newTeams.push(teamData);
            addedCount++;
          }
        });

        updateTeamsAndParent(newTeams);
        alert(
          `🎉 Nhập Đội Thi Công từ Excel thành công!\n\n` +
          `• Đã cập nhật/chỉnh sửa: ${updatedCount} đội\n` +
          `• Đã thêm mới: ${addedCount} đội\n` +
          `• Bỏ qua do thiếu thông tin bắt buộc (Tên đội, Đội trưởng hoặc Quân số > 0): ${skippedCount} dòng`
        );
      } catch (err: any) {
        alert(`❌ Lỗi đọc hoặc phân tích tệp Excel:\n${err.message || err}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  return (
    <div className="pb-24 pt-4 px-4 w-full max-w-6xl mx-auto bg-slate-50 min-h-screen text-slate-800" id="crew-tab-container">
      
      {/* Sub-tab Navigation Selector */}
      <div className="flex bg-slate-200 p-1.5 rounded-xl mb-4 shadow-sm" id="crew-subtab-navigation">
        <button
          onClick={() => setActiveSubTab('logs')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg transition-all ${
            activeSubTab === 'logs' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calendar className="w-4 h-4" /> {t('daily_diary')}
        </button>
        <button
          onClick={() => setActiveSubTab('teams')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg transition-all ${
            activeSubTab === 'teams' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" /> {t('team_directory')}
        </button>
      </div>

      {activeSubTab === 'logs' ? (
        <>
          {/* Daily Date Header Controller */}
          <div className="flex items-center justify-between bg-white px-3 py-2.5 rounded-xl border border-slate-200 shadow-sm mb-4">
            <button 
              onClick={handlePrevDay}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition"
              title="Ngày trước"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-600" />
              <input 
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  const val = e.target.value;
                  const today = getTodayString();
                  if (val > today) {
                    alert('Không thể chọn quân số của ngày hôm sau!');
                    setSelectedDate(today);
                  } else {
                    setSelectedDate(val);
                  }
                }}
                max={getTodayString()}
                className="font-bold text-slate-800 bg-transparent border-none focus:outline-none focus:ring-0 cursor-pointer text-sm"
              />
            </div>

            <button 
              onClick={handleNextDay}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition"
              title="Ngày tiếp theo"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Statistics widgets */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-gradient-to-br from-indigo-500 to-blue-600 text-white p-4 rounded-xl shadow-md">
              <div className="flex justify-between items-start">
                <span className="text-white/80 text-[10px] font-bold tracking-wider uppercase">
                  {selectedDate === getTodayString() ? 'Tổng quân số hôm nay' : `Tổng Quân Số Ngày ${formatDateDDMMYYYY(selectedDate)}`}
                </span>
                <Users className="w-4 h-4 text-white/80" />
              </div>
              <div className="text-2xl font-black mt-1 leading-none">{stats.totalWorkers}</div>
              <div className="flex justify-between text-[10px] text-white/90 mt-1.5 border-t border-white/20 pt-1">
                <span>Lực lượng thi công: <strong>{stats.totalTeams} tổ/đội</strong></span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start">
                  <span className="text-slate-400 text-[10px] font-bold tracking-wider uppercase">Khu vực đông nhất</span>
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="text-sm font-bold mt-1 text-slate-800 truncate">
                  {stats.activeFloorsList[0] ? stats.activeFloorsList[0].name : 'Chưa có'}
                </div>
              </div>
              <p className="text-slate-400 text-[10px] mt-1.5">
                {stats.activeFloorsList[0] ? `Tập trung ${stats.activeFloorsList[0].count} thợ` : 'Không có hoạt động'}
              </p>
            </div>
          </div>

          {/* Allocation visualization bar chart */}
          {stats.activeFloorsList.length > 0 && (
            <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm mb-4">
              <h3 className="text-[11px] font-bold text-slate-400 tracking-wider uppercase mb-3 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-indigo-500" /> Phân bổ quân số theo tầng làm việc
              </h3>
              <div className="space-y-3">
                {stats.activeFloorsList.map((floor) => {
                  const pct = stats.totalWorkers > 0 ? (floor.count / stats.totalWorkers) * 100 : 0;
                  return (
                    <div key={floor.name} className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-slate-700">{floor.name}</span>
                        <span className="text-indigo-600 font-bold">{floor.count} người ({Math.round(pct)}%)</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Functional Actions */}
          {canOperate && (
            <>
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={async () => {
                  setEditingRecord(null);
                  setShowAddLogModal(true);
                }}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 px-4 rounded-xl shadow-sm transition text-xs"
              >
                <Plus className="w-4 h-4" /> Ghi nhận quân số
              </button>

              <button
                onClick={handleOpenCopyDatePicker}
                className="flex-1 flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-2.5 px-4 rounded-xl shadow-sm transition text-xs"
                title="Chọn ngày nguồn để sao chép quân số"
              >
                <Copy className="w-3.5 h-3.5" /> Sao chép quân số
              </button>
            </div>

            {showCopyDatePicker && (
              <div className="mb-4 -mt-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3">
                <div className="text-[11px] font-bold text-indigo-800 mb-2">Chọn ngày cần sao chép quân số</div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    max={getTodayString()}
                    value={copyDatePickerValue}
                    onChange={(e) => setCopyDatePickerValue(e.target.value)}
                    className="flex-1 min-w-0 bg-white border border-indigo-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800"
                    aria-label="Ngày nguồn sao chép quân số"
                  />
                  <button
                    type="button"
                    disabled={!copyDatePickerValue || copyDatePickerValue === selectedDate}
                    onClick={() => {
                      requestCopyFromDate(copyDatePickerValue);
                      setShowCopyDatePicker(false);
                    }}
                    className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Sao chép
                  </button>
                </div>
              </div>
            )}
            </>
          )}

          {/* Daily Records List */}
          <div className="space-y-3">
            <h2 className="text-xs font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1.5 px-1">
              <Clipboard className="w-3.5 h-3.5 text-indigo-500" /> Nhật ký làm việc ({formatDateDDMMYYYY(selectedDate)})
            </h2>

            <QuickSortBar
              itemCount={filteredRecords.length}
              options={[
                { key: 'team', label: 'Đội thi công', kind: 'alpha' },
                { key: 'floor', label: 'Tầng', kind: 'floor' },
                { key: 'workers', label: 'Quân số', kind: 'number' },
              ]}
              activeKey={dailyRecordSortBy}
              order={dailyRecordSortOrder}
              onChange={(key, order) => { setDailyRecordSortBy(key); setDailyRecordSortOrder(order); }}
              onReset={() => { setDailyRecordSortBy('team'); setDailyRecordSortOrder('asc'); }}
              summary={`${filteredRecords.length} ghi nhận`}
            />

            {canDelete && filteredRecords.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs gap-2">
                <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={filteredRecords.length > 0 && filteredRecords.every(item => selectedRecordIds.includes(item.id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedRecordIds(prev => Array.from(new Set([...prev, ...filteredRecords.map(item => item.id)])));
                      } else {
                        setSelectedRecordIds(prev => prev.filter(id => !filteredRecords.some(item => item.id === id)));
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span>Chọn tất cả quân số ngày này ({filteredRecords.length})</span>
                </label>

                <div className="flex items-center gap-3 justify-end">
                  {selectedRecordIds.some(id => filteredRecords.some(item => item.id === id)) && (
                    <button
                      type="button"
                      onClick={async () => {
                        const idsToDelete = selectedRecordIds.filter(id => filteredRecords.some(item => item.id === id));
                        if (await confirmAsync(`Bạn có chắc muốn xóa ${idsToDelete.length} bản ghi quân số đã chọn?`)) {
                          if (onDeleteMultipleCrewRecords) {
                            onDeleteMultipleCrewRecords(idsToDelete);
                          } else {
                            idsToDelete.forEach(id => onDeleteCrewRecord(id));
                          }
                          setSelectedRecordIds(prev => prev.filter(id => !idsToDelete.includes(id)));
                        }
                      }}
                      className="text-rose-600 hover:text-rose-700 font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Xóa đã chọn ({selectedRecordIds.filter(id => filteredRecords.some(item => item.id === id)).length})
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={async () => {
                      const allFilteredIds = filteredRecords.map(item => item.id);
                      if (await confirmAsync(`⚠️ Bạn có chắc muốn xóa TOÀN BỘ ${allFilteredIds.length} bản ghi quân số của ngày này không?`)) {
                        if (onDeleteMultipleCrewRecords) {
                          onDeleteMultipleCrewRecords(allFilteredIds);
                        } else {
                          allFilteredIds.forEach(id => onDeleteCrewRecord(id));
                        }
                        setSelectedRecordIds(prev => prev.filter(id => !allFilteredIds.includes(id)));
                      }
                    }}
                    className="text-slate-500 hover:text-rose-600 font-bold flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-rose-500" /> Xóa Tất Cả
                  </button>
                </div>
              </div>
            )}

            {filteredRecords.length === 0 ? (
              <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center flex flex-col items-center justify-center shadow-sm">
                <Users className="w-8 h-8 text-slate-300 mb-2" />
                <p className="text-xs text-slate-400 font-medium">Chưa có ghi nhận quân số cho ngày này.</p>
                <p className="text-[10px] text-slate-400 mt-1">Ấn nút "Ghi nhận quân số" hoặc "Sao chép quân số" để điền nhanh.</p>
              </div>
            ) : (
              sortedFilteredRecords.map((record) => (
                <div 
                  key={record.id}
                  data-crew-record-id={record.id}
                  className={`bg-white border rounded-xl p-4 transition-all duration-150 relative hover:border-slate-300 ${
                    selectedRecordIds.includes(record.id)
                      ? 'border-indigo-300 bg-indigo-50/10 shadow-xs'
                      : 'border-slate-200 shadow-sm'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {canDelete && <input
                      type="checkbox"
                      checked={selectedRecordIds.includes(record.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedRecordIds(prev => [...prev, record.id]);
                        } else {
                          setSelectedRecordIds(prev => prev.filter(id => id !== record.id));
                        }
                      }}
                      className="mt-1 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                    />}

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-4 mb-2">
                        <div>
                          <h4 className="font-bold text-slate-800 text-sm leading-tight">{record.teamName}</h4>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
                            <User className="w-3.5 h-3.5 text-slate-300" />
                            <span>Đội trưởng: <strong>{record.leaderName}</strong></span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <div className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-2.5 py-1 rounded-lg text-center font-black text-xs min-w-[50px]">
                            {formatDecimal(record.workerCount)} thợ
                          </div>
                          <div className="flex flex-wrap gap-1 justify-end">
                            {(() => {
                              const counts = getCrewShiftCounts(record);
                              const parts = [
                                counts.morning > 0 ? `Sáng ${formatDecimal(counts.morning)}` : '',
                                counts.afternoon > 0 ? `Chiều ${formatDecimal(counts.afternoon)}` : '',
                                counts.evening > 0 ? `Tối ${formatDecimal(counts.evening)}` : '',
                              ].filter(Boolean);
                              return (
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-200">
                                  {parts.length > 0 ? parts.join(' • ') : 'Không có quân số'}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-1.5 pt-2 border-t border-slate-100 text-xs">
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>Tầng làm việc: <strong className="text-indigo-600">{record.floorName}</strong></span>
                        </div>

                        <div className="flex items-center gap-1.5 text-slate-600">
                          <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>Nhiệm vụ: <span className="font-medium text-slate-700">{record.taskDescription}</span></span>
                        </div>
                      </div>

                      {record.notes && (
                        <div className="mt-2 text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100">
                          <strong>Ghi chú:</strong> {record.notes}
                        </div>
                      )}

                      {/* Lightweight list mode: count only; thumbnails load on demand. */}
                      <CrewPhotoCount projectId={projectId} recordId={record.id} />

                      <div className="mt-2 flex justify-end">
                        <ShareEntityMenu
                          projectId={projectId}
                          entityType="crewRecord"
                          entityId={record.id}
                          title={`Quân số ${record.teamName || 'Đội thi công'} · ${formatDateDDMMYYYY(record.date)}`}
                          text={buildCrewRecordShareText(record, projectName)}
                          triggerLabel="Chia sẻ báo cáo"
                        />
                      </div>

                      {/* Actions buttons */}
                      {(canOperate || canDeleteRecord(record)) && <div className="flex items-center justify-end gap-3 mt-3 pt-2 border-t border-slate-100">
                        {canOperate && <button
                          onClick={async () => {
                            setEditingRecord(record);
                            setShowAddLogModal(true);
                          }}
                          className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 transition"
                          title="Sửa bản ghi"
                        >
                          <Edit2 className="w-3.5 h-3.5" /> <span>Sửa</span>
                        </button>}
                        {canDeleteRecord(record) && <button
                          type="button"
                          onClick={() => {
                            setDeletingRecordTarget(record);
                          }}
                          className="flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600 transition"
                          title={canDelete ? 'Xóa bản ghi' : 'Xóa bản ghi do bạn tạo (có thể khôi phục trong Thùng rác)'}
                        >
                          <Trash2 className="w-3.5 h-3.5" /> <span className="text-rose-500 font-semibold">Xóa</span>
                        </button>}
                      </div>}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        // TEAM INFORMATION DIRECTORY SUB-TAB
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 tracking-wider uppercase mb-1.5 flex items-center gap-1.5">
              <Settings className="w-3.5 h-3.5 text-indigo-500" /> {canManageTeamDirectory ? 'Quản lý danh mục các Đội thi công' : 'Danh mục các Đội thi công'}
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Khai báo thông tin các đội thợ tại đây bao gồm Đội trưởng, Quân số định biên mặc định. Khi ghi nhận nhật ký hằng ngày, chỉ cần chọn tên đội thợ để hệ thống tự động điền các thông tin liên quan, rút ngắn thời gian làm báo cáo hằng ngày.
            </p>

            <div className="mt-3.5 pt-3 border-t border-slate-100">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {canManageTeamDirectory && <button
                  type="button"
                  onClick={async () => {
                    setEditingTeam(null);
                    setShowTeamModal(true);
                  }}
                  className="h-10 px-3 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs shadow-2xs transition-all active:scale-95"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span className="truncate">Thêm đội mới</span>
                </button>}

                <button
                  type="button"
                  onClick={() => handleExportTeamStats()}
                  className="h-10 px-3 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-2xs transition-all active:scale-95"
                  title="Tải báo cáo Excel thống kê căn, tầng, khối lượng và defect của tất cả các đội thi công"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span className="truncate">Xuất báo cáo Excel</span>
                </button>

                {canManageTeamDirectory && <button
                  type="button"
                  onClick={handleExportTeamsTemplate}
                  className="h-10 px-3 flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-200 text-xs shadow-2xs transition-all active:scale-95"
                  title="Tải mẫu Excel danh bạ đội thi công"
                >
                  <FileSpreadsheet className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="truncate">Tải Excel để chỉnh sửa</span>
                </button>}

                {canImportTeams && <label className="h-10 px-3 flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-200 text-xs shadow-2xs cursor-pointer transition-all active:scale-95">
                  <Upload className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="truncate">Nhập lại từ Excel</span>
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleImportExcelTeams}
                    className="hidden"
                  />
                </label>}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-xs font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1.5 px-1">
              <Users className="w-3.5 h-3.5 text-indigo-500" /> Danh sách ({teams.length} đội thi công)
            </h2>

            <QuickSortBar
              itemCount={teams.length}
              options={[
                { key: 'name', label: 'Tên đội', kind: 'alpha' },
                { key: 'leader', label: 'Đội trưởng', kind: 'alpha' },
                { key: 'count', label: 'Quân số định biên', kind: 'number' },
              ]}
              activeKey={teamListSortBy}
              order={teamListSortOrder}
              onChange={(key, order) => { setTeamListSortBy(key); setTeamListSortOrder(order); }}
              onReset={() => { setTeamListSortBy('name'); setTeamListSortOrder('asc'); }}
              summary={`${teams.length} đội thi công`}
            />

            {canManageTeamDirectory && teams.length > 0 && (
              <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs gap-2">
                <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={teams.length > 0 && teams.every(item => selectedTeamIds.includes(item.id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedTeamIds(prev => Array.from(new Set([...prev, ...teams.map(item => item.id)])));
                      } else {
                        setSelectedTeamIds(prev => prev.filter(id => !teams.some(item => item.id === id)));
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span>Chọn tất cả đội ({teams.length})</span>
                </label>

                <div className="flex items-center gap-3 justify-end">
                  {selectedTeamIds.some(id => teams.some(item => item.id === id)) && (
                    <button
                      type="button"
                      onClick={async () => {
                        const idsToDelete = selectedTeamIds.filter(id => teams.some(item => item.id === id));
                        if (await confirmAsync(`Bạn có chắc muốn xóa ${idsToDelete.length} đội thi công đã chọn?`)) {
                          const nextTeams = teams.filter((t) => !idsToDelete.includes(t.id));
                          updateTeamsAndParent(nextTeams);
                          setSelectedTeamIds(prev => prev.filter(id => !idsToDelete.includes(id)));
                        }
                      }}
                      className="text-rose-600 hover:text-rose-700 font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Xóa đã chọn ({selectedTeamIds.filter(id => teams.some(item => item.id === id)).length})
                    </button>
                  )}
                </div>
              </div>
            )}

            {teams.length === 0 ? (
              <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center flex flex-col items-center justify-center shadow-sm">
                <Users className="w-8 h-8 text-slate-300 mb-2" />
                <p className="text-xs text-slate-400 font-medium">Chưa có đội thi công nào được thêm.</p>
                <p className="text-[10px] text-slate-400 mt-1">{canManageTeamDirectory ? 'Bấm Thêm đội để bắt đầu.' : 'Chỉ ADMIN được quản lý danh mục đội thi công.'}</p>
              </div>
            ) : (
              sortedTeams.map((team) => {
                const stat = allTeamStatsMap[team.id];
                if (!stat) return null;
                const {
                  teamRooms: assignedRooms,
                  totalTeamVol,
                  openDefectsCount,
                  totalMandays: totalManDays,
                  categoryBreakdown
                } = stat;

                const teamFloorNames = Array.from(new Set(assignedRooms.map(r => r.floorName || (floorPlans || []).find(f => f.id === r.floorId)?.floorName || 'Mặt bằng')));
                const teamWorkCategories = categoryBreakdown.map(cb => cb.categoryName);

                return (
                  <div 
                    key={team.id}
                    className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-indigo-300 transition-all duration-200 hover:shadow-md"
                  >
                    <div className="flex justify-between items-start gap-4 mb-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        {canManageTeamDirectory && (
                          <input
                            type="checkbox"
                            checked={selectedTeamIds.includes(team.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedTeamIds(prev => [...prev, team.id]);
                              } else {
                                setSelectedTeamIds(prev => prev.filter(id => id !== team.id));
                              }
                            }}
                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer mt-0.5 shrink-0"
                          />
                        )}
                        <div>
                          <h4 
                            onClick={async () => {
                              setSelectedTeamForDetail(team);
                              setDetailModalTab('rooms');
                            }}
                            className="font-bold text-slate-800 text-sm leading-tight hover:text-indigo-600 cursor-pointer transition flex items-center gap-1.5"
                            title="Bấm để xem chi tiết thống kê căn & defect"
                          >
                            <span>{team.name}</span>
                            <BarChart3 className="w-3.5 h-3.5 text-indigo-500 opacity-80" />
                          </h4>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
                            <User className="w-3.5 h-3.5 text-slate-300" />
                            <span>Đội trưởng: <strong className="text-slate-700">{team.leader}</strong></span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-slate-100 text-slate-700 border border-slate-200/80 px-2.5 py-1 rounded-lg text-center font-bold text-[11px] shrink-0">
                        Định biên: {team.defaultCount} thợ
                      </div>
                    </div>

                    {/* Quick Stat Pill Widgets */}
                    <div className="grid grid-cols-3 gap-2 my-2.5 pt-2 border-t border-slate-100 text-xs">
                      <div 
                        onClick={async () => {
                          setSelectedTeamForDetail(team);
                          setDetailModalTab('rooms');
                        }}
                        className="bg-indigo-50/70 border border-indigo-100 p-2 rounded-lg cursor-pointer hover:bg-indigo-100/70 transition text-center"
                        title="Xem các căn/phòng & khối lượng đội đang phụ trách"
                      >
                        <div className="text-[10px] text-indigo-500 font-bold uppercase tracking-wider">Căn / Phòng & khối lượng</div>
                        <div className="text-xs font-black text-indigo-700 flex flex-col items-center justify-center gap-0.5 mt-0.5">
                          <span className="flex items-center gap-1">
                            <Home className="w-3.5 h-3.5" />
                            {assignedRooms.length} căn
                          </span>
                          {categoryBreakdown && categoryBreakdown.length > 0 ? (
                            <div className="text-[9px] text-indigo-950 bg-indigo-100/50 px-1 py-0.5 rounded font-extrabold flex flex-col gap-0.5 mt-0.5 max-w-[120px] text-left truncate">
                              {categoryBreakdown.map(cb => (
                                <div key={cb.categoryName} className="truncate">
                                  {cb.categoryName}: {formatDecimal(cb.assignedVol)} {cb.unit}
                                </div>
                              ))}
                            </div>
                          ) : (
                            stat.volumeByUnit && Object.keys(stat.volumeByUnit).length > 0 ? (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {Object.entries(stat.volumeByUnit).map(([unit, val]) => (
                                  <span key={unit} className="text-[10px] text-indigo-900 bg-indigo-100/80 px-1.5 py-0.2 rounded font-extrabold">
                                    {formatDecimal(Number(val))} {unit}
                                  </span>
                                ))}
                              </div>
                            ) : null
                          )}
                        </div>
                      </div>

                      <div 
                        onClick={async () => {
                          setSelectedTeamForDetail(team);
                          setDetailModalTab('defects');
                        }}
                        className={`border p-2 rounded-lg cursor-pointer transition text-center ${
                          openDefectsCount > 0 
                            ? 'bg-rose-50/70 border-rose-200 hover:bg-rose-100/70' 
                            : 'bg-emerald-50/70 border-emerald-100 hover:bg-emerald-100/70'
                        }`}
                        title="Xem các defect/lỗi gán cho đội"
                      >
                        <div className={`text-[10px] font-bold uppercase tracking-wider ${openDefectsCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          Defect tồn đọng
                        </div>
                        <div className={`text-sm font-black flex items-center justify-center gap-1 mt-0.5 ${openDefectsCount > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>{openDefectsCount}</span>
                        </div>
                      </div>

                      <div 
                        onClick={async () => {
                          setSelectedTeamForDetail(team);
                          setDetailModalTab('logs');
                        }}
                        className="bg-slate-50 border border-slate-200 p-2 rounded-lg cursor-pointer hover:bg-slate-100 transition text-center"
                        title="Xem lịch sử ghi nhận quân số"
                      >
                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Tổng công đã làm</div>
                        <div className="text-sm font-black text-slate-700 flex items-center justify-center gap-1 mt-0.5">
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          <span>{formatDecimal(totalManDays)}</span>
                        </div>
                      </div>
                    </div>

                    {teamFloorNames.length > 0 && (
                      <div className="text-[11px] bg-slate-50 border border-slate-100 rounded-lg p-2 mt-2 flex items-center justify-between text-slate-600">
                        <span className="font-semibold flex items-center gap-1 text-slate-500 shrink-0">
                          <MapPin className="w-3 h-3 text-indigo-500" />
                          Tầng thi công ({teamFloorNames.length}):
                        </span>
                        <span className="font-bold text-indigo-900 truncate max-w-[200px] text-right">
                          {teamFloorNames.join(', ')}
                        </span>
                      </div>
                    )}

                    {teamWorkCategories.length > 0 && (
                      <div className="text-[11px] bg-indigo-50/20 border border-indigo-100/50 rounded-lg p-2 my-2 space-y-1 text-slate-600">
                        <span className="font-semibold flex items-center gap-1 text-indigo-700 shrink-0">
                          <Briefcase className="w-3 h-3 text-indigo-500" />
                          Hạng mục thi công ({teamWorkCategories.length}):
                        </span>
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {teamWorkCategories.map(cat => (
                            <span key={cat} className="bg-white border border-indigo-100/80 text-indigo-700 text-[10px] font-extrabold px-1.5 py-0.5 rounded-md">
                              🏗️ {cat}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5 text-xs text-slate-600">
                      {team.phone && (
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <span className="text-xs text-slate-600 flex items-center gap-1.5">
                            <span>SĐT:</span>
                            <span className="font-extrabold text-indigo-800">{team.phone}</span>
                            <ContactMenu
                              target={{ name: team.leader || team.name, phone: team.phone }}
                              context={{
                                type: 'crew',
                                projectId,
                                entityId: team.id,
                                shareText: `HNL QLTC – Liên hệ đội thi công\nĐội: ${team.name}\nĐội trưởng: ${team.leader || 'Chưa cập nhật'}\nSĐT: ${team.phone}`,
                              }}
                              triggerLabel="Liên hệ"
                            />
                          </span>
                        </div>
                      )}

                      {team.notes && (
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">Ghi chú: <span className="text-slate-600 italic">{team.notes}</span></span>
                        </div>
                      )}
                    </div>

                    {/* Primary Button to open statistics modal */}
                    <button
                      onClick={async () => {
                        setSelectedTeamForDetail(team);
                        setDetailModalTab('rooms');
                      }}
                      className="w-full mt-3 flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 px-3 rounded-xl transition text-xs shadow-xs active:scale-98"
                    >
                      <BarChart3 className="w-4 h-4 text-indigo-400" />
                      <span>Xem thống kê Căn / Phòng & Defect</span>
                    </button>

                    {/* Team edit / delete actions */}
                    {canManageTeamDirectory && <div className="flex items-center justify-end gap-3 mt-2.5 pt-2 border-t border-slate-100">
                      <button
                        onClick={async () => {
                          setEditingTeam(team);
                          setShowTeamModal(true);
                        }}
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 transition"
                        title="Sửa thông tin đội"
                      >
                        <Edit2 className="w-3.5 h-3.5" /> <span>Sửa</span>
                      </button>
                      <button
                        onClick={async () => {
                          setDeletingTeamTarget(team);
                        }}
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600 transition"
                        title="Xóa đội"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> <span className="text-rose-500 font-semibold">Xóa</span>
                      </button>
                    </div>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ========================================= MODALS ========================================= */}

      {/* Ghi nhận quân số Modal */}
      {canOperate && showAddLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div 
            className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center bg-slate-900 px-4 py-3 text-white">
              <h3 className="font-bold text-sm">
                {editingRecord ? '✍️ Sửa Ghi Nhận Quân Số' : '👷 Ghi Nhận Quân Số Mới'}
              </h3>
              <button 
                onClick={async () => {
                  if (!editingRecord && activeLogEntityId && projectId) {
                    try {
                      await deleteEntityPhotos(projectId, 'crewRecord', activeLogEntityId);
                    } catch (_) {}
                  }
                  setShowAddLogModal(false);
                  setEditingRecord(null);
                }}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleLogSubmit} className="p-4 space-y-3.5 overflow-y-auto max-h-[80vh]">
              {/* Date (Informative) */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Ngày Ghi Nhận</label>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-xs font-semibold text-slate-500">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <span>{formatDateDDMMYYYY(selectedDate)}</span>
                </div>
              </div>

              {/* Dynamic Team selection with Auto-fill */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Đội Thi Công</label>
                <div className="space-y-1.5">
                  <select
                    value={teams.some((t) => t.id === teamId) ? teams.find(t => t.id === teamId)?.name : (teams.some((t) => t.name === teamName) ? teamName : 'Khác')}
                    onChange={(e) => {
                      const selectedVal = e.target.value;
                      if (selectedVal === 'Khác') {
                        setTeamName('');
                        setTeamId('');
                      } else {
                        setTeamName(selectedVal);
                        // Auto-populate leaderName, workerCount, and teamId
                        const selectedTeam = teams.find((t) => t.name === selectedVal);
                        if (selectedTeam) {
                          setTeamId(selectedTeam.id || '');
                          setLeaderName(selectedTeam.leader);
                          setWorkerCount(selectedTeam.defaultCount);
                          setMorningCount(selectedTeam.defaultCount);
                          setAfternoonCount(selectedTeam.defaultCount);
                          setEveningCount(0);
                        } else {
                          setTeamId('');
                        }
                      }
                    }}
                    className="w-full text-xs bg-white border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-semibold"
                  >
                    {teams.map((t) => (
                      <option key={t.id} value={t.name}>{t.name} ({t.leader})</option>
                    ))}
                    <option value="Khác">-- Tự nhập tên đội khác --</option>
                  </select>

                  {(!teams.some((t) => t.id === teamId || t.name === teamName) || teamName === '') && (
                    <input 
                      type="text"
                      placeholder="Nhập tên đội thi công tùy chỉnh..."
                      value={teamName}
                      onChange={(e) => {
                        setTeamName(e.target.value);
                        setTeamId('');
                      }}
                      className="w-full text-xs bg-white border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 mt-1.5"
                      required
                    />
                  )}
                </div>
              </div>

              {/* Leader Name */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Trưởng Nhóm / Đội Trưởng</label>
                <input 
                  type="text"
                  placeholder="Ví dụ: Đội trưởng Hùng, Anh Cường..."
                  value={leaderName}
                  onChange={(e) => setLeaderName(e.target.value)}
                  className="w-full text-xs bg-white border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  required
                />
              </div>

              {/* Per-shift Worker Count */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Quân số theo ca</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['Sáng', morningCount, (v: number) => setShiftCount('Sáng', v)],
                    ['Chiều', afternoonCount, (v: number) => setShiftCount('Chiều', v)],
                    ['Tối', eveningCount, (v: number) => setShiftCount('Tối', v)],
                  ] as const).map(([label, value, setter]) => (
                    <div key={label}>
                      <div className="text-[10px] font-extrabold text-slate-500 mb-1">{label}</div>
                      <MathNumberInput
                        minValue={0}
                        placeholder="0"
                        value={value}
                        onValueChange={(val) => setter(Number(val || 0))}
                        className="w-full text-xs bg-white border border-slate-200 px-2 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold text-indigo-700"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 text-[10px] text-slate-400">Quân số ngày dùng giá trị lớn nhất giữa các ca: <strong>{formatDecimal(workerCount)}</strong> người.</div>
              </div>

              {/* Multi-floor & Multi-category Work Configuration */}
              <div className="space-y-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-indigo-600" />
                    Phân phối tầng, hạng mục & hạng mục con
                  </label>
                  <button
                    type="button"
                    onClick={addFloorWork}
                    className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded flex items-center gap-1 transition"
                  >
                    <Plus className="w-3 h-3" /> Thêm Tầng Làm Việc
                  </button>
                </div>

                {floorWorks.length === 0 ? (
                  <div className="text-center py-4 text-xs text-slate-400">
                    Chưa có tầng nào được thêm. Bấm "Thêm Tầng Làm Việc" để phân công.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {floorWorks.map((fw, fIdx) => (
                      <div key={fIdx} className="bg-white p-3 rounded-lg border border-slate-200 space-y-2.5 relative shadow-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-0.5">Tầng</label>
                            <select
                              value={fw.floorId}
                              onChange={(e) => updateFloorWorkFloor(fIdx, e.target.value)}
                              className="w-full text-xs bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            >
                              {floorPlans.map(fp => (
                                <option key={fp.id} value={fp.id}>{fp.floorName}</option>
                              ))}
                            </select>
                          </div>
                          {floorWorks.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeFloorWork(fIdx)}
                              className="text-slate-400 hover:text-rose-600 p-1 rounded transition mt-4"
                              title="Xoá tầng này"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        {/* Categories on this floor */}
                        <div className="space-y-2 pt-1 border-t border-slate-100">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-slate-600">Hạng mục thi công trên tầng này:</span>
                            <button
                              type="button"
                              onClick={() => addCategoryToFloor(fIdx)}
                              className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-0.5"
                            >
                              <Plus className="w-3 h-3" /> Thêm hạng mục
                            </button>
                          </div>

                          {fw.categories.map((cat, cIdx) => (
                            <div key={cIdx} className="bg-slate-50 p-2 rounded border border-slate-200 space-y-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  placeholder="Tên hạng mục (VD: Trần thạch cao, Vách ngăn...)"
                                  value={cat.categoryName}
                                  onChange={(e) => updateCategoryName(fIdx, cIdx, e.target.value)}
                                  className="flex-1 text-xs bg-white border border-slate-200 px-2 py-1 rounded font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                />
                                {fw.categories.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeCategoryFromFloor(fIdx, cIdx)}
                                    className="text-slate-400 hover:text-rose-600 p-1"
                                    title="Xoá hạng mục"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>

                              {/* Sub-items / Hạng mục phụ */}
                              <div className="pl-2 space-y-1">
                                <div className="text-[10px] text-slate-500 font-semibold">Hạng mục phụ / Công đoạn:</div>
                                <div className="flex flex-wrap gap-1 items-center">
                                  {cat.subItems.map((sub, sIdx) => (
                                    <span key={sIdx} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-[10px] px-2 py-0.5 rounded-full font-medium">
                                      {sub}
                                      <button
                                        type="button"
                                        onClick={() => removeSubItemFromCategory(fIdx, cIdx, sIdx)}
                                        className="hover:text-rose-600"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </span>
                                  ))}
                                  <div className="flex items-center gap-1">
                                    <input
                                      id={`sub-input-${fIdx}-${cIdx}`}
                                      type="text"
                                      placeholder="+ Thêm hạng mục phụ (Enter)..."
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          addSubItemToCategory(fIdx, cIdx, (e.target as HTMLInputElement).value);
                                          (e.target as HTMLInputElement).value = '';
                                        }
                                      }}
                                      className="text-[10px] bg-white border border-slate-200 px-2 py-0.5 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 w-36"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const inputEl = document.getElementById(`sub-input-${fIdx}-${cIdx}`) as HTMLInputElement;
                                        if (inputEl && inputEl.value.trim()) {
                                          addSubItemToCategory(fIdx, cIdx, inputEl.value);
                                          inputEl.value = '';
                                        }
                                      }}
                                      className="bg-indigo-600 hover:bg-indigo-700 text-white rounded px-2 py-0.5 text-[10px] font-bold shrink-0 transition"
                                    >
                                      Thêm
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Ghi chú */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Ghi chú thêm (tùy chọn)</label>
                <textarea 
                  placeholder="Ví dụ: Đã nhận đủ vật tư, tăng ca hoàn thành trần phòng A102..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full text-xs bg-white border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 h-16 resize-none"
                />
              </div>

              {/* Hình ảnh đính kèm */}
              <div className="pt-1">
                <PhotoAttachmentPicker
                  projectId={projectId}
                  entityType="crewRecord"
                  entityId={activeLogEntityId}
                  category="crew_progress"
                  label="HÌNH ẢNH HIỆN TRƯỜNG"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!editingRecord && activeLogEntityId && projectId) {
                      try {
                        await deleteEntityPhotos(projectId, 'crewRecord', activeLogEntityId);
                      } catch (_) {}
                    }
                    setShowAddLogModal(false);
                    setEditingRecord(null);
                  }}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 px-4 rounded-lg text-xs transition"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-lg text-xs transition"
                >
                  {editingRecord ? 'Lưu thay đổi' : 'Ghi nhận'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Thêm / Sửa thông tin Đội thi công Modal */}
      {canManageTeamDirectory && showTeamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div 
            className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center bg-slate-900 px-4 py-3 text-white">
              <h3 className="font-bold text-sm">
                {editingTeam ? '✍️ Sửa Thông Tin Đội' : '👥 Thêm Đội Thi Công Mới'}
              </h3>
              <button 
                onClick={async () => {
                  setShowTeamModal(false);
                  setEditingTeam(null);
                }}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleTeamSubmit} className="p-4 space-y-3.5">
              {/* Team Name */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Tên Đội Thi Công</label>
                <input 
                  type="text"
                  placeholder="Ví dụ: Đội Thạch Cao Hà Nội..."
                  value={tName}
                  onChange={(e) => setTName(e.target.value)}
                  className="w-full text-xs bg-white border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  required
                />
              </div>

              {/* Leader Name */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Trưởng Nhóm / Đội Trưởng</label>
                <input 
                  type="text"
                  placeholder="Ví dụ: Đội trưởng Hùng, Anh Tiến..."
                  value={tLeader}
                  onChange={(e) => setTLeader(e.target.value)}
                  className="w-full text-xs bg-white border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  required
                />
              </div>

              {/* Default worker count */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Quân số định biên</label>
                <MathNumberInput
                  minValue={0.01}
                  value={tCount}
                  onValueChange={(val) => setTCount(Number(val || 0))}
                  placeholder="Ví dụ: 10+2"
                  className="w-full text-xs bg-white border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold"
                  required
                />
              </div>

              {/* Phone number */}
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider truncate">Số Điện Thoại Liên Hệ</label>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={handlePickContact}
                      className="text-[10px] text-indigo-700 font-bold bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 px-2 py-0.5 rounded-md flex items-center gap-0.5 active:scale-95 transition-all cursor-pointer shadow-2xs"
                      title="Chèn từ danh bạ điện thoại thiết bị"
                    >
                      <span>📱 Danh bạ</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePasteClipboard}
                      className="text-[10px] text-emerald-700 font-bold bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 px-2 py-0.5 rounded-md flex items-center gap-0.5 active:scale-95 transition-all cursor-pointer shadow-2xs"
                      title="Dán nhanh số điện thoại từ bộ nhớ tạm Clipboard"
                    >
                      <span>📋 Dán</span>
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <input 
                    type="tel"
                    autoComplete="tel"
                    placeholder="Ví dụ: 0912345678"
                    value={tPhone}
                    onChange={(e) => setTPhone(e.target.value)}
                    className="w-full text-xs bg-white border border-slate-200 pl-3 pr-9 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold text-indigo-900"
                  />
                  {tPhone && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      <ContactMenu
                        target={{ name: tLeader || tName || 'Đội thi công', phone: tPhone }}
                        context={{ type: 'crew', projectId, shareText: `HNL QLTC – Liên hệ đội thi công\nĐội: ${tName || 'Chưa đặt tên'}\nĐội trưởng: ${tLeader || 'Chưa cập nhật'}\nSĐT: ${tPhone}` }}
                        triggerLabel=""
                        triggerClassName="inline-flex items-center justify-center rounded-md bg-emerald-50 p-1 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 active:scale-95 transition-all"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Mô tả / Ghi chú</label>
                <textarea 
                  placeholder="Ví dụ: Đội chuyên thạch cao trần giật cấp, khoán khối lượng..."
                  value={tNotes}
                  onChange={(e) => setTNotes(e.target.value)}
                  className="w-full text-xs bg-white border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 h-16 resize-none"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    setShowTeamModal(false);
                    setEditingTeam(null);
                  }}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 px-4 rounded-lg text-xs transition"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-lg text-xs transition"
                >
                  {editingTeam ? 'Lưu thay đổi' : 'Thêm mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE DAILY LOG RECORD MODAL */}
      {deletingRecordTarget && canDeleteRecord(deletingRecordTarget) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 text-center">
              <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-3 border border-rose-100">
                <AlertTriangle className="w-6 h-6 text-rose-500" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">Xác nhận xóa nhật ký</h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-4">
                Bạn có chắc chắn muốn xóa bản ghi quân số của <strong className="text-slate-800">{deletingRecordTarget.teamName}</strong> tại <strong className="text-indigo-600">{deletingRecordTarget.floorName}</strong> không? Nếu Thùng rác đang bật, bản ghi có thể được ADMIN khôi phục trong thời hạn lưu.
              </p>
              <div className="flex gap-2.5">
                <button
                  onClick={() => setDeletingRecordTarget(null)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 px-4 rounded-lg text-xs transition"
                >
                  Quay lại
                </button>
                <button
                  onClick={executeDeleteRecord}
                  className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2 px-4 rounded-lg text-xs transition"
                >
                  Xác nhận xóa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE TEAM FROM DIRECTORY MODAL */}
      {canManageTeamDirectory && deletingTeamTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 text-center">
              <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-3 border border-rose-100">
                <AlertTriangle className="w-6 h-6 text-rose-500" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">Xóa Danh Mục Đội</h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-4">
                Bạn có chắc muốn xóa <strong className="text-slate-800">{deletingTeamTarget.name}</strong> khỏi danh bạ không? Ghi nhận quân số hằng ngày trong lịch sử vẫn được giữ nguyên.
              </p>
              <div className="flex gap-2.5">
                <button
                  onClick={() => setDeletingTeamTarget(null)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 px-4 rounded-lg text-xs transition"
                >
                  Quay lại
                </button>
                <button
                  onClick={executeDeleteTeam}
                  className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2 px-4 rounded-lg text-xs transition"
                >
                  Xác nhận xóa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM OVERWRITE COPY MODAL */}
      {canOperate && showCopyConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 text-center">
              <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3 border border-amber-100">
                <Copy className="w-5 h-5 text-amber-500" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">Trùng bản ghi nhật ký</h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-4">
                Ngày <strong className="text-slate-800">{formatDateDDMMYYYY(selectedDate)}</strong> hiện đang có {filteredRecords.length} ghi nhận quân số. Bạn có muốn sao chép đè/thêm dữ liệu của ngày nguồn ({formatDateDDMMYYYY(copySourceDate)}) sang hôm nay không?
              </p>
              <div className="flex gap-2.5">
                <button
                  onClick={() => setShowCopyConfirm(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 px-4 rounded-lg text-xs transition"
                >
                  Hủy bỏ
                </button>
                <button
                  onClick={confirmCopy}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg text-xs transition"
                >
                  Sao chép đè
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TEAM DETAIL & STATISTICS MODAL */}
      {selectedTeamForDetail && (() => {
        const team = selectedTeamForDetail;
        const stat = allTeamStatsMap[team.id];
        if (!stat) return null;

        const {
          teamRooms,
          totalTeamVol: totalTeamVolume,
          completedFrameVol,
          completedBoardVol,
          inspectedVol,
          floorGroupMap,
          totalMandays: totalWorkdays,
          categoryBreakdown
        } = stat;
        
        const teamDefects = (defects || []).filter(d => !d.archivedAt && isTeamMatch(d.assignedTo, team, d.teamId));
        const teamLogs = (crewRecords || []).filter(l => isTeamMatch(l.teamName, team, l.teamId));
        
        const openDefectsList = teamDefects.filter(d => d.status === 'Mới phát hiện' || d.status === 'Đang sửa');
        const resolvedDefectsList = teamDefects.filter(d => d.status === 'Đã khắc phục' || d.status === 'Đã nghiệm thu');
        const completedRooms = teamRooms.filter(r => isTeamWorkCompletedInRoom(r, team));

        const floorStatList: FloorGroupDetail[] = (Object.values(floorGroupMap) as FloorGroupDetail[])
          .map(floorGroup => ({
            ...floorGroup,
            rooms: [...floorGroup.rooms].sort((a, b) =>
              naturalCompare(a.roomName, b.roomName)
            )
          }))
          .sort((a, b) => {
            const comparison = compareFloorValues(
              { floorId: a.rooms[0]?.floorId, floorName: a.floorName },
              { floorId: b.rooms[0]?.floorId, floorName: b.floorName }
            );
            return applySortOrder(comparison, teamFloorSortOrder);
          });

        const teamWorkCategories = categoryBreakdown.map(cb => cb.categoryName);

        // Filter defects by tab state
        const unsortedDisplayedDefects = teamDefects.filter(d => {
          if (defectFilter === 'open') return d.status === 'Mới phát hiện' || d.status === 'Đang sửa';
          if (defectFilter === 'resolved') return d.status === 'Đã khắc phục' || d.status === 'Đã nghiệm thu';
          return true;
        });

        const displayedDefects = [...unsortedDisplayedDefects].sort((a, b) =>
        {
          const floorComparison = applySortOrder(
            compareFloorValues(
              { floorId: a.floorId, floorName: a.floorName },
              { floorId: b.floorId, floorName: b.floorName }
            ),
            teamDefectFloorSortOrder
          );
          if (floorComparison !== 0) return floorComparison;

          const roomComparison = naturalCompare(
            getDefectRoomSortLabel(a, roomProgressList),
            getDefectRoomSortLabel(b, roomProgressList)
          );
          if (roomComparison !== 0) return roomComparison;

          const dateComparison = compareDateValues(a.createdAt, b.createdAt);
          if (dateComparison !== 0) return dateComparison;
          return naturalCompare(a.id, b.id);
        });

        const displayedTeamLogs = [...teamLogs].sort((a, b) => {
          const floorComparison = compareFloorValues(
            getCrewLogPrimaryFloor(a, floorPlans),
            getCrewLogPrimaryFloor(b, floorPlans)
          );

          if (teamLogSortMode === 'floor') {
            const orderedFloorComparison = applySortOrder(floorComparison, teamLogFloorSortOrder);
            if (orderedFloorComparison !== 0) return orderedFloorComparison;

            const newestFirstComparison = applySortOrder(compareDateValues(a.date, b.date), 'desc');
            if (newestFirstComparison !== 0) return newestFirstComparison;
          } else {
            const orderedDateComparison = applySortOrder(compareDateValues(a.date, b.date), teamLogDateSortOrder);
            if (orderedDateComparison !== 0) return orderedDateComparison;

            if (floorComparison !== 0) return floorComparison;
          }

          return naturalCompare(a.id, b.id);
        });

        // Collect unique floors where this team worked from daily logs
        const loggedFloors = Array.from(new Set(teamLogs.map(l => l.floorName).filter(Boolean)));

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center px-2 sm:p-4 bg-slate-900/70 backdrop-blur-md"
            style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))', paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
          >
            <div 
              className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-1rem)] sm:max-h-[92vh] border border-slate-200 animate-in fade-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="bg-slate-900 p-3 sm:p-4 text-white flex justify-between items-start gap-3 border-b border-slate-800">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 pr-1">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase tracking-wider">
                      Thống kê Căn / Phòng & Defect
                    </span>
                    <span className="text-xs text-slate-400">Định biên: {team.defaultCount} thợ</span>
                  </div>
                  <h2 className="text-lg font-black text-white mt-1 leading-tight">{team.name}</h2>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300 mt-1.5">
                    <span className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-indigo-400" />
                      Đội trưởng: <strong className="text-white">{team.leader}</strong>
                    </span>
                    {team.phone && (
                      <span className="flex items-center gap-1.5">
                        <span className="text-slate-300">SĐT:</span>
                        <span className="font-extrabold text-emerald-300">{team.phone}</span>
                        <ContactMenu
                          target={{ name: team.leader || team.name, phone: team.phone }}
                          context={{
                            type: 'crew',
                            projectId,
                            entityId: team.id,
                            shareText: `HNL QLTC – Liên hệ đội thi công\nĐội: ${team.name}\nĐội trưởng: ${team.leader || 'Chưa cập nhật'}\nSĐT: ${team.phone}`,
                          }}
                          triggerLabel="Liên hệ"
                          triggerClassName="inline-flex items-center gap-1 rounded-md border border-emerald-700/80 bg-emerald-950/80 px-2 py-0.5 text-[10px] font-extrabold text-emerald-300 hover:text-white active:scale-95 transition-all"
                        />
                      </span>
                    )}
                  </div>

                  {teamWorkCategories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-slate-800">
                      {teamWorkCategories.map(cat => (
                        <span key={cat} className="bg-slate-800 border border-slate-700/80 text-indigo-200 text-[10px] font-extrabold px-2 py-0.5 rounded-md">
                          🏗️ {cat}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <button 
                  onClick={() => setSelectedTeamForDetail(null)}
                  className="text-slate-400 hover:text-white transition bg-slate-800 hover:bg-slate-700 p-2 rounded-xl shrink-0"
                  title="Đóng"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* KPI Summary Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-white border-b border-slate-200 text-xs">
                <div className="bg-indigo-50/80 border border-indigo-100 p-2 rounded-xl text-center">
                  <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">Căn / Phòng & Tầng</div>
                  <div className="text-sm sm:text-base font-black text-indigo-900 mt-0.5 flex items-center justify-center gap-1">
                    <Home className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span>{teamRooms.length} Căn / Phòng ({floorStatList.length} tầng)</span>
                  </div>
                  <div className="text-[10px] text-indigo-600 mt-0.5 font-medium">
                    {completedRooms.length}/{teamRooms.length} Căn / Phòng nghiệm thu
                  </div>
                </div>

                <div className="bg-emerald-50/80 border border-emerald-100 p-2 rounded-xl text-center">
                  <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Khối lượng thi công</div>
                  <div className="text-sm sm:text-base font-black text-emerald-900 mt-0.5 flex items-center justify-center gap-1 min-w-0">
                    <BarChart3 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="min-w-0 break-words leading-snug">
                      {stat.volumeByUnit && Object.keys(stat.volumeByUnit).length > 0
                        ? Object.entries(stat.volumeByUnit).map(([unit, val]) => `${formatDecimal(Number(val))} ${unit}`).join(' + ')
                        : (totalTeamVolume > 0 ? `${formatDecimal(totalTeamVolume)} m²` : 'Chưa nhập')}
                    </span>
                  </div>
                  <div className="text-[10px] text-emerald-700 mt-0.5 font-semibold break-words leading-snug">
                    {stat.completedVolumeByUnit && Object.keys(stat.completedVolumeByUnit).length > 0
                      ? `NT: ${Object.entries(stat.completedVolumeByUnit).map(([unit, val]) => `${formatDecimal(Number(val))} ${unit}`).join(' + ')}`
                      : (inspectedVol > 0 ? `NT: ${formatDecimal(inspectedVol)} m²` : `Khung: ${formatDecimal(completedFrameVol)} m² | Tấm: ${formatDecimal(completedBoardVol)} m²`)}
                  </div>
                </div>

                <div className={`border p-2 rounded-xl text-center ${
                  openDefectsList.length > 0 ? 'bg-rose-50/80 border-rose-200' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className={`text-[10px] font-bold uppercase tracking-wider ${
                    openDefectsList.length > 0 ? 'text-rose-600' : 'text-slate-500'
                  }`}>
                    Defect tồn đọng
                  </div>
                  <div className={`text-sm sm:text-base font-black mt-0.5 flex items-center justify-center gap-1 ${
                    openDefectsList.length > 0 ? 'text-rose-900' : 'text-slate-800'
                  }`}>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{openDefectsList.length} lỗi</span>
                  </div>
                  <div className={`text-[10px] mt-0.5 font-medium ${
                    openDefectsList.length > 0 ? 'text-rose-700' : 'text-slate-500'
                  }`}>
                    {teamDefects.length} tổng defect
                  </div>
                </div>

                <div className="bg-slate-100/80 border border-slate-200 p-2 rounded-xl text-center">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tổng công đã làm</div>
                  <div className="text-sm sm:text-base font-black text-slate-800 mt-0.5 flex items-center justify-center gap-1">
                    <Users className="w-3.5 h-3.5 text-slate-600" />
                    <span>{formatDecimal(totalWorkdays)} công</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 font-medium">
                    {teamLogs.length} lượt nhật ký
                  </div>
                </div>
              </div>

              {/* Modal Tabs */}
              <div className="flex border-b border-slate-200 bg-white px-3 pt-2 gap-1 overflow-x-auto shrink-0">
                <button
                  onClick={() => setDetailModalTab('rooms')}
                  className={`flex items-center gap-1.5 py-2 px-3 text-xs font-bold border-b-2 transition whitespace-nowrap ${
                    detailModalTab === 'rooms'
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Home className="w-3.5 h-3.5" />
                  <span>Căn / Phòng đang làm ({teamRooms.length})</span>
                </button>

                <button
                  onClick={() => setDetailModalTab('defects')}
                  className={`flex items-center gap-1.5 py-2 px-3 text-xs font-bold border-b-2 transition whitespace-nowrap ${
                    detailModalTab === 'defects'
                      ? 'border-rose-600 text-rose-700'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Danh sách Defect ({teamDefects.length})</span>
                  {openDefectsList.length > 0 && (
                    <span className="bg-rose-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full">
                      {openDefectsList.length}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setDetailModalTab('logs')}
                  className={`flex items-center gap-1.5 py-2 px-3 text-xs font-bold border-b-2 transition whitespace-nowrap ${
                    detailModalTab === 'logs'
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Clipboard className="w-3.5 h-3.5" />
                  <span>Lịch sử nhật ký ({teamLogs.length})</span>
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-4 overflow-y-auto flex-1 space-y-3">
                {/* SUB TAB 1: ROOMS / APARTMENTS */}
                {detailModalTab === 'rooms' && (
                  <div>
                    {teamRooms.length === 0 ? (
                      <div className="bg-white border border-dashed border-slate-300 rounded-xl p-6 text-center">
                        <Home className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <h4 className="text-xs font-bold text-slate-700">Đội chưa được gán trực tiếp cho căn / phòng cụ thể nào</h4>
                        <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
                          Để gán đội thi công cho từng Căn / Phòng, bạn hãy vào tab <strong className="text-slate-700">"Mặt bằng"</strong>, chọn vùng Căn / Phòng cần giao và chọn đội <strong className="text-indigo-600">{team.name}</strong>.
                        </p>
                        
                        {loggedFloors.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-slate-100 text-left bg-indigo-50/50 p-3 rounded-lg">
                            <span className="text-[11px] font-bold text-indigo-900 block mb-1">
                              📍 Tầng đội đã từng ghi nhận thi công (theo nhật ký):
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {loggedFloors.map(floor => (
                                <span key={floor} className="bg-white border border-indigo-200 text-indigo-800 text-[11px] font-medium px-2 py-0.5 rounded-md">
                                  {floor}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-xs text-slate-500 font-medium px-1 mb-2">
                          <span>Thống kê chi tiết theo tầng đang thi công</span>
                          <div className="flex items-center gap-2 flex-wrap">
                            <QuickSortBar
                              itemCount={floorStatList.length}
                              options={[{ key: 'floor', label: 'Tầng', kind: 'floor' }]}
                              activeKey="floor"
                              order={teamFloorSortOrder}
                              onChange={(_key, order) => setTeamFloorSortOrder(order)}
                              onToggleOrder={() => setTeamFloorSortOrder((order) => order === 'asc' ? 'desc' : 'asc')}
                              onReset={() => setTeamFloorSortOrder('asc')}
                              summary={`${floorStatList.length} tầng · ${teamRooms.length} Căn / Phòng`}
                            />
                          </div>
                        </div>

                        <div className="space-y-4">
                          {floorStatList.map((f) => {
                            return (
                              <div key={f.floorName} className="bg-slate-50/70 border border-slate-200/60 rounded-xl p-3.5 space-y-3">
                                {/* Floor Header Group */}
                                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 pb-2.5 border-b border-slate-200/60">
                                  <div className="flex items-center gap-1.5 font-bold text-slate-800 text-xs sm:text-sm uppercase tracking-wider">
                                    <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                    <span>{f.floorName}</span>
                                  </div>
                                  <div className="flex gap-1.5 text-[10px] font-semibold flex-wrap w-full sm:w-auto sm:justify-end">
                                    <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200/40">
                                      {f.rooms.length} Căn / Phòng
                                    </span>
                                    <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-100">
                                      {f.categoryDetails && Object.keys(f.categoryDetails).length > 0
                                        ? (() => {
                                            const byUnit: Record<string, number> = {};
                                            Object.values(f.categoryDetails).forEach((d) => {
                                              const unit = d.unit || 'm²';
                                              byUnit[unit] = (byUnit[unit] || 0) + Number(d.totalVol || 0);
                                            });
                                            return Object.entries(byUnit).map(([unit, value]) => `${formatDecimal(value)} ${unit}`).join(' + ');
                                          })()
                                        : `${formatDecimal(f.totalVol)} m²`}
                                    </span>
                                  </div>
                                </div>

                                {/* Rooms list inside this floor */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  {f.rooms.map((room) => {
                                    const roomStats = (() => {
                                      let totalVol = 0;
                                      let doneFrameVol = 0;
                                      let doneBoardVol = 0;
                                      let doneInspectedVol = 0;

                                      const isMain = isTeamMatch(room.assignedTeam, team, room.teamId);
                                      const teamCats = getTeamCategoriesForRoom(room, team);

                                      const categoriesDetailList: {
                                        name: string;
                                        vol: number;
                                        frameVol: number;
                                        boardVol: number;
                                        inspectedVol: number;
                                        frameStatus: AcceptanceStatus;
                                        boardStatus: AcceptanceStatus;
                                        inspectionStatus: RoomInspectionResult;
                                        subItems?: typeof room.subItems;
                                      }[] = [];

                                      if (teamCats.size > 0) {
                                        teamCats.forEach((cat) => {
                                          const catTotalVol = room.categoryVolumes?.[cat] ?? ((room.workCategory === cat || teamCats.size === 1) ? Number(room.workVolume || 0) : 0);
                                          const allSubItemsInCat = room.subItems?.filter((s) => (s.category || room.workCategory) === cat) || [];
                                          const subItemsInCat = allSubItemsInCat.filter((s) =>
                                            isTeamMatch(s.assignedTeam, team, s.teamId) || (!s.assignedTeam && !s.teamId && isMain)
                                          );

                                          let catVol = isMain ? catTotalVol : 0;
                                          if (allSubItemsInCat.length > 0) {
                                            const totalWeight = allSubItemsInCat.reduce((sum, sub) => sum + getSubItemGroupWeight(allSubItemsInCat, sub), 0);
                                            const teamWeight = subItemsInCat.reduce((sum, sub) => sum + getSubItemGroupWeight(allSubItemsInCat, sub), 0);
                                            catVol = totalWeight > 0 ? catTotalVol * (teamWeight / totalWeight) : 0;
                                          }
                                          totalVol += catVol;

                                          let catFrameVol = 0;
                                          let catBoardVol = 0;
                                          let catInspectedVol = 0;
                                          let catFrameStatus: AcceptanceStatus = 'Chưa làm';
                                          let catBoardStatus: AcceptanceStatus = 'Chưa làm';
                                          let catInspectionStatus: RoomInspectionResult = 'Chưa nghiệm thu';

                                          if (allSubItemsInCat.length > 0 && subItemsInCat.length > 0) {
                                            const allWeight = allSubItemsInCat.reduce((sum, sub) => sum + getSubItemGroupWeight(allSubItemsInCat, sub), 0);
                                            const inspectedWeight = subItemsInCat
                                              .filter((sub) => sub.inspectionStatus === 'Đạt nghiệm thu')
                                              .reduce((sum, sub) => sum + getSubItemGroupWeight(allSubItemsInCat, sub), 0);
                                            catInspectedVol = allWeight > 0 ? catTotalVol * (inspectedWeight / allWeight) : 0;

                                            const frameSubs = subItemsInCat.filter((sub) => sub.name.toLocaleLowerCase('vi').includes('khung'));
                                            const boardSubs = subItemsInCat.filter((sub) => sub.name.toLocaleLowerCase('vi').includes('tấm') || sub.name.toLocaleLowerCase('vi').includes('bắn'));
                                            const doneFrameCount = frameSubs.filter((sub) => sub.status === 'Đã hoàn thành' || sub.inspectionStatus === 'Đạt nghiệm thu').length;
                                            const doneBoardCount = boardSubs.filter((sub) => sub.status === 'Đã hoàn thành' || sub.inspectionStatus === 'Đạt nghiệm thu').length;
                                            catFrameVol = catVol * (frameSubs.length > 0 ? doneFrameCount / frameSubs.length : 0);
                                            catBoardVol = catVol * (boardSubs.length > 0 ? doneBoardCount / boardSubs.length : 0);
                                            catFrameStatus = frameSubs.length > 0 ? (doneFrameCount === frameSubs.length ? 'Đã hoàn thành' : doneFrameCount > 0 ? 'Đang làm' : 'Chưa làm') : room.frameStatus;
                                            catBoardStatus = boardSubs.length > 0 ? (doneBoardCount === boardSubs.length ? 'Đã hoàn thành' : doneBoardCount > 0 ? 'Đang làm' : 'Chưa làm') : room.boardStatus;
                                            if (subItemsInCat.every((sub) => sub.inspectionStatus === 'Đạt nghiệm thu')) catInspectionStatus = 'Đạt nghiệm thu';
                                            else if (subItemsInCat.some((sub) => sub.inspectionStatus === 'Chưa đạt (Cần sửa)')) catInspectionStatus = 'Chưa đạt (Cần sửa)';
                                          } else if (isMain) {
                                            catInspectedVol = room.inspectionStatus === 'Đạt nghiệm thu' ? catVol : 0;
                                            catFrameVol = room.frameStatus === 'Đã hoàn thành' ? catVol : room.frameStatus === 'Đang làm' ? catVol * 0.5 : 0;
                                            catBoardVol = room.boardStatus === 'Đã hoàn thành' ? catVol : room.boardStatus === 'Đang làm' ? catVol * 0.5 : 0;
                                            catFrameStatus = room.frameStatus;
                                            catBoardStatus = room.boardStatus;
                                            catInspectionStatus = room.inspectionStatus;
                                          }

                                          doneFrameVol += catFrameVol;
                                          doneBoardVol += catBoardVol;
                                          doneInspectedVol += catInspectedVol;
                                          categoriesDetailList.push({
                                            name: cat,
                                            vol: catVol,
                                            frameVol: catFrameVol,
                                            boardVol: catBoardVol,
                                            inspectedVol: catInspectedVol,
                                            frameStatus: catFrameStatus,
                                            boardStatus: catBoardStatus,
                                            inspectionStatus: catInspectionStatus,
                                            subItems: subItemsInCat
                                          });
                                        });
                                      } else if (isMain) {
                                        totalVol = Number(room.workVolume || 0);
                                        doneFrameVol = room.frameStatus === 'Đã hoàn thành' ? totalVol : room.frameStatus === 'Đang làm' ? totalVol * 0.5 : 0;
                                        doneBoardVol = room.boardStatus === 'Đã hoàn thành' ? totalVol : room.boardStatus === 'Đang làm' ? totalVol * 0.5 : 0;
                                        doneInspectedVol = room.inspectionStatus === 'Đạt nghiệm thu' ? totalVol : 0;
                                        categoriesDetailList.push({
                                          name: room.workCategory || 'Hạng mục khác',
                                          vol: totalVol,
                                          frameVol: doneFrameVol,
                                          boardVol: doneBoardVol,
                                          inspectedVol: doneInspectedVol,
                                          frameStatus: room.frameStatus,
                                          boardStatus: room.boardStatus,
                                          inspectionStatus: room.inspectionStatus,
                                          subItems: room.subItems
                                        });
                                      }

                                      return {
                                        totalVol: Math.round(totalVol * 100) / 100,
                                        doneFrameVol: Math.round(doneFrameVol * 100) / 100,
                                        doneBoardVol: Math.round(doneBoardVol * 100) / 100,
                                        doneInspectedVol: Math.round(doneInspectedVol * 100) / 100,
                                        categories: categoriesDetailList
                                      };
                                    })();

                                    return (
                                      <div 
                                        key={room.id}
                                        className="bg-white border border-slate-200/80 rounded-lg p-3 hover:border-indigo-200 transition flex flex-col justify-between shadow-xs"
                                      >
                                        <div>
                                          {/* Room Title */}
                                          <div className="flex justify-between items-start gap-2 mb-2.5">
                                            <div>
                                              <h4 className="font-semibold text-slate-900 text-xs sm:text-sm leading-tight flex items-center gap-1.5 flex-wrap">
                                                <Home className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                                <span>{room.roomName}</span>
                                                <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                                  Tổng KL: {formatDecimal(roomStats.totalVol)} {room.volumeUnit || 'm²'}
                                                </span>
                                              </h4>
                                            </div>

                                            {/* Room Acceptance Status */}
                                            <span className={`text-[9.5px] font-bold tracking-wide uppercase px-2 py-0.5 rounded shrink-0 ${
                                              room.inspectionStatus === 'Đạt nghiệm thu'
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                                                : room.inspectionStatus === 'Chưa đạt (Cần sửa)'
                                                ? 'bg-rose-50 text-rose-700 border border-rose-200/50'
                                                : 'bg-slate-50 text-slate-500 border border-slate-200/40'
                                            }`}>
                                              {room.inspectionStatus}
                                            </span>
                                          </div>

                                          {/* Detailed Main Categories list in this apartment */}
                                          <div className="space-y-3 mt-2.5 pt-2.5 border-t border-slate-100">
                                            {roomStats.categories.map((c, idx) => {
                                              return (
                                                <div key={idx} className="pb-3 last:pb-0 border-b last:border-0 border-slate-100 space-y-1.5">
                                                  {/* Category Title Header */}
                                                  <div className="flex justify-between items-center text-[11px] font-bold text-slate-800">
                                                    <span className="truncate max-w-[150px] font-semibold text-slate-700 flex items-center gap-1.5">
                                                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>
                                                      {c.name}
                                                    </span>
                                                    <span className="bg-slate-50 text-slate-600 text-[10px] px-1.5 py-0.5 rounded font-medium border border-slate-200/40">
                                                      {formatDecimal(c.vol)} {room.volumeUnit || 'm²'}
                                                    </span>
                                                  </div>

                                                  <div className="space-y-1.5 text-[10px]">
                                                    {/* Sub-items list with clean flat layout */}
                                                    {c.subItems && c.subItems.length > 0 && (
                                                      <div className="mt-1.5 pl-3.5 border-l border-slate-200 space-y-1.5">
                                                        <div className="text-[9.5px] font-medium text-slate-400 flex items-center gap-1">
                                                          <span>Hạng mục con:</span>
                                                        </div>
                                                        <div className="grid grid-cols-1 gap-1 text-[10px] text-slate-600 max-h-[140px] overflow-y-auto">
                                                          {c.subItems.map((sub, sIdx) => {
                                                            const hasStarted = sub.status && sub.status !== 'Chưa làm';
                                                            const isDone = sub.status === 'Đã hoàn thành';
                                                            const isApproved = sub.inspectionStatus === 'Đạt nghiệm thu';

                                                            let statusTextStr = "Chưa làm";
                                                            let statusColorStr = "bg-slate-50 text-slate-400 border border-slate-100";
                                                            if (isDone) {
                                                              statusTextStr = "Đã xong";
                                                              statusColorStr = "bg-emerald-50 text-emerald-700 border border-emerald-100 font-medium";
                                                            } else if (hasStarted) {
                                                              statusTextStr = "Đang làm";
                                                              statusColorStr = "bg-amber-50 text-amber-700 border border-amber-100 font-medium";
                                                            }

                                                            let inspectionTextStr = "Chưa NT";
                                                            let inspectionColorStr = "bg-slate-50 text-slate-400 border border-slate-100";
                                                            if (isApproved) {
                                                              inspectionTextStr = "Đạt NT";
                                                              inspectionColorStr = "bg-emerald-500 text-white font-bold";
                                                            } else if (sub.inspectionStatus === 'Chưa đạt (Cần sửa)') {
                                                              inspectionTextStr = "Chưa đạt (Sửa)";
                                                              inspectionColorStr = "bg-rose-500 text-white font-bold";
                                                            }

                                                            return (
                                                              <div key={sIdx} className="flex justify-between items-center py-0.5 border-b border-dashed border-slate-100/60 last:border-0 hover:bg-slate-50/50 transition">
                                                                <span className="truncate max-w-[130px] font-medium">• {sub.name}</span>
                                                                <div className="flex items-center gap-1">
                                                                  <span className={`px-1.5 py-0.2 rounded text-[8px] ${statusColorStr}`}>{statusTextStr}</span>
                                                                  <span className={`px-1.5 py-0.2 rounded text-[8px] ${inspectionColorStr}`}>{inspectionTextStr}</span>
                                                                </div>
                                                              </div>
                                                            );
                                                          })}
                                                        </div>
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>

                                        {/* Dates and Notes */}
                                        {(room.targetFrameDate || room.targetBoardDate || room.notes) && (
                                          <div className="text-[10px] text-slate-500 pt-2.5 mt-2.5 border-t border-dashed border-slate-200/80 space-y-1">
                                            {room.targetBoardDate && (
                                              <div className="flex justify-between">
                                                <span>📅 Hạn bắn tấm:</span>
                                                <strong className="text-slate-700">{formatDateDDMMYYYY(room.targetBoardDate)}</strong>
                                              </div>
                                            )}
                                            {room.notes && (
                                              <div className="bg-amber-50/50 text-amber-900/90 p-1.5 rounded border border-amber-100/50 text-[9.5px] italic leading-tight">
                                                💡 {room.notes}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* SUB TAB 2: DEFECTS */}
                {detailModalTab === 'defects' && (
                  <div className="space-y-3">
                    {/* Defect Filter Pills */}
                    <div className="flex items-center gap-1.5 bg-slate-200/60 p-1 rounded-xl text-xs">
                      <button
                        onClick={() => setDefectFilter('all')}
                        className={`flex-1 py-1.5 px-2 rounded-lg font-bold transition text-[11px] ${
                          defectFilter === 'all'
                            ? 'bg-white text-slate-800 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Tất cả ({teamDefects.length})
                      </button>
                      <button
                        onClick={() => setDefectFilter('open')}
                        className={`flex-1 py-1.5 px-2 rounded-lg font-bold transition text-[11px] ${
                          defectFilter === 'open'
                            ? 'bg-rose-500 text-white shadow-2xs'
                            : 'text-rose-700 hover:bg-rose-100/50'
                        }`}
                      >
                        Cần sửa ({openDefectsList.length})
                      </button>
                      <button
                        onClick={() => setDefectFilter('resolved')}
                        className={`flex-1 py-1.5 px-2 rounded-lg font-bold transition text-[11px] ${
                          defectFilter === 'resolved'
                            ? 'bg-emerald-600 text-white shadow-2xs'
                            : 'text-emerald-700 hover:bg-emerald-100/50'
                        }`}
                      >
                        Đã xử lý ({resolvedDefectsList.length})
                      </button>
                    </div>

                    <div className="flex justify-end px-1">
                      <QuickSortBar
                        itemCount={teamDefects.length}
                        options={[{ key: 'floor', label: 'Tầng', kind: 'floor' }]}
                        activeKey="floor"
                        order={teamDefectFloorSortOrder}
                        onChange={(_key, order) => setTeamDefectFloorSortOrder(order)}
                        onToggleOrder={() => setTeamDefectFloorSortOrder((order) => order === 'asc' ? 'desc' : 'asc')}
                        onReset={() => setTeamDefectFloorSortOrder('asc')}
                      />
                    </div>

                    {displayedDefects.length === 0 ? (
                      <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-6 text-center">
                        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                        <h4 className="text-sm font-bold text-emerald-900">
                          {defectFilter === 'open' 
                            ? 'Không có Defect nào cần khắc phục!' 
                            : 'Không tìm thấy Defect nào theo bộ lọc'}
                        </h4>
                        <p className="text-xs text-emerald-700 mt-1">
                          Đội <strong className="text-emerald-900">{team.name}</strong> đang duy trì chất lượng thi công tốt.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {displayedDefects.map((defect) => (
                          <div 
                            key={defect.id}
                            className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs hover:border-rose-200 transition"
                          >
                            <div className="flex justify-between items-start gap-2 mb-1.5">
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-slate-900 text-xs">{defect.category}</span>
                                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                                    defect.severity === 'Nghiêm trọng'
                                      ? 'bg-rose-100 text-rose-800 border-rose-300'
                                      : defect.severity === 'Trung bình'
                                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                                      : 'bg-sky-100 text-sky-800 border-sky-300'
                                  }`}>
                                    {defect.severity}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 font-medium mt-0.5 flex items-center gap-1">
                                  <MapPin className="w-3 h-3 text-indigo-500" />
                                  Tầng: <strong className="text-slate-700">{defect.floorName}</strong>
                                </p>
                              </div>

                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${
                                defect.status === 'Mới phát hiện'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : defect.status === 'Đang sửa'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : defect.status === 'Đã khắc phục'
                                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              }`}>
                                {defect.status}
                              </span>
                            </div>

                            <p className="text-xs text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-100 my-1.5">
                              {defect.description || 'Chưa có mô tả chi tiết'}
                            </p>

                            {defect.imageUrl && (
                              <div className="mt-2">
                                <img 
                                  src={defect.imageUrl} 
                                  alt="Ảnh defect" 
                                  className="w-full max-h-36 object-cover rounded-lg border border-slate-200"
                                />
                              </div>
                            )}

                            <div className="text-[10px] text-slate-400 mt-2 flex justify-between items-center pt-1 border-t border-slate-100">
                              <span>Phụ trách: <strong className="text-slate-600">{defect.assignedTo}</strong></span>
                              <span>Tạo: {formatDateDDMMYYYY(defect.createdAt)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* SUB TAB 3: DAILY LOGS */}
                {detailModalTab === 'logs' && (
                  <div>
                    {teamLogs.length === 0 ? (
                      <div className="bg-white border border-dashed border-slate-300 rounded-xl p-6 text-center">
                        <Clipboard className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <h4 className="text-xs font-bold text-slate-700">Chưa có nhật ký làm việc nào được ghi nhận cho đội này</h4>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Khi chấm công / ghi nhận quân số hằng ngày, hãy chọn tên đội <strong className="text-indigo-600">{team.name}</strong>.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="text-xs text-slate-500 font-medium px-1 mb-1">
                          Lịch sử công nhật đã ghi nhận ({teamLogs.length} ngày / {formatDecimal(totalWorkdays)} công thợ):
                        </div>
                        <div className="flex justify-end px-1">
                          <QuickSortBar
                            itemCount={teamLogs.length}
                            options={[
                              { key: 'date', label: 'Ngày', kind: 'date', defaultOrder: 'desc' },
                              { key: 'floor', label: 'Tầng', kind: 'floor' },
                            ]}
                            activeKey={teamLogSortMode}
                            order={teamLogSortMode === 'date' ? teamLogDateSortOrder : teamLogFloorSortOrder}
                            onChange={(key, order) => {
                              setTeamLogSortMode(key);
                              if (key === 'date') setTeamLogDateSortOrder(order);
                              else setTeamLogFloorSortOrder(order);
                            }}
                            onToggleOrder={() => {
                              if (teamLogSortMode === 'date') setTeamLogDateSortOrder((order) => order === 'asc' ? 'desc' : 'asc');
                              else setTeamLogFloorSortOrder((order) => order === 'asc' ? 'desc' : 'asc');
                            }}
                            onReset={() => {
                              setTeamLogSortMode('date');
                              setTeamLogDateSortOrder('desc');
                              setTeamLogFloorSortOrder('asc');
                            }}
                          />
                        </div>
                        {displayedTeamLogs.map((log) => (
                          <div 
                            key={log.id}
                            className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs text-xs space-y-1"
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex items-center gap-1.5 font-bold text-slate-800">
                                <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                                <span>{formatDateDDMMYYYY(log.date)}</span>
                                <span className="text-[11px] font-normal text-slate-500">({getCrewLogFloorLabel(log, floorPlans)})</span>
                              </div>
                              <span className="bg-indigo-50 text-indigo-700 font-black px-2 py-0.5 rounded-md border border-indigo-100 text-[11px]">
                                {formatDecimal(log.workerCount)} thợ
                              </span>
                            </div>

                            <div className="text-slate-600 font-medium">
                              Nhiệm vụ: <span className="text-slate-800">{log.taskDescription}</span>
                            </div>

                            {log.notes && (
                              <div className="text-[11px] text-slate-500 italic bg-slate-50 p-1.5 rounded border border-slate-100">
                                Ghi chú: {log.notes}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="bg-white border-t border-slate-200 p-3 flex items-center justify-between gap-2 shrink-0">
                <button
                  onClick={() => handleExportTeamStats(team.name)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-3.5 rounded-xl text-xs flex items-center gap-1.5 transition shadow-2xs active:scale-95"
                  title="Tải báo cáo Excel thống kê chi tiết cho đội thi công này"
                >
                  <Download className="w-4 h-4" /> Xuất Excel Đội Này
                </button>
                <button
                  onClick={() => setSelectedTeamForDetail(null)}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 px-5 rounded-xl text-xs transition"
                >
                  Đóng thống kê
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
};
