import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, FileSpreadsheet, FileText, Image as ImageIcon, Share2, Users, X } from 'lucide-react';
import type { ShareAttachmentPayload } from '../utils/shareUtils';
import { sharePreparedContent } from '../utils/shareUtils';
import { isAndroidExportBridgeAvailable, saveBlobToDownloads } from '../utils/fileExport';
import {
  buildCrewReportRows,
  buildCrewReportMatrices,
  buildCrewReportText,
  getCrewReportPresetRange,
  type CrewReportDatePreset,
  filterCrewReportRows,
  summarizeCrewReportRows,
  type CrewReportProjectInput,
  type CrewReportRow,
} from '../utils/crewReportUtils';
import { formatDateDDMMYYYY } from '../utils/dateFormatter';

interface CrewReportShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: CrewReportProjectInput[];
  initialStartDate: string;
  initialEndDate?: string;
  maxDate?: string;
  rangeLocked?: boolean;
  title?: string;
}

const sanitizeFilePart = (value: string) => String(value || '')
  .trim()
  .replace(/[\\/:*?"<>|]+/g, '-')
  .replace(/\s+/g, '-')
  .slice(0, 80) || 'bao-cao-quan-so';

const formatCell = (value: number | null, reported: boolean) => reported ? String(value ?? 0) : 'Chưa báo';

const dateSpanDays = (startDate: string, endDate: string): number => {
  const start = new Date(`${startDate}T12:00:00`).getTime();
  const end = new Date(`${endDate}T12:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
};

const formatCrewRowDetail = (row?: CrewReportRow): string => {
  if (!row?.reported) return '';
  return [
    row.floorSummary ? `Tầng: ${row.floorSummary}` : '',
    row.workCategorySummary ? `Hạng mục: ${row.workCategorySummary}` : '',
    row.workSubItemSummary ? `HM con: ${row.workSubItemSummary}` : '',
    row.notesSummary ? `Ghi chú: ${row.notesSummary}` : '',
  ].filter(Boolean).join(' · ');
};

async function renderCrewReportImages(params: {
  rows: CrewReportRow[];
  startDate: string;
  endDate: string;
  title: string;
  showSerialNumber?: boolean;
  showWorkDetails?: boolean;
}): Promise<ShareAttachmentPayload[]> {
  if (typeof document === 'undefined') return [];
  const matrices = buildCrewReportMatrices(params.rows);
  // Share one compact image per project matrix. Do not split a project's teams into multiple images;
  // this keeps the report continuous and easier to read/share on phones.
  const pageSpecs: Array<{
    matrix: ReturnType<typeof buildCrewReportMatrices>[number];
    teams: ReturnType<typeof buildCrewReportMatrices>[number]['teams'];
    dates: ReturnType<typeof buildCrewReportMatrices>[number]['dates'];
  }> = matrices.map((matrix) => ({
    matrix,
    teams: matrix.teams,
    dates: matrix.dates.length > 0 ? matrix.dates : [],
  }));

  const attachments: ShareAttachmentPayload[] = [];
  for (let pageIndex = 0; pageIndex < pageSpecs.length; pageIndex += 1) {
    const { matrix, teams, dates } = pageSpecs[pageIndex];
    const teamKeySet = new Set(teams.map((team) => team.teamKey));
    const visibleGroups = matrix.groups
      .map((group) => ({ ...group, teams: group.teams.filter((team) => teamKeySet.has(team.teamKey)) }))
      .filter((group) => group.teams.length > 0);

    const left = 30;
    const right = 30;
    const serialWidth = params.showSerialNumber ? 46 : 0;
    const dateWidth = 132;
    const totalWidth = 100;
    const detailWidth = params.showWorkDetails ? 300 : 0;
    const baseMetricWidth = teams.length >= 8 ? 48 : teams.length >= 5 ? 54 : 62;
    const minimumTableWidth = 800;
    const fixedColumnsWidth = serialWidth + dateWidth + totalWidth + detailWidth;
    // A short report should fill the image rather than leave a large blank right margin.
    // Keep the normal minimum metric width for reports with many teams.
    const metricWidth = Math.max(baseMetricWidth, Math.ceil((minimumTableWidth - fixedColumnsWidth) / (Math.max(1, teams.length) * 4)));
    const teamWidth = metricWidth * 4;
    const tableWidth = serialWidth + dateWidth + Math.max(1, teams.length) * teamWidth + totalWidth + detailWidth;
    const width = Math.max(860, left + tableWidth + right);
    const headerHeight = matrix.projectLocation ? 180 : 154;
    const groupHeaderHeight = 36;
    const teamHeaderHeight = 42;
    const subHeaderHeight = 38;
    const totalHeaderHeight = groupHeaderHeight + teamHeaderHeight + subHeaderHeight;
    const rowHeight = 44;
    const footerHeight = 62;
    const height = headerHeight + totalHeaderHeight + (Math.max(1, dates.length) + 1) * rowHeight + footerHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 31px Arial, sans-serif';
    ctx.fillText(`${params.title} – ${matrix.projectName}`, left, 52);
    ctx.font = '600 18px Arial, sans-serif';
    ctx.fillStyle = '#334155';
    const rangeText = params.startDate === params.endDate
      ? `Ngày ${formatDateDDMMYYYY(params.startDate)}`
      : `Từ ${formatDateDDMMYYYY(params.startDate)} đến ${formatDateDDMMYYYY(params.endDate)}`;
    ctx.fillText(rangeText, left, 88);
    let nextY = 118;
    if (matrix.projectLocation) {
      ctx.font = '500 17px Arial, sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText(`Địa điểm: ${matrix.projectLocation}`, left, nextY);
      nextY += 28;
    }
    ctx.font = '500 15px Arial, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(`Trang ${pageIndex + 1}/${pageSpecs.length}`, width - right - 92, 52);
    ctx.fillStyle = '#dbeafe';
    ctx.fillRect(left, headerHeight - 10, width - left - right, 2);

    const tableTop = headerHeight;
    const tableLeft = left;
    ctx.fillStyle = '#eff6ff';
    ctx.fillRect(tableLeft, tableTop, tableWidth, totalHeaderHeight);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;

    ctx.fillStyle = '#334155';
    ctx.font = '700 15px Arial, sans-serif';
    if (params.showSerialNumber) {
      ctx.strokeRect(tableLeft, tableTop, serialWidth, totalHeaderHeight);
      const serialHeaderText = 'STT';
      const serialHeaderWidth = ctx.measureText(serialHeaderText).width;
      ctx.fillText(serialHeaderText, tableLeft + (serialWidth - serialHeaderWidth) / 2, tableTop + Math.round(totalHeaderHeight / 2) + 5);
    }
    const dateX = tableLeft + serialWidth;
    ctx.strokeRect(dateX, tableTop, dateWidth, totalHeaderHeight);
    const dateHeaderText = 'Ngày';
    const dateHeaderWidth = ctx.measureText(dateHeaderText).width;
    ctx.fillText(dateHeaderText, dateX + (dateWidth - dateHeaderWidth) / 2, tableTop + Math.round(totalHeaderHeight / 2) + 5);
    const teamStartX = dateX + dateWidth;

    let teamOffset = 0;
    visibleGroups.forEach((group) => {
      const x = teamStartX + teamOffset * teamWidth;
      const spanWidth = group.teams.length * teamWidth;
      ctx.fillStyle = '#eff6ff';
      ctx.fillRect(x, tableTop, spanWidth, groupHeaderHeight);
      ctx.strokeStyle = '#bfdbfe';
      ctx.strokeRect(x, tableTop, spanWidth, groupHeaderHeight);
      ctx.font = '700 14px Arial, sans-serif';
      ctx.fillStyle = '#1d4ed8';
      const groupName = group.structureGroupName.length > 34 ? `${group.structureGroupName.slice(0, 33)}…` : group.structureGroupName;
      const gw = ctx.measureText(groupName).width;
      ctx.fillText(groupName, x + Math.max(8, (spanWidth - gw) / 2), tableTop + 23);
      teamOffset += group.teams.length;
    });

    teams.forEach((team, teamIndex) => {
      const x = teamStartX + teamIndex * teamWidth;
      const teamTop = tableTop + groupHeaderHeight;
      ctx.strokeStyle = '#cbd5e1';
      ctx.strokeRect(x, teamTop, teamWidth, teamHeaderHeight + subHeaderHeight);
      ctx.font = '700 15px Arial, sans-serif';
      ctx.fillStyle = '#334155';
      const name = team.teamName.length > 24 ? `${team.teamName.slice(0, 23)}…` : team.teamName;
      const textWidth = ctx.measureText(name).width;
      ctx.fillText(name, x + Math.max(8, (teamWidth - textWidth) / 2), teamTop + 27);
      ['Sáng', 'Chiều', 'Tối', 'QS ngày'].forEach((label, metricIndex) => {
        const mx = x + metricIndex * metricWidth;
        const metricTop = teamTop + teamHeaderHeight;
        ctx.strokeRect(mx, metricTop, metricWidth, subHeaderHeight);
        ctx.font = '600 12px Arial, sans-serif';
        const w = ctx.measureText(label).width;
        ctx.fillText(label, mx + (metricWidth - w) / 2, metricTop + 24);
      });
    });

    const totalX = teamStartX + teams.length * teamWidth;
    ctx.fillStyle = '#eff6ff';
    ctx.fillRect(totalX, tableTop, totalWidth, totalHeaderHeight);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(totalX, tableTop, totalWidth, totalHeaderHeight);
    ctx.fillStyle = '#1e40af';
    ctx.font = '700 13px Arial, sans-serif';
    ctx.fillText('Tổng', totalX + 42, tableTop + Math.round(totalHeaderHeight / 2) - 4);
    ctx.fillText('QS/ngày', totalX + 31, tableTop + Math.round(totalHeaderHeight / 2) + 19);
    const detailX = totalX + totalWidth;
    if (params.showWorkDetails) {
      ctx.fillStyle = '#eff6ff';
      ctx.fillRect(detailX, tableTop, detailWidth, totalHeaderHeight);
      ctx.strokeStyle = '#cbd5e1';
      ctx.strokeRect(detailX, tableTop, detailWidth, totalHeaderHeight);
      ctx.fillStyle = '#334155';
      ctx.font = '700 13px Arial, sans-serif';
      ctx.fillText('Tầng / Hạng mục / HM con / Ghi chú', detailX + 12, tableTop + Math.round(totalHeaderHeight / 2) + 5);
    }

    dates.forEach((dateRow, rowIndex) => {
      const y = tableTop + totalHeaderHeight + rowIndex * rowHeight;
      ctx.fillStyle = rowIndex % 2 === 0 ? '#ffffff' : '#f8fafc';
      ctx.fillRect(tableLeft, y, tableWidth, rowHeight);
      ctx.strokeStyle = '#e2e8f0';
      if (params.showSerialNumber) {
        ctx.strokeRect(tableLeft, y, serialWidth, rowHeight);
        ctx.font = '600 13px Arial, sans-serif';
        ctx.fillStyle = '#475569';
        const serialText = String(rowIndex + 1);
        ctx.fillText(serialText, tableLeft + (serialWidth - ctx.measureText(serialText).width) / 2, y + 28);
      }
      ctx.strokeRect(dateX, y, dateWidth, rowHeight);
      ctx.font = '600 14px Arial, sans-serif';
      ctx.fillStyle = '#334155';
      const dateText = formatDateDDMMYYYY(dateRow.date);
      ctx.fillText(dateText, dateX + (dateWidth - ctx.measureText(dateText).width) / 2, y + 28);

      teams.forEach((team, teamIndex) => {
        const row = dateRow.cells[team.teamKey];
        const values = row?.reported
          ? [String(row.morning ?? 0), String(row.afternoon ?? 0), String(row.evening ?? 0), String(row.dailyHeadcount ?? 0)]
          : ['—', '—', '—', '—'];
        values.forEach((value, metricIndex) => {
          const x = teamStartX + teamIndex * teamWidth + metricIndex * metricWidth;
          ctx.strokeRect(x, y, metricWidth, rowHeight);
          ctx.font = metricIndex === 3 ? '700 14px Arial, sans-serif' : '500 14px Arial, sans-serif';
          ctx.fillStyle = row?.reported ? '#334155' : '#94a3b8';
          const w = ctx.measureText(value).width;
          ctx.fillText(value, x + (metricWidth - w) / 2, y + 28);
        });
      });
      // Total column uses the SAME alternating row background as every other
      // column; its bold blue text alone conveys emphasis.
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(totalX, y, totalWidth, rowHeight);
      ctx.fillStyle = '#1e3a8a';
      ctx.font = '700 14px Arial, sans-serif';
      const dailyTotalText = String(dateRow.totalDailyHeadcount);
      ctx.fillText(dailyTotalText, totalX + (totalWidth - ctx.measureText(dailyTotalText).width) / 2, y + 28);
      if (params.showWorkDetails) {
        // Do not overwrite the whole-row zebra stripe in the notes column.
        ctx.strokeStyle = '#e2e8f0';
        ctx.strokeRect(detailX, y, detailWidth, rowHeight);
        const detailText = teams.map((team) => {
          const row = dateRow.cells[team.teamKey];
          const detail = formatCrewRowDetail(row);
          return detail ? `${team.teamName}: ${detail}` : '';
        }).filter(Boolean).join(' | ');
        const clipped = detailText.length > 90 ? `${detailText.slice(0, 89)}…` : (detailText || '—');
        ctx.fillStyle = detailText ? '#475569' : '#94a3b8';
        ctx.font = '500 11px Arial, sans-serif';
        ctx.fillText(clipped, detailX + 8, y + 27);
      }
    });

    const totalRowY = tableTop + totalHeaderHeight + dates.length * rowHeight;
    ctx.fillStyle = '#dbeafe';
    ctx.fillRect(tableLeft, totalRowY, tableWidth, rowHeight);
    ctx.strokeStyle = '#93c5fd';
    if (params.showSerialNumber) ctx.strokeRect(tableLeft, totalRowY, serialWidth, rowHeight);
    ctx.strokeRect(dateX, totalRowY, dateWidth, rowHeight);
    ctx.fillStyle = '#1e3a8a';
    ctx.font = '700 14px Arial, sans-serif';
    const totalLabel = 'TỔNG';
    ctx.fillText(totalLabel, dateX + (dateWidth - ctx.measureText(totalLabel).width) / 2, totalRowY + 28);
    teams.forEach((team, teamIndex) => {
      const total = matrix.teamTotals[team.teamKey] || { morning: 0, afternoon: 0, evening: 0, dailyHeadcount: 0 };
      [total.morning, total.afternoon, total.evening, total.dailyHeadcount].forEach((value, metricIndex) => {
        const x = teamStartX + teamIndex * teamWidth + metricIndex * metricWidth;
        ctx.strokeRect(x, totalRowY, metricWidth, rowHeight);
        const text = String(value);
        ctx.fillText(text, x + (metricWidth - ctx.measureText(text).width) / 2, totalRowY + 28);
      });
    });
    // All cells in the TỔNG row must share the SAME blue fill (#dbeafe).
    ctx.fillStyle = '#dbeafe';
    ctx.fillRect(totalX, totalRowY, totalWidth, rowHeight);
    ctx.strokeRect(totalX, totalRowY, totalWidth, rowHeight);
    ctx.fillStyle = '#1e3a8a';
    const grandText = String(matrix.grandDailyHeadcount);
    ctx.fillText(grandText, totalX + (totalWidth - ctx.measureText(grandText).width) / 2, totalRowY + 28);
    if (params.showWorkDetails) {
      ctx.fillStyle = '#dbeafe';
      ctx.fillRect(detailX, totalRowY, detailWidth, rowHeight);
      ctx.strokeStyle = '#93c5fd';
      ctx.strokeRect(detailX, totalRowY, detailWidth, rowHeight);
    }

    ctx.font = '500 13px Arial, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('0 = đã báo, không có người · — = chưa báo · Tổng ngày = cộng QS các đội · TỔNG = cộng từng cột.', left, height - 28);

    const dataUrl = canvas.toDataURL('image/png');
    attachments.push({
      id: `crew-report-${pageIndex + 1}`,
      fileName: `Bao-cao-quan-so-${sanitizeFilePart(matrix.projectName)}-${params.startDate}-${params.endDate}-trang-${pageIndex + 1}.png`,
      mimeType: 'image/png',
      dataUrl,
    });
  }
  return attachments;
}

const downloadDataUrl = async (dataUrl: string, fileName: string): Promise<void> => {
  if (isAndroidExportBridgeAvailable()) {
    // Android WebView does not reliably honor <a download> for canvas data: URLs.
    // Use the existing chunked native exporter which writes into Download/QLTC.
    // Decode only inside the Android path; desktop/Web keep the browser download.
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new Error('Dữ liệu PNG báo cáo không hợp lệ.');
    const binary = atob(match[1]);
    if (!binary.length) throw new Error('Ảnh báo cáo không có dữ liệu.');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    await saveBlobToDownloads(new Blob([bytes], { type: 'image/png' }), fileName, 'image/png');
    return;
  }

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

export const CrewReportShareModal: React.FC<CrewReportShareModalProps> = ({
  isOpen,
  onClose,
  projects,
  initialStartDate,
  initialEndDate,
  maxDate,
  rangeLocked = false,
  title = 'Báo cáo quân số',
}) => {
  const resolvedMaxDate = maxDate || initialEndDate || initialStartDate;
  const [mode, setMode] = useState<'single' | 'range'>('single');
  const [datePreset, setDatePreset] = useState<CrewReportDatePreset | 'custom'>('custom');
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate || initialStartDate);
  const [projectFilter, setProjectFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [hideUnreportedTeams, setHideUnreportedTeams] = useState(false);
  const [hideZeroTeams, setHideZeroTeams] = useState(false);
  const [hideUnreportedDates, setHideUnreportedDates] = useState(false);
  const [hideZeroDates, setHideZeroDates] = useState(false);
  const [showSerialNumber, setShowSerialNumber] = useState(false);
  const [showWorkDetails, setShowWorkDetails] = useState(false);
  const [busy, setBusy] = useState<'text' | 'image' | 'download' | 'excel' | ''>('');
  const [actionMenu, setActionMenu] = useState<'text' | 'image' | 'excel' | null>(null);
  const [preparedImages, setPreparedImages] = useState<{signature:string; attachments:ShareAttachmentPayload[]}|null>(null);
  const [preparedExcel, setPreparedExcel] = useState<{signature:string; fileName:string; mimeType:string; blob:Blob; dataUrl:string}|null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setStartDate(initialStartDate);
    setEndDate(initialEndDate || initialStartDate);
    setMode(initialStartDate === (initialEndDate || initialStartDate) ? 'single' : 'range');
    const initialEnd = initialEndDate || initialStartDate;
    const matches = (['today', 'yesterday', '7days', 'month'] as const).find((preset) => {
      const range = getCrewReportPresetRange(preset);
      return range.startDate === initialStartDate && range.endDate === initialEnd;
    });
    setDatePreset(matches || 'custom');
    setProjectFilter('all');
    setTeamFilter('all');
    setHideUnreportedTeams(false);
    setHideZeroTeams(false);
    setHideUnreportedDates(false);
    setHideZeroDates(false);
    setShowSerialNumber(false);
    setShowWorkDetails(false);
    setMessage('');
    setActionMenu(null);
    setPreparedImages(null);
    setPreparedExcel(null);
  }, [isOpen, initialStartDate, initialEndDate]);

  const effectiveEndDate = mode === 'single' ? startDate : endDate;
  const spanDays = dateSpanDays(startDate, effectiveEndDate);
  const rangeValid = spanDays > 0 && spanDays <= 93 && effectiveEndDate <= resolvedMaxDate;
  const chooseDatePreset = (preset: CrewReportDatePreset) => {
    if (rangeLocked) return;
    const range = getCrewReportPresetRange(preset);
    if (range.endDate > resolvedMaxDate) return;
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    setMode(range.startDate === range.endDate ? 'single' : 'range');
    setDatePreset(preset);
    setMessage('');
  };
  const allRows = useMemo(
    () => rangeValid ? buildCrewReportRows(projects, startDate, effectiveEndDate) : [],
    [projects, startDate, effectiveEndDate, rangeValid],
  );
  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of allRows) {
      if (projectFilter !== 'all' && row.projectId !== projectFilter) continue;
      map.set(row.teamKey, `${row.structureGroupName ? `${row.structureGroupName} · ` : ''}${row.teamName}`);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'vi-VN', { numeric: true, sensitivity: 'base' }));
  }, [allRows, projectFilter]);
  const rows = useMemo(() => {
    const scopedRows = filterCrewReportRows(allRows, projectFilter, teamFilter);

    // Team-level hiding is evaluated across the whole selected date range. A team
    // that reported at least one non-zero day stays visible, so a temporary 0 day
    // never makes an otherwise active team disappear.
    const teamStats = new Map<string, { reported: number; headcount: number }>();
    scopedRows.forEach((row) => {
      const key = `${row.projectId}::${row.teamKey}`;
      const stat = teamStats.get(key) || { reported: 0, headcount: 0 };
      if (row.reported) {
        stat.reported += 1;
        stat.headcount += row.dailyHeadcount || 0;
      }
      teamStats.set(key, stat);
    });
    const teamVisibleRows = scopedRows.filter((row) => {
      const stat = teamStats.get(`${row.projectId}::${row.teamKey}`) || { reported: 0, headcount: 0 };
      if (hideUnreportedTeams && stat.reported === 0) return false;
      if (hideZeroTeams && stat.reported > 0 && stat.headcount === 0) return false;
      return true;
    });

    // Date-level hiding is calculated after team filtering so totals and the visible
    // matrix always describe exactly the same team columns shown to the user.
    const dateStats = new Map<string, { reported: number; headcount: number }>();
    teamVisibleRows.forEach((row) => {
      const key = `${row.projectId}::${row.date}`;
      const stat = dateStats.get(key) || { reported: 0, headcount: 0 };
      if (row.reported) {
        stat.reported += 1;
        stat.headcount += row.dailyHeadcount || 0;
      }
      dateStats.set(key, stat);
    });
    return teamVisibleRows.filter((row) => {
      const stat = dateStats.get(`${row.projectId}::${row.date}`) || { reported: 0, headcount: 0 };
      if (hideUnreportedDates && stat.reported === 0) return false;
      if (hideZeroDates && stat.reported > 0 && stat.headcount === 0) return false;
      return true;
    });
  }, [
    allRows,
    projectFilter,
    teamFilter,
    hideUnreportedTeams,
    hideZeroTeams,
    hideUnreportedDates,
    hideZeroDates,
  ]);
  const dailySummary = useMemo(() => summarizeCrewReportRows(rows), [rows]);
  const reportMatrices = useMemo(() => buildCrewReportMatrices(rows), [rows]);
  const reportText = useMemo(() => buildCrewReportText({ rows, startDate, endDate: effectiveEndDate, title, includeSerial: showSerialNumber, includeDetails: showWorkDetails }), [rows, startDate, effectiveEndDate, title, showSerialNumber, showWorkDetails]);
  const preparationSignature = reportText + '|' + showSerialNumber + '|' + showWorkDetails;
  useEffect(() => {
    setActionMenu(null);
    setPreparedImages(null);
    setPreparedExcel(null);
  }, [preparationSignature]);

  if (!isOpen) return null;

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setMessage('Đã sao chép nội dung báo cáo.');
    } catch (_) {
      setMessage('Không sao chép tự động được. Hãy thử Chia sẻ nội dung.');
    }
  };

  const shareText = async () => {
    setBusy('text');
    setMessage('');
    try {
      const result = await sharePreparedContent({ title, text: reportText });
      if (result.status === 'shared') setMessage('Đã yêu cầu mở bảng chia sẻ nội dung.');
      else if (result.status === 'copied') setMessage('Thiết bị không hỗ trợ chia sẻ; đã sao chép nội dung thay thế.');
      else if (result.status === 'cancelled') setMessage('Đã hủy chia sẻ.');
      else setMessage('Không chia sẻ được nội dung. Hãy chọn Sao chép nội dung.');
    } finally {
      setBusy('');
    }
  };

  const makeImages = async () => renderCrewReportImages({ rows, startDate, endDate: effectiveEndDate, title, showSerialNumber, showWorkDetails });

  const openActionMenu = async (type:'text'|'image'|'excel') => {
    if(busy)return;
    if(actionMenu===type){setActionMenu(null);return;}
    setActionMenu(type);
    setMessage('');
    if(type==='text')return;
    if(type==='image' && preparedImages?.signature===preparationSignature)return;
    if(type==='excel' && preparedExcel?.signature===preparationSignature)return;
    setBusy(type);
    try{
      if(type==='image'){
        const attachments=await makeImages();
        if(!attachments.length)throw new Error('Không có dữ liệu để tạo ảnh quân số.');
        setPreparedImages({signature:preparationSignature,attachments});
      }else{
        const {buildCrewReportExcel}=await import('../utils/crewReportExcel');
        const {blob,fileName,mimeType}=await buildCrewReportExcel({rows,startDate,endDate:effectiveEndDate,
          includeSerial:showSerialNumber,includeDetails:showWorkDetails,title});
        const dataUrl=await new Promise<string>((resolve,reject)=>{
          const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));
          reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);
        });
        setPreparedExcel({signature:preparationSignature,blob,fileName,mimeType,dataUrl});
      }
    }catch(e){setMessage('Không chuẩn bị được '+(type==='image'?'ảnh':'Excel')+': '+(e instanceof Error?e.message:String(e)));}
    finally{setBusy('');}
  };

  const shareImages = async () => {
    const attachments=preparedImages?.signature===preparationSignature?preparedImages.attachments:[];
    if(!attachments.length)return;
    if(attachments.length>6){setMessage('Chia sẻ ảnh tối đa 6 trang/lần. Hãy chọn ngày hoặc dự án ít hơn, hoặc tải ảnh.');return;}
    setBusy('image');
    setMessage('');
    try{
      const result=await sharePreparedContent({title,
        text:title+'\n'+(startDate===effectiveEndDate?formatDateDDMMYYYY(startDate):formatDateDDMMYYYY(startDate)+' → '+formatDateDDMMYYYY(effectiveEndDate)),
        attachments,allowTextFallback:false});
      if(result.status==='shared')setMessage('Đã yêu cầu mở chia sẻ '+attachments.length+' ảnh báo cáo.');
      else if(result.status==='cancelled')setMessage('Đã hủy chia sẻ ảnh.');
      else setMessage('Thiết bị không hỗ trợ chia sẻ ảnh trực tiếp; hãy chọn Tải ảnh.');
    }finally{setBusy('');}
  };

  const downloadImages = async () => {
    const attachments=preparedImages?.signature===preparationSignature?preparedImages.attachments:[];
    if(!attachments.length)return;
    setBusy('download');
    setMessage('');
    let savedCount = 0;
    try{
      if(isAndroidExportBridgeAvailable()){
        for(const attachment of attachments){
          await downloadDataUrl(attachment.dataUrl, attachment.fileName);
          savedCount+=1;
        }
        setMessage(`Đã lưu ${savedCount} ảnh báo cáo vào Tải xuống/QLTC trên điện thoại.`);
      }else if(attachments.length===1){
        await downloadDataUrl(attachments[0].dataUrl,attachments[0].fileName);
        setMessage('Đã yêu cầu trình duyệt tải 1 ảnh. Kiểm tra thư mục Tải xuống trên thiết bị.');
      }else{
        attachments.forEach((attachment,index)=>window.setTimeout(()=>{
          void downloadDataUrl(attachment.dataUrl,attachment.fileName).catch(err=>{
            setMessage('Một ảnh không tải được: '+(err instanceof Error?err.message:String(err)));
          });
        },index*250));
        setMessage('Đã yêu cầu tải '+attachments.length+' ảnh. Hãy cho phép tải nhiều file nếu trình duyệt hỏi.');
      }
    }catch(e){setMessage((savedCount ? 'Đã lưu '+savedCount+' ảnh; ảnh tiếp theo không tải được: ' : 'Không tải được ảnh báo cáo: ')+(e instanceof Error?e.message:String(e)));}
    finally{setBusy('');}
  };

  const handleExcel = async(action:'download'|'share')=>{
    const item=preparedExcel?.signature===preparationSignature?preparedExcel:null;
    if(!item||busy)return;
    setBusy('excel');setMessage('');
    try{
      if(action==='download'){
        await saveBlobToDownloads(item.blob,item.fileName,item.mimeType);
        setMessage('Đã yêu cầu tải Excel quân số với công thức MAX/SUM.');
      }else{
        const result=await sharePreparedContent({title:'Báo cáo quân số',text:title,
          attachments:[{id:'crew-excel',fileName:item.fileName,mimeType:item.mimeType,dataUrl:item.dataUrl}],
          allowTextFallback:false});
        if(result.status==='shared')setMessage('Đã yêu cầu mở chia sẻ file Excel.');
        else if(result.status==='cancelled')setMessage('Đã hủy chia sẻ Excel.');
        else setMessage('Không chia sẻ Excel được trên thiết bị này. Hãy chọn Tải Excel.');
      }
    }catch(e){setMessage('Không xuất/chia sẻ Excel: '+(e instanceof Error?e.message:String(e)));}
    finally{setBusy('');}
  };

  return (
    <div className="fixed inset-0 z-[95] overflow-y-auto bg-slate-950/55 p-2 backdrop-blur-[1px] sm:p-4" role="dialog" aria-modal="true" aria-label="Chia sẻ báo cáo quân số">
      <div className="mx-auto w-full max-w-6xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div>
            <div className="flex items-center gap-2 text-base font-black text-slate-900"><Share2 className="h-5 w-5 text-emerald-600" /> Chia sẻ báo cáo quân số</div>
            <p className="mt-0.5 text-[10.5px] text-slate-500">Chọn 1 ngày hoặc nhiều ngày, lọc dự án/đội và chia sẻ nội dung hoặc ảnh.</p>
          </div>
          <button type="button" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label="Đóng"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-3 sm:p-5">
          {!rangeLocked && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Chọn nhanh ngày báo cáo">
                {([
                  ['today', 'Hôm nay'],
                  ['yesterday', 'Hôm qua'],
                  ['7days', '7 ngày'],
                  ['month', 'Tháng này'],
                ] as const).map(([preset, label]) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => chooseDatePreset(preset)}
                    disabled={getCrewReportPresetRange(preset).endDate > resolvedMaxDate}
                    aria-pressed={datePreset === preset}
                    className={`min-h-10 rounded-xl px-3 py-2 text-xs font-extrabold disabled:cursor-not-allowed disabled:opacity-40 ${datePreset === preset ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                  >{label}</button>
                ))}
                <button type="button" onClick={() => { setDatePreset('custom'); setMode('range'); setEndDate((current) => current < startDate ? startDate : current); }} aria-pressed={datePreset === 'custom'} className={`min-h-10 rounded-xl px-3 py-2 text-xs font-extrabold ${datePreset === 'custom' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>Khoảng ngày</button>
              </div>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[10px] font-bold text-slate-500">
              <span className="mb-1 block">{mode === 'single' ? 'Ngày báo cáo' : 'Từ ngày'}</span>
              <input type="date" value={startDate} max={resolvedMaxDate} disabled={rangeLocked} onChange={(event) => { setDatePreset('custom'); setStartDate(event.target.value); if (mode === 'single') { setEndDate(event.target.value); setMode('range'); } else if (event.target.value > endDate) setEndDate(event.target.value); }} className="w-full bg-transparent text-sm font-extrabold text-slate-800 outline-none disabled:opacity-70" />
            </label>
            {mode === 'range' && (
              <label className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[10px] font-bold text-slate-500">
                <span className="mb-1 block">Đến ngày</span>
                <input type="date" value={endDate} min={startDate} max={resolvedMaxDate} disabled={rangeLocked} onChange={(event) => { setDatePreset('custom'); setEndDate(event.target.value); }} className="w-full bg-transparent text-sm font-extrabold text-slate-800 outline-none disabled:opacity-70" />
              </label>
            )}
            <label className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[10px] font-bold text-slate-500">
              <span className="mb-1 block">Dự án</span>
              <select value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value); setTeamFilter('all'); }} className="w-full bg-transparent text-sm font-extrabold text-slate-800 outline-none">
                <option value="all">Tất cả dự án</option>
                {projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}
              </select>
            </label>
            <label className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[10px] font-bold text-slate-500">
              <span className="mb-1 block">Đội thi công</span>
              <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} className="w-full bg-transparent text-sm font-extrabold text-slate-800 outline-none">
                <option value="all">Tất cả đội</option>
                {teamOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
              </select>
            </label>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Tùy chọn hiển thị báo cáo</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700"><input type="checkbox" checked={hideUnreportedTeams} onChange={(event) => setHideUnreportedTeams(event.target.checked)} /> Ẩn đội chưa báo</label>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700"><input type="checkbox" checked={hideZeroTeams} onChange={(event) => setHideZeroTeams(event.target.checked)} /> Ẩn đội quân số = 0</label>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700"><input type="checkbox" checked={hideUnreportedDates} onChange={(event) => setHideUnreportedDates(event.target.checked)} /> Ẩn ngày chưa báo</label>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700"><input type="checkbox" checked={hideZeroDates} onChange={(event) => setHideZeroDates(event.target.checked)} /> Ẩn ngày quân số = 0</label>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700"><input type="checkbox" checked={showSerialNumber} onChange={(event) => setShowSerialNumber(event.target.checked)} /> Thêm cột STT</label>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700"><input type="checkbox" checked={showWorkDetails} onChange={(event) => setShowWorkDetails(event.target.checked)} /> Chi tiết Tầng / Hạng mục / HM con / Ghi chú</label>
            </div>
            <div className="mt-2 text-[9.5px] font-semibold text-slate-500">
              Mặc định không ẩn dữ liệu. “Ẩn đội quân số = 0” chỉ ẩn đội đã báo nhưng toàn bộ khoảng ngày đang xem đều bằng 0.
            </div>
          </div>

          {!rangeValid && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Khoảng ngày không hợp lệ hoặc vượt quá 93 ngày.</div>}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-[9.5px] font-bold text-slate-500">Ngày</div><div className="mt-1 text-xl font-black text-slate-900">{dailySummary.length}</div></div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div className="text-[9.5px] font-bold text-emerald-700">Đội/ngày đã báo</div><div className="mt-1 text-xl font-black text-emerald-800">{dailySummary.reduce((sum, item) => sum + item.reportedTeams, 0)}</div></div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="text-[9.5px] font-bold text-amber-700">Chưa báo</div><div className="mt-1 text-xl font-black text-amber-800">{dailySummary.reduce((sum, item) => sum + item.missingTeams, 0)}</div></div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3"><div className="text-[9.5px] font-bold text-blue-700">Dòng báo cáo</div><div className="mt-1 text-xl font-black text-blue-800">{rows.length}</div></div>
          </div>

          <div className="space-y-3">
            {reportMatrices.map((matrix) => (
              <section key={matrix.projectId} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="text-xs font-black text-slate-900">{matrix.projectName}</div>
                  {matrix.projectLocation && <div className="mt-0.5 text-[10px] font-semibold text-slate-500">Địa điểm: {matrix.projectLocation}</div>}
                </div>
                <div className="relative isolate max-h-[42vh] overflow-auto overscroll-contain">
                  <table className="hnl-crew-report-table w-full text-left text-xs" style={{ minWidth: `${Math.max(570, 230 + matrix.teams.length * 248 + (showSerialNumber ? 52 : 0) + (showWorkDetails ? 300 : 0))}px` }}>
                    <thead className="bg-slate-100 text-[9.5px] font-black text-slate-500">
                      <tr className="h-8">
                        {showSerialNumber && <th rowSpan={3} className="sticky left-0 top-0 z-[6] min-w-[52px] border-r border-slate-200 bg-blue-50 px-2 py-2 text-center align-middle">STT</th>}
                        <th rowSpan={3} style={{ left: showSerialNumber ? 52 : 0 }} className="sticky top-0 z-[5] min-w-[118px] border-r border-slate-200 bg-blue-50 px-3 py-2 text-center align-middle">Ngày</th>
                        {matrix.groups.map((group) => (
                          <th key={group.structureGroupId} colSpan={Math.max(1, group.teams.length * 4)} className="sticky top-0 z-[4] h-8 border-r border-blue-200 bg-blue-50 px-2 py-0 text-center text-blue-800">{group.structureGroupName}</th>
                        ))}
                        <th rowSpan={3} className="sticky top-0 z-[4] min-w-[110px] border-r border-slate-200 bg-blue-50 px-2 py-2 text-center align-middle text-blue-800">Tổng QS/ngày</th>
                        {showWorkDetails && <th rowSpan={3} className="sticky top-0 z-[4] min-w-[300px] border-r border-slate-200 bg-blue-50 px-3 py-2 text-left align-middle text-slate-700">Tầng / Hạng mục / HM con / Ghi chú</th>}
                      </tr>
                      <tr className="h-8">
                        {matrix.teams.map((team) => <th key={team.teamKey} colSpan={4} className="sticky top-[31px] z-[3] h-8 border-r border-slate-200 bg-blue-50 px-2 py-0 text-center text-slate-700">{team.teamName}</th>)}
                      </tr>
                      <tr>
                        {matrix.teams.flatMap((team) => ['Sáng', 'Chiều', 'Tối', 'QS ngày'].map((label) => <th key={`${team.teamKey}-${label}`} className="sticky top-[62px] z-[3] min-w-[62px] border-r border-slate-200 bg-blue-50 px-2 py-1.5 text-center">{label}</th>))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {matrix.dates.map((dateRow, dateIndex) => (
                        <tr key={`${matrix.projectId}-${dateRow.date}`} className={dateIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          {showSerialNumber && <td className={`sticky left-0 z-[2] border-r border-slate-100 px-2 py-2 text-center font-bold text-slate-500 ${dateIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>{dateIndex + 1}</td>}
                          <td style={{ left: showSerialNumber ? 52 : 0 }} className={`sticky z-[1] border-r border-slate-100 px-3 py-2 text-center font-bold tabular-nums text-slate-700 ${dateIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>{formatDateDDMMYYYY(dateRow.date)}</td>
                          {matrix.teams.flatMap((team) => {
                            const row = dateRow.cells[team.teamKey];
                            return [
                              <td key={`${team.teamKey}-m`} className="border-r border-slate-100 px-2 py-2 text-center tabular-nums">{row?.reported ? formatCell(row.morning, true) : '—'}</td>,
                              <td key={`${team.teamKey}-a`} className="border-r border-slate-100 px-2 py-2 text-center tabular-nums">{row?.reported ? formatCell(row.afternoon, true) : '—'}</td>,
                              <td key={`${team.teamKey}-e`} className="border-r border-slate-100 px-2 py-2 text-center tabular-nums">{row?.reported ? formatCell(row.evening, true) : '—'}</td>,
                              <td key={`${team.teamKey}-d`} className={`border-r border-slate-100 px-2 py-2 text-center font-black tabular-nums ${row?.reported ? 'text-slate-900' : 'text-amber-600'}`}>{row?.reported ? formatCell(row.dailyHeadcount, true) : '—'}</td>,
                            ];
                          })}
                          <td className="border-r border-slate-100 px-2 py-2 text-center font-black tabular-nums text-blue-900">{dateRow.totalDailyHeadcount}</td>
                          {showWorkDetails && (
                            <td className="min-w-[300px] border-r border-slate-100 px-3 py-2 align-top text-[10px] leading-4 text-slate-600">
                              {matrix.teams.map((team) => {
                                const row = dateRow.cells[team.teamKey];
                                const detail = formatCrewRowDetail(row);
                                return detail ? <div key={team.teamKey}><span className="font-extrabold text-slate-700">{team.teamName}:</span> {detail}</div> : null;
                              })}
                              {!matrix.teams.some((team) => Boolean(formatCrewRowDetail(dateRow.cells[team.teamKey]))) && <span className="text-slate-400">—</span>}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-blue-200 bg-blue-100 font-black text-blue-950">
                        {showSerialNumber && <td className="sticky left-0 z-[2] border-r border-blue-200 bg-blue-100 px-2 py-2"></td>}
                        <td style={{ left: showSerialNumber ? 52 : 0 }} className="sticky z-[1] border-r border-blue-200 bg-blue-100 px-3 py-2 text-center">TỔNG</td>
                        {matrix.teams.flatMap((team) => {
                          const total = matrix.teamTotals[team.teamKey] || { morning: 0, afternoon: 0, evening: 0, dailyHeadcount: 0 };
                          return [total.morning, total.afternoon, total.evening, total.dailyHeadcount].map((value, index) => (
                            <td key={`${team.teamKey}-total-${index}`} className="border-r border-blue-100 px-2 py-2 text-center tabular-nums">{value}</td>
                          ));
                        })}
                        <td className="border-r border-blue-200 bg-blue-100 px-2 py-2 text-center tabular-nums">{matrix.grandDailyHeadcount}</td>
                        {showWorkDetails && <td className="border-r border-blue-200 bg-blue-100 px-3 py-2"></td>}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            ))}
            {rows.length === 0 && <div className="rounded-2xl border border-slate-200 px-4 py-8 text-center text-xs text-slate-400">Không có đội hoặc dữ liệu phù hợp phạm vi đã chọn.</div>}
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[10.5px] leading-4 text-blue-700">
            <Users className="mr-1 inline h-3.5 w-3.5" /> 0 = đã báo, không có người · — = chưa báo · Tổng ngày = cộng QS các đội · TỔNG = cộng từng cột; ô cuối = tổng lượt người-ngày.
          </div>

          <div className="grid grid-cols-3 gap-2" data-hnl-crew-export-menu="unified">
            <button type="button" disabled={!rangeValid || rows.length===0||Boolean(busy)} onClick={()=>void openActionMenu('text')}
              aria-expanded={actionMenu==='text'} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-2 text-xs font-bold text-white disabled:opacity-40">
              <FileText className="h-4 w-4" /> Nội dung
            </button>
            <button type="button" disabled={!rangeValid || rows.length===0||Boolean(busy)} onClick={()=>void openActionMenu('image')}
              aria-expanded={actionMenu==='image'} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-2 text-xs font-bold text-white disabled:opacity-40">
              <ImageIcon className="h-4 w-4" /> {busy==='image'?'Tạo ảnh…':'Ảnh'}
            </button>
            <button type="button" disabled={!rangeValid || rows.length===0||Boolean(busy)} onClick={()=>void openActionMenu('excel')}
              aria-expanded={actionMenu==='excel'} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-2 text-xs font-bold text-white disabled:opacity-40">
              <FileSpreadsheet className="h-4 w-4" /> {busy==='excel'?'Tạo Excel…':'Excel'}
            </button>
          </div>
          {/* A scrollable/backdrop-filter parent traps fixed children in Android WebView. */}
          {actionMenu && typeof document !== 'undefined' && createPortal(
            <div data-hnl-crew-action-overlay="true" className="fixed inset-0 z-[160] flex items-end justify-center sm:items-center">
            <button type="button" data-hnl-crew-action-backdrop="true" onClick={()=>!busy&&setActionMenu(null)}
              className="absolute inset-0 bg-slate-950/45" aria-label="Đóng tùy chọn chia sẻ quân số" />
            <div role="dialog" aria-modal="true" aria-label="Tùy chọn xuất và chia sẻ báo cáo quân số"
              data-hnl-crew-action-menu={actionMenu}
              className="relative z-10 mb-[calc(0.75rem+env(safe-area-inset-bottom))] w-[calc(100%-1.5rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:mb-0">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-slate-900">Báo cáo quân số · {actionMenu==='text'?'nội dung':actionMenu==='image'?'ảnh':'Excel'}</p>
                <button type="button" disabled={Boolean(busy)} onClick={()=>setActionMenu(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600"
                  aria-label="Đóng tùy chọn"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
            {actionMenu==='text'&&<>
              <button type="button" onClick={()=>void copyText()} disabled={Boolean(busy)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 disabled:opacity-40"><Copy className="mr-1 inline h-4 w-4" /> Sao chép nội dung</button>
              <button type="button" onClick={()=>void shareText()} disabled={Boolean(busy)} className="min-h-11 rounded-lg bg-slate-800 px-2 text-xs font-bold text-white disabled:opacity-40"><Share2 className="mr-1 inline h-4 w-4" /> Chia sẻ nội dung</button>
            </>}
            {actionMenu==='image'&&<>
              <button type="button" onClick={()=>void downloadImages()} disabled={Boolean(busy)||preparedImages?.signature!==preparationSignature} className="min-h-11 rounded-lg border border-emerald-200 bg-white px-2 text-xs font-bold text-emerald-700 disabled:opacity-40"><Download className="mr-1 inline h-4 w-4" /> Tải ảnh</button>
              <button type="button" onClick={()=>void shareImages()} disabled={Boolean(busy)||preparedImages?.signature!==preparationSignature} className="min-h-11 rounded-lg bg-emerald-600 px-2 text-xs font-bold text-white disabled:opacity-40"><Share2 className="mr-1 inline h-4 w-4" /> Chia sẻ ảnh</button>
            </>}
            {actionMenu==='excel'&&<>
              <button type="button" onClick={()=>void handleExcel('download')} disabled={Boolean(busy)||preparedExcel?.signature!==preparationSignature} className="min-h-11 rounded-lg border border-indigo-200 bg-white px-2 text-xs font-bold text-indigo-700 disabled:opacity-40"><Download className="mr-1 inline h-4 w-4" /> Tải Excel</button>
              <button type="button" onClick={()=>void handleExcel('share')} disabled={Boolean(busy)||preparedExcel?.signature!==preparationSignature} className="min-h-11 rounded-lg bg-indigo-600 px-2 text-xs font-bold text-white disabled:opacity-40"><Share2 className="mr-1 inline h-4 w-4" /> Chia sẻ Excel</button>
            </>}
              </div>
            </div>
          </div>, document.body)}
          {message && <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{message}</div>}
        </div>
      </div>
    </div>
  );
};
