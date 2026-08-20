import React, { useState } from 'react';
import { 
  GitMerge, 
  AlertTriangle, 
  CheckCircle2, 
  ArrowRight, 
  X, 
  ShieldAlert, 
  Layers, 
  Check, 
  RefreshCw,
  Filter,
  Search,
  Inbox,
  FileText,
  ClipboardList,
  Users,
  Box
} from 'lucide-react';
import { formatDecimal } from '../utils/numberUtils';
import { QuickSortBar } from './QuickSortBar';

interface ConflictMergeModalProps {
  localData: any;
  importedData: any;
  onClose: () => void;
  onApplyMerged: (mergedData: any) => void;
}

export const ConflictMergeModal: React.FC<ConflictMergeModalProps> = ({
  localData,
  importedData,
  onClose,
  onApplyMerged,
}) => {
  // Methods of merging: 'smart' | 'import' | 'local' | 'manual'
  const [selectedStrategy, setSelectedStrategy] = useState<'smart' | 'import' | 'local' | 'manual'>('manual');
  
  // Category tab filter inside manual comparison
  const [activeTab, setActiveTab] = useState<'all' | 'room' | 'defect' | 'inventory' | 'workVolume' | 'checklist' | 'crew'>('all');
  
  // Search query to filter items
  const [searchQuery, setSearchQuery] = useState('');
  const [conflictSortBy, setConflictSortBy] = useState<'name' | 'type'>('type');
  const [conflictSortOrder, setConflictSortOrder] = useState<'asc' | 'desc'>('asc');

  // For manual resolution choices: store mapping of uniqueKey (e.g. 'room-123') -> 'local' | 'import'
  const [manualChoices, setManualChoices] = useState<Record<string, 'local' | 'import'>>({});

  // 1. Compare Room Progress conflicts
  const localRooms = Array.isArray(localData?.roomProgressList) ? localData.roomProgressList : [];
  const importedRooms = Array.isArray(importedData?.roomProgressList) ? importedData.roomProgressList : [];
  const roomConflicts: Array<{ id: string; name: string; type: 'room'; typeName: string; localItem: any; importedItem: any }> = [];
  
  localRooms.forEach((lRoom: any) => {
    const key = lRoom.id || lRoom.roomId || lRoom.roomName;
    const iRoom = importedRooms.find((r: any) => (r.id || r.roomId || r.roomName) === key);
    if (iRoom) {
      if (
        lRoom.progress !== iRoom.progress ||
        lRoom.status !== iRoom.status ||
        lRoom.notes !== iRoom.notes
      ) {
        roomConflicts.push({
          id: key,
          name: `${lRoom.floorName || 'Tầng'} - ${lRoom.roomName || lRoom.name || key}`,
          type: 'room',
          typeName: 'Tiến độ phòng',
          localItem: lRoom,
          importedItem: iRoom,
        });
      }
    }
  });

  // 2. Compare Defects conflicts
  const localDefects = Array.isArray(localData?.defects) ? localData.defects : [];
  const importedDefects = Array.isArray(importedData?.defects) ? importedData.defects : [];
  const defectConflicts: Array<{ id: string; name: string; type: 'defect'; typeName: string; localItem: any; importedItem: any }> = [];

  localDefects.forEach((lDef: any) => {
    const key = lDef.id;
    const iDef = importedDefects.find((d: any) => d.id === key);
    if (iDef) {
      if (
        lDef.status !== iDef.status || 
        lDef.severity !== iDef.severity || 
        lDef.description !== iDef.description
      ) {
        defectConflicts.push({
          id: key,
          name: `${lDef.floorName || 'Mặt bằng'} - Lỗi: ${lDef.title || lDef.description || `Mã #${key}`}`,
          type: 'defect',
          typeName: 'Trạng thái lỗi',
          localItem: lDef,
          importedItem: iDef,
        });
      }
    }
  });

  // 3. Compare Inventory conflicts
  const localInventory = Array.isArray(localData?.inventory) ? localData.inventory : [];
  const importedInventory = Array.isArray(importedData?.inventory) ? importedData.inventory : [];
  const inventoryConflicts: Array<{ id: string; name: string; type: 'inventory'; typeName: string; localItem: any; importedItem: any }> = [];

  localInventory.forEach((lInv: any) => {
    const key = lInv.id;
    const iInv = importedInventory.find((d: any) => d.id === key);
    if (iInv) {
      if (
        Number(lInv.quantity) !== Number(iInv.quantity) ||
        lInv.unit !== iInv.unit ||
        lInv.itemName !== iInv.itemName
      ) {
        inventoryConflicts.push({
          id: key,
          name: `Vật tư: ${lInv.itemName || key}`,
          type: 'inventory',
          typeName: 'Vật tư tồn kho',
          localItem: lInv,
          importedItem: iInv,
        });
      }
    }
  });

  // 4. Compare Work Volume conflicts
  const localWorkVolumes = Array.isArray(localData?.workVolumes) ? localData.workVolumes : [];
  const importedWorkVolumes = Array.isArray(importedData?.workVolumes) ? importedData.workVolumes : [];
  const workVolumeConflicts: Array<{ id: string; name: string; type: 'workVolume'; typeName: string; localItem: any; importedItem: any }> = [];

  localWorkVolumes.forEach((lVol: any) => {
    const key = lVol.id;
    const iVol = importedWorkVolumes.find((v: any) => v.id === key);
    if (iVol) {
      if (
        Number(lVol.actual) !== Number(iVol.actual) ||
        Number(lVol.progress) !== Number(iVol.progress) ||
        Number(lVol.planned) !== Number(iVol.planned)
      ) {
        workVolumeConflicts.push({
          id: key,
          name: `Công việc: ${lVol.taskName || key}`,
          type: 'workVolume',
          typeName: 'Khối lượng việc',
          localItem: lVol,
          importedItem: iVol,
        });
      }
    }
  });

  // 5. Compare Checklist conflicts
  const localChecklist = Array.isArray(localData?.checklist) ? localData.checklist : [];
  const importedChecklist = Array.isArray(importedData?.checklist) ? importedData.checklist : [];
  const checklistConflicts: Array<{ id: string; name: string; type: 'checklist'; typeName: string; localItem: any; importedItem: any }> = [];

  localChecklist.forEach((lChk: any) => {
    const key = lChk.id;
    const iChk = importedChecklist.find((c: any) => c.id === key);
    if (iChk) {
      if (
        lChk.status !== iChk.status ||
        lChk.notes !== iChk.notes ||
        lChk.checkedBy !== iChk.checkedBy
      ) {
        checklistConflicts.push({
          id: key,
          name: `${lChk.floorName || ''} - Room ${lChk.roomName || ''} - ${lChk.itemName || key}`,
          type: 'checklist',
          typeName: 'Checklist tầng',
          localItem: lChk,
          importedItem: iChk,
        });
      }
    }
  });

  // 6. Compare Crew Record conflicts
  const localCrewRecords = Array.isArray(localData?.crewRecords) ? localData.crewRecords : [];
  const importedCrewRecords = Array.isArray(importedData?.crewRecords) ? importedData.crewRecords : [];
  const crewConflicts: Array<{ id: string; name: string; type: 'crew'; typeName: string; localItem: any; importedItem: any }> = [];

  localCrewRecords.forEach((lCrew: any) => {
    const key = lCrew.id;
    const iCrew = importedCrewRecords.find((c: any) => c.id === key);
    if (iCrew) {
      if (
        Number(lCrew.workerCount) !== Number(iCrew.workerCount) ||
        lCrew.taskDescription !== iCrew.taskDescription ||
        lCrew.date !== iCrew.date
      ) {
        crewConflicts.push({
          id: key,
          name: `Quân số: ${lCrew.date || ''} - ${lCrew.teamName || key}`,
          type: 'crew',
          typeName: 'Quân số thi công',
          localItem: lCrew,
          importedItem: iCrew,
        });
      }
    }
  });

  // Combine all conflicts with unique global keys
  const allConflicts = [
    ...roomConflicts.map(c => ({ ...c, uniqueKey: `room-${c.id}` })),
    ...defectConflicts.map(c => ({ ...c, uniqueKey: `defect-${c.id}` })),
    ...inventoryConflicts.map(c => ({ ...c, uniqueKey: `inventory-${c.id}` })),
    ...workVolumeConflicts.map(c => ({ ...c, uniqueKey: `workVolume-${c.id}` })),
    ...checklistConflicts.map(c => ({ ...c, uniqueKey: `checklist-${c.id}` })),
    ...crewConflicts.map(c => ({ ...c, uniqueKey: `crew-${c.id}` })),
  ];

  // Total conflict count across all categories
  const totalConflicts = allConflicts.length;

  // Compute counts for badging and tab switching
  const counts = {
    all: totalConflicts,
    room: roomConflicts.length,
    defect: defectConflicts.length,
    inventory: inventoryConflicts.length,
    workVolume: workVolumeConflicts.length,
    checklist: checklistConflicts.length,
    crew: crewConflicts.length,
  };

  // Helper to determine active selection for each item
  const getSelectedSide = (conflict: any): 'local' | 'import' => {
    if (selectedStrategy === 'local') return 'local';
    if (selectedStrategy === 'import') return 'import';
    if (selectedStrategy === 'smart') {
      if (conflict.type === 'room') {
        const lProg = conflict.localItem.progress || 0;
        const iProg = conflict.importedItem.progress || 0;
        return iProg > lProg ? 'import' : 'local';
      }
      if (conflict.type === 'workVolume') {
        const lProg = conflict.localItem.progress || 0;
        const iProg = conflict.importedItem.progress || 0;
        return iProg > lProg ? 'import' : 'local';
      }
      // Smart fallbacks
      const lTime = conflict.localItem.updatedAt || 0;
      const iTime = conflict.importedItem.updatedAt || 0;
      if (iTime > lTime) return 'import';
      return 'local';
    }
    // Manual
    return manualChoices[conflict.uniqueKey] || 'local';
  };

  const handleManualToggle = (uniqueKey: string, choice: 'local' | 'import') => {
    setManualChoices(prev => ({ ...prev, [uniqueKey]: choice }));
  };

  // Bulk Operations inside Chọn Từng Mục
  const handleBulkSelect = (choice: 'local' | 'import') => {
    const updated: Record<string, 'local' | 'import'> = { ...manualChoices };
    // Only apply bulk choice to the currently visible (filtered) conflicts
    filteredConflicts.forEach(c => {
      updated[c.uniqueKey] = choice;
    });
    setManualChoices(updated);
  };

  // Run actual merge and apply back
  const handleExecuteMerge = () => {
    if (selectedStrategy === 'import') {
      onApplyMerged(importedData);
      return;
    }
    if (selectedStrategy === 'local') {
      onClose();
      return;
    }

    // Build smart merged object
    const merged = { ...localData };

    // Merge project info (prefer non-empty)
    if (importedData.projectName && !localData.projectName) merged.projectName = importedData.projectName;
    if (importedData.contractorName && !localData.contractorName) merged.contractorName = importedData.contractorName;
    if (importedData.inspectorName && !localData.inspectorName) merged.inspectorName = importedData.inspectorName;

    // Standardizer for lists
    const resolveAndMergeArray = (
      keyName: string, 
      localArray: any[], 
      importedArray: any[], 
      conflictList: any[], 
      idField: string = 'id'
    ) => {
      const mergedMap = new Map();
      localArray.forEach((item: any) => {
        const id = item[idField];
        if (id) mergedMap.set(id, { ...item });
      });

      importedArray.forEach((iItem: any) => {
        const id = iItem[idField];
        if (!id) return;

        if (!mergedMap.has(id)) {
          mergedMap.set(id, { ...iItem });
        } else {
          const conflictMatch = conflictList.find(c => c.id === id);
          if (conflictMatch) {
            // Find what global key was used
            const globalKey = `${conflictMatch.type}-${id}`;
            const side = getSelectedSide({ ...conflictMatch, uniqueKey: globalKey });
            if (side === 'import') {
              mergedMap.set(id, { ...iItem });
            }
          }
        }
      });

      merged[keyName] = Array.from(mergedMap.values());
    };

    resolveAndMergeArray('roomProgressList', localRooms, importedRooms, roomConflicts, 'id');
    resolveAndMergeArray('defects', localDefects, importedDefects, defectConflicts, 'id');
    resolveAndMergeArray('inventory', localInventory, importedInventory, inventoryConflicts, 'id');
    resolveAndMergeArray('workVolumes', localWorkVolumes, importedWorkVolumes, workVolumeConflicts, 'id');
    resolveAndMergeArray('checklist', localChecklist, importedChecklist, checklistConflicts, 'id');
    resolveAndMergeArray('crewRecords', localCrewRecords, importedCrewRecords, crewConflicts, 'id');

    // Simple arrays by union
    const mergeArrayByUnion = (keyName: string, idField: string) => {
      if (Array.isArray(importedData[keyName])) {
        const map = new Map();
        (localData[keyName] || []).forEach((item: any) => map.set(item[idField] || item.name || item.code || item.id, item));
        importedData[keyName].forEach((item: any) => {
          const k = item[idField] || item.name || item.code || item.id;
          if (!map.has(k)) map.set(k, item);
        });
        (merged as any)[keyName] = Array.from(map.values());
      }
    };

    mergeArrayByUnion('floorPlans', 'id');
    mergeArrayByUnion('materialNorms', 'id');
    mergeArrayByUnion('teams', 'id');

    merged.updatedAt = Date.now();
    onApplyMerged(merged);
  };

  // Filter list by Tab and Search Query
  const filteredConflicts = allConflicts.filter(c => {
    const matchesTab = activeTab === 'all' || c.type === activeTab;
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          c.typeName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const sortedFilteredConflicts = [...filteredConflicts].sort((a, b) => {
    const comparison = conflictSortBy === 'name'
      ? a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' })
      : a.typeName.localeCompare(b.typeName, 'vi', { sensitivity: 'base' });
    return conflictSortOrder === 'asc' ? comparison : -comparison;
  });

  // Calculate user's resolved progress in "manual" mode
  const manualResolvedCount = Object.keys(manualChoices).filter(k => 
    allConflicts.some(c => c.uniqueKey === k)
  ).length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header Banner */}
        <div className="px-6 py-4 bg-gradient-to-r from-amber-600 to-amber-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <GitMerge className="w-6 h-6 text-amber-100" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base">Hợp Nhất Dữ Liệu &amp; Xử Lý Xung Đột Cuối Ngày</h3>
              <p className="text-[11px] sm:text-xs text-amber-100">
                Phát hiện <span className="font-bold bg-amber-800/80 px-1.5 py-0.5 rounded-md text-white">{totalConflicts}</span> hạng mục có dữ liệu khác biệt giữa Máy này và Tệp Hợp Nhất
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-xl text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-700 flex-1">
          
          {/* Strategy Chooser */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <label className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-slate-600" />
              <span>Chọn phương thức đồng bộ / hợp nhất:</span>
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <button
                type="button"
                onClick={() => setSelectedStrategy('manual')}
                className={`p-3 rounded-xl border text-left transition-all relative overflow-hidden ${
                  selectedStrategy === 'manual'
                    ? 'border-amber-600 bg-amber-50/70 text-amber-950 font-bold shadow-xs ring-2 ring-amber-400/20'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                }`}
              >
                <div className="flex items-center gap-1.5 text-amber-700 mb-1">
                  <Layers className="w-4 h-4 stroke-[2.5]" />
                  <span className="text-xs">Chọn Từng Mục</span>
                </div>
                <p className="text-[10px] text-slate-500 font-normal leading-relaxed">Tự so sánh chi tiết &amp; tích chọn tích hợp từng hạng mục</p>
                {selectedStrategy === 'manual' && (
                  <div className="absolute top-1 right-1 w-2 h-2 bg-amber-600 rounded-full animate-ping" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setSelectedStrategy('smart')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedStrategy === 'smart'
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-950 font-bold shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                }`}
              >
                <div className="flex items-center gap-1.5 text-indigo-700 mb-1">
                  <RefreshCw className="w-4 h-4" />
                  <span className="text-xs">Gộp Thông Minh</span>
                </div>
                <p className="text-[10px] text-slate-500 font-normal leading-relaxed">Tự động lấy bản tiến độ cao nhất và dữ liệu mới cập nhật</p>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStrategy('import')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedStrategy === 'import'
                    ? 'border-emerald-600 bg-emerald-50/70 text-emerald-950 font-bold shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                }`}
              >
                <div className="flex items-center gap-1.5 text-emerald-700 mb-1">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-xs">Lấy Bản Import</span>
                </div>
                <p className="text-[10px] text-slate-500 font-normal leading-relaxed">Ưu tiên ghi đè hoàn toàn bằng dữ liệu của tệp gửi đến</p>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStrategy('local')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedStrategy === 'local'
                    ? 'border-slate-600 bg-slate-100 text-slate-900 font-bold shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                }`}
              >
                <div className="flex items-center gap-1.5 text-slate-700 mb-1">
                  <ShieldAlert className="w-4 h-4" />
                  <span className="text-xs">Giữ Máy Này</span>
                </div>
                <p className="text-[10px] text-slate-500 font-normal leading-relaxed">Hủy bỏ tệp import, giữ nguyên dữ liệu hiện tại của bạn</p>
              </button>
            </div>
          </div>

          {/* Interactive Detailed Comparison Section */}
          {totalConflicts === 0 ? (
            <div className="p-8 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-2">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
              <h4 className="font-bold text-emerald-900 text-sm sm:text-base">Không phát hiện xung đột dữ liệu!</h4>
              <p className="text-xs text-emerald-700 max-w-lg mx-auto leading-relaxed">
                Các bảng dữ liệu (mặt bằng, định mức, vật tư, quân số, lỗi, căn hộ...) trùng khớp hoặc hoàn thiện liền mạch. Bạn có thể nhấn Đồng bộ để áp dụng.
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">
              
              {/* Header Title & Selection Stats */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white px-2">
                <div className="space-y-0.5">
                  <h4 className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4.5 h-4.5 text-amber-500 fill-amber-50" />
                    <span>Bảng So Sánh Chi Tiết &amp; Lựa Chọn Tích Hợp</span>
                  </h4>
                  <p className="text-slate-500 text-[10px] sm:text-xs">
                    Hãy tích chọn trực tiếp vào ô <strong className="text-indigo-600">Máy Này</strong> hoặc <strong className="text-emerald-600">Tệp Import</strong> để quyết định giữ dữ liệu cho từng hạng mục cụ thể.
                  </p>
                </div>
                
                {selectedStrategy === 'manual' && (
                  <div className="bg-amber-100/70 border border-amber-200/80 px-2.5 py-1.5 rounded-lg flex items-center gap-2 self-start sm:self-center text-[10px] sm:text-xs text-amber-900">
                    <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                    <span>Đã chọn giải quyết: <strong className="font-bold">{manualResolvedCount}</strong>/{totalConflicts} mục</span>
                  </div>
                )}
              </div>

              {/* Sub-Filters and Actions inside Manual */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-50/50 p-3 rounded-xl border border-slate-200">
                {/* Module tabs inside Manual */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1 pr-1">
                    <Filter className="w-3.5 h-3.5" /> Lọc phân hệ:
                  </span>
                  
                  <button
                    type="button"
                    onClick={() => setActiveTab('all')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      activeTab === 'all'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    Tất cả ({counts.all})
                  </button>
                  
                  {counts.room > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('room')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1 ${
                        activeTab === 'room'
                          ? 'bg-sky-600 text-white shadow-xs'
                          : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      <Inbox className="w-3 h-3" />
                      Tiến độ ({counts.room})
                    </button>
                  )}

                  {counts.defect > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('defect')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1 ${
                        activeTab === 'defect'
                          ? 'bg-rose-600 text-white shadow-xs'
                          : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      <AlertTriangle className="w-3 h-3" />
                      Lỗi ({counts.defect})
                    </button>
                  )}

                  {counts.inventory > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('inventory')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1 ${
                        activeTab === 'inventory'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      <Box className="w-3 h-3" />
                      Vật tư ({counts.inventory})
                    </button>
                  )}

                  {counts.workVolume > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('workVolume')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1 ${
                        activeTab === 'workVolume'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      <ClipboardList className="w-3 h-3" />
                      Khối lượng ({counts.workVolume})
                    </button>
                  )}

                  {counts.checklist > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('checklist')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1 ${
                        activeTab === 'checklist'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      <FileText className="w-3 h-3" />
                      Checklist ({counts.checklist})
                    </button>
                  )}

                  {counts.crew > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('crew')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1 ${
                        activeTab === 'crew'
                          ? 'bg-purple-600 text-white shadow-xs'
                          : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      <Users className="w-3 h-3" />
                      Quân số ({counts.crew})
                    </button>
                  )}
                </div>

                {/* Search input + Quick select buttons */}
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  {/* Search box */}
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none text-slate-400">
                      <Search className="w-3.5 h-3.5" />
                    </span>
                    <input
                      type="text"
                      placeholder="Tìm vị trí, vật tư..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-40 sm:w-48 pl-8 pr-2.5 py-1 text-[11px] bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:border-amber-500 focus:ring-2 focus:ring-amber-200 transition-all placeholder:text-slate-400 text-slate-800"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute inset-y-0 right-0 flex items-center pr-2 text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {selectedStrategy === 'manual' && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleBulkSelect('local')}
                        className="px-2 py-1 bg-white hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 border border-slate-200 rounded-lg text-[10px] font-medium transition-all"
                        title="Chọn nhanh bản Máy Này cho các mục đang hiển thị"
                      >
                        Lấy hết Máy này
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkSelect('import')}
                        className="px-2 py-1 bg-white hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 border border-slate-200 rounded-lg text-[10px] font-medium transition-all"
                        title="Chọn nhanh bản Import cho các mục đang hiển thị"
                      >
                        Lấy hết Tệp Import
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <QuickSortBar
                itemCount={filteredConflicts.length}
                options={[
                  { key: 'type', label: 'Phân hệ', kind: 'alpha' },
                  { key: 'name', label: 'Tên mục', kind: 'alpha' },
                ]}
                activeKey={conflictSortBy}
                order={conflictSortOrder}
                onChange={(key, order) => { setConflictSortBy(key); setConflictSortOrder(order); }}
                onReset={() => { setConflictSortBy('type'); setConflictSortOrder('asc'); }}
                summary={`${filteredConflicts.length} xung đột`}
              />

              {/* Main Table rendering conflicts comparison */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto max-h-[380px] lg:max-h-[440px]">
                  <table className="w-full text-left border-collapse text-xs table-fixed">
                    <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 z-10 border-b border-slate-200">
                      <tr>
                        <th className="p-3 w-[26%]">HẠNG MỤC / PHÂN HỆ</th>
                        <th className="p-3 w-[37%] text-center bg-indigo-50/40 text-indigo-950 border-r border-indigo-100/50">
                          BẢN TRÊN MÁY NÀY (LOCAL)
                        </th>
                        <th className="p-3 w-[37%] text-center bg-emerald-50/40 text-emerald-950">
                          BẢN TỆP IMPORT
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredConflicts.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-8 text-center text-slate-400">
                            {searchQuery ? 'Không tìm thấy mục xung đột nào phù hợp với bộ lọc!' : 'Không có xung đột thuộc chuyên mục này.'}
                          </td>
                        </tr>
                      ) : (
                        sortedFilteredConflicts.map((c) => {
                          const selection = getSelectedSide(c);
                          const localSideSelected = selection === 'local';
                          const importSideSelected = selection === 'import';

                          // Detect field-level differences to highlight specifically
                          const isRoom = c.type === 'room';
                          const isDefect = c.type === 'defect';
                          const isInventory = c.type === 'inventory';
                          const isVolume = c.type === 'workVolume';
                          const isChecklist = c.type === 'checklist';
                          const isCrew = c.type === 'crew';

                          const diffFlags = {
                            progress: (isRoom && c.localItem.progress !== c.importedItem.progress) || 
                                      (isVolume && c.localItem.progress !== c.importedItem.progress),
                            status: (isRoom && c.localItem.status !== c.importedItem.status) || 
                                    (isDefect && c.localItem.status !== c.importedItem.status) || 
                                    (isChecklist && c.localItem.status !== c.importedItem.status),
                            notes: (isRoom && c.localItem.notes !== c.importedItem.notes) || 
                                   (isChecklist && c.localItem.notes !== c.importedItem.notes),
                            severity: isDefect && c.localItem.severity !== c.importedItem.severity,
                            description: isDefect && c.localItem.description !== c.importedItem.description,
                            quantity: isInventory && Number(c.localItem.quantity) !== Number(c.importedItem.quantity),
                            unit: isInventory && c.localItem.unit !== c.importedItem.unit,
                            itemName: isInventory && c.localItem.itemName !== c.importedItem.itemName,
                            actual: isVolume && Number(c.localItem.actual) !== Number(c.importedItem.actual),
                            planned: isVolume && Number(c.localItem.planned) !== Number(c.importedItem.planned),
                            checkedBy: isChecklist && c.localItem.checkedBy !== c.importedItem.checkedBy,
                            workerCount: isCrew && Number(c.localItem.workerCount) !== Number(c.importedItem.workerCount),
                            taskDescription: isCrew && c.localItem.taskDescription !== c.importedItem.taskDescription,
                          };

                          return (
                            <tr key={c.uniqueKey} className="hover:bg-slate-50/40 transition-colors">
                              {/* Info Column */}
                              <td className="p-3 align-top space-y-1.5 border-r border-slate-100">
                                <div className="font-bold text-slate-900 leading-tight break-words">{c.name}</div>
                                <div className="flex flex-wrap gap-1">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    c.type === 'room' ? 'bg-sky-50 text-sky-700 border border-sky-100' :
                                    c.type === 'defect' ? 'bg-rose-50 text-rose-700 border border-rose-100' :
                                    c.type === 'inventory' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                                    c.type === 'workVolume' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                                    c.type === 'checklist' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' :
                                    'bg-purple-50 text-purple-700 border border-purple-100'
                                  }`}>
                                    {c.typeName}
                                  </span>
                                </div>
                              </td>

                              {/* Local Choice Card */}
                              <td className="p-2 align-top border-r border-slate-100">
                                <div
                                  onClick={() => selectedStrategy === 'manual' && handleManualToggle(c.uniqueKey, 'local')}
                                  className={`h-full p-2.5 rounded-xl border text-left relative transition-all ${
                                    selectedStrategy === 'manual' 
                                      ? 'cursor-pointer hover:shadow-xs hover:border-indigo-400 active:scale-[0.99]' 
                                      : ''
                                  } ${
                                    localSideSelected
                                      ? 'bg-indigo-50/70 border-indigo-300 text-indigo-950 shadow-xs'
                                      : 'bg-white border-slate-200 text-slate-400 opacity-60'
                                  }`}
                                >
                                  {/* Radio indicator */}
                                  <div className="absolute top-2.5 right-2.5">
                                    {localSideSelected ? (
                                      <div className="w-5 h-5 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-xs animate-in zoom-in-50 duration-150">
                                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                                      </div>
                                    ) : (
                                      selectedStrategy === 'manual' ? (
                                        <div className="w-5 h-5 rounded-full border border-slate-300 bg-white flex items-center justify-center hover:border-indigo-400 transition-colors" />
                                      ) : null
                                    )}
                                  </div>

                                  <div className="pr-6 space-y-1.5 text-[11px]">
                                    <div className={`font-bold text-[10px] uppercase tracking-wider ${localSideSelected ? 'text-indigo-800' : 'text-slate-400'}`}>
                                      {localSideSelected ? '✓ Giữ bản máy này' : 'Bản Máy Này'}
                                    </div>
                                    
                                    {/* Fields list */}
                                    <div className="space-y-1 text-slate-700">
                                      {isRoom && (
                                        <>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.progress ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Tiến độ:</span>
                                            <span className="font-bold">{c.localItem.progress}%</span>
                                          </div>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.status ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Trạng thái:</span>
                                            <span>{c.localItem.status || 'Chưa thi công'}</span>
                                          </div>
                                          {c.localItem.notes && (
                                            <div className={`p-1 rounded-sm text-[10px] italic border-t border-slate-100 mt-1 ${diffFlags.notes ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                              Ghi chú: {c.localItem.notes}
                                            </div>
                                          )}
                                        </>
                                      )}

                                      {isDefect && (
                                        <>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.status ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Trạng thái:</span>
                                            <span className="font-bold text-rose-600">{c.localItem.status}</span>
                                          </div>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.severity ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Mức độ:</span>
                                            <span className={`font-medium ${c.localItem.severity === 'Nghiêm trọng' ? 'text-rose-600' : ''}`}>{c.localItem.severity || 'Thường'}</span>
                                          </div>
                                          {c.localItem.description && (
                                            <div className={`p-1 rounded-sm text-[10px] italic border-t border-slate-100 mt-1 ${diffFlags.description ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                              Mô tả: {c.localItem.description}
                                            </div>
                                          )}
                                        </>
                                      )}

                                      {isInventory && (
                                        <>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.quantity ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Số lượng kho:</span>
                                            <span className="font-bold text-slate-900">{formatDecimal(c.localItem.quantity)}</span>
                                          </div>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.unit ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Đơn vị:</span>
                                            <span>{c.localItem.unit || 'Cái'}</span>
                                          </div>
                                        </>
                                      )}

                                      {isVolume && (
                                        <>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.progress ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Tiến độ việc:</span>
                                            <span className="font-bold">{c.localItem.progress || 0}%</span>
                                          </div>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.actual ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Thực tế:</span>
                                            <span className="font-semibold text-slate-800">{formatDecimal(c.localItem.actual)}</span>
                                          </div>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.planned ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Kế hoạch:</span>
                                            <span className="text-slate-600">{formatDecimal(c.localItem.planned)}</span>
                                          </div>
                                        </>
                                      )}

                                      {isChecklist && (
                                        <>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.status ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Đạt/Không đạt:</span>
                                            <span className={`font-bold ${c.localItem.status === 'Đạt' ? 'text-emerald-600' : 'text-amber-600'}`}>{c.localItem.status || 'Chưa kiểm'}</span>
                                          </div>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.checkedBy ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Kiểm tra bởi:</span>
                                            <span>{c.localItem.checkedBy || 'N/A'}</span>
                                          </div>
                                          {c.localItem.notes && (
                                            <div className={`p-1 rounded-sm text-[10px] italic border-t border-slate-100 mt-1 ${diffFlags.notes ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                              Ghi chú: {c.localItem.notes}
                                            </div>
                                          )}
                                        </>
                                      )}

                                      {isCrew && (
                                        <>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.workerCount ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Quân số:</span>
                                            <span className="font-bold text-indigo-700">{c.localItem.workerCount} người</span>
                                          </div>
                                          {c.localItem.taskDescription && (
                                            <div className={`p-1 rounded-sm text-[10px] mt-1 border-t border-slate-100 ${diffFlags.taskDescription ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                              Việc giao: {c.localItem.taskDescription}
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Import Choice Card */}
                              <td className="p-2 align-top">
                                <div
                                  onClick={() => selectedStrategy === 'manual' && handleManualToggle(c.uniqueKey, 'import')}
                                  className={`h-full p-2.5 rounded-xl border text-left relative transition-all ${
                                    selectedStrategy === 'manual' 
                                      ? 'cursor-pointer hover:shadow-xs hover:border-emerald-400 active:scale-[0.99]' 
                                      : ''
                                  } ${
                                    importSideSelected
                                      ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950 shadow-xs'
                                      : 'bg-white border-slate-200 text-slate-400 opacity-60'
                                  }`}
                                >
                                  {/* Radio indicator */}
                                  <div className="absolute top-2.5 right-2.5">
                                    {importSideSelected ? (
                                      <div className="w-5 h-5 bg-emerald-600 text-white rounded-full flex items-center justify-center shadow-xs animate-in zoom-in-50 duration-150">
                                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                                      </div>
                                    ) : (
                                      selectedStrategy === 'manual' ? (
                                        <div className="w-5 h-5 rounded-full border border-slate-300 bg-white flex items-center justify-center hover:border-emerald-400 transition-colors" />
                                      ) : null
                                    )}
                                  </div>

                                  <div className="pr-6 space-y-1.5 text-[11px]">
                                    <div className={`font-bold text-[10px] uppercase tracking-wider ${importSideSelected ? 'text-emerald-800' : 'text-slate-400'}`}>
                                      {importSideSelected ? '✓ Lấy bản tệp import' : 'Bản Tệp Import'}
                                    </div>
                                    
                                    {/* Fields list */}
                                    <div className="space-y-1 text-slate-700">
                                      {isRoom && (
                                        <>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.progress ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Tiến độ:</span>
                                            <span className="font-bold">{c.importedItem.progress}%</span>
                                          </div>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.status ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Trạng thái:</span>
                                            <span>{c.importedItem.status || 'Chưa thi công'}</span>
                                          </div>
                                          {c.importedItem.notes && (
                                            <div className={`p-1 rounded-sm text-[10px] italic border-t border-slate-100 mt-1 ${diffFlags.notes ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                              Ghi chú: {c.importedItem.notes}
                                            </div>
                                          )}
                                        </>
                                      )}

                                      {isDefect && (
                                        <>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.status ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Trạng thái:</span>
                                            <span className="font-bold text-rose-600">{c.importedItem.status}</span>
                                          </div>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.severity ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Mức độ:</span>
                                            <span className={`font-medium ${c.importedItem.severity === 'Nghiêm trọng' ? 'text-rose-600' : ''}`}>{c.importedItem.severity || 'Thường'}</span>
                                          </div>
                                          {c.importedItem.description && (
                                            <div className={`p-1 rounded-sm text-[10px] italic border-t border-slate-100 mt-1 ${diffFlags.description ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                              Mô tả: {c.importedItem.description}
                                            </div>
                                          )}
                                        </>
                                      )}

                                      {isInventory && (
                                        <>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.quantity ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Số lượng kho:</span>
                                            <span className="font-bold text-slate-900">{formatDecimal(c.importedItem.quantity)}</span>
                                          </div>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.unit ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Đơn vị:</span>
                                            <span>{c.importedItem.unit || 'Cái'}</span>
                                          </div>
                                        </>
                                      )}

                                      {isVolume && (
                                        <>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.progress ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Tiến độ việc:</span>
                                            <span className="font-bold">{c.importedItem.progress || 0}%</span>
                                          </div>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.actual ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Thực tế:</span>
                                            <span className="font-semibold text-slate-800">{formatDecimal(c.importedItem.actual)}</span>
                                          </div>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.planned ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Kế hoạch:</span>
                                            <span className="text-slate-600">{formatDecimal(c.importedItem.planned)}</span>
                                          </div>
                                        </>
                                      )}

                                      {isChecklist && (
                                        <>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.status ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Đạt/Không đạt:</span>
                                            <span className={`font-bold ${c.importedItem.status === 'Đạt' ? 'text-emerald-600' : 'text-amber-600'}`}>{c.importedItem.status || 'Chưa kiểm'}</span>
                                          </div>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.checkedBy ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Kiểm tra bởi:</span>
                                            <span>{c.importedItem.checkedBy || 'N/A'}</span>
                                          </div>
                                          {c.importedItem.notes && (
                                            <div className={`p-1 rounded-sm text-[10px] italic border-t border-slate-100 mt-1 ${diffFlags.notes ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                              Ghi chú: {c.importedItem.notes}
                                            </div>
                                          )}
                                        </>
                                      )}

                                      {isCrew && (
                                        <>
                                          <div className={`flex justify-between p-1 rounded-sm ${diffFlags.workerCount ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                            <span className="text-slate-500">Quân số:</span>
                                            <span className="font-bold text-emerald-700">{c.importedItem.workerCount} người</span>
                                          </div>
                                          {c.importedItem.taskDescription && (
                                            <div className={`p-1 rounded-sm text-[10px] mt-1 border-t border-slate-100 ${diffFlags.taskDescription ? 'bg-amber-100/40 text-amber-950 font-medium' : ''}`}>
                                              Việc giao: {c.importedItem.taskDescription}
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Guidelines Banner */}
          <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl text-blue-950 space-y-1">
            <p className="font-bold text-[11px] flex items-center gap-1">
              <span>💡 Hướng dẫn hợp nhất dữ liệu cuối ngày:</span>
            </p>
            <p className="text-slate-700 text-[10px] sm:text-[11px] leading-relaxed">
              - Chế độ <strong>Chọn Từng Mục</strong> cho phép bạn so sánh song song các mục bị lệch và bấm chọn trực tiếp vào ô tương ứng.<br/>
              - Các thông tin khác biệt cụ thể (như số quân số, % tiến độ, ghi chú...) sẽ được tự động làm nổi bật bằng màu cam giúp bạn dễ nhận diện.<br/>
              - Các hạng mục mới từ file import (ví dụ: vật tư mới, căn hộ mới) sẽ tự động được gộp thêm vào mà không gây mất mát dữ liệu hiện tại.
            </p>
          </div>

        </div>

        {/* Footer Buttons */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 text-xs">
          <div className="text-slate-500 hidden sm:block">
            Nhấn <strong className="text-indigo-600">Đồng ý</strong> để xác nhận quyết định của bạn.
          </div>
          
          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Hủy Bỏ
            </button>
            <button
              type="button"
              onClick={handleExecuteMerge}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-1.5"
            >
              <span>Tiến Hành Hợp Nhất &amp; Đồng Bộ</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
