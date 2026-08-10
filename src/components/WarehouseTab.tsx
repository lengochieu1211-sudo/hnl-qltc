import React, { useState, useMemo } from 'react';
import { 
  ArrowDownLeft, 
  ArrowUpRight, 
  Plus, 
  Search, 
  PackageCheck, 
  Layers, 
  Calendar, 
  User, 
  MapPin, 
  FileSpreadsheet,
  FileText,
  Trash2,
  Filter,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Download,
  Upload
} from 'lucide-react';
import { InventoryItem, TransactionType, MaterialNorm, WorkVolume } from '../types';
import { formatDateDDMMYYYY } from '../utils/dateFormatter';
import * as XLSX from 'xlsx';
import { exportWarehouseUpdateTemplate } from '../utils/excelExport';

interface WarehouseTabProps {
  inventory: InventoryItem[];
  onAddInventory: (item: Omit<InventoryItem, 'id'>) => void;
  onDeleteInventory: (id: string) => void;
  onSyncSheets: () => void;
  materialNorms: MaterialNorm[];
  onOpenNormModal: () => void;
  onOpenExportPdf?: () => void;
  onExportExcel?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  workVolumes?: WorkVolume[];
  onImportNorms?: (norms: MaterialNorm[]) => void;
  onImportWorkVolumes?: (volumes: WorkVolume[]) => void;
}

