import React from 'react';
import { ChevronDown } from 'lucide-react';

interface ExpandCollapseIndicatorProps {
  className?: string;
  expandLabel?: string;
  collapseLabel?: string;
}

export const ExpandCollapseIndicator: React.FC<ExpandCollapseIndicatorProps> = ({
  className = '',
  expandLabel = 'Mở rộng',
  collapseLabel = 'Thu gọn',
}) => (
  <span aria-hidden="true" className={`shrink-0 inline-flex min-h-8 items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[10px] font-bold text-indigo-700 ${className}`}>
    <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
    <span className="group-open:hidden">{expandLabel}</span>
    <span className="hidden group-open:inline">{collapseLabel}</span>
  </span>
);
