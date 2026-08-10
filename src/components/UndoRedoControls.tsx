import React from 'react';
import { Undo2, Redo2 } from 'lucide-react';

interface UndoRedoControlsProps {
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  className?: string;
  size?: 'sm' | 'md';
  variant?: 'light' | 'dark';
  showLabel?: boolean;
}

export const UndoRedoControls: React.FC<UndoRedoControlsProps> = ({
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  className = '',
  size = 'sm',
  variant = 'light',
  showLabel = false,
}) => {
  const isDark = variant === 'dark';

  return (
    <div
      className={`inline-flex items-center rounded-lg p-0.5 border transition-all ${
        isDark
          ? 'bg-slate-800/90 border-slate-700/80 text-slate-200 shadow-inner'
          : 'bg-white border-slate-200 text-slate-700 shadow-2xs'
      } ${className}`}
    >
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className={`flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all ${
          canUndo
            ? isDark
              ? 'text-slate-100 hover:bg-slate-700 hover:text-amber-300 active:scale-95 cursor-pointer'
              : 'text-slate-700 hover:bg-amber-50 hover:text-amber-800 active:scale-95 cursor-pointer'
            : isDark
            ? 'text-slate-600 cursor-not-allowed'
            : 'text-slate-300 cursor-not-allowed'
        }`}
        title="Hoàn tác thao tác trước (Ctrl + Z)"
      >
        <Undo2 className={`w-3.5 h-3.5 shrink-0 ${canUndo ? (isDark ? 'text-amber-400' : 'text-amber-600') : (isDark ? 'text-slate-600' : 'text-slate-300')}`} />
        {showLabel && <span>Hoàn tác</span>}
      </button>

      <div className={`w-[1px] h-3.5 mx-0.5 ${isDark ? 'bg-slate-700' : 'bg-slate-200'}`} />

      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className={`flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all ${
          canRedo
            ? isDark
              ? 'text-slate-100 hover:bg-slate-700 hover:text-indigo-300 active:scale-95 cursor-pointer'
              : 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-800 active:scale-95 cursor-pointer'
            : isDark
            ? 'text-slate-600 cursor-not-allowed'
            : 'text-slate-300 cursor-not-allowed'
        }`}
        title="Khôi phục thao tác (Ctrl + Y)"
      >
        <Redo2 className={`w-3.5 h-3.5 shrink-0 ${canRedo ? (isDark ? 'text-indigo-400' : 'text-indigo-600') : (isDark ? 'text-slate-600' : 'text-slate-300')}`} />
        {showLabel && <span>Làm lại</span>}
      </button>
    </div>
  );
};

