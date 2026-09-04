from pathlib import Path

ROOM_MODAL = Path('src/components/RoomHighlightModal.tsx')
FLOOR_TAB = Path('src/components/FloorPlanDefectTab.tsx')
GOLDEN = Path('scripts/room-progress-consistency-golden.ts')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# 1) Runtime UI: no construction step can be "Đạt nghiệm thu" before completion.
# ---------------------------------------------------------------------------
text = ROOM_MODAL.read_text(encoding='utf-8')
old = '''  // Update sub item field
  const handleUpdateSubItem = (id: string, patch: Partial<RoomSubItem>) => {
    const effectivePatch = structureReadOnly
      ? Object.fromEntries(Object.entries(patch).filter(([key]) => ['status', 'inspectionStatus', 'targetDate', 'assignedTeam', 'teamId'].includes(key))) as Partial<RoomSubItem>
      : patch;
    if (Object.keys(effectivePatch).length === 0) return;
    setSubItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const next = { ...item, ...effectivePatch };
      // A work step cannot stay "Đạt nghiệm thu" after its construction status
      // is moved back to Chưa làm / Đang làm. Keep old data compatible but
      // prevent creating new contradictory states.
      if (effectivePatch.status && effectivePatch.status !== 'Đã hoàn thành' && next.inspectionStatus === 'Đạt nghiệm thu') {
        next.inspectionStatus = 'Chưa nghiệm thu';
      }
      // Passing inspection is only valid after construction is completed.
      if (effectivePatch.inspectionStatus === 'Đạt nghiệm thu' && next.status !== 'Đã hoàn thành') {
        return item;
      }
      return next;
    }));
  };
'''
new = '''  const applyProgressPatch = (item: RoomSubItem, patch: Partial<RoomSubItem>): RoomSubItem => {
    const next = { ...item, ...patch };

    // Business invariant: an item can only be "Đạt nghiệm thu" after construction
    // is completed. Moving progress backwards automatically reopens inspection;
    // trying to pass an unfinished item is ignored instead of creating bad data.
    if (next.inspectionStatus === 'Đạt nghiệm thu' && next.status !== 'Đã hoàn thành') {
      if (patch.inspectionStatus === 'Đạt nghiệm thu') return item;
      next.inspectionStatus = 'Chưa nghiệm thu';
    }

    return next;
  };

  // Update sub item field
  const handleUpdateSubItem = (id: string, patch: Partial<RoomSubItem>) => {
    const effectivePatch = structureReadOnly
      ? Object.fromEntries(Object.entries(patch).filter(([key]) => ['status', 'inspectionStatus', 'targetDate', 'assignedTeam', 'teamId'].includes(key))) as Partial<RoomSubItem>
      : patch;
    if (Object.keys(effectivePatch).length === 0) return;
    setSubItems(prev => prev.map(item => item.id === id ? applyProgressPatch(item, effectivePatch) : item));
  };
'''
text = replace_once(text, old, new, 'RoomHighlightModal handleUpdateSubItem')

old = """                                setSubItems(prev => prev.map(s => selectedSubItemIds.includes(s.id) ? { ...s, status: st } : s));
"""
new = """                                setSubItems(prev => prev.map(s => selectedSubItemIds.includes(s.id) ? applyProgressPatch(s, { status: st }) : s));
"""
text = replace_once(text, old, new, 'RoomHighlightModal bulk progress')

old = """                              onClick={async () => {
                                setSubItems(prev => prev.map(s => selectedSubItemIds.includes(s.id) ? { ...s, inspectionStatus: st } : s));
                              }}
"""
new = """                              onClick={async () => {
                                if (st === 'Đạt nghiệm thu') {
                                  const blockedCount = subItems.filter(s => selectedSubItemIds.includes(s.id) && s.status !== 'Đã hoàn thành').length;
                                  if (blockedCount > 0) {
                                    alert(`⚠️ Có ${blockedCount} hạng mục chưa hoàn thành nên không thể chuyển sang “Đạt nghiệm thu”. Hãy cập nhật Tiến độ = “Đã hoàn thành” trước.`);
                                  }
                                }
                                setSubItems(prev => prev.map(s => selectedSubItemIds.includes(s.id) ? applyProgressPatch(s, { inspectionStatus: st }) : s));
                              }}
"""
text = replace_once(text, old, new, 'RoomHighlightModal bulk inspection')

