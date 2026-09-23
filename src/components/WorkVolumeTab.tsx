import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import * as XLSX from 'xlsx';
import { assertSafeExcelImportFile } from '../utils/excelImportUtils';
import { 
  BarChart3, 
  TrendingUp, 
  CheckCircle2, 
  Clock, 
  Plus, 
  Coins, 
  Building,
  Edit2,
  Trash2,
  FileText,
  FileSpreadsheet,
  Download,
  Upload,
  ChevronDown,
  Calendar,
  AlertTriangle,
  Bell,
  ArrowUpDown,
  Eye,
  X,
  Layers3
} from 'lucide-react';
import { WorkVolume, CategoryType, FloorPlan, RoomProgressItem } from '../types';
import { exportWorkVolumesTemplate } from '../utils/excelExport';
import { confirmAsync } from '../utils/confirmAsync';
import { formatDecimal, formatVND, evaluateMathExpression, useFormatSettings, parseVietnameseNumber, parseExcelNumber } from '../utils/numberUtils';
import { getTodayDateString, addDaysToDateString, formatDateVN, calculateDiffDays } from '../utils/dueDateUtils';
import { getCurrentUserRole, canViewFinancials, canManageWorkVolumeStructure, UserRole } from '../utils/securityUtils';
import { normalizeUnit, unitKey } from '../utils/unitUtils';
import { createEntityId } from '../utils/idUtils';
import { canonicalWorkCategoryId, validateWorkVolumeCatalog } from '../utils/linkageIntegrity';
import { computeWorkVolumeDetailBreakdown } from '../utils/workVolumeComputation';
import {
  getStructureGroupName,
  normalizeStructureGroupConfig,
  resolveFloorStructureGroupId,
  type ProjectStructureConfig,
} from '../utils/structureGroupUtils';

import { QuickSortBar } from './QuickSortBar';

