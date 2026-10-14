import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCrewReportMatrices, buildCrewReportRows, getCrewReportPresetRange, listCrewReportDates } from '../src/utils/crewReportUtils';

const projects = [{
  projectId: 'p1',
  projectName: 'Dự án test',
  teams: [{ id: 'team-a', name: 'Đội An', leader: 'An', defaultCount: 0 }],
  floorPlans: [
    { id: 'f1', floorName: 'Tầng 1', structureGroupId: 'g1', imageUrl: '', uploadedAt: '' },
    { id: 'f2', floorName: 'Tầng 1', structureGroupId: 'g2', imageUrl: '', uploadedAt: '' },
  ],
  structureConfig: {
    enabled: true,
    label: 'Tháp',
    groups: [
      { id: 'g1', name: 'Tháp 1', order: 0 },
      { id: 'g2', name: 'Tháp 2', order: 1 },
    ],
    defaultGroupId: 'g1',
  },
  records: [
    { id: 'r1', date: '2026-09-24', teamId: 'team-a', teamName: 'Đội An', leaderName: 'An', workerCount: 8, morningCount: 8, afternoonCount: 6, eveningCount: 0, floorId: 'f1', floorName: 'Tầng 1', structureGroupId: 'g2', taskDescription: 'Thi công' },
    { id: 'r2', date: '2026-09-24', teamId: 'team-a', teamName: 'Đội An', leaderName: 'An', workerCount: 5, morningCount: 5, afternoonCount: 5, eveningCount: 0, floorId: 'f2', floorName: 'Tầng 1', taskDescription: 'Thi công' },
  ],
}] as any;

const rows = buildCrewReportRows(projects, '2026-09-24', '2026-09-24');
const reported = rows.filter((row) => row.reported);
assert.equal(reported.length, 2, 'same team in two Khu/Khối must remain two report columns');
assert.deepEqual(reported.map((row) => row.structureGroupName), ['Tháp 1', 'Tháp 2']);
assert.equal(reported.find((row) => row.structureGroupId === 'g1')?.dailyHeadcount, 8, 'floor linkage must override stale record.structureGroupId');
assert.equal(reported.find((row) => row.structureGroupId === 'g2')?.dailyHeadcount, 5);

const matrix = buildCrewReportMatrices(rows)[0];
assert.equal(matrix.groups.length, 2);
assert.equal(matrix.groups[0].structureGroupName, 'Tháp 1');
assert.equal(matrix.groups[1].structureGroupName, 'Tháp 2');
assert.equal(matrix.dates[0].totalDailyHeadcount, 13, 'daily total must sum group-scoped team headcounts once');

// P1 legacy: name-only crew records must not be assigned to a random team ID
// when multiple active teams have the same normalized display name.
const duplicateNameRows = buildCrewReportRows([{
  projectId: 'p-legacy', projectName: 'Legacy đội trùng tên',
  teams: [
    { id: 'TEAM-1', name: 'Đội An', leader: 'An' },
    { id: 'TEAM-2', name: ' đội an ', leader: 'Bình' },
  ],
  records: [
    { id: 'legacy-name-only', date: '2026-09-24', teamName: 'Đội An', workerCount: 7, morningCount: 7, afternoonCount: 5, eveningCount: 0 },
    { id: 'durable-id', date: '2026-09-24', teamId: 'TEAM-2', teamName: 'Đội An', workerCount: 3, morningCount: 3, afternoonCount: 3, eveningCount: 0 },
  ],
}] as any, '2026-09-24', '2026-09-24');
assert.equal(duplicateNameRows.filter((row) => row.reported).length, 2, 'name-only and durable-id logs must remain distinct');
assert.equal(duplicateNameRows.find((row) => row.reported && !row.teamId)?.dailyHeadcount, 7, 'ambiguous legacy record headcount must be preserved');
assert.ok(duplicateNameRows.find((row) => row.reported && !row.teamId)?.teamName.includes('chưa xác định đội'), 'ambiguous name-only log must be visible as unresolved');
assert.equal(duplicateNameRows.find((row) => row.teamId === 'TEAM-2')?.dailyHeadcount, 3, 'authoritative ID must still win');
assert.equal(duplicateNameRows.find((row) => row.teamId === 'TEAM-1')?.reported, false, 'legacy log cannot be fabricated for TEAM-1');
assert.equal(duplicateNameRows.filter((row) => row.reported).reduce((sum, row) => sum + (row.dailyHeadcount || 0), 0), 10, 'P1 headcount may not be lost or duplicated');
const uniqueNameRows = buildCrewReportRows([{
  projectId: 'p-unique', projectName: 'Legacy duy nhất', teams: [{ id: 'TEAM-1', name: 'Đội An' }],
  records: [{ id: 'legacy', date: '2026-09-24', teamName: 'Đội An', workerCount: 4, morningCount: 4 }],
}] as any, '2026-09-24', '2026-09-24');
assert.equal(uniqueNameRows.find((row) => row.reported)?.teamId, 'TEAM-1', 'unique legacy name should still map to its team');
console.log('PASS P1: duplicate team names never reassign legacy crew logs');

