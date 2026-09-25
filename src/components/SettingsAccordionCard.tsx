import React, { useCallback, useId, useRef, useState } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { SettingsFeatureSheet } from './SettingsFeatureSheet';

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

/**
 * Compact Settings entry card.
 * Keeps native <details>/<summary> for stable navigation, while all sheet UI is
 * delegated to SettingsFeatureSheet so the five Settings entries and Material
 * Need share one header/backdrop/history/scroll contract.
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
  bodyClassName = 'space-y-3.5',
  lazy = false,
}) => {
  const reactId = useId();
  const sheetKey = id || `settings-sheet-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(!lazy);

  const setSheetOpen = useCallback((nextOpen: boolean) => {
    openRef.current = nextOpen;
    if (nextOpen) setHasOpened(true);
    setOpen(nextOpen);
    const details = detailsRef.current;
    if (details && details.open !== nextOpen) details.open = nextOpen;
  }, []);

  return (
    <>
      <details
        ref={detailsRef}
        id={id}
        data-hnl-settings-sheet-card={sheetKey}
        data-hnl-settings-sheet-open={open ? 'true' : 'false'}
        className="group w-full scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow duration-200 ease-out open:shadow-md"
        onToggle={(event) => {
          const nextOpen = event.currentTarget.open;
          if (nextOpen !== openRef.current) setSheetOpen(nextOpen);
        }}
      >
        <summary
          ref={summaryRef}
          data-hnl-settings-sheet-trigger={sheetKey}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={(event) => {
            event.preventDefault();
            setSheetOpen(!openRef.current);
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

      <SettingsFeatureSheet
        open={open}
        onClose={() => setSheetOpen(false)}
        sheetKey={sheetKey}
        icon={Icon}
        iconClassName={iconClassName}
        title={title}
        description={description}
        bodyClassName={bodyClassName}
        mounted={hasOpened}
        returnFocusRef={summaryRef}
      >
        {children}
      </SettingsFeatureSheet>
    </>
  );
};
