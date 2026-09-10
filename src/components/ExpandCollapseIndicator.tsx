import React, { useEffect, useRef } from 'react';
import { ChevronDown, X } from 'lucide-react';

interface ExpandCollapseIndicatorProps {
  className?: string;
  expandLabel?: string;
  collapseLabel?: string;
}

/**
 * Compact disclosure indicator used by Settings feature cards.
 *
 * The Settings cards already use native <details>/<summary> semantics. When a card opens,
 * this helper promotes that <details> into the same mobile sheet / desktop panel language
 * as the material-norm modal without changing feature logic or remounting its form state.
 *
 * Important UX contract:
 * - collapsed card: icon/summary + chevron only (no "Mở/Mở rộng/Thu gọn" text)
 * - open card: rounded mobile sheet / centered desktop panel + visible X
 * - Escape / browser-Android Back closes the current sheet before leaving the app
 * - body scroll is locked while the sheet is open
 * - colors resolve from the app theme variables so dark mode never receives a hard-coded
 *   light surface.
 */
export const ExpandCollapseIndicator: React.FC<ExpandCollapseIndicatorProps> = ({
  className = '',
}) => {
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const requestCloseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const details = indicatorRef.current?.closest('details') as HTMLDetailsElement | null;
    if (!details) return;

    const summary = details.querySelector(':scope > summary') as HTMLElement | null;
    let previousStyle: string | null = null;
    let previousBodyOverflow = '';
    let backdrop: HTMLDivElement | null = null;
    let active = false;
    let historyEntryActive = false;
    let historyBackPending = false;
    const historyMarker = `hnl-floating-details-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const isDesktop = () => window.matchMedia('(min-width: 768px)').matches;

    const applyLayout = () => {
      if (!active) return;
      const desktop = isDesktop();

      details.style.position = 'fixed';
      details.style.zIndex = '90';
      details.style.overflowX = 'hidden';
      details.style.overflowY = 'auto';
      details.style.overscrollBehavior = 'contain';
      details.style.background = 'var(--hnl-dark-surface, #f8fafc)';
      details.style.padding = desktop ? '16px' : '12px';
      details.style.paddingBottom = 'calc(20px + env(safe-area-inset-bottom, 0px))';
      details.style.boxShadow = desktop ? '0 28px 80px rgba(15, 23, 42, 0.32)' : '0 -12px 40px rgba(15, 23, 42, 0.18)';
      details.style.maxHeight = desktop ? '90dvh' : '92dvh';

      if (desktop) {
        details.style.top = '5dvh';
        details.style.right = '5vw';
        details.style.bottom = '5dvh';
        details.style.left = '5vw';
        details.style.width = 'auto';
        details.style.maxWidth = '960px';
        details.style.margin = '0 auto';
        details.style.borderRadius = '24px';
        details.style.border = '1px solid var(--hnl-dark-border, rgba(203, 213, 225, 0.95))';
      } else {
        // Match the MaterialNorm mobile language: backdrop remains visible above a
        // rounded top sheet instead of replacing the whole screen with a flat page.
        details.style.top = '8dvh';
        details.style.right = '0';
        details.style.bottom = '0';
        details.style.left = '0';
        details.style.width = '100vw';
        details.style.maxWidth = '100vw';
        details.style.margin = '0';
        details.style.borderRadius = '28px 28px 0 0';
        details.style.border = '1px solid var(--hnl-dark-border, rgba(226, 232, 240, 0.95))';
        details.style.borderBottom = '0';
      }
    };

    const closeImmediately = () => {
      if (details.open) details.open = false;
    };

    // UI-driven closes must consume the synthetic history entry first. Closing the
    // <details> and calling history.back() afterwards creates a race: a fast reopen can
    // receive the delayed popstate and immediately close again. Waiting for popstate to
    // perform the actual close keeps X / Escape / Android Back deterministic.
    const requestClose = () => {
      if (!details.open || historyBackPending) return;
      const currentMarker = window.history.state?.__hnlFloatingDetails;
      if (historyEntryActive && currentMarker === historyMarker) {
        historyBackPending = true;
        window.history.back();
        return;
      }
      closeImmediately();
    };
    requestCloseRef.current = requestClose;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !details.open) return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    };

    const onPopState = () => {
      if (!active || !details.open) return;
      historyEntryActive = false;
      historyBackPending = false;
      closeImmediately();
    };

    const onOpenSummaryClick = (event: MouseEvent) => {
      if (!details.open) return;
      // Native <summary> would close immediately and only then let cleanup unwind
      // history. Intercept the open-state click so it follows the same race-free path.
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    };

    const cleanupFloating = () => {
      if (!active) return;
      active = false;
      window.removeEventListener('resize', applyLayout);
      // Escape must be captured before focused controls/app-level handlers can consume it.
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('popstate', onPopState);
      backdrop?.removeEventListener('click', requestClose);
      backdrop?.remove();
      backdrop = null;
      document.body.style.overflow = previousBodyOverflow;
      if (previousStyle === null) details.removeAttribute('style');
      else details.setAttribute('style', previousStyle);

      // Do not call history.back() from cleanup. All user-visible close paths consume
      // the marker before toggling the panel, so cleanup is synchronous and cannot race
      // a subsequent reopen.
      historyEntryActive = false;
      historyBackPending = false;
    };

    const activateFloating = () => {
      if (active) return;
      active = true;
      historyEntryActive = false;
      historyBackPending = false;
      previousStyle = details.getAttribute('style');
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      backdrop = document.createElement('div');
      backdrop.setAttribute('data-hnl-floating-backdrop', 'true');
      Object.assign(backdrop.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '89',
        background: 'rgba(2, 6, 23, 0.58)',
        backdropFilter: 'blur(3px)',
      });
      backdrop.addEventListener('click', requestClose);
      document.body.appendChild(backdrop);

      try {
        window.history.pushState({ ...window.history.state, __hnlFloatingDetails: historyMarker }, '', window.location.href);
        historyEntryActive = true;
      } catch (_) {
        historyEntryActive = false;
      }

      applyLayout();
      window.addEventListener('resize', applyLayout);
      // Capture phase makes PC Escape deterministic even when focus is inside a control
      // with its own key handler. The sheet is the top interaction layer and closes first.
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('popstate', onPopState);
    };

    const onToggle = () => {
      if (details.open) activateFloating();
      else cleanupFloating();
    };

    summary?.addEventListener('click', onOpenSummaryClick, true);
    details.addEventListener('toggle', onToggle);
    if (details.open) activateFloating();

    return () => {
      summary?.removeEventListener('click', onOpenSummaryClick, true);
      details.removeEventListener('toggle', onToggle);
      if (requestCloseRef.current === requestClose) requestCloseRef.current = null;
      cleanupFloating();
    };
  }, []);

  const handleIndicatorClick = (event: React.MouseEvent<HTMLSpanElement>) => {
    const details = indicatorRef.current?.closest('details') as HTMLDetailsElement | null;
    if (!details?.open) return;
    event.preventDefault();
    event.stopPropagation();
    requestCloseRef.current?.();
  };

  return (
    <span
      ref={indicatorRef}
      onClick={handleIndicatorClick}
      className={`shrink-0 inline-flex h-9 w-9 group-open:h-11 group-open:w-11 items-center justify-center rounded-xl text-indigo-600 transition-all group-hover:bg-indigo-50 group-open:bg-slate-100 group-open:text-slate-600 ${className}`}
      aria-hidden="true"
    >
      <ChevronDown className="h-4 w-4 transition-transform group-open:hidden" />
      <X className="hidden h-5 w-5 group-open:block" />
    </span>
  );
};