interface WorkVolumeTabProps {
  workVolumes: WorkVolume[];
  floorPlans?: FloorPlan[];
  roomProgressList?: RoomProgressItem[];
  structureConfig: ProjectStructureConfig;
  projectName?: string;
  userRole?: UserRole;
  onAddWorkVolume: (item: Omit<WorkVolume, 'id'>) => void;
  onSaveWorkVolume?: (item: Omit<WorkVolume, 'id'> & { id?: string }) => void;
  onImportWorkVolumes?: (items: WorkVolume[]) => boolean;
  onUpdateActualVolume: (id: string, newActual: number) => void;
  onDeleteWorkVolume: (id: string) => void;
  onDeleteMultipleWorkVolumes?: (ids: string[]) => void;
  onOpenExportPdf?: () => void;
  onExportExcel?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const WorkVolumeTab: React.FC<WorkVolumeTabProps> = ({
  workVolumes,
  floorPlans = [],
  roomProgressList = [],
  structureConfig,
  projectName,
  userRole,
  onAddWorkVolume,
  onSaveWorkVolume,
  onImportWorkVolumes,
  onUpdateActualVolume,
  onDeleteWorkVolume,
  onDeleteMultipleWorkVolumes,
  onOpenExportPdf,
  onExportExcel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}) => {
  const { t } = useLanguage();
  const effectiveRole = userRole || getCurrentUserRole();
  const hasFinancialAccess = canViewFinancials(effectiveRole);
  const hasStructureManageAccess = canManageWorkVolumeStructure(effectiveRole);

  const floorOptions = useMemo(() => {
    if (!floorPlans || floorPlans.length === 0) {
      return ['Tầng 1', 'Tầng 2', 'Tầng 3', 'Tầng 4', 'Sảnh / Ngoại thất'];
    }
    return floorPlans.map(fp => fp.floorName);
  }, [floorPlans]);

  // Extract unique categories from workVolumes
  const availableCategories = useMemo(() => {
    const categories = new Set<string>();
    workVolumes.forEach((v) => {
      if (v.category && v.category.trim()) {
        categories.add(v.category.trim());
      }
    });
    return Array.from(categories);
  }, [workVolumes]);

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [volSortBy, setVolSortBy] = useState<'none' | 'title' | 'planned' | 'progress'>('none');
  const [volSortOrder, setVolSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingVolume, setEditingVolume] = useState<WorkVolume | null>(null);
  const [deletingVolumeTarget, setDeletingVolumeTarget] = useState<WorkVolume | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [isImportFromRoomsOpen, setIsImportFromRoomsOpen] = useState(false);
  const [selectedRoomIdsForImport, setSelectedRoomIdsForImport] = useState<string[]>([]);
  const normalizedStructureConfig = useMemo(() => normalizeStructureGroupConfig(structureConfig), [structureConfig]);
  const [detailVolumeTarget, setDetailVolumeTarget] = useState<WorkVolume | null>(null);
  const [detailStructureGroupIds, setDetailStructureGroupIds] = useState<string[]>([]);
  const [detailFloorIds, setDetailFloorIds] = useState<string[]>([]);
  const [detailRoomIds, setDetailRoomIds] = useState<string[]>([]);
  const [detailTeamNames, setDetailTeamNames] = useState<string[]>([]);
  const [detailSortBy, setDetailSortBy] = useState<'floor' | 'room' | 'team' | 'assigned' | 'actual' | 'progress'>('floor');
  const [detailSortOrder, setDetailSortOrder] = useState<'asc' | 'desc'>('asc');
  const [detailSearch, setDetailSearch] = useState<string>('');

  // Role changes can happen without remounting this tab. Never leave an ADMIN-only
  // modal/selection open after switching to EDITOR/VIEWER in the same browser session.
  useEffect(() => {
    if (hasStructureManageAccess) return;
    setSelectedItemIds([]);
    setShowAddForm(false);
    setEditingVolume(null);
    setDeletingVolumeTarget(null);
    setIsImportFromRoomsOpen(false);
    setSelectedRoomIdsForImport([]);
  }, [hasStructureManageAccess]);

  // New Work Volume Form State
  const [title, setTitle] = useState('');
  const [selectedFloors, setSelectedFloors] = useState<string[]>(() => [floorOptions[0] || 'Tầng 1']);
  const [isFloorDropdownOpen, setIsFloorDropdownOpen] = useState(false);
  const floorDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (floorDropdownRef.current && !floorDropdownRef.current.contains(event.target as Node)) {
        setIsFloorDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [category, setCategory] = useState<string>('khung_tran');
  const [unit, setUnit] = useState('m2');
  const [planned, setPlanned] = useState<number | ''>(350);
  const [plannedStr, setPlannedStr] = useState<string>('350');
  const [actual, setActual] = useState<number | ''>(0);
  const [unitPrice, setUnitPrice] = useState<number | ''>(110000);
  const [unitPriceStr, setUnitPriceStr] = useState<string>('110000');
  const [dueDate, setDueDate] = useState<string>('');

  // Keep floor state in sync with floorOptions
  useEffect(() => {
    if (!editingVolume && floorOptions.length > 0) {
      setSelectedFloors([floorOptions[0]]);
    }
  }, [floorOptions, editingVolume]);

  // Financial calculations
  const totals = useMemo(() => {
    let plannedValue = 0;
    let actualValue = 0;
    const byUnit: Record<string, { planned: number; actual: number; displayUnit: string }> = {};

    workVolumes.forEach((item) => {
      plannedValue += (item.planned || 0) * (item.unitPrice || 0);
      actualValue += (item.actual || 0) * (item.unitPrice || 0);
      const canonicalUnit = normalizeUnit(item.unit || 'Đơn vị') || 'Đơn vị';
      const key = unitKey(canonicalUnit) || 'đơn vị';
      if (!byUnit[key]) byUnit[key] = { planned: 0, actual: 0, displayUnit: canonicalUnit };
      byUnit[key].planned += item.planned || 0;
      byUnit[key].actual += item.actual || 0;
    });

    // Không cộng chéo m² + m + bộ + tấm. Chỉ dùng giá trị tiền làm mẫu số
    // khi TẤT CẢ hạng mục có kế hoạch đều có đơn giá; nếu thiếu dù chỉ một đơn giá,
    // dùng trung bình tiến độ theo nhóm đơn vị để không "bỏ quên" hạng mục chưa có giá.
    const plannedItems = workVolumes.filter((item) => (item.planned || 0) > 0);
    const canUseFinancialProgress = plannedItems.length > 0 && plannedItems.every((item) => (item.unitPrice || 0) > 0);
    let percent = 0;
    if (canUseFinancialProgress && plannedValue > 0) {
      percent = Math.round((actualValue / plannedValue) * 100);
    } else {
      const unitProgress = Object.values(byUnit)
        .filter((group) => group.planned > 0)
        .map((group) => Math.min(1, group.actual / group.planned));
      percent = unitProgress.length > 0
        ? Math.round((unitProgress.reduce((sum, value) => sum + value, 0) / unitProgress.length) * 100)
        : 0;
    }

    return { plannedValue, actualValue, byUnit, percent };
  }, [workVolumes]);

  const livePlannedCalc = useMemo(() => {
    if (/[+\-*/xX×:÷]/.test(plannedStr)) {
      return evaluateMathExpression(plannedStr);
    }
    return null;
  }, [plannedStr]);

  const liveUnitPriceCalc = useMemo(() => {
    if (/[+\-*/xX×:÷]/.test(unitPriceStr)) {
      return evaluateMathExpression(unitPriceStr);
    }
    return null;
  }, [unitPriceStr]);

  const filteredVolumes = useMemo(() => {
    if (selectedCategory === 'all') return workVolumes;
    return workVolumes.filter((item) => item.category === selectedCategory);
  }, [workVolumes, selectedCategory]);

  const detailBreakdown = useMemo(() => {
    if (!detailVolumeTarget) return null;
    return computeWorkVolumeDetailBreakdown(detailVolumeTarget, workVolumes, roomProgressList, floorPlans);
  }, [detailVolumeTarget, workVolumes, roomProgressList, floorPlans]);

  const detailVisibleFloorOptions = useMemo(() => {
    if (!detailBreakdown) return [];
    const ids = new Set(detailBreakdown.rows.map((row) => row.floorId));
    return floorPlans.filter((floor) => ids.has(floor.id)).filter((floor) => detailStructureGroupIds.length === 0 || detailStructureGroupIds.includes(resolveFloorStructureGroupId(floor, normalizedStructureConfig)));
  }, [detailBreakdown, floorPlans, detailStructureGroupIds, normalizedStructureConfig]);

  const detailVisibleRoomOptions = useMemo(() => {
    if (!detailBreakdown) return [];
    return detailBreakdown.rows.filter((row) => {
      const floor = floorPlans.find((item) => item.id === row.floorId);
      const groupId = floor ? resolveFloorStructureGroupId(floor, normalizedStructureConfig) : normalizedStructureConfig.defaultGroupId;
      return (detailStructureGroupIds.length === 0 || detailStructureGroupIds.includes(groupId)) && (detailFloorIds.length === 0 || detailFloorIds.includes(row.floorId));
    });
  }, [detailBreakdown, detailStructureGroupIds, detailFloorIds, floorPlans, normalizedStructureConfig]);

  const detailVisibleTeamOptions = useMemo(() => Array.from(new Set(detailVisibleRoomOptions.flatMap((row) => row.teamNames))).sort((a, b) => a.localeCompare(b, 'vi-VN', { numeric: true, sensitivity: 'base' })), [detailVisibleRoomOptions]);

  const detailRows = useMemo(() => {
    if (!detailBreakdown) return [];
    const query = detailSearch.trim().toLocaleLowerCase('vi-VN');
    return detailBreakdown.rows.filter((row) => {
      const floor = floorPlans.find((item) => item.id === row.floorId);
      const groupId = floor ? resolveFloorStructureGroupId(floor, normalizedStructureConfig) : normalizedStructureConfig.defaultGroupId;
      if (detailStructureGroupIds.length > 0 && !detailStructureGroupIds.includes(groupId)) return false;
      if (detailFloorIds.length > 0 && !detailFloorIds.includes(row.floorId)) return false;
      if (detailRoomIds.length > 0 && !detailRoomIds.includes(row.roomId)) return false;
      if (detailTeamNames.length > 0 && !row.teamNames.some((name) => detailTeamNames.includes(name))) return false;
      return !query || [row.roomName, row.floorName, ...row.teamNames].join(' ').toLocaleLowerCase('vi-VN').includes(query);
    }).sort((a, b) => {
      let comparison = 0;
      if (detailSortBy === 'room') comparison = a.roomName.localeCompare(b.roomName, 'vi-VN', { numeric: true, sensitivity: 'base' });
      else if (detailSortBy === 'team') comparison = (a.teamNames[0] || '').localeCompare(b.teamNames[0] || '', 'vi-VN', { numeric: true, sensitivity: 'base' });
      else if (detailSortBy === 'assigned') comparison = a.assignedVolume - b.assignedVolume;
      else if (detailSortBy === 'actual') comparison = a.actualVolume - b.actualVolume;
      else if (detailSortBy === 'progress') comparison = a.progressPercent - b.progressPercent;
      else comparison = a.floorName.localeCompare(b.floorName, 'vi-VN', { numeric: true, sensitivity: 'base' });
      return detailSortOrder === 'asc' ? comparison : -comparison;
    });
  }, [detailBreakdown, detailSearch, detailStructureGroupIds, detailFloorIds, detailRoomIds, detailTeamNames, detailSortBy, detailSortOrder, floorPlans, normalizedStructureConfig]);

  useEffect(() => { setDetailFloorIds((ids) => ids.filter((id) => detailVisibleFloorOptions.some((floor) => floor.id === id))); }, [detailVisibleFloorOptions]);
  useEffect(() => { setDetailRoomIds((ids) => ids.filter((id) => detailVisibleRoomOptions.some((row) => row.roomId === id))); }, [detailVisibleRoomOptions]);
  useEffect(() => { setDetailTeamNames((names) => names.filter((name) => detailVisibleTeamOptions.includes(name))); }, [detailVisibleTeamOptions]);

    const sortedFilteredVolumes = useMemo(() => {
    const volumes = [...filteredVolumes];
    if (volSortBy === 'none') return volumes;
    
    return volumes.sort((a, b) => {
      if (volSortBy === 'title') {
        const comp = a.title.localeCompare(b.title, 'vi', { numeric: true, sensitivity: 'base' });
        return volSortOrder === 'asc' ? comp : -comp;
      }
      if (volSortBy === 'planned') {
        const comp = a.planned - b.planned;
        return volSortOrder === 'asc' ? comp : -comp;
      }
      if (volSortBy === 'progress') {
        const progressA = a.planned > 0 ? a.actual / a.planned : 0;
        const progressB = b.planned > 0 ? b.actual / b.planned : 0;
        const comp = progressA - progressB;
        return volSortOrder === 'asc' ? comp : -comp;
      }
      return 0;
    });
  }, [filteredVolumes, volSortBy, volSortOrder]);

  const handleCloseModal = async () => {
    setShowAddForm(false);
    setEditingVolume(null);
    setTitle('');
    setSelectedFloors([floorOptions[0] || 'Tầng 1']);
    setCategory('khung_tran');
    setUnit('m2');
    setPlanned(350);
    setPlannedStr('350');
    setActual(0);
    setUnitPrice(110000);
    setUnitPriceStr('110000');
    setDueDate('');
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasStructureManageAccess) {
      alert('Chỉ ADMIN được tạo hoặc sửa định nghĩa hạng mục khối lượng. Kỹ sư cập nhật tiến độ tại Mặt bằng.');
      handleCloseModal();
      return;
    }

    const parsedPlanned = evaluateMathExpression(plannedStr);
    if (plannedStr.trim() && parsedPlanned === null) {
      alert('Khối lượng định mức có công thức/số không hợp lệ. Ví dụ: 100*5 hoặc 1220/3.');
      return;
    }
    const finalPlanned = parsedPlanned ?? Number(planned);

    const parsedUnitPrice = unitPriceStr.trim() ? evaluateMathExpression(unitPriceStr) : 0;
    if (unitPriceStr.trim() && parsedUnitPrice === null) {
      alert('Đơn giá có công thức/số không hợp lệ. Vui lòng kiểm tra lại trước khi lưu.');
      return;
    }
    const finalUnitPrice = parsedUnitPrice ?? 0;

    if (!title.trim() || !finalPlanned || finalPlanned <= 0) {
      alert('Vui lòng điền tên hạng mục và khối lượng định mức hợp lệ!');
      return;
    }

    const floorNames = selectedFloors.length > 0 ? selectedFloors : ['Tầng 1'];
    const matchedFloorIds = floorNames.map(fName => floorPlans?.find(fp => (fp.floorName || fp.id) === fName)?.id || fName);
    const assignedWorkCategoryId = editingVolume?.workCategoryId || createEntityId('CAT');

    if (editingVolume) {
      if (onSaveWorkVolume) {
        onSaveWorkVolume({
          id: editingVolume.id,
          workCategoryId: assignedWorkCategoryId,
          floorIds: matchedFloorIds,
          title: title.trim(),
          floor: floorNames.join(', '),
          category,
          unit: normalizeUnit(unit) || unit,
          planned: finalPlanned,
          actual: Number(actual || 0),
          unitPrice: finalUnitPrice,
          status: Number(actual) >= finalPlanned ? 'Đã hoàn thành' : Number(actual) > 0 ? 'Đang thi công' : 'Chưa thi công',
          dueDate: dueDate ? dueDate : undefined,
        });
      }
    } else {
      onAddWorkVolume({
        workCategoryId: assignedWorkCategoryId,
        floorIds: matchedFloorIds,
        title: title.trim(),
        floor: floorNames.join(', '),
        category,
        unit: normalizeUnit(unit) || unit,
        planned: finalPlanned,
        actual: Number(actual || 0),
        unitPrice: finalUnitPrice,
        status: Number(actual) >= finalPlanned ? 'Đã hoàn thành' : Number(actual) > 0 ? 'Đang thi công' : 'Chưa thi công',
        dueDate: dueDate ? dueDate : undefined,
      });
    }

    handleCloseModal();
  };

  const handleImportExcelWorkVolumes = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!hasStructureManageAccess) {
      alert('⚠️ Chỉ ADMIN được nhập Excel để thay đổi cấu trúc hạng mục khối lượng.');
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    try { assertSafeExcelImportFile(file); } catch (error) {
      alert(`❌ ${error instanceof Error ? error.message : 'Tệp Excel không hợp lệ.'}`);
      e.target.value = '';
      return;
    }

    const normalizeDate = (raw: unknown): string | undefined => {
      const value = String(raw ?? '').trim();
      if (!value) return undefined;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      const match = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
      if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
      return undefined;
    };

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any>(worksheet);
        if (!rows.length) throw new Error('Tệp Excel không có dữ liệu.');

        const headers = Object.keys(rows[0]);
        const titleKey = headers.find((header) =>
          ['Tên hạng mục Công Việc', 'Tên hạng mục Thi Công', 'Hạng Mục Công Việc', 'Tên Hạng Mục', 'Hạng mục', 'title']
            .some((candidate) => header.toLocaleLowerCase('vi-VN').includes(candidate.toLocaleLowerCase('vi-VN'))),
        );
        if (!titleKey) throw new Error(`Không tìm thấy cột Tên Hạng Mục. Các cột hiện có: ${headers.join(', ')}`);

        const upserts: WorkVolume[] = [];
        const touchedIds = new Set<string>();
        let updatedCount = 0;
        let addedCount = 0;

        rows.forEach((row: any, rowIndex: number) => {
          const title = String(row[titleKey] || '').trim();
          if (!title) return;
          const rawRecordId = String(row['__recordId'] || row['Mã Hạng Mục'] || row['id'] || '').trim();
          const rawCategoryId = String(row['__workCategoryId'] || row['workCategoryId'] || '').trim();
          const floorText = String(row['Tầng / Khu Vực'] || row['Tầng'] || row['floor'] || '').trim();
          const unit = normalizeUnit(String(row['Đơn Vị Tính'] || row['Đơn vị Tính'] || row['Đơn vị'] || row['unit'] || 'm²').trim()) || 'm²';

          let existing: WorkVolume | undefined;
          if (rawRecordId) existing = workVolumes.find((work) => work.id === rawRecordId);
          if (!existing && rawCategoryId) {
            const matches = workVolumes.filter((work) => canonicalWorkCategoryId(work) === rawCategoryId);
            if (matches.length > 1) throw new Error(`Dòng ${rowIndex + 2}: __workCategoryId ${rawCategoryId} không duy nhất.`);
            existing = matches[0];
          }
          if (!existing && !rawRecordId && !rawCategoryId) {
            const matches = workVolumes.filter((work) =>
              work.title.trim().toLocaleLowerCase('vi-VN') === title.toLocaleLowerCase('vi-VN')
              && work.floor.trim().toLocaleLowerCase('vi-VN') === floorText.toLocaleLowerCase('vi-VN')
              && (normalizeUnit(work.unit) || work.unit) === unit,
            );
            if (matches.length > 1) throw new Error(`Dòng ${rowIndex + 2}: hạng mục legacy ${title} / ${floorText} / ${unit} bị mơ hồ.`);
            existing = matches[0];
          }

          const rawFloorId = String(row['__floorId'] || row['floorId'] || '').trim();
          const rawFloorIds = String(row['__floorIds'] || row['floorIds'] || '').trim();
          let floorIds: string[] = [];
          if (rawFloorIds) {
            try {
              const parsed = rawFloorIds.startsWith('[') ? JSON.parse(rawFloorIds) : rawFloorIds.split(',');
              if (Array.isArray(parsed)) floorIds = parsed.map((value) => String(value || '').trim()).filter(Boolean);
            } catch {
              floorIds = rawFloorIds.split(',').map((value) => value.trim()).filter(Boolean);
            }
          }
          if (rawFloorId && !floorIds.includes(rawFloorId)) floorIds.unshift(rawFloorId);
          if (floorIds.length === 0 && floorText) {
            floorIds = floorText.split(/[,;\n]+/).map((name) => name.trim()).filter(Boolean)
              .map((name) => floorPlans.find((floor) => floor.floorName === name)?.id)
              .filter((value): value is string => Boolean(value));
          }

          const recordId = existing?.id || rawRecordId || createEntityId('HM');
          if (touchedIds.has(recordId)) throw new Error(`Dòng ${rowIndex + 2}: record ID ${recordId} xuất hiện nhiều lần trong cùng file.`);
          touchedIds.add(recordId);
          const categoryId = existing ? canonicalWorkCategoryId(existing) : (rawCategoryId || recordId);
          const plannedParsed = parseExcelNumber(row['KL Định Mức'] ?? row['Khối lượng định mức'] ?? row['Khối lượng kế hoạch'] ?? row['planned']);
          const priceParsed = parseExcelNumber(row['Đơn Giá (VNĐ)'] ?? row['Đơn Giá'] ?? row['unitPrice']);
          const planned = Number.isFinite(plannedParsed) ? Math.max(0, plannedParsed) : Math.max(0, Number(existing?.planned || 0));
          const unitPrice = Number.isFinite(priceParsed) ? priceParsed : Number(existing?.unitPrice || 0);
          const dueDateRaw = row['Ngày Hạn Định'] ?? row['Hạn Định'] ?? row['Hạn Hoàn Thành'] ?? row['dueDate'];
          const dueDate = dueDateRaw === undefined || String(dueDateRaw).trim() === '' ? existing?.dueDate : normalizeDate(dueDateRaw);
          if (dueDateRaw && !dueDate) throw new Error(`Dòng ${rowIndex + 2}: ngày hạn không hợp lệ (${String(dueDateRaw)}).`);

          upserts.push({
            ...(existing || {} as WorkVolume),
            id: recordId,
            workCategoryId: categoryId,
            title,
            floor: floorText || existing?.floor || '',
            floorId: floorIds[0] || existing?.floorId,
            floorIds: floorIds.length > 0 ? Array.from(new Set(floorIds)) : existing?.floorIds,
            category: String(row['Nhóm Hạng Mục'] || row['Nhóm hạng mục'] || row['Phân Loại'] || row['category'] || existing?.category || 'khung_tran').trim() as CategoryType,
            unit,
            planned,
            // Excel actual/status are reporting fields only; never import them into master.
            actual: existing?.actual || 0,
            status: existing?.status || 'Chưa thi công',
            unitPrice,
            dueDate,
          });
          if (existing) updatedCount += 1; else addedCount += 1;
        });

        if (upserts.length === 0) throw new Error('Không có dòng hạng mục hợp lệ để nhập.');
        const byId = new Map<string, WorkVolume>(workVolumes.map((work) => [work.id, work] as const));
        upserts.forEach((work) => byId.set(work.id, work));
        const finalCatalog = Array.from(byId.values());
        const issues = validateWorkVolumeCatalog(finalCatalog);
        if (issues.length > 0) throw new Error(issues.map((issue) => issue.message).join('\n'));

        const confirmed = await confirmAsync(
          `Đã preflight toàn bộ file: ${updatedCount} cập nhật, ${addedCount} thêm mới.\n\n` +
          'Không import actual/status; ID hạng mục và phạm vi tầng được giữ authoritative. Tiếp tục ghi một lần?',
        );
        if (!confirmed) return;
        if (!onImportWorkVolumes) throw new Error('Phiên bản ứng dụng chưa hỗ trợ import atomic WorkVolume.');
        if (!onImportWorkVolumes(upserts)) throw new Error('Catalog thay đổi trong lúc import; hệ thống đã hủy toàn bộ, chưa ghi dòng nào.');
        alert(`🎉 Nhập Khối lượng thành công: ${updatedCount} cập nhật, ${addedCount} thêm mới.`);
      } catch (err: any) {
        alert(`❌ Import Khối lượng bị hủy trước khi ghi dữ liệu:\n${err?.message || String(err)}`);
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  useFormatSettings();

  return (
    <div className="p-4 space-y-4 pb-24 w-full max-w-6xl mx-auto">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            {t('volume_title')}
          </h2>
          <p className="text-xs text-slate-500">{t('volume_subtitle')}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => exportWorkVolumesTemplate(workVolumes, projectName, hasFinancialAccess)}
            className="text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-white hover:bg-slate-50 px-2.5 py-1.5 rounded-xl flex items-center gap-1 border border-slate-200 transition-all active:scale-95 shadow-2xs cursor-pointer"
            title={hasStructureManageAccess ? 'Tải tệp Excel chứa dữ liệu hiện tại để chỉnh sửa' : 'Tải tệp Excel để chỉnh sửa ngoại tuyến (không kèm đơn giá)'}
          >
            <Download className="w-3.5 h-3.5" /> Tải Excel để chỉnh sửa
          </button>
          {hasStructureManageAccess && (
            <>
              <label className="text-xs font-bold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-xl flex items-center gap-1 border border-emerald-200 cursor-pointer transition-all active:scale-95 shadow-2xs">
                <Upload className="w-3.5 h-3.5" /> Nhập lại từ Excel
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  onChange={handleImportExcelWorkVolumes}
                  className="hidden"
                />
              </label>
              <button
                onClick={async () => {
                  setTitle('');
                  setSelectedFloors([floorOptions[0] || 'Tầng 1']);
                  setCategory('khung_tran');
                  setUnit('m2');
                  setPlanned(350);
                  setPlannedStr('350');
                  setActual(0);
                  setUnitPrice(110000);
                  setUnitPriceStr('110000');
                  setEditingVolume(null);
                  setShowAddForm(true);
                }}
                className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1.5 rounded-xl text-xs font-bold shadow active:scale-95 transition-all"
              >
                <Plus className="w-4 h-4" />
                Thêm
              </button>
            </>
          )}
        </div>
      </div>

      {/* Contract & Progress Overview Dashboard */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 text-white rounded-2xl p-4 shadow-lg space-y-3">
        <div className="flex items-center justify-between border-b border-slate-700/80 pb-2">
          <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            {hasFinancialAccess ? 'Tổng giá trị & tiến độ sản lượng' : 'Tổng hợp tiến độ khối lượng'}
          </span>
          <span className="text-[11px] font-extrabold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/40">
            {totals.percent}% Hoàn Thành
          </span>
        </div>

        {/* Progress Bar */}
        <div>
          <div className="w-full bg-slate-700/80 h-2.5 rounded-full overflow-hidden p-0.5">
            <div 
              className="bg-gradient-to-r from-blue-500 to-emerald-400 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, totals.percent)}%` }}
            />
          </div>
        </div>

        {hasFinancialAccess ? (
          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
            <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
              <p className="text-[10px] text-slate-400">Giá trị định mức</p>
              <p className="text-sm font-extrabold text-slate-100">{formatVND(totals.plannedValue)}</p>
            </div>
            <div className="bg-emerald-950/60 p-2.5 rounded-xl border border-emerald-700/40">
              <p className="text-[10px] text-emerald-300">Khối lượng đã thực hiện</p>
              <p className="text-sm font-extrabold text-emerald-400">{formatVND(totals.actualValue)}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
            {Object.entries(totals.byUnit).length > 0 ? (Object.entries(totals.byUnit) as Array<[string, { planned: number; actual: number; displayUnit: string }]>).map(([unitName, values]) => (
              <div key={unitName} className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-slate-400">Khối lượng · {unitName}</p>
                  <span className="text-[10px] font-extrabold text-emerald-300">
                    {values.planned > 0 ? Math.min(100, Math.round((values.actual / values.planned) * 100)) : 0}%
                  </span>
                </div>
                <p className="text-sm font-extrabold text-slate-100">
                  <span className="text-emerald-400">{formatDecimal(values.actual)}</span> / {formatDecimal(values.planned)} {values.displayUnit}
                </p>
              </div>
            )) : (
              <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60 text-slate-400">Chưa có dữ liệu khối lượng.</div>
            )}
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      {availableCategories.length > 0 && (
        <div className="flex gap-1 overflow-x-auto pb-1 text-xs no-scrollbar">
          {['all', ...availableCategories].map((catId) => {
            const label = catId === 'all' ? 'Tất cả' : 
                          catId === 'khung_tran' ? ' Khung Trần' : 
                          catId === 'ban_tam' ? ' Bắn Tấm' : 
                          catId === 'son_ba' ? ' Sơn Bả' : catId;
            return (
              <button
                key={catId}
                onClick={() => setSelectedCategory(catId)}
                className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all ${
                  selectedCategory === catId
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Quick Sort Work Volumes */}
      <QuickSortBar
        itemCount={sortedFilteredVolumes.length}
        options={[
          { key: 'title', label: 'Tên hạng mục', kind: 'alpha' },
          { key: 'planned', label: 'Khối lượng', kind: 'number' },
          { key: 'progress', label: 'Tiến độ', kind: 'number' },
        ]}
        activeKey={volSortBy === 'none' ? null : volSortBy}
        order={volSortOrder}
        onChange={(key, order) => { setVolSortBy(key); setVolSortOrder(order); }}
        onToggleOrder={() => setVolSortOrder((order) => order === 'asc' ? 'desc' : 'asc')}
        onReset={() => { setVolSortBy('none'); setVolSortOrder('asc'); }}
      />

      {/* Items List */}
      <div className="space-y-3">
        {sortedFilteredVolumes.length > 0 && (
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs gap-2">
            {hasStructureManageAccess ? (
              <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sortedFilteredVolumes.length > 0 && sortedFilteredVolumes.every(item => selectedItemIds.includes(item.id))}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedItemIds(prev => Array.from(new Set([...prev, ...sortedFilteredVolumes.map(item => item.id)])));
                    } else {
                      setSelectedItemIds(prev => prev.filter(id => !sortedFilteredVolumes.some(item => item.id === id)));
                    }
                  }}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <span>Chọn tất cả trên trang ({sortedFilteredVolumes.length})</span>
              </label>
            ) : (
              <span className="font-bold text-slate-500">{sortedFilteredVolumes.length} hạng mục</span>
            )}

            <div className="flex items-center gap-3 justify-end">
              {hasStructureManageAccess && selectedItemIds.some(id => sortedFilteredVolumes.some(item => item.id === id)) && (
                <button
                  type="button"
                  onClick={async () => {
                    const idsToDelete = selectedItemIds.filter(id => sortedFilteredVolumes.some(item => item.id === id));
                    if (await confirmAsync(`Bạn có chắc muốn xóa ${idsToDelete.length} hạng mục đã chọn?`)) {
                      if (onDeleteMultipleWorkVolumes) {
                        onDeleteMultipleWorkVolumes(idsToDelete);
                      } else {
                        idsToDelete.forEach(id => onDeleteWorkVolume(id));
                      }
                      setSelectedItemIds(prev => prev.filter(id => !idsToDelete.includes(id)));
                    }
                  }}
                  className="text-rose-600 hover:text-rose-700 font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Xóa đã chọn ({selectedItemIds.filter(id => sortedFilteredVolumes.some(item => item.id === id)).length})
                </button>
              )}
            </div>
          </div>
        )}

        {sortedFilteredVolumes.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 text-center text-slate-400 text-xs border border-dashed border-slate-300">
            Chưa có hạng mục khối lượng nào phù hợp
          </div>
        ) : (
          sortedFilteredVolumes.map((item) => {
            const itemPercent = item.planned > 0 ? Math.min(100, Math.round((item.actual / item.planned) * 100)) : 0;
            const isDone = item.planned > 0 && item.actual >= item.planned;

            return (
              <div
                key={item.id}
                className={`bg-white rounded-2xl p-3.5 border transition-all duration-150 space-y-2.5 ${
                  selectedItemIds.includes(item.id)
                    ? 'border-indigo-300 bg-indigo-50/10 shadow-xs'
                    : 'border-slate-200 shadow-sm'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {hasStructureManageAccess && (
                    <input
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
                    />
                  )}

                  <div className="flex-1 min-w-0 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="bg-slate-100 text-slate-700 font-extrabold text-[10px] px-1.5 py-0.5 rounded">
                            {item.floor}
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            isDone 
                              ? 'bg-emerald-100 text-emerald-800' 
                              : item.actual > 0 
                              ? 'bg-blue-100 text-blue-800' 
                              : 'bg-slate-100 text-slate-500'
                          }`}>
                            {isDone ? 'Đã hoàn thành' : item.actual > 0 ? 'Đang thi công' : 'Chưa làm'}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-slate-900 leading-snug">{item.title}</h4>

                        {/* Due Date Badge */}
                        {item.dueDate && (
                          <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                            {(() => {
                              const diffDays = calculateDiffDays(item.dueDate);
                              if (isDone) {
                                return (
                                  <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md font-bold border border-emerald-200 flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                                    Hạn: {formatDateVN(item.dueDate)} (Đã xong)
                                  </span>
                                );
                              }
                              if (diffDays < 0) {
                                return (
                                  <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded-md font-extrabold border border-rose-300 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0 animate-bounce" />
                                    Quá hạn {Math.abs(diffDays)} ngày ({formatDateVN(item.dueDate)})
                                  </span>
                                );
                              }
                              if (diffDays === 0) {
                                return (
                                  <span className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md font-extrabold border border-amber-300 flex items-center gap-1">
                                    <Clock className="w-3 h-3 text-amber-600 shrink-0 animate-pulse" />
                                    Hạn hôm nay ({formatDateVN(item.dueDate)})
                                  </span>
                                );
                              }
                              if (diffDays <= 3) {
                                return (
                                  <span className="bg-amber-50 text-amber-800 px-2 py-0.5 rounded-md font-bold border border-amber-200 flex items-center gap-1">
                                    <Bell className="w-3 h-3 text-amber-600 shrink-0" />
                                    Còn {diffDays} ngày ({formatDateVN(item.dueDate)})
                                  </span>
                                );
                              }
                              return (
                                <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-medium border border-slate-200 flex items-center gap-1">
                                  <Calendar className="w-3 h-3 text-slate-500 shrink-0" />
                                  Hạn: {formatDateVN(item.dueDate)}
                                </span>
                              );
                            })()}
                          </div>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-xs font-extrabold text-blue-600">
                          {itemPercent}%
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar per item */}
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-300 ${
                          isDone ? 'bg-emerald-500' : 'bg-blue-600'
                        }`}
                        style={{ width: `${itemPercent}%` }}
                      />
                    </div>

                    {/* Numerical breakdown */}
                    <div className="flex flex-wrap items-center justify-between text-xs bg-slate-50 p-2 rounded-xl gap-2">
                      <div>
                        <span className="text-slate-500 text-[11px]">Thực hiện: </span>
                        <span className="font-extrabold text-slate-900">
                          {formatDecimal(item.actual)} / {formatDecimal(item.planned)} {item.unit}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        {item.actual > item.planned ? (
                          <span className="text-[11px] font-extrabold text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-md border border-amber-200">
                            Vượt KH: +{formatDecimal(item.actual - item.planned)} {item.unit}
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                            Còn lại: {formatDecimal(item.planned - item.actual)} {item.unit}
                          </span>
                        )}
                        {hasFinancialAccess && (
                          <div>
                            <span className="text-slate-500 text-[11px]">Đơn giá: </span>
                            <span className="font-semibold text-slate-700">{formatVND(item.unitPrice)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Sub-items pulled from apartments */}
                    {item.subItems && item.subItems.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-100">
                        <span className="text-[10px] font-bold text-slate-500">Hạng mục con:</span>
                        {item.subItems.map((sub, sIdx) => (
                          <span key={sIdx} className="bg-indigo-50 text-indigo-700 text-[10px] px-2 py-0.5 rounded-full font-medium">
                            {sub}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Action and financial details */}
                    <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs gap-2 flex-wrap">
                      {hasFinancialAccess ? (
                        <span className="text-[11px] text-slate-500">
                          Thành tiền: <strong className="text-slate-800">{formatVND((item.actual ?? 0) * (item.unitPrice ?? 0))}</strong>
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          Hạng mục: {item.category || 'Chung'}
                        </span>
                      )}
                      <div className="flex items-center gap-2 ml-auto">
                        <button
                          type="button"
                          onClick={() => {
                            setDetailVolumeTarget(item);
                            setDetailStructureGroupIds([]);
                            setDetailFloorIds([]);
                            setDetailRoomIds([]);
                            setDetailTeamNames([]);
                            setDetailSortBy('floor');
                            setDetailSortOrder('asc');
                            setDetailSearch('');
                          }}
                          className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-extrabold text-[11px]"
                          title="Xem chi tiết khối lượng theo Khu/Khối, Tầng, Căn/Phòng và đội"
                        >
                          <Eye className="w-3.5 h-3.5" /> Xem chi tiết
                        </button>
                      {hasStructureManageAccess && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              setEditingVolume(item);
                              setTitle(item.title);
                              setSelectedFloors(item.floor ? item.floor.split(',').map(s => s.trim()).filter(Boolean) : [floorOptions[0] || 'Tầng 1']);
                              setCategory(item.category);
                              setUnit(item.unit);
                              setPlanned(item.planned);
                              setPlannedStr(item.planned.toString());
                              setActual(item.actual);
                              setUnitPrice(item.unitPrice);
                              setUnitPriceStr(item.unitPrice.toString());
                              setDueDate(item.dueDate || '');
                            }}
                            className="text-amber-600 hover:text-amber-800 flex items-center gap-1 font-semibold text-[11px]"
                            title="Chỉnh sửa thông tin hạng mục"
                          >
                            <Edit2 className="w-3 h-3" /> Sửa thông tin
                          </button>
                          <button
                            onClick={() => setDeletingVolumeTarget(item)}
                            className="text-rose-500 hover:text-rose-700 p-1"
                            title="Xóa hạng mục khối lượng"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add / Edit Work Volume Modal */}
      {hasStructureManageAccess && (showAddForm || editingVolume !== null) && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-xl md:max-w-2xl rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-slate-900">
                {editingVolume ? 'Sửa hạng mục khối lượng' : 'Thêm hạng mục khối lượng'}
              </h3>
              <button
                onClick={handleCloseModal}
                className="w-8 h-8 bg-slate-100 rounded-full font-bold text-slate-500"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Tên hạng mục Công Việc *</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Thi công khung trần chìm Tầng 3"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-medium"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-700 font-bold mb-1 flex items-center justify-between">
                    <span>Vị trí tầng</span>
                    {floorPlans && floorPlans.length > 0 && (
                      <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 font-bold">
                        Đồng bộ từ Mặt bằng
                      </span>
                    )}
                  </label>
                  <div className="relative" ref={floorDropdownRef}>
                    <div 
                      className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-slate-800 bg-white cursor-pointer flex justify-between items-center"
                      onClick={() => setIsFloorDropdownOpen(!isFloorDropdownOpen)}
                    >
                      <span className="truncate">
                        {selectedFloors.length > 0 ? selectedFloors.join(', ') : 'Chọn tầng...'}
                      </span>
                      <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0" />
                    </div>
                    {isFloorDropdownOpen && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
                        {floorOptions.map(fName => (
                          <div 
                            key={fName} 
                            className="p-2.5 flex items-center hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
                            onClick={() => {
                              setSelectedFloors(prev => {
                                if (prev.includes(fName)) {
                                  const next = prev.filter(f => f !== fName);
                                  return next.length > 0 ? next : [fName]; // Prevent empty
                                }
                                return [...prev, fName];
                              });
                            }}
                          >
                            <input 
                              type="checkbox" 
                              checked={selectedFloors.includes(fName)} 
                              readOnly 
                              className="mr-2.5 w-4 h-4 text-blue-600 rounded border-slate-300"
                            />
                            <span className="font-medium text-slate-700 truncate">{fName}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Nhóm hạng mục</label>
                  <input
                    type="text"
                    list="category-options"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-indigo-700"
                    placeholder="Nhập hoặc chọn nhóm"
                  />
                  <datalist id="category-options">
                    {availableCategories.map(catId => (
                      <option key={catId} value={catId}>
                        {catId === 'khung_tran' ? 'Khung Trần' : 
                         catId === 'ban_tam' ? 'Bắn Tấm' : 
                         catId === 'son_ba' ? 'Sơn Bả' : catId}
                      </option>
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                <div>
                  <div className="h-6 flex items-center justify-between text-slate-700 font-bold text-[11px] sm:text-xs truncate mb-1">
                    <span>Khối lượng định mức *</span>
                    {livePlannedCalc !== null && (
                      <span className="text-blue-600 bg-blue-50 px-1 py-0.5 rounded text-[9px] font-extrabold animate-pulse" title="Kết quả tính toán">
                        = {formatDecimal(livePlannedCalc)}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={plannedStr}
                    onChange={(e) => {
                      const typedVal = e.target.value;
                      setPlannedStr(typedVal);
                      const parsed = evaluateMathExpression(typedVal);
                      setPlanned(parsed !== null ? parsed : (typedVal === '' ? '' : Number(typedVal)));
                    }}
                    onBlur={() => {
                      const parsed = evaluateMathExpression(plannedStr);
                      if (parsed !== null) {
                        setPlanned(parsed);
                        setPlannedStr(formatDecimal(parsed));
                      }
                    }}
                    className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-blue-600 focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <div className="h-6 flex items-center justify-between gap-1 text-slate-700 font-bold text-[11px] sm:text-xs truncate mb-1">
                    <span className="truncate">Khối lượng đã làm</span>
                    <span className="text-[9px] text-emerald-600 font-semibold bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100 shrink-0" title="Khối lượng thực hiện tự động cập nhật từ Mặt bằng">🔗 MB</span>
                  </div>
                  <input
                    type="text"
                    value={actual !== '' ? formatDecimal(Number(actual)) : '0'}
                    disabled
                    readOnly
                    className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-slate-50 text-slate-500 cursor-not-allowed text-center"
                    title="Khối lượng thực hiện tự động cập nhật từ danh sách nghiệm thu ở mục Mặt bằng"
                  />
                </div>
                <div>
                  <div className="h-6 flex items-center text-slate-700 font-bold text-[11px] sm:text-xs truncate mb-1">
                    Đơn vị
                  </div>
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2.5"
                  />
                </div>
              </div>

              {hasFinancialAccess && (
                <div>
                  <label className="block text-slate-700 font-bold mb-1 flex items-center justify-between">
                    <span>Đơn giá VNĐ / {unit}</span>
                    {liveUnitPriceCalc !== null && (
                      <span className="text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded text-[9px] font-extrabold animate-pulse" title="Kết quả tính toán">
                        = {formatDecimal(liveUnitPriceCalc)}
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={unitPriceStr}
                    onChange={(e) => {
                      const typedVal = e.target.value;
                      setUnitPriceStr(typedVal);
                      const parsed = evaluateMathExpression(typedVal);
                      setUnitPrice(parsed !== null ? parsed : (typedVal === '' ? '' : Number(typedVal)));
                    }}
                    onBlur={() => {
                      const parsed = evaluateMathExpression(unitPriceStr);
                      if (parsed !== null) {
                        setUnitPrice(parsed);
                        setUnitPriceStr(formatDecimal(parsed));
                      }
                    }}
                    className="w-full border border-slate-200 rounded-xl p-2.5 font-bold focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              {/* Ngày Hạn Định (DueDate) */}
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-slate-800 font-extrabold text-xs flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    <span>Hạn hoàn thành</span>
                  </label>
                  {dueDate && (
                    <button
                      type="button"
                      onClick={() => setDueDate('')}
                      className="text-[11px] text-rose-600 hover:underline font-bold cursor-pointer"
                    >
                      ✕ Xóa hạn
                    </button>
                  )}
                </div>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl p-2 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
                />
                <div className="flex items-center gap-1.5 flex-wrap text-[10px] pt-0.5">
                  <span className="text-slate-500 font-semibold">Chọn nhanh:</span>
                  <button
                    type="button"
                    onClick={() => setDueDate(getTodayDateString())}
                    className="px-2 py-1 bg-white hover:bg-slate-200 border border-slate-200 rounded-lg font-bold text-slate-700 cursor-pointer shadow-2xs"
                  >
                    Hôm nay
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueDate(addDaysToDateString(getTodayDateString(), 1))}
                    className="px-2 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg font-bold text-blue-700 cursor-pointer shadow-2xs"
                  >
                    +1 ngày
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueDate(addDaysToDateString(getTodayDateString(), 3))}
                    className="px-2 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg font-bold text-amber-700 cursor-pointer shadow-2xs"
                  >
                    +3 ngày
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueDate(addDaysToDateString(getTodayDateString(), 7))}
                    className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg font-bold text-emerald-700 cursor-pointer shadow-2xs"
                  >
                    +7 ngày
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 py-3 bg-slate-100 rounded-xl font-bold text-slate-600"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-md"
                >
                  {editingVolume ? 'Cập nhật hạng mục' : 'Tạo hạng mục'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detailVolumeTarget && detailBreakdown && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-900/65 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-2xl md:max-w-3xl lg:max-w-5xl rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[94vh] overflow-hidden flex flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Layers3 className="w-4 h-4 text-indigo-600 shrink-0" />
                  <h3 className="font-extrabold text-slate-900 truncate">Chi tiết khối lượng · {detailVolumeTarget.title}</h3>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Tổng danh mục: <strong>{formatDecimal(detailVolumeTarget.actual)}</strong> / {formatDecimal(detailVolumeTarget.planned)} {detailVolumeTarget.unit}
                  {' · '}Phân bổ qua Căn/Phòng: <strong>{formatDecimal(detailBreakdown.totalActual)}</strong> / {formatDecimal(detailBreakdown.totalAssigned)} {detailVolumeTarget.unit}
                </p>
              </div>
              <button type="button" onClick={() => setDetailVolumeTarget(null)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500" aria-label="Đóng chi tiết khối lượng">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 sm:p-4 border-b border-slate-200 bg-slate-50/80 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {normalizedStructureConfig.enabled && (
                  <details className="rounded-xl border border-slate-200 bg-white p-2 text-xs">
                    <summary className="cursor-pointer font-bold text-slate-700">{normalizedStructureConfig.label} · {detailStructureGroupIds.length || 'Tất cả'}</summary>
                    <div className="mt-2 max-h-36 overflow-auto space-y-1">{normalizedStructureConfig.groups.map((group) => <label key={group.id} className="flex gap-2"><input type="checkbox" checked={detailStructureGroupIds.includes(group.id)} onChange={() => setDetailStructureGroupIds((ids) => ids.includes(group.id) ? ids.filter((id) => id !== group.id) : [...ids, group.id])} />{group.name}</label>)}</div>
                  </details>
                )}
                <details className="rounded-xl border border-slate-200 bg-white p-2 text-xs">
                  <summary className="cursor-pointer font-bold text-slate-700">Tầng · {detailFloorIds.length || 'Tất cả'}</summary>
                  <div className="mt-2 max-h-36 overflow-auto space-y-1">{detailVisibleFloorOptions.map((floor) => <label key={floor.id} className="flex gap-2"><input type="checkbox" checked={detailFloorIds.includes(floor.id)} onChange={() => setDetailFloorIds((ids) => ids.includes(floor.id) ? ids.filter((id) => id !== floor.id) : [...ids, floor.id])} />{floor.floorName}</label>)}</div>
                </details>
                <details className="rounded-xl border border-slate-200 bg-white p-2 text-xs">
                  <summary className="cursor-pointer font-bold text-slate-700">Căn/Phòng · {detailRoomIds.length || 'Tất cả'}</summary>
                  <div className="mt-2 max-h-36 overflow-auto space-y-1">{detailVisibleRoomOptions.map((row) => <label key={row.roomId} className="flex gap-2"><input type="checkbox" checked={detailRoomIds.includes(row.roomId)} onChange={() => setDetailRoomIds((ids) => ids.includes(row.roomId) ? ids.filter((id) => id !== row.roomId) : [...ids, row.roomId])} />{row.roomName}</label>)}</div>
                </details>
                <details className="rounded-xl border border-slate-200 bg-white p-2 text-xs">
                  <summary className="cursor-pointer font-bold text-slate-700">Đội · {detailTeamNames.length || 'Tất cả'}</summary>
                  <div className="mt-2 max-h-36 overflow-auto space-y-1">{detailVisibleTeamOptions.map((name) => <label key={name} className="flex gap-2"><input type="checkbox" checked={detailTeamNames.includes(name)} onChange={() => setDetailTeamNames((names) => names.includes(name) ? names.filter((item) => item !== name) : [...names, name])} />{name}</label>)}</div>
                </details>
              </div>
              <input value={detailSearch} onChange={(event) => setDetailSearch(event.target.value)} placeholder="Tìm Căn/Phòng hoặc đội..." className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700" />
              <QuickSortBar
                itemCount={detailRows.length}
                minItems={0}
                options={[
                  { key: 'floor', label: 'Tầng', kind: 'floor' },
                  { key: 'room', label: 'Căn/Phòng', kind: 'alpha' },
                  { key: 'team', label: 'Đội', kind: 'alpha' },
                  { key: 'assigned', label: 'Khối lượng', kind: 'number' },
                  { key: 'actual', label: 'Đã làm', kind: 'number' },
                  { key: 'progress', label: 'Tiến độ', kind: 'number' },
                ]}
                activeKey={detailSortBy}
                order={detailSortOrder}
                onChange={(key, order) => { setDetailSortBy(key as typeof detailSortBy); setDetailSortOrder(order); }}
                onReset={() => { setDetailSortBy('floor'); setDetailSortOrder('asc'); }}
                summary={`${detailRows.length} Căn/Phòng`}
              />
            </div>

            <div className="flex-1 overflow-auto p-3 sm:p-4">
              {detailRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500">Không có Căn/Phòng phù hợp phạm vi lọc.</div>
              ) : (
                <div className="min-w-[760px] overflow-hidden rounded-2xl border border-slate-200">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        {normalizedStructureConfig.enabled && <th className="px-3 py-2 text-left">{normalizedStructureConfig.label}</th>}
                        <th className="px-3 py-2 text-left">Tầng</th>
                        <th className="px-3 py-2 text-left">Căn / Phòng</th>
                        <th className="px-3 py-2 text-left">Đội thi công</th>
                        <th className="px-3 py-2 text-right">Khối lượng</th>
                        <th className="px-3 py-2 text-right">Đã thực hiện</th>
                        <th className="px-3 py-2 text-right">Tiến độ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detailRows.map((row) => {
                        const floor = floorPlans.find((item) => item.id === row.floorId);
                        const groupId = floor ? resolveFloorStructureGroupId(floor, normalizedStructureConfig) : normalizedStructureConfig.defaultGroupId;
                        return (
                          <tr key={row.roomId} className="bg-white hover:bg-indigo-50/40">
                            {normalizedStructureConfig.enabled && <td className="px-3 py-2 font-bold text-indigo-700">{getStructureGroupName(groupId, normalizedStructureConfig)}</td>}
                            <td className="px-3 py-2 font-semibold text-slate-700">{row.floorName}</td>
                            <td className="px-3 py-2 font-extrabold text-slate-900">{row.roomName}</td>
                            <td className="px-3 py-2 text-slate-600">{row.teamNames.length > 0 ? row.teamNames.join(', ') : 'Chưa gán đội'}</td>
                            <td className="px-3 py-2 text-right font-semibold">{formatDecimal(row.assignedVolume)} {detailVolumeTarget.unit}</td>
                            <td className="px-3 py-2 text-right font-extrabold text-emerald-700">{formatDecimal(row.actualVolume)} {detailVolumeTarget.unit}</td>
                            <td className="px-3 py-2 text-right">
                              <span className={`inline-flex min-w-[48px] justify-center rounded-full px-2 py-1 font-extrabold ${row.progressPercent >= 100 ? 'bg-emerald-100 text-emerald-800' : row.progressPercent > 0 ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-500'}`}>
                                {row.progressPercent}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 font-extrabold text-slate-800">
                      <tr>
                        <td colSpan={normalizedStructureConfig.enabled ? 4 : 3} className="px-3 py-2">TỔNG TRONG PHẠM VI ĐANG XEM · {detailRows.length} Căn/Phòng</td>
                        <td className="px-3 py-2 text-right">{formatDecimal(detailRows.reduce((sum, row) => sum + row.assignedVolume, 0))} {detailVolumeTarget.unit}</td>
                        <td className="px-3 py-2 text-right text-emerald-700">{formatDecimal(detailRows.reduce((sum, row) => sum + row.actualVolume, 0))} {detailVolumeTarget.unit}</td>
                        <td className="px-3 py-2 text-right">—</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

            {/* Delete Volume Confirmation Modal */}
      {hasStructureManageAccess && deletingVolumeTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full space-y-4 border border-slate-100 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Xác nhận xóa hạng mục</h3>
              <p className="text-xs text-slate-500 mt-1">
                Bạn có chắc chắn muốn xóa hạng mục <strong className="text-slate-800">{deletingVolumeTarget.title} ({deletingVolumeTarget.floor})</strong> không?
              </p>
              <p className="text-[11px] text-indigo-600 mt-1 font-medium">💡 Thao tác này có thể Hoàn tác.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeletingVolumeTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={async () => {
                  onDeleteWorkVolume(deletingVolumeTarget.id);
                  setDeletingVolumeTarget(null);
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs shadow"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
