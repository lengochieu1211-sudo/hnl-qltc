from pathlib import Path

path = Path('src/components/FloorPlanDefectTab.tsx')
text = path.read_text(encoding='utf-8')

# Replace the old room-only Excel exporter with a multi-sheet workbook that
# preserves room metadata, every construction sub-item and the team catalog.
func_start = text.find('  const downloadHighlightTemplate = () => {')
if func_start < 0:
    raise SystemExit('downloadHighlightTemplate start not found')
func_end_marker = '\n\n\n  // Handle uploaded excel to import Room Highlights'
func_end = text.find(func_end_marker, func_start)
if func_end < 0:
    raise SystemExit('downloadHighlightTemplate end marker not found')

new_export = r'''  const downloadHighlightTemplate = () => {
    const wb = XLSX.utils.book_new();
    const roomsToExport = floorRooms;
    const teamNameById = new Map(
      teams
        .filter((team) => team.id && team.name?.trim())
        .map((team) => [team.id, team.name.trim()] as const)
    );
    const resolveExcelTeamName = (teamId?: string, assignedTeam?: string) =>
      (teamId ? teamNameById.get(teamId) : undefined) || assignedTeam?.trim() || '';

    const roomHeaders = [
      'STT', '__recordId', 'Tên Căn / Phòng',
      'Hạng Mục Thi Công Chính', '__workCategoryId',
      'Đội Thi Công Căn / Phòng', '__teamId',
      'Khối Lượng Căn / Phòng', 'Đơn Vị Căn / Phòng',
      'Tọa độ X (%)', 'Tọa độ Y (%)', 'Chiều Rộng W (%)', 'Chiều Cao H (%)',
      'Trạng Thái Khung Xương', 'Trạng Thái Bắn Tấm',
      'Nghiệm Thu Khung', 'Nghiệm Thu Tấm', 'Kỹ sư phụ trách', 'Ghi Chú'
    ];
    const roomData = roomsToExport.map((r, index) => ({
      'STT': index + 1,
      '__recordId': r.id || '',
      'Tên Căn / Phòng': r.roomName,
      'Hạng Mục Thi Công Chính': r.workCategory || '',
      '__workCategoryId': r.workCategoryId || '',
      'Đội Thi Công Căn / Phòng': resolveExcelTeamName(r.teamId, r.assignedTeam),
      '__teamId': r.teamId || '',
      'Khối Lượng Căn / Phòng': r.workVolume ?? '',
      'Đơn Vị Căn / Phòng': r.volumeUnit || '',
      'Tọa độ X (%)': r.x,
      'Tọa độ Y (%)': r.y,
      'Chiều Rộng W (%)': r.width,
      'Chiều Cao H (%)': r.height,
      'Trạng Thái Khung Xương': r.frameStatus,
      'Trạng Thái Bắn Tấm': r.boardStatus,
      'Nghiệm Thu Khung': r.frameInspectionStatus,
      'Nghiệm Thu Tấm': r.boardInspectionStatus,
      'Kỹ sư phụ trách': r.inspectorName,
      'Ghi Chú': r.notes || ''
    }));
    const roomSheet = XLSX.utils.json_to_sheet(roomData, { header: roomHeaders });
    XLSX.utils.book_append_sheet(wb, roomSheet, 'Can_Phong');

    const subItemHeaders = [
      'STT', '__recordId', 'Tên Căn / Phòng', '__subItemId',
      'Hạng Mục Thi Công', '__workCategoryId', 'Công Đoạn / Nội Dung',
      'Trạng Thái Thi Công', 'Nghiệm Thu Hạng Mục', 'Hạn Hoàn Thành',
      'Đội Thi Công', '__teamId', 'Khối Lượng', 'Đơn Vị', 'Trọng Số Tiến Độ'
    ];
    const subItemData = roomsToExport.flatMap((room, roomIndex) =>
      (room.subItems || []).map((subItem, subIndex) => ({
        'STT': `${roomIndex + 1}.${subIndex + 1}`,
        '__recordId': room.id || '',
        'Tên Căn / Phòng': room.roomName,
        '__subItemId': subItem.id || '',
        'Hạng Mục Thi Công': subItem.category || room.workCategory || '',
        '__workCategoryId': subItem.workCategoryId || room.workCategoryId || '',
        'Công Đoạn / Nội Dung': subItem.name,
        'Trạng Thái Thi Công': subItem.status,
        'Nghiệm Thu Hạng Mục': subItem.inspectionStatus || 'Chưa nghiệm thu',
        'Hạn Hoàn Thành': subItem.targetDate || '',
        'Đội Thi Công': resolveExcelTeamName(subItem.teamId, subItem.assignedTeam),
        '__teamId': subItem.teamId || '',
        'Khối Lượng': subItem.workVolume ?? '',
        'Đơn Vị': subItem.volumeUnit || '',
        'Trọng Số Tiến Độ': subItem.progressWeight ?? ''
      }))
    );
    const subItemSheet = XLSX.utils.json_to_sheet(subItemData, { header: subItemHeaders });
    XLSX.utils.book_append_sheet(wb, subItemSheet, 'Hang_Muc_Thi_Cong');

    const teamHeaders = ['__teamId', 'Tên Đội', 'Đội Trưởng', 'Điện Thoại', 'Ghi Chú'];
    const teamData = teams.map((team) => ({
      '__teamId': team.id || '',
      'Tên Đội': team.name || '',
      'Đội Trưởng': team.leader || '',
      'Điện Thoại': team.phone || '',
      'Ghi Chú': team.notes || ''
    }));
    const teamSheet = XLSX.utils.json_to_sheet(teamData, { header: teamHeaders });
    XLSX.utils.book_append_sheet(wb, teamSheet, 'Danh_Muc_Doi');

    const guideSheet = XLSX.utils.aoa_to_sheet([
      ['HNL QLTC - Mẫu Excel Nghiệm thu Căn / Phòng'],
      ['1', 'Sheet Can_Phong: chỉnh thông tin cấp Căn / Phòng.'],
      ['2', 'Sheet Hang_Muc_Thi_Cong: mỗi dòng là một hạng mục/công đoạn của đúng Căn / Phòng.'],
      ['3', 'Có thể đổi Trạng thái, Nghiệm thu, Hạn hoàn thành, Đội thi công, Khối lượng và Đơn vị rồi Nhập Excel lại.'],
      ['4', 'Giữ nguyên các cột kỹ thuật __recordId, __subItemId, __teamId, __workCategoryId khi chỉ chỉnh dữ liệu hiện có.'],
      ['5', 'Sheet Danh_Muc_Doi chỉ để tham chiếu đội đã khai báo; nhập lại sẽ liên kết theo __teamId hoặc tên đội trùng khớp.']
    ]);
    XLSX.utils.book_append_sheet(wb, guideSheet, 'Huong_Dan');

    return saveWorkbookFile(
      wb,
      `Danh_Sach_Phong_${activeFloor ? activeFloor.floorName.replace(/\s+/g, '_') : 'MatBang'}.xlsx`
    );
  };'''
