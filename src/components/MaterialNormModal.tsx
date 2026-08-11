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
  FileSpreadsheet,
  Sparkles
} from 'lucide-react';
import { MaterialNorm, InventoryItem, WorkVolume } from '../types';
import * as XLSX from 'xlsx';
import { exportWarehouseUpdateTemplate } from '../utils/excelExport';
import { confirmAsync } from '../utils/confirmAsync';
import { formatExcelDate } from '../utils/dateFormatter';

interface MaterialNormModalProps {
  isOpen: boolean;
  onClose: () => void;
  materialNorms: MaterialNorm[];
  onAddNorm: (norm: Omit<MaterialNorm, 'id'>) => void;
  onUpdateNorm: (id: string, updated: Omit<MaterialNorm, 'id'>) => void;
  onDeleteNorm: (id: string) => void;
  onDeleteMultipleNorms?: (ids: string[]) => void;
  onImportNorms?: (norms: MaterialNorm[]) => void;
  inventory: InventoryItem[];
  workVolumes?: WorkVolume[];
  onImportWorkVolumes?: (volumes: WorkVolume[]) => void;
  onImportInventory?: (inventory: InventoryItem[]) => void;
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
  onDeleteMultipleNorms,
  onImportNorms,
  inventory,
  workVolumes,
  onImportWorkVolumes,
  onImportInventory,
}) => {
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNormIds, setSelectedNormIds] = useState<string[]>([]);

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
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = async () => {
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

  const processExcelFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        let inCount = 0;
        let outCount = 0;
        let normsUpdatedCount = 0;
        let normsAddedCount = 0;
        let volumesUpdatedCount = 0;
        let volumesAddedCount = 0;

        let newInventory = [...inventory];
        let newNorms = [...materialNorms];
        let newWorkVolumes = workVolumes ? [...workVolumes] : [];

        // 1. Sheet "Nhập Kho"
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
            const materialNameRaw = row['Tên Vật Tư'] || row['Tên Vật Tư Thạch Cao'] || row['materialName'] || row['Vật tư'] || row['Vat tu'];
            if (!materialNameRaw) return;

            const materialNameStr = String(materialNameRaw).trim();
            const quantityNum = Number(row['Số Lượng'] || row['quantity'] || 0);
            if (isNaN(quantityNum) || quantityNum <= 0) return;

            const unitStr = String(row['Đơn Vị Tính'] || row['unit'] || 'Tấm').trim();
            const locationStr = String(row['Vị Trí Kho'] || row['Vị Trí Lưu Kho / Hạng Mục'] || row['location'] || 'Kho chính').trim();
            const handlerStr = String(row['Người Thực Hiện'] || row['handler'] || 'Thủ kho').trim();
            const rawDate = row['Ngày Thực Hiện'] || row['Ngày Lập Phiếu'] || row['date'];
            const dateStr = formatExcelDate(rawDate);
            const notesStr = String(row['Ghi Chú'] || row['notes'] || '').trim();
            const rawId = row['Mã Phiếu'] || row['id'] || row['ID'];

            const existingIdx = rawId ? newInventory.findIndex(i => i.id === String(rawId).trim()) : -1;

            const invItem: InventoryItem = {
              id: existingIdx >= 0 ? newInventory[existingIdx].id : (rawId ? String(rawId).trim() : `INV-IN-${Date.now()}-${rIdx}-${Math.random().toString(36).substring(2, 5)}`),
              type: 'in',
              materialName: materialNameStr,
              unit: unitStr,
              quantity: quantityNum,
              location: locationStr,
              handler: handlerStr,
              date: dateStr,
              notes: notesStr || undefined
            };

            if (existingIdx >= 0) {
              newInventory[existingIdx] = invItem;
            } else {
              newInventory.unshift(invItem);
            }
            inCount++;
          });
        }

        // 2. Sheet "Xuất Kho"
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
            const materialNameRaw = row['Tên Vật Tư'] || row['Tên Vật Tư Thạch Cao'] || row['materialName'] || row['Vật tư'] || row['Vat tu'];
            if (!materialNameRaw) return;

            const materialNameStr = String(materialNameRaw).trim();
            const quantityNum = Number(row['Số Lượng'] || row['quantity'] || 0);
            if (isNaN(quantityNum) || quantityNum <= 0) return;

            const unitStr = String(row['Đơn Vị Tính'] || row['unit'] || 'Tấm').trim();
            const locationStr = String(row['Vị Trí Kho'] || row['Vị Trí Kho / Hạng Mục'] || row['Vị Trí Lưu Kho / Hạng Mục'] || row['location'] || 'Công trình').trim();
            const handlerStr = String(row['Người Thực Hiện'] || row['handler'] || 'Thủ kho').trim();
            const rawDate = row['Ngày Thực Hiện'] || row['Ngày Lập Phiếu'] || row['date'];
            const dateStr = formatExcelDate(rawDate);
            const notesStr = String(row['Ghi Chú'] || row['notes'] || '').trim();
            const rawId = row['Mã Phiếu'] || row['id'] || row['ID'];

            const existingIdx = rawId ? newInventory.findIndex(i => i.id === String(rawId).trim()) : -1;

            const invItem: InventoryItem = {
              id: existingIdx >= 0 ? newInventory[existingIdx].id : (rawId ? String(rawId).trim() : `INV-OUT-${Date.now()}-${rIdx}-${Math.random().toString(36).substring(2, 5)}`),
              type: 'out',
              materialName: materialNameStr,
              unit: unitStr,
              quantity: quantityNum,
              location: locationStr,
              handler: handlerStr,
              date: dateStr,
              notes: notesStr || undefined
            };

            if (existingIdx >= 0) {
              newInventory[existingIdx] = invItem;
            } else {
              newInventory.unshift(invItem);
            }
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
            const quotaQuantityNum = Number(row['Số Lượng Định Mức'] || row['quotaQuantity'] || 0);
            const unitNormPerM2Num = row['Định Mức / m2'] || row['Định Mức Hao Phí / m2'] || row['Định mức tiêu hao'] || row['unitNormPerM2'];
            const notesStr = String(row['Ghi Chú'] || row['notes'] || '').trim();

            const existingIdx = newNorms.findIndex(n => n.materialName.toLowerCase() === materialNameStr.toLowerCase());

            const normData: MaterialNorm = {
              id: existingIdx >= 0 ? newNorms[existingIdx].id : `NORM-${Date.now()}-${rIdx}-${Math.random().toString(36).substring(2, 5)}`,
              category: categoryStr,
              workCategory: workCategoryStr,
              workCategories: workCategoryStr ? workCategoryStr.split(',').map(s => s.trim()).filter(Boolean) : undefined,
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

        // 4. Sheet "Hạng Mục Thi Công"
        const volumeSheetName = workbook.SheetNames.find(
          name => {
            const n = name.toLowerCase();
            return n.includes('khoi luong') || n.includes('khối lượng') || n.includes('hang muc') || n.includes('hạng mục');
          }
        );

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

        const totalItemsFound = inCount + outCount + normsUpdatedCount + normsAddedCount + volumesUpdatedCount + volumesAddedCount;

        if (totalItemsFound === 0) {
          alert(
            `⚠️ Không tìm thấy dữ liệu hợp lệ trong các trang Excel của bạn!\n\n` +
            `• Danh sách Sheet tìm thấy trong file: [${workbook.SheetNames.join(', ')}]\n` +
            `• Yêu cầu tên Sheet (không phân biệt hoa thường):\n` +
            `  - Nhập Kho: chứa chữ 'nhap' hoặc 'nhập'\n` +
            `  - Xuất Kho: chứa chữ 'xuat' hoặc 'xuất'\n` +
            `  - Định Mức Vật Tư: chứa chữ 'dinh muc' hoặc 'định mức'\n` +
            `  - Hạng Mục Thi Công: chứa chữ 'khoi luong', 'khối lượng', 'hang muc' hoặc 'hạng mục'\n\n` +
            `Vui lòng kiểm tra lại tên các Sheet và tiêu đề cột dữ liệu trong tệp.`
          );
          return;
        }

        const confirmMsg =
          `📊 Kết quả phân tích tệp Excel:\n\n` +
          `📥 NHẬP KHO: ${inCount} phiếu nhập\n` +
          `📤 XUẤT KHO: ${outCount} phiếu xuất\n` +
          `📋 ĐỊNH MỨC VẬT TƯ: ${normsUpdatedCount} cập nhật, ${normsAddedCount} mới\n` +
          `🏗️ HẠNG MỤC THI CÔNG: ${volumesUpdatedCount} cập nhật, ${volumesAddedCount} mới\n\n` +
          `Bạn có đồng ý áp dụng các thay đổi này vào hệ thống không?`;

        const confirmUpdate = await confirmAsync(confirmMsg);
        if (confirmUpdate) {
          if (onImportInventory && (inCount > 0 || outCount > 0)) {
            onImportInventory(newInventory);
          }
          if (onImportNorms && (normsUpdatedCount > 0 || normsAddedCount > 0)) {
            onImportNorms(newNorms);
          }
          if (onImportWorkVolumes && workVolumes && (volumesUpdatedCount > 0 || volumesAddedCount > 0)) {
            onImportWorkVolumes(newWorkVolumes);
          }
          alert('🎉 Đã cập nhật thành công dữ liệu từ tệp Excel!');
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
  const [quotaQuantityStr, setQuotaQuantityStr] = useState<string>('500');
  const [unitNormPerM2, setUnitNormPerM2] = useState<number | ''>(0.35);
  const [unitNormPerM2Str, setUnitNormPerM2Str] = useState<string>('0.35');
  const [workCategoryNorms, setWorkCategoryNorms] = useState<Record<string, number>>({});
  const [workCategoryNormsStr, setWorkCategoryNormsStr] = useState<Record<string, string>>({});
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

  const categoriesInUse = Array.from(new Set(materialNorms.map((n) => n.category).filter(Boolean)));

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
    if (!workVolumes || workCategories.length === 0) return null;

    let totalQuota = 0;
    let hasNorms = false;

    workCategories.forEach(cat => {
      const catVolume = workVolumes
        .filter(v => v.title === cat)
        .reduce((sum, v) => sum + (v.planned || 0), 0);

      if (catVolume > 0) {
        let factor = 0;
        if (workCategoryNorms && workCategoryNorms[cat] !== undefined) {
          factor = workCategoryNorms[cat];
          hasNorms = true;
        } else if (unitNormPerM2 && Number(unitNormPerM2) > 0) {
          factor = Number(unitNormPerM2);
          hasNorms = true;
        }
        totalQuota += catVolume * factor;
      }
    });

    if (hasNorms && totalQuota > 0) {
      return Math.round(totalQuota * 100) / 100;
    }
    return null;
  }, [workVolumes, workCategories, workCategoryNorms, unitNormPerM2]);

  const handleOpenAdd = async () => {
    setCategory(COMMON_CATEGORIES[0]);
    setCustomCategory('');
    setWorkCategories([workCategoriesList[0] || WORK_CATEGORIES_LIST[0]]);
    setMaterialName('');
    setUnit(COMMON_UNITS[0]);
    setCustomUnit('');
    setQuotaQuantity(100);
    setQuotaQuantityStr('100');
    setUnitNormPerM2('');
    setUnitNormPerM2Str('');
    setWorkCategoryNorms({});
    setWorkCategoryNormsStr({});
    setNotes('');
    setEditingId(null);
    setMode('add');
  };

  const handleOpenEdit = async (norm: MaterialNorm) => {
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
    setQuotaQuantityStr(norm.quotaQuantity.toString());
    setUnitNormPerM2(norm.unitNormPerM2 || '');
    setUnitNormPerM2Str(norm.unitNormPerM2 !== undefined ? norm.unitNormPerM2.toString() : '');
    setWorkCategoryNorms(norm.workCategoryNorms || {});
    const initialNormsStr: Record<string, string> = {};
    if (norm.workCategoryNorms) {
      Object.entries(norm.workCategoryNorms).forEach(([cat, val]) => {
        initialNormsStr[cat] = val.toString();
      });
    }
    setWorkCategoryNormsStr(initialNormsStr);
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
      workCategoryNorms: workCategoryNorms,
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
                {/* Bulk actions toolbar */}
                <div className="flex items-center justify-between bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-xs gap-2">
                  <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={filteredNorms.length > 0 && filteredNorms.every(item => selectedNormIds.includes(item.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedNormIds(prev => Array.from(new Set([...prev, ...filteredNorms.map(item => item.id)])));
                        } else {
                          setSelectedNormIds(prev => prev.filter(id => !filteredNorms.some(item => item.id === id)));
                        }
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>Chọn Tất Cả ({filteredNorms.length})</span>
                  </label>

                  <div className="flex items-center gap-3 justify-end">
                    {selectedNormIds.some(id => filteredNorms.some(item => item.id === id)) && (
                      <button
                        type="button"
                        onClick={async () => {
                          const idsToDelete = selectedNormIds.filter(id => filteredNorms.some(item => item.id === id));
                          if (await confirmAsync(`Bạn có chắc muốn xóa ${idsToDelete.length} định mức đã chọn?`)) {
                            if (onDeleteMultipleNorms) {
                              onDeleteMultipleNorms(idsToDelete);
                            } else {
                              idsToDelete.forEach(id => onDeleteNorm(id));
                            }
                            setSelectedNormIds(prev => prev.filter(id => !idsToDelete.includes(id)));
                          }
                        }}
                        className="text-rose-600 hover:text-rose-700 font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Xóa Đã Chọn ({selectedNormIds.filter(id => filteredNorms.some(item => item.id === id)).length})
                      </button>
                    )}
                  </div>
                </div>

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
                        <div className="flex items-start gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedNormIds.includes(norm.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedNormIds(prev => [...prev, norm.id]);
                              } else {
                                setSelectedNormIds(prev => prev.filter(id => id !== norm.id));
                              }
                            }}
                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer mt-1 shrink-0"
                          />
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
                          <p className="font-bold text-indigo-600">{(norm.quotaQuantity ?? 0).toLocaleString('en-US')} {norm.unit}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 font-semibold uppercase">Định Mức / m²</p>
                          <p className="font-semibold text-slate-700">{norm.unitNormPerM2 ? `${norm.unitNormPerM2} ${norm.unit}/m²` : 'Chưa nhập'}</p>
                        </div>
                      </div>

                      {/* Stock vs Quota Progress */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] font-bold">
                          <span className="text-slate-500">Thực tế đã nhập: <strong className="text-slate-800">{(actualStock ?? 0).toLocaleString('en-US')} {norm.unit}</strong></span>
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
                  type="text"
                  inputMode="decimal"
                  placeholder="VD: 500"
                  value={quotaQuantityStr}
                  onChange={(e) => {
                    const typedVal = e.target.value.replace(/,/g, '.');
                    setQuotaQuantityStr(typedVal);
                    setQuotaQuantity(typedVal === '' ? '' : Number(typedVal));
                  }}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-indigo-600 focus:ring-2 focus:ring-indigo-500"
                  required
                />
                {computedAutoQuota !== null ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuotaQuantity(computedAutoQuota);
                      setQuotaQuantityStr(computedAutoQuota.toString());
                    }}
                    className="mt-1 text-[10px] text-indigo-700 hover:text-indigo-900 font-extrabold flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 p-1.5 rounded-lg border border-indigo-200 transition-all active:scale-95 text-left w-full"
                    title={`Khối lượng thi công liên kết (${selectedWorkCategoriesVolume} m²) x Định mức hao phí (${unitNormPerM2})`}
                  >
                    <span>💡 Áp dụng định mức: <strong>{computedAutoQuota.toLocaleString('en-US')}</strong> {unit === 'khac' ? customUnit : unit}</span>
                  </button>
                ) : (
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Tổng số định mức toàn công trình</span>
                )}
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Định Mức / m² (Không bắt buộc)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="VD: 0.35"
                  value={unitNormPerM2Str}
                  onChange={(e) => {
                    const typedVal = e.target.value.replace(/,/g, '.');
                    setUnitNormPerM2Str(typedVal);
                    setUnitNormPerM2(typedVal === '' ? '' : Number(typedVal));
                  }}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Hao phí tiêu hao trên 1m² sàn/trần</span>
              </div>
            </div>

            {/* Specific Norm overrides for each selected work category */}
            {workCategories.length > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                <div className="text-xs font-extrabold text-indigo-700 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Định mức riêng cho từng Hạng Mục Thi Công (Tùy chọn)</span>
                </div>
                <p className="text-[10px] text-slate-500 font-medium">Nếu có định mức khác nhau, hãy nhập riêng tại đây (mặc định sẽ dùng định mức chung ở trên):</p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {workCategories.map(cat => {
                    return (
                      <div key={cat} className="flex items-center justify-between gap-2 bg-white border border-slate-100 rounded-lg p-2">
                        <span className="text-[11px] font-bold text-slate-700 truncate max-w-[180px]">{cat}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="Mặc định"
                            value={workCategoryNormsStr[cat] !== undefined ? workCategoryNormsStr[cat] : ''}
                            onChange={(e) => {
                              const typedVal = e.target.value.replace(/,/g, '.');
                              setWorkCategoryNormsStr(prev => ({
                                ...prev,
                                [cat]: typedVal
                              }));

                              const val = typedVal === '' ? undefined : Number(typedVal);
                              setWorkCategoryNorms(prev => {
                                const next = { ...prev };
                                if (val === undefined || isNaN(val)) {
                                  delete next[cat];
                                } else {
                                  next[cat] = val;
                                }
                                return next;
                              });
                            }}
                            className="w-20 border border-slate-200 rounded px-1.5 py-1 text-right font-bold text-xs text-indigo-600 focus:ring-1 focus:ring-indigo-500"
                          />
                          <span className="text-[10px] text-slate-400 font-bold">/{unit === 'khac' ? customUnit : unit}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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
