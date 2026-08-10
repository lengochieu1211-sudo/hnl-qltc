import React, { useState } from 'react';
import { 
  X, 
  Plus, 
  Edit3, 
  Trash2, 
  Package, 
  Layers, 
  Sliders, 
  AlertCircle, 
  CheckCircle2, 
  Save, 
  Search,
  BookOpen,
  Download,
  Upload,
  FileSpreadsheet
} from 'lucide-react';
import { MaterialNorm, InventoryItem, WorkVolume } from '../types';
import * as XLSX from 'xlsx';
import { exportWarehouseUpdateTemplate } from '../utils/excelExport';

interface MaterialNormModalProps {
  isOpen: boolean;
  onClose: () => void;
  materialNorms: MaterialNorm[];
  onAddNorm: (norm: Omit<MaterialNorm, 'id'>) => void;
  onUpdateNorm: (id: string, updated: Omit<MaterialNorm, 'id'>) => void;
  onDeleteNorm: (id: string) => void;
  onImportNorms?: (norms: MaterialNorm[]) => void;
  inventory: InventoryItem[];
  workVolumes?: WorkVolume[];
  onImportWorkVolumes?: (volumes: WorkVolume[]) => void;
}

export const COMMON_UNITS = ['Tấm', 'Thanh', 'Hộp (1000 con)', 'Bộ', 'Bao (25kg)', 'Cuộn (50m)', 'm²', 'm', 'kg', 'Thùng'];

export const COMMON_CATEGORIES = [
  'Tấm thạch cao',
  'Khung xương',
  'Phụ kiện & Vít',
  'Sơn bả & Mối nối',
  'Vật tư phụ khác'
];

export const WORK_CATEGORIES_LIST = [
  'Trần Thạch Cao Khung Chìm Tấm Tiêu Chuẩn',
  'Trần Thạch Cao Khung Chìm Tấm Chống Ẩm',
  'Trần Thạch Cao Khung Nổi Tấm Tiêu Chuẩn',
  'Trần Thạch Cao Khung Nổi Tấm Chống Ẩm',
  'Vách Thạch Cao Hai Mặt Tấm Tiêu Chuẩn',
  'Vách Thạch Cao Hai Mặt Tấm Chống Ẩm',
  'Vách Thạch Cao Một Mặt',
  'Sơn Bả Hoàn Thiện Trần / Vách',
  'Áp dụng chung / Khác',
];