text = text[:func_start] + new_export + text[func_end:]

# Read the detailed work-item sheet when present while retaining compatibility
# with legacy room-only files (first sheet fallback).
old_read = """        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);
"""
new_read = """        const workbook = XLSX.read(data, { type: 'array' });
        const normalizeSheetName = (name: string) => name.trim().toLocaleLowerCase('vi-VN').replace(/\\s+/g, '_');
        const roomSheetName = workbook.SheetNames.find((name) => {
          const normalized = normalizeSheetName(name);
          return normalized === 'can_phong' || normalized === 'căn_phòng';
        }) || workbook.SheetNames[0];
        const worksheet = workbook.Sheets[roomSheetName];
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);
        const detailSheetName = workbook.SheetNames.find((name) => {
          const normalized = normalizeSheetName(name);
          return normalized === 'hang_muc_thi_cong' || normalized === 'hạng_mục_thi_công';
        });
        const detailJsonData = detailSheetName
          ? XLSX.utils.sheet_to_json<any>(workbook.Sheets[detailSheetName])
          : [];
"""
if text.count(old_read) != 1:
    raise SystemExit(f'Expected one workbook read block, got {text.count(old_read)}')
text = text.replace(old_read, new_read, 1)

helper_anchor = """        let importedCount = 0;
        let updatedCount = 0;
        const processedRoomIds = new Set<string>();
"""
helper_block = """        const excelTeamById = new Map(teams.filter((team) => team.id).map((team) => [team.id, team] as const));
        const excelTeamByName = new Map(
          teams
            .filter((team) => team.name?.trim())
            .map((team) => [team.name.trim().toLocaleLowerCase('vi-VN'), team] as const)
        );
        const resolveExcelTeamLink = (rawId: unknown, rawName: unknown) => {
          const id = String(rawId ?? '').trim();
          const name = String(rawName ?? '').trim();
          const byId = id ? excelTeamById.get(id) : undefined;
          if (byId) return { teamId: byId.id, assignedTeam: byId.name.trim() };
          const byName = name ? excelTeamByName.get(name.toLocaleLowerCase('vi-VN')) : undefined;
          if (byName) return { teamId: byName.id, assignedTeam: byName.name.trim() };
          return { teamId: undefined as string | undefined, assignedTeam: name };
        };
        const excelCategoryById = new Map<string, { id: string; name: string }>();
        const excelCategoryByName = new Map<string, { id: string; name: string }>();
        workVolumes.forEach((item) => {
          const name = String(item.title || '').trim();
          if (!name) return;
          const canonicalId = String(item.workCategoryId || item.id || '').trim();
          const entry = { id: canonicalId, name };
          if (canonicalId) excelCategoryById.set(canonicalId, entry);
          if (item.id) excelCategoryById.set(String(item.id), entry);
          if (item.workCategoryId) excelCategoryById.set(String(item.workCategoryId), entry);
          excelCategoryByName.set(name.toLocaleLowerCase('vi-VN'), entry);
        });
        const resolveExcelCategory = (rawId: unknown, rawName: unknown) => {
          const id = String(rawId ?? '').trim();
          const name = String(rawName ?? '').trim();
          const byId = id ? excelCategoryById.get(id) : undefined;
          if (byId) return byId;
          const byName = name ? excelCategoryByName.get(name.toLocaleLowerCase('vi-VN')) : undefined;
          if (byName) return byName;
          return { id, name };
        };
        const hasExcelValue = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== '';

        let importedCount = 0;
        let updatedCount = 0;
        const processedRoomIds = new Set<string>();
"""
if text.count(helper_anchor) != 1:
    raise SystemExit(f'Expected one import counter anchor, got {text.count(helper_anchor)}')
