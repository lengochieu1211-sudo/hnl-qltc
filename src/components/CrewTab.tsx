import React, { useState, useMemo, useEffect } from 'react';
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
  Phone,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Settings,
  Download,
  Upload,
  FileSpreadsheet,
  BarChart3,
  Home,
  CheckCircle
} from 'lucide-react';
import { CrewRecord, FloorPlan, TeamInfo, RoomProgressItem, DefectItem, CrewFloorWork, CrewFloorCategoryWork } from '../types';
import { formatDateDDMMYYYY } from '../utils/dateFormatter';
import { exportTeamStatisticsToExcel } from '../utils/excelExport';
import { confirmAsync } from '../utils/confirmAsync';


interface CrewTabProps {
  crewRecords: CrewRecord[];
  floorPlans: FloorPlan[];
  roomProgressList?: RoomProgressItem[];
  defects?: DefectItem[];
  onAddCrewRecord: (record: Omit<CrewRecord, 'id'>) => void;
  onUpdateCrewRecord: (id: string, record: Partial<CrewRecord>) => void;
  onDeleteCrewRecord: (id: string) => void;
  onDeleteMultipleCrewRecords?: (ids: string[]) => void;
  onCopyCrewRecordsFromDate: (sourceDate: string, targetDate: string) => void;
  onOpenExportPdf?: () => void;
  onExportExcel?: () => void;
  teams?: TeamInfo[];
  onUpdateTeams?: (teams: TeamInfo[]) => void;
}

const COMMON_TASKS = [
  'Bắn tấm thạch cao trần vách',
  'Lắp dựng khung xương chính & phụ',
  'Sơn bả matit hoàn thiện trần',
  'Trét mối nối & dán băng keo thủy tinh',
  'Vệ sinh mặt bằng & tập kết vật tư',
  'Sửa chữa lỗi & vá dặm lỗ điện nước',
  'Thi công cách âm / bảo ôn bông thủy tinh'
];

