import React, { useEffect } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

interface ExpandCollapseButtonProps {
  expanded: boolean;
  onToggle: () => void;
  controls?: string;
  className?: string;
  expandLabel?: string;
  collapseLabel?: string;
}

const MATERIAL_NEED_DETAILS_ID = 'material-need-details';

export const ExpandCollapseButton: React.FC<ExpandCollapseButtonProps> = ({
  expanded,
  onToggle,
  controls,
  className = '',
  expandLabel = 'Mở rộng',
  collapseLabel = 'Thu gọn',
}) => {
  const isMaterialNeedPage = controls === MATERIAL_NEED_DETAILS_ID;

  useEffect(() => {
    if (!isMaterialNeedPage || !expanded || typeof document === 'undefined') return;

    const target = document.getElementById(MATERIAL_NEED_DETAILS_ID);
    if (!target) return;

    const previousStyle = target.getAttribute('style');
    const previousBodyOverflow = document.body.style.overflow;

    target.style.position = 'fixed';
    target.style.top = '64px';
    target.style.right = '0';
    target.style.bottom = '0';
    target.style.left = '0';
    target.style.zIndex = '90';
    target.style.overflowY = 'auto';
    target.style.overscrollBehavior = 'contain';
    target.style.background = '#f8fafc';
    target.style.padding = '16px';
    target.style.paddingBottom = 'calc(24px + env(safe-area-inset-bottom, 0px))';
    target.style.maxWidth = '100vw';
    target.style.width = '100vw';

    document.body.style.overflow = 'hidden';

    return () => {
      if (previousStyle === null) target.removeAttribute('style');
      else target.setAttribute('style', previousStyle);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [expanded, isMaterialNeedPage]);

  if (isMaterialNeedPage && expanded) {
    return (
      <div className="fixed inset-x-0 top-0 z-[100] h-16 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-sm">
        <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-slate-900">Gợi ý vật tư tổng hợp</div>
            <div className="truncate text-[10px] font-medium text-slate-500">Theo tầng · Theo đội · Toàn dự án</div>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm active:scale-95"
            aria-label="Đóng Gợi ý vật tư tổng hợp"
          >
            <X className="h-4 w-4" />
            Đóng
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`shrink-0 inline-flex min-h-9 items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 active:scale-95 ${className}`}
      aria-expanded={expanded}
      aria-controls={controls}
    >
      {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      {isMaterialNeedPage ? 'Mở' : (expanded ? collapseLabel : expandLabel)}
    </button>
  );
};
