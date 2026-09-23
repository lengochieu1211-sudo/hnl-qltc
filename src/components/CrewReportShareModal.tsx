import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Download, FileText, Image as ImageIcon, Share2, Users, X } from 'lucide-react';
import type { ShareAttachmentPayload } from '../utils/shareUtils';
import { sharePreparedContent } from '../utils/shareUtils';
import {
  buildCrewReportRows,
  buildCrewReportMatrices,
  buildCrewReportText,
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

async function renderCrewReportImages(params: {
  rows: CrewReportRow[];
  startDate: string;
  endDate: string;
  title: string;
}): Promise<ShareAttachmentPayload[]> {
  if (typeof document === 'undefined') return [];
  const matrices = buildCrewReportMatrices(params.rows);
  const TEAM_CHUNK = 4;
  const pageSpecs: Array<{ matrix: ReturnType<typeof buildCrewReportMatrices>[number]; teams: ReturnType<typeof buildCrewReportMatrices>[number]['teams']; dates: ReturnType<typeof buildCrewReportMatrices>[number]['dates'] }> = [];

  matrices.forEach((matrix) => {
    const teamChunks = matrix.teams.length > 0
      ? Array.from({ length: Math.ceil(matrix.teams.length / TEAM_CHUNK) }, (_, i) => matrix.teams.slice(i * TEAM_CHUNK, (i + 1) * TEAM_CHUNK))
      : [[]];
    // Keep the full selected date range on each image page so the final TỔNG row
    // always represents the whole report range. Only split horizontally by team.
    const dates = matrix.dates.length > 0 ? matrix.dates : [];
    teamChunks.forEach((teams) => pageSpecs.push({ matrix, teams, dates }));
  });

  const attachments: ShareAttachmentPayload[] = [];
  for (let pageIndex = 0; pageIndex < pageSpecs.length; pageIndex += 1) {
    const { matrix, teams, dates } = pageSpecs[pageIndex];
    const left = 42;
    const right = 42;
    const dateWidth = 150;
    const metricWidth = 72;
    const teamWidth = metricWidth * 4;
    const totalWidth = 118;
    const tableWidth = dateWidth + Math.max(1, teams.length) * teamWidth + totalWidth;
    const width = Math.max(920, left + tableWidth + right);
    const headerHeight = matrix.projectLocation ? 180 : 154;
    const headerRowHeight = 42;
    const subHeaderHeight = 38;
    const rowHeight = 44;
    const footerHeight = 62;
    const height = headerHeight + headerRowHeight + subHeaderHeight + (Math.max(1, dates.length) + 1) * rowHeight + footerHeight;
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
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(tableLeft, tableTop, tableWidth, headerRowHeight + subHeaderHeight);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;

    ctx.fillStyle = '#334155';
    ctx.font = '700 15px Arial, sans-serif';
    ctx.fillText('Ngày', tableLeft + 10, tableTop + 50);

    teams.forEach((team, teamIndex) => {
      const x = tableLeft + dateWidth + teamIndex * teamWidth;
      ctx.strokeRect(x, tableTop, teamWidth, headerRowHeight + subHeaderHeight);
      ctx.font = '700 15px Arial, sans-serif';
      ctx.fillStyle = '#334155';
      const name = team.teamName.length > 24 ? `${team.teamName.slice(0, 23)}…` : team.teamName;
      const textWidth = ctx.measureText(name).width;
      ctx.fillText(name, x + Math.max(8, (teamWidth - textWidth) / 2), tableTop + 27);
      ['Sáng', 'Chiều', 'Tối', 'QS ngày'].forEach((label, metricIndex) => {
        const mx = x + metricIndex * metricWidth;
        ctx.strokeRect(mx, tableTop + headerRowHeight, metricWidth, subHeaderHeight);
        ctx.font = '600 12px Arial, sans-serif';
        const w = ctx.measureText(label).width;
        ctx.fillText(label, mx + (metricWidth - w) / 2, tableTop + headerRowHeight + 24);
      });
    });
    const totalX = tableLeft + dateWidth + teams.length * teamWidth;
    ctx.fillStyle = '#eff6ff';
    ctx.fillRect(totalX, tableTop, totalWidth, headerRowHeight + subHeaderHeight);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(totalX, tableTop, totalWidth, headerRowHeight + subHeaderHeight);
    ctx.fillStyle = '#1e40af';
    ctx.font = '700 13px Arial, sans-serif';
    ctx.fillText('Tổng', totalX + 42, tableTop + 31);
    ctx.fillText('QS/ngày', totalX + 31, tableTop + 54);

    dates.forEach((dateRow, rowIndex) => {
      const y = tableTop + headerRowHeight + subHeaderHeight + rowIndex * rowHeight;
      ctx.fillStyle = rowIndex % 2 === 0 ? '#ffffff' : '#f8fafc';
      ctx.fillRect(tableLeft, y, tableWidth, rowHeight);
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(tableLeft, y, dateWidth, rowHeight);
      ctx.font = '600 14px Arial, sans-serif';
      ctx.fillStyle = '#334155';
      ctx.fillText(formatDateDDMMYYYY(dateRow.date), tableLeft + 10, y + 28);

      teams.forEach((team, teamIndex) => {
        const row = dateRow.cells[team.teamKey];
        const values = row?.reported
          ? [String(row.morning ?? 0), String(row.afternoon ?? 0), String(row.evening ?? 0), String(row.dailyHeadcount ?? 0)]
          : ['—', '—', '—', '—'];
        values.forEach((value, metricIndex) => {
          const x = tableLeft + dateWidth + teamIndex * teamWidth + metricIndex * metricWidth;
          ctx.strokeRect(x, y, metricWidth, rowHeight);
          ctx.font = metricIndex === 3 ? '700 14px Arial, sans-serif' : '500 14px Arial, sans-serif';
          ctx.fillStyle = row?.reported ? '#334155' : '#94a3b8';
          const w = ctx.measureText(value).width;
          ctx.fillText(value, x + (metricWidth - w) / 2, y + 28);
        });
      });
      ctx.fillStyle = '#eff6ff';
      ctx.fillRect(totalX, y, totalWidth, rowHeight);
      ctx.strokeStyle = '#dbeafe';
      ctx.strokeRect(totalX, y, totalWidth, rowHeight);
      ctx.fillStyle = '#1e3a8a';
      ctx.font = '700 14px Arial, sans-serif';
      const dailyTotalText = String(dateRow.totalDailyHeadcount);
      ctx.fillText(dailyTotalText, totalX + (totalWidth - ctx.measureText(dailyTotalText).width) / 2, y + 28);
    });

    const totalRowY = tableTop + headerRowHeight + subHeaderHeight + dates.length * rowHeight;
    ctx.fillStyle = '#dbeafe';
    ctx.fillRect(tableLeft, totalRowY, tableWidth, rowHeight);
    ctx.strokeStyle = '#93c5fd';
    ctx.strokeRect(tableLeft, totalRowY, dateWidth, rowHeight);
    ctx.fillStyle = '#1e3a8a';
    ctx.font = '700 14px Arial, sans-serif';
    ctx.fillText('TỔNG', tableLeft + 10, totalRowY + 28);
    teams.forEach((team, teamIndex) => {
      const total = matrix.teamTotals[team.teamKey] || { morning: 0, afternoon: 0, evening: 0, dailyHeadcount: 0 };
      [total.morning, total.afternoon, total.evening, total.dailyHeadcount].forEach((value, metricIndex) => {
        const x = tableLeft + dateWidth + teamIndex * teamWidth + metricIndex * metricWidth;
        ctx.strokeRect(x, totalRowY, metricWidth, rowHeight);
        const text = String(value);
        ctx.fillText(text, x + (metricWidth - ctx.measureText(text).width) / 2, totalRowY + 28);
      });
    });
    ctx.fillStyle = '#bfdbfe';
    ctx.fillRect(totalX, totalRowY, totalWidth, rowHeight);
    ctx.strokeRect(totalX, totalRowY, totalWidth, rowHeight);
    ctx.fillStyle = '#1e3a8a';
    const grandText = String(matrix.grandDailyHeadcount);
    ctx.fillText(grandText, totalX + (totalWidth - ctx.measureText(grandText).width) / 2, totalRowY + 28);

    ctx.font = '500 13px Arial, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('0 = đã báo bằng 0 · — = chưa báo · Cột Tổng QS/ngày cộng các đội · Dòng TỔNG cộng theo cột.', left, height - 28);

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

const downloadDataUrl = (dataUrl: string, fileName: string) => {
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
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate || initialStartDate);
  const [projectFilter, setProjectFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [busy, setBusy] = useState<'text' | 'image' | 'download' | ''>('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setStartDate(initialStartDate);
    setEndDate(initialEndDate || initialStartDate);
    setMode(initialStartDate === (initialEndDate || initialStartDate) ? 'single' : 'range');
    setProjectFilter('all');
    setTeamFilter('all');
    setMessage('');
  }, [isOpen, initialStartDate, initialEndDate]);

  const effectiveEndDate = mode === 'single' ? startDate : endDate;
  const spanDays = dateSpanDays(startDate, effectiveEndDate);
  const rangeValid = spanDays > 0 && spanDays <= 93 && effectiveEndDate <= resolvedMaxDate;
  const allRows = useMemo(
    () => rangeValid ? buildCrewReportRows(projects, startDate, effectiveEndDate) : [],
    [projects, startDate, effectiveEndDate, rangeValid],
  );
  const teamOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of allRows) {
      if (projectFilter !== 'all' && row.projectId !== projectFilter) continue;
      map.set(row.teamKey, row.teamName);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'vi-VN', { numeric: true, sensitivity: 'base' }));
  }, [allRows, projectFilter]);
  const rows = useMemo(
    () => filterCrewReportRows(allRows, projectFilter, teamFilter),
    [allRows, projectFilter, teamFilter],
  );
  const dailySummary = useMemo(() => summarizeCrewReportRows(rows), [rows]);
  const reportMatrices = useMemo(() => buildCrewReportMatrices(rows), [rows]);
  const reportText = useMemo(() => buildCrewReportText({ rows, startDate, endDate: effectiveEndDate, title }), [rows, startDate, effectiveEndDate, title]);

  if (!isOpen) return null;

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setMessage('Đã sao chép nội dung báo cáo.');
    } catch (_) {
      setMessage('Không sao chép tự động được. Hãy dùng nút Chia sẻ nội dung.');
    }
  };

  const shareText = async () => {
    setBusy('text');
    setMessage('');
    try {
      const result = await sharePreparedContent({ title, text: reportText });
      if (result.status === 'shared') setMessage('Đã mở bảng chia sẻ nội dung báo cáo.');
      else if (result.status !== 'cancelled') setMessage('Không mở được bảng chia sẻ; bạn vẫn có thể sao chép nội dung.');
    } finally {
      setBusy('');
    }
  };

  const makeImages = async () => renderCrewReportImages({ rows, startDate, endDate: effectiveEndDate, title });

  const shareImages = async () => {
    setBusy('image');
    setMessage('');
    try {
      const attachments = await makeImages();
      const result = await sharePreparedContent({
        title,
        text: `${title}\n${startDate === effectiveEndDate ? formatDateDDMMYYYY(startDate) : `${formatDateDDMMYYYY(startDate)} → ${formatDateDDMMYYYY(effectiveEndDate)}`}`,
        attachments,
        allowTextFallback: true,
      });
      if (attachments.length > 6) setMessage(`Báo cáo có ${attachments.length} trang ảnh; hệ thống chia sẻ tối đa 6 ảnh/lần. Có thể dùng “Tải ảnh” để lấy đủ các trang.`);
      else if (result.status === 'shared') setMessage('Đã mở bảng chia sẻ ảnh báo cáo.');
      else if (result.status !== 'cancelled') setMessage('Thiết bị không hỗ trợ chia sẻ ảnh trực tiếp; có thể dùng “Tải ảnh”.');
    } finally {
      setBusy('');
    }
  };

  const downloadImages = async () => {
    setBusy('download');
    setMessage('');
    try {
      const attachments = await makeImages();
      attachments.forEach((attachment, index) => window.setTimeout(() => downloadDataUrl(attachment.dataUrl, attachment.fileName), index * 120));
      setMessage(`Đã tạo ${attachments.length} ảnh báo cáo.`);
    } finally {
      setBusy('');
    }
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
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setMode('single'); setEndDate(startDate); }} className={`rounded-xl px-3 py-2 text-xs font-extrabold ${mode === 'single' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>1 ngày</button>
              <button type="button" onClick={() => setMode('range')} className={`rounded-xl px-3 py-2 text-xs font-extrabold ${mode === 'range' ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Nhiều ngày</button>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[10px] font-bold text-slate-500">
              <span className="mb-1 block">{mode === 'single' ? 'Ngày báo cáo' : 'Từ ngày'}</span>
              <input type="date" value={startDate} max={resolvedMaxDate} disabled={rangeLocked} onChange={(event) => { setStartDate(event.target.value); if (mode === 'single') setEndDate(event.target.value); }} className="w-full bg-transparent text-sm font-extrabold text-slate-800 outline-none disabled:opacity-70" />
            </label>
            {mode === 'range' && (
              <label className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-[10px] font-bold text-slate-500">
                <span className="mb-1 block">Đến ngày</span>
                <input type="date" value={endDate} min={startDate} max={resolvedMaxDate} disabled={rangeLocked} onChange={(event) => setEndDate(event.target.value)} className="w-full bg-transparent text-sm font-extrabold text-slate-800 outline-none disabled:opacity-70" />
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
                <div className="max-h-[42vh] overflow-auto">
                  <table className="w-full text-left text-xs" style={{ minWidth: `${Math.max(570, 230 + matrix.teams.length * 248)}px` }}>
                    <thead className="sticky top-0 z-[1] bg-slate-100 text-[9.5px] font-black text-slate-500">
                      <tr>
                        <th rowSpan={2} className="sticky left-0 z-[2] min-w-[118px] border-r border-slate-200 bg-slate-100 px-3 py-2 align-middle">Ngày</th>
                        {matrix.teams.map((team) => <th key={team.teamKey} colSpan={4} className="border-r border-slate-200 px-2 py-2 text-center text-slate-700">{team.teamName}</th>)}
                        <th rowSpan={2} className="min-w-[110px] border-r border-slate-200 bg-blue-50 px-2 py-2 text-center align-middle text-blue-800">Tổng QS/ngày</th>
                      </tr>
                      <tr>
                        {matrix.teams.flatMap((team) => ['Sáng', 'Chiều', 'Tối', 'QS ngày'].map((label) => <th key={`${team.teamKey}-${label}`} className="min-w-[62px] border-r border-slate-200 px-2 py-1.5 text-center">{label}</th>))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {matrix.dates.map((dateRow) => (
                        <tr key={`${matrix.projectId}-${dateRow.date}`} className="bg-white">
                          <td className="sticky left-0 z-[1] border-r border-slate-100 bg-white px-3 py-2 font-bold text-slate-700">{formatDateDDMMYYYY(dateRow.date)}</td>
                          {matrix.teams.flatMap((team) => {
                            const row = dateRow.cells[team.teamKey];
                            return [
                              <td key={`${team.teamKey}-m`} className="border-r border-slate-100 px-2 py-2 text-center tabular-nums">{row?.reported ? formatCell(row.morning, true) : '—'}</td>,
                              <td key={`${team.teamKey}-a`} className="border-r border-slate-100 px-2 py-2 text-center tabular-nums">{row?.reported ? formatCell(row.afternoon, true) : '—'}</td>,
                              <td key={`${team.teamKey}-e`} className="border-r border-slate-100 px-2 py-2 text-center tabular-nums">{row?.reported ? formatCell(row.evening, true) : '—'}</td>,
                              <td key={`${team.teamKey}-d`} className={`border-r border-slate-100 px-2 py-2 text-center font-black tabular-nums ${row?.reported ? 'text-slate-900' : 'text-amber-600'}`}>{row?.reported ? formatCell(row.dailyHeadcount, true) : '—'}</td>,
                            ];
                          })}
                          <td className="border-r border-blue-100 bg-blue-50/60 px-2 py-2 text-center font-black tabular-nums text-blue-900">{dateRow.totalDailyHeadcount}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-blue-200 bg-blue-50 font-black text-blue-950">
                        <td className="sticky left-0 z-[1] border-r border-blue-200 bg-blue-50 px-3 py-2">TỔNG</td>
                        {matrix.teams.flatMap((team) => {
                          const total = matrix.teamTotals[team.teamKey] || { morning: 0, afternoon: 0, evening: 0, dailyHeadcount: 0 };
                          return [total.morning, total.afternoon, total.evening, total.dailyHeadcount].map((value, index) => (
                            <td key={`${team.teamKey}-total-${index}`} className="border-r border-blue-100 px-2 py-2 text-center tabular-nums">{value}</td>
                          ));
                        })}
                        <td className="border-r border-blue-200 bg-blue-100 px-2 py-2 text-center tabular-nums">{matrix.grandDailyHeadcount}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            ))}
            {rows.length === 0 && <div className="rounded-2xl border border-slate-200 px-4 py-8 text-center text-xs text-slate-400">Không có đội hoặc dữ liệu phù hợp phạm vi đã chọn.</div>}
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[10.5px] leading-4 text-blue-700">
            <Users className="mr-1 inline h-3.5 w-3.5" /> 0 = đã báo bằng 0. — = chưa báo. Tổng QS/ngày cộng QS ngày của các đội; dòng TỔNG cộng theo cột. Ô tổng cuối là lượt người-ngày của cả khoảng.
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <button type="button" disabled={!rangeValid || rows.length === 0 || Boolean(busy)} onClick={copyText} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Copy className="h-4 w-4" /> Sao chép nội dung</button>
            <button type="button" disabled={!rangeValid || rows.length === 0 || Boolean(busy)} onClick={shareText} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-extrabold text-white hover:bg-slate-800 disabled:opacity-40"><FileText className="h-4 w-4" /> {busy === 'text' ? 'Đang chuẩn bị...' : 'Chia sẻ nội dung'}</button>
            <button type="button" disabled={!rangeValid || rows.length === 0 || Boolean(busy)} onClick={shareImages} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-extrabold text-white hover:bg-emerald-700 disabled:opacity-40"><ImageIcon className="h-4 w-4" /> {busy === 'image' ? 'Đang tạo ảnh...' : 'Chia sẻ ảnh'}</button>
            <button type="button" disabled={!rangeValid || rows.length === 0 || Boolean(busy)} onClick={downloadImages} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-extrabold text-blue-700 hover:bg-blue-100 disabled:opacity-40"><Download className="h-4 w-4" /> {busy === 'download' ? 'Đang tạo ảnh...' : 'Tải ảnh'}</button>
          </div>
          {message && <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{message}</div>}
        </div>
      </div>
    </div>
  );
};