anchor = """    const invalidVolumeFormula = Object.entries(volumeStrings).find(([, raw]) => {
"""
guard = """    const contradictorySubItems = subItems.filter(
      (item) => item.inspectionStatus === 'Đạt nghiệm thu' && item.status !== 'Đã hoàn thành'
    );
    if (contradictorySubItems.length > 0) {
      const names = contradictorySubItems.slice(0, 5).map((item) => `• ${item.name}: ${item.status} → ${item.inspectionStatus}`).join('\\n');
      const suffix = contradictorySubItems.length > 5 ? `\\n• ... và ${contradictorySubItems.length - 5} hạng mục khác` : '';
      alert(
        `⚠️ Không thể lưu vì có ${contradictorySubItems.length} hạng mục “Đạt nghiệm thu” nhưng thi công chưa hoàn thành.\\n\\n${names}${suffix}\\n\\nHãy chuyển Tiến độ sang “Đã hoàn thành” hoặc đưa Nghiệm thu về “Chưa nghiệm thu”.`
      );
      return;
    }

    const invalidVolumeFormula = Object.entries(volumeStrings).find(([, raw]) => {
"""
text = replace_once(text, anchor, guard, 'RoomHighlightModal submit invariant')
ROOM_MODAL.write_text(text, encoding='utf-8')


# ---------------------------------------------------------------------------
# 2) Excel export/import: diagnostics sheet + preflight + normalization.
# ---------------------------------------------------------------------------
text = FLOOR_TAB.read_text(encoding='utf-8')

anchor = """    const roomHeaders = [
"""
insert = """    const exportIssues: Array<{
      'Mức': 'LỖI' | 'CẢNH BÁO';
      'Căn / Phòng': string;
      'Hạng Mục / Công Đoạn': string;
      'Vấn Đề': string;
      'Đề Xuất': string;
    }> = [];

    roomsToExport.forEach((room) => {
      const roomSubItems = room.subItems || [];
      roomSubItems.forEach((subItem) => {
        const resolvedTeam = resolveExcelTeamName(subItem.teamId, subItem.assignedTeam);
        if (!resolvedTeam) {
          exportIssues.push({
            'Mức': 'CẢNH BÁO',
            'Căn / Phòng': room.roomName,
            'Hạng Mục / Công Đoạn': `${subItem.category || room.workCategory || 'Chưa phân nhóm'} / ${subItem.name}`,
            'Vấn Đề': 'Chưa gán đội thi công cho hạng mục.',
            'Đề Xuất': 'Chọn đúng đội đang thi công Căn / Phòng trước khi nghiệm thu hoặc cập nhật Excel.'
          });
        }
        if (subItem.inspectionStatus === 'Đạt nghiệm thu' && subItem.status !== 'Đã hoàn thành') {
          exportIssues.push({
            'Mức': 'LỖI',
            'Căn / Phòng': room.roomName,
            'Hạng Mục / Công Đoạn': `${subItem.category || room.workCategory || 'Chưa phân nhóm'} / ${subItem.name}`,
            'Vấn Đề': `Nghiệm thu = “Đạt nghiệm thu” nhưng Tiến độ = “${subItem.status}”.`,
            'Đề Xuất': 'Chỉ được Đạt nghiệm thu khi Tiến độ = “Đã hoàn thành”.'
          });
        }
      });

      // Legacy rooms without subItems still need the same invariant checked on
      // frame/board summary fields so older data cannot hide contradictions.
      if (roomSubItems.length === 0) {
        if (room.frameInspectionStatus === 'Đạt nghiệm thu' && room.frameStatus !== 'Đã hoàn thành') {
          exportIssues.push({
            'Mức': 'LỖI',
            'Căn / Phòng': room.roomName,
            'Hạng Mục / Công Đoạn': 'Khung xương (legacy)',
            'Vấn Đề': `Nghiệm thu Khung = “Đạt nghiệm thu” nhưng Tiến độ = “${room.frameStatus}”.`,
            'Đề Xuất': 'Hoàn thành thi công Khung trước khi Đạt nghiệm thu.'
          });
        }
        if (room.boardInspectionStatus === 'Đạt nghiệm thu' && room.boardStatus !== 'Đã hoàn thành') {
          exportIssues.push({
            'Mức': 'LỖI',
            'Căn / Phòng': room.roomName,
            'Hạng Mục / Công Đoạn': 'Tấm (legacy)',
            'Vấn Đề': `Nghiệm thu Tấm = “Đạt nghiệm thu” nhưng Tiến độ = “${room.boardStatus}”.`,
            'Đề Xuất': 'Hoàn thành thi công Tấm trước khi Đạt nghiệm thu.'
          });
        }
        if (!resolveExcelTeamName(room.teamId, room.assignedTeam)) {
          exportIssues.push({
            'Mức': 'CẢNH BÁO',
            'Căn / Phòng': room.roomName,
            'Hạng Mục / Công Đoạn': 'Căn / Phòng (legacy)',
            'Vấn Đề': 'Chưa gán đội thi công.',
            'Đề Xuất': 'Gán đội thi công trước khi cập nhật nghiệm thu.'
          });
        }
      }
    });

    const roomHeaders = [
"""
text = replace_once(text, anchor, insert, 'FloorPlanDefectTab export issue collector')

