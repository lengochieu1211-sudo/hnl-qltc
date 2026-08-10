import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
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
  Upload
} from 'lucide-react';
import { WorkVolume, CategoryType, FloorPlan } from '../types';
import { exportWorkVolumesTemplate } from '../utils/excelExport';

interface WorkVolumeTabProps {
  workVolumes: WorkVolume[];
  floorPlans?: FloorPlan[];
  onAddWorkVolume: (item: Omit<WorkVolume, 'id'>) => void;
  onSaveWorkVolume?: (item: Omit<WorkVolume, 'id'> & { id?: string }) => void;
  onUpdateActualVolume: (id: string, newActual: number) => void;
  onDeleteWorkVolume: (id: string) => void;
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
  onAddWorkVolume,
  onSaveWorkVolume,
  onUpdateActualVolume,
  onDeleteWorkVolume,
  onOpenExportPdf,
  onExportExcel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}) => {
  const floorOptions = useMemo(() => {
    if (!floorPlans || floorPlans.length === 0) {
      return ['Tầng 1', 'Tầng 2', 'Tầng 3', 'Tầng 4', 'Sảnh / Ngoại thất'];
    }
    return floorPlans.map(fp => fp.floorName);
  }, [floorPlans]);

  // Extract unique categories from workVolumes
  const availableCategories = useMemo(() => {
    const categories = new Set<string>(['khung_tran', 'ban_tam', 'son_ba']);
    workVolumes.forEach((v) => categories.add(v.category));
    return Array.from(categories);
  }, [workVolumes]);

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingVolume, setEditingVolume] = useState<WorkVolume | null>(null);
  const [deletingVolumeTarget, setDeletingVolumeTarget] = useState<WorkVolume | null>(null);

  // New Work Volume Form State
  const [title, setTitle] = useState('');
  const [floor, setFloor] = useState(() => floorOptions[0] || 'Tầng 1');
  const [category, setCategory] = useState<string>('khung_tran');
  const [unit, setUnit] = useState('m2');
  const [planned, setPlanned] = useState<number | ''>(350);
  const [actual, setActual] = useState<number | ''>(0);
  const [unitPrice, setUnitPrice] = useState<number | ''>(110000);

  // Financial calculations
  const totals = useMemo(() => {
    let plannedValue = 0;
    let actualValue = 0;

    workVolumes.forEach((item) => {
      plannedValue += item.planned * item.unitPrice;
      actualValue += item.actual * item.unitPrice;
    });

    const percent = plannedValue > 0 ? Math.min(100, Math.round((actualValue / plannedValue) * 100)) : 0;

    return { plannedValue, actualValue, percent };
  }, [workVolumes]);

  const filteredVolumes = useMemo(() => {
    if (selectedCategory === 'all') return workVolumes;
    return workVolumes.filter((item) => item.category === selectedCategory);
  }, [workVolumes, selectedCategory]);

  const handleCloseModal = () => {
    setShowAddForm(false);
    setEditingVolume(null);
    setTitle('');
    setFloor(floorOptions[0] || 'Tầng 1');
    setCategory('khung_tran');
    setUnit('m2');
    setPlanned(350);
    setActual(0);
    setUnitPrice(110000);
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !planned || Number(planned) <= 0) {
      alert('Vui lòng điền tên hạng mục và khối lượng định mức hợp lệ!');
      return;
    }

    if (editingVolume) {
      if (onSaveWorkVolume) {
        onSaveWorkVolume({
          id: editingVolume.id,
          title: title.trim(),
          floor,
          category,
          unit,
          planned: Number(planned),
          actual: Number(actual || 0),
          unitPrice: Number(unitPrice || 0),
          status: Number(actual) >= Number(planned) ? 'Đã hoàn thành' : Number(actual) > 0 ? 'Đang thi công' : 'Chưa thi công',
        });
      }
    } else {
      onAddWorkVolume({
        title: title.trim(),
        floor,
        category,
        unit,
        planned: Number(planned),
        actual: Number(actual || 0),
        unitPrice: Number(unitPrice || 0),
        status: Number(actual) >= Number(planned) ? 'Đã hoàn thành' : Number(actual) > 0 ? 'Đang thi công' : 'Chưa thi công',
      });
    }

    handleCloseModal();
  };

  const handleImportExcelWorkVolumes = (e: React.ChangeEvent<HTMLInputElement>) => {
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
          alert('Tệp Excel không có dữ liệu hoặc định dạng không đúng!');
          return;
        }

        let existingMatchCount = 0;
        let newCount = 0;
        jsonData.forEach((row: any) => {
          const titleStr = String(row['Tên Hạng Mục Công Việc'] || row['title'] || '').trim();
          const floorStr = String(row['Tầng / Khu Vực'] || row['Tầng'] || row['floor'] || 'Tầng 1').trim();
          if (titleStr) {
            const found = workVolumes.find(
              w => w.title.toLowerCase() === titleStr.toLowerCase() && w.floor.toLowerCase() === floorStr.toLowerCase()
            );
            if (found) existingMatchCount++;
            else newCount++;
          }
        });

        const confirmMerge = window.confirm(
          `📂 Phát hiện ${jsonData.length} hạng mục trong tệp Excel (${existingMatchCount} hạng mục trùng tên & tầng đã có sẵn, ${newCount} mới).\n\n` +
          `• Bấm "OK" để CẬP NHẬT thông tin các hạng mục cũ & THÊM MỚI các hạng mục chưa có.\n` +
          `• Bấm "Cancel" để Hủy thao tác.`
        );

        if (!confirmMerge) {
          e.target.value = '';
          return;
        }

        let updatedCount = 0;
        let addedCount = 0;

        jsonData.forEach((row: any) => {
          const titleStr = String(row['Tên Hạng Mục Công Việc'] || row['title'] || '').trim();
          if (!titleStr) return;

          const floorStr = String(row['Tầng / Khu Vực'] || row['Tầng'] || row['floor'] || 'Tầng 1').trim();
          const categoryStr = String(row['Nhóm Hạng Mục'] || row['Phân Loại'] || row['category'] || 'khung_tran').trim() as CategoryType;
          const unitStr = String(row['Đơn Vị Tính'] || row['Đơn Vị'] || row['unit'] || 'm2').trim();
          const plannedNum = Number(row['KL Định Mức'] || row['KL Kế Hoạch'] || row['planned'] || 0);
          const actualNum = Number(row['KL Thực Tế'] || row['KL Thực Hiện'] || row['actual'] || 0);
          const unitPriceNum = Number(row['Đơn Giá (VNĐ)'] || row['unitPrice'] || 0);

          const existing = workVolumes.find(
            w => w.title.toLowerCase() === titleStr.toLowerCase() && w.floor.toLowerCase() === floorStr.toLowerCase()
          );

          const statusVal = actualNum >= plannedNum ? 'Đã hoàn thành' : actualNum > 0 ? 'Đang thi công' : 'Chưa thi công';

          if (existing && onSaveWorkVolume) {
            onSaveWorkVolume({
              id: existing.id,
              title: titleStr,
              floor: floorStr,
              category: existing.category || categoryStr,
              unit: unitStr,
              planned: plannedNum || existing.planned,
              actual: actualNum !== undefined ? actualNum : existing.actual,
              unitPrice: unitPriceNum || existing.unitPrice,
              status: statusVal
            });
            updatedCount++;
          } else {
            onAddWorkVolume({
              title: titleStr,
              floor: floorStr,
              category: categoryStr,
              unit: unitStr,
              planned: plannedNum,
              actual: actualNum,
              unitPrice: unitPriceNum,
              status: statusVal
            });
            addedCount++;
          }
        });

        alert(`Nhập Excel thành công!\n- Đã cập nhật/chỉnh sửa: ${updatedCount} hạng mục\n- Đã thêm mới: ${addedCount} hạng mục`);
      } catch (err: any) {
        alert(`Lỗi đọc tệp Excel: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const formatVND = (num: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
  };

  return (
    <div className="p-4 space-y-4 pb-24 max-w-md mx-auto">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            Khối Lượng Thi Công
          </h2>
          <p className="text-xs text-slate-500">Tiến độ &amp; Giá trị sản lượng công trình</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => exportWorkVolumesTemplate(workVolumes)}
            className="text-[11px] font-extrabold text-indigo-700 hover:text-indigo-900 bg-white hover:bg-slate-50 px-2 py-1.5 rounded-xl flex items-center gap-1 border border-slate-200 transition-all active:scale-95 shadow-2xs"
            title="Tải mẫu Excel hoặc danh sách hiện tại để chỉnh sửa"
          >
            <Download className="w-3.5 h-3.5" /> Mẫu
          </button>
          <label className="text-[11px] font-extrabold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-2 py-1.5 rounded-xl flex items-center gap-1 border border-emerald-200 cursor-pointer transition-all active:scale-95 shadow-2xs">
            <Upload className="w-3.5 h-3.5" /> Nhập Excel
            <input
              type="file"
              accept=".xlsx, .xls"
              onChange={handleImportExcelWorkVolumes}
              className="hidden"
            />
          </label>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1.5 rounded-xl text-xs font-bold shadow active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            Thêm
          </button>
        </div>
      </div>

      {/* Contract & Progress Overview Dashboard */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 text-white rounded-2xl p-4 shadow-lg space-y-3">
        <div className="flex items-center justify-between border-b border-slate-700/80 pb-2">
          <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Tổng Giá Trị &amp; Tiến Độ Sản Lượng
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
              style={{ width: `${totals.percent}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs pt-1">
          <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
            <p className="text-[10px] text-slate-400">Giá Trị Định Mức</p>
            <p className="text-sm font-extrabold text-slate-100">{formatVND(totals.plannedValue)}</p>
          </div>
          <div className="bg-emerald-950/60 p-2.5 rounded-xl border border-emerald-700/40">
            <p className="text-[10px] text-emerald-300">Đã Thực Hiện (Nghiệm thu)</p>
            <p className="text-sm font-extrabold text-emerald-400">{formatVND(totals.actualValue)}</p>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 text-xs no-scrollbar">
        {['all', ...availableCategories].map((catId) => {
          const label = catId === 'all' ? 'Tất Cả' : 
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

      {/* Items List */}
      <div className="space-y-3">
        {filteredVolumes.map((item) => {
          const itemPercent = Math.min(100, Math.round((item.actual / item.planned) * 100));
          const isDone = item.actual >= item.planned;

          return (
            <div
              key={item.id}
              className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-sm space-y-2.5"
            >
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
                  <h4 className="text-xs font-bold text-slate-900">{item.title}</h4>
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
              <div className="flex items-center justify-between text-xs bg-slate-50 p-2 rounded-xl">
                <div>
                  <span className="text-slate-500 text-[11px]">Thực hiện: </span>
                  <span className="font-extrabold text-slate-900">
                    {item.actual} / {item.planned} {item.unit}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 text-[11px]">Đơn giá: </span>
                  <span className="font-semibold text-slate-700">{(item.unitPrice ?? 0).toLocaleString('vi-VN')} đ</span>
                </div>
              </div>

              {/* Action and financial details */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                <span className="text-[11px] text-slate-500">
                  Thành tiền: <strong className="text-slate-800">{((item.actual ?? 0) * (item.unitPrice ?? 0)).toLocaleString('vi-VN')} đ</strong>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingVolume(item);
                      setTitle(item.title);
                      setFloor(item.floor);
                      setCategory(item.category);
                      setUnit(item.unit);
                      setPlanned(item.planned);
                      setActual(item.actual);
                      setUnitPrice(item.unitPrice);
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
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Work Volume Modal */}
      {(showAddForm || editingVolume !== null) && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-base font-bold text-slate-900">
                {editingVolume ? 'Sửa Hạng Mục Khối Lượng' : 'Thêm Hạng Mục Khối Lượng'}
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
                <label className="block text-slate-700 font-bold mb-1">Tên Hạng Mục Công Việc *</label>
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
                  <label className="block text-slate-700 font-bold mb-1">Vị Trí Tầng</label>
                  <select
                    value={floor}
                    onChange={(e) => setFloor(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2.5"
                  >
                    {floorOptions.map((fName) => (
                      <option key={fName} value={fName}>{fName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Nhóm Hạng Mục</label>
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

              <div className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <div className="h-6 flex items-center text-slate-700 font-bold text-[11px] sm:text-xs truncate mb-1">
                    KL Định Mức *
                  </div>
                  <input
                    type="number"
                    value={planned}
                    onChange={(e) => setPlanned(e.target.value ? Number(e.target.value) : '')}
                    className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-blue-600"
                    required
                  />
                </div>
                <div>
                  <div className="h-6 flex items-center justify-between gap-1 text-slate-700 font-bold text-[11px] sm:text-xs truncate mb-1">
                    <span className="truncate">KL Đã Làm</span>
                    <span className="text-[9px] text-emerald-600 font-semibold bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100 shrink-0" title="Khối lượng thực hiện tự động cập nhật từ Mặt Bằng">🔗 MB</span>
                  </div>
                  <input
                    type="number"
                    value={actual}
                    disabled
                    readOnly
                    className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-slate-50 text-slate-500 cursor-not-allowed"
                    title="Khối lượng thực hiện tự động cập nhật từ danh sách nghiệm thu ở mục Mặt Bằng"
                  />
                </div>
                <div>
                  <div className="h-6 flex items-center text-slate-700 font-bold text-[11px] sm:text-xs truncate mb-1">
                    Đơn Vị
                  </div>
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-2.5"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Đơn Giá VNĐ / {unit}</label>
                <input
                  type="number"
                  step="5000"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value ? Number(e.target.value) : '')}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold"
                />
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
                  {editingVolume ? 'Cập Nhật Hạng Mục' : 'Tạo Hạng Mục'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Volume Confirmation Modal */}
      {deletingVolumeTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full space-y-4 border border-slate-100 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Xác Nhận Xóa Hạng Mục</h3>
              <p className="text-xs text-slate-500 mt-1">
                Bạn có chắc chắn muốn xóa hạng mục <strong className="text-slate-800">{deletingVolumeTarget.title} ({deletingVolumeTarget.floor})</strong> không?
              </p>
              <p className="text-[11px] text-indigo-600 mt-1 font-medium">💡 Thao tác này có thể Hoàn Tác (Undo).</p>
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
                onClick={() => {
                  onDeleteWorkVolume(deletingVolumeTarget.id);
                  setDeletingVolumeTarget(null);
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
