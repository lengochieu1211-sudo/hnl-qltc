import { downloadOrShareFile } from '../utils/downloadUtils';
import React, { useState } from 'react';
import { FileText, Download, Printer, X, CheckCircle2, Filter, Mail, Package, BarChart3, Building2, ClipboardCheck, FileSpreadsheet, Users, Copy, HelpCircle } from 'lucide-react';
import { InventoryItem, WorkVolume, DefectItem, ChecklistItem, FloorPlan, RoomProgressItem, MaterialNorm, CrewRecord } from '../types';
import { exportAllToExcel, exportAllToExcelBase64 } from '../utils/excelExport';
import { formatDateDDMMYYYY } from '../utils/dateFormatter';
import { getRoomColorStyle } from '../utils/colorPalette';
import { getDefectOverdueInfo } from '../utils/defectUtils';
import { apiFetch, hasApiBackend } from '../utils/api';

interface ExportPdfModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  inventory?: InventoryItem[];
  materialNorms?: MaterialNorm[];
  workVolumes?: WorkVolume[];
  defects: DefectItem[];
  checklist: ChecklistItem[];
  floorPlans: FloorPlan[];
  roomProgressList?: RoomProgressItem[];
  crewRecords?: CrewRecord[];
}

export const ExportPdfModal: React.FC<ExportPdfModalProps> = ({
  isOpen,
  onClose,
  projectName,
  inventory = [],
  materialNorms = [],
  workVolumes = [],
  defects = [],
  checklist = [],
  floorPlans = [],
  roomProgressList = [],
  crewRecords = [],
}) => {
  const [selectedFloors, setSelectedFloors] = useState<string[]>(['all']);
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
    if (!floorNames.includes(d.floorName)) return false;
    if (isAllSelected) return true;
    return selectedFloors.includes(d.floorName);
  });

  const filteredChecklist = checklist.filter((c) => {
    if (!floorNames.includes(c.floorName)) return false;
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
    if (!floorNames.includes(c.floorName)) return false;
    if (isAllSelected) return true;
    return selectedFloors.includes(c.floorName);
  });

  const contractorName = localStorage.getItem('construction_contractor') || 'Công Ty Cổ Phần Xây Dựng & Thạch Cao Hà Nội';
  const inspectorName = localStorage.getItem('construction_inspector') || 'KS. Nguyễn Văn Bình';

  const passedCount = filteredChecklist.filter((c) => c.status === 'passed').length;
  const passRate = filteredChecklist.length > 0 ? Math.round((passedCount / filteredChecklist.length) * 100) : 0;
  const openDefectsCount = filteredDefects.filter((d) => d.status !== 'Đã nghiệm thu').length;

  // Handle Excel Export
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
      selectedModules: {
        inventory: includeWarehouse,
        workVolumes: includeWorkVolumes,
        floorPlan: includeFloorPlan,
        checklist: includeChecklist,
        crew: includeCrew,
      },
    });
  };

  // Generate high-fidelity HTML report content
  const getReportHtml = (): string => {
    const areaText = isAllSelected ? 'Toàn bộ công trình' : selectedFloors.join(', ');

    return `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <title>Báo Cáo Tổng Hợp Thi Công &amp; Nghiệm Thu - ${projectName}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; margin: 0; padding: 15px; color: #0f172a; line-height: 1.4; background: #fff; }
          .header { border-bottom: 2.5px solid #4f46e5; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
          .header h1 { margin: 0; color: #1e1b4b; font-size: 19px; font-weight: 800; text-transform: uppercase; }
          .header p { margin: 3px 0 0; color: #64748b; font-size: 11px; }
          .badge { display: inline-block; padding: 2px 7px; border-radius: 6px; font-weight: 700; font-size: 10px; }
          .badge-passed { background-color: #d1fae5; color: #065f46; }
          .badge-defect { background-color: #ffe4e6; color: #9f1239; }
          .badge-pending { background-color: #fef3c7; color: #92400e; }
          .summary-box { display: flex; gap: 8px; margin-bottom: 16px; }
          .card { flex: 1; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; background: #f8fafc; text-align: center; }
          .card h3 { margin: 0; font-size: 16px; color: #0f172a; font-weight: 800; }
          .card p { margin: 2px 0 0; font-size: 9px; color: #64748b; font-weight: 700; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 10.5px; page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          th { background-color: #1e293b; color: #ffffff; text-align: left; padding: 6px 8px; font-weight: 700; border: 1px solid #0f172a; }
          td { padding: 6px 8px; border: 1px solid #cbd5e1; }
          tr:nth-child(even) { background-color: #f8fafc; }
          .section-title { font-size: 13px; font-weight: 800; margin-top: 14px; margin-bottom: 6px; color: #1e1b4b; border-left: 4px solid #4f46e5; padding-left: 8px; background: #f1f5f9; padding-top: 4px; padding-bottom: 4px; }
          .footer { font-size: 9.5px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 20px; }
          @media print {
            body { padding: 0; }
            .no-print { display: none !important; }
          }
        </style>
      </head>
      <body>
        <!-- Instructions box to help download PDF instead of printing physically -->
        <div class="no-print" style="background: #eff6ff; border: 1.5px solid #bfdbfe; color: #1e3a8a; padding: 14px 18px; border-radius: 12px; margin-bottom: 22px; font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div style="font-size: 14px; font-weight: 800; color: #1d4ed8; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
            📥 HƯỚNG DẪN LƯU / TẢI BÁO CÁO DẠNG FILE PDF:
          </div>
          <div style="font-weight: 500; line-height: 1.5; color: #1e40af;">
            Ở bảng in vừa xuất hiện, tại mục <strong>"Máy in đích" (Destination)</strong>, bạn vui lòng chọn <strong>"Lưu dưới dạng PDF" (Save as PDF)</strong>, sau đó nhấn nút <strong>"Lưu" (Save)</strong> để tải trực tiếp file báo cáo về điện thoại / máy tính của bạn.
          </div>
        </div>

        <div class="header">
          <div>
            <h1>Báo Cáo Tổng Hợp Thi Công &amp; Nghiệm Thu</h1>
            <p><strong>Dự án:</strong> ${projectName} | <strong>Khu vực:</strong> ${areaText}</p>
          </div>
          <div style="text-align: right;">
            <p><strong>Ngày xuất:</strong> ${new Date().toLocaleString('vi-VN')}</p>
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
              <p>Căn hộ / Phòng</p>
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
              <p>Quân số thợ</p>
            </div>
          ` : ''}
        </div>

        ${includeWarehouse && inventory.length > 0 ? `
          <div class="section-title">📦 KHO VẬT TƯ &amp; TỒN KHO CÔNG TRÌNH</div>
          <table>
            <thead>
              <tr>
                <th style="width: 40px;">STT</th>
                <th>Mã / Tên Vật Tư Thạch Cao</th>
                <th style="width: 70px;">ĐVT</th>
                <th style="width: 90px; text-align: right;">Tồn Kho</th>
                <th style="width: 90px; text-align: right;">Tồn Tối Thiểu</th>
                <th style="width: 120px;">Vị Trí Lưu Kho</th>
                <th style="width: 110px;">Trạng Thái</th>
              </tr>
            </thead>
            <tbody>
              ${inventory.map((item, idx) => `
                <tr>
                  <td style="text-align: center;">${idx + 1}</td>
                  <td><strong>${item.name || ''}</strong> <span style="color: #64748b;">(${item.id || ''})</span></td>
                  <td style="text-align: center;">${item.unit || ''}</td>
                  <td style="text-align: right;"><strong>${(item.quantity ?? 0).toLocaleString('en-US')}</strong></td>
                  <td style="text-align: right;">${(item.minQuantity ?? 0).toLocaleString('en-US')}</td>
                  <td>${item.location || 'Kho chính'}</td>
                  <td><span class="badge ${item.quantity <= item.minQuantity ? 'badge-defect' : 'badge-passed'}">${item.quantity <= item.minQuantity ? '⚠️ Cần Nhập' : '✅ An Toàn'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}

        ${includeWorkVolumes && workVolumes.length > 0 ? `
          <div class="section-title">📊 KHỐI LƯỢNG THI CÔNG &amp; SẢN LƯỢNG</div>
          <table>
            <thead>
              <tr>
                <th style="width: 40px;">STT</th>
                <th>Hạng Mục Công Việc</th>
                <th style="width: 100px;">Phân Loại</th>
                <th style="width: 60px; text-align: center;">ĐVT</th>
                <th style="width: 80px; text-align: right;">KL Kế Hoạch</th>
                <th style="width: 80px; text-align: right;">KL Thực Hiện</th>
                <th style="width: 90px; text-align: right;">Đơn Giá (đ)</th>
                <th style="width: 100px; text-align: right;">Thành Tiền (đ)</th>
              </tr>
            </thead>
            <tbody>
              ${workVolumes.map((wv, idx) => `
                <tr>
                  <td style="text-align: center;">${idx + 1}</td>
                  <td><strong>${wv.name || ''}</strong></td>
                  <td>${wv.category || ''}</td>
                  <td style="text-align: center;">${wv.unit || ''}</td>
                  <td style="text-align: right;">${(wv.plannedVolume ?? 0).toLocaleString('en-US')}</td>
                  <td style="text-align: right; color: #2563eb; font-weight: bold;">${(wv.actualVolume ?? 0).toLocaleString('en-US')}</td>
                  <td style="text-align: right;">${(wv.unitPrice ?? 0).toLocaleString('en-US')}</td>
                  <td style="text-align: right; font-weight: bold;">${((wv.actualVolume ?? 0) * (wv.unitPrice ?? 0)).toLocaleString('en-US')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}

        ${includeFloorPlan && (filteredRooms.length > 0 || filteredDefects.length > 0 || floorPlans.length > 0) ? `
          <div class="section-title">🖼️ HÌNH ẢNH MẶT BẰNG THI CÔNG, HIGHLIGHT CĂN HỘ &amp; MẶT BẰNG DEFECT</div>
          ${(isAllSelected ? floorPlans : floorPlans.filter(fp => selectedFloors.includes(fp.floorName))).map(fp => {
            const fpRooms = roomProgressList.filter(r => r.floorId === fp.id);
            const fpDefects = defects.filter(d => d.floorName === fp.floorName || d.floorId === fp.id);
            return `
              <div style="margin-bottom: 24px; page-break-inside: avoid; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; background: #fff;">
                <h4 style="margin: 0 0 12px 0; font-size: 13px; color: #1e1b4b; font-weight: bold; border-bottom: 2px solid #4f46e5; padding-bottom: 6px;">
                  📍 Sơ đồ mặt bằng: ${fp.floorName}
                </h4>

                <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px;">
                  <!-- Highlight Căn Hộ -->
                  <div style="flex: 1; min-width: 280px;">
                    <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: bold; color: #4f46e5;">1. Mặt bằng Highlight Căn Hộ (${fpRooms.length} căn)</p>
                    ${fp.imageUrl ? `
                      <div style="position: relative; width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #f8fafc; margin-bottom: 8px;">
                        <img src="${fp.imageUrl}" style="width: 100%; display: block; max-height: 320px; object-fit: contain;" />

                        <!-- SVG Polygons for rooms if points exist -->
                        <svg style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;" viewBox="0 0 100 100" preserveAspectRatio="none">
                          ${fpRooms.map((r, rIdx) => {
                            const { fill: bgCol, stroke: borderColor } = getRoomColorStyle(r, rIdx, 'palette');

                            if (r.points && r.points.length >= 2) {
                              const ptsStr = r.points.map(p => `${p.x},${p.y}`).join(' ');
                              if (r.isPolyline) {
                                return `<polyline points="${ptsStr}" fill="none" stroke="${borderColor}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />`;
                              }
                              return `<polygon points="${ptsStr}" fill="${bgCol}" stroke="${borderColor}" stroke-width="0.8" />`;
                            }
                            return `<rect x="${r.x}" y="${r.y}" width="${r.width || 15}" height="${r.height || 15}" fill="${bgCol}" stroke="${borderColor}" stroke-width="0.8" rx="0.5" />`;
                          }).join('')}
                        </svg>

                        <!-- High-Contrast Compact Room Name Label Badges Centered Over Rooms -->
                        ${(() => {
                          const placed: { cx: number; cy: number }[] = [];
                          return fpRooms.map(r => {
                            let borderColor = '#2563eb';
                            let badgeBg = '#eff6ff';
                            let textColor = '#1e3a8a';
                            if (r.inspectionStatus === 'Đạt nghiệm thu') { borderColor = '#059669'; badgeBg = '#ecfdf5'; textColor = '#065f46'; }
                            else if (r.inspectionStatus === 'Chưa đạt (Cần sửa)') { borderColor = '#dc2626'; badgeBg = '#fef2f2'; textColor = '#991b1b'; }

                            let cx = r.x + (r.width || 15) / 2;
                            let cy = r.y + (r.height || 15) / 2;
                            if (r.points && r.points.length > 0) {
                              cx = r.points.reduce((sum, p) => sum + p.x, 0) / r.points.length;
                              cy = r.points.reduce((sum, p) => sum + p.y, 0) / r.points.length;
                            }

                            // Anti-collision offset algorithm for nearby badges
                            let shiftCount = 0;
                            while (placed.some(p => Math.abs(p.cx - cx) < 9 && Math.abs(p.cy - cy) < 6) && shiftCount < 4) {
                              shiftCount++;
                              if (shiftCount === 1) cy -= 4;
                              else if (shiftCount === 2) cy += 8;
                              else if (shiftCount === 3) cx += 8;
                              else if (shiftCount === 4) cx -= 16;
                            }
                            placed.push({ cx, cy });

                            const displayName = r.roomName || 'Căn hộ';

                            return `
                              <div style="position: absolute; left: ${cx}%; top: ${cy}%; transform: translate(-50%, -50%); background: ${badgeBg}; color: ${textColor}; border: 1.5px solid ${borderColor}; padding: 1px 4px; border-radius: 4px; font-size: 7.5px; font-weight: 800; max-width: 75px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.3); z-index: 10;" title="${displayName}">
                                ${displayName}
                              </div>
                            `;
                          }).join('');
                        })()}
                      </div>

                      <!-- Ghi chú danh sách căn hộ rõ ràng -->
                      ${fpRooms.length > 0 ? `
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px;">
                          <p style="margin: 0 0 4px 0; font-size: 9.5px; font-weight: bold; color: #334155;">Ghi chú tên căn &amp; kết quả nghiệm thu (${fp.floorName}):</p>
                          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                            ${fpRooms.map(r => {
                              let statusClass = 'badge-pending';
                              if (r.inspectionStatus === 'Đạt nghiệm thu') statusClass = 'badge-passed';
                              if (r.inspectionStatus === 'Chưa đạt (Cần sửa)') statusClass = 'badge-defect';
                              return `
                                <span style="font-size: 9px; background: #fff; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">
                                  <strong>${r.roomName}</strong>
                                  <span class="badge ${statusClass}">${r.inspectionStatus}</span>
                                </span>
                              `;
                            }).join('')}
                          </div>
                        </div>
                      ` : ''}
                    ` : '<p style="font-size: 10px; color: #94a3b8; font-style: italic;">Chưa có ảnh bản vẽ.</p>'}
                  </div>

                  <!-- Mặt Bằng Defect -->
                  <div style="flex: 1; min-width: 280px;">
                    <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: bold; color: #e11d48;">2. Mặt bằng Defect &amp; Vị Trí Lỗi (${fpDefects.length} lỗi)</p>
                    ${fp.imageUrl ? `
                      <div style="position: relative; width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #f8fafc; margin-bottom: 8px;">
                        <img src="${fp.imageUrl}" style="width: 100%; display: block; max-height: 320px; object-fit: contain;" />

                        <!-- Sleek High-Visibility Defect Pin Badges (#1, #2...) -->
                        ${fpDefects.map((d, dIdx) => {
                          let pinBg = '#e11d48';
                          if (d.status === 'Đã nghiệm thu' || d.status === 'Đã khắc phục') {
                            pinBg = '#059669';
                          } else if (d.status === 'Đang sửa') {
                            pinBg = '#d97706';
                          }

                          return `
                            <div style="position: absolute; left: ${d.x}%; top: ${d.y}%; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; background: ${pinBg}; color: #ffffff; border: 2px solid #ffffff; border-radius: 50%; font-size: 9px; font-weight: 900; box-shadow: 0 2px 6px rgba(0,0,0,0.45); z-index: 20;" title="#${dIdx + 1}: ${d.category} - ${d.description}">
                              #${dIdx + 1}
                            </div>
                          `;
                        }).join('')}
                      </div>

                      <!-- Chú Giải Vị Trí Defect Trên Bản Vẽ -->
                      ${fpDefects.length > 0 ? `
                        <div style="background: #fff5f5; border: 1px solid #fecdd3; border-radius: 6px; padding: 6px 8px;">
                          <p style="margin: 0 0 4px 0; font-size: 9.5px; font-weight: bold; color: #9f1239;">Chú giải vị trí Defect trên bản vẽ (${fp.floorName}):</p>
                          <table style="width: 100%; border-collapse: collapse; margin-bottom: 0; font-size: 9.5px;">
                            <thead>
                              <tr style="background: #ffe4e6;">
                                <th style="width: 35px; text-align: center; color: #881337; padding: 3px;">Ghim</th>
                                <th style="width: 60px; color: #881337; padding: 3px;">Mã</th>
                                <th style="color: #881337; padding: 3px;">Tên Lỗi / Hạng Mục</th>
                                <th style="color: #881337; padding: 3px;">Mô Tả Chi Tiết Defect</th>
                                <th style="width: 75px; color: #881337; padding: 3px;">Trạng Thái</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${fpDefects.map((d, dIdx) => `
                                <tr>
                                  <td style="text-align: center; font-weight: 900; color: #e11d48; padding: 3px;">#${dIdx + 1}</td>
                                  <td style="font-weight: bold; padding: 3px;">${d.id}</td>
                                  <td style="font-weight: bold; padding: 3px; color: #9f1239;">${d.category}</td>
                                  <td style="padding: 3px;">${d.description}</td>
                                  <td style="padding: 3px;"><span class="badge ${d.status === 'Đã nghiệm thu' ? 'badge-passed' : d.status === 'Đang sửa' ? 'badge-pending' : 'badge-defect'}">${d.status}</span></td>
                                </tr>
                              `).join('')}
                            </tbody>
                          </table>
                        </div>
                      ` : ''}
                    ` : '<p style="font-size: 10px; color: #94a3b8; font-style: italic;">Chưa có ảnh bản vẽ.</p>'}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        ` : ''}

        ${includeFloorPlan && filteredRooms.length > 0 ? `
          <div class="section-title">🏠 TIẾN ĐỘ THI CÔNG &amp; NGHIỆM THU CĂN HỘ TRÊN MẶT BẰNG</div>
          <table>
            <thead>
              <tr>
                <th style="width: 120px;">Tên Căn / Phòng</th>
                <th style="width: 70px;">Tầng</th>
                <th style="width: 90px;">Khung Trần</th>
                <th style="width: 90px;">Bắn Tấm</th>
                <th style="width: 110px;">Kết Quả Nghiệm Thu</th>
                <th style="width: 120px;">Giám Sát</th>
                <th>Ghi Chú</th>
              </tr>
            </thead>
            <tbody>
              ${filteredRooms.map(r => {
                const fp = floorPlans.find(f => f.id === r.floorId);
                return `
                  <tr>
                    <td><strong>${r.roomName}</strong></td>
                    <td>${fp?.floorName || 'Mặt bằng'}</td>
                    <td><span class="badge ${r.frameStatus === 'Đã hoàn thành' ? 'badge-passed' : r.frameStatus === 'Đang làm' ? 'badge-pending' : ''}">${r.frameStatus}</span></td>
                    <td><span class="badge ${r.boardStatus === 'Đã hoàn thành' ? 'badge-passed' : r.boardStatus === 'Đang làm' ? 'badge-pending' : ''}">${r.boardStatus}</span></td>
                    <td><span class="badge ${r.inspectionStatus === 'Đạt nghiệm thu' ? 'badge-passed' : r.inspectionStatus === 'Chưa đạt (Cần sửa)' ? 'badge-defect' : 'badge-pending'}">${r.inspectionStatus}</span></td>
                    <td>${r.inspectorName || inspectorName}</td>
                    <td>${r.notes || '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        ` : ''}

        ${includeFloorPlan && filteredDefects.length > 0 ? `
          <div class="section-title">🔴 DANH SÁCH DEFECT &amp; KIỂM SOÁT HẠN SỬA LỖI</div>
          <table>
            <thead>
              <tr>
                <th style="width: 55px;">Mã Lỗi</th>
                <th style="width: 55px;">Tầng</th>
                <th style="width: 110px;">Hạng Mục Lỗi</th>
                <th>Mô Tả &amp; Thông Tin Kiểm Soát</th>
                <th style="width: 100px;">Người Tạo &amp; Hạn</th>
                <th style="width: 90px;">Trách Nhiệm</th>
                <th style="width: 85px;">Trạng Thái</th>
              </tr>
            </thead>
            <tbody>
              ${filteredDefects.map(d => {
                const overdue = getDefectOverdueInfo(d);
                return `
                <tr>
                  <td><strong>${d.id}</strong></td>
                  <td>${d.floorName}</td>
                  <td><strong style="color: #9f1239;">${d.category}</strong></td>
                  <td>
                    <div>${d.description}</div>
                    ${overdue.statusText ? `
                      <div style="margin-top: 4px;">
                        <span class="badge ${overdue.badgeClass === 'red' ? 'badge-defect' : overdue.badgeClass === 'green' ? 'badge-passed' : 'badge-pending'}">
                          ${overdue.statusText}
                        </span>
                      </div>
                    ` : ''}
                  </td>
                  <td style="font-size: 9.5px;">
                    <div>Tạo: <strong>${d.createdBy || 'QC'}</strong></div>
                    ${d.dueDate ? `<div style="color: #e11d48; font-weight: bold;">Hạn: ${formatDateDDMMYYYY(d.dueDate)}</div>` : ''}
                    ${d.completedAt ? `<div style="color: #166534; font-size: 8.5px;">Xong: ${d.completedAt}</div>` : ''}
                  </td>
                  <td><strong>${d.assignedTo}</strong></td>
                  <td><span class="badge ${d.status === 'Đã nghiệm thu' ? 'badge-passed' : d.status === 'Đang sửa' ? 'badge-pending' : 'badge-defect'}">${d.status}</span></td>
                </tr>
              `;
              }).join('')}
            </tbody>
          </table>

          <!-- Phụ Lục Hình Ảnh Defect Trước & Sau Khi Sửa -->
          ${(() => {
            const defectsWithImages = filteredDefects.filter(d => !!d.imageUrl || !!d.afterImageUrl);
            if (defectsWithImages.length === 0) return '';
            return `
              <div style="margin-top: 16px; page-break-inside: avoid; background: #fff5f5; border: 1.5px solid #fecdd3; border-radius: 10px; padding: 12px;">
                <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #9f1239; font-weight: 800; border-bottom: 1.5px solid #fda4af; padding-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                  📸 PHỤ LỤC HÌNH ẢNH DEFECT TRƯỚC VÀ SAU SỬA (${defectsWithImages.length} defect có ảnh)
                </h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px;">
                  ${defectsWithImages.map(d => {
                    const overdue = getDefectOverdueInfo(d);
                    return `
                    <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; padding: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
                      <div style="font-weight: 800; font-size: 10.5px; color: #0f172a; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: #e11d48; font-weight: 900;">${d.id} - ${d.category}</span>
                        <span style="font-size: 9px; background: #f1f5f9; padding: 1px 5px; border-radius: 4px; color: #475569;">Tầng ${d.floorName}</span>
                      </div>

                      <div style="display: grid; grid-template-columns: ${d.imageUrl && d.afterImageUrl ? '1fr 1fr' : '1fr'}; gap: 6px; margin-bottom: 6px;">
                        ${d.imageUrl ? `
                          <div>
                            <div style="font-size: 8px; font-weight: bold; color: #9f1239; margin-bottom: 2px;">Ảnh trước sửa</div>
                            <div style="width: 100%; height: 110px; background: #f8fafc; border-radius: 4px; overflow: hidden; border: 1px solid #e2e8f0;">
                              <img src="${d.imageUrl}" style="width: 100%; height: 100%; object-fit: contain; display: block;" alt="Trước sửa ${d.id}" />
                            </div>
                          </div>
                        ` : ''}
                        ${d.afterImageUrl ? `
                          <div>
                            <div style="font-size: 8px; font-weight: bold; color: #166534; margin-bottom: 2px;">Ảnh sau sửa</div>
                            <div style="width: 100%; height: 110px; background: #f8fafc; border-radius: 4px; overflow: hidden; border: 1px solid #e2e8f0;">
                              <img src="${d.afterImageUrl}" style="width: 100%; height: 100%; object-fit: contain; display: block;" alt="Sau sửa ${d.id}" />
                            </div>
                          </div>
                        ` : ''}
                      </div>

                      <div style="font-size: 9px; color: #475569; margin-bottom: 4px; line-height: 1.3;">${d.description}</div>
                      ${overdue.statusText ? `<div style="font-size: 8.5px; font-weight: bold; margin-bottom: 4px;">${overdue.statusText}</div>` : ''}
                      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #f1f5f9; pt-1; font-size: 8.5px;">
                        <span style="color: #64748b;">Giao: <strong>${d.assignedTo}</strong> | Tạo: <strong>${d.createdBy || 'QC'}</strong></span>
                        <span class="badge ${d.status === 'Đã nghiệm thu' ? 'badge-passed' : 'badge-defect'}">${d.status}</span>
                      </div>
                    </div>
                  `;
                  }).join('')}
                </div>
              </div>
            `;
          })()}
        ` : ''}

        ${includeChecklist && filteredChecklist.length > 0 ? `
          <div class="section-title">📋 CHECKLIST TIÊU CHUẨN NGHIỆM THU THẠCH CAO</div>
          <table>
            <thead>
              <tr>
                <th style="width: 65px;">Tầng</th>
                <th style="width: 140px;">Phân Loại Hạng Mục</th>
                <th>Nội Dung Tiêu Chí Kiểm Tra</th>
                <th style="width: 95px;">Kết Quả</th>
                <th style="width: 120px;">Người Giám Sát</th>
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
                  <td>${c.inspectedBy || 'Chưa ký'}</td>
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
                <th style="width: 40px;">STT</th>
                <th style="width: 80px;">Ngày</th>
                <th>Tên Đội Thi Công</th>
                <th style="width: 110px;">Trưởng Nhóm</th>
                <th style="width: 70px; text-align: center;">Quân Số</th>
                <th style="width: 90px; text-align: center;">Ca Làm Việc</th>
                <th style="width: 100px;">Tầng Làm Việc</th>
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
                  <td style="text-align: center;">
                    ${(() => {
                      const sVal = c.shift || 'Sáng, Chiều';
                      if (sVal === 'Hành chính') {
                        return `<span style="background-color: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; display: inline-block;">Sáng, Chiều</span>`;
                      }
                      if (sVal === 'Tăng ca') {
                        return `<span style="background-color: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; display: inline-block;">Tối</span>`;
                      }
                      return sVal.split(', ').map(part => {
                        let bg = '#f1f5f9';
                        let color = '#334155';
                        if (part === 'Sáng') { bg = '#e0f2fe'; color = '#0369a1'; }
                        else if (part === 'Chiều') { bg = '#e0e7ff'; color = '#3730a3'; }
                        else if (part === 'Tối') { bg = '#fef3c7'; color = '#92400e'; }
                        else if (part === 'Nghỉ') { bg = '#ffe4e6'; color = '#be123c'; }
                        return `<span style="background-color: ${bg}; color: ${color}; padding: 2px 5px; border-radius: 4px; font-size: 8px; font-weight: bold; margin: 1px; display: inline-block;">${part}</span>`;
                      }).join('');
                    })()}
                  </td>
                  <td>
                    ${c.floorWorks && c.floorWorks.length > 0
                      ? c.floorWorks.map(fw => `<div style="margin-bottom: 2px;">• <strong>${fw.floorName}</strong></div>`).join('')
                      : (c.floorName || '-')}
                  </td>
                  <td>
                    ${c.floorWorks && c.floorWorks.length > 0
                      ? c.floorWorks.map(fw => `<div style="margin-bottom: 4px;"><strong>[${fw.floorName}]</strong>: ` + fw.categories.map(cat => `<div>- ${cat.categoryName}: <em>${cat.subItems.join(', ')}</em></div>`).join('') + `</div>`).join('')
                      : `<strong>${c.taskDescription}</strong>`}
                    ${c.notes ? `<div style="color: #64748b; font-size: 9px; margin-top: 2px;">Ghi chú: ${c.notes}</div>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}

        <div style="margin-top: 30px; display: flex; justify-content: space-between; page-break-inside: avoid;">
          <div style="text-align: center; width: 45%;">
            <p style="margin: 0; font-size: 11px; font-weight: bold; text-transform: uppercase; color: #475569;">ĐẠI DIỆN ĐƠN VỊ THI CÔNG</p>
            <p style="margin: 3px 0 35px; font-size: 10px; color: #64748b; font-style: italic;">(Ký và ghi rõ họ tên)</p>
            <p style="margin: 0; font-size: 11.5px; font-weight: bold; color: #1e293b;">${contractorName}</p>
          </div>
          <div style="text-align: center; width: 45%;">
            <p style="margin: 0; font-size: 11px; font-weight: bold; text-transform: uppercase; color: #475569;">KỸ SƯ GIÁM SÁT NGHIỆM THU</p>
            <p style="margin: 3px 0 35px; font-size: 10px; color: #64748b; font-style: italic;">(Ký và đóng dấu)</p>
            <p style="margin: 0; font-size: 11.5px; font-weight: bold; color: #1e293b;">${inspectorName}</p>
          </div>
        </div>

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
      const safeProjectName = (projectName || 'Du_An').replace(/[^a-zA-Z0-9]/g, '_');
      const dateStr = new Date().toISOString().slice(0,10);
      await downloadOrShareFile(`Bao_Cao_${safeProjectName}_${dateStr}.html`, blob, 'text/html');
    } catch (err) {
      console.error('Download HTML report error:', err);
      alert('Không thể tải file báo cáo HTML.');
    }
  };

  // High-fidelity HTML Print / Save as PDF with FULL Unicode Vietnamese support (Có dấu 100%)
  const handlePrintHTML = () => {
    const htmlContent = getReportHtml();
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    // Try opening in new window/tab first (works best for mobile & popup print)
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
📅 *Thời gian:* ${new Date().toLocaleString('vi-VN')}

📊 *TỔNG QUAN:*
- Kho vật tư: ${inventory.length} mặt hàng
- Khối lượng thi công: ${workVolumes.length} hạng mục
- Tiến độ căn hộ: ${filteredRooms.length} phòng
- Defect phát hiện: ${filteredDefects.length} (Cần xử lý: ${openDefectsCount})
- Checklist: ${filteredChecklist.length} tiêu chí (Đạt ${passRate}%)
${includeCrew ? `- Quân số thợ hôm nay: ${filteredCrew.reduce((sum, c) => sum + c.workerCount, 0)} người` : ''}

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

  const handleCopyExcelBase64 = () => {
    try {
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
        selectedModules: {
          inventory: includeWarehouse,
          workVolumes: includeWorkVolumes,
          floorPlan: includeFloorPlan,
          checklist: includeChecklist,
          crew: includeCrew,
        },
      });
      navigator.clipboard.writeText(base64).then(() => {
        setCopiedExcelBase64(true);
        setTimeout(() => setCopiedExcelBase64(false), 3000);
      });
    } catch (err) {
      console.error('Failed to copy Excel Base64:', err);
      alert('Không thể chuyển đổi dữ liệu Excel.');
    }
  };

  const handleUploadExcelToDrive = async () => {
    if (!hasApiBackend()) {
      const message = 'Google Drive upload is disabled on the free static Firebase Hosting deployment. Download the Excel file locally instead.';
      setDriveUploadError(message);
      alert(message);
      return;
    }

    setIsUploadingExcel(true);
    setDriveUploadError(null);
    try {
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
        selectedModules: {
          inventory: includeWarehouse,
          workVolumes: includeWorkVolumes,
          floorPlan: includeFloorPlan,
          checklist: includeChecklist,
          crew: includeCrew,
        },
      });

      const cleanProjectName = projectName.replace(/[^a-zA-Z0-9_-\s]/g, '').trim().replace(/\s+/g, '_');
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
    if (!hasApiBackend()) {
      const message = 'Google Drive upload is disabled on the free static Firebase Hosting deployment. Download the HTML/PDF report locally instead.';
      setDriveUploadError(message);
      alert(message);
      return;
    }

    setIsUploadingPdf(true);
    setDriveUploadError(null);
    try {
      const htmlContent = getReportHtml();
      // Safe base64 encoding supporting Vietnamese characters
      const base64 = window.btoa(unescape(encodeURIComponent(htmlContent)));

      const cleanProjectName = projectName.replace(/[^a-zA-Z0-9_-\s]/g, '').trim().replace(/\s+/g, '_');
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
      <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto border border-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Xuất Báo Cáo PDF &amp; Excel</h3>
              <p className="text-xs text-slate-500">Font tiếng Việt chuẩn 100% có dấu</p>
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
        <div className="space-y-3 text-xs">
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

              <label className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all col-span-2 ${includeCrew ? 'bg-indigo-50/70 border-indigo-300 text-indigo-900 font-bold' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                <input
                  type="checkbox"
                  checked={includeCrew}
                  onChange={(e) => setIncludeCrew(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <Users className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="text-[11px]">Quân Số Hằng Ngày</span>
              </label>
            </div>
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