anchor = """    const guideSheet = XLSX.utils.aoa_to_sheet([
"""
insert = """    const issueHeaders = ['Mức', 'Căn / Phòng', 'Hạng Mục / Công Đoạn', 'Vấn Đề', 'Đề Xuất'];
    const issueData = exportIssues.length > 0
      ? exportIssues
      : [{
          'Mức': 'OK',
          'Căn / Phòng': '',
          'Hạng Mục / Công Đoạn': '',
          'Vấn Đề': 'Không phát hiện lỗi logic nghiệm thu hoặc hạng mục thiếu đội thi công.',
          'Đề Xuất': 'Có thể chỉnh sửa các sheet dữ liệu và Nhập Excel lại.'
        }];
    const issueSheet = XLSX.utils.json_to_sheet(issueData, { header: issueHeaders });
    issueSheet['!cols'] = [
      { wch: 12 }, { wch: 26 }, { wch: 38 }, { wch: 56 }, { wch: 56 }
    ];
    issueSheet['!autofilter'] = { ref: `A1:E${Math.max(2, issueData.length + 1)}` };
    issueSheet['!rows'] = [{ hpt: 24 }];
    XLSX.utils.book_append_sheet(wb, issueSheet, 'Kiem_Tra');

    const guideSheet = XLSX.utils.aoa_to_sheet([
"""
text = replace_once(text, anchor, insert, 'FloorPlanDefectTab Kiem_Tra sheet')

old = """      ['6', 'Nếu dữ liệu cũ chỉ có tên đội/hạng mục, khi Xuất Excel ứng dụng sẽ tự bổ sung ID nếu tên khớp chính xác danh mục hiện hành.']
"""
new = """      ['6', 'Nếu dữ liệu cũ chỉ có tên đội/hạng mục, khi Xuất Excel ứng dụng sẽ tự bổ sung ID nếu tên khớp chính xác danh mục hiện hành.'],
      ['7', 'Sheet Kiem_Tra liệt kê lỗi logic nghiệm thu và các hạng mục chưa gán đội. CẢNH BÁO không chặn nhập; LỖI nghiệm thu sẽ được tự chuẩn hóa khi Nhập Excel.'],
      ['8', 'Quy tắc bắt buộc: chỉ được Đạt nghiệm thu khi Trạng Thái Thi Công = Đã hoàn thành.']
"""
text = replace_once(text, old, new, 'FloorPlanDefectTab guide rules')

