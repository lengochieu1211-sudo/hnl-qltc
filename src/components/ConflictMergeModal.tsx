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

  // Combine all conflicts for a single clean comparison table representation
  const allConflicts = [
    ...roomConflicts.map(c => ({
      id: c.id,
      name: c.name,
      type: 'room' as const,
      typeName: 'Tiến độ phòng',
      local: c.localItem,
      imported: c.importedItem,
    })),
    ...defectConflicts.map(c => ({
      id: c.id,
      name: c.name,
      type: 'defect' as const,
      typeName: 'Trạng thái lỗi',
      local: c.localItem,
      imported: c.importedItem,
    }))
  ];

  // Helper to determine which side is active/selected based on current strategy
  const getSelectedSide = (conflictId: string, type: 'room' | 'defect', local: any, imported: any): 'local' | 'import' => {
    if (selectedStrategy === 'local') return 'local';
    if (selectedStrategy === 'import') return 'import';
    if (selectedStrategy === 'smart') {
      if (type === 'room') {
        const lProg = local.progress || 0;
        const iProg = imported.progress || 0;
        return iProg > lProg ? 'import' : 'local';
      }
      return 'local';
    }
    // manual (Chọn Từng Mục)
    return manualChoices[conflictId] || 'local';
  };

  const totalConflicts = roomConflicts.length + defectConflicts.length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">

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
                Bảng So Sánh Chi Tiết &amp; Quyết Định Giữ Dữ Liệu ({totalConflicts}):
              </h4>

              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto max-h-[350px]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 z-10 border-b border-slate-200">
                      <tr>
                        <th className="p-3 w-1/4">HẠNG MỤC / VỊ TRÍ</th>
                        <th className="p-3 w-3/8 text-center">BẢN MÁY NÀY (LOCAL)</th>
                        <th className="p-3 w-3/8 text-center">BẢN TỆP IMPORT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {allConflicts.map((c) => {
                        const localSideSelected = getSelectedSide(c.id, c.type, c.local, c.imported) === 'local';
                        const importSideSelected = !localSideSelected;

                        return (
                          <tr key={`${c.type}-${c.id}`} className="hover:bg-slate-50/50 transition-colors">
                            {/* Left column: Name and Badge */}
                            <td className="p-3 align-top space-y-1">
                              <div className="font-bold text-slate-900 leading-tight">{c.name}</div>
                              <div className="flex flex-wrap gap-1">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                  c.type === 'room' ? 'bg-sky-50 text-sky-700 border border-sky-100' : 'bg-rose-50 text-rose-700 border border-rose-100'
                                }`}>
                                  {c.type === 'room' ? 'Tiến độ phòng' : 'Trạng thái lỗi'}
                                </span>
                              </div>
                            </td>

                            {/* Local side card */}
                            <td className="p-2 align-top">
                              <div
                                onClick={() => selectedStrategy === 'manual' && handleManualToggle(c.id, 'local')}
                                className={`h-full p-3 rounded-xl border transition-all text-left relative ${
                                  selectedStrategy === 'manual' ? 'cursor-pointer hover:shadow-xs active:scale-[0.99]' : ''
                                } ${
                                  localSideSelected
                                    ? 'bg-indigo-50/70 border-indigo-300 text-indigo-950 shadow-xs'
                                    : 'bg-white border-slate-200 text-slate-400 opacity-60'
                                }`}
                              >
                                {/* Check indicator */}
                                <div className="absolute top-2.5 right-2.5 flex items-center justify-center">
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

                                <div className="pr-6 space-y-1 text-[11px]">
                                  <div className={`font-bold flex items-center gap-1 ${localSideSelected ? 'text-indigo-900' : 'text-slate-400'}`}>
                                    <span>Giữ bản trên Máy</span>
                                  </div>

                                  {c.type === 'room' ? (
                                    <div className="space-y-0.5">
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Tiến độ:</span>
                                        <span className="font-bold">{c.local.progress}%</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Trạng thái:</span>
                                        <span className="font-medium">{c.local.status || 'Chưa thi công'}</span>
                                      </div>
                                      {c.local.notes && (
                                        <div className="mt-1 pt-1 border-t border-slate-100 text-[10px] italic line-clamp-2">
                                          Ghi chú: {c.local.notes}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="space-y-0.5">
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Trạng thái:</span>
                                        <span className="font-bold">{c.local.status}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Mức độ:</span>
                                        <span className={`font-medium ${c.local.severity === 'Nghiêm trọng' ? 'text-rose-600' : ''}`}>{c.local.severity || 'Thường'}</span>
                                      </div>
                                      {c.local.description && (
                                        <div className="mt-1 pt-1 border-t border-slate-100 text-[10px] italic line-clamp-2">
                                          Mô tả: {c.local.description}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Import side card */}
                            <td className="p-2 align-top">
                              <div
                                onClick={() => selectedStrategy === 'manual' && handleManualToggle(c.id, 'import')}
                                className={`h-full p-3 rounded-xl border transition-all text-left relative ${
                                  selectedStrategy === 'manual' ? 'cursor-pointer hover:shadow-xs active:scale-[0.99]' : ''
                                } ${
                                  importSideSelected
                                    ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950 shadow-xs'
                                    : 'bg-white border-slate-200 text-slate-400 opacity-60'
                                }`}
                              >
                                {/* Check indicator */}
                                <div className="absolute top-2.5 right-2.5 flex items-center justify-center">
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

                                <div className="pr-6 space-y-1 text-[11px]">
                                  <div className={`font-bold flex items-center gap-1 ${importSideSelected ? 'text-emerald-900' : 'text-slate-400'}`}>
                                    <span>Lấy bản tệp Import</span>
                                  </div>

                                  {c.type === 'room' ? (
                                    <div className="space-y-0.5">
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Tiến độ:</span>
                                        <span className="font-bold">{c.imported.progress}%</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Trạng thái:</span>
                                        <span className="font-medium">{c.imported.status || 'Chưa thi công'}</span>
                                      </div>
                                      {c.imported.notes && (
                                        <div className="mt-1 pt-1 border-t border-slate-100 text-[10px] italic line-clamp-2">
                                          Ghi chú: {c.imported.notes}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="space-y-0.5">
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Trạng thái:</span>
                                        <span className="font-bold">{c.imported.status}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-slate-500">Mức độ:</span>
                                        <span className={`font-medium ${c.imported.severity === 'Nghiêm trọng' ? 'text-rose-600' : ''}`}>{c.imported.severity || 'Thường'}</span>
                                      </div>
                                      {c.imported.description && (
                                        <div className="mt-1 pt-1 border-t border-slate-100 text-[10px] italic line-clamp-2">
                                          Mô tả: {c.imported.description}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Explanation Footer note */}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 space-y-1">
            <p className="font-bold">💡 Hướng dẫn xử lý cuối ngày cho nhóm nhiều kỹ sư:</p>
            <p className="text-slate-700 text-[11px]">
              - Chế độ <strong>Chọn Từng Mục (Manual)</strong> cho phép bạn so sánh song song và tích chọn trực tiếp vào từng ô để quyết định giữ dữ liệu nào cho từng căn hộ hoặc lỗi cụ thể.<br/>
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
