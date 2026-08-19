import React from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';

interface MoveOrderControlsProps {
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  disableUp?: boolean;
  disableDown?: boolean;
  showDragHandle?: boolean;
  compact?: boolean;
  className?: string;
  label?: string;
}

export const MoveOrderControls: React.FC<MoveOrderControlsProps> = ({
  onMoveUp,
  onMoveDown,
  disableUp = false,
  disableDown = false,
  showDragHandle = false,
  compact = true,
  className = '',
  label = 'Sắp thứ tự',
}) => (
  <div
    className={`inline-flex items-center rounded-lg border border-slate-200 bg-slate-50/90 shadow-3xs overflow-hidden ${className}`}
    aria-label={label}
  >
    {showDragHandle && (
      <span
        className={`${compact ? 'px-1.5' : 'px-2'} text-slate-400 inline-flex items-center justify-center border-r border-slate-200 cursor-grab active:cursor-grabbing`}
        title="Kéo để đổi thứ tự"
      >
        <GripVertical className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      </span>
    )}
    {onMoveUp && (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onMoveUp();
        }}
        disabled={disableUp}
        className={`${compact ? 'p-1.5' : 'p-2'} text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-slate-500 transition-colors`}
        title="Di chuyển lên"
        aria-label="Di chuyển lên"
      >
        <ArrowUp className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      </button>
    )}
    {onMoveDown && (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onMoveDown();
        }}
        disabled={disableDown}
        className={`${compact ? 'p-1.5' : 'p-2'} text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-slate-500 transition-colors border-l border-slate-200`}
        title="Di chuyển xuống"
        aria-label="Di chuyển xuống"
      >
        <ArrowDown className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      </button>
    )}
  </div>
);