old = """    return saveWorkbookFile(
      wb,
      `Danh_Sach_Phong_${activeFloor ? activeFloor.floorName.replace(/\\s+/g, '_') : 'MatBang'}.xlsx`
    );
"""
new = """    const exportErrorCount = exportIssues.filter((issue) => issue['Mức'] === 'LỖI').length;
    const exportWarningCount = exportIssues.filter((issue) => issue['Mức'] === 'CẢNH BÁO').length;
    if (exportIssues.length > 0) {
      alert(
        `⚠️ Kiểm tra trước khi xuất Excel:\\n\\n` +
        `• Lỗi logic nghiệm thu: ${exportErrorCount}\\n` +
        `• Hạng mục/Căn chưa gán đội: ${exportWarningCount}\\n\\n` +
        `File vẫn được xuất. Xem sheet “Kiem_Tra” để biết chính xác Căn / Phòng và hạng mục cần xử lý.`
      );
    }

    return saveWorkbookFile(
      wb,
      `Danh_Sach_Phong_${activeFloor ? activeFloor.floorName.replace(/\\s+/g, '_') : 'MatBang'}.xlsx`
    );
"""
text = replace_once(text, old, new, 'FloorPlanDefectTab export warning')

anchor = """        const currentFloorRooms = roomProgressList.filter(r => r.floorId === activeFloor?.id);
"""
preflight = """        const preflightRoomConflicts = jsonData.filter((row: any) => {
          const frameStatus = String(row['Trạng Thái Khung Xương'] ?? row['frameStatus'] ?? '').trim();
          const boardStatus = String(row['Trạng Thái Bắn Tấm'] ?? row['boardStatus'] ?? '').trim();
          const frameInspection = String(row['Nghiệm Thu Khung'] ?? row['frameInspectionStatus'] ?? '').trim();
          const boardInspection = String(row['Nghiệm Thu Tấm'] ?? row['boardInspectionStatus'] ?? '').trim();
          return (frameInspection === 'Đạt nghiệm thu' && frameStatus !== 'Đã hoàn thành') ||
            (boardInspection === 'Đạt nghiệm thu' && boardStatus !== 'Đã hoàn thành');
        }).length;
        const preflightDetailConflicts = detailJsonData.filter((row: any) => {
          const status = String(row['Trạng Thái Thi Công'] ?? row['status'] ?? '').trim();
          const inspection = String(row['Nghiệm Thu Hạng Mục'] ?? row['inspectionStatus'] ?? '').trim();
          return inspection === 'Đạt nghiệm thu' && status !== 'Đã hoàn thành';
        }).length;
        const preflightMissingTeamRows = detailJsonData.filter((row: any) => {
          const teamId = String(row['__teamId'] ?? row['teamId'] ?? '').trim();
          const teamName = String(row['Đội Thi Công'] ?? row['assignedTeam'] ?? '').trim();
          return !teamId && !teamName;
        }).length;
        const preflightConflictCount = preflightRoomConflicts + preflightDetailConflicts;

        if (preflightConflictCount > 0 || preflightMissingTeamRows > 0) {
          const proceedWithWarnings = await confirmAsync(
            `⚠️ KIỂM TRA FILE EXCEL TRƯỚC KHI NHẬP\\n\\n` +
            `• Trạng thái nghiệm thu không hợp lệ: ${preflightConflictCount}\\n` +
            `• Dòng hạng mục chưa có đội thi công: ${preflightMissingTeamRows}\\n\\n` +
            `Nếu tiếp tục, ứng dụng sẽ tự đổi “Đạt nghiệm thu” → “Chưa nghiệm thu” cho các hạng mục chưa hoàn thành. ` +
            `Các dòng chưa có đội vẫn được nhập; khi cập nhật phòng cũ hệ thống giữ đội cũ nếu có.\\n\\n` +
            `Bấm “Đồng ý” để tiếp tục hoặc “Hủy” để quay lại chỉnh Excel.`
          );
          if (!proceedWithWarnings) {
            e.target.value = '';
            return;
          }
        }

        const currentFloorRooms = roomProgressList.filter(r => r.floorId === activeFloor?.id);
"""
text = replace_once(text, anchor, preflight, 'FloorPlanDefectTab import preflight')

old = """        let importedCount = 0;
        let updatedCount = 0;
        const processedRoomIds = new Set<string>();
"""
new = """        let importedCount = 0;
        let updatedCount = 0;
        let normalizedInspectionCount = 0;
        let missingTeamWarningCount = 0;
        const processedRoomIds = new Set<string>();
"""
text = replace_once(text, old, new, 'FloorPlanDefectTab import counters')

