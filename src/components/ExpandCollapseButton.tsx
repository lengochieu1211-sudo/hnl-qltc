import React, { useEffect, useRef } from 'react';
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
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  useEffect(() => {
    if (!isMaterialNeedPage || !expanded || typeof document === 'undefined' || typeof window === 'undefined') return;

    const target = document.getElementById(MATERIAL_NEED_DETAILS_ID);
    if (!target) return;

    const previousStyle = target.getAttribute('style');
    const previousBodyOverflow = document.body.style.overflow;
    const backdrop = document.createElement('div');
    const historyMarker = `hnl-material-need-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let historyEntryActive = false;
    let closingFromPopState = false;

    const closePanel = () => onToggleRef.current();

    backdrop.setAttribute('data-hnl-floating-backdrop', 'material-need');
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '89',
      background: 'rgba(2, 6, 23, 0.58)',
      backdropFilter: 'blur(3px)',
    });
    backdrop.addEventListener('click', closePanel);
    document.body.appendChild(backdrop);

    const applyLayout = () => {
      const desktop = window.matchMedia('(min-width: 768px)').matches;
      target.style.position = 'fixed';
      target.style.zIndex = '90';
      target.style.overflowX = 'hidden';
      target.style.overflowY = 'auto';
      target.style.overscrollBehavior = 'contain';
      target.style.background = 'var(--hnl-dark-surface, #f8fafc)';
      target.style.padding = desktop ? '16px' : '12px';
      target.style.paddingBottom = 'calc(24px + env(safe-area-inset-bottom, 0px))';
      target.style.boxShadow = desktop ? '0 28px 80px rgba(15, 23, 42, 0.32)' : '0 -12px 40px rgba(15, 23, 42, 0.18)';

      if (desktop) {
        target.style.top = 'calc(5dvh + 68px)';
        target.style.right = '5vw';
        target.style.bottom = '5dvh';
        target.style.left = '5vw';
        target.style.width = 'auto';
        target.style.maxWidth = '1024px';
        target.style.margin = '0 auto';
        target.style.borderRadius = '0 0 24px 24px';
        target.style.border = '1px solid var(--hnl-dark-border, rgba(203, 213, 225, 0.95))';
        target.style.borderTop = '0';
      } else {
        // Keep a visible backdrop above the panel, matching the MaterialNorm mobile sheet.
        target.style.top = 'calc(8dvh + 68px)';
        target.style.right = '0';
        target.style.bottom = '0';
        target.style.left = '0';
        target.style.width = '100vw';
        target.style.maxWidth = '100vw';
        target.style.margin = '0';
        target.style.borderRadius = '0';
        target.style.border = '1px solid var(--hnl-dark-border, rgba(226, 232, 240, 0.95))';
        target.style.borderTop = '0';
        target.style.borderBottom = '0';
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    };

    const onPopState = () => {
      closingFromPopState = true;
      historyEntryActive = false;
      closePanel();
    };

    document.body.style.overflow = 'hidden';
    applyLayout();
    window.addEventListener('resize', applyLayout);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('popstate', onPopState);

    try {
      window.history.pushState({ ...window.history.state, __hnlMaterialNeed: historyMarker }, '', window.location.href);
      historyEntryActive = true;
    } catch (_) {
      historyEntryActive = false;
    }

    return () => {
      window.removeEventListener('resize', applyLayout);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
      backdrop.removeEventListener('click', closePanel);
      backdrop.remove();
      if (previousStyle === null) target.removeAttribute('style');
      else target.setAttribute('style', previousStyle);
      document.body.style.overflow = previousBodyOverflow;

      const currentMarker = window.history.state?.__hnlMaterialNeed;
      if (historyEntryActive && !closingFromPopState && currentMarker === historyMarker) {
        historyEntryActive = false;
        window.history.back();
      }
    };
  }, [expanded, isMaterialNeedPage]);

  if (isMaterialNeedPage && expanded) {
    return (
      <div className="fixed inset-x-0 top-[8dvh] z-[100] h-[68px] rounded-t-[28px] border border-b-0 border-slate-200 bg-white/95 shadow-sm backdrop-blur-sm sm:left-[5vw] sm:right-[5vw] sm:top-[5dvh] sm:mx-auto sm:max-w-5xl sm:rounded-t-3xl">
        <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-5">
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-slate-900">Gợi ý vật tư tổng hợp</div>
            <div className="truncate text-[10px] font-medium text-slate-500">Theo tầng · Theo đội · Toàn dự án</div>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleRef.current();
            }}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition-all hover:bg-slate-100 active:scale-95"
            aria-label="Đóng Gợi ý vật tư tổng hợp"
            title="Đóng"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  if (isMaterialNeedPage) {
    return (
      <span
        aria-hidden="true"
        className={`shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-xl text-indigo-600 transition-all group-hover:bg-indigo-50 ${className}`}
      >
        <ChevronDown className="h-4 w-4" />
      </span>
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
      {expanded ? collapseLabel : expandLabel}
    </button>
  );
};