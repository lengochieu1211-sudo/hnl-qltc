import React, { useState, useMemo, useEffect } from 'react';
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
  Upload
} from 'lucide-react';
import { ChecklistItem, ChecklistStatus } from '../types';

interface ChecklistTabProps {
  checklist: ChecklistItem[];
  floors: string[];
  inspectorName?: string;
  onUpdateChecklistStatus: (id: string, status: ChecklistStatus, notes?: string, inspector?: string) => void;
  onAddChecklistItem: (item: Omit<ChecklistItem, 'id'>) => void;
  onUpdateChecklistItem?: (item: ChecklistItem) => void;
  onDeleteChecklistItem: (id: string) => void;
  onOpenExportPdf?: () => void;
  onExportExcel?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const ChecklistTab: React.FC<ChecklistTabProps> = ({
  checklist,
  floors,
  inspectorName = 'KS. Nguyễn Văn Bình',
  onUpdateChecklistStatus,
  onAddChecklistItem,
  onUpdateChecklistItem,
  onDeleteChecklistItem,
  onOpenExportPdf,
  onExportExcel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}) => {
  const [selectedFloor, setSelectedFloor] = useState<string>(floors[0] || 'Tầng 1');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Keep selectedFloor in sync with floors
  useEffect(() => {
    if (floors.length > 0 && !floors.includes(selectedFloor)) {
      setSelectedFloor(floors[0]);
    }
  }, [floors, selectedFloor]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingChecklistItem, setEditingChecklistItem] = useState<ChecklistItem | null>(null);
  const [deletingChecklistTarget, setDeletingChecklistTarget] = useState<ChecklistItem | null>(null);

  // New Item State (pulling inspectorName as default)
  const [category, setCategory] = useState<'Thi công khung trần' | 'Thi công bắn tấm trần' | 'Sơn bả & Hoàn thiện'>('Thi công khung trần');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [inspectedBy, setInspectedBy] = useState(inspectorName);

  // Keep inspectedBy updated if inspectorName prop changes
  useEffect(() => {
    if (inspectorName) {
      setInspectedBy(inspectorName);
    }
  }, [inspectorName]);

  const filteredChecklist = useMemo(() => {
    return checklist.filter((item) => {
      const matchFloor = item.floorName === selectedFloor;
      const matchCategory = selectedCategory === 'all' || item.category === selectedCategory;
      return matchFloor && matchCategory;
    });
  }, [checklist, selectedFloor, selectedCategory]);

  const summary = useMemo(() => {
    const floorItems = checklist.filter((item) => item.floorName === selectedFloor);
    const total = floorItems.length;
    const passed = floorItems.filter((i) => i.status === 'passed').length;
    const defect = floorItems.filter((i) => i.status === 'defect').length;
    const pending = floorItems.filter((i) => i.status === 'pending').length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    return { total, passed, defect, pending, passRate };
  }, [checklist, selectedFloor]);

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('Vui lòng nhập nội dung tiêu chuẩn kiểm tra!');
      return;
    }

    onAddChecklistItem({
      floorName: selectedFloor,
      category,
      title: title.trim(),
      status: 'pending',
      notes,
      inspectedBy: inspectedBy.trim() || inspectorName,
      inspectedAt: new Date().toLocaleString('vi-VN'),
    });