old = """          const frameStatusVal = validAcceptance.includes(frameSt) ? frameSt : 'Chưa làm';
          const boardStatusVal = validAcceptance.includes(boardSt) ? boardSt : 'Chưa làm';
          const frameInspectionVal = validInspection.includes(frameInsp) ? frameInsp : 'Chưa nghiệm thu';
          const boardInspectionVal = validInspection.includes(boardInsp) ? boardInsp : 'Chưa nghiệm thu';

          let overall = 'Chưa nghiệm thu';
"""
new = """          const frameStatusVal = validAcceptance.includes(frameSt) ? frameSt : 'Chưa làm';
          const boardStatusVal = validAcceptance.includes(boardSt) ? boardSt : 'Chưa làm';
          let frameInspectionVal = validInspection.includes(frameInsp) ? frameInsp : 'Chưa nghiệm thu';
          let boardInspectionVal = validInspection.includes(boardInsp) ? boardInsp : 'Chưa nghiệm thu';

          if (frameInspectionVal === 'Đạt nghiệm thu' && frameStatusVal !== 'Đã hoàn thành') {
            frameInspectionVal = 'Chưa nghiệm thu';
            normalizedInspectionCount++;
          }
          if (boardInspectionVal === 'Đạt nghiệm thu' && boardStatusVal !== 'Đã hoàn thành') {
            boardInspectionVal = 'Chưa nghiệm thu';
            normalizedInspectionCount++;
          }

          let overall = 'Chưa nghiệm thu';
"""
text = replace_once(text, old, new, 'FloorPlanDefectTab room inspection normalization')

old = """                  const rawWeight = detailRow['Trọng Số Tiến Độ'] ?? detailRow['progressWeight'];

                  return {
                    ...(existingSubItem || {}),
                    id: existingSubItem?.id || rawSubItemId || createEntityId('sub-custom'),
                    name: itemName,
                    category: categoryLink.name || existingSubItem?.category,
                    workCategoryId: categoryLink.id || (categoryLink.name ? undefined : existingSubItem?.workCategoryId),
                    status: validAcceptance.includes(rawStatus)
                      ? rawStatus as RoomSubItem['status']
                      : (existingSubItem?.status || 'Chưa làm'),
                    inspectionStatus: validInspection.includes(rawInspection)
                      ? rawInspection as RoomSubItem['inspectionStatus']
                      : (existingSubItem?.inspectionStatus || 'Chưa nghiệm thu'),
                    targetDate: rawTargetDate || existingSubItem?.targetDate,
                    assignedTeam: teamLink.assignedTeam || existingSubItem?.assignedTeam,
                    teamId: teamLink.teamId || (teamLink.assignedTeam ? undefined : existingSubItem?.teamId),
                    workVolume: hasExcelValue(rawVolume) ? parseExcelNumber(rawVolume) : existingSubItem?.workVolume,
                    volumeUnit: rawUnit || existingSubItem?.volumeUnit,
                    progressWeight: hasExcelValue(rawWeight) ? parseExcelNumber(rawWeight) : existingSubItem?.progressWeight,
                  };
"""
new = """                  const rawWeight = detailRow['Trọng Số Tiến Độ'] ?? detailRow['progressWeight'];

                  const normalizedStatus = validAcceptance.includes(rawStatus)
                    ? rawStatus as RoomSubItem['status']
                    : (existingSubItem?.status || 'Chưa làm');
                  let normalizedInspection = validInspection.includes(rawInspection)
                    ? rawInspection as RoomSubItem['inspectionStatus']
                    : (existingSubItem?.inspectionStatus || 'Chưa nghiệm thu');
                  if (normalizedInspection === 'Đạt nghiệm thu' && normalizedStatus !== 'Đã hoàn thành') {
                    normalizedInspection = 'Chưa nghiệm thu';
                    normalizedInspectionCount++;
                  }

                  const resolvedAssignedTeam = teamLink.assignedTeam || existingSubItem?.assignedTeam;
                  const resolvedTeamId = teamLink.teamId || (teamLink.assignedTeam ? undefined : existingSubItem?.teamId);
                  if (!String(resolvedAssignedTeam || '').trim() && !String(resolvedTeamId || '').trim()) {
                    missingTeamWarningCount++;
                  }

                  return {
                    ...(existingSubItem || {}),
                    id: existingSubItem?.id || rawSubItemId || createEntityId('sub-custom'),
                    name: itemName,
                    category: categoryLink.name || existingSubItem?.category,
                    workCategoryId: categoryLink.id || (categoryLink.name ? undefined : existingSubItem?.workCategoryId),
                    status: normalizedStatus,
                    inspectionStatus: normalizedInspection,
                    targetDate: rawTargetDate || existingSubItem?.targetDate,
                    assignedTeam: resolvedAssignedTeam,
                    teamId: resolvedTeamId,
                    workVolume: hasExcelValue(rawVolume) ? parseExcelNumber(rawVolume) : existingSubItem?.workVolume,
                    volumeUnit: rawUnit || existingSubItem?.volumeUnit,
                    progressWeight: hasExcelValue(rawWeight) ? parseExcelNumber(rawWeight) : existingSubItem?.progressWeight,
                  };
"""
text = replace_once(text, old, new, 'FloorPlanDefectTab detail normalization')