// The Home dashboard and Crew share modal must agree on local-calendar presets,
// including cross-month/year and leap-year days (no UTC date drift).
const reference = new Date(2026, 9, 14, 12);
assert.deepEqual(getCrewReportPresetRange('today', reference), { startDate: '2026-10-14', endDate: '2026-10-14' });
assert.deepEqual(getCrewReportPresetRange('yesterday', reference), { startDate: '2026-10-13', endDate: '2026-10-13' });
assert.deepEqual(getCrewReportPresetRange('7days', reference), { startDate: '2026-10-08', endDate: '2026-10-14' });
assert.deepEqual(getCrewReportPresetRange('month', reference), { startDate: '2026-10-01', endDate: '2026-10-14' });
assert.deepEqual(getCrewReportPresetRange('7days', new Date(2026, 0, 3, 12)), { startDate: '2025-12-28', endDate: '2026-01-03' });
assert.deepEqual(getCrewReportPresetRange('month', new Date(2024, 1, 29, 12)), { startDate: '2024-02-01', endDate: '2024-02-29' });
const sevenDayPreset = getCrewReportPresetRange('7days', reference);
assert.equal(listCrewReportDates(sevenDayPreset.startDate, sevenDayPreset.endDate).length, 7);

// Source-level UI regression guards: sharing must stay on one image per project matrix,
// the total row must use the same X-origin as header/body, and the duplicated overview
// must remain hidden on mobile/tablet while staying available on desktop/EXE.
const shareModalSource = readFileSync(new URL('../src/components/CrewReportShareModal.tsx', import.meta.url), 'utf8');
assert.equal(shareModalSource.includes('TEAM_CHUNK'), false, 'crew share must not split one project every four teams');
assert.ok(
  shareModalSource.includes('const [hideUnreportedTeams, setHideUnreportedTeams] = useState(false);')
  && shareModalSource.includes('const [hideZeroTeams, setHideZeroTeams] = useState(false);')
  && shareModalSource.includes('const [hideUnreportedDates, setHideUnreportedDates] = useState(false);')
  && shareModalSource.includes('const [hideZeroDates, setHideZeroDates] = useState(false);'),
  'crew report hide filters must default to OFF so opening a report never hides data implicitly',
);
assert.ok(
  shareModalSource.includes('Ẩn đội chưa báo')
  && shareModalSource.includes('Ẩn đội quân số = 0')
  && shareModalSource.includes('Ẩn ngày chưa báo')
  && shareModalSource.includes('Ẩn ngày quân số = 0'),
  'crew report must expose explicit hide-team and hide-date options',
);
assert.ok(
  shareModalSource.includes('if (hideUnreportedTeams && stat.reported === 0) return false;')
  && shareModalSource.includes('if (hideZeroTeams && stat.reported > 0 && stat.headcount === 0) return false;'),
  'team filters must distinguish never-reported teams from reported-zero teams',
);
assert.ok(
  shareModalSource.includes('if (hideUnreportedDates && stat.reported === 0) return false;')
  && shareModalSource.includes('if (hideZeroDates && stat.reported > 0 && stat.headcount === 0) return false;'),
  'date filters must distinguish unreported dates from reported-zero dates',
);
assert.ok(
  shareModalSource.includes('const x = teamStartX + teamIndex * teamWidth + metricIndex * metricWidth;'),
  'crew share total row must align from teamStartX',
);
assert.ok(
  shareModalSource.includes('dateX + (dateWidth - dateHeaderWidth) / 2')
  && shareModalSource.includes('min-w-[118px] border-r border-slate-200 bg-blue-50 px-3 py-2 text-center align-middle">Ngày</th>')
  && shareModalSource.includes('dateX + (dateWidth - ctx.measureText(dateText).width) / 2')
  && shareModalSource.includes('text-slate-700 ${dateIndex % 2 === 0 ?')
  && shareModalSource.includes('>{formatDateDDMMYYYY(dateRow.date)}</td>')
  && shareModalSource.includes('dateX + (dateWidth - ctx.measureText(totalLabel).width) / 2'),
  'crew report date column must stay centered for header, body values and total label in both canvas export and on-screen table',
);
assert.ok(
  shareModalSource.includes("const serialHeaderText = 'STT';")
  && shareModalSource.includes('tableLeft + (serialWidth - serialHeaderWidth) / 2'),
  'crew report STT header must stay horizontally centered in shared-image canvas like the on-screen table',
);
assert.ok(
  shareModalSource.includes('const serialText = String(rowIndex + 1);')
  && shareModalSource.includes('tableLeft + (serialWidth - ctx.measureText(serialText).width) / 2'),
  'crew report STT body values must stay horizontally centered in exported images',
);
// Android APK regression: both entry points share the exact export component.
// Canvas data: anchor downloads are unreliable in WebView, so route PNG through
// the existing chunked native exporter and preserve browser/desktop fallback.
const homeSource = readFileSync(new URL('../src/components/HomeDashboard.tsx', import.meta.url), 'utf8');
const exportSource = readFileSync(new URL('../src/utils/fileExport.ts', import.meta.url), 'utf8');
const androidSource = readFileSync(new URL('../android-wrapper/src/com/qlct/app/MainActivity.java', import.meta.url), 'utf8');
assert.ok(homeSource.includes('<CrewReportShareModal'), 'Trang chủ must use the shared crew report modal');

