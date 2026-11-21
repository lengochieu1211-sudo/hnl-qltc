import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, MonitorCog } from 'lucide-react';
import type { DesktopWorkspaceMode } from './DesktopWorkspaceHeader';

/** Presentation-only menu at the existing PC-mode header button. No data writes. */
export const DesktopPcModeMenu: React.FC<{
  mode: DesktopWorkspaceMode;
  onChangeMode: (mode: DesktopWorkspaceMode) => void;
}> = ({ mode, onChangeMode }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [open]);

  const options: Array<{ id: DesktopWorkspaceMode; label: string; description: string }> = [
    { id: 'classic', label: 'PC truyền thống', description: 'Giao diện cũ có thanh đen' },
    { id: 'modern', label: 'PC sáng', description: 'Không có thanh đen · như PROD' },
    { id: 'gemini', label: 'PC Gemini', description: 'Không gian làm việc mới dành cho PC' },
  ];

  return (
    <div ref={containerRef} className="hnl-pc-mode-menu" data-hnl-pc-mode-menu="true">
      <button type="button" className="hnl-pc-mode-switch hnl-pc-mode-trigger"
        aria-haspopup="menu" aria-expanded={open} aria-label="Chọn giao diện PC"
        onClick={() => setOpen(v => !v)} title="Chọn giao diện PC · không thay đổi dữ liệu">
        <MonitorCog size={15} aria-hidden="true" />
        <span>Giao diện PC</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && <div role="menu" aria-label="Ba giao diện PC" className="hnl-pc-mode-dropdown">
        {options.map(option => (
          <button key={option.id} type="button" role="menuitemradio"
            aria-checked={mode === option.id} className="hnl-pc-mode-option"
            onClick={() => { onChangeMode(option.id); setOpen(false); }}>
            <span className="hnl-pc-mode-option-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
            {mode === option.id && <Check size={16} className="hnl-pc-mode-option-check" aria-hidden="true" />}
          </button>
        ))}
      </div>}
    </div>
  );
};
