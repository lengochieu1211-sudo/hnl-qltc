import React, { useState } from 'react';
import { GitMerge, AlertTriangle, CheckCircle2, ArrowRight, X, ShieldAlert, Layers, Check, RefreshCw } from 'lucide-react';

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
  // Detect conflicts between local and imported data
  const [selectedStrategy, setSelectedStrategy] = useState<'smart' | 'import' | 'local' | 'manual'>('smart');
  
  // For manual resolution choices: store mapping of key -> 'local' | 'import'
  const [manualChoices, setManualChoices] = useState<Record<string, 'local' | 'import'>>({});

  // Compare Room Progress conflicts
  const localRooms = Array.isArray(localData?.roomProgressList) ? localData.roomProgressList : [];
  const importedRooms = Array.isArray(importedData?.roomProgressList) ? importedData.roomProgressList : [];

  const roomConflicts: Array<{ id: string; name: string; localItem: any; importedItem: any }> = [];
  
  localRooms.forEach((lRoom: any) => {
    const key = lRoom.id || lRoom.roomId || lRoom.roomName;
    const iRoom = importedRooms.find((r: any) => (r.id || r.roomId || r.roomName) === key);
    if (iRoom) {
      // Check if progress or notes or status differ
      if (
        lRoom.progress !== iRoom.progress ||
        lRoom.status !== iRoom.status ||
        lRoom.notes !== iRoom.notes
      ) {
        roomConflicts.push({
          id: key,
          name: lRoom.roomName || lRoom.name || key,
          localItem: lRoom,
          importedItem: iRoom,
        });
      }
    }
  });

  // Compare Defects conflicts
  const localDefects = Array.isArray(localData?.defects) ? localData.defects : [];
  const importedDefects = Array.isArray(importedData?.defects) ? importedData.defects : [];
  const defectConflicts: Array<{ id: string; name: string; localItem: any; importedItem: any }> = [];

  localDefects.forEach((lDef: any) => {
    const key = lDef.id;
    const iDef = importedDefects.find((d: any) => d.id === key);
    if (iDef) {
      if (lDef.status !== iDef.status || lDef.severity !== iDef.severity || lDef.description !== iDef.description) {
        defectConflicts.push({
          id: key,
          name: lDef.title || lDef.description || `Defect #${key}`,
          localItem: lDef,
          importedItem: iDef,
        });
      }
    }
  });

  const handleManualToggle = (conflictId: string, choice: 'local' | 'import') => {
    setManualChoices(prev => ({ ...prev, [conflictId]: choice }));
  };

  const handleExecuteMerge = () => {
    if (selectedStrategy === 'import') {
      onApplyMerged(importedData);
      return;
    }
    if (selectedStrategy === 'local') {
      onClose();
      return;
    }

    if (selectedStrategy === 'smart' || selectedStrategy === 'manual') {
      // Build smart merged object
      const merged = { ...localData };

      // Merge project info (prefer non-empty)
      if (importedData.projectName && !localData.projectName) merged.projectName = importedData.projectName;
      if (importedData.contractorName && !localData.contractorName) merged.contractorName = importedData.contractorName;

      // Merge room progress list
      const mergedRoomsMap = new Map();
      // Add all local rooms first
      localRooms.forEach((r: any) => mergedRoomsMap.set(r.id || r.roomId || r.roomName, { ...r }));

      importedRooms.forEach((iRoom: any) => {
        const key = iRoom.id || iRoom.roomId || iRoom.roomName;
        if (!mergedRoomsMap.has(key)) {
          // New room from imported
          mergedRoomsMap.set(key, iRoom);
        } else {
          // Conflict or existing
          const conflictMatch = roomConflicts.find(c => c.id === key);
          if (conflictMatch) {
            if (selectedStrategy === 'manual') {
              const choice = manualChoices[key] || 'local';
              if (choice === 'import') {
                mergedRoomsMap.set(key, iRoom);
              }
            } else {
              // Smart: take highest progress or latest update
              const lProg = conflictMatch.localItem.progress || 0;
              const iProg = conflictMatch.importedItem.progress || 0;
              if (iProg > lProg) {
                mergedRoomsMap.set(key, iRoom);
              }
            }
          }
        }
      });
      merged.roomProgressList = Array.from(mergedRoomsMap.values());

      // Merge defects (union by id, resolve conflicts)
      const mergedDefectsMap = new Map();
      localDefects.forEach((d: any) => mergedDefectsMap.set(d.id, { ...d }));
      importedDefects.forEach((iDef: any) => {
        const key = iDef.id;
        if (!mergedDefectsMap.has(key)) {
          mergedDefectsMap.set(key, iDef);
        } else {
          const conflictMatch = defectConflicts.find(c => c.id === key);
          if (conflictMatch && selectedStrategy === 'manual') {
            const choice = manualChoices[key] || 'local';
            if (choice === 'import') {
              mergedDefectsMap.set(key, iDef);
            }
          }
          // Smart default for defects: if imported says resolved/closed or has newer updates, take it or keep local. Let's keep local or combine.
        }
      });
      merged.defects = Array.from(mergedDefectsMap.values());

      // Merge other arrays (inventory, workVolumes, checklist, etc) by union
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

      mergeArrayByUnion('inventory', 'id');
      mergeArrayByUnion('workVolumes', 'id');
      mergeArrayByUnion('materialNorms', 'id');
      mergeArrayByUnion('floorPlans', 'id');
      mergeArrayByUnion('checklist', 'id');
      mergeArrayByUnion('crewRecords', 'id');
      mergeArrayByUnion('teams', 'id');

      merged.updatedAt = Date.now();
      onApplyMerged(merged);
    }
  };

  const totalConflicts = roomConflicts.length + defectConflicts.length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-amber-600 to-amber-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/20 rounded-xl">
              <GitMerge className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Hợp Nhất Dữ Liệu &amp; Xử Lý Xung Đột Cuối Ngày</h3>
              <p className="text-[11px] text-amber-100">
                Phát hiện {totalConflicts} hạng mục có sự thay đổi khác nhau giữa Máy này và Tệp Import
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
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-700">
          
          {/* Strategy selection */}
          <div className="space-y-2">
            <label className="font-bold text-slate-900 text-xs block">
              Chọn phương thức đồng bộ / hợp nhất:
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setSelectedStrategy('smart')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedStrategy === 'smart'
                    ? 'border-indigo-600 bg-indigo-50/80 text-indigo-950 font-bold shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 text-indigo-700 mb-1">
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Gộp Thông Minh</span>
                </div>
                <p className="text-[10px] text-slate-500 font-normal">Tự động hợp nhất dữ liệu, ưu tiên tiến độ cao hơn</p>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStrategy('manual')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedStrategy === 'manual'
                    ? 'border-amber-600 bg-amber-50/80 text-amber-950 font-bold shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 text-amber-700 mb-1">
                  <Layers className="w-3.5 h-3.5" />
                  <span>Chọn Từng Mục</span>
                </div>
                <p className="text-[10px] text-slate-500 font-normal">Tự quyết định giữ máy này hay tệp import</p>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStrategy('import')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedStrategy === 'import'
                    ? 'border-emerald-600 bg-emerald-50/80 text-emerald-950 font-bold shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 text-emerald-700 mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Lấy Bản Import</span>
                </div>
                <p className="text-[10px] text-slate-500 font-normal">Ghi đè toàn bộ bằng dữ liệu từ tệp gửi tới</p>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStrategy('local')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedStrategy === 'local'
                    ? 'border-slate-600 bg-slate-100 text-slate-900 font-bold shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 text-slate-700 mb-1">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Giữ Máy Này</span>
                </div>
                <p className="text-[10px] text-slate-500 font-normal">Hủy bỏ tệp import, giữ nguyên dữ liệu hiện tại</p>
              </button>
            </div>
          </div>

          {/* Conflict details list */}
          {totalConflicts === 0 ? (
            <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
              <h4 className="font-bold text-emerald-900 text-sm">Không có xung đột dữ liệu nào!</h4>
              <p className="text-xs text-emerald-700">Tệp import khớp hoàn toàn hoặc bổ sung liền mạch với dữ liệu trên máy.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <h4 className="font-bold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Danh Sách Xung Đột Cần Lưu Ý ({totalConflicts}):
              </h4>

              <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                {roomConflicts.map((c) => {
                  const currentChoice = manualChoices[c.id] || 'local';
                  return (
                    <div key={`room-${c.id}`} className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">Phòng / Khu vực: {c.name}</span>
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[10px] font-bold">Xung đột tiến độ</span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className={`p-2 rounded-lg border ${currentChoice === 'local' && selectedStrategy === 'manual' ? 'bg-indigo-50 border-indigo-300' : 'bg-white border-slate-200'}`}>
                          <p className="font-bold text-slate-700 mb-0.5">Máy này (Local):</p>
                          <p className="text-slate-600">Tiến độ: <strong>{c.localItem.progress}%</strong> - Trạng thái: {c.localItem.status || 'Chưa cập nhật'}</p>
                        </div>
                        <div className={`p-2 rounded-lg border ${currentChoice === 'import' && selectedStrategy === 'manual' ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-slate-200'}`}>
                          <p className="font-bold text-slate-700 mb-0.5">Tệp Import:</p>
                          <p className="text-slate-600">Tiến độ: <strong>{c.importedItem.progress}%</strong> - Trạng thái: {c.importedItem.status || 'Chưa cập nhật'}</p>
                        </div>
                      </div>

                      {selectedStrategy === 'manual' && (
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleManualToggle(c.id, 'local')}
                            className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all ${currentChoice === 'local' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'}`}
                          >
                            Dùng bản Máy này
                          </button>
                          <button
                            type="button"
                            onClick={() => handleManualToggle(c.id, 'import')}
                            className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all ${currentChoice === 'import' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}
                          >
                            Dùng tệp Import
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {defectConflicts.map((c) => {
                  const currentChoice = manualChoices[c.id] || 'local';
                  return (
                    <div key={`defect-${c.id}`} className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">Lỗi (Defect): {c.name}</span>
                        <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-[10px] font-bold">Xung đột trạng thái lỗi</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="p-2 bg-white rounded-lg border border-slate-200">
                          <p className="font-bold text-slate-700">Máy này: {c.localItem.status}</p>
                        </div>
                        <div className="p-2 bg-white rounded-lg border border-slate-200">
                          <p className="font-bold text-slate-700">Tệp Import: {c.importedItem.status}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Explanation Footer note */}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 space-y-1">
            <p className="font-bold">💡 Hướng dẫn xử lý cuối ngày cho nhóm nhiều kỹ sư:</p>
            <p className="text-slate-700 text-[11px]">
              - Nếu 2 kỹ sư cùng sửa 1 phòng, chế độ <strong>Gộp Thông Minh</strong> sẽ tự động lấy giá trị hoàn thành cao nhất hoặc mới nhất.<br/>
              - Sau khi đồng bộ xong, bạn có thể xuất tệp JSON mới nhất gửi lại cho cả nhóm vào sáng hôm sau.
            </p>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
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
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md transition-all flex items-center gap-1.5"
          >
            <span>Tiến Hành Hợp Nhất &amp; Đồng Bộ</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

      </div>
    </div>
  );
};