old = """          `• Đã cập nhật/chỉnh sửa: ${updatedCount} phòng/căn\\n` +
          `• Đã tạo mới/thêm mới: ${importedCount} phòng/căn`
"""
new = """          `• Đã cập nhật/chỉnh sửa: ${updatedCount} phòng/căn\\n` +
          `• Đã tạo mới/thêm mới: ${importedCount} phòng/căn\\n` +
          `• Tự sửa nghiệm thu không hợp lệ: ${normalizedInspectionCount} trường hợp\\n` +
          `• Hạng mục vẫn chưa gán đội: ${missingTeamWarningCount} dòng`
"""
text = replace_once(text, old, new, 'FloorPlanDefectTab import summary')

FLOOR_TAB.write_text(text, encoding='utf-8')


# ---------------------------------------------------------------------------
# 3) Golden source gate for the invariants introduced above.
# ---------------------------------------------------------------------------
GOLDEN.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';

const modal = fs.readFileSync('src/components/RoomHighlightModal.tsx', 'utf8');
const floor = fs.readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');

assert.match(modal, /const applyProgressPatch = \(item: RoomSubItem, patch: Partial<RoomSubItem>\)/, 'Room modal must centralize progress/inspection invariant');
assert.match(modal, /next\.inspectionStatus === 'Đạt nghiệm thu' && next\.status !== 'Đã hoàn thành'/, 'Passed inspection must require completed construction');
assert.match(modal, /applyProgressPatch\(s, \{ status: st \}\)/, 'Bulk progress update must use invariant helper');
assert.match(modal, /applyProgressPatch\(s, \{ inspectionStatus: st \}\)/, 'Bulk inspection update must use invariant helper');
assert.match(modal, /contradictorySubItems = subItems\.filter/, 'Save must reject legacy contradictory sub-items');

assert.match(floor, /XLSX\.utils\.book_append_sheet\(wb, issueSheet, 'Kiem_Tra'\)/, 'Excel export must include Kiem_Tra sheet');
assert.match(floor, /Chưa gán đội thi công cho hạng mục/, 'Excel export must flag missing teams');
assert.match(floor, /Nghiệm thu = “Đạt nghiệm thu” nhưng Tiến độ/, 'Excel export must flag contradictory inspection state');
assert.match(floor, /preflightConflictCount/, 'Excel import must preflight contradictory inspection state');
assert.match(floor, /preflightMissingTeamRows/, 'Excel import must preflight rows without teams');
assert.match(floor, /normalizedInspectionCount\+\+/, 'Excel import must normalize contradictory inspection state');
assert.match(floor, /normalizedInspection = 'Chưa nghiệm thu'/, 'Excel import must reopen inspection for unfinished work');
assert.match(floor, /missingTeamWarningCount\+\+/, 'Excel import must report unresolved team rows');

console.log('Room Progress Consistency Golden: PASS');
''', encoding='utf-8')
