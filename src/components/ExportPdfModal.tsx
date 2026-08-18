import { downloadOrShareFile } from '../utils/downloadUtils';
import React, { useState, useEffect } from 'react';
import { FileText, Download, Printer, X, CheckCircle2, Filter, Mail, Package, BarChart3, Building2, ClipboardCheck, FileSpreadsheet, Users, Copy, HelpCircle, Camera, Image as ImageIcon } from 'lucide-react';
import { InventoryItem, WorkVolume, DefectItem, ChecklistItem, FloorPlan, RoomProgressItem, MaterialNorm, CrewRecord, TeamInfo } from '../types';
import { exportAllToExcel, exportAllToExcelBase64, exportTeamStatisticsToExcel } from '../utils/excelExport';
import { formatDateDDMMYYYY, formatDateTime, formatFloorName } from '../utils/dateFormatter';
import { getRoomColorStyle } from '../utils/colorPalette';
import { getDefectOverdueInfo } from '../utils/defectUtils';
import { formatDecimal, useFormatSettings } from '../utils/numberUtils';
import { getProjectPhotos, getPhotoDataUrl } from '../utils/photoStorage';
import { computeDefectLabelPositions, computeRoomLabelPositions } from '../utils/pdfMapUtils';
import { canViewFinancials, getCurrentUserRole, UserRole } from '../utils/securityUtils';
import { apiFetch, hasApiBackend } from '../utils/api';
import { saveHtmlPdf } from '../utils/fileExport';

interface ExportPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  contractorName?: string;
  inspectorName?: string;
  activeProjectId?: string;
  userRole?: UserRole;
  inventory?: InventoryItem[];
  materialNorms?: MaterialNorm[];
  workVolumes?: WorkVolume[];
  defects: DefectItem[];
  checklist: ChecklistItem[];
  floorPlans: FloorPlan[];
  roomProgressList?: RoomProgressItem[];
  crewRecords?: CrewRecord[];
  teams?: TeamInfo[];
}

