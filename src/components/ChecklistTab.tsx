import React, { useState, useMemo, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import * as XLSX from 'xlsx';
import { 
  ClipboardCheck, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Plus, 
  Layers, 
  User, 
  FileCheck,
  Edit,
  Trash2,
  FileText,
  FileSpreadsheet,
  Download,
  Upload,
  Calendar,
  AlertTriangle,
  Bell,
  ArrowUpDown
} from 'lucide-react';
import { ChecklistItem, ChecklistStatus, WorkVolume, FloorPlan } from '../types';
import { confirmAsync } from '../utils/confirmAsync';
import { getTodayDateString, addDaysToDateString, formatDateVN, calculateDiffDays } from '../utils/dueDateUtils';
import { saveWorkbookFile } from '../utils/fileExport';
import { UserRole, canEditChecklistData, canManageChecklistStructure, canDeleteBusinessData, canImportData } from '../utils/securityUtils';

import { QuickSortBar } from './QuickSortBar';

interface ChecklistTabProps {
  checklist: ChecklistItem[];
  userRole: UserRole;
  roleResolved: boolean;
  floors: string[];
  floorPlans?: FloorPlan[];
  inspectorName?: string;
  workVolumes?: WorkVolume[];
  onUpdateChecklistStatus: (id: string, status: ChecklistStatus, notes?: string, inspector?: string) => void;
  onAddChecklistItem: (item: Omit<ChecklistItem, 'id'>) => void;
  onUpdateChecklistItem?: (item: ChecklistItem) => void;
  onDeleteChecklistItem: (id: string) => void;
  onDeleteMultipleChecklistItems?: (ids: string[]) => void;
  onOpenExportPdf?: () => void;
  onExportExcel?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const ChecklistTab: React.FC<ChecklistTabProps> = ({
  checklist,
  userRole,
  roleResolved,
  floors,
  floorPlans,
  inspectorName = '',
  workVolumes = [],
  onUpdateChecklistStatus,
  onAddChecklistItem,
  onUpdateChecklistItem,
  onDeleteChecklistItem,
  onDeleteMultipleChecklistItems,
  onOpenExportPdf,
  onExportExcel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}) => {
  const { t } = useLanguage();
  const canOperate = roleResolved && canEditChecklistData(userRole);
  const canManageStructure = roleResolved && canManageChecklistStructure(userRole);
  const canDelete = roleResolved && canDeleteBusinessData(userRole);
  const canImport = roleResolved && canImportData(userRole);
  const activeChecklist = useMemo(() => checklist.filter((item) => !item.archivedAt), [checklist]);
  const [selectedFloor, setSelectedFloor] = useState<string>(floors[0] || 'Tầng 1');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [checklistSortBy, setChecklistSortBy] = useState<'none' | 'title' | 'status' | 'dueDate'>('none');
  const [checklistSortOrder, setChecklistSortOrder] = useState<'asc' | 'desc'>('asc');

  // Keep selectedFloor in sync with floors
  useEffect(() => {
    if (floors.length > 0 && !floors.includes(selectedFloor)) {
      setSelectedFloor(floors[0]);
    }
  }, [floors, selectedFloor]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingChecklistItem, setEditingChecklistItem] = useState<ChecklistItem | null>(null);
  const [deletingChecklistTarget, setDeletingChecklistTarget] = useState<ChecklistItem | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);

  useEffect(() => {
    if (!canManageStructure) {
      setShowAddForm(false);
      setEditingChecklistItem(null);
    }
    if (!canDelete) {
      setDeletingChecklistTarget(null);
      setSelectedItemIds([]);
    }
  }, [canManageStructure, canDelete]);

  // New Item State (pulling inspectorName as default)
  const [category, setCategory] = useState<string>('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [inspectedBy, setInspectedBy] = useState(inspectorName);
  const [dueDate, setDueDate] = useState<string>('');

  // Extract unique work volume categories/titles for the currently selected floor
  const categoriesList = useMemo(() => {
    const list = new Set<string>();
    if (workVolumes && workVolumes.length > 0) {
      workVolumes.forEach((wv) => {
        if (wv.floor === selectedFloor && wv.title) {
          list.add(wv.title.trim());
        }
      });
    }
    // Fallback to all unique work volume titles across all floors if none on this floor
    if (list.size === 0 && workVolumes && workVolumes.length > 0) {
      workVolumes.forEach((wv) => {
        if (wv.title) {
          list.add(wv.title.trim());
        }
      });
    }
    // Fallback defaults if no work volumes at all
    if (list.size === 0) {
      list.add('Thi công khung trần');
      list.add('Thi công bắn tấm trần');
      list.add('Sơn bả & Hoàn thiện');
    }
    return Array.from(list);
  }, [workVolumes, selectedFloor]);

  // Keep category state in sync with the first available option
  useEffect(() => {
    if (categoriesList.length > 0) {
      setCategory(categoriesList[0]);
    }
  }, [categoriesList]);

  const getCategoryLabel = (cat: string) => {
    return cat.replace(/\s+Tầng\s+\d+.*$/i, '')
              .replace(/\s+Tầng\s+[A-Za-z0-9]+.*$/i, '')
              .trim();
  };

  // Keep inspectedBy updated if inspectorName prop changes
  useEffect(() => {
    if (inspectorName) {
      setInspectedBy(inspectorName);
    }
  }, [inspectorName]);

  // Categories actually in use by items on the selected floor
  const categoriesInUseForFloor = useMemo(() => {
    const list = new Set<string>();
    activeChecklist
      .filter((item) => item.floorName === selectedFloor)
      .forEach((item) => {
        if (item.category && item.category.trim()) {
          list.add(item.category.trim());
        }
      });
    return Array.from(list);
  }, [activeChecklist, selectedFloor]);

  const filteredChecklist = useMemo(() => {
    return activeChecklist.filter((item) => {
      const matchFloor = item.floorName === selectedFloor;
      const matchCategory = selectedCategory === 'all' || item.category === selectedCategory;
      return matchFloor && matchCategory;
    });
  }, [activeChecklist, selectedFloor, selectedCategory]);

  const sortedFilteredChecklist = useMemo(() => {
    const list = [...filteredChecklist];
    if (checklistSortBy === 'none') return list;
    
    return list.sort((a, b) => {
      if (checklistSortBy === 'title') {
        const comp = a.title.localeCompare(b.title, 'vi', { numeric: true, sensitivity: 'base' });
        return checklistSortOrder === 'asc' ? comp : -comp;
      }
      if (checklistSortBy === 'status') {
        const getWeight = (s: ChecklistStatus) => {
          if (s === 'defect') return 1;
          if (s === 'pending') return 2;
          return 3;
        };
        const comp = getWeight(a.status) - getWeight(b.status);
        return checklistSortOrder === 'asc' ? comp : -comp;
      }
      if (checklistSortBy === 'dueDate') {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        const comp = a.dueDate.localeCompare(b.dueDate);
        return checklistSortOrder === 'asc' ? comp : -comp;
      }
      return 0;
    });
  }, [filteredChecklist, checklistSortBy, checklistSortOrder]);

  const summary = useMemo(() => {
    const floorItems = activeChecklist.filter((item) => item.floorName === selectedFloor);
    const total = floorItems.length;
    const passed = floorItems.filter((i) => i.status === 'passed').length;
    const defect = floorItems.filter((i) => i.status === 'defect').length;
    const pending = floorItems.filter((i) => i.status === 'pending').length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    return { total, passed, defect, pending, passRate };
  }, [activeChecklist, selectedFloor]);

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStructure) return;
    if (!title.trim()) {
      alert('Vui lòng nhập nội dung tiêu chuẩn kiểm tra!');
      return;
    }

    const matchedFloor = floorPlans?.find(fp => fp.floorName === selectedFloor);
    onAddChecklistItem({
      floorId: matchedFloor?.id,
      floorName: selectedFloor,
      category,
      title: title.trim(),
      status: 'pending',
      dueDate: dueDate ? dueDate : undefined,
      notes,
      inspectedBy: undefined,
      inspectedAt: undefined,
    });

    setShowAddForm(false);
    setTitle('');
    setNotes('');
    setDueDate('');
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStructure) return;
    if (!editingChecklistItem || !onUpdateChecklistItem) return;
    if (!editingChecklistItem.title.trim()) {
      alert('Vui lòng nhập nội dung tiêu chuẩn kiểm tra!');
      return;
    }

    onUpdateChecklistItem({
      ...editingChecklistItem,
      title: editingChecklistItem.title.trim(),
      inspectedBy: editingChecklistItem.status === 'pending' ? undefined : (editingChecklistItem.inspectedBy?.trim() || inspectorName),
      inspectedAt: editingChecklistItem.status === 'pending' ? undefined : editingChecklistItem.inspectedAt,
    });

    setEditingChecklistItem(null);
  };

  const handleExportChecklistTemplate = async () => {
    const wb = XLSX.utils.book_new();
    const sourceData = activeChecklist.length > 0 ? activeChecklist : [
      {
        floorName: selectedFloor,
        category: categoriesList[0] || 'Thi công khung trần',
        title: 'Khoảng cách giữa các thanh xương chính tuân thủ thiết kế (800-1000mm)',
        status: 'pending' as const,
        notes: 'Kiểm tra kỹ khoảng cách ty treo',
        inspectedBy: inspectorName,
        inspectedAt: new Date().toISOString()
      }
    ];

    const data = sourceData.map((item, idx) => ({
      'STT': idx + 1,
      '__recordId': item.id || '',
      'Vị Trí (Tầng)': item.floorName || selectedFloor,
      'Hạng Mục Kiểm Tra': item.category,
      'Nội Dung Tiêu Chuẩn': item.title,
      'Trạng Thái': item.status === 'passed' ? 'Đạt' : item.status === 'defect' ? 'Lỗi' : 'Chờ nghiệm thu',
      'Ghi Chú': item.notes || '',
      'Người Kiểm Tra': item.inspectedBy || inspectorName
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    
    const maxLens = data.reduce((acc: any, row: any) => {
      Object.keys(row).forEach((key) => {
        const valLen = String(row[key] || '').length;
        acc[key] = Math.max(acc[key] || 10, valLen + 4);
      });
      return acc;
    }, {});
    ws['!cols'] = Object.keys(maxLens).map((key) => ({ wch: maxLens[key] }));

    XLSX.utils.book_append_sheet(wb, ws, 'Checklist');
    return saveWorkbookFile(wb, `Mau_Checklist_Nghiem_Thu.xlsx`);
  };

  const handleImportExcelChecklist = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canImport || !canManageStructure) { e.target.value = ''; return; }
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

        // Validate headers to provide a clear explanation if something goes wrong
        const firstRow = jsonData[0];
        const foundHeaders = Object.keys(firstRow);
        const requiredKeys = ['Nội Dung Tiêu Chuẩn', 'title', 'Nội dung', 'noi dung'];
        const hasMatch = foundHeaders.some(h => requiredKeys.some(rk => h.toLowerCase().includes(rk.toLowerCase())));

        if (!hasMatch) {
          alert(
            `⚠️ Không tìm thấy cột thông tin bắt buộc 'Nội Dung Tiêu Chuẩn'!\n\n` +
            `• Các cột tìm thấy trong file: [${foundHeaders.join(', ')}]\n` +
            `• Vui lòng đặt lại tiêu đề cột trong file Excel trùng với mẫu để hệ thống nhận diện đúng.`
          );
          return;
        }

        let addedCount = 0;
        let updatedCount = 0;
        let unchangedCount = 0;
        let skippedCount = 0;

        jsonData.forEach((row: any) => {
          const rawRecordId = String(row['__recordId'] || row['Mã Checklist'] || row['Mã Định Danh'] || row['id'] || '').trim();
          const rawFloor = String(row['Tầng / Khu Vực'] || row['Vị Trí (Tầng)'] || row['floor'] || row['Tầng'] || selectedFloor).trim();
          const rawCategory = String(row['Phân Loại hạng mục'] || row['Hạng Mục Kiểm Tra'] || row['category'] || 'Thi công khung trần').trim();
          const rawTitle = String(row['Nội Dung Tiêu Chí Kiểm Tra'] || row['Nội Dung Tiêu Chuẩn'] || row['title'] || row['Nội dung'] || row['noi dung'] || '').trim();
          const rawStatusStr = String(row['Trạng Thái'] || row['status'] || 'Chờ nghiệm thu').trim();
          const rawNotes = String(row['Ghi Chú'] || row['notes'] || '').trim();
          const rawInspectedBy = String(row['Người Giám Sát'] || row['Người Kiểm Tra'] || row['inspectorName'] || inspectorName).trim();
          const rawDueDate = String(row['Ngày Hạn Định'] || row['Hạn Định'] || row['dueDate'] || '').trim();

          if (!rawTitle) {
            skippedCount++;
            return;
          }

          let categoryNorm = rawCategory;
          const matchedCat = categoriesList.find(
            (c) => c.toLowerCase().includes(rawCategory.toLowerCase()) || rawCategory.toLowerCase().includes(c.toLowerCase())
          );
          if (matchedCat) {
            categoryNorm = matchedCat;
          } else {
            if (rawCategory.includes('bắn tấm') || rawCategory.includes('Ban Tam') || rawCategory.toLowerCase().includes('tấm')) {
              const bTam = categoriesList.find(c => c.toLowerCase().includes('tấm') || c.toLowerCase().includes('tam'));
              if (bTam) categoryNorm = bTam;
            } else if (rawCategory.includes('sơn bả') || rawCategory.includes('Son Ba') || rawCategory.toLowerCase().includes('sơn') || rawCategory.toLowerCase().includes('hoàn thiện')) {
              const sBa = categoriesList.find(c => c.toLowerCase().includes('sơn') || c.toLowerCase().includes('son') || c.toLowerCase().includes('hoàn thiện'));
              if (sBa) categoryNorm = sBa;
            } else if (rawCategory.includes('khung') || rawCategory.includes('Khung')) {
              const kTran = categoriesList.find(c => c.toLowerCase().includes('khung'));
              if (kTran) categoryNorm = kTran;
            }
          }

          let statusNorm: ChecklistStatus = 'pending';
          const lowerStatus = rawStatusStr.toLowerCase();
          if (lowerStatus === 'đạt' || lowerStatus === 'dat' || lowerStatus.includes('pass') || lowerStatus.includes('ok')) {
            statusNorm = 'passed';
          } else if (lowerStatus === 'lỗi' || lowerStatus === 'loi' || lowerStatus.includes('defect') || lowerStatus.includes('fail')) {
            statusNorm = 'defect';
          }

          // Check for existing record by ID or title+floor+category
          const existing = activeChecklist.find(c => 
            (rawRecordId && c.id === rawRecordId) ||
            (c.floorName.toLowerCase() === rawFloor.toLowerCase() && c.category.toLowerCase() === categoryNorm.toLowerCase() && c.title.toLowerCase() === rawTitle.toLowerCase())
          );

          if (existing && onUpdateChecklistItem) {
            const isUnchanged = 
              existing.floorName === rawFloor &&
              existing.category === categoryNorm &&
              existing.title === rawTitle &&
              existing.status === statusNorm &&
              (!rawDueDate || existing.dueDate === rawDueDate) &&
              (!rawNotes || existing.notes === rawNotes) &&
              (!rawInspectedBy || existing.inspectedBy === rawInspectedBy);

            if (isUnchanged) {
              unchangedCount++;
            } else {
              onUpdateChecklistItem({
                ...existing,
                floorName: rawFloor,
                category: categoryNorm,
                title: rawTitle,
                status: statusNorm,
                dueDate: rawDueDate || existing.dueDate,
                notes: rawNotes || existing.notes,
                inspectedBy: rawInspectedBy || existing.inspectedBy,
                inspectedAt: new Date().toISOString(),
              });
              updatedCount++;
            }
          } else {
            const matchedFloor = floorPlans?.find(fp => fp.floorName === rawFloor);
            onAddChecklistItem({
              floorId: matchedFloor?.id,
              floorName: rawFloor,
              category: categoryNorm,
              title: rawTitle,
              status: statusNorm,
              dueDate: rawDueDate || undefined,
              notes: rawNotes || undefined,
              inspectedBy: rawInspectedBy || inspectorName,
              inspectedAt: new Date().toISOString()
            });
            addedCount++;
          }
        });

        alert(
          `🎉 Nhập Checklist từ Excel hoàn tất!\n\n` +
          `• Thêm mới: ${addedCount} tiêu chí\n` +
          `• Cập nhật thay đổi: ${updatedCount} tiêu chí\n` +
          `• Không thay đổi (giữ nguyên): ${unchangedCount} tiêu chí\n` +
          `• Bỏ qua do rỗng: ${skippedCount} dòng`
        );
      } catch (err: any) {
        alert(`❌ Lỗi đọc hoặc phân tích tệp Excel:\n${err.message || err}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  return (
    <div className="p-4 space-y-4 pb-24 w-full max-w-6xl mx-auto">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-emerald-600" />
            {t('checklist_title')}
          </h2>
          <p className="text-xs text-slate-500">Tiêu chuẩn thi công &amp; Kỹ sư giám sát: <span className="font-semibold text-indigo-700">{inspectorName}</span></p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {canManageStructure && (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-xs font-bold shadow active:scale-95 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Thêm Tiêu Chí
            </button>
          )}
        </div>
      </div>

      {/* Excel Import/Export Actions */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleExportChecklistTemplate}
          className="flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-extrabold py-2.5 px-3 rounded-xl shadow-xs transition-all text-xs cursor-pointer"
          title="Tải mẫu Excel hoặc danh sách checklist hiện tại để chỉnh sửa"
        >
          <Download className="w-4 h-4 text-indigo-600" /> Tải Excel để chỉnh sửa
        </button>
        {canImport && canManageStructure ? (
          <label className="flex items-center justify-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-extrabold py-2.5 px-3 rounded-xl shadow-xs cursor-pointer transition-all text-xs">
            <Upload className="w-4 h-4 text-emerald-600" /> Nhập lại từ Excel
            <input type="file" accept=".xlsx, .xls" onChange={handleImportExcelChecklist} className="hidden" />
          </label>
        ) : (
          <div className="flex items-center justify-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-400 font-extrabold py-2.5 px-3 rounded-xl text-xs" title="Chỉ ADMIN được nhập Checklist từ Excel">
            <Upload className="w-4 h-4" /> Chỉ ADMIN được nhập
          </div>
        )}
      </div>

      {/* Floor Chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 text-xs no-scrollbar">
        {floors.map((floor) => (
          <button
            key={floor}
            onClick={() => setSelectedFloor(floor)}
            className={`px-3.5 py-2 rounded-xl font-bold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
              selectedFloor === floor
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-white text-slate-700 border border-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            {floor}
          </button>
        ))}
      </div>

      {/* Inspection Pass Rate Summary Card */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800">Tỷ lệ nghiệm thu - {selectedFloor}</span>
          <span className="text-xs font-extrabold text-emerald-600">{summary.total > 0 ? `${summary.passRate}% Đạt` : 'Chưa có dữ liệu'}</span>
        </div>

        <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden flex">
          <div className="bg-emerald-500 h-full transition-all" style={{ width: `${(summary.passed / (summary.total || 1)) * 100}%` }} />
          <div className="bg-rose-500 h-full transition-all" style={{ width: `${(summary.defect / (summary.total || 1)) * 100}%` }} />
          <div className="bg-amber-400 h-full transition-all" style={{ width: `${(summary.pending / (summary.total || 1)) * 100}%` }} />
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-[11px] pt-1">
          <div className="bg-emerald-50 p-2 rounded-xl border border-emerald-100 font-bold text-emerald-800">
            🟢 Đạt: {summary.passed}
          </div>
          <div className="bg-rose-50 p-2 rounded-xl border border-rose-100 font-bold text-rose-800">
            🔴 Defect: {summary.defect}
          </div>
          <div className="bg-amber-50 p-2 rounded-xl border border-amber-100 font-bold text-amber-800">
            🟡 Chờ: {summary.pending}
          </div>
        </div>
      </div>

      {/* Category filter */}
      {categoriesInUseForFloor.length > 0 && (
        <div className="flex gap-1 overflow-x-auto text-xs no-scrollbar">
          {[{ id: 'all', label: 'Tất Cả' }, ...categoriesInUseForFloor.map((cat, idx) => ({
            id: cat,
            label: `${idx + 1}. ${getCategoryLabel(cat)}`
          }))].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all cursor-pointer ${
                selectedCategory === cat.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 border border-slate-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Quick Sort Checklist Items */}
      <QuickSortBar
        itemCount={sortedFilteredChecklist.length}
        options={[
          { key: 'title', label: 'Nội dung', kind: 'alpha' },
          { key: 'status', label: 'Trạng thái', kind: 'status' },
          { key: 'dueDate', label: 'Thời hạn', kind: 'deadline', defaultOrder: 'asc' },
        ]}
        activeKey={checklistSortBy === 'none' ? null : checklistSortBy}
        order={checklistSortOrder}
        onChange={(key, order) => { setChecklistSortBy(key); setChecklistSortOrder(order); }}
        onToggleOrder={() => setChecklistSortOrder((order) => order === 'asc' ? 'desc' : 'asc')}
        onReset={() => { setChecklistSortBy('none'); setChecklistSortOrder('asc'); }}
      />

      {/* Select and Bulk Actions Bar */}
      {canDelete && sortedFilteredChecklist.length > 0 && (
        <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs gap-2">
          <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sortedFilteredChecklist.length > 0 && sortedFilteredChecklist.every(item => selectedItemIds.includes(item.id))}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedItemIds(prev => Array.from(new Set([...prev, ...sortedFilteredChecklist.map(item => item.id)])));
                } else {
                  setSelectedItemIds(prev => prev.filter(id => !sortedFilteredChecklist.some(item => item.id === id)));
                }
              }}
              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span>Chọn tất cả trên trang ({sortedFilteredChecklist.length})</span>
          </label>

          <div className="flex items-center gap-3 justify-end">
            {selectedItemIds.some(id => sortedFilteredChecklist.some(item => item.id === id)) && (
              <button
                type="button"
                onClick={async () => {
                  const idsToDelete = selectedItemIds.filter(id => sortedFilteredChecklist.some(item => item.id === id));
                  if (await confirmAsync(`Bạn có chắc muốn xóa ${idsToDelete.length} tiêu chí đã chọn?`)) {
                    if (onDeleteMultipleChecklistItems) {
                      onDeleteMultipleChecklistItems(idsToDelete);
                    } else {
                      idsToDelete.forEach(id => onDeleteChecklistItem(id));
                    }
                    setSelectedItemIds(prev => prev.filter(id => !idsToDelete.includes(id)));
                  }
                }}
                className="text-rose-600 hover:text-rose-700 font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Xóa đã chọn ({selectedItemIds.filter(id => sortedFilteredChecklist.some(item => item.id === id)).length})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Checklist items list */}
      <div className="space-y-3">
        {sortedFilteredChecklist.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs bg-white rounded-2xl border border-dashed border-slate-200">
            Chưa có tiêu chí checklist nào cho {selectedFloor}.{canManageStructure ? ' Bấm “Thêm Tiêu Chí” hoặc “Nhập Excel” để bắt đầu.' : ''}
          </div>
        ) : (
          sortedFilteredChecklist.map((item) => (
            <div
              key={item.id}
              className={`bg-white rounded-2xl p-3.5 border transition-all duration-150 space-y-2.5 ${
                selectedItemIds.includes(item.id) ? 'border-indigo-300 bg-indigo-50/20 shadow-xs' : 'border-slate-200 shadow-sm'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {canDelete && <input
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
                    <div>
                      <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200 inline-block mb-1">
                        {getCategoryLabel(item.category)}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900 leading-snug">{item.title}</h4>

                      {/* Due Date Badge */}
                      {item.dueDate && (
                        <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                          {(() => {
                            const isDone = item.status === 'passed';
                            const diffDays = calculateDiffDays(item.dueDate);
                            if (isDone) {
                              return (
                                <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md font-bold border border-emerald-200 flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                                  Hạn: {formatDateVN(item.dueDate)} (Đã nghiệm thu)
                                </span>
                              );
                            }
                            if (diffDays < 0) {
                              return (
                                <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded-md font-extrabold border border-rose-300 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0 animate-bounce" />
                                  🚨 Quá hạn {Math.abs(diffDays)} ngày ({formatDateVN(item.dueDate)})
                                </span>
                              );
                            }
                            if (diffDays === 0) {
                              return (
                                <span className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md font-extrabold border border-amber-300 flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-amber-600 shrink-0 animate-pulse" />
                                  ⏰ Hạn hôm nay ({formatDateVN(item.dueDate)})
                                </span>
                              );
                            }
                            if (diffDays <= 3) {
                              return (
                                <span className="bg-amber-50 text-amber-800 px-2 py-0.5 rounded-md font-bold border border-amber-200 flex items-center gap-1">
                                  <Bell className="w-3 h-3 text-amber-600 shrink-0" />
                                  🔔 Còn {diffDays} ngày ({formatDateVN(item.dueDate)})
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

                    <div className="shrink-0">
                      <span
                        className={`text-[10px] font-bold px-2 py-1 rounded-xl flex items-center gap-1 ${
                          item.status === 'passed'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : item.status === 'defect'
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}
                      >
                        {item.status === 'passed' && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                        {item.status === 'defect' && <AlertCircle className="w-3 h-3 text-rose-600" />}
                        {item.status === 'pending' && <Clock className="w-3 h-3 text-amber-600" />}
                        {item.status === 'passed' ? 'ĐÃ NGHIỆM THU' : item.status === 'defect' ? 'CÓ DEFECT' : 'CHƯA NGHIỆM THU'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {item.notes && (
                <p className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded-xl border border-slate-100 italic">
                  📝 {item.notes}
                </p>
              )}

              {/* Quick Status Toggle Actions */}
              {canOperate && <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-100 text-[11px]">
                <button
                  onClick={() => onUpdateChecklistStatus(item.id, 'passed')}
                  className={`py-1.5 rounded-xl font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                    item.status === 'passed'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'bg-slate-100 text-slate-700 hover:bg-emerald-50'
                  }`}
                >
                  ✅ Đạt
                </button>
                <button
                  onClick={() => onUpdateChecklistStatus(item.id, 'defect')}
                  className={`py-1.5 rounded-xl font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                    item.status === 'defect'
                      ? 'bg-rose-600 text-white shadow'
                      : 'bg-slate-100 text-slate-700 hover:bg-rose-50'
                  }`}
                >
                  🔴 Lỗi
                </button>
                <button
                  onClick={() => onUpdateChecklistStatus(item.id, 'pending')}
                  className={`py-1.5 rounded-xl font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                    item.status === 'pending'
                      ? 'bg-amber-500 text-white shadow'
                      : 'bg-slate-100 text-slate-700 hover:bg-amber-50'
                  }`}
                >
                  🟡 Chờ
                </button>
              </div>}

              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                <span className="truncate max-w-[200px]">👤 GS: <strong className="text-slate-700">{item.inspectedBy || inspectorName}</strong></span>
                <div className="flex items-center gap-2">
                  {canManageStructure && (
                    <button onClick={() => setEditingChecklistItem(item)} className="text-indigo-600 hover:underline font-bold flex items-center gap-0.5 cursor-pointer">
                      <Edit className="w-3 h-3" /> Sửa cấu trúc
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={() => setDeletingChecklistTarget(item)} className="text-rose-500 hover:underline font-bold flex items-center gap-0.5 cursor-pointer">
                      <Trash2 className="w-3 h-3" /> Xóa
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Checklist Modal */}
      {canManageStructure && showAddForm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-2xl p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-emerald-600" />
                Thêm Tiêu Chí Kiểm Tra ({selectedFloor})
              </h3>
              <button onClick={() => setShowAddForm(false)} className="font-bold text-slate-500 cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Loại hạng mục</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-white"
                >
                  {categoriesList.map((catOption) => (
                    <option key={catOption} value={catOption}>
                      {catOption}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Nội Dung Tiêu Chuẩn Kiểm Tra</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Bắn vít khoảng cách 20cm, không chồi đầu vít..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-medium"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Kỹ sư phụ trách (Tùy chỉnh hoặc theo cấu hình)</label>
                <input
                  type="text"
                  value={inspectedBy}
                  onChange={(e) => setInspectedBy(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-slate-800"
                  placeholder="Tên kỹ sư giám sát..."
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Ghi chú ban đầu</label>
                <textarea
                  placeholder="Ghi chú cụ thể..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl p-2.5"
                />
              </div>

              {/* Ngày Hạn Định (DueDate) */}
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-slate-800 font-extrabold text-xs flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    <span>Hạn nghiệm thu</span>
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
                    className="px-2 py-1 bg-white hover:bg-slate-200 border border-slate-200 rounded-lg font-bold text-slate-700 cursor-pointer"
                  >
                    Hôm nay
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueDate(addDaysToDateString(getTodayDateString(), 1))}
                    className="px-2 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg font-bold text-blue-700 cursor-pointer"
                  >
                    +1 ngày
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueDate(addDaysToDateString(getTodayDateString(), 3))}
                    className="px-2 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg font-bold text-amber-700 cursor-pointer"
                  >
                    +3 ngày
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueDate(addDaysToDateString(getTodayDateString(), 7))}
                    className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg font-bold text-emerald-700 cursor-pointer"
                  >
                    +7 ngày
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold text-slate-600 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md cursor-pointer"
                >
                  Tạo Tiêu Chí
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Checklist Modal (Cho phép chỉnh sửa checklist đã tạo) */}
      {canManageStructure && editingChecklistItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-2xl p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                <Edit className="w-4 h-4 text-indigo-600" />
                Chỉnh Sửa Tiêu Chí Checklist
              </h3>
              <button onClick={() => setEditingChecklistItem(null)} className="font-bold text-slate-500 cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Vị Trí (Tầng)</label>
                <select
                  value={editingChecklistItem.floorName}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, floorName: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-white"
                >
                  {floors.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Loại hạng mục</label>
                <select
                  value={editingChecklistItem.category}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, category: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-white"
                >
                  {Array.from(new Set([editingChecklistItem.category, ...categoriesList])).map((catOption) => (
                    <option key={catOption} value={catOption}>
                      {catOption}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Nội Dung Tiêu Chuẩn Kiểm Tra</label>
                <input
                  type="text"
                  value={editingChecklistItem.title}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, title: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-medium"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Trạng thái nghiệm thu</label>
                <select
                  value={editingChecklistItem.status}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, status: e.target.value as ChecklistStatus })}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-white"
                >
                  <option value="passed">✅ Đạt</option>
                  <option value="defect">🔴 Không đạt / Có Defect</option>
                  <option value="pending">🟡 Chờ nghiệm thu</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Kỹ sư phụ trách</label>
                <input
                  type="text"
                  value={editingChecklistItem.inspectedBy || inspectorName}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, inspectedBy: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Ghi chú</label>
                <textarea
                  value={editingChecklistItem.notes || ''}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, notes: e.target.value })}
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl p-2.5"
                />
              </div>

              {/* Ngày Hạn Định (DueDate) */}
              <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-slate-800 font-extrabold text-xs flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                    <span>Hạn nghiệm thu</span>
                  </label>
                  {editingChecklistItem.dueDate && (
                    <button
                      type="button"
                      onClick={() => setEditingChecklistItem({ ...editingChecklistItem, dueDate: undefined })}
                      className="text-[11px] text-rose-600 hover:underline font-bold cursor-pointer"
                    >
                      ✕ Xóa hạn
                    </button>
                  )}
                </div>
                <input
                  type="date"
                  value={editingChecklistItem.dueDate || ''}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, dueDate: e.target.value || undefined })}
                  className="w-full bg-white border border-slate-300 rounded-xl p-2 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
                />
                <div className="flex items-center gap-1.5 flex-wrap text-[10px] pt-0.5">
                  <span className="text-slate-500 font-semibold">Chọn nhanh:</span>
                  <button
                    type="button"
                    onClick={() => setEditingChecklistItem({ ...editingChecklistItem, dueDate: getTodayDateString() })}
                    className="px-2 py-1 bg-white hover:bg-slate-200 border border-slate-200 rounded-lg font-bold text-slate-700 cursor-pointer"
                  >
                    Hôm nay
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingChecklistItem({ ...editingChecklistItem, dueDate: addDaysToDateString(getTodayDateString(), 1) })}
                    className="px-2 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg font-bold text-blue-700 cursor-pointer"
                  >
                    +1 ngày
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingChecklistItem({ ...editingChecklistItem, dueDate: addDaysToDateString(getTodayDateString(), 3) })}
                    className="px-2 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg font-bold text-amber-700 cursor-pointer"
                  >
                    +3 ngày
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingChecklistItem({ ...editingChecklistItem, dueDate: addDaysToDateString(getTodayDateString(), 7) })}
                    className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg font-bold text-emerald-700 cursor-pointer"
                  >
                    +7 ngày
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingChecklistItem(null)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold text-slate-600 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md cursor-pointer"
                >
                  Lưu Thay Đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Checklist Confirmation Modal */}
      {canDelete && deletingChecklistTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full space-y-4 border border-slate-100 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Xác nhận xóa Tiêu Chí</h3>
              <p className="text-xs text-slate-500 mt-1">
                Bạn có chắc chắn muốn xóa tiêu chí <strong className="text-slate-800">{deletingChecklistTarget.title}</strong> không?
              </p>
              <p className="text-[11px] text-indigo-600 mt-1 font-medium">💡 Thao tác này có thể Hoàn tác.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeletingChecklistTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={async () => {
                  onDeleteChecklistItem(deletingChecklistTarget.id);
                  setDeletingChecklistTarget(null);
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs shadow cursor-pointer"
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
