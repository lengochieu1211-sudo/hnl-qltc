import React, { useState } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

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
 * Shared inline Settings disclosure used by the compact configuration cards.
 * It deliberately stays in document flow so mobile bottom navigation and page
 * scrolling keep their normal geometry when a card is expanded.
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
  const [open, setOpen] = useState(false);

  return (
    <details
      id={id}
      className="group w-full scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow duration-200 ease-out open:shadow-md"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-[68px] cursor-pointer list-none items-start gap-3 px-4 py-3.5 select-none transition-colors duration-200 ease-out hover:bg-slate-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-300 [&::-webkit-details-marker]:hidden">
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
            className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ease-out group-open:rotate-180"
            aria-hidden="true"
          />
        </div>
      </summary>

      {(!lazy || open) && (
        <div className="border-t border-slate-100 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200">
          <div className={bodyClassName}>{children}</div>
        </div>
      )}
    </details>
  );
};