export const ExportPdfModal: React.FC<ExportPdfModalProps> = ({
  isOpen,
  onClose,
  projectName,
  contractorName,
  inspectorName,
  activeProjectId,
  userRole,
  inventory = [],
  materialNorms = [],
  workVolumes = [],
  defects = [],
  checklist = [],
  floorPlans = [],
  roomProgressList = [],
  crewRecords = [],
  teams = [],
}) => {
  const effectiveRole = userRole || getCurrentUserRole();
  const hasFinancialAccess = canViewFinancials(effectiveRole);
  const [selectedFloors, setSelectedFloors] = useState<string[]>(['all']);
  useFormatSettings();
  const [copiedText, setCopiedText] = useState(false);
  const [copiedExcelBase64, setCopiedExcelBase64] = useState(false);
  const [copiedHtmlReport, setCopiedHtmlReport] = useState(false);

  // States for uploading directly to Google Drive (APK rescue)
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [uploadExcelLink, setUploadExcelLink] = useState<string | null>(null);
  const [uploadPdfLink, setUploadPdfLink] = useState<string | null>(null);
  const [driveUploadError, setDriveUploadError] = useState<string | null>(null);

  // Module checkboxes
  const [includeWarehouse, setIncludeWarehouse] = useState(true);
  const [includeWorkVolumes, setIncludeWorkVolumes] = useState(true);
  const [includeFloorPlan, setIncludeFloorPlan] = useState(true);
  const [includeChecklist, setIncludeChecklist] = useState(true);
  const [includeCrew, setIncludeCrew] = useState(true);
  const [includeCrewPhotos, setIncludeCrewPhotos] = useState(true);
  const [includeDefectPhotos, setIncludeDefectPhotos] = useState(true);
  const [includeSignatures, setIncludeSignatures] = useState(true);
  const [skipEmptyFloors, setSkipEmptyFloors] = useState(false);
  const [onlyDefectMapIfHasDefects, setOnlyDefectMapIfHasDefects] = useState(true);
  const [pdfPaperSize, setPdfPaperSize] = useState<'A4' | 'A3'>('A4');
  const [pdfOrientation, setPdfOrientation] = useState<'portrait' | 'landscape'>('portrait');

  // Photos loaded asynchronously from local storage for report attachments
  const [crewPhotosMap, setCrewPhotosMap] = useState<Record<string, string[]>>({});
  const [defectPhotosMap, setDefectPhotosMap] = useState<Record<string, { before: string[]; after: string[] }>>({});

  useEffect(() => {
    if (!isOpen || !activeProjectId) return;
    let isMounted = true;

    async function loadPhotos() {
      try {
        const photos = await getProjectPhotos(activeProjectId);
        const cMap: Record<string, string[]> = {};
        const dMap: Record<string, { before: string[]; after: string[] }> = {};

        for (const p of photos) {
          if (!p.id || p.deleted) continue;
          const url = await getPhotoDataUrl(p.id, p.localUri, false);
          if (!url) continue;

          if (p.entityType === 'crewRecord' && p.entityId) {
            if (!cMap[p.entityId]) cMap[p.entityId] = [];
            cMap[p.entityId].push(url);
          } else if (p.entityType === 'defect' && p.entityId) {
            if (!dMap[p.entityId]) dMap[p.entityId] = { before: [], after: [] };
            if (p.category === 'defect_after') {
              dMap[p.entityId].after.push(url);
            } else {
              dMap[p.entityId].before.push(url);
            }
          }
        }

        if (isMounted) {
          setCrewPhotosMap(cMap);
          setDefectPhotosMap(dMap);
        }
      } catch (err) {
        console.warn('Failed to load photos for export:', err);
      }
    }

    loadPhotos();
    return () => { isMounted = false; };
  }, [isOpen, activeProjectId]);

  if (!isOpen) return null;

  // Only take declared floor names (from floorPlans list)
  const floorNames = Array.from(new Set(floorPlans.map((fp) => fp.floorName)));
  const isAllSelected = selectedFloors.includes('all');

  const handleToggleFloor = (floorName: string) => {
    if (floorName === 'all') {
      if (isAllSelected) {
        setSelectedFloors(floorNames.length > 0 ? [floorNames[0]] : []);
      } else {
        setSelectedFloors(['all']);
      }
    } else {
      let next = selectedFloors.filter((f) => f !== 'all');
      if (next.includes(floorName)) {
        next = next.filter((f) => f !== floorName);
      } else {
        next.push(floorName);
      }
      if (next.length === 0 || next.length === floorNames.length) {
        setSelectedFloors(['all']);
      } else {
        setSelectedFloors(next);
      }
    }
  };

  const filteredDefects = defects.filter((d) => {
    if (floorNames.length > 0 && !floorNames.includes(d.floorName)) return false;
    if (isAllSelected) return true;
    return selectedFloors.includes(d.floorName);
  });

  // One stable defect sequence is shared by the floor-plan marker, legend and defect table.
  // Never derive marker numbers independently from array indexes in different sections.
  const defectsWithDisplayCode = filteredDefects
    .slice()
    .sort((a, b) => {
      const floorCmp = String(a.floorName || '').localeCompare(String(b.floorName || ''), 'vi', { numeric: true, sensitivity: 'base' });
      if (floorCmp !== 0) return floorCmp;
      const roomCmp = String(a.roomId || '').localeCompare(String(b.roomId || ''), 'vi', { numeric: true, sensitivity: 'base' });
      if (roomCmp !== 0) return roomCmp;
      const yCmp = (Number(a.y) || 0) - (Number(b.y) || 0);
      if (Math.abs(yCmp) > 0.01) return yCmp;
      const xCmp = (Number(a.x) || 0) - (Number(b.x) || 0);
      if (Math.abs(xCmp) > 0.01) return xCmp;
      const dateCmp = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      if (dateCmp !== 0) return dateCmp;
      return String(a.id || '').localeCompare(String(b.id || ''));
    })
    .map((d, index, all) => {
      const markerDigits = all.length >= 100 ? 3 : 2;
      const markerCode = String(index + 1).padStart(markerDigits, '0');
      return {
        ...d,
        markerNumber: index + 1,
        markerCode,
        displayCode: `DF-${String(index + 1).padStart(3, '0')}`,
      };
    });

  const filteredChecklist = checklist.filter((c) => {
    if (floorNames.length > 0 && !floorNames.includes(c.floorName)) return false;
    if (isAllSelected) return true;
    return selectedFloors.includes(c.floorName);
  });

  const filteredRooms = roomProgressList.filter((r) => {
    const fp = floorPlans.find(f => f.id === r.floorId);
    if (!fp) return false;
    if (isAllSelected) return true;
    return selectedFloors.includes(fp.floorName);
  });

  const filteredCrew = crewRecords.filter((c) => {
    if (!c.floorName) return true;
    const cFloors = c.floorName.split(',').map(s => s.trim()).filter(Boolean);
    const hasAnyValidFloor = cFloors.some(f => floorNames.includes(f));
    if (cFloors.length > 0 && !hasAnyValidFloor) return false;
    if (isAllSelected) return true;
    return cFloors.some(f => selectedFloors.includes(f));
  }).sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.teamName.localeCompare(b.teamName);
  });

  const passedCount = filteredChecklist.filter((c) => c.status === 'passed').length;
  const passRate = filteredChecklist.length > 0 ? Math.round((passedCount / filteredChecklist.length) * 100) : 0;
  const openDefectsCount = filteredDefects.filter((d) => d.status !== 'Đã nghiệm thu').length;

  const displayContractor = contractorName && contractorName.trim() ? contractorName.trim() : '—';
  const displayInspector = inspectorName && inspectorName.trim() ? inspectorName.trim() : '—';

  // High-fidelity HTML Report Generator
  const getReportHtml = (): string => {
    const areaText = isAllSelected ? 'Toàn bộ công trình' : selectedFloors.join(', ');

    // Target floor plans to include
    const targetFloorPlans = (isAllSelected ? floorPlans : floorPlans.filter(fp => selectedFloors.includes(fp.floorName)))
      .filter(fp => {
        if (!skipEmptyFloors) return true;
        const fpRooms = roomProgressList.filter(r => r.floorId === fp.id);
        const fpDefects = defectsWithDisplayCode.filter(d => d.floorName === fp.floorName || d.floorId === fp.id);
        return fpRooms.length > 0 || fpDefects.length > 0;
      });

    return `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <title>Báo Cáo Tổng Hợp Thi Công &amp; Nghiệm Thu - ${projectName || 'Công Trình'}</title>
        <style>
          @page { size: ${pdfPaperSize} ${pdfOrientation}; margin: 10mm 10mm 12mm 10mm; }
          * { box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 0; padding: 12px; color: #0f172a; line-height: 1.4; background: #fff; font-size: 10px; }
          .header { border-bottom: 2.5px solid #4f46e5; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-start; }
          .header h1 { margin: 0; color: #1e1b4b; font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: -0.2px; }
          .header p { margin: 2px 0 0; color: #475569; font-size: 10.5px; }
          .badge { display: inline-block; max-width: 100%; padding: 2px 5px; border-radius: 4px; font-weight: 700; font-size: 8.8px; white-space: normal; word-break: break-word; overflow-wrap: anywhere; line-height: 1.25; text-align: center; vertical-align: middle; }
          .badge-passed { background-color: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
          .badge-defect { background-color: #ffe4e6; color: #9f1239; border: 1px solid #fecdd3; }
          .badge-pending { background-color: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
          .summary-box { display: flex; gap: 8px; margin-bottom: 14px; }
          .card { flex: 1; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; background: #f8fafc; text-align: center; }
          .card h3 { margin: 0; font-size: 15px; color: #0f172a; font-weight: 800; }
          .card p { margin: 2px 0 0; font-size: 8.5px; color: #64748b; font-weight: 700; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 9.5px; page-break-inside: auto; table-layout: fixed; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          th { background-color: #1e293b; color: #ffffff; text-align: left; padding: 5px 7px; font-weight: 700; border: 1px solid #0f172a; word-break: normal; overflow-wrap: break-word; white-space: normal; }
          td { padding: 5px 7px; border: 1px solid #cbd5e1; word-break: break-word; overflow-wrap: anywhere; white-space: normal; vertical-align: top; line-height: 1.3; height: auto; }
          .status-cell { text-align: center; vertical-align: middle; white-space: normal; word-break: break-word; overflow-wrap: anywhere; }
          .wrap-cell { white-space: normal; word-break: break-word; overflow-wrap: anywhere; line-height: 1.3; }
          .map-legend td, .map-legend th { padding: 4px 5px; }
          tr:nth-child(even) { background-color: #f8fafc; }
          .section-title { font-size: 12px; font-weight: 800; margin-top: 14px; margin-bottom: 8px; color: #1e1b4b; border-left: 4px solid #4f46e5; padding-left: 8px; background: #f1f5f9; padding-top: 4px; padding-bottom: 4px; page-break-after: avoid; break-after: avoid; text-transform: uppercase; }
          .footer { font-size: 8.5px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 6px; margin-top: 20px; }
          .page-break-avoid { page-break-inside: avoid; break-inside: avoid; }
          @media print {
            body { padding: 0; }
            .no-print { display: none !important; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="background: #eff6ff; border: 1.5px solid #bfdbfe; color: #1e3a8a; padding: 12px 16px; border-radius: 10px; margin-bottom: 18px; font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div style="font-size: 13px; font-weight: 800; color: #1d4ed8; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
            📥 HƯỚNG DẪN LƯU / TẢI BÁO CÁO DẠNG FILE PDF:
          </div>
          <div style="font-weight: 500; line-height: 1.5; color: #1e40af;">
            Ở bảng in vừa xuất hiện, tại mục <strong>"Máy in đích" (Destination)</strong>, chọn <strong>"Lưu dưới dạng PDF" (Save as PDF)</strong>, sau đó nhấn nút <strong>"Lưu" (Save)</strong> để tải file báo cáo về máy.
          </div>
        </div>

        <div class="header">
          <div>
            <h1>Báo Cáo Tổng Hợp Thi Công &amp; Nghiệm Thu</h1>
            <p><strong>Dự án:</strong> ${projectName || '—'} | <strong>Khu vực:</strong> ${areaText}</p>
            ${displayContractor !== '—' ? `<p><strong>Đơn vị thi công:</strong> ${displayContractor}</p>` : ''}
            ${displayInspector !== '—' ? `<p><strong>Kỹ sư phụ trách:</strong> ${displayInspector}</p>` : ''}
          </div>
          <div style="text-align: right;">
            <p><strong>Ngày xuất:</strong> ${formatDateTime(new Date())}</p>
            <p style="color: #4f46e5; font-weight: bold;">Hệ Thống Quản Lý Thi Công &amp; Nghiệm Thu</p>
          </div>
        </div>

        <div class="summary-box">
          ${includeWarehouse ? `
            <div class="card">
              <h3>${inventory.length}</h3>
              <p>Mặt hàng kho</p>
            </div>
          ` : ''}
          ${includeWorkVolumes ? `
            <div class="card">
              <h3 style="color: #2563eb;">${workVolumes.length}</h3>
              <p>Hạng mục thi công</p>
            </div>
          ` : ''}
          ${includeFloorPlan ? `
            <div class="card">
              <h3 style="color: #4f46e5;">${filteredRooms.length}</h3>
              <p>Khu vực / Phòng</p>
            </div>
            <div class="card">
              <h3 style="color: #e11d48;">${filteredDefects.length}</h3>
              <p>Lỗi Defect</p>
            </div>
          ` : ''}
          ${includeChecklist ? `
            <div class="card">
              <h3 style="color: #059669;">${passRate}%</h3>
              <p>Đạt Checklist</p>
            </div>
          ` : ''}
          ${includeCrew ? `
            <div class="card">
              <h3 style="color: #4f46e5;">${filteredCrew.reduce((sum, c) => sum + c.workerCount, 0)}</h3>
              <p>TỔNG LƯỢT NHÂN CÔNG</p>
            </div>
          ` : ''}
        </div>

        ${includeWarehouse ? (inventory.length > 0 ? `
          <div class="section-title">📦 KHO VẬT TƯ &amp; TỒN KHO CÔNG TRÌNH</div>
          <table>
            <thead>
              <tr>
                <th style="width: 35px; text-align: center;">STT</th>
                <th>Mã / Tên Vật Tư</th>
                <th style="width: 60px; text-align: center;">ĐVT</th>
                <th style="width: 80px; text-align: right;">Tồn Kho</th>
                <th style="width: 110px;">Vị Trí Lưu Kho</th>
                <th style="width: 100px;">Trạng Thái</th>
              </tr>
            </thead>
            <tbody>
              ${inventory.map((item, idx) => `
                <tr>
                  <td style="text-align: center;">${idx + 1}</td>
                  <td><strong>${item.materialName || ''}</strong> ${item.id ? `<span style="color: #64748b;">(${item.id})</span>` : ''}</td>
                  <td style="text-align: center;">${item.unit || ''}</td>
                  <td style="text-align: right;"><strong>${formatDecimal(item.quantity)}</strong></td>
                  <td>${item.location || 'Kho chính'}</td>
                  <td><span class="badge badge-passed">✅ An Toàn</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `
          <div class="section-title">📦 KHO VẬT TƯ &amp; TỒN KHO CÔNG TRÌNH</div>
          <p style="color: #64748b; font-style: italic; margin-bottom: 16px;">Không có dữ liệu kho vật tư.</p>
        `) : ''}

        ${includeWorkVolumes ? (workVolumes.length > 0 ? `
          <div class="section-title">📊 KHỐI LƯỢNG THI CÔNG &amp; SẢN LƯỢNG</div>
          <table>
            <thead>
              <tr>
                <th style="width: 35px; text-align: center;">STT</th>
                <th>Hạng Mục Công Việc</th>
                <th style="width: 90px;">Phân Loại</th>
                <th style="width: 55px; text-align: center;">ĐVT</th>
                <th style="width: 80px; text-align: right;">KL Kế Hoạch</th>
                <th style="width: 80px; text-align: right;">KL Thực Hiện</th>
                ${hasFinancialAccess ? `
                <th style="width: 85px; text-align: right;">Đơn Giá (đ)</th>
                <th style="width: 95px; text-align: right;">Thành Tiền (đ)</th>
                ` : ''}
              </tr>
            </thead>
            <tbody>
              ${workVolumes.map((wv, idx) => `
                <tr>
                  <td style="text-align: center;">${idx + 1}</td>
                  <td><strong>${wv.title || ''}</strong></td>
                  <td>${wv.category || ''}</td>
                  <td style="text-align: center;">${wv.unit || ''}</td>
                  <td style="text-align: right;">${formatDecimal(wv.planned)}</td>
                  <td style="text-align: right; color: #2563eb; font-weight: bold;">${formatDecimal(wv.actual)}</td>
                  ${hasFinancialAccess ? `
                  <td style="text-align: right;">${formatDecimal(wv.unitPrice)}</td>
                  <td style="text-align: right; font-weight: bold;">${formatDecimal((wv.actual ?? 0) * (wv.unitPrice ?? 0))}</td>
                  ` : ''}
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `
          <div class="section-title">📊 KHỐI LƯỢNG THI CÔNG &amp; SẢN LƯỢNG</div>
          <p style="color: #64748b; font-style: italic; margin-bottom: 16px;">Không có dữ liệu khối lượng thi công.</p>
        `) : ''}

        ${includeFloorPlan && targetFloorPlans.length > 0 ? `
          <div class="section-title">🖼️ MẶT BẰNG HIGHLIGHT KHU VỰC / PHÒNG &amp; SƠ ĐỒ DEFECT</div>
          ${targetFloorPlans.map(fp => {
            const fpRooms = roomProgressList.filter(r => r.floorId === fp.id);
            const fpDefects = defectsWithDisplayCode.filter(d => d.floorName === fp.floorName || d.floorId === fp.id);
            const hasRooms = fpRooms.length > 0;
            const hasDefects = fpDefects.length > 0;

            if (!hasRooms && !hasDefects) {
              return `
                <div class="page-break-avoid" style="margin-bottom: 16px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; background: #f8fafc;">
                  <span style="font-weight: bold; color: #1e1b4b; font-size: 11px;">📍 Sơ đồ mặt bằng: ${formatFloorName(fp.floorName)}</span>
                  <span style="color: #64748b; font-size: 10px; margin-left: 8px;">(Chưa có khu vực/phòng được đánh dấu &amp; Không có Defect)</span>
                </div>
              `;
            }

            const roomPositions = computeRoomLabelPositions(
              fpRooms,
              fpDefects.map((d) => ({ x: d.x, y: d.y, radius: 1.4 }))
            );
            const defectPositions = computeDefectLabelPositions(
              fpDefects,
              roomPositions.filter((rp) => rp.showLabel).map((rp) => ({ x: rp.lx, y: rp.ly, radius: 2.2 }))
            );

            return `
              <div class="page-break-avoid" style="margin-bottom: 20px; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; background: #fff;">
                <h4 style="margin: 0 0 10px 0; font-size: 12.5px; color: #1e1b4b; font-weight: bold; border-bottom: 2px solid #4f46e5; padding-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                  <span>📍 Sơ đồ mặt bằng: <strong>${formatFloorName(fp.floorName)}</strong></span>
                  <span style="font-size: 10px; font-weight: normal; color: #475569;">(${fpRooms.length} khu vực/phòng, ${fpDefects.length} defect)</span>
                </h4>

                <div style="display: flex; flex-direction: column; gap: 14px;">
                  <!-- Highlight Map -->
                  <div style="width: 100%;">
                    <p style="margin: 0 0 6px 0; font-size: 10.5px; font-weight: bold; color: #4f46e5;">
                      1. Mặt Bằng Highlight Khu Vực / Phòng (${fpRooms.length} khu vực)
                    </p>

                    ${fp.imageUrl ? `
                      <div style="position: relative; width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #ffffff; margin-bottom: 8px; font-size: 0; line-height: 0;">
                        <img src="${fp.imageUrl}" style="width: 100%; height: auto; display: block; margin: 0 auto; vertical-align: top;" />

                        <svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible;" viewBox="0 0 100 100" preserveAspectRatio="none">
                          ${fpRooms.map((r, rIdx) => {
                            const { fill: bgCol, stroke: borderColor } = getRoomColorStyle(r, rIdx, 'palette');
                            if (r.points && r.points.length >= 2) {
                              const ptsStr = r.points.map(p => `${p.x},${p.y}`).join(' ');
                              if (r.isPolyline) {
                                return `<polyline points="${ptsStr}" fill="none" stroke="${borderColor}" stroke-width="0.35" stroke-linecap="round" stroke-linejoin="round" opacity="0.82" />`;
                              }
                              return `<polygon points="${ptsStr}" fill="${bgCol}" fill-opacity="0.16" stroke="${borderColor}" stroke-width="0.25" stroke-linejoin="round" />`;
                            }
                            return `<rect x="${r.x}" y="${r.y}" width="${r.width || 15}" height="${r.height || 15}" fill="${bgCol}" fill-opacity="0.16" stroke="${borderColor}" stroke-width="0.25" stroke-linejoin="round" rx="0.5" />`;
                          }).join('')}

                          <!-- Sleek Room Number Badges in SVG (#1, #2, #3...) with collision leader lines -->
                          ${fpRooms.map((r, rIdx) => {
                            const rPos = roomPositions[rIdx] || { x: 50, y: 50, lx: 50, ly: 50, isOffset: false,
                                                                                                showLabel: true };
                            let badgeBg = '#2563eb';
                            if (r.inspectionStatus === 'Đạt nghiệm thu') badgeBg = '#059669';
                            else if (r.inspectionStatus === 'Chưa đạt (Cần sửa)') badgeBg = '#dc2626';

                            if (!rPos.showLabel) return '';
                            return `
                              <g>
                                ${rPos.isOffset ? `
                                  <circle cx="${rPos.x}" cy="${rPos.y}" r="0.55" fill="${badgeBg}" />
                                  <line x1="${rPos.x}" y1="${rPos.y}" x2="${rPos.lx}" y2="${rPos.ly}" stroke="${badgeBg}" stroke-width="0.18" stroke-dasharray="0.45,0.35" opacity="0.82" />
                                ` : ''}
                                <circle cx="${rPos.lx}" cy="${rPos.ly}" r="1.75" fill="${badgeBg}" fill-opacity="0.92" stroke="#ffffff" stroke-width="0.28" />
                                <text x="${rPos.lx}" y="${rPos.ly + 0.2}" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-size="1.85" font-weight="900" style="font-family: Arial, sans-serif;">#${rIdx + 1}</text>
                              </g>
                            `;
                          }).join('')}
                        </svg>
                      </div>

                      <!-- Legend Table below Highlight Map -->
                      ${fpRooms.length > 0 ? `
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; margin-bottom: 6px;">
                          <p style="margin: 0 0 4px 0; font-size: 9.5px; font-weight: bold; color: #1e1b4b;">Chú giải mã vị trí khu vực / phòng (${formatFloorName(fp.floorName)}):</p>
                          <table style="width: 100%; border-collapse: collapse; margin-bottom: 0; font-size: 9px; table-layout: fixed;">
                            <thead>
                              <tr style="background: #e2e8f0;">
                                <th style="width: 35px; text-align: center; color: #334155; padding: 4px;">Mã</th>
                                <th style="width: 37%; color: #334155; padding: 4px;">Tên Khu Vực / Phòng</th>
                                <th style="width: 16%; color: #334155; padding: 4px;">Trạng Thái Nghiệm Thu</th>
                                <th style="width: 13%; color: #334155; padding: 4px;">Khung Trần</th>
                                <th style="width: 13%; color: #334155; padding: 4px;">Bắn Tấm</th>
                                <th style="width: 14%; color: #334155; padding: 4px;">Giám Sát</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${fpRooms.map((r, rIdx) => `
                                <tr>
                                  <td style="text-align: center; font-weight: 900; color: #2563eb; padding: 4px;">#${rIdx + 1}</td>
                                  <td style="font-weight: bold; padding: 4px; color: #0f172a; word-break: normal; overflow-wrap: break-word;">${r.roomName}</td>
                                  <td style="padding: 4px;"><span class="badge ${r.inspectionStatus === 'Đạt nghiệm thu' ? 'badge-passed' : r.inspectionStatus === 'Chưa đạt (Cần sửa)' ? 'badge-defect' : 'badge-pending'}">${r.inspectionStatus}</span></td>
                                  <td style="padding: 4px;">${r.frameStatus || '-'}</td>
                                  <td style="padding: 4px;">${r.boardStatus || '-'}</td>
                                  <td style="padding: 4px;">${r.inspectorName || displayInspector}</td>
                                </tr>
                              `).join('')}
                            </tbody>
                          </table>
                        </div>
                      ` : ''}

                      ${!hasDefects ? `
                        <p style="margin: 4px 0 0 0; font-size: 9.5px; color: #166534; font-weight: bold;">✅ ${formatFloorName(fp.floorName)} không có Defect nào.</p>
                      ` : ''}
                    ` : '<p style="font-size: 10px; color: #94a3b8; font-style: italic;">Chưa có ảnh bản vẽ.</p>'}
                  </div>

                  <!-- Defect Map (Only rendered when hasDefects === true) -->
                  ${hasDefects ? `
                    <div style="width: 100%; border-top: 1px dashed #cbd5e1; padding-top: 10px;">
                      <p style="margin: 0 0 6px 0; font-size: 10.5px; font-weight: bold; color: #e11d48;">
                        2. Sơ Đồ Defect Vị Trí Lỗi (${fpDefects.length} lỗi)
                      </p>

                      ${fp.imageUrl ? `
                        <div style="position: relative; width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #ffffff; margin-bottom: 8px; font-size: 0; line-height: 0;">
                          <img src="${fp.imageUrl}" style="width: 100%; height: auto; display: block; margin: 0 auto; vertical-align: top;" />

                          <svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible;" viewBox="0 0 100 100" preserveAspectRatio="none">
                            ${fpDefects.map((d, idx) => {
                              const pos = defectPositions[idx] || { x: d.x, y: d.y, lx: d.x + 3, ly: d.y - 3, showLabel: true, clusterIndex: 0, clusterCount: 1 };
                              let pinColor = '#e11d48';
                              if (d.status === 'Đã nghiệm thu' || d.status === 'Đã khắc phục') {
                                pinColor = '#059669';
                              } else if (d.status === 'Đang sửa' || d.status === 'Đang khắc phục') {
                                pinColor = '#d97706';
                              }

                              return `
                                <g>
                                  ${pos.clusterIndex === 0 ? `
                                    <circle cx="${pos.x}" cy="${pos.y}" r="${pos.clusterCount > 1 ? 1.55 : 1.15}" fill="#ffffff" fill-opacity="0.92" stroke="${pinColor}" stroke-width="0.24" />
                                    <circle cx="${pos.x}" cy="${pos.y}" r="0.48" fill="${pinColor}" />
                                    ${pos.clusterCount > 1 ? `<text x="${pos.x}" y="${Math.max(1.2, pos.y - 1.75)}" text-anchor="middle" fill="${pinColor}" font-size="1.45" font-weight="900" style="font-family: Arial, sans-serif;">×${pos.clusterCount}</text>` : ''}
                                  ` : ''}

                                  ${pos.showLabel ? `
                                    <line x1="${pos.x}" y1="${pos.y}" x2="${pos.lx}" y2="${pos.ly}" stroke="${pinColor}" stroke-width="0.18" opacity="0.78" />
                                    <circle cx="${pos.lx}" cy="${pos.ly}" r="2.05" fill="${pinColor}" fill-opacity="0.94" stroke="#ffffff" stroke-width="0.28" />
                                    <text x="${pos.lx}" y="${pos.ly + 0.22}" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-size="1.9" font-weight="900" style="font-family: Arial, sans-serif;">${d.markerCode}</text>
                                  ` : ''}
                                </g>
                              `;
                            }).join('')}
                          </svg>
                        </div>

                        <!-- Legend Table for Defect Map 1:1 -->
                        <div style="background: #fff5f5; border: 1px solid #fecdd3; border-radius: 6px; padding: 6px 8px;">
                          <p style="margin: 0 0 4px 0; font-size: 9.5px; font-weight: bold; color: #9f1239;">Chú giải vị trí Defect trên bản vẽ (${formatFloorName(fp.floorName)}):</p>
                          <table class="map-legend" style="width: 100%; border-collapse: collapse; margin-bottom: 0; font-size: 8.5px; table-layout: fixed;">
                            <thead>
                              <tr style="background: #ffe4e6;">
                                <th style="width: 6%; text-align: center; color: #881337;">STT</th>
                                <th style="width: 10%; color: #881337;">Tầng</th>
                                <th style="width: 11%; color: #881337;">Phòng</th>
                                <th style="width: 14%; color: #881337;">Loại lỗi</th>
                                <th style="width: 25%; color: #881337;">Mô tả</th>
                                <th style="width: 12%; color: #881337;">Đội phụ trách</th>
                                <th style="width: 13%; color: #881337; text-align: center;">Trạng thái</th>
                                <th style="width: 9%; color: #881337; text-align: center;">Deadline</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${fpDefects.map((d) => {
                                const matchedRoom = roomProgressList.find(r => r.id === d.roomId || (r.floorId === d.floorId && r.roomName === d.roomId));
                                const roomName = matchedRoom ? matchedRoom.roomName : (d.roomId || '—');
                                return `
                                <tr>
                                  <td style="text-align: center; font-weight: 900; color: #e11d48;">${d.markerCode}</td>
                                  <td class="wrap-cell">${formatFloorName(d.floorName)}</td>
                                  <td class="wrap-cell" style="font-weight: 700;">${roomName}</td>
                                  <td class="wrap-cell" style="font-weight: 700; color: #9f1239;">${d.category}</td>
                                  <td class="wrap-cell">${d.description || '—'}</td>
                                  <td class="wrap-cell"><strong>${d.assignedTo || '—'}</strong></td>
                                  <td class="status-cell"><span class="badge ${d.status === 'Đã nghiệm thu' || d.status === 'Đã khắc phục' ? 'badge-passed' : d.status === 'Đang sửa' || d.status === 'Đang khắc phục' ? 'badge-pending' : 'badge-defect'}">${d.status}</span></td>
                                  <td class="status-cell">${d.dueDate ? formatDateDDMMYYYY(d.dueDate) : '—'}</td>
                                </tr>
                              `;
                              }).join('')}
                            </tbody>
                          </table>
                        </div>
                      ` : '<p style="font-size: 10px; color: #94a3b8; font-style: italic;">Chưa có ảnh bản vẽ.</p>'}
                    </div>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
        ` : ''}

        ${includeFloorPlan && filteredRooms.length > 0 ? `
          <div class="section-title">🏠 TIẾN ĐỘ THI CÔNG &amp; NGHIỆM THU KHU VỰC / PHÒNG</div>
          <table style="table-layout: fixed; width: 100%;">
            <thead>
              <tr>
                <th style="width: 25%;">Tên Khu Vực / Phòng</th>
                <th style="width: 12%;">Tầng</th>
                <th style="width: 14%;">Khung Trần / HM</th>
                <th style="width: 14%;">Bắn Tấm / KL</th>
                <th style="width: 17%;">Kết Quả Nghiệm Thu</th>
                <th style="width: 18%;">Đội / Giám Sát</th>
              </tr>
            </thead>
            <tbody>
              ${filteredRooms.map(r => {
                const fp = floorPlans.find(f => f.id === r.floorId);
                const hasSubs = r.subItems && r.subItems.length > 0;
                
                const mainRow = `
                  <tr style="${hasSubs ? 'background-color: #f1f5f9; font-weight: bold;' : ''}">
                    <td style="word-break: normal; overflow-wrap: break-word;">
                      <strong>${r.roomName}</strong>
                      ${r.workCategory ? `<div style="font-size: 8.5px; color: #475569; font-weight: normal;">${r.workCategory}</div>` : ''}
                    </td>
                    <td style="word-break: normal; overflow-wrap: break-word;">${formatFloorName(fp?.floorName)}</td>
                    <td><span class="badge ${r.frameStatus === 'Đã hoàn thành' ? 'badge-passed' : r.frameStatus === 'Đang làm' ? 'badge-pending' : ''}">${r.frameStatus || '-'}</span></td>
                    <td>
                      ${typeof r.workVolume === 'number' && r.workVolume > 0 ? `<span>${formatDecimal(r.workVolume)} ${r.volumeUnit || 'm²'}</span>` : `<span class="badge ${r.boardStatus === 'Đã hoàn thành' ? 'badge-passed' : r.boardStatus === 'Đang làm' ? 'badge-pending' : ''}">${r.boardStatus || '-'}</span>`}
                    </td>
                    <td><span class="badge ${r.inspectionStatus === 'Đạt nghiệm thu' ? 'badge-passed' : r.inspectionStatus === 'Chưa đạt (Cần sửa)' ? 'badge-defect' : 'badge-pending'}">${r.inspectionStatus}</span></td>
                    <td style="word-break: normal; overflow-wrap: break-word;">
                      <div>${r.assignedTeam ? `Đội: <strong>${r.assignedTeam}</strong>` : ''}</div>
                      <div style="font-size: 8.5px; color: #64748b;">${r.inspectorName || displayInspector}</div>
                    </td>
                  </tr>
                `;

                const subRows = hasSubs ? r.subItems!.map(sub => `
                  <tr style="background-color: #ffffff; font-size: 8.5px;">
                    <td style="padding-left: 16px; color: #334155; word-break: normal; overflow-wrap: break-word;">
                      ↳ ${sub.name}
                    </td>
                    <td style="color: #64748b;">${sub.category || '-'}</td>
                    <td><span class="badge ${sub.status === 'Đã hoàn thành' ? 'badge-passed' : sub.status === 'Đang làm' ? 'badge-pending' : ''}">${sub.status}</span></td>
                    <td>
                      ${typeof sub.workVolume === 'number' && sub.workVolume > 0 ? `<strong>${formatDecimal(sub.workVolume)} ${sub.volumeUnit || 'm²'}</strong>` : (typeof sub.progressWeight === 'number' ? `Tỷ trọng: ${sub.progressWeight}%` : '-')}
                    </td>
                    <td><span class="badge ${sub.inspectionStatus === 'Đạt nghiệm thu' ? 'badge-passed' : sub.inspectionStatus === 'Chưa đạt (Cần sửa)' ? 'badge-defect' : 'badge-pending'}">${sub.inspectionStatus || 'Chưa nghiệm thu'}</span></td>
                    <td style="color: #475569;">${sub.assignedTeam || r.assignedTeam || '-'}</td>
                  </tr>
                `).join('') : '';

                return mainRow + subRows;
              }).join('')}
            </tbody>
          </table>
        ` : ''}

        ${includeFloorPlan && defectsWithDisplayCode.length > 0 ? `
          <div class="section-title">🔴 DANH SÁCH DEFECT &amp; KIỂM SOÁT HẠN SỬA LỖI</div>
          <table style="table-layout: fixed; width: 100%;">
            <thead>
              <tr>
                <th style="width: 7%; text-align: center;">Mã Lỗi</th>
                <th style="width: 13%;">Vị Trí / Tầng</th>
                <th style="width: 14%;">Hạng Mục Lỗi</th>
                <th style="width: 25%;">Mô Tả &amp; Thông Tin Kiểm Soát</th>
                <th style="width: 13%;">Người Tạo &amp; Hạn</th>
                <th style="width: 14%;">Trách Nhiệm</th>
                <th style="width: 14%; text-align: center;">Trạng Thái</th>
              </tr>
            </thead>
            <tbody>
              ${defectsWithDisplayCode.map(d => {
                const overdue = getDefectOverdueInfo(d);
                const matchedRoom = roomProgressList.find(r => r.id === d.roomId || (r.floorId === d.floorId && r.roomName === d.roomId));
                const locationText = matchedRoom ? `${formatFloorName(d.floorName)} - ${matchedRoom.roomName}` : formatFloorName(d.floorName);
                return `
                <tr>
                  <td style="text-align: center;"><strong>${d.displayCode}</strong></td>
                  <td style="word-break: normal; overflow-wrap: break-word;">${locationText}</td>
                  <td><strong style="color: #9f1239; word-break: normal; overflow-wrap: break-word;">${d.category}</strong></td>
                  <td style="word-break: normal; overflow-wrap: break-word;">${d.description}</td>
                  <td style="font-size: 9px;">
                    <div>Tạo: <strong>${d.createdBy || 'QC'}</strong></div>
                    ${d.dueDate ? `<div style="color: #e11d48; font-weight: bold;">Hạn: ${formatDateDDMMYYYY(d.dueDate)}</div>` : ''}
                    ${d.completedAt ? `<div style="color: #166534; font-size: 8px;">Xong: ${d.completedAt}</div>` : ''}
                  </td>
                  <td style="word-break: normal; overflow-wrap: break-word;"><strong>${d.assignedTo}</strong></td>
                  <td class="status-cell">
                    <div style="margin-bottom: 2px;">
                      <span class="badge ${d.status === 'Đã nghiệm thu' || d.status === 'Đã khắc phục' ? 'badge-passed' : d.status === 'Đang sửa' || d.status === 'Đang khắc phục' ? 'badge-pending' : 'badge-defect'}">${d.status}</span>
                    </div>
                    ${overdue.statusText ? `
                      <div>
                        <span class="badge ${overdue.badgeClass === 'red' ? 'badge-defect' : overdue.badgeClass === 'green' ? 'badge-passed' : 'badge-pending'}">
                          ${overdue.statusText}
                        </span>
                      </div>
                    ` : ''}
                  </td>
                </tr>
              `;
              }).join('')}
            </tbody>
          </table>
        ` : ''}

        <!-- Phụ Lục Hình Ảnh Defect Trước & Sau Khi Sửa -->
        ${includeDefectPhotos && defectsWithDisplayCode.length > 0 ? (() => {
          const defectsWithImages = defectsWithDisplayCode.filter(d => {
            const hasPropBefore = !!d.imageUrl;
            const hasPropAfter = !!d.afterImageUrl;
            const mapEntry = defectPhotosMap[d.id];
            const hasMapBefore = mapEntry && mapEntry.before.length > 0;
            const hasMapAfter = mapEntry && mapEntry.after.length > 0;
            return hasPropBefore || hasPropAfter || hasMapBefore || hasMapAfter;
          });

          if (defectsWithImages.length === 0) return '';

          return `
            <div class="page-break-avoid" style="margin-top: 16px; background: #fff5f5; border: 1.5px solid #fecdd3; border-radius: 10px; padding: 10px;">
              <h4 style="margin: 0 0 10px 0; font-size: 11.5px; color: #9f1239; font-weight: 800; border-bottom: 1.5px solid #fda4af; padding-bottom: 4px;">
                📸 PHỤ LỤC HÌNH ẢNH DEFECT TRƯỚC VÀ SAU SỬA (${defectsWithImages.length} defect có ảnh)
              </h4>
              <div style="display: flex; flex-direction: column; gap: 10px;">
                ${defectsWithImages.map(d => {
                  const mapEntry = defectPhotosMap[d.id];
                  const beforeList: string[] = [];
                  if (d.imageUrl) beforeList.push(d.imageUrl);
                  if (mapEntry?.before) beforeList.push(...mapEntry.before);

                  const afterList: string[] = [];
                  if (d.afterImageUrl) afterList.push(d.afterImageUrl);
                  if (mapEntry?.after) afterList.push(...mapEntry.after);

                  const hasAfter = afterList.length > 0;

                  return `
                    <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px;">
                      <div style="font-weight: 800; font-size: 10px; color: #0f172a; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #e11d48; font-weight: 900;">${d.displayCode} - ${d.category}</span>
                        <span style="font-size: 8.5px; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; color: #475569;">${formatFloorName(d.floorName)} | Đội: ${d.assignedTo}</span>
                      </div>

                      <div style="font-size: 9px; color: #334155; margin-bottom: 6px;">Mô tả: ${d.description}</div>

                      <div style="display: flex; gap: 8px;">
                        <!-- Before Photos -->
                        <div style="${hasAfter ? 'flex: 1;' : 'width: 100%; max-width: 450px;'}">
                          <div style="font-size: 8.5px; font-weight: bold; color: #9f1239; margin-bottom: 3px;">ẢNH TRƯỚC KHẮC PHỤC</div>
                          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                            ${beforeList.map(url => `
                              <div style="width: 120px; height: 100px; background: #f8fafc; border-radius: 4px; overflow: hidden; border: 1px solid #cbd5e1;">
                                <img src="${url}" style="width: 100%; height: 100%; object-fit: contain; display: block;" />
                              </div>
                            `).join('')}
                          </div>
                        </div>

                        <!-- After Photos (Only if exists) -->
                        ${hasAfter ? `
                          <div style="flex: 1;">
                            <div style="font-size: 8.5px; font-weight: bold; color: #166534; margin-bottom: 3px;">ẢNH SAU KHẮC PHỤC</div>
                            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                              ${afterList.map(url => `
                                <div style="width: 120px; height: 100px; background: #f8fafc; border-radius: 4px; overflow: hidden; border: 1px solid #cbd5e1;">
                                  <img src="${url}" style="width: 100%; height: 100%; object-fit: contain; display: block;" />
                                </div>
                              `).join('')}
                            </div>
                          </div>
                        ` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        })() : ''}

        ${includeChecklist && filteredChecklist.length > 0 ? `
          <div class="section-title">📋 CHECKLIST TIÊU CHUẨN NGHIỆM THU THẠCH CAO</div>
          <table>
            <thead>
              <tr>
                <th style="width: 60px;">Tầng</th>
                <th style="width: 130px;">Phân Loại Hạng Mục</th>
                <th>Nội Dung Tiêu Chí Kiểm Tra</th>
                <th style="width: 90px;">Kết Quả</th>
                <th style="width: 110px;">Người Giám Sát</th>
                <th style="width: 100px;">Ghi Chú</th>
              </tr>
            </thead>
            <tbody>
              ${filteredChecklist.map(c => `
                <tr>
                  <td><strong>${c.floorName}</strong></td>
                  <td>${c.category}</td>
                  <td>${c.title}</td>
                  <td><span class="badge ${c.status === 'passed' ? 'badge-passed' : c.status === 'defect' ? 'badge-defect' : 'badge-pending'}">${c.status === 'passed' ? '✅ ĐẠT' : c.status === 'defect' ? '🔴 DEFECT' : '🟡 CHỜ'}</span></td>
                  <td>${c.inspectedBy || displayInspector}</td>
                  <td>${c.notes || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}

        ${includeCrew && filteredCrew.length > 0 ? `
          <div class="section-title">👷 NHẬT KÝ QUÂN SỐ &amp; ĐỘI THI CÔNG HẰNG NGÀY</div>
          <table>
            <thead>
              <tr>
                <th style="width: 35px; text-align: center;">STT</th>
                <th style="width: 75px;">Ngày</th>
                <th style="width: 110px;">Tên Đội Thi Công</th>
                <th style="width: 90px;">Trưởng Nhóm</th>
                <th style="width: 50px; text-align: center;">Quân Số</th>
                <th style="width: 70px; text-align: center;">Ca Làm</th>
                <th style="width: 80px;">Tầng</th>
                <th>Nhiệm Vụ Thi Công Chi Tiết</th>
              </tr>
            </thead>
            <tbody>
              ${filteredCrew.map((c, idx) => `
                <tr>
                  <td style="text-align: center;">${idx + 1}</td>
                  <td>${formatDateDDMMYYYY(c.date)}</td>
                  <td><strong>${c.teamName}</strong></td>
                  <td>${c.leaderName}</td>
                  <td style="text-align: center; font-weight: bold; color: #4f46e5;">${c.workerCount}</td>
                  <td style="text-align: center;">${c.shift || 'Hành chính'}</td>
                  <td>${c.floorName || '-'}</td>
                  <td>
                    <div><strong>${c.taskDescription}</strong></div>
                    ${c.notes ? `<div style="color: #64748b; font-size: 8.5px;">Ghi chú: ${c.notes}</div>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}

        <!-- Phụ Lục Hình Ảnh Thi Công Theo Đội -->
        ${includeCrewPhotos && filteredCrew.length > 0 ? (() => {
          const crewWithPhotos = filteredCrew.filter(c => crewPhotosMap[c.id] && crewPhotosMap[c.id].length > 0);
          if (crewWithPhotos.length === 0) return '';

          return `
            <div class="page-break-avoid" style="margin-top: 16px; background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 10px; padding: 10px;">
              <h4 style="margin: 0 0 10px 0; font-size: 11.5px; color: #1e3a8a; font-weight: 800; border-bottom: 1.5px solid #93c5fd; padding-bottom: 4px;">
                📸 PHỤ LỤC HÌNH ẢNH THI CÔNG THEO ĐỘI (${crewWithPhotos.length} đội có ảnh nhật ký)
              </h4>
              <div style="display: flex; flex-direction: column; gap: 10px;">
                ${crewWithPhotos.map(c => {
                  const photos = crewPhotosMap[c.id] || [];
                  return `
                    <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px;">
                      <div style="font-weight: 800; font-size: 10px; color: #0f172a; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #1d4ed8;">${formatDateDDMMYYYY(c.date)} | Đội: <strong>${c.teamName}</strong></span>
                        <span style="font-size: 8.5px; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; color: #475569;">Tầng: ${c.floorName || 'Công trình'} | ${c.workerCount} người</span>
                      </div>
                      <div style="font-size: 9px; color: #334155; margin-bottom: 6px;">Nhiệm vụ: ${c.taskDescription}</div>
                      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${photos.map(url => `
                          <div style="width: 120px; height: 100px; background: #f8fafc; border-radius: 4px; overflow: hidden; border: 1px solid #cbd5e1;">
                            <img src="${url}" style="width: 100%; height: 100%; object-fit: contain; display: block;" />
                          </div>
                        `).join('')}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        })() : ''}

        ${includeSignatures ? `
          <div style="margin-top: 30px; display: flex; justify-content: space-between; page-break-inside: avoid; break-inside: avoid;">
            <div style="text-align: center; width: 45%;">
              <p style="margin: 0; font-size: 11px; font-weight: bold; text-transform: uppercase; color: #334155;">ĐẠI DIỆN ĐƠN VỊ THI CÔNG</p>
              <p style="margin: 3px 0 30px; font-size: 10px; color: #64748b; font-style: italic;">(Ký và ghi rõ họ tên)</p>
              <p style="margin: 0; font-size: 11.5px; font-weight: bold; color: #0f172a;">${displayContractor}</p>
            </div>
            <div style="text-align: center; width: 45%;">
              <p style="margin: 0; font-size: 11px; font-weight: bold; text-transform: uppercase; color: #334155;">NGƯỜI LẬP / KỸ SƯ PHỤ TRÁCH</p>
              <p style="margin: 3px 0 30px; font-size: 10px; color: #64748b; font-style: italic;">(Ký và ghi rõ họ tên)</p>
              <p style="margin: 0; font-size: 11.5px; font-weight: bold; color: #0f172a;">${displayInspector}</p>
            </div>
          </div>
        ` : ''}

        <div class="footer">
          <p>Báo cáo tổng hợp tự động từ Hệ Thống Quản Lý Thi Công &amp; Nghiệm Thu.</p>
        </div>

        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `;
  };

  // Direct HTML report file download for easy offline opening/printing
  const handleDownloadHtmlReport = async () => {
    try {
      const htmlContent = getReportHtml();
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const safeProjectName = (projectName || 'Du_An').replace(/[^a-zA-Z0-9_-\s]/g, '').trim().replace(/\s+/g, '_');
      const dateStr = new Date().toISOString().slice(0, 10);
      await downloadOrShareFile(`Bao_Cao_Tong_Hop_${safeProjectName}_${dateStr}.html`, blob, 'text/html');
    } catch (err) {
      console.error('Download HTML report error:', err);
      alert('Không thể tải file báo cáo HTML.');
    }
  };

  // High-fidelity HTML Print / Save as PDF with FULL Unicode Vietnamese support (Có dấu 100%)
  const handlePrintHTML = () => {
    const htmlContent = getReportHtml();
    const androidSafeProjectName = (projectName || 'Du_An').replace(/[^a-zA-Z0-9_-\s]/g, '').trim().replace(/\s+/g, '_');
    const androidDateStr = new Date().toISOString().slice(0, 10);
    if (saveHtmlPdf(htmlContent, `Bao_Cao_Tong_Hop_${androidSafeProjectName}_${androidDateStr}.pdf`)) {
      return;
    }
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    try {
      const printWindow = window.open(blobUrl, '_blank');
      if (printWindow) {
        printWindow.focus();
        return;
      }
    } catch (e) {
      console.warn('window.open blocked:', e);
    }

    // Fallback: Use iframe print
    let printIframe = document.getElementById('pdf-print-iframe') as HTMLIFrameElement | null;
    if (printIframe) {
      printIframe.parentNode?.removeChild(printIframe);
    }
    
    printIframe = document.createElement('iframe') as HTMLIFrameElement;
    printIframe.id = 'pdf-print-iframe';
    printIframe.style.position = 'fixed';
    printIframe.style.right = '0';
    printIframe.style.bottom = '0';
    printIframe.style.width = '0';
    printIframe.style.height = '0';
    printIframe.style.border = '0';
    printIframe.style.opacity = '0';
    printIframe.style.pointerEvents = 'none';
    
    document.body.appendChild(printIframe);

    const doc = printIframe.contentWindow?.document || printIframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(htmlContent);
      doc.close();

      setTimeout(() => {
        try {
          printIframe?.contentWindow?.focus();
          printIframe?.contentWindow?.print();
        } catch (err) {
          console.warn('Iframe print error, falling back to direct file download:', err);
          handleDownloadHtmlReport();
          alert('⚠️ Trình duyệt hạn chế cửa sổ in. Đã tải File Báo Cáo (.html) về thiết bị của bạn! Hãy mở tệp để in hoặc Lưu dưới dạng PDF.');
        }
      }, 500);
    } else {
      handleDownloadHtmlReport();
      alert('⚠️ Đã tự động tải File Báo Cáo (.html) về thiết bị! Mở tệp để xem và in/lưu dưới dạng PDF.');
    }
  };

  const handleCopySummaryText = () => {
    const areaText = isAllSelected ? 'Toàn bộ công trình' : selectedFloors.join(', ');
    const text = `
📋 *BÁO CÁO THI CÔNG & NGHIỆM THU - ${projectName.toUpperCase()}*
📍 *Khu vực:* ${areaText}
📅 *Thời gian:* ${formatDateTime(new Date())}

📊 *TỔNG QUAN:*
- Kho vật tư: ${inventory.length} mặt hàng
- Khối lượng thi công: ${workVolumes.length} hạng mục
- Khu vực / phòng: ${filteredRooms.length} vị trí
- Defect phát hiện: ${filteredDefects.length} (Cần xử lý: ${openDefectsCount})
- Checklist: ${filteredChecklist.length} tiêu chí (Đạt ${passRate}%)
${includeCrew ? `- Tổng lượt nhân công: ${filteredCrew.reduce((sum, c) => sum + c.workerCount, 0)} người` : ''}

---
Báo cáo từ Hệ Thống Quản Lý Thi Công & Nghiệm Thu
    `.trim();

    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 3000);
  };

  const handleCopyHtmlReport = () => {
    try {
      const htmlContent = getReportHtml();
      navigator.clipboard.writeText(htmlContent).then(() => {
        setCopiedHtmlReport(true);
        setTimeout(() => setCopiedHtmlReport(false), 3000);
      });
    } catch (err) {
      console.error('Failed to copy HTML report:', err);
      alert('Không thể tự động sao chép. Vui lòng thử lại.');
    }
  };

  const handleExportExcel = () => {
    exportAllToExcel({
      projectName,
      inventory,
      materialNorms,
      workVolumes,
      roomProgressList: filteredRooms,
      defects: filteredDefects,
      checklist: filteredChecklist,
      floorPlans: isAllSelected ? floorPlans : floorPlans.filter(fp => selectedFloors.includes(fp.floorName)),
      crewRecords: filteredCrew,
      canViewFinancials: hasFinancialAccess,
      selectedModules: {
        inventory: includeWarehouse,
        workVolumes: includeWorkVolumes,
        floorPlan: includeFloorPlan,
        checklist: includeChecklist,
        crew: includeCrew,
      },
    });
  };

  const handleUploadExcelToDrive = async () => {
    setIsUploadingExcel(true);
    setDriveUploadError(null);
    try {
      if (!hasApiBackend()) {
        throw new Error('Google Drive upload can server backend. Firebase Hosting mien phi dang chay static-only nen hay tai file truc tiep ve may.');
      }

      const base64 = exportAllToExcelBase64({
        projectName,
        inventory,
        materialNorms,
        workVolumes,
        roomProgressList: filteredRooms,
        defects: filteredDefects,
        checklist: filteredChecklist,
        floorPlans: isAllSelected ? floorPlans : floorPlans.filter(fp => selectedFloors.includes(fp.floorName)),
        crewRecords: filteredCrew,
        canViewFinancials: hasFinancialAccess,
        selectedModules: {
          inventory: includeWarehouse,
          workVolumes: includeWorkVolumes,
          floorPlan: includeFloorPlan,
          checklist: includeChecklist,
          crew: includeCrew,
        },
      });

      const cleanProjectName = (projectName || 'Du_An').replace(/[^a-zA-Z0-9_-\s]/g, '').trim().replace(/\s+/g, '_');
      const response = await apiFetch('/api/drive/upload-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: `Bao_Cao_Tong_Hop_${cleanProjectName}_${Date.now()}.xlsx`,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          base64Data: base64,
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Bạn cần mở mục "Cấu hình Google" ở thanh Tab dưới cùng rồi nhấn đăng nhập tài khoản Google Drive trước.');
        }
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Lỗi hệ thống khi tải tệp lên Drive.');
      }

      const resData = await response.json();
      if (resData.success && resData.webViewLink) {
        setUploadExcelLink(resData.webViewLink);
        alert('🎉 Đã xuất và lưu tệp Excel trực tiếp vào Google Drive thành công! Bạn có thể nhấn vào liên kết màu xanh ở mục điện thoại bên dưới để mở hoặc chia sẻ.');
      } else {
        throw new Error(resData.message || 'Không nhận được đường dẫn từ Drive.');
      }
    } catch (err: any) {
      console.error('Failed to upload Excel to Drive:', err);
      setDriveUploadError(err.message);
      alert(`Không thể tải lên Drive: ${err.message}`);
    } finally {
      setIsUploadingExcel(false);
    }
  };

  const handleUploadHtmlToDrive = async () => {
    setIsUploadingPdf(true);
    setDriveUploadError(null);
    try {
      if (!hasApiBackend()) {
        throw new Error('Google Drive upload can server backend. Firebase Hosting mien phi dang chay static-only nen hay tai file truc tiep ve may.');
      }

      const htmlContent = getReportHtml();
      const base64 = window.btoa(unescape(encodeURIComponent(htmlContent)));

      const cleanProjectName = (projectName || 'Du_An').replace(/[^a-zA-Z0-9_-\s]/g, '').trim().replace(/\s+/g, '_');
      const response = await apiFetch('/api/drive/upload-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: `Bao_Cao_PDF_In_${cleanProjectName}_${Date.now()}.html`,
          mimeType: 'text/html',
          base64Data: base64,
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Bạn cần mở mục "Cấu hình Google" ở thanh Tab dưới cùng rồi nhấn đăng nhập tài khoản Google Drive trước.');
        }
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Lỗi hệ thống khi tải tệp lên Drive.');
      }

      const resData = await response.json();
      if (resData.success && resData.webViewLink) {
        setUploadPdfLink(resData.webViewLink);
        alert('🎉 Đã tải bản báo cáo in PDF/HTML lên Google Drive thành công! Bạn có thể mở trực tiếp trên điện thoại để xem và in ấn.');
      } else {
        throw new Error(resData.message || 'Không nhận được đường dẫn từ Drive.');
      }
    } catch (err: any) {
      console.error('Failed to upload HTML/PDF to Drive:', err);
      setDriveUploadError(err.message);
      alert(`Không thể tải lên Drive: ${err.message}`);
    } finally {
      setIsUploadingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto border border-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Xuất Báo Cáo PDF &amp; Excel</h3>
              <p className="text-xs text-slate-500">Chuẩn định dạng tiếng Việt 100% có dấu</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Options */}
        <div className="space-y-4 text-xs">
          {/* Select Floor (Multi-Select) */}
          <div className="space-y-1.5">
            <label className="block text-slate-700 font-bold flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-indigo-600" />
              Lọc Khu Vực / Tầng (Đã Khai Báo)
            </label>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 max-h-36 overflow-y-auto space-y-2.5">
              {/* Option: All */}
              <label className="flex items-center gap-2.5 font-bold text-slate-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={() => handleToggleFloor('all')}
                  className="w-4 h-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                />
                <span className="text-xs">🌐 Tất cả các tầng / Toàn bộ dự án</span>
              </label>

              {/* Individual declared floors */}
              {floorNames.length > 0 ? (
                <div className="border-t border-slate-200 pt-2.5 space-y-2">
                  {floorNames.map((f) => {
                    const isChecked = isAllSelected || selectedFloors.includes(f);
                    return (
                      <label key={f} className="flex items-center gap-2.5 font-semibold text-slate-700 hover:text-slate-900 cursor-pointer select-none ml-1">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isAllSelected}
                          onChange={() => handleToggleFloor(f)}
                          className="w-4 h-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer disabled:opacity-50"
                        />
                        <span className="text-xs">📍 {f}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 italic">Chưa khai báo tầng nào.</p>
              )}
            </div>
          </div>

          {/* Report Content Checkboxes */}
          <div>
            <label className="block text-slate-700 font-bold mb-1.5">Hạng Mục Chọn Xuất Báo Cáo</label>
            <div className="grid grid-cols-2 gap-2">
              <label className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${includeWarehouse ? 'bg-indigo-50/70 border-indigo-300 text-indigo-900 font-bold' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                <input
                  type="checkbox"
                  checked={includeWarehouse}
                  onChange={(e) => setIncludeWarehouse(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <Package className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="text-[11px]">Kho Vật Tư</span>
              </label>

              <label className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${includeWorkVolumes ? 'bg-indigo-50/70 border-indigo-300 text-indigo-900 font-bold' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                <input
                  type="checkbox"
                  checked={includeWorkVolumes}
                  onChange={(e) => setIncludeWorkVolumes(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <BarChart3 className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="text-[11px]">Khối Lượng</span>
              </label>

              <label className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${includeFloorPlan ? 'bg-indigo-50/70 border-indigo-300 text-indigo-900 font-bold' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                <input
                  type="checkbox"
                  checked={includeFloorPlan}
                  onChange={(e) => setIncludeFloorPlan(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <Building2 className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="text-[11px]">Mặt Bằng &amp; Defect</span>
              </label>

              <label className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${includeChecklist ? 'bg-indigo-50/70 border-indigo-300 text-indigo-900 font-bold' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                <input
                  type="checkbox"
                  checked={includeChecklist}
                  onChange={(e) => setIncludeChecklist(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <ClipboardCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-[11px]">Checklist</span>
              </label>

              <label className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${includeCrew ? 'bg-indigo-50/70 border-indigo-300 text-indigo-900 font-bold' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                <input
                  type="checkbox"
                  checked={includeCrew}
                  onChange={(e) => setIncludeCrew(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <Users className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="text-[11px]">Nhật Ký Nhân Công</span>
              </label>

              <label className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${includeCrewPhotos ? 'bg-indigo-50/70 border-indigo-300 text-indigo-900 font-bold' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                <input
                  type="checkbox"
                  checked={includeCrewPhotos}
                  onChange={(e) => setIncludeCrewPhotos(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <Camera className="w-4 h-4 text-sky-600 shrink-0" />
                <span className="text-[11px]">Phụ Lục Ảnh Đội</span>
              </label>

              <label className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${includeDefectPhotos ? 'bg-indigo-50/70 border-indigo-300 text-indigo-900 font-bold' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                <input
                  type="checkbox"
                  checked={includeDefectPhotos}
                  onChange={(e) => setIncludeDefectPhotos(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <ImageIcon className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="text-[11px]">Phụ Lục Ảnh Defect</span>
              </label>

              <label className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${includeSignatures ? 'bg-indigo-50/70 border-indigo-300 text-indigo-900 font-bold' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                <input
                  type="checkbox"
                  checked={includeSignatures}
                  onChange={(e) => setIncludeSignatures(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <FileText className="w-4 h-4 text-slate-600 shrink-0" />
                <span className="text-[11px]">Chữ Ký Đơn Vị</span>
              </label>
            </div>
          </div>

          {/* Tùy chỉnh nâng cao */}
          <div className="pt-1 space-y-2 text-slate-700 bg-slate-50 p-3 rounded-2xl border border-slate-200">
            <span className="block font-bold text-slate-800 text-[11px]">⚙️ Tùy Chỉnh Bố Cục Báo Cáo:</span>
            <div className="grid grid-cols-2 gap-2 pb-1">
              <label className="space-y-1">
                <span className="block text-[10px] font-semibold text-slate-600">Khổ giấy PDF</span>
                <select
                  value={pdfPaperSize}
                  onChange={(e) => setPdfPaperSize(e.target.value as 'A4' | 'A3')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold"
                >
                  <option value="A4">A4</option>
                  <option value="A3">A3</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] font-semibold text-slate-600">Hướng giấy</span>
                <select
                  value={pdfOrientation}
                  onChange={(e) => setPdfOrientation(e.target.value as 'portrait' | 'landscape')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold"
                >
                  <option value="portrait">Dọc (Portrait)</option>
                  <option value="landscape">Ngang (Landscape)</option>
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] font-medium">
              <input
                type="checkbox"
                checked={skipEmptyFloors}
                onChange={(e) => setSkipEmptyFloors(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500"
              />
              <span>🚫 Bỏ qua các tầng/mặt bằng không có dữ liệu</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] font-medium">
              <input
                type="checkbox"
                checked={onlyDefectMapIfHasDefects}
                onChange={(e) => setOnlyDefectMapIfHasDefects(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500"
              />
              <span>↔️ Mở rộng full 100% sơ đồ mặt bằng khi tầng có 0 Defect</span>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={handlePrintHTML}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl font-black flex items-center justify-center gap-2 shadow-md active:scale-98 transition-all text-xs border border-indigo-400 cursor-pointer"
            >
              <Printer className="w-4 h-4 text-amber-300" />
              <span>🖨️ Xuất / In Báo Cáo PDF (Mở Cửa Sổ In)</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadHtmlReport}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow active:scale-98 transition-all text-xs cursor-pointer"
            >
              <Download className="w-4 h-4 text-sky-200" />
              Tải File Báo Cáo HTML (.html - Mở &amp; In / Lưu PDF Dễ Dàng)
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow active:scale-98 transition-all text-xs cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Tải File Excel (.xlsx) Các Hạng Mục Đã Chọn
            </button>

            <button
              type="button"
              onClick={handleCopySummaryText}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-xl font-bold flex items-center justify-center gap-2 active:scale-98 transition-all text-xs cursor-pointer"
            >
              {copiedText ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Mail className="w-4 h-4 text-slate-600" />}
              {copiedText ? 'Đã sao chép nội dung!' : 'Sao Chép Tóm Tắt Gửi Zalo / Email'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