    setShowAddForm(false);
    setTitle('');
    setNotes('');
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChecklistItem || !onUpdateChecklistItem) return;
    if (!editingChecklistItem.title.trim()) {
      alert('Vui lòng nhập nội dung tiêu chuẩn kiểm tra!');
      return;
    }

    onUpdateChecklistItem({
      ...editingChecklistItem,
      title: editingChecklistItem.title.trim(),
      inspectedBy: editingChecklistItem.inspectedBy?.trim() || inspectorName,
      inspectedAt: new Date().toLocaleString('vi-VN'),
    });

    setEditingChecklistItem(null);
  };

  const handleExportChecklistTemplate = () => {
    const wb = XLSX.utils.book_new();
    const sourceData = checklist.length > 0 ? checklist : [
      {
        floorName: selectedFloor,
        category: 'Thi công khung trần' as const,
        title: 'Khoảng cách giữa các thanh xương chính tuân thủ thiết kế (800-1000mm)',
        status: 'pending' as const,
        notes: 'Kiểm tra kỹ khoảng cách ty treo',
        inspectedBy: inspectorName,
        inspectedAt: new Date().toLocaleString('vi-VN')
      }
    ];

    const data = sourceData.map((item, idx) => ({
      'STT': idx + 1,
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
    XLSX.writeFile(wb, `Mau_Checklist_Nghiem_Thu.xlsx`);
  };

  const handleImportExcelChecklist = (e: React.ChangeEvent<HTMLInputElement>) => {
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

        let addedCount = 0;
        let skippedCount = 0;

        jsonData.forEach((row: any) => {
          const rawFloor = String(row['Vị Trí (Tầng)'] || selectedFloor).trim();
          const rawCategory = String(row['Hạng Mục Kiểm Tra'] || 'Thi công khung trần').trim();
          const rawTitle = String(row['Nội Dung Tiêu Chuẩn'] || '').trim();
          const rawStatusStr = String(row['Trạng Thái'] || 'Chờ nghiệm thu').trim();
          const rawNotes = String(row['Ghi Chú'] || '').trim();
          const rawInspectedBy = String(row['Người Kiểm Tra'] || inspectorName).trim();

          if (!rawTitle) {
            skippedCount++;
            return;
          }

          let categoryNorm: 'Thi công khung trần' | 'Thi công bắn tấm trần' | 'Sơn bả & Hoàn thiện' = 'Thi công khung trần';
          if (rawCategory.includes('bắn tấm') || rawCategory.includes('Ban Tam') || rawCategory.toLowerCase().includes('tấm')) {
            categoryNorm = 'Thi công bắn tấm trần';
          } else if (rawCategory.includes('sơn bả') || rawCategory.includes('Son Ba') || rawCategory.toLowerCase().includes('sơn') || rawCategory.toLowerCase().includes('hoàn thiện')) {
            categoryNorm = 'Sơn bả & Hoàn thiện';
          }

          let statusNorm: ChecklistStatus = 'pending';
          const lowerStatus = rawStatusStr.toLowerCase();
          if (lowerStatus === 'đạt' || lowerStatus === 'dat' || lowerStatus.includes('pass') || lowerStatus.includes('ok')) {
            statusNorm = 'passed';
          } else if (lowerStatus === 'lỗi' || lowerStatus === 'loi' || lowerStatus.includes('defect') || lowerStatus.includes('fail')) {
            statusNorm = 'defect';
          }

          onAddChecklistItem({
            floorName: rawFloor,
            category: categoryNorm,
            title: rawTitle,
            status: statusNorm,
            notes: rawNotes || undefined,
            inspectedBy: rawInspectedBy || inspectorName,
            inspectedAt: new Date().toLocaleString('vi-VN')
          });
          addedCount++;
        });

        alert(`Nhập Checklist thành công!\n- Đã thêm mới: ${addedCount} tiêu chí\n- Bỏ qua do thiếu thông tin: ${skippedCount}`);
      } catch (err: any) {
        alert(`Lỗi đọc tệp Excel: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  return (
    <div className="p-4 space-y-4 pb-24 max-w-md mx-auto">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-emerald-600" />
            Checklist Nghiệm Thu
          </h2>
          <p className="text-xs text-slate-500">Tiêu chuẩn thi công &amp; Kỹ sư giám sát: <span className="font-semibold text-indigo-700">{inspectorName}</span></p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-xs font-bold shadow active:scale-95 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Thêm Tiêu Chí
          </button>
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
          <Download className="w-4 h-4 text-indigo-600" /> Tải Mẫu Excel
        </button>
        <label className="flex items-center justify-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-extrabold py-2.5 px-3 rounded-xl shadow-xs cursor-pointer transition-all text-xs">
          <Upload className="w-4 h-4 text-emerald-600" /> Nhập Excel
          <input
            type="file"
            accept=".xlsx, .xls"
            onChange={handleImportExcelChecklist}
            className="hidden"
          />
        </label>
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
          <span className="text-xs font-bold text-slate-800">Tỷ Lệ Nghiệm Thu - {selectedFloor}</span>
          <span className="text-xs font-extrabold text-emerald-600">{summary.passRate}% Đạt</span>
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
      <div className="flex gap-1 overflow-x-auto text-xs no-scrollbar">
        {[
          { id: 'all', label: 'Tất Cả' },
          { id: 'Thi công khung trần', label: '1. Khung Trần' },
          { id: 'Thi công bắn tấm trần', label: '2. Bắn Tấm' },
          { id: 'Sơn bả & Hoàn thiện', label: '3. Sơn Bả' },
        ].map((cat) => (
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

      {/* Checklist items list */}
      <div className="space-y-3">
        {filteredChecklist.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs bg-white rounded-2xl border border-dashed border-slate-200">
            Chưa có tiêu chí checklist nào cho {selectedFloor}. Bấm "Thêm Tiêu Chí" hoặc "Nhập Excel" để bắt đầu.
          </div>
        ) : (
          filteredChecklist.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-sm space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200 inline-block mb-1">
                    {item.category}
                  </span>
                  <h4 className="text-xs font-bold text-slate-900">{item.title}</h4>
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

              {item.notes && (
                <p className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded-xl border border-slate-100 italic">
                  📝 {item.notes}
                </p>
              )}

              {/* Quick Status Toggle Actions */}
              <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-100 text-[11px]">
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
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                <span className="truncate max-w-[200px]">👤 GS: <strong className="text-slate-700">{item.inspectedBy || inspectorName}</strong></span>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setEditingChecklistItem(item)} 
                    className="text-indigo-600 hover:underline font-bold flex items-center gap-0.5 cursor-pointer"
                  >
                    <Edit className="w-3 h-3" /> Sửa
                  </button>
                  <button 
                    onClick={() => setDeletingChecklistTarget(item)} 
                    className="text-rose-500 hover:underline font-bold flex items-center gap-0.5 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" /> Xóa
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Checklist Modal */}
      {showAddForm && (
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
                <label className="block text-slate-700 font-bold mb-1">Loại Hạng Mục</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as any)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-white"
                >
                  <option value="Thi công khung trần">Thi công khung trần</option>
                  <option value="Thi công bắn tấm trần">Thi công bắn tấm trần</option>
                  <option value="Sơn bả & Hoàn thiện">Sơn bả &amp; Hoàn thiện</option>
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
                <label className="block text-slate-700 font-bold mb-1">Kỹ Sư Giám Sát (Tùy chỉnh hoặc theo cấu hình)</label>
                <input
                  type="text"
                  value={inspectedBy}
                  onChange={(e) => setInspectedBy(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-slate-800"
                  placeholder="Tên kỹ sư giám sát..."
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Ghi Chú Ban Đầu</label>
                <textarea
                  placeholder="Ghi chú cụ thể..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl p-2.5"
                />
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
      {editingChecklistItem && (
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
                <label className="block text-slate-700 font-bold mb-1">Loại Hạng Mục</label>
                <select
                  value={editingChecklistItem.category}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, category: e.target.value as any })}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-white"
                >
                  <option value="Thi công khung trần">Thi công khung trần</option>
                  <option value="Thi công bắn tấm trần">Thi công bắn tấm trần</option>
                  <option value="Sơn bả & Hoàn thiện">Sơn bả &amp; Hoàn thiện</option>
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
                <label className="block text-slate-700 font-bold mb-1">Trạng Thái Nghiệm Thu</label>
                <select
                  value={editingChecklistItem.status}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, status: e.target.value as ChecklistStatus })}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold bg-white"
                >
                  <option value="passed">✅ Đã nghiệm thu (Đạt)</option>
                  <option value="defect">🔴 Có Defect (Lỗi)</option>
                  <option value="pending">🟡 Chưa nghiệm thu (Chờ)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Kỹ Sư Giám Sát</label>
                <input
                  type="text"
                  value={editingChecklistItem.inspectedBy || inspectorName}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, inspectedBy: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl p-2.5 font-bold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Ghi Chú</label>
                <textarea
                  value={editingChecklistItem.notes || ''}
                  onChange={(e) => setEditingChecklistItem({ ...editingChecklistItem, notes: e.target.value })}
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl p-2.5"
                />
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
      {deletingChecklistTarget && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-5 max-w-xs w-full space-y-4 border border-slate-100 shadow-2xl text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Xác Nhận Xóa Tiêu Chí</h3>
              <p className="text-xs text-slate-500 mt-1">
                Bạn có chắc chắn muốn xóa tiêu chí <strong className="text-slate-800">{deletingChecklistTarget.title}</strong> không?
              </p>
              <p className="text-[11px] text-indigo-600 mt-1 font-medium">💡 Thao tác này có thể Hoàn Tác (Undo).</p>
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
                onClick={() => {
                  onDeleteChecklistItem(deletingChecklistTarget.id);
                  setDeletingChecklistTarget(null);
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs shadow cursor-pointer"
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