assert.ok(homeSource.includes('getCrewReportPresetRange(preset)')
  && shareModalSource.includes('getCrewReportPresetRange(preset)'),
  'Trang chủ and Quân số share modal must use the same quick date range resolver');
for (const label of ['Hôm nay', 'Hôm qua', '7 ngày', 'Tháng này', 'Khoảng ngày']) {
  assert.ok(shareModalSource.includes(label), `Crew modal must offer ${label}`);
}
assert.ok(shareModalSource.includes('!rangeLocked && (')
  && shareModalSource.includes("setMode(range.startDate === range.endDate ? 'single' : 'range')")
  && shareModalSource.includes("setDatePreset('custom')")
  && shareModalSource.includes('datePreset === preset')
  && shareModalSource.includes('getCrewReportPresetRange(preset).endDate > resolvedMaxDate'),
  'Preset buttons must respect locked Home range, manual edits, active state and maxDate');

assert.ok(shareModalSource.includes('isAndroidExportBridgeAvailable()')
  && shareModalSource.includes("await saveBlobToDownloads(new Blob([bytes], { type: 'image/png' }), fileName, 'image/png')")
  && shareModalSource.includes('await downloadDataUrl(attachment.dataUrl, attachment.fileName)')
  && shareModalSource.includes('let savedCount = 0;')
  && shareModalSource.includes('Đã lưu ${savedCount} ảnh báo cáo vào Tải xuống/QLTC'),
  'APK crew report Tải ảnh must save PNGs sequentially via native Download/QLTC and only show completion after save',
);
assert.ok(shareModalSource.includes("const link = document.createElement('a');")
  && shareModalSource.includes('Đã yêu cầu trình duyệt tải 1 ảnh.'),
  'Web/Windows crew image downloads must preserve their browser download fallback',
);
assert.ok(exportSource.includes('export async function saveBlobToDownloads')
  && exportSource.includes('bridge.finishBase64File(sessionId)')
  && androidSource.includes('saveFileToDownloads(export.fileName, export.mimeType, export.tempFile)'),
  'APK crew reports must reuse the native chunked MediaStore writer rather than data: link taps',
);
const crewTabSource = readFileSync(new URL('../src/components/CrewTabBase.tsx', import.meta.url), 'utf8');
assert.ok(crewTabSource.includes('<CrewReportShareModal'),
  'Mục Quân số must use the shared crew report modal');
assert.ok(
  crewTabSource.includes('className="hidden 2xl:grid 2xl:grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50/70 p-3"'),
  'team detail duplicate overview must stay hidden on ordinary laptop/EXE widths',
);
assert.equal(
  crewTabSource.includes('<strong>Đối chiếu:</strong> Định mức theo KL đã thi công'),
  false,
  'team material detail should not render the long reconciliation explainer card',
);
assert.ok(
  crewTabSource.indexOf('<span>Danh sách Defect ({teamDefects.length})</span>') <
    crewTabSource.indexOf('<span>Vật tư đối chiếu ({selectedTeamMaterialReconciliation.length})</span>'),
  'team detail tabs must order Defect before Vật tư đối chiếu',
);

console.log('crew-report-structure-golden: PASS');