export const MaterialNormModal: React.FC<MaterialNormModalProps> = ({
  isOpen,
  onClose,
  materialNorms,
  onAddNorm,
  onUpdateNorm,
  onDeleteNorm,
  onImportNorms,
  inventory,
  workVolumes,
  onImportWorkVolumes,
}) => {
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  const workCategoriesList = React.useMemo(() => {
    const list = new Set<string>();
    if (workVolumes && workVolumes.length > 0) {
      workVolumes.forEach((v) => {
        if (v.title && v.title.trim()) {
          list.add(v.title.trim());
        }
      });
    }
    if (list.size === 0) {
      WORK_CATEGORIES_LIST.forEach(cat => list.add(cat));
    }
    return Array.from(list);
  }, [workVolumes]);
  
  // Drag and Drop State
  const [isDragging, setIsDragging] = useState(false);
  
  // Modal mode: 'list' | 'add' | 'edit'
  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingNormTarget, setDeletingNormTarget] = useState<MaterialNorm | null>(null);

  // Form states
  const [category, setCategory] = useState<string>(COMMON_CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState<string>('');
  const [materialName, setMaterialName] = useState<string>('');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processExcelFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processExcelFile(file);
    }
  };

  const processExcelFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        let normsUpdatedCount = 0;
        let normsAddedCount = 0;
        let volumesUpdatedCount = 0;
        let volumesAddedCount = 0;

        let newNorms = [...materialNorms];
        let newWorkVolumes = workVolumes ? [...workVolumes] : [];

        // 1. Parse Sheet "Dinh Muc" / "Vat Tu"
        const normSheetName = workbook.SheetNames.find(
          name => name.toLowerCase().includes('dinh muc') || name.toLowerCase().includes('vat tu')
        ) || workbook.SheetNames[0];

        if (normSheetName) {
          const sheet = workbook.Sheets[normSheetName];
          const jsonData = XLSX.utils.sheet_to_json<any>(sheet);
          
          jsonData.forEach((row, rIdx) => {
            const materialNameRaw = row['Tên Vật Tư'] || row['materialName'] || row['Vật tư'] || row['Vat tu'];
            if (!materialNameRaw) return;

            const materialNameStr = String(materialNameRaw).trim();
            const categoryStr = String(row['Chủng Loại'] || row['Phân Loại'] || row['category'] || 'Vật tư thạch cao').trim();
            const unitStr = String(row['Đơn Vị Tính'] || row['unit'] || 'Tấm').trim();
            const quotaQuantityNum = Number(row['Số Lượng Định Mức'] || row['quotaQuantity'] || 0);
            const unitNormPerM2Num = row['Định Mức / m2'] || row['Định Mức Hao Phí / m2'] || row['Định mức tiêu hao'] || row['unitNormPerM2'];
            const notesStr = String(row['Ghi Chú'] || row['notes'] || '').trim();

            const existingIdx = newNorms.findIndex(n => n.materialName.toLowerCase() === materialNameStr.toLowerCase());
            
            const normData: MaterialNorm = {
              id: existingIdx >= 0 ? newNorms[existingIdx].id : `NORM-${Date.now()}-${rIdx}-${Math.random().toString(36).substring(2, 5)}`,
              category: categoryStr,
              materialName: materialNameStr,
              unit: unitStr,
              quotaQuantity: quotaQuantityNum,
              unitNormPerM2: unitNormPerM2Num ? Number(unitNormPerM2Num) : undefined,
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

        // 2. Parse Sheet "Khoi Luong" / "Hang Muc"
        const volumeSheetName = workbook.SheetNames.find(
          name => name.toLowerCase().includes('khoi luong') || name.toLowerCase().includes('hang muc') || name.toLowerCase().includes('thi cong')
        ) || workbook.SheetNames[1];

        if (volumeSheetName && workVolumes) {
          const sheet = workbook.Sheets[volumeSheetName];
          const jsonData = XLSX.utils.sheet_to_json<any>(sheet);
          
          jsonData.forEach((row, rIdx) => {
            const titleRaw = row['Tên Hạng Mục Công Việc'] || row['Tên Hạng Mục'] || row['Hạng mục'] || row['title'];
            if (!titleRaw) return;

            const titleStr = String(titleRaw).trim();
            const floorStr = String(row['Tầng / Khu Vực'] || row['Tầng'] || row['floor'] || 'Tầng 1').trim();
            const categoryStr = String(row['Phân Loại'] || row['category'] || 'khung_tran').trim() as any;
            const unitStr = String(row['Đơn Vị Tính'] || row['Đơn Vị'] || row['unit'] || 'm2').trim();
            const plannedNum = Number(row['KL Kế Hoạch'] || row['planned'] || 0);
            const actualNum = Number(row['KL Thực Hiện'] || row['actual'] || 0);
            const unitPriceNum = Number(row['Đơn Giá (VNĐ)'] || row['unitPrice'] || 0);

            const existingIdx = newWorkVolumes.findIndex(
              w => w.title.toLowerCase() === titleStr.toLowerCase() && w.floor.toLowerCase() === floorStr.toLowerCase()
            );

            const statusVal = actualNum >= plannedNum ? 'Đã hoàn thành' : actualNum > 0 ? 'Đang thi công' : 'Chưa thi công';

            const volumeData: any = {
              id: existingIdx >= 0 ? newWorkVolumes[existingIdx].id : `HM-${Date.now()}-${rIdx}-${Math.random().toString(36).substring(2, 5)}`,
              title: titleStr,
              floor: floorStr,
              category: categoryStr,
              unit: unitStr,
              planned: plannedNum,
              actual: actualNum,
              unitPrice: unitPriceNum,
              status: statusVal
            };

            if (existingIdx >= 0) {
              newWorkVolumes[existingIdx] = volumeData;
              volumesUpdatedCount++;
            } else {
              newWorkVolumes.push(volumeData);
              volumesAddedCount++;
            }
          });
        }

        // 3. Confirm with user and trigger updates
        const confirmMsg = 
          `📊 Kết quả phân tích tệp Excel:\n\n` +
          `🔹 ĐỊNH MỨC VẬT TƯ:\n` +
          `   • Cập nhật: ${normsUpdatedCount} định mức\n` +
          `   • Thêm mới: ${normsAddedCount} định mức\n\n` +
          `🔹 HẠNG MỤC THI CÔNG:\n` +
          `   • Cập nhật: ${volumesUpdatedCount} hạng mục\n` +
          `   • Thêm mới: ${volumesAddedCount} hạng mục\n\n` +
          `Bạn có đồng ý áp dụng các thay đổi này vào hệ thống?`;

        const confirmUpdate = window.confirm(confirmMsg);
        if (confirmUpdate) {
          if (onImportNorms) {
            onImportNorms(newNorms);
          }
          if (onImportWorkVolumes && workVolumes) {
            onImportWorkVolumes(newWorkVolumes);
          }
          alert('🎉 Đã cập nhật định mức vật tư và khối lượng hạng mục thi công thành công!');
        }
      } catch (err: any) {
        alert(`❌ Lỗi đọc hoặc xử lý tệp Excel: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };
  const [unit, setUnit] = useState<string>(COMMON_UNITS[0]);
  const [customUnit, setCustomUnit] = useState<string>('');
  const [quotaQuantity, setQuotaQuantity] = useState<number | ''>(500);
  const [unitNormPerM2, setUnitNormPerM2] = useState<number | ''>(0.35);
  const [notes, setNotes] = useState<string>('');

  // Calculate actual stock received per material
  const stockMap: Record<string, { inQty: number; outQty: number; balance: number }> = {};
  inventory.forEach((item) => {
    const key = item.materialName.trim().toLowerCase();
    if (!stockMap[key]) {
      stockMap[key] = { inQty: 0, outQty: 0, balance: 0 };
    }
    if (item.type === 'in') {
      stockMap[key].inQty += item.quantity;
      stockMap[key].balance += item.quantity;
    } else {
      stockMap[key].outQty += item.quantity;
      stockMap[key].balance -= item.quantity;
    }
  });

  const categoriesInUse = Array.from(new Set([...COMMON_CATEGORIES, ...materialNorms.map((n) => n.category)]));

  const filteredNorms = materialNorms.filter((norm) => {
    const matchesCategory = selectedCategoryFilter === 'all' || norm.category === selectedCategoryFilter;
    const matchesSearch = 
      norm.materialName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      norm.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      norm.unit.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const [workCategories, setWorkCategories] = useState<string[]>([]);

  const selectedWorkCategoriesVolume = React.useMemo(() => {
    if (!workVolumes || workCategories.length === 0) return 0;
    return workVolumes
      .filter((v) => workCategories.includes(v.title))
      .reduce((sum, v) => sum + (v.planned || 0), 0);
  }, [workVolumes, workCategories]);

  const computedAutoQuota = React.useMemo(() => {
    if (selectedWorkCategoriesVolume > 0 && unitNormPerM2 && Number(unitNormPerM2) > 0) {
      return Math.round(selectedWorkCategoriesVolume * Number(unitNormPerM2) * 100) / 100;
    }
    return null;
  }, [selectedWorkCategoriesVolume, unitNormPerM2]);

  const handleOpenAdd = () => {
    setCategory(COMMON_CATEGORIES[0]);
    setCustomCategory('');
    setWorkCategories([workCategoriesList[0] || WORK_CATEGORIES_LIST[0]]);
    setMaterialName('');
    setUnit(COMMON_UNITS[0]);
    setCustomUnit('');
    setQuotaQuantity(100);
    setUnitNormPerM2('');
    setNotes('');
    setEditingId(null);
    setMode('add');
  };

  const handleOpenEdit = (norm: MaterialNorm) => {
    setEditingId(norm.id);
    if (COMMON_CATEGORIES.includes(norm.category)) {
      setCategory(norm.category);
      setCustomCategory('');
    } else {
      setCategory('khac');
      setCustomCategory(norm.category);
    }

    if (norm.workCategories && norm.workCategories.length > 0) {
      setWorkCategories(norm.workCategories);
    } else if (norm.workCategory) {
      setWorkCategories([norm.workCategory]);
    } else {
      setWorkCategories([workCategoriesList[0] || WORK_CATEGORIES_LIST[0]]);
    }
    setMaterialName(norm.materialName);

    if (COMMON_UNITS.includes(norm.unit)) {
      setUnit(norm.unit);
      setCustomUnit('');
    } else {
      setUnit('khac');
      setCustomUnit(norm.unit);
    }

    setQuotaQuantity(norm.quotaQuantity);
    setUnitNormPerM2(norm.unitNormPerM2 || '');
    setNotes(norm.notes || '');
    setMode('edit');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalCategory = category === 'khac' ? customCategory.trim() : category;
    const finalUnit = unit === 'khac' ? customUnit.trim() : unit;

    if (!finalCategory) {
      alert('Vui lòng chọn hoặc nhập chủng loại vật tư!');
      return;
    }
    if (!materialName.trim()) {
      alert('Vui lòng nhập tên vật tư!');
      return;
    }
    if (!finalUnit) {
      alert('Vui lòng chọn hoặc nhập đơn vị tính!');
      return;
    }
    if (!quotaQuantity || Number(quotaQuantity) <= 0) {
      alert('Vui lòng nhập số lượng định mức công trình hợp lệ (> 0)!');
      return;
    }
    if (workCategories.length === 0) {
      alert('Vui lòng chọn ít nhất một hạng mục thi công liên kết!');
      return;
    }

    const normData = {
      category: finalCategory,
      workCategory: workCategories[0] || '',
      workCategories: workCategories,
      materialName: materialName.trim(),
      unit: finalUnit,
      quotaQuantity: Number(quotaQuantity),
      unitNormPerM2: unitNormPerM2 ? Number(unitNormPerM2) : undefined,
      notes: notes.trim(),
    };

    if (mode === 'add') {
      onAddNorm(normData);
    } else if (mode === 'edit' && editingId) {
      onUpdateNorm(editingId, normData);
    }

    setMode('list');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-2xl p-4 sm:p-5 space-y-4 max-h-[92vh] flex flex-col border border-slate-100 shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Định Mức &amp; Chủng Loại Vật Tư</h3>
              <p className="text-xs text-slate-500">Quản lý tiêu chuẩn &amp; định mức công trình</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* View Switcher: List vs Add/Edit */}
        {mode === 'list' ? (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            
            {/* Top Action & Search Bar */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm tên vật tư, chủng loại, ĐVT..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                onClick={handleOpenAdd}
                className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow transition-all shrink-0 active:scale-95"
              >
                <Plus className="w-4 h-4" />
                Thêm Định Mức
              </button>
            </div>

            {/* Quick Excel Import/Template Actions */}
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-3.5 space-y-2.5 text-xs transition-all ${
                isDragging 
                  ? 'border-indigo-500 bg-indigo-50/50 scale-[1.01]' 
                  : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                    <FileSpreadsheet className="w-5 h-5 shrink-0" />
                  </div>
                  <div className="text-left space-y-0.5">
                    <p className="font-extrabold text-xs text-slate-800">Cập Nhật Định Mức &amp; Hạng Mục Hàng Loạt</p>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Mẫu Excel gồm 2 trang: <strong>Định Mức Vật Tư</strong> và <strong>Hạng Mục Thi Công</strong> (gồm tên hạng mục, ĐVT, KL kế hoạch/thực hiện, đơn giá...). Chỉnh sửa mẫu và tải lên để cập nhật nhanh chóng cả hai mục.
                    </p>
                  </div>
                </div>
                <span className="text-[9px] text-indigo-600 font-extrabold bg-indigo-100/70 px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0">
                  2 TRANG
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => exportWarehouseUpdateTemplate(materialNorms, workVolumes || [])}
                  className="flex items-center justify-center gap-1.5 bg-white border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-50 hover:border-slate-300 font-bold py-2 px-3 rounded-xl transition-all shadow-3xs active:scale-95 text-xs cursor-pointer"
                >
                  <Download className="w-4 h-4 text-indigo-600 shrink-0" />
                  Tải File Mẫu
                </button>
                <label className="flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-3 rounded-xl cursor-pointer text-center transition-all shadow-xs hover:shadow active:scale-95 text-xs">
                  <Upload className="w-4 h-4 text-white shrink-0" />
                  <span>Chọn File Excel</span>
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              <button
                onClick={() => setSelectedCategoryFilter('all')}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all shrink-0 ${
                  selectedCategoryFilter === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Tất cả ({materialNorms.length})
              </button>
              {categoriesInUse.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategoryFilter(cat)}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all shrink-0 ${
                    selectedCategoryFilter === cat
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Material Norm List */}
            {filteredNorms.length === 0 ? (
              <div className="text-center py-8 text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-4">
                <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-xs font-semibold text-slate-600">Chưa có định mức vật tư nào trong danh mục</p>
                <p className="text-[11px] text-slate-400 mt-1">Bấm "Thêm Định Mức" để thiết lập tiêu chuẩn chủng loại &amp; ĐVT công trình.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredNorms.map((norm) => {
                  const stockKey = norm.materialName.trim().toLowerCase();
                  const actualStock = stockMap[stockKey]?.inQty || 0;
                  const percent = norm.quotaQuantity > 0 ? Math.round((actualStock / norm.quotaQuantity) * 100) : 0;
                  const isExceeded = actualStock > norm.quotaQuantity;

                  return (
                    <div
                      key={norm.id}
                      className="bg-slate-50 border border-slate-200/80 hover:border-indigo-300 rounded-2xl p-3 space-y-2 transition-all shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap gap-1 mb-1">
                            <span className="inline-block px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-md uppercase">
                              {norm.category}
                            </span>
                            {norm.workCategories && norm.workCategories.length > 0 ? (
                              norm.workCategories.map((wCat, wIdx) => (
                                <span key={`${wCat}-${wIdx}`} className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-md">
                                  🏗️ {wCat}
                                </span>
                              ))
                            ) : norm.workCategory ? (
                              <span className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-md">
                                🏗️ {norm.workCategory}
                              </span>
                            ) : null}
                          </div>
                          <h4 className="text-xs font-bold text-slate-900 leading-snug">{norm.materialName}</h4>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleOpenEdit(norm)}
                            className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                            title="Sửa định mức"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeletingNormTarget(norm)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Xóa định mức"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Norm details grid */}
                      <div className="grid grid-cols-3 gap-1.5 bg-white p-2 rounded-xl border border-slate-100 text-[11px]">
                        <div>
                          <p className="text-[10px] text-slate-400 font-semibold uppercase">Đơn Vị Tính</p>
                          <p className="font-bold text-slate-800">{norm.unit}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 font-semibold uppercase">Số Lượng Định Mức</p>
                          <p className="font-bold text-indigo-600">{(norm.quotaQuantity ?? 0).toLocaleString()} {norm.unit}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 font-semibold uppercase">Định Mức / m²</p>
                          <p className="font-semibold text-slate-700">{norm.unitNormPerM2 ? `${norm.unitNormPerM2} ${norm.unit}/m²` : 'Chưa nhập'}</p>
                        </div>
                      </div>

                      {/* Stock vs Quota Progress */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] font-bold">
                          <span className="text-slate-500">Thực tế đã nhập: <strong className="text-slate-800">{(actualStock ?? 0).toLocaleString()} {norm.unit}</strong></span>
                          <span className={isExceeded ? 'text-amber-600' : 'text-emerald-600'}>
                            {percent}% định mức
                          </span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              isExceeded ? 'bg-amber-500' : percent >= 90 ? 'bg-emerald-500' : 'bg-indigo-500'
                            }`}
                            style={{ width: `${Math.min(100, percent)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Add / Edit Form */
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto space-y-3.5 pr-1 text-xs">
            <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200">
              <span className="font-bold text-slate-800">
                {mode === 'add' ? 'Thêm Chủng Loại & Định Mức Mới' : 'Cập Nhật Định Mức Vật Tư'}
              </span>
              <button
                type="button"
                onClick={() => setMode('list')}
                className="text-slate-500 hover:text-slate-800 font-bold underline text-[11px]"
              >
                Quay lại
              </button>
            </div>

            {/* Category Select */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Chủng Loại Vật Tư Công Trình *</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-2.5 font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500"
              >
                {COMMON_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
                <option value="khac">Chủng loại khác (Nhập tùy chỉnh)</option>
              </select>
              {category === 'khac' && (
                <input
                  type="text"
                  placeholder="Nhập tên chủng loại mới (VD: Vật tư điện, Vật tư sơn...)"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-semibold text-slate-800 mt-2 bg-white focus:ring-2 focus:ring-indigo-500"
                />
              )}
            </div>

            {/* Work Category Select (Hạng Mục Thi Công Căn Hộ) */}
            <div>
              <label className="block font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                <span>Liên Kết Hạng Mục Thi Công Căn Hộ *</span>
                <span className="text-[10px] text-indigo-600 font-bold">(Chọn một hoặc nhiều hạng mục)</span>
              </label>
              
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">
                {workCategoriesList.map((wCat) => {
                  const isChecked = workCategories.includes(wCat);
                  return (
                    <label key={wCat} className="flex items-start gap-2.5 p-1.5 hover:bg-white rounded-lg transition-colors cursor-pointer text-xs font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setWorkCategories(prev => [...prev, wCat]);
                          } else {
                            setWorkCategories(prev => prev.filter(item => item !== wCat));
                          }
                        }}
                        className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 w-4 h-4"
                      />
                      <span>{wCat}</span>
                    </label>
                  );
                })}
              </div>
              {workCategories.length === 0 && (
                <p className="text-[10px] text-rose-500 font-bold mt-1">⚠️ Vui lòng chọn ít nhất 1 hạng mục thi công liên kết.</p>
              )}
            </div>

            {/* Material Name */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Tên Vật Tư Chi Tiết *</label>
              <input
                type="text"
                placeholder="VD: Tấm thạch cao tiêu chuẩn Gyproc 9mm"
                value={materialName}
                onChange={(e) => setMaterialName(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-2.5 font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            {/* Unit Select */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Tên Đơn Vị Tính (ĐVT) *</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-2.5 font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500"
              >
                {COMMON_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
                <option value="khac">Đơn vị tính khác (Nhập tự do)</option>
              </select>
              {unit === 'khac' && (
                <input
                  type="text"
                  placeholder="Nhập tên ĐVT mới (VD: Can, Cuộn, Cặp...)"
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-semibold text-slate-800 mt-2 bg-white focus:ring-2 focus:ring-indigo-500"
                />
              )}
            </div>

            {/* Quotas Input Grid */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Số Lượng Định Mức *</label>
                <input
                  type="number"
                  placeholder="VD: 500"
                  value={quotaQuantity}
                  onChange={(e) => setQuotaQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-indigo-600 focus:ring-2 focus:ring-indigo-500"
                  min="1"
                  required
                />
                {computedAutoQuota !== null ? (
                  <button
                    type="button"
                    onClick={() => setQuotaQuantity(computedAutoQuota)}
                    className="mt-1 text-[10px] text-indigo-700 hover:text-indigo-900 font-extrabold flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 p-1.5 rounded-lg border border-indigo-200 transition-all active:scale-95 text-left w-full"
                    title={`Khối lượng thi công liên kết (${selectedWorkCategoriesVolume} m²) x Định mức hao phí (${unitNormPerM2})`}
                  >
                    <span>💡 Áp dụng định mức: <strong>{computedAutoQuota.toLocaleString()}</strong> {unit === 'khac' ? customUnit : unit}</span>
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Tổng số định mức toàn công trình</span>
                )}
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Định Mức / m² (Không bắt buộc)</label>
                <input
                  type="number"
                  step="0.001"
                  placeholder="VD: 0.35"
                  value={unitNormPerM2}
                  onChange={(e) => setUnitNormPerM2(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Hào phí tiêu hao trên 1m² sàn/trần</span>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Ghi Chú / Tiêu Chuẩn Kỹ Thuật</label>
              <textarea
                placeholder="VD: Quy cách 1220x2440mm, độ dày 9mm, chuẩn ASTM..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Submit Action */}
            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setMode('list')}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl active:scale-95 transition-all"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md active:scale-95 transition-all flex items-center justify-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                Lưu Định Mức
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Delete Confirmation Modal Overlay */}
      {deletingNormTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-60 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full space-y-4 border border-slate-100 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Xác Nhận Xóa Định Mức</h3>
              <p className="text-xs text-slate-500 mt-1">
                Bạn có chắc chắn muốn xóa định mức <strong className="text-slate-800">{deletingNormTarget.materialName}</strong>?
              </p>
              <p className="text-[11px] text-indigo-600 mt-1 font-medium">💡 Thao tác này có thể Hoàn Tác (Undo).</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeletingNormTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteNorm(deletingNormTarget.id);
                  setDeletingNormTarget(null);
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs shadow"
              >
                Xác Nhận Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