export const WarehouseTab: React.FC<WarehouseTabProps> = ({
  inventory,
  onAddInventory,
  onDeleteInventory,
  onSyncSheets,
  materialNorms,
  onOpenNormModal,
  onOpenExportPdf,
  onExportExcel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  workVolumes,
  onImportNorms,
  onImportWorkVolumes,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'in' | 'out'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Drag and Drop state for Excel file
  const [isDraggingExcel, setIsDraggingExcel] = useState(false);

  const handleDragOverExcel = (e: React.DragOverEvent | any) => {
    e.preventDefault();
    setIsDraggingExcel(true);
  };

  const handleDragLeaveExcel = () => {
    setIsDraggingExcel(false);
  };

  const handleDropExcel = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingExcel(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processWarehouseUpdateExcel(file);
    }
  };

  const handleFileChangeExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processWarehouseUpdateExcel(file);
    e.target.value = ''; // Reset input
  };

  const processWarehouseUpdateExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        let normsUpdatedCount = 0;
        let normsAddedCount = 0;
        let volumesUpdatedCount = 0;
        let volumesAddedCount = 0;

        let newNorms = [...materialNorms];
        let newWorkVolumes = workVolumes ? [...workVolumes] : [];

        // 1. Parse Sheet "Dinh Muc" / "Vat Tu" (Norms)
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

        // 2. Parse Sheet "Khoi Luong" / "Hang Muc" (Work Volumes)
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

  // Form state
  const [type, setType] = useState<TransactionType>('in');
  const [materialName, setMaterialName] = useState(materialNorms[0]?.materialName || '');
  const [customMaterial, setCustomMaterial] = useState('');
  const [unit, setUnit] = useState(materialNorms[0]?.unit || 'Tấm');
  const [quantity, setQuantity] = useState<number | ''>(100);
  const [location, setLocation] = useState('Kho Tầng 1');
  const [handler, setHandler] = useState('Nguyễn Văn Hùng (Thủ kho)');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');

  // Delete confirmation state
  const [deletingInventoryTarget, setDeletingInventoryTarget] = useState<InventoryItem | null>(null);

  // Auto update material selection when materialNorms change
  React.useEffect(() => {
    if (materialNorms.length > 0) {
      const matched = materialNorms.find((m) => m.materialName === materialName);
      if (!matched) {
        setMaterialName(materialNorms[0].materialName);
        setUnit(materialNorms[0].unit);
      }
    }
  }, [materialNorms]);

  // Map material norms by name for quick lookup
  const normMap = useMemo(() => {
    const map: Record<string, MaterialNorm> = {};
    materialNorms.forEach((n) => {
      map[n.materialName.trim().toLowerCase()] = n;
    });
    return map;
  }, [materialNorms]);

  // Calculate stock balance per material (includes all material norms automatically)
  const stockBalance = useMemo(() => {
    const balances: Record<string, { inQty: number; outQty: number; balance: number; unit: string }> = {};

    // First initialize with all material norms so every material in norm list appears automatically
    materialNorms.forEach((norm) => {
      const name = norm.materialName.trim();
      balances[name] = { inQty: 0, outQty: 0, balance: 0, unit: norm.unit };
    });

    inventory.forEach((item) => {
      const name = item.materialName.trim();
      if (!balances[name]) {
        balances[name] = { inQty: 0, outQty: 0, balance: 0, unit: item.unit };
      }
      if (item.type === 'in') {
        balances[name].inQty += item.quantity;
        balances[name].balance += item.quantity;
      } else {
        balances[name].outQty += item.quantity;
        balances[name].balance -= item.quantity;
      }
    });

    return balances;
  }, [inventory, materialNorms]);

  // Calculate low stock warnings
  const lowStockItems = useMemo(() => {
    const items: Array<{
      name: string;
      balance: number;
      quota?: number;
      unit: string;
      status: 'out' | 'very-low' | 'low';
      percent: number;
    }> = [];

    (Object.entries(stockBalance) as [string, { inQty: number; outQty: number; balance: number; unit: string }][]).forEach(([name, data]) => {
      const matchedNorm = normMap[name.toLowerCase()];
      const quota = matchedNorm?.quotaQuantity;
      
      if (quota && quota > 0) {
        const percent = Math.round((data.balance / quota) * 100);
        if (data.balance <= 0) {
          items.push({
            name,
            balance: data.balance,
            quota,
            unit: data.unit,
            status: 'out',
            percent,
          });
        } else if (percent <= 5) {
          items.push({
            name,
            balance: data.balance,
            quota,
            unit: data.unit,
            status: 'very-low',
            percent,
          });
        } else if (percent <= 15) {
          items.push({
            name,
            balance: data.balance,
            quota,
            unit: data.unit,
            status: 'low',
            percent,
          });
        }
      } else {
        // No quota defined
        if (data.balance <= 0) {
          items.push({
            name,
            balance: data.balance,
            unit: data.unit,
            status: 'out',
            percent: 0,
          });
        } else if (data.balance <= 15) {
          items.push({
            name,
            balance: data.balance,
            unit: data.unit,
            status: 'low',
            percent: 0,
          });
        }
      }
    });

    return items;
  }, [stockBalance, normMap]);

  // Calculate material quota import warnings (exceeded or near-complete)
  const quotaWarnings = useMemo(() => {
    const warnings: Array<{
      name: string;
      inQty: number;
      quota: number;
      unit: string;
      status: 'exceeded' | 'near-complete';
      percent: number;
    }> = [];

    (Object.entries(stockBalance) as [string, { inQty: number; outQty: number; balance: number; unit: string }][]).forEach(([name, data]) => {
      const matchedNorm = normMap[name.toLowerCase()];
      const quota = matchedNorm?.quotaQuantity;
      
      if (quota && quota > 0) {
        const percent = Math.round((data.inQty / quota) * 100);
        if (data.inQty > quota) {
          warnings.push({
            name,
            inQty: data.inQty,
            quota,
            unit: data.unit,
            status: 'exceeded',
            percent,
          });
        } else if (data.inQty >= quota * 0.9) {
          warnings.push({
            name,
            inQty: data.inQty,
            quota,
            unit: data.unit,
            status: 'near-complete',
            percent,
          });
        }
      }
    });

    return warnings;
  }, [stockBalance, normMap]);

  // Live warning for the form
  const formQuotaWarning = useMemo(() => {
    if (type !== 'in' || !quantity) return null;
    const targetName = customMaterial.trim() || materialName.trim();
    if (!targetName) return null;

    const matchedNorm = normMap[targetName.toLowerCase()];
    if (!matchedNorm || !matchedNorm.quotaQuantity) return null;

    const quota = matchedNorm.quotaQuantity;
    const currentInQty = stockBalance[matchedNorm.materialName]?.inQty || 0;
    const projectedInQty = currentInQty + Number(quantity);
    const percent = Math.round((projectedInQty / quota) * 100);

    if (projectedInQty > quota) {
      return {
        status: 'exceeded',
        text: `Cảnh báo: Tổng lượng nhập sau phiếu này sẽ đạt ${projectedInQty} ${unit} (vượt định mức ${quota} ${unit}). Đã nhập lố ${percent - 100}%!`,
        currentInQty,
        quota,
        projectedInQty,
        percent,
      };
    } else if (projectedInQty >= quota * 0.9) {
      return {
        status: 'near-complete',
        text: `Lưu ý: Tổng lượng nhập sau phiếu này sẽ đạt ${projectedInQty} ${unit} (${percent}% định mức ${quota} ${unit}). Đang gần đủ định mức, vui lòng kiểm tra kỹ nếu đây là đơn hàng cuối!`,
        currentInQty,
        quota,
        projectedInQty,
        percent,
      };
    }

    return null;
  }, [type, quantity, materialName, customMaterial, normMap, stockBalance, unit]);

  const filteredInventory = useMemo(() => {
    return inventory.filter((item) => {
      const matchesType = filterType === 'all' || item.type === filterType;
      const matchesSearch = 
        item.materialName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.handler.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.id.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [inventory, filterType, searchTerm]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalMaterialName = customMaterial.trim() ? customMaterial.trim() : materialName;
    if (!finalMaterialName || !quantity || quantity <= 0) {
      alert('Vui lòng nhập tên vật tư và số lượng hợp lệ!');
      return;
    }

    onAddInventory({
      type,
      materialName: finalMaterialName,
      unit,
      quantity: Number(quantity),
      location,
      handler,
      date,
      notes,
    });

    setShowAddForm(false);
    setCustomMaterial('');
    setNotes('');
    alert(`Đã thêm phiếu ${type === 'in' ? 'NHẬP KHO' : 'XUẤT KHO'} thành công!`);
  };

  return (
    <div className="p-4 space-y-4 pb-24 max-w-xl mx-auto">
      {/* Title & Action Row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-blue-600" />
            Quản Lý Nhập Xuất Kho
          </h2>
          <p className="text-xs text-slate-500">Tồn kho vật tư &amp; định mức công trình</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            onClick={onOpenNormModal}
            className="flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-2.5 py-2 rounded-xl text-xs font-bold active:scale-95 transition-all"
            title="Cập nhật chủng loại vật tư, ĐVT, định mức"
          >
            <Sliders className="w-3.5 h-3.5 text-indigo-600" />
            <span>Định Mức</span>
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-xl text-xs font-bold shadow-md active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            Tạo Phiếu
          </button>
        </div>
      </div>

      {/* Cảnh Báo Gần Hết Vật Tư */}
      {lowStockItems.length > 0 && (
        <div className="bg-amber-50/75 border border-amber-200 rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center gap-1.5 text-amber-800">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 animate-pulse" />
            <span className="text-xs font-extrabold uppercase tracking-wider">
              🚨 Cảnh Báo Vật Tư Sắp Hết ({lowStockItems.length})
            </span>
          </div>
          <p className="text-[11px] text-amber-700 leading-normal">
            Hệ thống phát hiện các vật tư dưới đây có tồn kho ở mức cảnh báo nguy hiểm (dưới 15% định mức hoặc đã hết). Vui lòng lên kế hoạch nhập hàng bổ sung!
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1 pt-1">
            {lowStockItems.map((item, idx) => {
              const isOut = item.status === 'out';
              const isVeryLow = item.status === 'very-low';
              return (
                <div 
                  key={`${item.name}-${idx}`} 
                  className={`flex items-center justify-between p-2 rounded-xl text-xs font-medium border ${
                    isOut 
                      ? 'bg-rose-50 border-rose-100 text-rose-800' 
                      : isVeryLow 
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-yellow-50 border-yellow-200 text-yellow-800'
                  }`}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <p className="font-bold truncate">{item.name}</p>
                    <p className="text-[10px] opacity-80">
                      Tồn thực tế: <strong className="font-extrabold">{item.balance}</strong> {item.unit}
                      {item.quota ? ` / Định mức: ${item.quota} ${item.unit}` : ''}
                    </p>
                  </div>
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md shrink-0 ${
                    isOut 
                      ? 'bg-rose-100 text-rose-800 uppercase' 
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {isOut ? 'HẾT HÀNG' : `${item.percent}%`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cảnh Báo Định Mức Nhập Kho */}
      {quotaWarnings.length > 0 && (
        <div className="bg-indigo-50/75 border border-indigo-200 rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center gap-1.5 text-indigo-800">
            <AlertTriangle className="w-5 h-5 text-indigo-600 shrink-0" />
            <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-900">
              ⚠️ Cảnh Báo Định Mức Nhập Kho ({quotaWarnings.length})
            </span>
          </div>
          <p className="text-[11px] text-indigo-700 leading-normal">
            Hệ thống phát hiện các vật tư đã nhập gần đủ hoặc vượt quá định mức (lố định mức) yêu cầu thiết kế. Vui lòng đối chiếu kỹ khi làm việc với nhà cung cấp hoặc đặt đơn cuối!
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1 pt-1">
            {quotaWarnings.map((item, idx) => {
              const isExceeded = item.status === 'exceeded';
              return (
                <div 
                  key={`${item.name}-${idx}`} 
                  className={`flex items-center justify-between p-2 rounded-xl text-xs font-medium border ${
                    isExceeded 
                      ? 'bg-rose-50 border-rose-200 text-rose-800' 
                      : 'bg-indigo-50 border-indigo-100 text-indigo-800'
                  }`}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <p className="font-bold truncate">{item.name}</p>
                    <p className="text-[10px] opacity-80">
                      Tổng đã nhập: <strong className="font-extrabold">{item.inQty}</strong> / Định mức: {item.quota} {item.unit}
                    </p>
                  </div>
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md shrink-0 ml-1 text-center ${
                    isExceeded 
                      ? 'bg-rose-100 text-rose-700 uppercase' 
                      : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    {isExceeded ? `LỐ ${item.percent - 100}%` : `${item.percent}%`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}


      {/* Stock Summary Balance Cards */}
      <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-bold text-slate-800">
              Bảng Tổng Tồn Kho vs Định Mức
            </span>
          </div>
          <button
            onClick={onOpenNormModal}
            className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold underline"
          >
            Quản lý chủng loại &amp; ĐVT
          </button>
        </div>

        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {(Object.entries(stockBalance) as [string, { inQty: number; outQty: number; balance: number; unit: string }][]).map(([name, data]) => {
            const matchedNorm = normMap[name.toLowerCase()];
            const quota = matchedNorm?.quotaQuantity;
            const category = matchedNorm?.category;

            return (
              <div key={name} className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 text-xs space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {category && (
                      <span className="inline-block px-1.5 py-0.2 bg-indigo-100 text-indigo-700 text-[9px] font-bold rounded uppercase mb-0.5">
                        {category}
                      </span>
                    )}
                    <p className="font-bold text-slate-800 truncate">{name}</p>
                    <p className="text-[10px] text-slate-500">
                      Nhập: <span className="text-emerald-600 font-bold">{data.inQty}</span> | 
                      Xuất: <span className="text-amber-600 font-bold">{data.outQty}</span> {data.unit}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-bold ${
                      data.balance <= 20 ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      Tồn: {data.balance} {data.unit}
                    </span>
                    {quota && (
                      <p className="text-[10px] text-slate-500 mt-0.5 font-semibold">
                        Định mức: <strong className="text-indigo-600">{quota}</strong> {data.unit}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>


      {/* Filter and Search controls */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Tìm vật tư, vị trí kho, người giao..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white text-xs pl-9 pr-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-blue-500 shadow-sm"
          />
        </div>

        <div className="flex items-center justify-between gap-1 text-xs">
          <div className="flex bg-slate-200 p-1 rounded-xl w-full">
            <button
              onClick={() => setFilterType('all')}
              className={`flex-1 py-1 rounded-lg text-center font-semibold transition-all ${
                filterType === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Tất Cả ({inventory.length})
            </button>
            <button
              onClick={() => setFilterType('in')}
              className={`flex-1 py-1 rounded-lg text-center font-semibold transition-all ${
                filterType === 'in' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600'
              }`}
            >
              Nhập Kho
            </button>
            <button
              onClick={() => setFilterType('out')}
              className={`flex-1 py-1 rounded-lg text-center font-semibold transition-all ${
                filterType === 'out' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-600'
              }`}
            >
              Xuất Kho
            </button>
          </div>
        </div>
      </div>

      {/* Transaction List */}
      <div className="space-y-2.5">
        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
          Nhật Ký Nhập Xuất ({filteredInventory.length})
        </h3>

        {filteredInventory.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 text-center text-slate-400 text-xs border border-dashed border-slate-300">
            Không tìm thấy lịch sử giao dịch kho phù hợp
          </div>
        ) : (
          filteredInventory.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-sm space-y-2 hover:border-slate-300 transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`p-1.5 rounded-lg shrink-0 ${
                      item.type === 'in'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {item.type === 'in' ? (
                      <ArrowDownLeft className="w-4 h-4" />
                    ) : (
                      <ArrowUpRight className="w-4 h-4" />
                    )}
                  </span>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 mr-1.5">
                      [{item.id}]
                    </span>
                    <span
                      className={`text-[10px] uppercase font-extrabold px-1.5 py-0.5 rounded ${
                        item.type === 'in'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {item.type === 'in' ? 'NHẬP KHO' : 'XUẤT KHO'}
                    </span>
                    <h4 className="text-xs font-bold text-slate-900 mt-0.5">
                      {item.materialName}
                    </h4>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-sm font-extrabold text-slate-900">
                    {item.type === 'in' ? '+' : '-'}{item.quantity}
                  </div>
                  <div className="text-[11px] text-slate-500 font-medium">{item.unit}</div>
                </div>
              </div>

              {/* Details footer */}
              <div className="grid grid-cols-2 gap-1 pt-2 border-t border-slate-100 text-[11px] text-slate-600">
                <div className="flex items-center gap-1 truncate">
                  <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="truncate">{item.location}</span>
                </div>
                <div className="flex items-center gap-1 justify-end truncate">
                  <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                  <span>{formatDateDDMMYYYY(item.date)}</span>
                </div>
                <div className="flex items-center gap-1 truncate col-span-2 text-slate-500">
                  <User className="w-3 h-3 text-slate-400 shrink-0" />
                  <span>{item.handler}</span>
                  {item.notes && <span className="italic ml-1">({item.notes})</span>}
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  onClick={() => setDeletingInventoryTarget(item)}
                  className="text-[11px] text-rose-500 hover:text-rose-700 flex items-center gap-1 font-semibold"
                >
                  <Trash2 className="w-3 h-3" /> Xóa phiếu
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Delete Inventory Confirmation Modal */}
      {deletingInventoryTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full space-y-4 border border-slate-100 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Xác Nhận Xóa Phiếu Kho</h3>
              <p className="text-xs text-slate-500 mt-1">
                Bạn có chắc chắn muốn xóa phiếu <strong className="text-slate-800">[{deletingInventoryTarget.id}] - {deletingInventoryTarget.materialName} ({deletingInventoryTarget.quantity} {deletingInventoryTarget.unit})</strong> không?
              </p>
              <p className="text-[11px] text-indigo-600 mt-1 font-medium">💡 Thao tác này có thể Hoàn Tác (Undo).</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeletingInventoryTarget(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteInventory(deletingInventoryTarget.id);
                  setDeletingInventoryTarget(null);
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs shadow"
              >
                Xác Nhận Xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Form Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <PackageCheck className="w-5 h-5 text-blue-600" />
                Tạo Phiếu Nhập / Xuất Kho
              </h3>
              <button
                onClick={() => setShowAddForm(false)}
                className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center font-bold text-slate-500 hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              {/* Type Toggle */}
              <div>
                <label className="block text-slate-700 font-bold mb-1">Loại Phiếu</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setType('in')}
                    className={`py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all ${
                      type === 'in'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    <ArrowDownLeft className="w-4 h-4" /> NHẬP KHO
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('out')}
                    className={`py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all ${
                      type === 'out'
                        ? 'bg-amber-600 text-white shadow'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4" /> XUẤT KHO
                  </button>
                </div>
              </div>

              {/* Material Select */}
              <div>
                <label className="block text-slate-700 font-bold mb-1">Chọn Vật Tư Trong Danh Mục Định Mức</label>
                <select
                  value={materialName}
                  onChange={(e) => {
                    setMaterialName(e.target.value);
                    const matched = materialNorms.find((m) => m.materialName === e.target.value);
                    if (matched) setUnit(matched.unit);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800"
                >
                  {materialNorms.map((m) => (
                    <option key={m.id} value={m.materialName}>
                      [{m.category}] {m.materialName} ({m.unit})
                    </option>
                  ))}
                </select>
              </div>

              {/* Custom Material Option */}
              <div>
                <label className="block text-slate-500 font-medium mb-1">Hoặc Nhập Tên Vật Tư Khác</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Đèn âm trần 12W, Keo bọt nở..."
                  value={customMaterial}
                  onChange={(e) => setCustomMaterial(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl p-2.5"
                />
              </div>

              {/* Quantity & Unit */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Số Lượng</label>
                  <input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : '')}
                    className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-slate-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Đơn Vị Tính</label>
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2.5"
                    required
                  />
                </div>
              </div>

              {formQuotaWarning && (
                <div className={`p-2.5 rounded-xl border text-[11px] font-medium leading-relaxed ${
                  formQuotaWarning.status === 'exceeded'
                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : 'bg-indigo-50 border-indigo-200 text-indigo-800'
                }`}>
                  <div className="flex items-start gap-1">
                    <span className="shrink-0">{formQuotaWarning.status === 'exceeded' ? '🚨' : '💡'}</span>
                    <p>{formQuotaWarning.text}</p>
                  </div>
                </div>
              )}

              {/* Location & Handler */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Vị Trí Kho / Tầng</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2.5"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Người Giao / Nhận</label>
                  <input
                    type="text"
                    value={handler}
                    onChange={(e) => setHandler(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2.5"
                    required
                  />
                </div>
              </div>

              {/* Date & Notes */}
              <div>
                <label className="block text-slate-700 font-bold mb-1">Ngày Thực Hiện</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Ghi Chú Chi Tiết</label>
                <textarea
                  placeholder="Ghi chú xuất cho tổ đội nào, hóa đơn đi kèm..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl p-2.5"
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold text-slate-700"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className={`flex-1 py-3 rounded-xl font-bold text-white shadow-md active:scale-95 transition-all ${
                    type === 'in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  Xác Nhận Tạo Phiếu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
