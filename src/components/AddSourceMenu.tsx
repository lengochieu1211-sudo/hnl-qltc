import React from 'react';
import { Copy, Plus } from 'lucide-react';
import { ActionMenuButton } from './ActionMenuButton';

interface AddSourceMenuProps {
  triggerLabel: string;
  createLabel: string;
  onCreateNew: () => void;
  onOpenSourcePicker?: () => void;
  sourceLabel?: string;
  disabled?: boolean;
  fillMobile?: boolean;
  fillWidth?: boolean;
  align?: 'left' | 'right';
}

export const AddSourceMenu: React.FC<AddSourceMenuProps> = ({
  triggerLabel, createLabel, onCreateNew, onOpenSourcePicker,
  sourceLabel = 'Lấy từ công trình/mẫu', disabled = false,
  fillMobile = false, fillWidth = false, align = 'left',
}) => (
  <ActionMenuButton
    label={triggerLabel}
    icon={Plus}
    disabled={disabled}
    fillMobile={fillMobile}
    fillWidth={fillWidth}
    align={align}
    menuTitle="Chọn cách thêm"
    ariaLabel={`${triggerLabel} · chọn cách thêm`}
    footer="Tạo mới để nhập thủ công; lấy từ công trình/mẫu để dùng lại dữ liệu đã có."
    entries={[
      { label: createLabel, icon: Plus, tone: 'primary', onSelect: onCreateNew },
      ...(onOpenSourcePicker ? [{ label: sourceLabel, icon: Copy, tone: 'neutral' as const, onSelect: onOpenSourcePicker }] : []),
    ]}
  />
);
