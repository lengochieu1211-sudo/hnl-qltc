import React from 'react';
import { Database, Download, FileSpreadsheet, TableProperties, Upload } from 'lucide-react';
import { ActionMenuButton, type ActionMenuEntry } from './ActionMenuButton';

interface DataManagementMenuProps {
  onExportEdit: () => void;
  onImportFile?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDownloadTemplate?: () => void;
  onExportReport?: () => void;
  onQuickEdit?: () => void;
  exportLabel?: string;
  importLabel?: string;
  templateLabel?: string;
  reportLabel?: string;
  quickEditLabel?: string;
  triggerLabel?: string;
  disabled?: boolean;
  fillMobile?: boolean;
  fillWidth?: boolean;
}

export const DataManagementMenu: React.FC<DataManagementMenuProps> = ({
  onExportEdit, onImportFile, onDownloadTemplate, onExportReport, onQuickEdit,
  exportLabel = 'Xuất Excel để chỉnh sửa', importLabel = 'Nhập Excel đã chỉnh sửa',
  templateLabel = 'Tải Excel mẫu', reportLabel = 'Xuất báo cáo Excel',
  quickEditLabel = 'Bảng chỉnh nhanh', triggerLabel = 'Quản lý dữ liệu',
  disabled = false, fillMobile = false, fillWidth = false,
}) => {
  const entries: ActionMenuEntry[] = [];
  if (onQuickEdit) {
    entries.push({ label: quickEditLabel, icon: TableProperties, tone: 'primary', onSelect: onQuickEdit });
    entries.push({ type: 'separator', label: 'Excel' });
  }
  entries.push({ label: exportLabel, icon: FileSpreadsheet, tone: 'neutral', onSelect: onExportEdit });
  if (onImportFile) entries.push({ type: 'file', label: importLabel, icon: Upload, accept: '.xlsx,.xls', tone: 'neutral', onChange: onImportFile });
  if (onDownloadTemplate) entries.push({ label: templateLabel, icon: Download, tone: 'neutral', onSelect: onDownloadTemplate });
  if (onExportReport) {
    entries.push({ type: 'separator', label: 'Báo cáo' });
    entries.push({ label: reportLabel, icon: Database, tone: 'neutral', onSelect: onExportReport });
  }
  return (
    <ActionMenuButton
      label={triggerLabel}
      icon={Database}
      entries={entries}
      menuTitle="Quản lý dữ liệu"
      footer={onQuickEdit ? 'Bảng chỉnh nhanh sửa trực tiếp; Excel dùng để xuất, nhập hoặc tải mẫu dữ liệu.' : 'Excel dùng để xuất hoặc nhập dữ liệu hàng loạt; không thay đổi quyền truy cập hiện có.'}
      disabled={disabled}
      fillMobile={fillMobile}
      fillWidth={fillWidth}
      align="right"
    />
  );
};
