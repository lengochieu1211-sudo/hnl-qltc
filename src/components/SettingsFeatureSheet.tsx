import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { X, type LucideIcon } from 'lucide-react';

interface SettingsFeatureSheetProps {
  open: boolean;
  onClose: () => void;
  sheetKey: string;
  icon: LucideIcon;
  iconClassName?: string;
  title: React.ReactNode;
  description: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  mounted?: boolean;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

const FEATURE_SHEET_HISTORY_KEY = '__hnlFeatureSheet';

const asHistoryObject = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

/**
 * Shared feature-sheet shell used by Settings and Material Need.
 * Business content stays owned by its original module; this component only
 * standardizes header geometry, backdrop/history close behavior and scrolling.
 */
export const SettingsFeatureSheet: React.FC<SettingsFeatureSheetProps> = ({
  open,
  onClose,
  sheetKey,
  icon: Icon,
  iconClassName = 'text-indigo-600',
  title,
  description,
  children,
  bodyClassName = 'space-y-3.5',
  mounted = true,
  returnFocusRef,
}) => {
  const titleId = `${sheetKey}-sheet-title`;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const openedHistoryRef = useRef(false);
  onCloseRef.current = onClose;

  const restoreFocus = useCallback(() => {
    window.setTimeout(() => returnFocusRef?.current?.focus(), 0);
  }, [returnFocusRef]);

  const closeSheet = useCallback(() => {
    if (!open || typeof window === 'undefined') return;
    const state = asHistoryObject(window.history.state);
    if (state[FEATURE_SHEET_HISTORY_KEY] === sheetKey) {
      window.history.back();
      return;
    }
    onCloseRef.current();
    restoreFocus();
  }, [open, restoreFocus, sheetKey]);

  useEffect(() => {
    if (!open || typeof document === 'undefined' || typeof window === 'undefined') return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const state = asHistoryObject(window.history.state);
    if (state[FEATURE_SHEET_HISTORY_KEY] !== sheetKey) {
      window.history.pushState({ ...state, [FEATURE_SHEET_HISTORY_KEY]: sheetKey }, '');
      openedHistoryRef.current = true;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeSheet();
    };

    const onPopState = () => {
      openedHistoryRef.current = false;
      flushSync(() => onCloseRef.current());
      restoreFocus();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('popstate', onPopState);
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
    };
  }, [closeSheet, open, restoreFocus, sheetKey]);

  useEffect(() => () => {
    if (typeof window === 'undefined' || !openedHistoryRef.current) return;
    const state = asHistoryObject(window.history.state);
    if (state[FEATURE_SHEET_HISTORY_KEY] !== sheetKey) return;
    const nextState = { ...state };
    delete nextState[FEATURE_SHEET_HISTORY_KEY];
    window.history.replaceState(nextState, '');
  }, [sheetKey]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        data-hnl-settings-sheet-backdrop={sheetKey}
        className={`fixed inset-0 z-[89] bg-slate-950/45 backdrop-blur-[1.5px] ${open ? '' : 'hidden'}`}
        aria-hidden="true"
        onClick={closeSheet}
      />

      <section
        data-hnl-settings-sheet={sheetKey}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!open}
        className={`fixed inset-x-0 bottom-0 top-[8dvh] z-[90] flex min-h-0 flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-18px_50px_rgba(15,23,42,0.22)] sm:left-[5vw] sm:right-[5vw] sm:mx-auto sm:max-w-5xl ${open ? '' : 'hidden'}`}
      >
        <header className="flex min-h-[84px] shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-7 py-4 sm:px-6">
          <div className="flex shrink-0 items-center justify-center rounded-xl bg-indigo-50 p-2">
            <Icon className={`h-5 w-5 ${iconClassName}`} aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[17px] font-semibold leading-[22px] text-slate-900 break-words">
              {title}
            </h2>
            <div className="mt-1 text-[13px] font-normal leading-[18px] text-slate-500 break-words">
              {description}
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeSheet}
            className="ml-1 inline-flex h-10 w-10 shrink-0 items-center justify-center text-slate-500 transition-colors hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            aria-label={`Đóng ${typeof title === 'string' ? title : 'mục'}`}
            title="Đóng"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
          <div className={`min-h-full px-7 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 ${bodyClassName}`}>
            {children}
          </div>
        </div>
      </section>
    </>,
    document.body,
  );
};
