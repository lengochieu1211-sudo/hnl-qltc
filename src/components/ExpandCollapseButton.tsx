import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface ExpandCollapseButtonProps {
  expanded: boolean;
  onToggle: () => void;
  controls?: string;
  className?: string;
  expandLabel?: string;
  collapseLabel?: string;
}

export const ExpandCollapseButton: React.FC<ExpandCollapseButtonProps> = ({
  expanded,
  onToggle,
  controls,
  className = '',
  expandLabel = 'Mở rộng',
  collapseLabel = 'Thu gọn',
}) => (
  <button
    type="button"
    onClick={onToggle}
    className={`shrink-0 inline-flex min-h-9 items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 active:scale-95 ${className}`}
    aria-expanded={expanded}
    aria-controls={controls}
  >
    {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
    {expanded ? collapseLabel : expandLabel}
  </button>
);
