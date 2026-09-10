import React, { useEffect, useId, useRef } from 'react';
import { ChevronRight, X, type LucideIcon } from 'lucide-react';

export type SettingsPanelTone = 'slate' | 'indigo' | 'emerald' | 'violet' | 'amber' | 'rose' | 'sky';

const toneClasses: Record<SettingsPanelTone, { icon: string; badge: string; ring: string }> = {
  slate: {
    icon: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    badge: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
    ring: 'focus-visible:ring-slate-400/60 dark:focus-visible:ring-slate-500/70',
  },
  indigo: {
    icon: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
    badge: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:text-indigo-200',
    ring: 'focus-visible:ring-indigo-400/60 dark:focus-visible:ring-indigo-400/70',
  },
  emerald: {
    icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-200',
    ring: 'focus-visible:ring-emerald-400/60 dark:focus-visible:ring-emerald-400/70',
  },
  violet: {
    icon: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
    badge: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-500/15 dark:text-violet-200',
    ring: 'focus-visible:ring-violet-400/60 dark:focus-visible:ring-violet-400/70',
  },
  amber: {
    icon: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    badge: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-200',
    ring: 'focus-visible:ring-amber-400/60 dark:focus-visible:ring-amber-400/70',
  },
  rose: {
    icon: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
    badge: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-200',
    ring: 'focus-visible:ring-rose-400/60 dark:focus-visible:ring-rose-400/70',
  },
  sky: {
    icon: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
    badge: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/15 dark:text-sky-200',
    ring: 'focus-visible:ring-sky-400/60 dark:focus-visible:ring-sky-400/70',
  },
};

interface SettingsEntryCardProps {
  id?: string;
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: React.ReactNode;
  badgeLabel?: string;
  tone?: SettingsPanelTone;
  onOpen: () => void;
  className?: string;
  testId?: string;
}

export const SettingsEntryCard: React.FC<SettingsEntryCardProps> = ({
  id,
  icon: Icon,
  title,
  description,
  badge,
  badgeLabel,
  tone = 'indigo',
  onOpen,
  className = '',
  testId,
}) => {
  const colors = toneClasses[tone];
  return (
    <button
      id={id}
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${title}. ${description}`}
      data-testid={testId}
      className={`group w-full min-h-[68px] rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50/70 focus:outline-none focus-visible:ring-2 ${colors.ring} dark:border-slate-700/80 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800/80 ${className}`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${colors.icon}`} aria-hidden="true">
          <Icon className="h-5 w-5" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-extrabold leading-5 text-slate-900 sm:text-sm dark:text-slate-100">{title}</span>
          <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-slate-500 sm:line-clamp-1 dark:text-slate-400">{description}</span>
        </span>
        <span className="ml-1 flex shrink-0 items-center gap-1.5">
          {badge !== undefined && badge !== null && badge !== '' && (
            <span
              aria-label={badgeLabel}
              className={`max-w-[112px] truncate rounded-full border px-2 py-1 text-[10px] font-bold leading-none sm:max-w-[160px] ${colors.badge}`}
            >
              {badge}
            </span>
          )}
          <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 dark:text-slate-500" aria-hidden="true" />
        </span>
      </span>
    </button>
  );
};

interface SettingsFeaturePanelProps {
  open: boolean;
  panelId: string;
  icon: LucideIcon;
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
  badge?: React.ReactNode;
  badgeLabel?: string;
  tone?: SettingsPanelTone;
  maxWidthClassName?: string;
  contentClassName?: string;
  testId?: string;
}

export const SettingsFeaturePanel: React.FC<SettingsFeaturePanelProps> = ({
  open,
  panelId,
  icon: Icon,
  title,
  description,
  onClose,
  children,
  badge,
  badgeLabel,
  tone = 'indigo',
  maxWidthClassName = 'max-w-3xl',
  contentClassName = '',
  testId,
}) => {
  const colors = toneClasses[tone];
  const reactId = useId();
  const titleId = `${panelId}-${reactId.replace(/:/g, '')}-title`;
  const descriptionId = `${panelId}-${reactId.replace(/:/g, '')}-description`;
  const pushedHistoryRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';

    const marker = `hnl-settings:${panelId}`;
    try {
      window.history.pushState({ ...(window.history.state || {}), __hnlSettingsPanel: marker }, document.title);
      pushedHistoryRef.current = true;
    } catch {
      pushedHistoryRef.current = false;
    }

    const handlePopState = () => {
      if (pushedHistoryRef.current) {
        pushedHistoryRef.current = false;
        closeRef.current();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (pushedHistoryRef.current && window.history.state?.__hnlSettingsPanel === marker) {
        window.history.back();
      } else {
        closeRef.current();
      }
    };

    window.addEventListener('popstate', handlePopState);
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
      window.requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, [open, panelId]);

  if (!open) return null;

  const requestClose = () => {
    const marker = `hnl-settings:${panelId}`;
    if (pushedHistoryRef.current && window.history.state?.__hnlSettingsPanel === marker) {
      window.history.back();
      return;
    }
    pushedHistoryRef.current = false;
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[170] flex items-end justify-center bg-slate-950/60 backdrop-blur-[2px] sm:items-center sm:p-4 dark:bg-black/75"
      role="presentation"
      data-settings-feature-panel={panelId}
      data-testid={testId}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={`flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-slate-200 bg-slate-50 shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-3xl dark:border-slate-700/80 dark:bg-slate-950 ${maxWidthClassName}`}
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3.5 backdrop-blur sm:px-5 dark:border-slate-800 dark:bg-slate-950/95">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${colors.icon}`} aria-hidden="true">
            <Icon className="h-5.5 w-5.5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 id={titleId} className="min-w-0 text-[18px] font-extrabold leading-6 text-slate-900 sm:text-xl dark:text-slate-100">{title}</h2>
              {badge !== undefined && badge !== null && badge !== '' && (
                <span aria-label={badgeLabel} className={`max-w-[170px] truncate rounded-full border px-2 py-1 text-[10px] font-bold leading-none ${colors.badge}`}>
                  {badge}
                </span>
              )}
            </div>
            <p id={descriptionId} className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500 sm:text-xs dark:text-slate-400">{description}</p>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              requestClose();
            }}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label={`Đóng ${title}`}
            title="Đóng"
            data-panel-close
          >
            <X className="h-5.5 w-5.5" aria-hidden="true" />
          </button>
        </header>
        <div className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3.5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-5 ${contentClassName}`}>
          {children}
        </div>
      </section>
    </div>
  );
};
