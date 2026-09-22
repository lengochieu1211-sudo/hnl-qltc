import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Copy, Download, FileText, Image as ImageIcon, Share2, Users, X } from 'lucide-react';
import type { ShareAttachmentPayload } from '../utils/shareUtils';
import { sharePreparedContent } from '../utils/shareUtils';
import {
  buildCrewReportRows,
  buildCrewReportText,
  filterCrewReportRows,
  listCrewReportDates,
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

const wrapCanvasText = (ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string[] => {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = words[0];
  for (let index = 1; index < words.length; index += 1) {
    const candidate = `${current} ${words[index]}`;
    if (ctx.measureText(candidate).width <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = words[index];
    }
  }
  lines.push(current);
  return lines.slice(0, 2);
};

async function renderCrewReportImages(params: {
  rows: CrewReportRow[];
  startDate: string;
  endDate: string;
  title: string;
}): Promise<ShareAttachmentPayload[]> {
  if (typeof document === 'undefined') return [];
  const PAGE_ROWS = 22;
  const pages: CrewReportRow[][] = [];
  for (let index = 0; index < params.rows.length; index += PAGE_ROWS) pages.push(params.rows.slice(index, index + PAGE_ROWS));
  if (pages.length === 0) pages.push([]);

  const attachments: ShareAttachmentPayload[] = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const pageRows = pages[pageIndex];
    const width = 1280;
    const rowHeight = 48;
    const headerHeight = 190;
    const tableHeaderHeight = 54;
    const footerHeight = 72;
    const height = headerHeight + tableHeaderHeight + Math.max(1, pageRows.length) * rowHeight + footerHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 34px Arial, sans-serif';
    ctx.fillText(params.title, 46, 58);
    ctx.font = '600 20px Arial, sans-serif';
    ctx.fillStyle = '#334155';
    const rangeText = params.startDate === params.endDate
      ? `Ngày ${formatDateDDMMYYYY(params.startDate)}`
      : `${formatDateDDMMYYYY(params.startDate)} → ${formatDateDDMMYYYY(params.endDate)}`;
    ctx.fillText(rangeText, 46, 96);
    const projectNames = Array.from(new Set(params.rows.map((row) => row.projectName)));
    ctx.font = '500 18px Arial, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(projectNames.length > 1 ? `${projectNames.length} dự án` : (projectNames[0] || 'Dự án'), 46, 130);
    ctx.fillText(`Trang ${pageIndex + 1}/${pages.length}`, width - 150, 58);
    ctx.fillStyle = '#eff6ff';
    ctx.fillRect(46, 150, width - 92, 3);

    const columns = [
      { label: 'Ngày', x: 46, w: 125 },
      { label: 'Dự án', x: 171, w: 230 },
      { label: 'Đội', x: 401, w: 300 },
      { label: 'Sáng', x: 701, w: 105 },
      { label: 'Chiều', x: 806, w: 105 },
      { label: 'Tối', x: 911, w: 105 },
      { label: 'QS ngày', x: 1016, w: 118 },
      { label: 'Tình trạng', x: 1134, w: 100 },
    ];
    const tableTop = headerHeight;
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(46, tableTop, width - 92, tableHeaderHeight);
    ctx.font = '700 16px Arial, sans-serif';
    ctx.fillStyle = '#334155';
    columns.forEach((column) => ctx.fillText(column.label, column.x + 8, tableTop + 34));

    pageRows.forEach((row, index) => {
      const y = tableTop + tableHeaderHeight + index * rowHeight;
      ctx.fillStyle = index % 2 === 0 ? '#ffffff' : '#f8fafc';
      ctx.fillRect(46, y, width - 92, rowHeight);
      ctx.strokeStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(46, y + rowHeight);
      ctx.lineTo(width - 46, y + rowHeight);
      ctx.stroke();
      ctx.font = '500 15px Arial, sans-serif';
      ctx.fillStyle = '#334155';
      ctx.fillText(formatDateDDMMYYYY(row.date), columns[0].x + 8, y + 30);
      const projectLines = wrapCanvasText(ctx, row.projectName, columns[1].w - 16);
      ctx.fillText(projectLines[0], columns[1].x + 8, y + 21);
      if (projectLines[1]) ctx.fillText(projectLines[1], columns[1].x + 8, y + 39);
      const teamLines = wrapCanvasText(ctx, row.teamName, columns[2].w - 16);
      ctx.fillText(teamLines[0], columns[2].x + 8, y + 21);
      if (teamLines[1]) ctx.fillText(teamLines[1], columns[2].x + 8, y + 39);
      ctx.fillText(formatCell(row.morning, row.reported), columns[3].x + 8, y + 30);
      ctx.fillText(formatCell(row.afternoon, row.reported), columns[4].x + 8, y + 30);
      ctx.fillText(formatCell(row.evening, row.reported), columns[5].x + 8, y + 30);
      ctx.fillText(formatCell(row.dailyHeadcount, row.reported), columns[6].x + 8, y + 30);
      ctx.fillStyle = row.reported ? '#047857' : '#b45309';
      ctx.font = '700 14px Arial, sans-serif';
      ctx.fillText(row.reported ? 'Đã báo' : 'Chưa báo', columns[7].x + 8, y + 30);
    });

    const summary = summarizeCrewReportRows(params.rows);
    const totalReported = summary.reduce((sum, item) => sum + item.reportedTeams, 0);
    const totalMissing = summary.reduce((sum, item) => sum + item.missingTeams, 0);
    ctx.font = '500 15px Arial, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText(`Đội/ngày đã báo: ${totalReported}${totalMissing ? ` · Chưa báo: ${totalMissing}` : ''}`, 46, height - 36);
    ctx.fillText('Quân số ngày lấy mức cao nhất của từng đội; không cộng chồng Sáng/Chiều/Tối.', 480, height - 36);

    const dataUrl = canvas.toDataURL('image/png');
    attachments.push({
      id: `crew-report-${pageIndex + 1}`,
      fileName: `HNL-QLTC-${sanitizeFilePart(params.title)}-${params.startDate}-${params.endDate}-trang-${pageIndex + 1}.png`,
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
  title = 'HNL QLTC – Báo cáo quân số',
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
  const reportText = useMemo(() => buildCrewReportText({ rows, startDate, endDate: effectiveEndDate, title }), [rows, startDate, effectiveEndDate, title]);

  if (!isOpen) return null;

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setMessage('Đã sao chép nội dung báo cáo.');
    } catch (_) {
      setMessage('Không sao chép tự động được. Hãy dùng nút Chia sẻ text.');
    }
  };

  const shareText = async () => {
    setBusy('text');
    setMessage('');
    try {
      const result = await sharePreparedContent({ title, text: reportText });
      if (result.status === 'shared') setMessage('Đã mở bảng chia sẻ báo cáo text.');
      else if (result.status !== 'cancelled') setMessage('Không mở được chia sẻ tự động; nội dung vẫn có thể sao chép.');
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
      setMessage(`Đã tạo ${attachments.length} ảnh PNG báo cáo.`);
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
            <p className="mt-0.5 text-[10.5px] text-slate-500">Chọn 1 ngày hoặc nhiều ngày, lọc dự án/đội và gửi dạng text hoặc ảnh PNG.</p>
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

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="max-h-[42vh] overflow-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 text-[10px] font-black uppercase tracking-wide text-slate-500">
                  <tr><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Dự án</th><th className="px-3 py-2">Đội</th><th className="px-3 py-2 text-center">Sáng</th><th className="px-3 py-2 text-center">Chiều</th><th className="px-3 py-2 text-center">Tối</th><th className="px-3 py-2 text-center">QS ngày</th><th className="px-3 py-2">Tình trạng</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={`${row.projectId}-${row.date}-${row.teamKey}`} className="bg-white">
                      <td className="px-3 py-2 font-bold text-slate-700">{formatDateDDMMYYYY(row.date)}</td>
                      <td className="px-3 py-2 text-slate-600">{row.projectName}</td>
                      <td className="px-3 py-2 font-extrabold text-slate-800">{row.teamName}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{formatCell(row.morning, row.reported)}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{formatCell(row.afternoon, row.reported)}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{formatCell(row.evening, row.reported)}</td>
                      <td className="px-3 py-2 text-center font-black tabular-nums text-slate-900">{formatCell(row.dailyHeadcount, row.reported)}</td>
                      <td className={`px-3 py-2 font-extrabold ${row.reported ? 'text-emerald-700' : 'text-amber-700'}`}>{row.reported ? 'Đã báo' : 'Chưa báo'}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Không có đội hoặc dữ liệu phù hợp phạm vi đã chọn.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[10.5px] leading-4 text-blue-700">
            <Users className="mr-1 inline h-3.5 w-3.5" /> `0` nghĩa là đội đã báo quân số bằng 0. `Chưa báo` nghĩa là chưa có bản ghi của đội trong ngày đó. Sáng/Chiều/Tối không cộng chồng thành một người/ngày.
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <button type="button" disabled={!rangeValid || rows.length === 0 || Boolean(busy)} onClick={copyText} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Copy className="h-4 w-4" /> Sao chép text</button>
            <button type="button" disabled={!rangeValid || rows.length === 0 || Boolean(busy)} onClick={shareText} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-extrabold text-white hover:bg-slate-800 disabled:opacity-40"><FileText className="h-4 w-4" /> {busy === 'text' ? 'Đang chuẩn bị...' : 'Chia sẻ text'}</button>
            <button type="button" disabled={!rangeValid || rows.length === 0 || Boolean(busy)} onClick={shareImages} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-extrabold text-white hover:bg-emerald-700 disabled:opacity-40"><ImageIcon className="h-4 w-4" /> {busy === 'image' ? 'Đang tạo ảnh...' : 'Chia sẻ ảnh'}</button>
            <button type="button" disabled={!rangeValid || rows.length === 0 || Boolean(busy)} onClick={downloadImages} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-extrabold text-blue-700 hover:bg-blue-100 disabled:opacity-40"><Download className="h-4 w-4" /> {busy === 'download' ? 'Đang tạo ảnh...' : 'Tải ảnh PNG'}</button>
          </div>
          {message && <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{message}</div>}
        </div>
      </div>
    </div>
  );
};