text = text.replace(helper_anchor, helper_block, 1)

detail_anchor = """          const targetId = existingId || createEntityId('ROOM');
          processedRoomIds.add(targetId);
          const safeX = Math.min(95, Math.max(0, rawX));
"""
detail_block = """          const targetId = existingId || createEntityId('ROOM');
          processedRoomIds.add(targetId);

          const roomTeamRaw = row['Đội Thi Công Căn / Phòng'] ?? row['assignedTeam'] ?? '';
          const roomTeamIdRaw = row['__teamId'] ?? row['teamId'] ?? '';
          const roomTeamLink = resolveExcelTeamLink(roomTeamIdRaw, roomTeamRaw);
          const roomCategoryRaw = row['Hạng Mục Thi Công Chính'] ?? row['workCategory'] ?? '';
          const roomCategoryIdRaw = row['__workCategoryId'] ?? row['workCategoryId'] ?? '';
          const roomCategoryLink = resolveExcelCategory(roomCategoryIdRaw, roomCategoryRaw);
          const roomVolumeRaw = row['Khối Lượng Căn / Phòng'] ?? row['workVolume'];
          const roomUnitRaw = String(row['Đơn Vị Căn / Phòng'] ?? row['volumeUnit'] ?? '').trim();

          const detailRowsForRoom = detailJsonData.filter((detailRow: any) => {
            const detailRoomId = String(detailRow['__recordId'] ?? detailRow['roomId'] ?? '').trim();
            const detailRoomName = String(detailRow['Tên Căn / Phòng'] ?? detailRow['roomName'] ?? '').trim();
            const idMatches = Boolean(detailRoomId) && [rawRecordId, existingId, targetId].filter(Boolean).includes(detailRoomId);
            const nameMatches = Boolean(detailRoomName) && detailRoomName.toLocaleLowerCase('vi-VN') === nameStr.toLocaleLowerCase('vi-VN');
            return idMatches || nameMatches;
          });

          const importedSubItems: RoomSubItem[] | undefined = detailRowsForRoom.length > 0
            ? detailRowsForRoom
                .map((detailRow: any): RoomSubItem | null => {
                  const rawSubItemId = String(detailRow['__subItemId'] ?? detailRow['subItemId'] ?? detailRow['id'] ?? '').trim();
                  const itemName = String(detailRow['Công Đoạn / Nội Dung'] ?? detailRow['name'] ?? '').trim();
                  if (!itemName) return null;
                  const existingSubItem = (existingRoomObj?.subItems || []).find((subItem: RoomSubItem) =>
                    (rawSubItemId && subItem.id === rawSubItemId) ||
                    (!rawSubItemId && subItem.name.trim().toLocaleLowerCase('vi-VN') === itemName.toLocaleLowerCase('vi-VN'))
                  );
                  const categoryLink = resolveExcelCategory(
                    detailRow['__workCategoryId'] ?? detailRow['workCategoryId'] ?? existingSubItem?.workCategoryId,
                    detailRow['Hạng Mục Thi Công'] ?? detailRow['category'] ?? existingSubItem?.category ?? existingRoomObj?.workCategory
                  );
                  const teamLink = resolveExcelTeamLink(
                    detailRow['__teamId'] ?? detailRow['teamId'] ?? '',
                    detailRow['Đội Thi Công'] ?? detailRow['assignedTeam'] ?? ''
                  );
                  const rawStatus = String(detailRow['Trạng Thái Thi Công'] ?? detailRow['status'] ?? '').trim();
                  const rawInspection = String(detailRow['Nghiệm Thu Hạng Mục'] ?? detailRow['inspectionStatus'] ?? '').trim();
                  const rawTargetDate = String(detailRow['Hạn Hoàn Thành'] ?? detailRow['targetDate'] ?? '').trim();
                  const rawVolume = detailRow['Khối Lượng'] ?? detailRow['workVolume'];
                  const rawUnit = String(detailRow['Đơn Vị'] ?? detailRow['volumeUnit'] ?? '').trim();
                  const rawWeight = detailRow['Trọng Số Tiến Độ'] ?? detailRow['progressWeight'];

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
                })
                .filter((subItem: RoomSubItem | null): subItem is RoomSubItem => Boolean(subItem))
            : existingRoomObj?.subItems;

          const safeX = Math.min(95, Math.max(0, rawX));
"""
if text.count(detail_anchor) != 1:
    raise SystemExit(f'Expected one targetId anchor, got {text.count(detail_anchor)}')