export const CrewTab: React.FC<CrewTabProps> = ({
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
  // Navigation Tabs: 'logs' (Daily logs) or 'teams' (Manage team directory)
  const [activeSubTab, setActiveSubTab] = useState<'logs' | 'teams'>('logs');
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);

  // Load custom teams list from localStorage
  const [teams, setTeams] = useState<TeamInfo[]>(() => {
    if (propTeams && propTeams.length > 0) return propTeams;
    const saved = localStorage.getItem('construction_teams');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error parsing construction_teams', e);
      }
    }
    return [
      { id: 'team-1', name: 'Đội Thạch Cao Hà Nội', leader: 'Đội trưởng Hùng', defaultCount: 12, phone: '0912345678', notes: 'Đội chính đóng tấm Gyproc' },
      { id: 'team-2', name: 'Đội Khung Xương Tiến Phát', leader: 'Đội trưởng Tiến', defaultCount: 8, phone: '0987654321', notes: 'Chuyên lắp ráp giàn khung xương chính' },
      { id: 'team-3', name: 'Đội Sơn Bả Hùng Cường', leader: 'Anh Cường', defaultCount: 6, phone: '0905556677', notes: 'Sơn bả trần thạch cao' },
      { id: 'team-4', name: 'Đội Trần Chìm Hải Phòng', leader: 'Anh Hải', defaultCount: 10, notes: 'Thi công trần giật cấp nghệ thuật' },
      { id: 'team-5', name: 'Đội Cơ Điện & Nước', leader: 'Anh Điện', defaultCount: 4, notes: 'Đi ống luồn dây điện âm trần' },
      { id: 'team-6', name: 'Đội Phụ Trợ & Dọn Dẹp', leader: 'Chị Hoa', defaultCount: 5, notes: 'Thu dọn phế thải thạch cao tấm vụn' },
    ];
  });

  // Team detail & statistics modal state
  const [selectedTeamForDetail, setSelectedTeamForDetail] = useState<TeamInfo | null>(null);
  const [detailModalTab, setDetailModalTab] = useState<'rooms' | 'defects' | 'logs'>('rooms');
  const [defectFilter, setDefectFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);

  // Helper function to match team strings flexibly
  const isTeamMatch = (targetStr?: string, team?: TeamInfo | null): boolean => {
    if (!targetStr || !team) return false;
    const t = targetStr.trim().toLowerCase();
    const name = team.name.trim().toLowerCase();
    const leader = team.leader.trim().toLowerCase();
    if (!t) return false;
    return t === name || t === leader || (name.length > 2 && t.includes(name)) || (t.length > 2 && name.includes(t));
  };

  // Sync state if prop changes
  useEffect(() => {
    if (propTeams && propTeams.length > 0 && JSON.stringify(propTeams) !== JSON.stringify(teams)) {
      setTeams(propTeams);
    }
  }, [propTeams]);

  // Save teams to localStorage and call onUpdateTeams
  useEffect(() => {
    localStorage.setItem('construction_teams', JSON.stringify(teams));
    if (onUpdateTeams && propTeams && JSON.stringify(propTeams) !== JSON.stringify(teams)) {
      onUpdateTeams(teams);
    } else if (onUpdateTeams && !propTeams) {
      onUpdateTeams(teams);
    }
  }, [teams]);

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

  // Custom confirmation modal states
  const [deletingRecordTarget, setDeletingRecordTarget] = useState<CrewRecord | null>(null);
  const [deletingTeamTarget, setDeletingTeamTarget] = useState<TeamInfo | null>(null);
  const [showCopyConfirm, setShowCopyConfirm] = useState(false);
  const [copySourceDate, setCopySourceDate] = useState('');

  // Daily Log Form State
  const [teamName, setTeamName] = useState('');
  const [leaderName, setLeaderName] = useState('');
  const [workerCount, setWorkerCount] = useState<number>(5);
  const [selectedFloorId, setSelectedFloorId] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [selectedShifts, setSelectedShifts] = useState<string[]>(['Sáng', 'Chiều']);
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

  const toggleShift = (value: string) => {
    setSelectedShifts(prev => {
      if (prev.includes(value)) {
        const next = prev.filter(s => s !== value);
        // Do not allow empty selection (stay on the clicked one if it's the last one)
        return next.length === 0 ? [value] : next;
      } else {
        return [...prev, value];
      }
    });
  };

  // Manage Team Form State
  const [tName, setTName] = useState('');
  const [tLeader, setTLeader] = useState('');
  const [tCount, setTCount] = useState<number>(5);
  const [tPhone, setTPhone] = useState('');
  const [tNotes, setTNotes] = useState('');

  // Synchronize Daily Log Form values
  useEffect(() => {
    if (editingRecord) {
      setTeamName(editingRecord.teamName);
      setLeaderName(editingRecord.leaderName);
      setWorkerCount(editingRecord.workerCount);
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

      const sVal = editingRecord.shift || 'Hành chính';
      if (sVal === 'Hành chính') {
        setSelectedShifts(['Sáng', 'Chiều']);
      } else if (sVal === 'Tăng ca') {
        setSelectedShifts(['Tối']);
      } else {
        setSelectedShifts(sVal.split(', ').map(s => s.trim()));
      }

      setNotes(editingRecord.notes || '');
    } else {
      // Set to first team in directory if available, otherwise blank
      if (teams.length > 0) {
        setTeamName(teams[0].name);
        setLeaderName(teams[0].leader);
        setWorkerCount(teams[0].defaultCount);
      } else {
        setTeamName('');
        setLeaderName('');
        setWorkerCount(5);
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
      setSelectedShifts(['Sáng', 'Chiều']);
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

  // Statistics for the selected date
  const stats = useMemo(() => {
    const totalWorkers = filteredRecords.reduce((sum, r) => sum + r.workerCount, 0);
    const totalTeams = filteredRecords.length;

    // Distribution by floor
    const floorDistribution: { [key: string]: { name: string; count: number } } = {};
    filteredRecords.forEach((r) => {
      if (!floorDistribution[r.floorId]) {
        floorDistribution[r.floorId] = { name: r.floorName, count: 0 };
      }
      floorDistribution[r.floorId].count += r.workerCount;
    });

    const activeFloorsList = Object.values(floorDistribution).sort((a, b) => b.count - a.count);

    return {
      totalWorkers,
      totalTeams,
      activeFloorsList
    };
  }, [filteredRecords]);

  // Handle Daily Log Submission
  const handleLogSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim()) {
      alert('Vui lòng chọn hoặc nhập tên đội thi công!');
      return;
    }
    if (!leaderName.trim()) {
      alert('Vui lòng nhập tên trưởng nhóm/đội trưởng!');
      return;
    }
    if (workerCount <= 0) {
      alert('Số lượng quân số phải lớn hơn 0!');
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

    const firstFw = floorWorks[0];
    const floorId = firstFw ? firstFw.floorId : selectedFloorId;
    const floorName = floorWorks.length > 0
      ? floorWorks.map(fw => fw.floorName).join(', ')
      : (floorPlans.find(fp => fp.id === selectedFloorId)?.floorName || 'Tầng');

    const taskDesc = floorWorks.length > 0
      ? floorWorks.map(fw => `[${fw.floorName}]: ` + fw.categories.map(c => `${c.categoryName} (${c.subItems.join(', ')})`).join('; ')).join(' | ')
      : taskDescription;

    const shiftValue = selectedShifts.length > 0 ? selectedShifts.join(', ') : 'Nghỉ';

    const recordData = {
      date: selectedDate,
      teamName: teamName.trim(),
      leaderName: leaderName.trim(),
      workerCount,
      floorId,
      floorName,
      floorWorks,
      taskDescription: taskDesc,
      shift: shiftValue,
      notes: notes.trim() || undefined
    };

    if (editingRecord) {
      onUpdateCrewRecord(editingRecord.id, recordData);
      setEditingRecord(null);
    } else {
      onAddCrewRecord(recordData);
    }
    setShowAddLogModal(false);
  };

  // Handle Team Directory Submission
  const handleTeamSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
      id: editingTeam ? editingTeam.id : `team-${Date.now()}`,
      name: tName.trim(),
      leader: tLeader.trim(),
      defaultCount: tCount,
      phone: tPhone.trim() || undefined,
      notes: tNotes.trim() || undefined
    };

    if (editingTeam) {
      setTeams((prev) => prev.map((t) => (t.id === editingTeam.id ? teamData : t)));
      setEditingTeam(null);
    } else {
      setTeams((prev) => [...prev, teamData]);
    }
    setShowTeamModal(false);
  };

  // Handle Copy Trigger from Yesterday
  const handleCopyFromYesterdayClick = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const yesterdayStr = `${year}-${month}-${day}`;

    const yesterdayRecords = crewRecords.filter((r) => r.date === yesterdayStr);
    if (yesterdayRecords.length === 0) {
      alert(`Không tìm thấy dữ liệu quân số của ngày hôm trước (${yesterdayStr}) để sao chép!`);
      return;
    }

    setCopySourceDate(yesterdayStr);

    if (filteredRecords.length > 0) {
      // Trigger confirmation dialog instead of window.confirm
      setShowCopyConfirm(true);
    } else {
      // Copy directly without conflict
      onCopyCrewRecordsFromDate(yesterdayStr, selectedDate);
    }
  };

  const confirmCopy = () => {
    onCopyCrewRecordsFromDate(copySourceDate, selectedDate);
    setShowCopyConfirm(false);
  };

  const executeDeleteRecord = () => {
    if (deletingRecordTarget) {
      onDeleteCrewRecord(deletingRecordTarget.id);
      setDeletingRecordTarget(null);
    }
  };

  const executeDeleteTeam = () => {
    if (deletingTeamTarget) {
      setTeams((prev) => prev.filter((t) => t.id !== deletingTeamTarget.id));
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
      'Tên Đội Thi Công': item.name,
      'Trưởng Nhóm / Đội Trưởng': item.leader,
      'Quân Số Định Biên Mặc Định': item.defaultCount,
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
    XLSX.writeFile(wb, 'Mau_Danh_Sach_Doi_Thi_Cong.xlsx');
  };

  const handleExportTeamStats = (teamName?: string) => {
    exportTeamStatisticsToExcel({
      teams,
      roomProgressList: roomProgressList || [],
      defects: defects || [],
      crewRecords,
      floorPlans,
      projectName: 'CongTrinh',
      selectedTeamName: teamName
    });
  };

  const handleImportExcelTeams = (e: React.ChangeEvent<HTMLInputElement>) => {
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
          const nameStr = String(row[nameMatchKey] || '').trim();
          const leaderStr = String(row['Trưởng Nhóm / Đội Trưởng'] || row['Trưởng Nhóm'] || row['Đội Trưởng'] || row['leader'] || '').trim();
          const countNum = Number(row['Quân Số Định Biên Mặc Định'] || row['defaultCount'] || row['Quân số'] || row['Số người'] || 0);
          const phoneStr = String(row['Số Điện Thoại'] || row['phone'] || row['sdt'] || '').trim();
          const notesStr = String(row['Ghi Chú'] || row['notes'] || '').trim();

          if (!nameStr || !leaderStr || countNum <= 0) {
            skippedCount++;
            return;
          }

          const existingIdx = newTeams.findIndex(
            (t) => t.name.toLowerCase() === nameStr.toLowerCase()
          );

          const teamData: TeamInfo = {
            id: existingIdx !== -1 ? newTeams[existingIdx].id : `team-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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

        setTeams(newTeams);
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
    <div className="pb-24 pt-4 px-4 max-w-lg mx-auto bg-slate-50 min-h-screen text-slate-800" id="crew-tab-container">

      {/* Sub-tab Navigation Selector */}
      <div className="flex bg-slate-200 p-1.5 rounded-xl mb-4 shadow-sm" id="crew-subtab-navigation">
        <button
          onClick={() => setActiveSubTab('logs')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg transition-all ${
            activeSubTab === 'logs' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calendar className="w-4 h-4" /> Nhật Ký Hằng Ngày
        </button>
        <button
          onClick={() => setActiveSubTab('teams')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg transition-all ${
            activeSubTab === 'teams' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" /> Mục Nhập Thông Tin Đội
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
                <span className="text-white/80 text-[10px] font-bold tracking-wider uppercase">Tổng Quân Số Hôm Nay</span>
                <Users className="w-4 h-4 text-white/80" />
              </div>
              <div className="text-2xl font-black mt-1 leading-none">{stats.totalWorkers}</div>
              <p className="text-white/70 text-[10px] mt-1.5">Từ {stats.totalTeams} đội làm việc</p>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start">
                  <span className="text-slate-400 text-[10px] font-bold tracking-wider uppercase">Khu Vực Làm Nhiều</span>
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
              onClick={handleCopyFromYesterdayClick}
              className="flex-1 flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold py-2.5 px-4 rounded-xl shadow-sm transition text-xs"
              title="Sao chép toàn bộ danh sách đội của ngày hôm trước"
            >
              <Copy className="w-3.5 h-3.5" /> Sao chép hôm qua
            </button>
          </div>

          {/* Daily Records List */}
          <div className="space-y-3">
            <h2 className="text-xs font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1.5 px-1">
              <Clipboard className="w-3.5 h-3.5 text-indigo-500" /> Nhật ký làm việc ({formatDateDDMMYYYY(selectedDate)})
            </h2>

            {filteredRecords.length > 0 && (
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
                  <span>Chọn Tất Cả Quân Số Ngày Này ({filteredRecords.length})</span>
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
                      <Trash2 className="w-3.5 h-3.5" /> Xóa Đã Chọn ({selectedRecordIds.filter(id => filteredRecords.some(item => item.id === id)).length})
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
                <p className="text-[10px] text-slate-400 mt-1">Ấn nút "Ghi nhận quân số" hoặc "Sao chép hôm qua" để điền nhanh.</p>
              </div>
            ) : (
              filteredRecords.map((record) => (
                <div
                  key={record.id}
                  className={`bg-white border rounded-xl p-4 transition-all duration-150 relative hover:border-slate-300 ${
                    selectedRecordIds.includes(record.id)
                      ? 'border-indigo-300 bg-indigo-50/10 shadow-xs'
                      : 'border-slate-200 shadow-sm'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
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
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-4 mb-2">
                        <div>
                          <h4 className="font-bold text-slate-800 text-sm leading-tight">{record.teamName}</h4>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
                            <User className="w-3.5 h-3.5 text-slate-300" />
                            <span>Đội trưởng: <strong>{record.leaderName}</strong></span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <div className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-2.5 py-1 rounded-lg text-center font-black text-xs min-w-[50px]">
                            {(record.workerCount ?? 0).toLocaleString('en-US')} thợ
                          </div>
                          <div className="flex flex-wrap gap-1 justify-end max-w-[140px]">
                            {(() => {
                              const sVal = record.shift || 'Sáng, Chiều';
                              if (sVal === 'Hành chính') {
                                return (
                                  <>
                                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-100">Sáng</span>
                                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50/50 text-indigo-700 border border-indigo-100">Chiều</span>
                                  </>
                                );
                              }
                              if (sVal === 'Tăng ca') {
                                return <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">Tối</span>;
                              }
                              return sVal.split(', ').map(part => {
                                if (part === 'Sáng') return <span key={part} className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-100">Sáng</span>;
                                if (part === 'Chiều') return <span key={part} className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50/50 text-indigo-700 border border-indigo-100">Chiều</span>;
                                if (part === 'Tối') return <span key={part} className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">Tối</span>;
                                return <span key={part} className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">Nghỉ</span>;
                              });
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

                      {/* Actions buttons */}
                      <div className="flex items-center justify-end gap-3 mt-3 pt-2 border-t border-slate-100">
                        <button
                          onClick={async () => {
                            setEditingRecord(record);
                            setShowAddLogModal(true);
                          }}
                          className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 transition"
                          title="Sửa bản ghi"
                        >
                          <Edit2 className="w-3.5 h-3.5" /> <span>Sửa</span>
                        </button>
                        <button
                          onClick={async () => {
                            setDeletingRecordTarget(record);
                          }}
                          className="flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600 transition"
                          title="Xóa bản ghi"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> <span className="text-rose-500 font-semibold">Xóa</span>
                        </button>
                      </div>
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
              <Settings className="w-3.5 h-3.5 text-indigo-500" /> Quản lý danh mục các Đội thi công
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Khai báo thông tin các đội thợ tại đây bao gồm Đội trưởng, Quân số định biên mặc định. Khi ghi nhận nhật ký hằng ngày, chỉ cần chọn tên đội thợ để hệ thống tự động điền các thông tin liên quan, rút ngắn thời gian làm báo cáo hằng ngày.
            </p>

            <div className="mt-3.5 pt-3 border-t border-slate-100">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    setEditingTeam(null);
                    setShowTeamModal(true);
                  }}
                  className="h-10 px-3 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs shadow-2xs transition-all active:scale-95"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span className="truncate">Thêm đội mới</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExportTeamStats()}
                  className="h-10 px-3 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-2xs transition-all active:scale-95"
                  title="Tải báo cáo Excel thống kê căn, tầng, khối lượng và defect của tất cả các đội thi công"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span className="truncate">Xuất Thống Kê</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportTeamsTemplate}
                  className="h-10 px-3 flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-200 text-xs shadow-2xs transition-all active:scale-95"
                  title="Tải mẫu Excel danh bạ đội thi công"
                >
                  <FileSpreadsheet className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="truncate">Tải Mẫu Excel</span>
                </button>

                <label className="h-10 px-3 flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-200 text-xs shadow-2xs cursor-pointer transition-all active:scale-95">
                  <Upload className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="truncate">Nhập từ Excel</span>
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleImportExcelTeams}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-xs font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1.5 px-1">
              <Users className="w-3.5 h-3.5 text-indigo-500" /> Danh sách ({teams.length} đội thi công)
            </h2>

            {teams.length > 0 && (
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
                  <span>Chọn Tất Cả Đội ({teams.length})</span>
                </label>

                <div className="flex items-center gap-3 justify-end">
                  {selectedTeamIds.some(id => teams.some(item => item.id === id)) && (
                    <button
                      type="button"
                      onClick={async () => {
                        const idsToDelete = selectedTeamIds.filter(id => teams.some(item => item.id === id));
                        if (await confirmAsync(`Bạn có chắc muốn xóa ${idsToDelete.length} đội thi công đã chọn?`)) {
                          setTeams((prev) => prev.filter((t) => !idsToDelete.includes(t.id)));
                          setSelectedTeamIds(prev => prev.filter(id => !idsToDelete.includes(id)));
                        }
                      }}
                      className="text-rose-600 hover:text-rose-700 font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Xóa Đã Chọn ({selectedTeamIds.filter(id => teams.some(item => item.id === id)).length})
                    </button>
                  )}
                </div>
              </div>
            )}

            {teams.length === 0 ? (
              <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center flex flex-col items-center justify-center shadow-sm">
                <Users className="w-8 h-8 text-slate-300 mb-2" />
                <p className="text-xs text-slate-400 font-medium">Chưa có đội thi công nào được thêm.</p>
                <p className="text-[10px] text-slate-400 mt-1">Vui lòng bấm nút phía trên để bắt đầu thêm mới.</p>
              </div>
            ) : (
              teams.map((team) => {
                const assignedRooms = (roomProgressList || []).filter(r => isTeamMatch(r.assignedTeam, team));
                const totalTeamVol = assignedRooms.reduce((sum, r) => sum + (r.workVolume || 0), 0);
                const teamFloorNames = Array.from(new Set(assignedRooms.map(r => r.floorName || (floorPlans || []).find(f => f.id === r.floorId)?.floorName || 'Mặt bằng')));
                const assignedDefects = (defects || []).filter(d => isTeamMatch(d.assignedTo, team));
                const openDefects = assignedDefects.filter(d => d.status === 'Mới phát hiện' || d.status === 'Đang sửa');
                const teamLogs = (crewRecords || []).filter(l => isTeamMatch(l.teamName, team));
                const totalManDays = teamLogs.reduce((sum, item) => sum + (item.workerCount || 0), 0);

                const teamWorkCategories = (() => {
                  const categoriesSet = new Set<string>();
                  (roomProgressList || []).forEach(room => {
                    const isMainTeam = isTeamMatch(room.assignedTeam, team);
                    if (isMainTeam) {
                      if (room.workCategory) {
                        categoriesSet.add(room.workCategory);
                      }
                      if (room.categoryVolumes) {
                        Object.keys(room.categoryVolumes).forEach(cat => {
                          if (cat) categoriesSet.add(cat);
                        });
                      }
                      if (room.subItems) {
                        room.subItems.forEach(sub => {
                          if (!sub.assignedTeam) {
                            const cat = sub.category || room.workCategory;
                            if (cat) categoriesSet.add(cat);
                          }
                        });
                      }
                    }
                    if (room.subItems) {
                      room.subItems.forEach(sub => {
                        if (isTeamMatch(sub.assignedTeam, team)) {
                          const cat = sub.category || room.workCategory;
                          if (cat) categoriesSet.add(cat);
                        }
                      });
                    }
                  });
                  return Array.from(categoriesSet).filter(Boolean);
                })();

                return (
                  <div
                    key={team.id}
                    className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-indigo-300 transition-all duration-200 hover:shadow-md"
                  >
                    <div className="flex justify-between items-start gap-4 mb-2">
                      <div className="flex items-start gap-2.5 min-w-0">
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
                        <div className="text-[10px] text-indigo-500 font-bold uppercase tracking-wider">Căn & Khối Lượng</div>
                        <div className="text-xs font-black text-indigo-700 flex flex-col items-center justify-center gap-0.5 mt-0.5">
                          <span className="flex items-center gap-1">
                            <Home className="w-3.5 h-3.5" />
                            {assignedRooms.length} căn
                          </span>
                          {totalTeamVol > 0 && (
                            <span className="text-[10px] text-indigo-900 bg-indigo-100/80 px-1.5 py-0.2 rounded font-extrabold">
                              {totalTeamVol} m²
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        onClick={async () => {
                          setSelectedTeamForDetail(team);
                          setDetailModalTab('defects');
                        }}
                        className={`border p-2 rounded-lg cursor-pointer transition text-center ${
                          openDefects.length > 0
                            ? 'bg-rose-50/70 border-rose-200 hover:bg-rose-100/70'
                            : 'bg-emerald-50/70 border-emerald-100 hover:bg-emerald-100/70'
                        }`}
                        title="Xem các defect/lỗi gán cho đội"
                      >
                        <div className={`text-[10px] font-bold uppercase tracking-wider ${openDefects.length > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          Defect Tồn
                        </div>
                        <div className={`text-sm font-black flex items-center justify-center gap-1 mt-0.5 ${openDefects.length > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>{openDefects.length}</span>
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
                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Tổng Công</div>
                        <div className="text-sm font-black text-slate-700 flex items-center justify-center gap-1 mt-0.5">
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          <span>{totalManDays.toLocaleString('en-US')}</span>
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
                            <a
                              href={`tel:${String(team.phone || '').replace(/\s+/g, '')}`}
                              className="font-extrabold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 px-2 py-0.5 rounded-md inline-flex items-center gap-1 active:scale-95 transition-all shadow-2xs"
                              title="Bấm để gọi điện thoại trực tiếp cho đội thi công"
                            >
                              <Phone className="w-3 h-3 text-indigo-600 shrink-0" />
                              <span>{team.phone}</span>
                            </a>
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
                      <span>Xem Thống Kê Căn Đang Làm & Defect</span>
                    </button>

                    {/* Team edit / delete actions */}
                    <div className="flex items-center justify-end gap-3 mt-2.5 pt-2 border-t border-slate-100">
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
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ========================================= MODALS ========================================= */}

      {/* Ghi nhận quân số Modal */}
      {showAddLogModal && (
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
                  <span>{selectedDate}</span>
                </div>
              </div>

              {/* Dynamic Team selection with Auto-fill */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Đội Thi Công</label>
                <div className="space-y-1.5">
                  <select
                    value={teams.some((t) => t.name === teamName) ? teamName : 'Khác'}
                    onChange={(e) => {
                      const selectedVal = e.target.value;
                      if (selectedVal === 'Khác') {
                        setTeamName('');
                      } else {
                        setTeamName(selectedVal);
                        // Auto-populate leaderName and workerCount
                        const selectedTeam = teams.find((t) => t.name === selectedVal);
                        if (selectedTeam) {
                          setLeaderName(selectedTeam.leader);
                          setWorkerCount(selectedTeam.defaultCount);
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

                  {(!teams.some((t) => t.name === teamName) || teamName === '') && (
                    <input
                      type="text"
                      placeholder="Nhập tên đội thi công tùy chỉnh..."
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
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

              {/* Worker Count */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Quân Số (Số lượng thợ tại công trình)</label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  value={workerCount}
                  onChange={(e) => setWorkerCount(Number(e.target.value))}
                  className="w-full text-xs bg-white border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold"
                  required
                />
              </div>

              {/* Ca làm việc */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Ca Làm Việc</label>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggleShift('Sáng')}
                    className={`flex flex-col items-center justify-center p-2 rounded-xl border text-center transition-all ${
                      selectedShifts.includes('Sáng')
                        ? 'bg-sky-50 border-sky-300 text-sky-900 font-bold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span className="text-[11px] leading-tight font-black">Sáng</span>
                    <span className="text-[9px] text-slate-400 font-normal mt-0.5">Sáng</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleShift('Chiều')}
                    className={`flex flex-col items-center justify-center p-2 rounded-xl border text-center transition-all ${
                      selectedShifts.includes('Chiều')
                        ? 'bg-indigo-50 border-indigo-300 text-indigo-900 font-bold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span className="text-[11px] leading-tight font-black">Chiều</span>
                    <span className="text-[9px] text-slate-400 font-normal mt-0.5">Chiều</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleShift('Tối')}
                    className={`flex flex-col items-center justify-center p-2 rounded-xl border text-center transition-all ${
                      selectedShifts.includes('Tối')
                        ? 'bg-amber-50 border-amber-300 text-amber-900 font-bold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span className="text-[11px] leading-tight font-black">Tối</span>
                    <span className="text-[9px] text-slate-400 font-normal mt-0.5">Tối</span>
                  </button>
                </div>
              </div>

              {/* Multi-floor & Multi-category Work Configuration */}
              <div className="space-y-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-indigo-600" />
                    Phân Phối Tầng, Hạng Mục & Hạng Mục Phụ
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
                              <Plus className="w-3 h-3" /> Thêm Hạng Mục
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
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Ghi Chú Thêm (Tùy chọn)</label>
                <textarea
                  placeholder="Ví dụ: Đã nhận đủ vật tư, tăng ca hoàn thành trần phòng A102..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full text-xs bg-white border border-slate-200 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 h-16 resize-none"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={async () => {
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
      {showTeamModal && (
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
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Quân Số Định Biên Mặc Định</label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  value={tCount}
                  onChange={(e) => setTCount(Number(e.target.value))}
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
                    <a
                      href={`tel:${String(tPhone || '').replace(/\s+/g, '')}`}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md transition-colors"
                      title="Bấm để gọi điện thoại trực tiếp"
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Mô Tả / Ghi Chú</label>
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
      {deletingRecordTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 text-center">
              <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-3 border border-rose-100">
                <AlertTriangle className="w-6 h-6 text-rose-500" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">Xác Nhận Xóa Nhật Ký</h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-4">
                Bạn có chắc chắn muốn xóa bản ghi quân số của <strong className="text-slate-800">{deletingRecordTarget.teamName}</strong> tại <strong className="text-indigo-600">{deletingRecordTarget.floorName}</strong> không? Hành động này không thể hoàn tác.
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
      {deletingTeamTarget && (
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
      {showCopyConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 text-center">
              <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3 border border-amber-100">
                <Copy className="w-5 h-5 text-amber-500" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm mb-1">Trùng Lặp Bản Ghi Nhật Ký</h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-4">
                Ngày <strong className="text-slate-800">{selectedDate}</strong> hiện đang có {filteredRecords.length} ghi nhận quân số. Bạn có muốn sao chép đè/thêm dữ liệu của ngày hôm trước ({copySourceDate}) sang hôm nay không?
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
        const teamRooms = (roomProgressList || []).filter(r => isTeamMatch(r.assignedTeam, team));
        const teamDefects = (defects || []).filter(d => isTeamMatch(d.assignedTo, team));
        const teamLogs = (crewRecords || []).filter(l => isTeamMatch(l.teamName, team));

        const totalWorkdays = teamLogs.reduce((sum, item) => sum + (item.workerCount || 0), 0);
        const openDefectsList = teamDefects.filter(d => d.status === 'Mới phát hiện' || d.status === 'Đang sửa');
        const resolvedDefectsList = teamDefects.filter(d => d.status === 'Đã khắc phục' || d.status === 'Đã nghiệm thu');
        const completedRooms = teamRooms.filter(r => r.inspectionStatus === 'Đạt nghiệm thu');

        // Volume statistics
        const totalTeamVolume = teamRooms.reduce((sum, r) => sum + (r.workVolume || 0), 0);
        const completedFrameVol = teamRooms.filter(r => r.frameStatus === 'Đã hoàn thành').reduce((sum, r) => sum + (r.workVolume || 0), 0);
        const completedBoardVol = teamRooms.filter(r => r.boardStatus === 'Đã hoàn thành').reduce((sum, r) => sum + (r.workVolume || 0), 0);
        const inspectedVol = teamRooms.filter(r => r.inspectionStatus === 'Đạt nghiệm thu').reduce((sum, r) => sum + (r.workVolume || 0), 0);

        // Floor breakdown statistics
        const floorGroupMap: Record<string, { floorName: string; rooms: typeof teamRooms; totalVol: number; doneFrameVol: number; doneBoardVol: number; doneRooms: number }> = {};
        teamRooms.forEach((room) => {
          const fp = floorPlans.find(f => f.id === room.floorId);
          const fName = room.floorName || fp?.floorName || 'Mặt bằng';
          if (!floorGroupMap[fName]) {
            floorGroupMap[fName] = { floorName: fName, rooms: [], totalVol: 0, doneFrameVol: 0, doneBoardVol: 0, doneRooms: 0 };
          }
          floorGroupMap[fName].rooms.push(room);
          floorGroupMap[fName].totalVol += (room.workVolume || 0);
          if (room.frameStatus === 'Đã hoàn thành') floorGroupMap[fName].doneFrameVol += (room.workVolume || 0);
          if (room.boardStatus === 'Đã hoàn thành') floorGroupMap[fName].doneBoardVol += (room.workVolume || 0);
          if (room.inspectionStatus === 'Đạt nghiệm thu') floorGroupMap[fName].doneRooms += 1;
        });
        const floorStatList = Object.values(floorGroupMap);

        const teamWorkCategories = (() => {
          const categoriesSet = new Set<string>();
          (roomProgressList || []).forEach(room => {
            const isMainTeam = isTeamMatch(room.assignedTeam, team);
            if (isMainTeam) {
              if (room.workCategory) {
                categoriesSet.add(room.workCategory);
              }
              if (room.categoryVolumes) {
                Object.keys(room.categoryVolumes).forEach(cat => {
                  if (cat) categoriesSet.add(cat);
                });
              }
              if (room.subItems) {
                room.subItems.forEach(sub => {
                  if (!sub.assignedTeam) {
                    const cat = sub.category || room.workCategory;
                    if (cat) categoriesSet.add(cat);
                  }
                });
              }
            }
            if (room.subItems) {
              room.subItems.forEach(sub => {
                if (isTeamMatch(sub.assignedTeam, team)) {
                  const cat = sub.category || room.workCategory;
                  if (cat) categoriesSet.add(cat);
                }
              });
            }
          });
          return Array.from(categoriesSet).filter(Boolean);
        })();

        // Filter defects by tab state
        const displayedDefects = teamDefects.filter(d => {
          if (defectFilter === 'open') return d.status === 'Mới phát hiện' || d.status === 'Đang sửa';
          if (defectFilter === 'resolved') return d.status === 'Đã khắc phục' || d.status === 'Đã nghiệm thu';
          return true;
        });

        // Collect unique floors where this team worked from daily logs
        const loggedFloors = Array.from(new Set(teamLogs.map(l => l.floorName).filter(Boolean)));

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-md">
            <div
              className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh] border border-slate-200 animate-in fade-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="bg-slate-900 p-4 text-white flex justify-between items-start border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase tracking-wider">
                      Thống kê thi công
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
                        <a
                          href={`tel:${String(team.phone || '').replace(/\s+/g, '')}`}
                          className="text-emerald-300 hover:text-white font-extrabold underline inline-flex items-center gap-1 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-700/80 active:scale-95 transition-all shadow-2xs"
                          title="Bấm để gọi điện thoại trực tiếp"
                        >
                          <Phone className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span>{team.phone}</span>
                        </a>
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
                  className="text-slate-400 hover:text-white transition bg-slate-800 hover:bg-slate-700 p-2 rounded-xl"
                  title="Đóng"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* KPI Summary Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-white border-b border-slate-200 text-xs">
                <div className="bg-indigo-50/80 border border-indigo-100 p-2 rounded-xl text-center">
                  <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">Căn & Tầng</div>
                  <div className="text-sm sm:text-base font-black text-indigo-900 mt-0.5 flex items-center justify-center gap-1">
                    <Home className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span>{teamRooms.length} căn ({floorStatList.length} tầng)</span>
                  </div>
                  <div className="text-[10px] text-indigo-600 mt-0.5 font-medium">
                    {completedRooms.length}/{teamRooms.length} căn nghiệm thu
                  </div>
                </div>

                <div className="bg-emerald-50/80 border border-emerald-100 p-2 rounded-xl text-center">
                  <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Khối Lượng Thi Công</div>
                  <div className="text-sm sm:text-base font-black text-emerald-900 mt-0.5 flex items-center justify-center gap-1">
                    <BarChart3 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>{totalTeamVolume > 0 ? `${totalTeamVolume} m²` : 'Chưa nhập'}</span>
                  </div>
                  <div className="text-[10px] text-emerald-700 mt-0.5 font-semibold truncate">
                    {inspectedVol > 0 ? `NT: ${inspectedVol} m²` : `Khung: ${completedFrameVol} m² | Tấm: ${completedBoardVol} m²`}
                  </div>
                </div>

                <div className={`border p-2 rounded-xl text-center ${
                  openDefectsList.length > 0 ? 'bg-rose-50/80 border-rose-200' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className={`text-[10px] font-bold uppercase tracking-wider ${
                    openDefectsList.length > 0 ? 'text-rose-600' : 'text-slate-500'
                  }`}>
                    Defect Tồn Đọng
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
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tổng Công Đã Làm</div>
                  <div className="text-sm sm:text-base font-black text-slate-800 mt-0.5 flex items-center justify-center gap-1">
                    <Users className="w-3.5 h-3.5 text-slate-600" />
                    <span>{totalWorkdays} công</span>
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
                  <span>Lịch sử Nhật ký ({teamLogs.length})</span>
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
                          Để gán đội thi công cho từng căn hộ / phòng, bạn hãy vào tab <strong className="text-slate-700">"Sơ đồ mặt bằng"</strong>, chọn vùng phòng cần giao và chọn đội <strong className="text-indigo-600">{team.name}</strong>.
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
                        {/* Floor Summary Grid */}
                        {floorStatList.length > 0 && (
                          <div className="bg-white border border-indigo-100 rounded-xl p-3 shadow-2xs space-y-2">
                            <div className="flex items-center justify-between text-xs font-bold text-indigo-900 border-b border-slate-100 pb-1.5">
                              <span className="flex items-center gap-1.5">
                                <MapPin className="w-4 h-4 text-indigo-600" />
                                Thống Kê Khối Lượng Thi Công Theo Tầng
                              </span>
                              <span className="text-[11px] text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100 font-extrabold">
                                Tổng {floorStatList.length} tầng
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                              {floorStatList.map(f => (
                                <div key={f.floorName} className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80 space-y-1">
                                  <div className="flex justify-between items-center font-bold text-slate-800 text-[11px]">
                                    <span className="text-indigo-700 font-extrabold">{f.floorName}</span>
                                    <span className="bg-white px-1.5 py-0.2 rounded border border-slate-200 text-slate-600 text-[10px]">
                                      {f.rooms.length} căn ({f.doneRooms}/{f.rooms.length} đạt NT)
                                    </span>
                                  </div>

                                  <div className="grid grid-cols-3 gap-1 text-[10px] text-slate-600 pt-1 border-t border-slate-200/60">
                                    <div>
                                      <span className="text-slate-400 block text-[9px]">Tổng KL:</span>
                                      <strong className="text-slate-800">{f.totalVol} m²</strong>
                                    </div>
                                    <div>
                                      <span className="text-slate-400 block text-[9px]">Xong Khung:</span>
                                      <strong className="text-emerald-700">{f.doneFrameVol} m²</strong>
                                    </div>
                                    <div>
                                      <span className="text-slate-400 block text-[9px]">Xong Tấm:</span>
                                      <strong className="text-blue-700">{f.doneBoardVol} m²</strong>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex justify-between items-center text-xs text-slate-500 font-medium px-1">
                          <span>Danh sách căn hộ / phòng đội <strong className="text-slate-800">{team.name}</strong> đang thực hiện:</span>
                          <span className="text-[11px] bg-slate-200/80 text-slate-700 px-2 py-0.5 rounded-md font-bold">
                            {teamRooms.length} vị trí ({totalTeamVolume} m²)
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {teamRooms.map((room) => {
                            const floorPlan = floorPlans.find(f => f.id === room.floorId);
                            const floorName = room.floorName || floorPlan?.floorName || 'Mặt bằng';

                            const roomTeamCategories = (() => {
                              const cats = new Set<string>();
                              const isMainTeam = isTeamMatch(room.assignedTeam, team);
                              if (isMainTeam) {
                                if (room.workCategory) cats.add(room.workCategory);
                                if (room.categoryVolumes) {
                                  Object.keys(room.categoryVolumes).forEach(c => {
                                    if (c) cats.add(c);
                                  });
                                }
                                if (room.subItems) {
                                  room.subItems.forEach(sub => {
                                    if (!sub.assignedTeam) {
                                      const c = sub.category || room.workCategory;
                                      if (c) cats.add(c);
                                    }
                                  });
                                }
                              }
                              if (room.subItems) {
                                room.subItems.forEach(sub => {
                                  if (isTeamMatch(sub.assignedTeam, team)) {
                                    const c = sub.category || room.workCategory;
                                    if (c) cats.add(c);
                                  }
                                });
                              }
                              return Array.from(cats);
                            })();

                            return (
                              <div
                                key={room.id}
                                className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs hover:border-indigo-300 transition"
                              >
                                <div className="flex justify-between items-start gap-2 mb-2">
                                  <div>
                                    <h4 className="font-bold text-slate-900 text-sm leading-tight flex items-center gap-1.5 flex-wrap">
                                      <Home className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                      <span>{room.roomName}</span>
                                      {room.workVolume !== undefined && room.workVolume !== null && (
                                        <span className="text-[10px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200/80 px-1.5 py-0.2 rounded-md">
                                          {room.workVolume} {room.volumeUnit || 'm²'}
                                        </span>
                                      )}
                                    </h4>
                                    <p className="text-[11px] text-indigo-600 font-semibold mt-0.5 flex items-center gap-1">
                                      <MapPin className="w-3 h-3 text-slate-400" />
                                      {floorName}
                                    </p>

                                    {roomTeamCategories.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1.5">
                                        {roomTeamCategories.map(cat => (
                                          <span key={cat} className="bg-indigo-50/50 text-indigo-700 border border-indigo-100/50 text-[9px] font-extrabold px-1.5 py-0.2 rounded">
                                            🏗️ {cat}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* Inspection overall badge */}
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${
                                    room.inspectionStatus === 'Đạt nghiệm thu'
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : room.inspectionStatus === 'Chưa đạt (Cần sửa)'
                                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                                      : 'bg-slate-100 text-slate-600 border-slate-200'
                                  }`}>
                                    {room.inspectionStatus}
                                  </span>
                                </div>

                                <div className="grid grid-cols-2 gap-1.5 my-2 pt-2 border-t border-slate-100 text-[11px]">
                                  <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                                    <span className="text-slate-400 block text-[9px] font-bold uppercase">Thi công Khung</span>
                                    <span className={`font-bold block ${
                                      room.frameStatus === 'Đã hoàn thành' ? 'text-emerald-600' : room.frameStatus === 'Đang làm' ? 'text-amber-600' : 'text-slate-400'
                                    }`}>
                                      {room.frameStatus}
                                    </span>
                                  </div>

                                  <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                                    <span className="text-slate-400 block text-[9px] font-bold uppercase">Thi công Bắn tấm</span>
                                    <span className={`font-bold block ${
                                      room.boardStatus === 'Đã hoàn thành' ? 'text-emerald-600' : room.boardStatus === 'Đang làm' ? 'text-amber-600' : 'text-slate-400'
                                    }`}>
                                      {room.boardStatus}
                                    </span>
                                  </div>
                                </div>

                                {(room.targetFrameDate || room.targetBoardDate || room.notes) && (
                                  <div className="text-[10px] text-slate-500 pt-1 border-t border-dashed border-slate-100 space-y-0.5">
                                    {room.targetBoardDate && (
                                      <div>Hạn bắn tấm: <strong className="text-slate-700">{formatDateDDMMYYYY(room.targetBoardDate)}</strong></div>
                                    )}
                                    {room.notes && (
                                      <div className="italic text-slate-600 truncate">Ghi chú: {room.notes}</div>
                                    )}
                                  </div>
                                )}
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

                    {displayedDefects.length === 0 ? (
                      <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-6 text-center">
                        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                        <h4 className="text-sm font-bold text-emerald-900">
                          {defectFilter === 'open'
                            ? 'Không có lỗi defect nào cần khắc phục!'
                            : 'Không tìm thấy defect nào theo bộ lọc'}
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
                          Lịch sử công nhật đã ghi nhận ({teamLogs.length} ngày / {totalWorkdays} công thợ):
                        </div>
                        {teamLogs.map((log) => (
                          <div
                            key={log.id}
                            className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs text-xs space-y-1"
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex items-center gap-1.5 font-bold text-slate-800">
                                <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                                <span>{formatDateDDMMYYYY(log.date)}</span>
                                <span className="text-[11px] font-normal text-slate-500">({log.floorName})</span>
                              </div>
                              <span className="bg-indigo-50 text-indigo-700 font-black px-2 py-0.5 rounded-md border border-indigo-100 text-[11px]">
                                {(log.workerCount ?? 0).toLocaleString('en-US')} thợ
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
