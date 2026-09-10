import React, { useEffect, useRef } from 'react';
import { ChevronDown, X } from 'lucide-react';

interface ExpandCollapseIndicatorProps {
  className?: string;
  expandLabel?: string;
  collapseLabel?: string;
}

export const ExpandCollapseIndicator: React.FC<ExpandCollapseIndicatorProps> = ({
  className = '',
}) => {
  const indicatorRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const details = indicatorRef.current?.closest('details') as HTMLDetailsElement | null;
    if (!details) return;

    let previousStyle: string | null = null;
    let previousBodyOverflow = '';
    let backdrop: HTMLDivElement | null = null;
    let active = false;
    let historyEntryActive = false;
    let closingFromPopState = false;
    const historyMarker = `hnl-floating-details-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const applyLayout = () => {
      if (!active) return;
      const desktop = window.matchMedia('(min-width: 768px)').matches;

      details.style.position = 'fixed';
      details.style.zIndex = '90';
      details.style.overflowY = 'auto';
      details.style.overscrollBehavior = 'contain';
      details.style.background = '#f8fafc';
      details.style.padding = desktop ? '16px' : '12px';
      details.style.paddingBottom = 'calc(20px + env(safe-area-inset-bottom, 0px))';
      details.style.boxShadow = desktop ? '0 28px 80px rgba(15, 23, 42, 0.28)' : 'none';

      if (desktop) {
        details.style.top = '5vh';
        details.style.right = '5vw';
        details.style.bottom = '5vh';
        details.style.left = '5vw';
        details.style.width = 'auto';
        details.style.maxWidth = '1120px';
        details.style.margin = '0 auto';
        details.style.borderRadius = '24px';
        details.style.border = '1px solid rgba(203, 213, 225, 0.95)';
      } else {
        details.style.top = '0';
        details.style.right = '0';
        details.style.bottom = '0';
        details.style.left = '0';
        details.style.width = '100vw';
        details.style.maxWidth = '100vw';
        details.style.margin = '0';
        details.style.borderRadius = '0';
        details.style.border = '0';
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !details.open) return;
      event.preventDefault();
      details.open = false;
    };

    const onPopState = () => {
      if (!active || !details.open) return;
      closingFromPopState = true;
      historyEntryActive = false;
      details.open = false;
    };

    const cleanupFloating = () => {
      if (!active) return;
      active = false;
      window.removeEventListener('resize', applyLayout);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
      backdrop?.remove();
      backdrop = null;
      document.body.style.overflow = previousBodyOverflow;
      if (previousStyle === null) details.removeAttribute('style');
      else details.setAttribute('style', previousStyle);

      const currentMarker = window.history.state?.__hnlFloatingDetails;
      if (historyEntryActive && !closingFromPopState && currentMarker === historyMarker) {
        historyEntryActive = false;
        window.history.back();
      }
      closingFromPopState = false;
    };

    const activateFloating = () => {
      if (active) return;
      active = true;
      previousStyle = details.getAttribute('style');
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      backdrop = document.createElement('div');
      backdrop.setAttribute('data-hnl-floating-backdrop', 'true');
      Object.assign(backdrop.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '89',
        background: 'rgba(15, 23, 42, 0.42)',
        backdropFilter: 'blur(2px)',
      });
      backdrop.addEventListener('click', () => {
        details.open = false;
      });
      document.body.appendChild(backdrop);

      try {
        window.history.pushState({ ...window.history.state, __hnlFloatingDetails: historyMarker }, '', window.location.href);
        historyEntryActive = true;
      } catch (_) {
        historyEntryActive = false;
      }

      applyLayout();
      window.addEventListener('resize', applyLayout);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('popstate', onPopState);
    };

    const onToggle = () => {
      if (details.open) activateFloating();
      else cleanupFloating();
    };

    details.addEventListener('toggle', onToggle);
    if (details.open) activateFloating();

    return () => {
      details.removeEventListener('toggle', onToggle);
      cleanupFloating();
    };
  }, []);

  const handleIndicatorClick = (event: React.MouseEvent<HTMLSpanElement>) => {
    const details = indicatorRef.current?.closest('details') as HTMLDetailsElement | null;
    if (!details?.open) return;
    event.preventDefault();
    event.stopPropagation();
    details.open = false;
  };

  return (
    <span
      ref={indicatorRef}
      onClick={handleIndicatorClick}
      className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-indigo-600 transition-colors group-hover:bg-indigo-50 ${className}`}
      aria-label="Đóng"
    >
      <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:hidden" />
      <X aria-hidden="true" className="hidden h-4 w-4 group-open:block" />
    </span>
  );
};