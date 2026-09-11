import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ChevronDown, X, type LucideIcon } from 'lucide-react';

interface SettingsAccordionCardProps {
  id?: string;
  icon: LucideIcon;
  iconClassName?: string;
  title: React.ReactNode;
  description: React.ReactNode;
  badge?: React.ReactNode;
  badgeClassName?: string;
  children: React.ReactNode;
  bodyClassName?: string;
  lazy?: boolean;
}

const SETTINGS_HISTORY_KEY = '__hnlSettingsFeatureSheet';

const asHistoryObject = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

/**
 * Shared Settings entry card.
 *
 * The compact card deliberately keeps the native <details>/<summary> anchor so
 * existing Super Admin navigation can continue opening a target by setting its
 * `open` property. The actual settings content is rendered in a body portal as
 * a mobile feature sheet, matching the Material Need sheet UX instead of
 * expanding inline and pushing the rest of Settings down the page.
 * Runtime, APK, EXE and UI-entry goldens certify this shared Settings sheet contract.
 */
export const SettingsAccordionCard: React.FC<SettingsAccordionCardProps> = ({
  id,
  icon: Icon,
  iconClassName = 'text-indigo-600',
  title,
  description,
  badge,
  badgeClassName = 'border-slate-200 bg-slate-50 text-slate-700',
  children,
  bodyClassName = 'space-y-3.5 px-4 pb-4 pt-3',
  lazy = false,
}) => {
  const reactId = useId();
  const sheetKey = id || `settings-sheet-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const titleId = `${sheetKey}-sheet-title`;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  // Non-lazy cards used to stay mounted even while their <details> was closed.
  // Keep that behavior; lazy cards mount on first open and then remain mounted.
  const [hasOpened, setHasOpened] = useState(!lazy);

  const setClosedImmediately = useCallback((restoreFocus = true) => {
    openRef.current = false;
    const details = detailsRef.current;
    if (details?.open) details.open = false;
    setOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => summaryRef.current?.focus(), 0);
    }
  }, []);

  const openSheet = useCallback(() => {
    if (openRef.current) return;
    openRef.current = true;
    setHasOpened(true);
    setOpen(true);

    const details = detailsRef.current;
    if (details && !details.open) details.open = true;

    if (typeof window !== 'undefined') {
      const state = asHistoryObject(window.history.state);
      if (state[SETTINGS_HISTORY_KEY] !== sheetKey) {
        window.history.pushState({ ...state, [SETTINGS_HISTORY_KEY]: sheetKey }, '');
      }
    }

    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
  }, [sheetKey]);

  const closeSheet = useCallback(() => {
    if (!openRef.current) return;
    if (typeof window !== 'undefined') {
      const state = asHistoryObject(window.history.state);
      if (state[SETTINGS_HISTORY_KEY] === sheetKey) {
        window.history.back();
        return;
      }
    }
    setClosedImmediately();
  }, [setClosedImmediately, sheetKey]);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeSheet();
    };

    const onPopState = () => {
      if (!openRef.current) return;
      // Back on Android/browser must remove the sheet before the next tap can
      // hit Settings. flushSync prevents one-frame stale backdrop interception.
      flushSync(() => setClosedImmediately(false));
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('popstate', onPopState);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
    };
  }, [closeSheet, open, setClosedImmediately]);

  useEffect(() => () => {
    if (typeof window === 'undefined') return;
    const state = asHistoryObject(window.history.state);
    if (state[SETTINGS_HISTORY_KEY] !== sheetKey) return;
    const nextState = { ...state };
    delete nextState[SETTINGS_HISTORY_KEY];
    window.history.replaceState(nextState, '');
  }, [sheetKey]);

  const portal = hasOpened && typeof document !== 'undefined'
    ? createPortal(
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
          className={`fixed inset-x-0 bottom-0 top-[8dvh] z-[90] flex min-h-0 flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-18px_50px_rgba(15,23,42,0.22)] ${open ? '' : 'hidden'}`}
        >
          <header className="flex min-h-[70px] shrink-0 items-center gap-2.5 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
              <Icon className={`h-5 w-5 ${iconClassName}`} aria-hidden="true" />
            </div>

            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[17px] font-semibold leading-5 text-slate-900 break-words">
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
              className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              aria-label={`Đóng ${typeof title === 'string' ? title : 'mục cài đặt'}`}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-slate-100 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className={bodyClassName}>{children}</div>
          </div>
        </section>
      </>,
      document.body,
    )
    : null;

  return (
    <>
      <details
        ref={detailsRef}
        id={id}
        data-hnl-settings-sheet-card={sheetKey}
        data-hnl-settings-sheet-open={open ? 'true' : 'false'}
        className="group w-full scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow duration-200 ease-out open:shadow-md"
        onToggle={(event) => {
          if (event.currentTarget.open) {
            if (!openRef.current) openSheet();
            return;
          }
          if (openRef.current) closeSheet();
        }}
      >
        <summary
          ref={summaryRef}
          data-hnl-settings-sheet-trigger={sheetKey}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={(event) => {
            event.preventDefault();
            if (openRef.current) closeSheet();
            else openSheet();
          }}
          className="flex min-h-[68px] cursor-pointer list-none items-start gap-3 px-4 py-3.5 select-none transition-colors duration-200 ease-out hover:bg-slate-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-300 [&::-webkit-details-marker]:hidden"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClassName}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold leading-5 text-slate-900 break-words">{title}</div>
              <div className="mt-0.5 text-[10px] font-semibold leading-4 text-slate-500 break-words">{description}</div>
            </div>
          </div>

          <div className="ml-auto flex max-w-[46%] shrink-0 items-center gap-2 sm:max-w-none">
            {badge !== undefined && badge !== null && (
              <span className={`max-w-[36vw] rounded-lg border px-2 py-1 text-center text-[10px] font-bold leading-4 whitespace-normal sm:max-w-none ${badgeClassName}`}>
                {badge}
              </span>
            )}
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </div>
        </summary>
      </details>

      {portal}
    </>
  );
};