text = text.replace(detail_anchor, detail_block, 1)

save_anchor = """            inspectionStatus: overall,
            inspectorName: inspector,
            notes: noteText
          });
"""
save_block = """            inspectionStatus: overall,
            inspectorName: inspector,
            notes: noteText,
            workCategory: roomCategoryLink.name || existingRoomObj?.workCategory,
            workCategoryId: roomCategoryLink.id || (roomCategoryLink.name ? undefined : existingRoomObj?.workCategoryId),
            assignedTeam: roomTeamLink.assignedTeam || existingRoomObj?.assignedTeam,
            teamId: roomTeamLink.teamId || (roomTeamLink.assignedTeam ? undefined : existingRoomObj?.teamId),
            workVolume: hasExcelValue(roomVolumeRaw) ? parseExcelNumber(roomVolumeRaw) : existingRoomObj?.workVolume,
            volumeUnit: roomUnitRaw || existingRoomObj?.volumeUnit,
            subItems: importedSubItems,
          });
"""
if text.count(save_anchor) != 1:
    raise SystemExit(f'Expected one room save anchor, got {text.count(save_anchor)}')
text = text.replace(save_anchor, save_block, 1)

path.write_text(text, encoding='utf-8')

test_path = Path('scripts/room-excel-roundtrip-golden.ts')
test_path.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/components/FloorPlanDefectTab.tsx', 'utf8');

assert.match(source, /XLSX\.utils\.book_append_sheet\(wb, roomSheet, 'Can_Phong'\)/, 'Room sheet must be exported');
assert.match(source, /XLSX\.utils\.book_append_sheet\(wb, subItemSheet, 'Hang_Muc_Thi_Cong'\)/, 'Work-item sheet must be exported');
assert.match(source, /XLSX\.utils\.book_append_sheet\(wb, teamSheet, 'Danh_Muc_Doi'\)/, 'Team catalog sheet must be exported');
assert.match(source, /'Hạng Mục Thi Công': subItem\.category \|\| room\.workCategory/, 'Work category must be exported per room sub-item');
assert.match(source, /'Công Đoạn \/ Nội Dung': subItem\.name/, 'Sub-item name must be exported');
assert.match(source, /'Đội Thi Công': resolveExcelTeamName\(subItem\.teamId, subItem\.assignedTeam\)/, 'Sub-item team must be exported with durable team linkage');
assert.match(source, /detailJsonData/, 'Detailed work-item sheet must be parsed on import');
assert.match(source, /const importedSubItems: RoomSubItem\[\] \| undefined/, 'Import must rebuild detailed room sub-items');
assert.match(source, /resolveExcelTeamLink/, 'Import must resolve teamId by ID or exact team name');
assert.match(source, /resolveExcelCategory/, 'Import must resolve workCategoryId by ID or exact active category name');
assert.match(source, /subItems: importedSubItems/, 'Imported sub-items must be persisted on the room record');
assert.match(source, /assignedTeam: roomTeamLink\.assignedTeam/, 'Room-level assigned team must be imported');
assert.match(source, /workCategory: roomCategoryLink\.name/, 'Room-level work category must be imported');
assert.match(source, /\|\| workbook\.SheetNames\[0\]/, 'Legacy room-only Excel files must remain importable');

console.log('Room Excel Round-trip Golden: PASS');
''', encoding='utf-8')
